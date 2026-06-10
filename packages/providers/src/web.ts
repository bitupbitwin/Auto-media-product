import type { GenerateRequest, GenerateResult, ProviderRow, ProviderStatus } from "@amp/shared";
import type { Provider } from "@amp/core";

/**
 * Web 网页端适配器占位（M4 实现）：
 * 规划为 Playwright persistent context 驱动 ChatGPT 等网页端，
 * 登录态保存在本地 profile，Site Driver 以配置描述选择器。
 */
export function createWebProvider(row: ProviderRow): Provider {
  return {
    row,
    async generate(_req: GenerateRequest): Promise<GenerateResult> {
      throw new Error("网页端引擎将在 M4 里程碑实现，请暂时使用 CLI 或 API 引擎");
    },
    async healthCheck(): Promise<ProviderStatus> {
      return { ok: false, detail: "M4 里程碑实现（Playwright 驱动网页端）" };
    },
  };
}
