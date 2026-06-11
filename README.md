# 自媒体内容工作台（Auto Media Product）

多平台自媒体内容生产工作台：覆盖**小红书（图文/视频）、抖音（视频/长文/图集）、微信公众号（文章）、微信视频号（视频）、哔哩哔哩（短视频/长视频/图文）** 10 条制作流程。每个步骤（标题/内容/封面/分镜/评审）可独立绑定 AI CLI 或 API 引擎，DAG 自动并行执行，内置评审评分与发布注意事项清单。

- 架构总览（含架构图/流程图/时序图/ER 图）：[docs/架构说明.md](docs/架构说明.md)
- 详细设计与决策记录：[docs/开发说明书.md](docs/开发说明书.md)

## 快速开始

> 要求 Node.js ≥ 22.5（数据库使用内置 node:sqlite，无任何需编译的原生依赖）

```bash
pnpm install
pnpm dev          # 同时启动后端(8787)与前端(5173)
# 浏览器打开 http://localhost:5173
```

生产模式（前端构建后由后端直接托管）：

```bash
pnpm build
pnpm start        # 打开 http://127.0.0.1:8787
```

桌面应用（Electron）：

```bash
pnpm build                            # 先构建前端
pnpm --filter @amp/desktop dev        # 打开桌面窗口（开发模式）
pnpm --filter @amp/desktop dist       # 打包安装器（Windows NSIS / macOS dmg，在对应系统上执行）
```

打包形态下数据存放在系统用户目录（Windows: `%APPDATA%/自媒体内容工作台`），模板等只读资源随安装包分发。

## 首次使用

1. 默认内置 **演示引擎（Mock）**，无需任何配置即可完整跑通全部流程（生成的是演示内容/占位图）。
2. 在「引擎管理」页配置真实引擎：
   - **CLI**：如 Claude Code（`claude -p {PROMPT} --output-format text`）、Gemini CLI，或任意自定义命令；占位符支持 `{PROMPT}` `{PROMPT_FILE}` `{OUTPUT_FILE}`
   - **出图 API**：即梦/Seedream（火山方舟，OpenAI 兼容端点）或 OpenAI gpt-image-1，填入 apiKey 后启用
   - **文本 API**：任意 OpenAI 兼容端点（推荐绑定到评审步骤，避免"自己评自己"）；配置 `"vision": true` 后评审步骤会自动把封面图发给模型做**多模态封面评审**
   - **网页端（ChatGPT 等）**：先运行 `npx playwright install chromium` 安装浏览器，然后在引擎管理页点「打开登录窗口」手动登录一次（登录态保存在本地），启用该引擎后即可在任意步骤下拉选择；站点改版导致取词失败时，可在配置 JSON 的 `selectors` 中更新选择器
3. 新建选题 → 勾选目标平台流程（可多选）→ 运行：
   - 标题生成 5 个候选后**暂停等你挑选**，确认后内容与封面**并行生成**
   - 封面自动派生平台尺寸（9:16 / 3:4 / 2.35:1 / 1:1 / 6:7）
   - 视频流程产出**剪映草稿目录 + 分镜表 CSV**（使用方法见草稿目录内 README.txt）
   - 评审步骤输出多维评分 + 修改建议，并叠加极限词规则预检；点「按建议重新生成」会把评审意见自动注入提示词重跑
   - 流程页右上角「📦 导出产物包」一键下载 ZIP（标题/内容/多尺寸封面/剪映草稿/评审报告/注意事项清单）
   - 顶栏「模板管理」可直接编辑所有 Prompt 模板（保存即生效，可恢复默认）

## 目录结构

```
apps/server      Fastify 本地服务（REST + WebSocket）
apps/web         React 前端
packages/shared  类型定义 / 模板渲染 / JSON 提取
packages/core    SQLite 数据层 + DAG 编排引擎 + 引擎注册表
packages/providers  CLI / 文本API / 出图API / 网页端(M4) 适配器
packages/review  评分解析 + 极限词词库
packages/jianying   分镜 → 剪映草稿 + CSV 降级方案
pipelines/       10 条平台流程定义（JSON，可改）
prompts/         全套 Prompt 模板（可在 UI 中覆盖）
workspace/       运行期产物（gitignore）
data/            SQLite 数据库（gitignore）
```

## 路线图

- [x] M0 工程骨架 / M1 CLI + 出图 API 链路 / M2 DAG 并行编排与人工卡点
- [x] M3 剪映草稿（最小结构 + CSV 降级）
- [x] M4 网页端适配器（Playwright 持久化登录态，选择器配置化，ChatGPT 预设）
- [x] M5 评审评分（含封面多模态评审）+ 规则预检 + 按建议重生成 + 注意事项清单
- [x] 导出打包（ZIP）、Prompt 模板管理 UI
- [x] M6 Electron 桌面壳 + electron-builder 安装器配置、网页端站点预设（ChatGPT/Claude/Kimi/豆包）
- [x] 数据库迁移至 Node 内置 node:sqlite（消除全部原生编译依赖）
