import { browser } from "wxt/browser";
import { getLLMConfig, getPageContext } from "@/utils/storage/config";

interface TestConnectionMessage {
  type: "PAGE_TRANSLATE_TEST_CONNECTION";
  config: {
    baseUrl: string;
    apiToken: string;
    modelName: string;
  };
}

interface TranslateBatchMessage {
  type: "PAGE_TRANSLATE_TRANSLATE_BATCH";
  xml: string;
  host: string;
}

export default defineBackground(() => {
  console.info("Page Translate Compare background is ready.");

  // 点击插件 action 图标，向当前 active tab 发送 toggle 浮窗消息
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    await browser.tabs
      .sendMessage(tab.id, { type: "PAGE_TRANSLATE_TOGGLE_FLOATING_POPUP" })
      .catch((error) => {
        console.warn("Unable to toggle floating popup on this tab.", error);
      });
  });

  // 监听来自 content script 的各种消息（如连通性测试、并发翻译）
  browser.runtime.onMessage.addListener(
    (message, sender, sendResponse): any => {
      const typedMessage = message as Record<string, any>;

      // 连通性测试消息
      if (
        typedMessage?.type === "PAGE_TRANSLATE_TEST_CONNECTION" &&
        typedMessage.config
      ) {
        handleTestConnection(typedMessage.config)
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({
              success: false,
              error: err.message || String(err),
            }),
          );
        return true; // 保持通道处于打开状态以支持异步响应
      }

      // 分批翻译消息
      if (
        typedMessage?.type === "PAGE_TRANSLATE_TRANSLATE_BATCH" &&
        typedMessage.xml !== undefined
      ) {
        handleTranslateBatch(typedMessage.xml, typedMessage.host || "")
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({
              success: false,
              error: err.message || String(err),
            }),
          );
        return true; // 保持通道处于打开状态以支持异步响应
      }
    },
  );
});

/**
 * 智能解析与清洗 Base URL 格式，以确保其能正确拼接 OpenAI 兼容接口路径
 */
function cleanBaseUrl(url: string): string {
  let cleaned = url.trim();

  // 移除末尾的反斜杠
  cleaned = cleaned.replace(/\/+$/, "");

  // 智能剥离 /chat/completions 路径
  if (cleaned.endsWith("/chat/completions")) {
    cleaned = cleaned.substring(0, cleaned.length - "/chat/completions".length);
  }
  cleaned = cleaned.replace(/\/+$/, "");

  try {
    const parsed = new URL(cleaned);
    // 如果 URL path 部分为空，说明只有域名端口，智能补全 /v1 后缀以获得更好的标准兼容性
    if (parsed.pathname === "/" || parsed.pathname === "") {
      cleaned = `${cleaned}/v1`;
    }
  } catch (e) {
    // 无法以标准 URL 格式解析时，维持原样
  }

  return cleaned;
}

/**
 * 处理连通性测试请求：通过后台 Service Worker 发送 fetch，规避 content script CORS 限制
 */
