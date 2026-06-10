import fs from "node:fs";
import path from "node:path";
import type { PipelineTemplate } from "@amp/shared";
import type { Repo } from "./db.js";

export class TemplateStore {
  constructor(
    private rootDir: string,
    private repo: Repo
  ) {}

  get pipelinesDir() {
    return path.join(this.rootDir, "pipelines");
  }

  get promptsDir() {
    return path.join(this.rootDir, "prompts");
  }

  listPipelineTemplates(): PipelineTemplate[] {
    if (!fs.existsSync(this.pipelinesDir)) return [];
    return fs
      .readdirSync(this.pipelinesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.pipelinesDir, f), "utf-8")) as PipelineTemplate)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getPipelineTemplate(id: string): PipelineTemplate | undefined {
    return this.listPipelineTemplates().find((t) => t.id === id);
  }

  /** 读取 Prompt 模板：用户覆盖优先，其次内置文件 */
  readPrompt(relPath: string): string {
    const safe = relPath.replace(/\\/g, "/");
    if (safe.includes("..")) throw new Error("非法模板路径");
    const override = this.repo.getPromptOverride(safe);
    if (override != null) return override;
    const full = path.join(this.promptsDir, safe);
    if (!fs.existsSync(full)) throw new Error(`Prompt 模板不存在: ${safe}`);
    return fs.readFileSync(full, "utf-8");
  }

  listPromptPaths(): string[] {
    const result: string[] = [];
    const walk = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith(".md")) result.push(`${prefix}${entry.name}`);
      }
    };
    walk(this.promptsDir, "");
    return result.sort();
  }
}
