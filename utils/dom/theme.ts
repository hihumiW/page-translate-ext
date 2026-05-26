/**
 * 判定当前系统的默认主题是否为深色模式 (Dark Mode)
 */
export function isHostPageDark(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // 直接根据系统的 prefers-color-scheme 媒体查询返回默认肤色配置
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
