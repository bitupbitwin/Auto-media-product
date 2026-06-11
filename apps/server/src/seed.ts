import path from "node:path";
import type { Repo } from "@amp/core";

/** 首次启动时写入默认引擎配置（已有数据则跳过） */
export function seedProviders(repo: Repo, rootDir: string) {
  if (repo.listProviders().length > 0) return;

  const mockScript = path.join(rootDir, "scripts", "mock-llm.mjs");

  repo.upsertProvider({
    id: "cli-mock",
    kind: "cli",
    name: "演示文本引擎（本地 Mock，无需配置）",
    config: {
      command: `node "${mockScript}" {PROMPT_FILE}`,
      healthCommand: "node --version",
    },
    maxConcurrency: 4,
    enabled: true,
  });

  repo.upsertProvider({
    id: "img-mock",
    kind: "api-image",
    name: "演示出图引擎（本地占位图，无需配置）",
    config: { mock: true, n: 2 },
    maxConcurrency: 2,
    enabled: true,
  });

  repo.upsertProvider({
    id: "cli-claude",
    kind: "cli",
    name: "Claude Code CLI",
    config: {
      command: "claude -p {PROMPT} --output-format text",
      healthCommand: "claude --version",
    },
    maxConcurrency: 2,
    enabled: true,
  });

  repo.upsertProvider({
    id: "cli-gemini",
    kind: "cli",
    name: "Gemini CLI",
    config: { command: "gemini -p {PROMPT}", healthCommand: "gemini --version" },
    maxConcurrency: 2,
    enabled: false,
  });

  repo.upsertProvider({
    id: "api-jimeng",
    kind: "api-image",
    name: "即梦/Seedream（火山方舟，填入 apiKey 后启用）",
    config: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seedream-4-0-250828",
      apiKey: "",
      size: "1024x1024",
      n: 2,
    },
    maxConcurrency: 2,
    enabled: false,
  });

  repo.upsertProvider({
    id: "api-gpt-image",
    kind: "api-image",
    name: "OpenAI gpt-image-1（填入 apiKey 后启用）",
    config: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", apiKey: "", size: "1024x1024", n: 2 },
    maxConcurrency: 2,
    enabled: false,
  });

  repo.upsertProvider({
    id: "api-text-openai",
    kind: "api-text",
    name: "OpenAI 兼容文本 API（填入 apiKey 后启用，推荐用于评审）",
    config: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" },
    maxConcurrency: 4,
    enabled: false,
  });

  repo.upsertProvider({
    id: "web-chatgpt",
    kind: "web",
    name: "ChatGPT 网页端（需安装 Playwright 并登录）",
    config: {
      url: "https://chatgpt.com",
      profileDir: path.join(rootDir, "data", "browser-profiles", "web-chatgpt"),
    },
    maxConcurrency: 1,
    enabled: false,
  });

  // 以下站点预设的 selectors 为参考值，站点改版后请在引擎配置中校准
  repo.upsertProvider({
    id: "web-claude",
    kind: "web",
    name: "Claude 网页端（选择器或需校准）",
    config: {
      url: "https://claude.ai/new",
      profileDir: path.join(rootDir, "data", "browser-profiles", "web-claude"),
      selectors: {
        input: 'div[contenteditable="true"]',
        send: 'button[aria-label="Send message"]',
        assistantMessage: "div.font-claude-message",
        busy: 'button[aria-label="Stop response"]',
      },
    },
    maxConcurrency: 1,
    enabled: false,
  });

  repo.upsertProvider({
    id: "web-kimi",
    kind: "web",
    name: "Kimi 网页端（选择器或需校准）",
    config: {
      url: "https://www.kimi.com",
      profileDir: path.join(rootDir, "data", "browser-profiles", "web-kimi"),
      selectors: {
        input: 'div[contenteditable="true"]',
        send: 'button[type="submit"]',
        assistantMessage: 'div[data-role="assistant"], .chat-content-item-assistant',
        busy: ".stop-button, button[aria-label*='停止']",
      },
    },
    maxConcurrency: 1,
    enabled: false,
  });

  repo.upsertProvider({
    id: "web-doubao",
    kind: "web",
    name: "豆包网页端（选择器或需校准）",
    config: {
      url: "https://www.doubao.com/chat/",
      profileDir: path.join(rootDir, "data", "browser-profiles", "web-doubao"),
      selectors: {
        input: "textarea, div[contenteditable='true']",
        send: "button#flow-end-msg-send, button[aria-label*='发送']",
        assistantMessage: "div[data-testid='receive_message'], .message-content",
        busy: "button[aria-label*='停止'], .stop-generating",
      },
    },
    maxConcurrency: 1,
    enabled: false,
  });
}
