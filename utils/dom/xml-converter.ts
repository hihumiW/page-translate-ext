/**
 * 将包含 data-translate-id 的 HTML 转换为极简的带标记 XML 文本以降低 token 噪音
 * 例如: <span data-translate-id="t-1">Hello</span> 转换为 [t1]Hello[/t1]
 * 并且过滤剥离其余 HTML 标签，仅保留纯文本
 */
export function htmlToTranslationXml(html: string, allowedIds?: Set<string>): string {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 递归解析 DOM 树，遇到 data-translate-id 时将其包装为 [tX]...[/tX] 形式，其余非翻译包裹标签则只提取文字内容
    function serializeNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }

      if (node instanceof HTMLElement) {
        const tagName = node.tagName.toLowerCase();
        if (tagName === "pre") {
          // 彻底排除 pre 多行代码块中的内容，不发送给大模型，节约 token
          return "";
        }

        const id = node.getAttribute("data-translate-id");
        if (id) {
          if (allowedIds && !allowedIds.has(id)) {
            // 如果节点不在当前分片中，说明本轮不需要翻译，跳过此节点及其子节点
            return "";
          }
          const idNum = id.split("-")[1]; // 从 "t-1" 提取为 "1"
          const innerText = Array.from(node.childNodes)
            .map(serializeNode)
            .join("");
          return `[t${idNum}]${innerText}[/t${idNum}]`;
        }

        // 非翻译节点，递归其子节点并把得到的文本连接
        return Array.from(node.childNodes)
          .map(serializeNode)
          .join("");
      }

      return "";
    }

    return serializeNode(doc.body).trim();
  } catch (error) {
    console.error("Failed to convert HTML to Translation XML:", error);
    return "";
  }
}

/**
 * 从模型返回的带有 [tX]译文[/tX] 标签的文本中，正则匹配并捕获提取出翻译映射表
 * 返回格式如: { "t-1": "译文1", "t-2": "译文2" }
 */
export function extractTranslationsFromXml(xml: string): Record<string, string> {
  const translations: Record<string, string> = {};
  if (!xml) return translations;

  try {
    // 正则支持多行 [\s\S]*?，同时兼容模型可能会带连字符 [t-X] 的情况
    const regex = /\[t-?(\d+)\]([\s\S]*?)\[\/t-?\1\]/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const idNum = match[1];
      const text = match[2];
      const id = `t-${idNum}`;
      if (translations[id] !== undefined) {
        translations[id] += text;
      } else {
        translations[id] = text;
      }
    }
  } catch (error) {
    console.error("Failed to extract translations from XML:", error);
  }

  return translations;
}

/**
 * 将翻译映射表回填到克隆的原始 HTML 结构中，重新生成带有译文的 HTML
 */
export function getTranslatedHtml(
  originalHtml: string,
  translations: Record<string, string>,
  isFinished: boolean = false
): string {
  if (!originalHtml) return "";

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, "text/html");
    const spans = doc.querySelectorAll("[data-translate-id]");

    spans.forEach((span) => {
      const id = span.getAttribute("data-translate-id");
      if (id) {
        if (translations && translations[id] !== undefined) {
          span.textContent = translations[id];
          span.classList.remove("page-translate-loading-node");
        } else {
          if (isFinished) {
            // 若翻译进程已结束而该节点漏译，则剥离 loading 状态，保持原样显示
            span.classList.remove("page-translate-loading-node");
          } else {
            // 尚未获得译文且仍在翻译中的节点挂载 loading 类，展示为骨架屏
            span.classList.add("page-translate-loading-node");
          }
        }
      }
    });

    return doc.body.innerHTML;
  } catch (error) {
    console.error("Failed to fill translations back to HTML:", error);
    return originalHtml;
  }
}

const BLOCK_TAGS = new Set([
  "p", "li", "tr", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "section", "article", "div", "ul", "ol", "dl", "table", "thead", "tbody", "tfoot", "td", "th"
]);

function getClosestBlockAncestor(node: HTMLElement): HTMLElement {
  let curr = node.parentElement;
  while (curr) {
    const tag = curr.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag) || tag === "body") {
      return curr;
    }
    curr = curr.parentElement;
  }
  return node;
}

/**
 * 按“最近块级祖先（段落/块）”将快照 HTML 里的翻译 ID 进行无损归类分片，且以 1800 字符为大粒度字数阈值，不截断句子
 */
export function splitSnapshotIntoParagraphChunks(html: string, maxLen: number = 1800): Set<string>[] {
  const chunks: Set<string>[] = [];
  if (!html) return chunks;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const spans = Array.from(doc.querySelectorAll("[data-translate-id]")) as HTMLElement[];

    // 1. 将所有带有 data-translate-id 的节点，按照最近的块级祖先元素进行归类分组
    const groupMap = new Map<HTMLElement, { ids: string[]; textLen: number }>();
    spans.forEach((span) => {
      const id = span.getAttribute("data-translate-id");
      if (!id) return;
      
      const ancestor = getClosestBlockAncestor(span);
      const textLen = (span.textContent || "").length;
      
      const existing = groupMap.get(ancestor);
      if (existing) {
        existing.ids.push(id);
        existing.textLen += textLen;
      } else {
        groupMap.set(ancestor, { ids: [id], textLen });
      }
    });

    // 2. 遍历各段落块分组，将其拼装成满足字数要求的并发 Chunks 集合
    let currentChunk = new Set<string>();
    let currentLen = 0;

    groupMap.forEach((group) => {
      if (currentLen + group.textLen > maxLen && currentChunk.size > 0) {
        chunks.push(currentChunk);
        currentChunk = new Set<string>();
        currentLen = 0;
      }
      
      group.ids.forEach((id) => currentChunk.add(id));
      currentLen += group.textLen;
    });

    if (currentChunk.size > 0) {
      chunks.push(currentChunk);
    }
  } catch (error) {
    console.error("Failed to split snapshot into paragraph chunks:", error);
  }
  return chunks;
}
