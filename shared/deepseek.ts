// Official API catalog: https://api-docs.deepseek.com/updates/ (2026-09-10).
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];
export const DEEPSEEK_MODEL_LABELS: Record<string, string> = {
  "deepseek-flash": "DeepSeek V4.1 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};
export function currentDeepSeekModel(model: string): string {
  return ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(model) ? "deepseek-flash" : model;
}
