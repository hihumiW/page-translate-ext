import { browser } from "wxt/browser";

export interface LLMConfig {
  baseUrl: string;
  apiToken: string;
  modelName: string;
  targetLang: string;
}

export const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiToken: "",
  modelName: "gpt-4o-mini",
  targetLang: "中文",
};

const CONFIG_STORAGE_KEY = "pageTranslate.llmConfig";
const CONTEXTS_STORAGE_KEY = "pageTranslate.pageContexts";

/**
 * 获取当前保存的 LLM 配置，若无则返回默认配置
 */
export async function getLLMConfig(): Promise<LLMConfig> {
  try {
    const stored = await browser.storage.local.get(CONFIG_STORAGE_KEY);
    const config = stored[CONFIG_STORAGE_KEY];
    return { ...DEFAULT_CONFIG, ...(config as Record<string, any> || {}) };
  } catch (error) {
    console.error("Failed to load LLM config:", error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 保存或合并 LLM 配置到本地存储
 */
export async function saveLLMConfig(config: Partial<LLMConfig>): Promise<void> {
  try {
    const current = await getLLMConfig();
    await browser.storage.local.set({
      [CONFIG_STORAGE_KEY]: { ...current, ...config },
    });
  } catch (error) {
    console.error("Failed to save LLM config:", error);
    throw error;
  }
}

/**
 * 获取指定域名 (host) 关联的页面翻译上下文
 */
export async function getPageContext(host: string): Promise<string> {
  if (!host) return "";
  try {
    const stored = await browser.storage.local.get(CONTEXTS_STORAGE_KEY);
    const contexts = (stored[CONTEXTS_STORAGE_KEY] as Record<string, string>) || {};
    return contexts[host] || "";
  } catch (error) {
    console.error(`Failed to load page context for host ${host}:`, error);
    return "";
  }
}

/**
 * 保存或清除指定域名 (host) 关联的页面翻译上下文
 * - 若内容非空：写入缓存
 * - 若内容为空：删除该域名对应的缓存项，避免存储空数据
 */
export async function savePageContext(host: string, context: string): Promise<void> {
  if (!host) return;
  try {
    const stored = await browser.storage.local.get(CONTEXTS_STORAGE_KEY);
    const contexts = (stored[CONTEXTS_STORAGE_KEY] as Record<string, string>) || {};
    
    const trimmedContext = context.trim();
    if (trimmedContext !== "") {
      contexts[host] = trimmedContext;
    } else {
      delete contexts[host];
    }

    await browser.storage.local.set({
      [CONTEXTS_STORAGE_KEY]: contexts,
    });
  } catch (error) {
    console.error(`Failed to save page context for host ${host}:`, error);
    throw error;
  }
}
