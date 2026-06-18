import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractJson, renderTemplate } from "@amp/shared";
import type { EngineEvent, PipelineStatus, ReviewScore } from "@amp/shared";
import { ruleCheck } from "@amp/review";
import { writeJianyingDraft } from "@amp/jianying";
import { writePromptDocx, writeSrt } from "./mvkit.js";
import type { Repo, StepRow } from "./db.js";
import type { ProviderRegistry } from "./registry.js";
import type { TemplateStore } from "./templates.js";

const STEP_TIMEOUT_MS = 10 * 60 * 1000;

/** 按画面比例生成构图保护规范块，注入提示词的 {{orientationBlock}} */
function orientationBlock(aspect: string | undefined): string {
  if (aspect === "16:9") {
    return [
      "【画面比例：16:9 横版】每条提示词遵守：",
      "- 开头必须包含：[HORIZONTAL 16:9]",
      "- 结尾必须包含：Landscape orientation, horizontal composition, 16:9 format.",
      "- 优先横向电影感构图：wide cinematic framing, horizontal leading lines, establishing shot, 横向延展的纵深",
      "- 人物可左右分布或前后纵深；避免强行竖切、避免画面旋转",
    ].join("\n");
  }
  // 默认 9:16 竖版
  return [
    "【画面比例：9:16 竖版】每条提示词遵守：",
    "- 开头必须包含：[VERTICAL 9:16]",
    "- 结尾必须包含：Portrait orientation, vertical composition, 9:16 format.",
    "- 优先纵向友好构图：full-body standing、half-body portrait、low-angle / high-angle、deep vertical corridor/perspective",
    "- 禁止横向词汇：wide shot、panoramic、landscape、horizontal、side by side",
    "- 多人场景改为前后纵深排列（one behind another），不要左右并排",
  ].join("\n");
}

/** 从「图片提示词」文本中解析出每一条可直接出图的英文提示词（每行以 [VERTICAL/[HORIZONTAL 开头） */
function parseImagePrompts(text: string): string[] {
  const byMarker = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\[(VERTICAL|HORIZONTAL)\b/i.test(l));
  if (byMarker.length > 0) return byMarker;
  // 兜底：按【画面/【镜头 分块，取块内非表头行
  return text
    .split(/(?=【(?:画面|镜头)\s*\d+】)/)
    .map((block) =>
      block
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .trim()
    )
    .filter((p) => p.length > 10);
}

export class PipelineEngine extends EventEmitter {
  /** 正在执行的 step id，防止重复启动 */
  private inflight = new Set<number>();
  /** 待注入的评审修改意见：rerunStep(feedback) 时记录，runStep 消费一次后清除 */
  private feedback = new Map<number, string>();
  /** 全自动模式下"评审不过→重生成→复评"的轮次计数（每条流水线最多 1 轮，防止死循环） */
  private autoRetries = new Map<number, number>();

  constructor(
    private repo: Repo,
    private registry: ProviderRegistry,
    private templates: TemplateStore,
    private workspaceDir: string
  ) {
    super();
  }

  private emitEvent(event: EngineEvent) {
    this.emit("event", event);
  }

  /** 推进一条流水线：启动所有依赖已满足的待执行步骤 */
  kick(pipelineId: number) {
    const steps = this.repo.listStepsByPipeline(pipelineId);
    const byDefId = new Map(steps.map((s) => [s.def_id, s]));

    for (const step of steps) {
      if (step.status !== "pending" || this.inflight.has(step.id)) continue;
      const ready = step.needs.every((needId) => byDefId.get(needId)?.status === "succeeded");
      if (!ready) continue;
      this.inflight.add(step.id);
      void this.runStep(step.id).finally(() => {
        this.inflight.delete(step.id);
        this.kick(pipelineId);
      });
    }
    this.refreshPipelineStatus(pipelineId);
  }

