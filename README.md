# 自媒体内容工作台（Auto Media Product）

多平台自媒体内容生产工作台：覆盖**小红书（图文/视频）、抖音（视频/长文/图集）、微信公众号（文章）、微信视频号（视频）** 7 条制作流程。每个步骤（标题/内容/封面/分镜/评审）可独立绑定 AI CLI 或 API 引擎，DAG 自动并行执行，内置评审评分与发布注意事项清单。

详细设计见 [docs/开发说明书.md](docs/开发说明书.md)。

## 快速开始

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

## 首次使用

1. 默认内置 **演示引擎（Mock）**，无需任何配置即可完整跑通全部流程（生成的是演示内容/占位图）。
2. 在「引擎管理」页配置真实引擎：
   - **CLI**：如 Claude Code（`claude -p {PROMPT} --output-format text`）、Gemini CLI，或任意自定义命令；占位符支持 `{PROMPT}` `{PROMPT_FILE}` `{OUTPUT_FILE}`
   - **出图 API**：即梦/Seedream（火山方舟，OpenAI 兼容端点）或 OpenAI gpt-image-1，填入 apiKey 后启用
   - **文本 API**：任意 OpenAI 兼容端点（推荐绑定到评审步骤，避免"自己评自己"）
3. 新建选题 → 勾选目标平台流程（可多选）→ 运行：
   - 标题生成 5 个候选后**暂停等你挑选**，确认后内容与封面**并行生成**
   - 封面自动派生平台尺寸（9:16 / 3:4 / 2.35:1 / 1:1 / 6:7）
   - 视频流程产出**剪映草稿目录 + 分镜表 CSV**（使用方法见草稿目录内 README.txt）
   - 评审步骤输出多维评分 + 修改建议，并叠加极限词规则预检

## 目录结构

```
apps/server      Fastify 本地服务（REST + WebSocket）
apps/web         React 前端
packages/shared  类型定义 / 模板渲染 / JSON 提取
packages/core    SQLite 数据层 + DAG 编排引擎 + 引擎注册表
packages/providers  CLI / 文本API / 出图API / 网页端(M4) 适配器
packages/review  评分解析 + 极限词词库
packages/jianying   分镜 → 剪映草稿 + CSV 降级方案
pipelines/       7 条平台流程定义（JSON，可改）
prompts/         全套 Prompt 模板（可在 UI 中覆盖）
workspace/       运行期产物（gitignore）
data/            SQLite 数据库（gitignore）
```

## 路线图

- [x] M0 工程骨架 / M1 CLI + 出图 API 链路 / M2 DAG 并行编排与人工卡点
- [x] M3 剪映草稿（最小结构 + CSV 降级）
- [x] M5 评审评分（文本部分）+ 规则预检 + 注意事项清单
- [ ] M4 网页端适配器（Playwright 驱动 ChatGPT 等，登录态持久化）
- [ ] 封面多模态评审、导出打包、Electron 桌面壳与安装器
