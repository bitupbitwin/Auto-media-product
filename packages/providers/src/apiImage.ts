import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { GenerateRequest, GenerateResult, ProviderRow, ProviderStatus } from "@amp/shared";
import type { Provider } from "@amp/core";
import { fetchWithTimeout, headers, trimSlash } from "./apiText.js";

/**
 * 出图 API 适配器：OpenAI 兼容的 /images/generations 端点。
 * 覆盖 gpt-image-1、火山方舟（即梦/Seedream，OpenAI 兼容）、SD 兼容网关。
 * config.mock = true 时本地生成纯色占位图（无需密钥，便于演示与测试）。
 */
export function createApiImageProvider(row: ProviderRow): Provider {
  const { baseUrl, apiKey, model, size = "1024x1024", n = 3, mock } = row.config;

  return {
    row,

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const outDir = req.outDir ?? process.cwd();
      fs.mkdirSync(outDir, { recursive: true });

      if (mock) return { kind: "images", files: await mockImages(outDir, Number(n) || 2) };

      if (!baseUrl || !model) throw new Error(`引擎 ${row.id} 缺少 baseUrl/model 配置`);
      const res = await fetchWithTimeout(`${trimSlash(baseUrl)}/images/generations`, req.timeoutMs, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model, prompt: req.prompt, size, n, response_format: "b64_json" }),
      });
      const data: any = await res.json();
      const items: any[] = data?.data ?? [];
      if (items.length === 0) throw new Error(`出图 API 未返回图片: ${JSON.stringify(data).slice(0, 400)}`);

      const files: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const file = path.join(outDir, `cover_${Date.now()}_${i + 1}.png`);
        if (items[i].b64_json) {
          fs.writeFileSync(file, Buffer.from(items[i].b64_json, "base64"));
        } else if (items[i].url) {
          const imgRes = await fetch(items[i].url, { signal: AbortSignal.timeout(60_000) });
          fs.writeFileSync(file, Buffer.from(await imgRes.arrayBuffer()));
        } else {
          continue;
        }
        files.push(file);
      }
      if (files.length === 0) throw new Error("出图 API 返回数据中没有可用的图片内容");
      return { kind: "images", files };
    },

    async healthCheck(): Promise<ProviderStatus> {
      if (mock) return { ok: true, detail: "演示模式（本地生成占位图）" };
      if (!baseUrl || !model) return { ok: false, detail: "缺少 baseUrl/model 配置" };
      if (!apiKey) return { ok: false, detail: "未配置 apiKey" };
      return { ok: true, detail: "配置完整（实际连通性以首次出图为准）" };
    },
  };
}

async function mockImages(outDir: string, count: number): Promise<string[]> {
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = Math.floor(Math.random() * 360);
    const file = path.join(outDir, `mock_cover_${Date.now()}_${i + 1}.png`);
    const [r, g, b] = hslToRgb(hue, 0.55, 0.6);
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r, g, b } } })
      .png()
      .toFile(file);
    files.push(file);
  }
  return files;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
