import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { PipelineEngine, ProviderRegistry, Repo, TemplateStore } from "@amp/core";
import type { Brief, EngineEvent, ProviderRow } from "@amp/shared";

interface Ctx {
  repo: Repo;
  engine: PipelineEngine;
  registry: ProviderRegistry;
  templates: TemplateStore;
  workspaceDir: string;
}

export async function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  const { repo, engine, registry, templates } = ctx;

  // ---------- WebSocket：引擎事件实时推送 ----------
  const sockets = new Set<any>();
  engine.on("event", (event: EngineEvent) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        sockets.delete(socket);
      }
    }
  });
  app.get("/api/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  // ---------- 流程模板 ----------
  app.get("/api/templates", async () => templates.listPipelineTemplates());

  // ---------- 项目 ----------
  app.get("/api/projects", async () => repo.listProjects());

  app.post<{ Body: { title: string; brief: Brief } }>("/api/projects", async (req, reply) => {
    const { title, brief } = req.body;
    if (!title?.trim() || !brief?.topic?.trim()) {
      return reply.code(400).send({ error: "title 与 brief.topic 必填" });
    }
    return repo.createProject(title.trim(), brief);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = repo.getProject(Number(req.params.id));
    if (!project) return reply.code(404).send({ error: "项目不存在" });
    return { ...project, pipelines: repo.listPipelinesByProject(project.id) };
  });

  // ---------- 流水线 ----------
  app.post<{ Params: { id: string }; Body: { templateId: string; providerOverrides?: Record<string, string> } }>(
    "/api/projects/:id/pipelines",
    async (req, reply) => {
      const project = repo.getProject(Number(req.params.id));
      if (!project) return reply.code(404).send({ error: "项目不存在" });
      const template = templates.getPipelineTemplate(req.body.templateId);
      if (!template) return reply.code(400).send({ error: `流程模板 ${req.body.templateId} 不存在` });

      const pipeline = repo.createPipeline(project.id, template.id, template.platform, template.mode, template.name);
      const providers = repo.listProviders().filter((p) => p.enabled);
      for (const def of template.steps) {
        const override = req.body.providerOverrides?.[def.id];
        const providerId =
          override ??
          (def.defaultProvider && repo.getProvider(def.defaultProvider)?.enabled ? def.defaultProvider : undefined) ??
          pickProvider(def.type, providers);
        repo.createStep(pipeline.id, def, providerId ?? null);
      }
      return repo.getPipeline(pipeline.id);
    }
  );

  app.get<{ Params: { id: string } }>("/api/pipelines/:id", async (req, reply) => {
    const pipeline = repo.getPipeline(Number(req.params.id));
    if (!pipeline) return reply.code(404).send({ error: "流水线不存在" });
    const template = templates.getPipelineTemplate(pipeline.template_id);
    const steps = repo.listStepsByPipeline(pipeline.id).map((s) => ({
      ...s,
      artifacts: repo.listArtifactsByStep(s.id),
    }));
    return { ...pipeline, steps, reviews: repo.listReviewsByPipeline(pipeline.id), notes: template?.notes ?? [] };
  });

  app.post<{ Params: { id: string } }>("/api/pipelines/:id/run", async (req, reply) => {
    const pipeline = repo.getPipeline(Number(req.params.id));
    if (!pipeline) return reply.code(404).send({ error: "流水线不存在" });
    engine.kick(pipeline.id);
    return { ok: true };
  });

  // ---------- 步骤 ----------
  app.post<{ Params: { id: string } }>("/api/steps/:id/rerun", async (req, reply) => {
    try {
      engine.rerunStep(Number(req.params.id));
      return { ok: true };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post<{ Params: { id: string }; Body: { providerId: string } }>("/api/steps/:id/provider", async (req, reply) => {
    const step = repo.getStep(Number(req.params.id));
    if (!step) return reply.code(404).send({ error: "步骤不存在" });
    if (!repo.getProvider(req.body.providerId)) return reply.code(400).send({ error: "引擎不存在" });
    repo.setStepProvider(step.id, req.body.providerId);
    return repo.getStep(step.id);
  });

  app.post<{ Params: { id: string } }>("/api/steps/:id/confirm", async (req, reply) => {
    try {
      engine.confirmHumanGate(Number(req.params.id));
      return { ok: true };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ---------- 产物 ----------
  app.post<{ Params: { id: string } }>("/api/artifacts/:id/select", async (req, reply) => {
    try {
      return repo.selectArtifact(Number(req.params.id));
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/artifacts/:id/file", async (req, reply) => {
    const artifact = repo.getArtifact(Number(req.params.id));
    if (!artifact?.file_path || !fs.existsSync(artifact.file_path)) {
      return reply.code(404).send({ error: "文件不存在" });
    }
    const resolved = path.resolve(artifact.file_path);
    if (!resolved.startsWith(path.resolve(ctx.workspaceDir))) {
      return reply.code(403).send({ error: "禁止访问工作目录之外的文件" });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
    reply.header("Content-Type", mime);
    return reply.send(fs.createReadStream(resolved));
  });

  // ---------- 引擎管理 ----------
  app.get("/api/providers", async () => repo.listProviders());

  app.put<{ Params: { id: string }; Body: ProviderRow }>("/api/providers/:id", async (req, reply) => {
    const body = req.body;
    if (!body.kind || !body.name) return reply.code(400).send({ error: "kind/name 必填" });
    repo.upsertProvider({ ...body, id: req.params.id });
    return repo.getProvider(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/providers/:id", async (req) => {
    repo.deleteProvider(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/providers/:id/health", async (req, reply) => {
    const row = repo.getProvider(req.params.id);
    if (!row) return reply.code(404).send({ error: "引擎不存在" });
    const factory = (await import("@amp/providers")).providerFactories[row.kind];
    if (!factory) return { ok: false, detail: `不支持的类型 ${row.kind}` };
    try {
      return await factory(row).healthCheck();
    } catch (err: any) {
      return { ok: false, detail: err.message };
    }
  });

  // ---------- Prompt 模板 ----------
  app.get("/api/prompts", async () => {
    return templates.listPromptPaths().map((p) => ({ path: p, overridden: repo.getPromptOverride(p) != null }));
  });

  app.get<{ Querystring: { path: string } }>("/api/prompts/content", async (req, reply) => {
    try {
      return { path: req.query.path, content: templates.readPrompt(req.query.path) };
    } catch (err: any) {
      return reply.code(404).send({ error: err.message });
    }
  });

  app.put<{ Body: { path: string; content: string } }>("/api/prompts/content", async (req) => {
    repo.setPromptOverride(req.body.path, req.body.content);
    return { ok: true };
  });

  app.delete<{ Querystring: { path: string } }>("/api/prompts/content", async (req) => {
    repo.deletePromptOverride(req.query.path);
    return { ok: true };
  });
}

/** 按步骤类型挑选默认引擎：封面→出图类，其余→文本类（cli 优先） */
function pickProvider(stepType: string, enabled: ProviderRow[]): string | undefined {
  if (stepType === "cover") return enabled.find((p) => p.kind === "api-image")?.id;
  const text = enabled.filter((p) => p.kind === "cli" || p.kind === "api-text");
  return (text.find((p) => p.kind === "cli") ?? text[0])?.id;
}