  /** 单步重跑（清状态后执行；不影响已有产物，产生新版本）。feedback 为评审修改意见，会附加到提示词 */
  rerunStep(stepId: number, feedback?: string) {
    const step = this.repo.getStep(stepId);
    if (!step) throw new Error(`步骤 ${stepId} 不存在`);
    if (this.inflight.has(stepId)) throw new Error("该步骤正在运行中");
    if (feedback?.trim()) this.feedback.set(stepId, feedback.trim());
    this.repo.setStepStatus(stepId, "pending", { error: null });
    this.kick(step.pipeline_id);
  }

  /** 人工选定产物后调用：关闭人工卡点并继续推进 */
  confirmHumanGate(stepId: number) {
    const step = this.repo.getStep(stepId);
    if (!step) throw new Error(`步骤 ${stepId} 不存在`);
    if (step.status !== "waiting_human") throw new Error("该步骤不在等待人工确认状态");
    this.repo.setStepStatus(stepId, "succeeded", { finished: true });
    this.emitEvent({ type: "step-status", pipelineId: step.pipeline_id, stepId, data: { status: "succeeded" } });
    this.kick(step.pipeline_id);
  }

  private refreshPipelineStatus(pipelineId: number) {
    const steps = this.repo.listStepsByPipeline(pipelineId);
    let status: PipelineStatus;
    if (steps.every((s) => s.status === "succeeded")) status = "succeeded";
    else if (steps.some((s) => s.status === "running" || this.inflight.has(s.id))) status = "running";
    else if (steps.some((s) => s.status === "waiting_human")) status = "waiting_human";
    else if (steps.some((s) => s.status === "failed")) status = "failed";
    else status = "pending";

    const pipeline = this.repo.getPipeline(pipelineId);
    if (pipeline && pipeline.status !== status) {
      this.repo.setPipelineStatus(pipelineId, status);
      this.emitEvent({ type: "pipeline-status", pipelineId, data: { status } });
    }
  }

  private buildVars(step: StepRow) {
    const pipeline = this.repo.getPipeline(step.pipeline_id)!;
    const project = this.repo.getProject(pipeline.project_id)!;
    const steps: Record<string, any> = {};
    for (const s of this.repo.listStepsByPipeline(step.pipeline_id)) {
      const selected = this.repo.selectedArtifact(s.id);
      steps[s.def_id] = {
        selected: selected?.content ?? "",
        selectedPath: selected?.file_path ?? "",
      };
    }
    // 用户上传/粘贴的素材汇总为文本，供 {{brief.materials}} 注入提示词
    const materials = this.repo.listMaterials(project.id);
    const lines: string[] = [];
    let imgIdx = 0;
    let vidIdx = 0;
    for (const m of materials) {
      if (m.kind === "text" && m.content) {
        lines.push(`【文字素材】${m.note ? `（${m.note}）` : ""}\n${m.content}`);
      } else if (m.kind === "image") {
        lines.push(`【图片素材 ${++imgIdx}】${m.original_name ?? ""}${m.note ? ` —— ${m.note}` : ""}`);
      } else if (m.kind === "video") {
        lines.push(`【视频素材 ${++vidIdx}】${m.original_name ?? ""}${m.note ? ` —— ${m.note}` : ""}（未剪辑原片，将作为剪映草稿的源素材）`);
      } else if (m.kind === "file") {
        lines.push(`【附件】${m.original_name ?? ""}${m.note ? ` —— ${m.note}` : ""}`);
      }
    }
    const brief = { ...project.brief, materials: lines.join("\n\n") };
    const options = pipeline.options ?? {};
    return {
      brief,
      steps,
      platform: pipeline.platform,
      mode: pipeline.mode,
      options,
      orientationBlock: orientationBlock(options.aspect),
    };
  }

  /** 收集项目的图片素材路径，用于把图片喂给支持视觉的引擎 */
  private imageMaterials(projectId: number): string[] {
    return this.repo
      .listMaterials(projectId)
      .filter((m) => m.kind === "image" && m.file_path)
      .map((m) => m.file_path as string);
  }

