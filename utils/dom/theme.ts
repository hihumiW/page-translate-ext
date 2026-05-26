/**
 * 智能判定当前宿主页面是否处于深色模式 (Dark Mode)
 */
export function isHostPageDark(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    // 1. 尝试从 body 元素的计算样式背景色进行亮度计算判定
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg !== "transparent" && bodyBg !== "rgba(0, 0, 0, 0)") {
      const rgbValues = bodyBg.match(/\d+/g);
      if (rgbValues && rgbValues.length >= 3) {
        const r = parseInt(rgbValues[0], 10);
        const g = parseInt(rgbValues[1], 10);
        const b = parseInt(rgbValues[2], 10);
        
        // 相对亮度算法 (Relative Luminance)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness < 120; // 亮度值低于120即判定为深色网页背景
      }
    }
  } catch (error) {
    console.warn("Failed to detect body background color for dark mode detection:", error);
  }

  // 2. 检查 html / body 上的常见深色模式类名及属性特征 (如 GitHub, Tailwind, VitePress 等主流实现)
  const docClass = document.documentElement.className || "";
  const bodyClass = document.body?.className || "";
  const htmlTheme = document.documentElement.getAttribute("data-theme") || "";
  const htmlColorMode = document.documentElement.getAttribute("data-color-mode") || "";

  const darkKeywords = ["dark", "night", "black", "slate"];
  const isClassDark = darkKeywords.some(
    (keyword) => docClass.toLowerCase().includes(keyword) || bodyClass.toLowerCase().includes(keyword)
  );
  const isAttrDark = darkKeywords.some(
    (keyword) => htmlTheme.toLowerCase().includes(keyword) || htmlColorMode.toLowerCase().includes(keyword)
  );

  if (isClassDark || isAttrDark) {
    return true;
  }

  // 3. 兜底策略：如果网页没有显式的暗黑模式特征，则默认为浅色网页以适配克隆字色
  return false;
}
