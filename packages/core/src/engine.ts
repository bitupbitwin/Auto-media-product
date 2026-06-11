import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractJson, renderTemplate } from "@amp/shared";
import type { EngineEvent, PipelineStatus, ReviewScore } from "@amp/shared";
import { ruleCheck } from "@amp/review";
import { writeJianyingDraft } from "@amp/jianying";
import type { Repo, StepRow } from "./db.js";
import type { ProviderRegistry } from "./registry.js";
import type { TemplateStore } from "./templates.js";

const STEP_TIMEOUT_MS = 10 * 60 * 1000;

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
    return { brief: project.brief, steps, platform: pipeline.platform, mode: pipeline.mode };
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
      if (!step.provider_id) throw new Error("该步骤未绑定引擎，请在步骤卡片上选择引擎");
      const provider = this.registry.get(step.provider_id);

      const template = this.templates.readPrompt(step.prompt_template);
      let prompt = renderTemplate(template, this.buildVars(step));
      const feedback = this.feedback.get(stepId);
      if (feedback) {
        this.feedback.delete(stepId);
        prompt += `\n\n## 评审修改意见（这是重新生成，请务必针对以下意见改进）\n${feedback}`;
      }
      this.repo.setStepPrompt(stepId, prompt);

      this.repo.setStepStatus(stepId, "running", { started: true, error: null });
      this.emitEvent({ type: "step-status", pipelineId, stepId, data: { status: "running" } });

      const release = await this.registry.semaphore(provider.row).acquire();
      let result;
      const version = this.repo.nextArtifactVersion(stepId);
      const outDir = this.stepDir(step, version);
      try {
        result = await provider.generate(
          { taskId: String(stepId), stepType: step.type, prompt, timeoutMs: STEP_TIMEOUT_MS, outDir },
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

    // content / video：单产物，自动选中（selectArtifact 会清掉旧版本的选中态）
    const artifact = this.repo.createArtifact({ stepId: step.id, version, kind: "text", content: text });
    this.repo.selectArtifact(artifact.id);
    this.emitEvent({ type: "artifact", pipelineId, stepId: step.id, data: artifact });

    if (step.type === "video" && step.post === "jianying-draft") {
      const pipeline = this.repo.getPipeline(pipelineId)!;
      const draft = writeJianyingDraft(text, outDir, { name: `${pipeline.name}-p${pipelineId}` });
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