async function handleTestConnection(config: TestConnectionMessage["config"]) {
  const { baseUrl, apiToken, modelName } = config;

  if (!baseUrl) {
    return { success: false, error: "Base URL 不能为空。" };
  }

  const cleanedUrl = cleanBaseUrl(baseUrl);
  const targetUrl = `${cleanedUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiToken && apiToken.trim() !== "") {
    headers["Authorization"] = `Bearer ${apiToken.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时控制

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "Say hello in 3 words" }],
        max_tokens: 16,
        temperature: 0.0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        if (
          choice &&
          choice.message &&
          typeof choice.message.content === "string"
        ) {
          return { success: true };
        }
      }
      return {
        success: false,
        error:
          "接口响应格式不符合 OpenAI 规范。请检查模型名称是否输入正确，或该模型是否支持 chat/completions 接口。",
      };
    } else {
      let errorMessage = `请求失败，HTTP 状态码: ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.error && errorJson.error.message) {
          errorMessage = errorJson.error.message;
        }
      } catch (e) {
        // 忽略非 JSON 响应体解析错误
      }

      if (response.status === 401) {
        return {
          success: false,
          error: "API Token 无效或未授权，请检查您的 Token 配置是否正确。",
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: `模型不存在或接口路径错误 (404)。请确认模型名称 '${modelName}' 是否正确，或 Base URL 是否匹配。`,
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error:
            "接口请求过于频繁 (429)，您的 API 余额可能已耗尽或触发了服务商的频率限制。",
        };
      }

      return { success: false, error: errorMessage };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      return {
        success: false,
        error: "连接超时 (15秒)，请检查网络连接或验证 Base URL 地址是否可达。",
      };
    }
    return {
      success: false,
      error: `网络请求失败: ${error.message || String(error)}，请检查 Base URL 格式或网络代理。`,
    };
  }
}

/**
 * 执行段落并发翻译核心方法，支持域名页面上下文融入
 */
async function handleTranslateBatch(xml: string, host: string) {
  const config = await getLLMConfig();
  if (!config.baseUrl) {
    return {
      success: false,
      error: "未配置 API Base URL，请前往设置面板配置。",
    };
  }

  const defaultSystemPrompt = `
你是一个专业的网页对照翻译助手。你的任务是将给定的 XML 格式英文文本翻译成 {targetLang}。
在翻译时，你必须严格遵守以下关于翻译位置标签（形如 [t1]...[/t1]）的约束守则：
1. **绝不能遗漏或生造标签**：输入中存在哪些 [tX] 标签，你的输出中就必须且只能有相同的标签。绝对不能自行生造不存在的标签 ID（例如输入中最大标签是 [t68]，你绝不能输出 [t69]）。
2. **语序调整下的标签处理**：
   - 翻译为中文时，语序可能与英文完全不同。你必须通过**调整标签的排列顺序或嵌套关系**来适应中文语序。
   - 如果一个英文标签内的文本在中文里被拆分到两个不同位置，你**必须重复使用相同的 ID** 标记它们。前端会自动合并相同标签的翻译。
   - 示例：
     - 英文输入："[t31]: Contains Environment Variables for [/t31][t32]publishing[/t32]"
     - 中文译文应为："[t31]：包含用于[/t31][t32]发布[/t32][t31]的环境变量[/t31]" （注意：因为“环境变量”被调到后面，因此重复使用了 [t31] 包裹两部分）
3. **行内代码与普通文本**：[tX] 标签包裹的可能是一个行内代码块（如 assets/），对于此类代码、文件名或专有名词，你应该在标签内原样保留，不要将它们意译为中文，但句子中的其他说明文本必须翻译。
4. **输出格式**：只输出翻译后的 XML 文本，不要有任何额外的解释或 Markdown 包裹。
`;
  let systemPrompt = defaultSystemPrompt.replace(
    "{targetLang}",
    config.targetLang || "中文",
  );

  if (host) {
    const pageContext = await getPageContext(host);
    if (pageContext && pageContext.trim() !== "") {
      systemPrompt += `\n\n当前翻译页面的背景信息（上下文）为：${pageContext}。请结合此背景对专业术语进行消歧，确保翻译地道、专业。`;
    }
  }

  const cleanedUrl = cleanBaseUrl(config.baseUrl);
  const targetUrl = `${cleanedUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiToken && config.apiToken.trim() !== "") {
    headers["Authorization"] = `Bearer ${config.apiToken.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒翻译超时控制

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: xml },
        ],
        temperature: 0.3, // 稍低随机性以保证 XML 格式完整及翻译连贯
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.choices) && data.choices.length > 0) {
        const choice = data.choices[0];
        if (
          choice &&
          choice.message &&
          typeof choice.message.content === "string"
        ) {
          return { success: true, text: choice.message.content };
        }
      }
      return { success: false, error: "接口返回数据异常，无法解析翻译译文。" };
    } else {
      let errorMessage = `翻译接口调用失败，HTTP 状态码: ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.error && errorJson.error.message) {
          errorMessage = errorJson.error.message;
        }
      } catch (e) {
        // 忽略非 JSON 响应体解析错误
      }

      if (response.status === 401) {
        return {
          success: false,
          error: "API Token 无效或未授权，请检查您的 Token 配置。",
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: `模型不存在或接口路径错误 (404)。请确认模型名称 '${config.modelName}' 是否正确。`,
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error: "接口请求过于频繁 (429)，您的 API 余额可能已耗尽。",
        };
      }

      return { success: false, error: errorMessage };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      return {
        success: false,
        error: "翻译请求超时 (60秒)，请确认网络或接口性能正常。",
      };
    }
    return {
      success: false,
      error: `网络请求失败: ${error.message || String(error)}，请检查网络代理。`,
    };
  }
}