  /** 组装最终提示词：模板 + 我的要求 + 素材（评审步骤除外）+ 可选的评审修改意见 */
  private composePrompt(step: StepRow, feedback?: string): string {
    const template = this.templates.readPrompt(step.prompt_template);
    const vars = this.buildVars(step);
    let prompt = renderTemplate(template, vars);
    if (step.type !== "review") {
      const req = (vars.brief as any).requirements?.trim();
      const materials = (vars.brief as any).materials?.trim();
      if (req) prompt += `\n\n## 我的具体要求（请务必满足）\n${req}`;
      if (materials) prompt += `\n\n## 我提供的素材（请基于这些素材进行创作，不要凭空编造与素材冲突的内容）\n${materials}`;
    }
    if (feedback) prompt += `\n\n## 评审修改意见（这是重新生成，请务必针对以下意见改进）\n${feedback}`;
    return prompt;
  }

  /** 按需渲染某步骤的提示词（不调用任何引擎），供「人工接管」复制到 GPT/Gemini 手动生成 */
  renderPrompt(stepId: number): string {
    const step = this.repo.getStep(stepId);
    if (!step) throw new Error(`步骤 ${stepId} 不存在`);
    const prompt = this.composePrompt(step, this.feedback.get(stepId));
    this.repo.setStepPrompt(step.id, prompt);
    return prompt;
  }

  /** 人工接管-文本回填：把你在外部模型手动生成并粘贴回来的结果写入工作区，完成该步骤并推进 */
  async submitManualText(stepId: number, text: string) {
    const step = this.repo.getStep(stepId);
    if (!step) throw new Error(`步骤 ${stepId} 不存在`);
    if (step.type === "cover") throw new Error("封面步骤请用图片上传回填");
    if (!text?.trim()) throw new Error("回填内容不能为空");

    const version = this.repo.nextArtifactVersion(stepId);
    const outDir = this.stepDir(step, version);
    await this.saveStepResult(step, version, outDir, { kind: "text", text: text.trim() });
    this.finishManual(step);
  }

  /** 人工接管-图片回填：把你手动用 GPT/Gemini 生成的封面图上传回来，派生尺寸、完成步骤并推进 */
  async submitManualImages(stepId: number, filePaths: string[]) {
    const step = this.repo.getStep(stepId);
    if (!step) throw new Error(`步骤 ${stepId} 不存在`);
    if (step.type !== "cover") throw new Error("仅封面步骤支持图片回填");
    if (filePaths.length === 0) throw new Error("未收到图片");

    const version = this.repo.nextArtifactVersion(stepId);
    const outDir = this.stepDir(step, version);
    const copied: string[] = [];
    for (const src of filePaths) {
      if (!fs.existsSync(src)) continue;
      const dest = path.join(outDir, path.basename(src));
      fs.copyFileSync(src, dest);
      copied.push(dest);
    }
    await this.saveStepResult(step, version, outDir, { kind: "images", files: copied });
    this.finishManual(step);
  }

  /** 手动回填后收尾：确保有选中产物，标记完成并推进下游 */
  private finishManual(step: StepRow) {
    if (!this.repo.selectedArtifact(step.id)) {
      const all = this.repo.listArtifactsByStep(step.id);
      const latestVersion = all.reduce((m, a) => Math.max(m, a.version), 0);
      const first = all.find((a) => a.version === latestVersion);
      if (first) this.repo.selectArtifact(first.id);
    }
    this.repo.setStepStatus(step.id, "succeeded", { finished: true, error: null });
    this.emitEvent({ type: "step-status", pipelineId: step.pipeline_id, stepId: step.id, data: { status: "succeeded" } });
    this.kick(step.pipeline_id);
  }

