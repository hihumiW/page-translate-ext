// 该模块负责把用户选中的网页元素转换为安全、静态的阅读快照。
// 快照只保留原文阅读所需的结构和文字样式，不保留脚本、事件和原网页交互。

export interface ReadableSnapshot {
  html: string;
  textLength: number;
}

// 极小元素通常是埋点、无障碍辅助文本或布局占位。它们在原网页中不可见，
// 但复制到翻译弹窗后可能因为样式环境变化而显形，因此快照阶段直接过滤。
const MIN_VISIBLE_WIDTH = 4;
const MIN_VISIBLE_HEIGHT = 4;
const MAX_READABLE_SPACING = 24;

// 这些标签本身不属于阅读内容，或者无法安全、稳定地静态复刻到翻译弹窗中。
const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "iframe",
  "canvas",
  "svg",
  "audio",
  "noscript",
  "template",
]);

// 只复制与阅读相关的样式白名单，避免把原页面复杂布局、动画、定位和脚本状态带进弹窗。
const STYLE_PROPS = [
  "display",
  "box-sizing",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "white-space",
  "word-break",
  "overflow-wrap",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "list-style-type",
  "list-style-position",
  "border-collapse",
  "border-spacing",
  "vertical-align",
  "gap",
  "row-gap",
  "column-gap",
  "align-items",
  "justify-content",
  "grid-template-columns",
  "grid-template-rows",
  "flex-direction",
  "flex-wrap",
];

// 仅保留对阅读结构有意义且风险较低的属性。
const SAFE_ATTRIBUTE_NAMES = new Set([
  "colspan",
  "rowspan",
  "scope",
  "start",
  "type",
  
  // 多媒体核心属性白名单
  "src",
  "alt",
  "srcset",
  "sizes",
  "controls",
  "poster",
  "preload",
  "autoplay",
  "loop",
  "muted",
  "playsinline",
  "media",
  "width",
  "height",
]);

// 这些结构标签即使自身盒子很小，也会影响阅读结构，不能按尺寸直接过滤。
const SIZE_FILTER_EXEMPT_TAGS = new Set([
  "br",
  "wbr",
  "li",
  "tr",
  "thead",
  "tbody",
  "tfoot",
]);

export function hasReadableText(element: HTMLElement): boolean {
  return (
    normalizeText(element.innerText || element.textContent || "").length > 0
  );
}

export function isElementVisible(element: HTMLElement): boolean {
  const computedStyle = window.getComputedStyle(element);
  return (
    computedStyle.display !== "none" &&
    computedStyle.visibility !== "hidden" &&
    computedStyle.visibility !== "collapse" &&
    Number(computedStyle.opacity) !== 0
  );
}

export function createReadableDomSnapshot(
  element: HTMLElement,
): ReadableSnapshot {
  const wrapper = document.createElement("div");
  let textIdCounter = 0;

  function cloneSafeNode(
    node: Node,
    inSkipTranslate: boolean = false,
  ): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent || "";
      const normalized = textContent.replace(/\s+/g, " ").trim();
      if (normalized.length === 0 || inSkipTranslate) {
        // 纯空白节点或跳过翻译标签内部的文本节点，不包裹 span 且不分配 id，节约 LLM tokens
        return document.createTextNode(textContent);
      }

      textIdCounter++;
      const id = `t-${textIdCounter}`;

      const span = document.createElement("span");
      span.setAttribute("data-translate-id", id);
      span.textContent = textContent;
      return span;
    }

    if (!(node instanceof HTMLElement)) return null;

    const tagName = node.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tagName)) return null;
    if (!isElementVisibleForSnapshot(node)) return null;

    const clone = document.createElement(tagName);
    copySafeAttributes(node, clone);
    copyReadableStyles(node, clone);

    const nextInSkipTranslate =
      inSkipTranslate || tagName === "pre";

    for (const child of Array.from(node.childNodes)) {
      const clonedChild = cloneSafeNode(child, nextInSkipTranslate);
      if (clonedChild) clone.append(clonedChild);
    }

    return clone;
  }

  const clonedNode = cloneSafeNode(element);

  // 选中元素可能只有危险节点、隐藏节点或空白文本；此时返回空快照，由调用方决定是否提示用户。
  if (clonedNode) wrapper.append(clonedNode);

  return {
    html: wrapper.innerHTML,
    textLength: normalizeText(wrapper.textContent || "").length,
  };
}

