// 用真实 MV 数据渲染「流程工作台」预览图（SVG→PNG via sharp）
import fs from "node:fs";
import sharp from "../node_modules/.pnpm/node_modules/sharp/lib/index.js";

const d = JSON.parse(fs.readFileSync("/tmp/mv-data.json", "utf-8"));
const C = { bg: "#11141a", panel: "#1a1f29", panel2: "#222837", border: "#2e3648", text: "#e6e9f0", muted: "#8b93a7", accent: "#4f8cff", green: "#3ecf8e", yellow: "#f5b73d" };
const W = 1380;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s, n) => { s = String(s ?? "").replace(/\n/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const step = (id) => d.steps.find((s) => s.def_id === id);

const rows = [];
const push = (s) => rows.push(s);
let y = 0;

// 顶栏
push(`<rect x="0" y="0" width="${W}" height="52" fill="${C.panel}"/><line x1="0" y1="52" x2="${W}" y2="52" stroke="${C.border}"/>`);
push(`<text x="24" y="33" font-size="17" font-weight="700" fill="${C.text}">📦 自媒体内容工作台</text>`);
["项目","引擎管理","模板管理"].forEach((t,i)=>push(`<text x="${280+i*78}" y="33" font-size="14" fill="${C.muted}">${t}</text>`));
y = 52;

// 标题栏
y += 30;
push(`<text x="24" y="${y}" font-size="20" font-weight="700" fill="${C.text}">MV · 歌词可视化</text>`);
push(`<rect x="240" y="${y-18}" width="60" height="24" rx="12" fill="rgba(62,207,142,.15)"/><text x="270" y="${y-1}" font-size="13" fill="${C.green}" text-anchor="middle">已完成</text>`);
// 选项标签（真实选项）
const opts = d.options || {};
push(`<text x="320" y="${y}" font-size="12.5" fill="${C.muted}">生成形式: <tspan fill="${C.accent}">纯图片</tspan>  ·  画面比例: <tspan fill="${C.accent}">9:16 竖版</tspan>  ·  图片出图: <tspan fill="${C.accent}">真实出图</tspan></text>`);
push(`<rect x="${W-360}" y="${y-19}" width="110" height="28" rx="6" fill="${C.panel2}" stroke="${C.border}"/><text x="${W-305}" y="${y}" font-size="13" fill="${C.text}" text-anchor="middle">📦 导出产物包</text>`);
push(`<rect x="${W-100}" y="${y-19}" width="76" height="28" rx="6" fill="${C.accent}"/><text x="${W-62}" y="${y}" font-size="13" fill="#fff" text-anchor="middle">⚡ 全自动</text>`);
y += 22;

const card = (h) => push(`<rect x="24" y="${y}" width="${W-48}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.border}"/>`);
const header = (title, provider) => {
  push(`<text x="44" y="${y+27}" font-size="15" font-weight="600" fill="${C.text}">${esc(title)}</text>`);
  push(`<rect x="${44+title.length*15+14}" y="${y+12}" width="60" height="22" rx="11" fill="rgba(62,207,142,.15)"/><text x="${44+title.length*15+44}" y="${y+27}" font-size="12" fill="${C.green}" text-anchor="middle">已完成</text>`);
  push(`<rect x="${W-300}" y="${y+11}" width="230" height="26" rx="6" fill="${C.panel2}" stroke="${C.border}"/><text x="${W-288}" y="${y+28}" font-size="12" fill="${C.muted}">${esc(provider)}</text><text x="${W-86}" y="${y+28}" font-size="11" fill="${C.muted}">▼</text>`);
};

// 步骤1：歌词
const lyr = (step("lyrics").artifacts.find(a=>a.selected)?.content||"").split("\n").filter(Boolean).slice(0,7);
const h1 = 50 + lyr.length*18 + 8;
card(h1); header("歌词与歌名生成", "Claude Code CLI");
let ly = y+50;
lyr.forEach(l=>{ const isT=/标题《/.test(l); const isTag=/^【/.test(l); push(`<text x="44" y="${ly}" font-size="${isT?14:12.5}" font-weight="${isT?'700':'400'}" fill="${isT?C.accent:isTag?C.yellow:'#c8cedb'}">${esc(clip(l,70))}</text>`); ly+=18; });
y += h1 + 12;

// 步骤2：图片提示词
const ipText = (step("image-prompts").artifacts.find(a=>a.selected)?.content||"").split("\n").filter(Boolean).slice(0,4);
const h2 = 50 + ipText.length*17 + 10;
card(h2); header("图片提示词（全曲分段）", "Claude Code CLI");
push(`<rect x="44" y="${y+44}" width="${W-92}" height="${h2-54}" rx="8" fill="#0d1016"/>`);
let iy = y+62;
ipText.forEach(l=>{ const isH=/^【画面/.test(l); push(`<text x="56" y="${iy}" font-size="11.5" font-family="monospace" fill="${isH?C.yellow:'#9fe8c1'}">${esc(clip(l,118))}</text>`); iy+=17; });
y += h2 + 12;

// 步骤3：批量出图（带重抽/替换按钮）
const imgs = step("batch-images").artifacts.filter(a=>a.kind==="image");
const h3 = 200;
card(h3); header("批量出图（按提示词逐张生成）", "MV 批量出图（即梦）");
push(`<text x="44" y="${y+50}" font-size="12" fill="${C.muted}">产物（共 ${imgs.length} 张 · 原生 1080×1920 · 可对单张重抽/替换）：</text>`);
const tw=96, th=110;
for (let i=0;i<Math.min(imgs.length,8);i++){
  const x = 44 + i*(tw+14);
  const src = "data:image/png;base64,"+fs.readFileSync(imgs[i].file_path).toString("base64");
  push(`<clipPath id="ic${i}"><rect x="${x}" y="${y+60}" width="${tw}" height="${th}" rx="6"/></clipPath>`);
  push(`<image x="${x}" y="${y+60}" width="${tw}" height="${th}" href="${src}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ic${i})"/>`);
  push(`<rect x="${x}" y="${y+60}" width="${tw}" height="${th}" rx="6" fill="none" stroke="${C.border}"/>`);
  push(`<text x="${x+4}" y="${y+74}" font-size="10" fill="#fff" style="paint-order:stroke;stroke:#000;stroke-width:2px">画面 ${i+1}</text>`);
  // 重抽/替换按钮
  push(`<rect x="${x}" y="${y+60+th+5}" width="46" height="18" rx="4" fill="${C.panel2}" stroke="${C.border}"/><text x="${x+23}" y="${y+60+th+18}" font-size="10" fill="${C.text}" text-anchor="middle">🎲重抽</text>`);
  push(`<rect x="${x+50}" y="${y+60+th+5}" width="46" height="18" rx="4" fill="${C.panel2}" stroke="${C.border}"/><text x="${x+73}" y="${y+60+th+18}" font-size="10" fill="${C.text}" text-anchor="middle">⬆替换</text>`);
}
y += h3 + 12;

// 步骤4+5：字幕 + 封面（并排紧凑）
const h4 = 92;
card(h4); header("SRT 字幕 + 封面图", "Claude / 即梦");
push(`<text x="44" y="${y+52}" font-size="12" fill="${C.muted}">📄 字幕.srt 已生成　|　🖼 封面 9:16 已生成　|　📦 提示词文档.docx 已打包</text>`);
const cov = step("cover").artifacts.find(a=>a.label==="原图");
if (cov) { const csrc="data:image/png;base64,"+fs.readFileSync(cov.file_path).toString("base64"); push(`<clipPath id="cov"><rect x="${W-120}" y="${y+12}" width="40" height="68" rx="4"/></clipPath><image x="${W-120}" y="${y+12}" width="40" height="68" href="${csrc}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cov)"/>`); }
y += h4 + 16;

const H = y;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="WenQuanYi Zen Hei, sans-serif"><rect width="${W}" height="${H}" fill="${C.bg}"/>${rows.join("\n")}</svg>`;
await sharp(Buffer.from(svg)).png().toFile("/home/user/Auto-media-product/mv-preview.png");
console.log("生成完成:", H, "px");