  private stepDir(step: StepRow, version: number) {
    const dir = path.join(
      this.workspaceDir,
      `project-${this.repo.getPipeline(step.pipeline_id)!.project_id}`,
      `pipeline-${step.pipeline_id}`,
      step.def_id,
      `v${version}`
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async runStep(stepId: number) {
    const step = this.repo.getStep(stepId)!;
    const pipelineId = step.pipeline_id;

    try {
      // docx 打包步骤：内置转换，不调用任何引擎
      if (step.type === "docx") {
        this.repo.setStepStatus(stepId, "running", { started: true, error: null });
        this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "running" } });
        const version = this.repo.nextArtifactVersion(stepId);
        const outDir = this.stepDir(step, version);
        await this.buildDocxArtifact(step, version, outDir);
        this.repo.setStepStatus(stepId, "succeeded", { finished: true });
        this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "succeeded" } });
        return;
      }

      if (!step.provider_id) throw new Error("该步骤未绑定引擎，请在步骤卡片上选择引擎");
      const provider = this.registry.get(step.provider_id);

      // 批量出图步骤：读取「图片提示词」逐条调出图引擎生成图片
      if (step.type === "batch-images") {
        await this.runBatchImages(step);
        return;
      }

      const feedback = this.feedback.get(stepId);
      if (feedback) this.feedback.delete(stepId);
      const prompt = this.composePrompt(step, feedback);
      this.repo.setStepPrompt(stepId, prompt);

      this.repo.setStepStatus(stepId, "running", { started: true, error: null });
      this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "running" } });

      const release = await this.registry.semaphore(provider.row).acquire();
      let result;
      const version = this.repo.nextArtifactVersion(stepId);
      const outDir = this.stepDir(step, version);
      // 文本类生成步骤：把用户上传的图片素材一并传给引擎（视觉引擎会读图，其余忽略）
      const images =
        step.type === "title" || step.type === "content"
          ? this.imageMaterials(this.repo.getPipeline(pipelineId)!.project_id)
          : undefined;
      // 封面步骤：把选中的标题传给出图引擎，供「底图+叠字」模式叠加文字
      let overlayText: string | undefined;
      if (step.type === "cover") {
        const stepsOfP = this.repo.listStepsByPipeline(pipelineId);
        const titleStep = stepsOfP.find((s) => s.type === "title");
        overlayText = (titleStep && this.repo.selectedArtifact(titleStep.id)?.content) || undefined;
        if (!overlayText) {
          // MV 等无标题步骤的流程：从歌词里取歌名《...》作为封面叠字
          const lyricsStep = stepsOfP.find((s) => s.type === "lyrics");
          const lyr = (lyricsStep && this.repo.selectedArtifact(lyricsStep.id)?.content) || "";
          overlayText = lyr.match(/《([^》]+)》/)?.[1];
        }
      }
      try {
        result = await provider.generate(
          { taskId: String(stepId), stepType: step.type, prompt, timeoutMs: STEP_TIMEOUT_MS, outDir, images, overlayText },
          (chunk) => this.emitEvent({ type: "step-stream", pipelineId, stepId, data: { chunk } })
        );
      } finally {
        release();
      }

      await this.saveStepResult(step, version, outDir, result);

      const after = this.repo.getStep(stepId)!;
      if (after.status === "running") {
        this.repo.setStepStatus(stepId, "succeeded", { finished: true });
        this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "succeeded" } });
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.repo.setStepStatus(stepId, "failed", { error: message, finished: true });
      this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "failed", error: message } });
    }
  }

  private async saveStepResult(
    step: StepRow,
    version: number,
    outDir: string,
    result: { kind: "text"; text: string } | { kind: "images"; files: string[] }
  ) {
    const pipelineId = step.pipeline_id;

    if (step.type === "cover") {
      if (result.kind !== "images") throw new Error("封面步骤需要绑定出图类引擎（api-image）");
      let first = true;
      for (const file of result.files) {
        const artifact = this.repo.createArtifact({
          stepId: step.id,
          version,
          kind: "image",
          filePath: file,
          label: "原图",
        });
        if (first) this.repo.selectArtifact(artifact.id);
        this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });
        for (const size of step.cover_sizes ?? []) {
          const sizedPath = path.join(
            outDir,
            `${path.basename(file, path.extname(file))}_${size.w}x${size.h}.png`
          );
          await sharp(file).resize(size.w, size.h, { fit: "cover", position: "attention" }).png().toFile(sizedPath);
          const sized = this.repo.createArtifact({
            stepId: step.id,
            version,
            kind: "image",
            filePath: sizedPath,
            label: `${size.label} ${size.w}x${size.h}`,
          });
          this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: sized });
        }
        first = false;
      }
      return;
    }

    if (result.kind !== "text") throw new Error(`步骤 ${step.name} 期望文本输出`);
    const text = result.text.trim();

    if (step.type === "title") {
      const titles = extractJson<string[]>(text);
      const list =
        Array.isArray(titles) && titles.length > 0
          ? titles.map(String)
          : text.split("\n").map((l) => l.replace(/^\s*[\d.、\-*]+\s*/, "").trim()).filter(Boolean).slice(0, 5);
      if (list.length === 0) throw new Error("未能从输出中解析出候选标题");
      const createdIds: number[] = [];
      for (const title of list) {
        const artifact = this.repo.createArtifact({ stepId: step.id, version, kind: "text", content: title });
        createdIds.push(artifact.id);
        this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });
      }
      const autoMode = !!this.repo.getPipeline(pipelineId)!.auto;
      if (step.human_gate && !autoMode) {
        this.repo.setStepStatus(step.id, "waiting_human");
        this.emitEvent({ type: "step-status", pipelineId, stepId: step.id, data: { status: "waiting_human" } });
      } else {
        // 全自动：候选按推荐度排序，直接采用第一个（事后可在 UI 改选并重跑下游）
        this.repo.selectArtifact(createdIds[0]);
      }
      return;
    }

    if (step.type === "review") {
      this.saveReviews(step, text);
      await this.reviewCover(step).catch((err) =>
        this.emitEvent({
          type: "step-stream",
          pipelineId,
          stepId: step.id,
          data: { chunk: `\n[封面评审跳过] ${err?.message ?? err}\n` },
        })
      );
      return;
    }

    if (step.type === "subtitle") {
      const artifact = this.repo.createArtifact({ stepId: step.id, version, kind: "text", content: text });
      this.repo.selectArtifact(artifact.id);
      this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });
      const srtPath = writeSrt(outDir, "字幕.srt", text);
      const srtArtifact = this.repo.createArtifact({ stepId: step.id, version, kind: "file", filePath: srtPath, label: "SRT 字幕文件" });
      this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: srtArtifact });
      return;
    }

    // content / video / lyrics / image-prompts / video-prompts：单产物，自动选中
    const artifact = this.repo.createArtifact({ stepId: step.id, version, kind: "text", content: text });
    this.repo.selectArtifact(artifact.id);
    this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });

    if (step.type === "video" && step.post === "jianying-draft") {
      const pipeline = this.repo.getPipeline(pipelineId)!;
      const sourceVideos = this.repo
        .listMaterials(pipeline.project_id)
        .filter((m) => m.kind === "video" && m.file_path)
        .map((m) => m.file_path as string);
      const draft = writeJianyingDraft(text, outDir, { name: `${pipeline.name}-p${pipelineId}`, sourceVideos });
      const draftArtifact = this.repo.createArtifact({
        stepId: step.id,
        version,
        kind: "file",
        filePath: draft.draftDir,
        label: "剪映草稿目录",
      });
      this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: draftArtifact });
      const csvArtifact = this.repo.createArtifact({
        stepId: step.id,
        version,
        kind: "file",
        filePath: draft.csvPath,
        label: "分镜表 CSV（降级方案）",
      });
      this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: csvArtifact });
    }
  }

  /** MV 提示词 docx 打包：汇总歌词、图片提示词、视频提示词、封面提示词写成 .docx */
  private async buildDocxArtifact(step: StepRow, version: number, outDir: string) {
    const steps = this.repo.listStepsByPipeline(step.pipeline_id);
    const sel = (type: string) => {
      const s = steps.find((x) => x.type === type);
      return (s && this.repo.selectedArtifact(s.id)?.content) || "";
    };
    const coverStep = steps.find((x) => x.type === "cover");
    const coverPrompt = coverStep?.prompt_rendered || "(封面步骤尚未生成提示词)";
    const lyrics = sel("lyrics");
    const m = lyrics.match(/[《【]?标题[】》]?\s*[:：]?\s*[《]?([^》\n]+)[》]?/) || lyrics.match(/《([^》]+)》/);
    const songTitle = (m?.[1] || this.repo.getPipeline(step.pipeline_id)!.name).trim();

    const aspect = this.repo.getPipeline(step.pipeline_id)!.options?.aspect || "9:16";
    const imgBody = sel("image-prompts");
    const vidBody = sel("video-prompts");
    const sections = [{ heading: "一、歌名与歌词", body: lyrics || "(未生成)" }];
    if (imgBody) sections.push({ heading: `二、图片提示词（按歌词分段，${aspect}）`, body: imgBody });
    if (vidBody) sections.push({ heading: `二、视频分镜提示词（按歌词分段，${aspect}）`, body: vidBody });
    sections.push({ heading: "三、封面图提示词", body: coverPrompt });
    const file = await writePromptDocx(outDir, "MV提示词文档.docx", `MV 提示词文档 · ${songTitle}`, sections);
    const artifact = this.repo.createArtifact({ stepId: step.id, version, kind: "file", filePath: file, label: "提示词文档（docx）" });
    this.repo.selectArtifact(artifact.id);
    this.emitEvent({ type: "artifact", pipelineId: step.pipeline_id, stepId: step.id, data: artifact });
  }

  /** 批量出图：把「图片提示词」逐条调出图引擎生成图片，并裁切到目标比例 */
  private async runBatchImages(step: StepRow) {
    const MAX_IMAGES = 40;
    const pipelineId = step.pipeline_id;
    const provider = this.registry.get(step.provider_id!);

    const steps = this.repo.listStepsByPipeline(pipelineId);
    const ips = steps.find((s) => s.type === "image-prompts");
    const promptsText = (ips && this.repo.selectedArtifact(ips.id)?.content) || "";
    const prompts = parseImagePrompts(promptsText).slice(0, MAX_IMAGES);
    if (prompts.length === 0) throw new Error("未能从「图片提示词」中解析出可出图的提示词，请检查上一步输出");

    this.repo.setStepStatus(step.id, "running", { started: true, error: null });
    this.emitEvent({ type: "step-status", pipelineId, stepId: step.id, data: { status: "running" } });

    const version = this.repo.nextArtifactVersion(step.id);
    const outDir = this.stepDir(step, version);
    const target = step.cover_sizes?.[0];
    const sizeStr = target ? `${target.w}x${target.h}` : undefined; // 直接按该比例出图，不裁剪
    let ok = 0;
    let lastErr = "";

    for (let i = 0; i < prompts.length; i++) {
      this.emitEvent({ type: "step-stream", pipelineId, stepId: step.id, data: { chunk: `正在生成第 ${i + 1}/${prompts.length} 张…\n` } });
      const release = await this.registry.semaphore(provider.row).acquire();
      try {
        const res = await provider.generate({
          taskId: `${step.id}-${i}`,
          stepType: step.type,
          prompt: prompts[i],
          timeoutMs: STEP_TIMEOUT_MS,
          outDir,
          imageCount: 1,
          imageSize: sizeStr,
        });
        if (res.kind !== "images" || !res.files[0]) continue;
        const artifact = this.repo.createArtifact({
          stepId: step.id,
          version,
          kind: "image",
          filePath: res.files[0],
          label: `画面 ${i + 1}`,
        });
        if (ok === 0) this.repo.selectArtifact(artifact.id);
        this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });
        ok += 1;
      } catch (err: any) {
        lastErr = err?.message ?? String(err);
        this.emitEvent({ type: "step-stream", pipelineId, stepId: step.id, data: { chunk: `第 ${i + 1} 张失败：${lastErr}\n` } });
      } finally {
        release();
      }
    }

    if (ok === 0) throw new Error(`全部图片生成失败：${lastErr}`);
    this.repo.setStepStatus(step.id, "succeeded", { finished: true });
    this.emitEvent({ type: "step-status", pipelineId, stepId: step.id, data: { status: "succeeded", detail: `成功 ${ok}/${prompts.length} 张` } });
  }

  /** 单张重抽：按该图片对应的提示词重新生成一张，替换原文件（保持序号不变） */
  async rerollBatchImage(artifactId: number) {
    const art = this.repo.getArtifact(artifactId);
    if (!art) throw new Error(`产物 ${artifactId} 不存在`);
    const step = this.repo.getStep(art.step_id);
    if (!step || step.type !== "batch-images") throw new Error("仅 MV 批量图片支持单张重抽");
    const idx = parseInt((art.label ?? "").match(/(\d+)/)?.[1] ?? "0", 10);
    if (!idx) throw new Error("无法确定该图片的序号");

    const steps = this.repo.listStepsByPipeline(step.pipeline_id);
    const ips = steps.find((s) => s.type === "image-prompts");
    const prompts = parseImagePrompts((ips && this.repo.selectedArtifact(ips.id)?.content) || "");
    const prompt = prompts[idx - 1];
    if (!prompt) throw new Error(`找不到第 ${idx} 张对应的提示词`);

    const provider = this.registry.get(step.provider_id!);
    const target = step.cover_sizes?.[0];
    const outDir = art.file_path ? path.dirname(art.file_path) : this.stepDir(step, this.repo.nextArtifactVersion(step.id) - 1);
    const release = await this.registry.semaphore(provider.row).acquire();
    let newFile: string | undefined;
    try {
      const res = await provider.generate({
        taskId: `${step.id}-reroll-${idx}`,
        stepType: "batch-images",
        prompt,
        timeoutMs: STEP_TIMEOUT_MS,
        outDir,
        imageCount: 1,
        imageSize: target ? `${target.w}x${target.h}` : undefined,
      });
      if (res.kind === "images") newFile = res.files[0];
    } finally {
      release();
    }
    if (!newFile) throw new Error("重抽失败：未生成图片");
    if (art.file_path && fs.existsSync(art.file_path)) fs.rmSync(art.file_path, { force: true });
    const updated = this.repo.updateArtifactFile(artifactId, newFile);
    this.emitEvent({ type: "artifact", pipelineId: step.pipeline_id, stepId: step.id, data: updated });
    return updated;
  }

  private saveReviews(step: StepRow, text: string) {
    const parsed = extractJson<ReviewScore[] | ReviewScore>(text);
    const reviews = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    if (reviews.length === 0) throw new Error("评审输出无法解析为 JSON 评分，请检查评审引擎输出");

    const steps = this.repo.listStepsByPipeline(step.pipeline_id);
    for (const review of reviews) {
      const targetStep = steps.find((s) => s.type === review.target);
      const artifact = targetStep ? this.repo.selectedArtifact(targetStep.id) : undefined;
      this.repo.createReview({
        stepId: step.id,
        artifactId: artifact?.id,
        providerId: step.provider_id!,
        target: review.target,
        scores: review.scores ?? {},
        total: review.total ?? 0,
        verdict: review.verdict ?? "revise",
        issues: review.issues ?? [],
        suggestions: review.suggestions ?? [],
      });
    }

    // 规则层敏感词/极限词预检（独立于 LLM 评审）
    for (const target of ["title", "content"] as const) {
      const targetStep = steps.find((s) => s.type === target);
      const artifact = targetStep ? this.repo.selectedArtifact(targetStep.id) : undefined;
      if (!artifact?.content) continue;
      const issues = ruleCheck(artifact.content);
      if (issues.length > 0) {
        this.repo.createReview({
          stepId: step.id,
          artifactId: artifact.id,
          providerId: "rule:keywords",
          target,
          scores: {},
          total: 0,
          verdict: "revise",
          issues,
          suggestions: ["请替换或删除命中的极限词/敏感词后重新生成"],
        });
      }
    }
    this.emitEvent({
      type: "review",
      pipelineId: step.pipeline_id,
      stepId: step.id,
      data: this.repo.listReviewsByPipeline(step.pipeline_id),
    });

    this.maybeAutoRegenerate(step, reviews);
  }

  /**
   * 全自动闭环：评审不通过时，把评审意见注入对应步骤自动重生成，并安排复评。
   * 每条流水线最多一轮，避免"生成→不过→再生成"无限循环。
   */
  private maybeAutoRegenerate(reviewStep: StepRow, reviews: ReviewScore[]) {
    const pipeline = this.repo.getPipeline(reviewStep.pipeline_id)!;
    if (!pipeline.auto) return;
    const round = this.autoRetries.get(pipeline.id) ?? 0;
    if (round >= 1) return;

    const steps = this.repo.listStepsByPipeline(pipeline.id);
    const failing = reviews.filter(
      (r) => (r.verdict ?? "revise") !== "pass" && (r.target === "title" || r.target === "content")
    );
    if (failing.length === 0) return;

    this.autoRetries.set(pipeline.id, round + 1);
    for (const review of failing) {
      const target = steps.find((s) => s.type === review.target);
      if (!target) continue;
      const feedback = [
        ...(review.issues ?? []).map((x) => `问题：${x}`),
        ...(review.suggestions ?? []).map((x) => `建议：${x}`),
      ].join("\n");
      if (feedback) this.feedback.set(target.id, feedback);
      this.repo.setStepStatus(target.id, "pending", { error: null });
      this.emitEvent({ type: "step-status", pipelineId: pipeline.id, stepId: target.id, data: { status: "pending" } });
    }
    // 评审自身也重置，待目标步骤重生成后复评
    this.repo.setStepStatus(reviewStep.id, "pending", { error: null });
    this.emitEvent({ type: "step-status", pipelineId: pipeline.id, stepId: reviewStep.id, data: { status: "pending" } });
  }

  /**
   * 封面多模态评审：评审步骤绑定的引擎为支持视觉的文本 API（config.vision = true）时，
   * 把选中的封面原图一并发送评分；不满足条件或失败时静默跳过，不影响主评审。
   */
  private async reviewCover(step: StepRow) {
    const steps = this.repo.listStepsByPipeline(step.pipeline_id);
    const coverStep = steps.find((s) => s.type === "cover");
    const cover = coverStep ? this.repo.selectedArtifact(coverStep.id) : undefined;
    if (!cover?.file_path || !fs.existsSync(cover.file_path)) return;

    const provider = this.registry.get(step.provider_id!);
    if (provider.row.kind !== "api-text" || !provider.row.config.vision) return;

    const template = this.templates.readPrompt("common/review-cover.md");
    const prompt = renderTemplate(template, this.buildVars(step));
    const result = await provider.generate({
      taskId: `${step.id}-cover`,
      stepType: "review",
      prompt,
      timeoutMs: STEP_TIMEOUT_MS,
      images: [cover.file_path],
    });
    if (result.kind !== "text") return;
    const review = extractJson<ReviewScore>(result.text);
    if (!review) throw new Error("封面评审输出无法解析为 JSON");
    this.repo.createReview({
      stepId: step.id,
      artifactId: cover.id,
      providerId: step.provider_id!,
      target: "cover",
      scores: review.scores ?? {},
      total: review.total ?? 0,
      verdict: review.verdict ?? "revise",
      issues: review.issues ?? [],
      suggestions: review.suggestions ?? [],
    });
    this.emitEvent({
      type: "review",
      pipelineId: step.pipeline_id,
      stepId: step.id,
      data: this.repo.listReviewsByPipeline(step.pipeline_id),
    });
  }
}