function copySafeAttributes(source: HTMLElement, target: HTMLElement) {
  for (const attribute of Array.from(source.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    // 不复制事件、原始 class/id 和 inline style，避免把页面行为或选择高亮状态带入弹窗。
    if (
      name.startsWith("on") ||
      name === "style" ||
      name === "class" ||
      name === "id"
    ) {
      continue;
    }

    if (name === "href") {
      // 翻译弹窗中的原文只用于阅读对照，不允许点击跳转，避免用户误触离开当前页面。
      continue;
    }

    if (SAFE_ATTRIBUTE_NAMES.has(name)) {
      target.setAttribute(name, value);
    }
  }
}

function copyReadableStyles(source: HTMLElement, target: HTMLElement) {
  const computedStyle = window.getComputedStyle(source);
  const styleText = STYLE_PROPS.map((propertyName) => {
    const value = normalizeReadableStyleValue(
      propertyName,
      computedStyle.getPropertyValue(propertyName),
    );
    return value ? `${propertyName}: ${value};` : "";
  })
    .filter(Boolean)
    .join(" ");

  const backgroundColor = computedStyle.getPropertyValue("background-color");
  const simpleBackground =
    backgroundColor && backgroundColor !== "rgba(0, 0, 0, 0)"
      ? ` background-color: ${backgroundColor};`
      : "";

  // 给快照节点补充宽度约束，避免原网页中的超宽表格或 flex 子项撑破翻译弹窗。
  target.setAttribute(
    "style",
    `${styleText}${simpleBackground} max-width: 100%; box-sizing: border-box;`,
  );
}

function normalizeReadableStyleValue(
  propertyName: string,
  propertyValue: string,
): string {
  // 原网页的大容器常带有很大的 margin/padding，直接搬进弹窗会把正文挤窄。
  // 对超过常规排版间距的值归零，保留小间距的阅读层级。
  if (isSpacingProperty(propertyName) && isOversizedPixelValue(propertyValue)) {
    return "0px";
  }

  return propertyValue;
}

function isSpacingProperty(propertyName: string): boolean {
  return (
    propertyName.startsWith("margin-") || propertyName.startsWith("padding-")
  );
}

function isOversizedPixelValue(propertyValue: string): boolean {
  const match = propertyValue.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match) return false;

  return Math.abs(Number(match[1])) > MAX_READABLE_SPACING;
}

export function isElementVisibleForSnapshot(element: HTMLElement): boolean {
  const computedStyle = window.getComputedStyle(element);
  const tagName = element.tagName.toLowerCase();

  // display/visibility/opacity 能覆盖多数“页面上不可见，但 textContent 仍存在”的情况。
  if (
    computedStyle.display === "none" ||
    computedStyle.visibility === "hidden" ||
    computedStyle.visibility === "collapse" ||
    Number(computedStyle.opacity) === 0
  ) {
    return false;
  }

  // display: contents 自身没有盒模型，但子元素可能可见，所以不能用尺寸过滤掉它。
  if (computedStyle.display === "contents") return true;

  if (SIZE_FILTER_EXEMPT_TAGS.has(tagName)) return true;

  const rect = element.getBoundingClientRect();
  const hasReadableTextNode = Array.from(element.childNodes).some(
    (child) =>
      child.nodeType === Node.TEXT_NODE &&
      normalizeText(child.textContent || "").length > 0,
  );
  const hasElementChildren = Array.from(element.children).some(
    (child) => child instanceof HTMLElement,
  );

  // 结构容器即使自身尺寸异常，也可能包含后代可见内容；先保留容器，让递归对子节点逐个判断。
  if (hasElementChildren && !hasReadableTextNode) return true;

  // 针对 1x1 一类隐藏文本，只有当元素自身承载文本且盒子小到不可读时才过滤。
  return rect.width >= MIN_VISIBLE_WIDTH && rect.height >= MIN_VISIBLE_HEIGHT;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
