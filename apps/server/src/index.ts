import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { PipelineEngine, ProviderRegistry, Repo, TemplateStore } from "@amp/core";
import { providerFactories } from "@amp/providers";
import { findRepoRoot } from "./root.js";
import { seedProviders } from "./seed.js";
import { registerRoutes } from "./routes.js";

const root = findRepoRoot();
const dataDir = path.join(root, "data");
const workspaceDir = path.join(root, "workspace");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });

const repo = new Repo(path.join(dataDir, "amp.db"));
seedProviders(repo, root);

const templates = new TemplateStore(root, repo);
const registry = new ProviderRegistry(repo, providerFactories);
const engine = new PipelineEngine(repo, registry, templates, workspaceDir);

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

const webDist = path.join(root, "apps", "web", "dist");
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

await registerRoutes(app, { repo, engine, registry, templates, workspaceDir });

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: "127.0.0.1" });
console.log(`\n  自媒体内容工作台已启动: http://127.0.0.1:${port}\n`);
