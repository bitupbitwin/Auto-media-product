export type Platform = "douyin" | "xiaohongshu" | "wechat-mp" | "wechat-channels" | "bilibili" | "csdn" | "mv";

export type StepType =
  | "title"
  | "content"
  | "cover"
  | "video"
  | "review"
  | "lyrics"
  | "image-prompts"
  | "video-prompts"
  | "subtitle"
  | "docx";

export type ProviderKind = "cli" | "api-text" | "api-image" | "web";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_human"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PipelineStatus = "pending" | "running" | "waiting_human" | "succeeded" | "failed";

export interface Brief {
  topic: string;
  audience?: string;
  sellingPoints?: string;
  references?: string;
  /** 我的具体要求：希望生成成什么样、风格、必须包含/避免的内容等 */
  requirements?: string;
  extra?: string;
}

export type MaterialKind = "text" | "image" | "video" | "file";

export interface MaterialRow {
  id: number;
  project_id: number;
  kind: MaterialKind;
  original_name: string | null;
  file_path: string | null;
  /** 文本素材（粘贴/抽取）的内容 */
  content: string | null;
  /** 用户对该素材的说明 */
  note: string | null;
  created_at: string;
}

export interface CoverSize {
  w: number;
  h: number;
  label: string;
}

export interface StepDef {
  id: string;
  name: string;
  type: StepType;
  needs: string[];
  promptTemplate: string;
  humanGate?: boolean;
  defaultProvider?: string;
  coverSizes?: CoverSize[];
  /** 不同画面比例下的封面尺寸（按 options.aspect 选取，覆盖 coverSizes） */
  coverSizesByAspect?: Record<string, CoverSize[]>;
  post?: "jianying-draft";
  /** 条件步骤：仅当所有指定的运行选项都匹配时才创建该步骤（如 { visualMode: "images" }） */
  when?: Record<string, string>;
}

export interface PipelineOptionChoice {
  value: string;
  label: string;
}

/** 流程的可选参数（在创建流程时由用户在界面上点选） */
export interface PipelineOption {
  id: string;
  label: string;
  choices: PipelineOptionChoice[];
  default: string;
}

export interface PipelineTemplate {
  id: string;
  platform: Platform;
  mode: string;
  name: string;
  steps: StepDef[];
  notes: string[];
  options?: PipelineOption[];
}

export interface ProviderRow {
  id: string;
  kind: ProviderKind;
  name: string;
  config: Record<string, any>;
  maxConcurrency: number;
  enabled: boolean;
}

export interface GenerateRequest {
  taskId: string;
  stepType: StepType;
  prompt: string;
  timeoutMs: number;
  /** 图片类产物输出目录 */
  outDir?: string;
  /** 多模态输入图片（本地文件路径），用于封面评审等场景 */
  images?: string[];
  /** 封面叠字模式：要叠加到底图上的标题文字（出图引擎 config.overlayText=true 时生效） */
  overlayText?: string;
}

export interface TextResult {
  kind: "text";
  text: string;
}

export interface ImageResult {
  kind: "images";
  files: string[];
}

export type GenerateResult = TextResult | ImageResult;

export interface ProviderStatus {
  ok: boolean;
  detail: string;
}

export interface EngineEvent {
  type: "pipeline-status" | "step-status" | "step-stream" | "artifact" | "review";
  pipelineId: number;
  stepId?: number;
  data: any;
}

export interface ReviewScore {
  target: "title" | "content" | "cover";
  scores: Record<string, number>;
  total: number;
  verdict: "pass" | "revise" | "reject";
  issues: string[];
  suggestions: string[];
}
