import type { SelectedContainer } from "@/components/popup/types";

const HOVER_CLASS = "page-translate-hover-highlight";
const SELECTED_CLASS = "page-translate-selected-highlight";
const STYLE_ID = "page-translate-selection-style";
const FLOATING_POPUP_TAG = "PAGE-TRANSLATE-FLOATING-POPUP";
const TRANSLATION_WINDOW_TAG = "PAGE-TRANSLATE-WINDOW";
const MAX_SELECTED_COUNT = 10;

// 内部状态保存真实 DOM 元素引用；React UI 只接收可序列化的展示数据。
interface SelectedElement {
  id: string;
  element: HTMLElement;
}

export interface SelectedDomElement {
  id: string;
  index: number;
  summary: string;
  element: HTMLElement;
}

interface SelectionControllerOptions {
  onChange: (containers: SelectedContainer[]) => void;
  onSelectingChange: (isSelecting: boolean) => void;
}

export interface SelectionController {
  start: () => void;
  stop: () => void;
  clear: () => void;
  remove: (id: string) => void;
  refresh: () => SelectedContainer[];
  destroy: () => void;
  getContainers: () => SelectedContainer[];
  getSelectedElements: () => SelectedDomElement[];
  getIsSelecting: () => boolean;
}

export function createSelectionController({
  onChange,
  onSelectingChange,
}: SelectionControllerOptions): SelectionController {
  // 选择模式状态、当前 hover 元素、已选元素列表都只保存在当前页面内存中。
  let isSelecting = false;
  let hoveredElement: HTMLElement | null = null;
  let selectedElements: SelectedElement[] = [];
  let nextId = 1;

  // 将 hover/selected 高亮样式注入到宿主页面，而不是依赖 Shadow DOM 样式。
  injectSelectionStyle();

  // 每次选择列表变化后，都转换为 UI 需要的轻量数据再通知 React。
  const emitChange = () => {
    onChange(toContainerViews(selectedElements));
  };

  // 进入/退出选择模式时，给 html 加一个全局 class，用来展示 crosshair 光标。
  const setSelecting = (nextValue: boolean) => {
    if (isSelecting === nextValue) return;
    isSelecting = nextValue;
    document.documentElement.classList.toggle(
      "page-translate-is-selecting",
      isSelecting,
    );
    onSelectingChange(isSelecting);
  };

  // hover 高亮只允许同时存在一个，切换目标前先清理旧元素。
  const clearHover = () => {
    hoveredElement?.classList.remove(HOVER_CLASS);
    hoveredElement = null;
  };

  const setHover = (element: HTMLElement | null) => {
    if (hoveredElement === element) return;
    clearHover();
    hoveredElement = element;
    hoveredElement?.classList.add(HOVER_CLASS);
  };

  // 新增选择时给目标元素加 selected class；最多允许选择 10 个容器。
  const addSelected = (element: HTMLElement) => {
    if (selectedElements.length >= MAX_SELECTED_COUNT) return;
    element.classList.add(SELECTED_CLASS);
    selectedElements.push({ id: String(nextId++), element });
    normalizeSelectedIndexes();
    emitChange();
  };

  // 删除单个选择时，需要同步清除页面元素上的 selected class。
  const removeSelected = (selected: SelectedElement) => {
    selected.element.classList.remove(SELECTED_CLASS);
    selectedElements = selectedElements.filter(
      (item) => item.id !== selected.id,
    );
    normalizeSelectedIndexes();
    emitChange();
  };

  // 如果点击的是已选子元素的父元素，则移除所有已选子元素并改选父元素。
  const replaceDescendantsWithParent = (
    element: HTMLElement,
    descendants: SelectedElement[],
  ) => {
    descendants.forEach((item) =>
      item.element.classList.remove(SELECTED_CLASS),
    );
    selectedElements = selectedElements.filter(
      (item) => !descendants.some((descendant) => descendant.id === item.id),
    );
    addSelected(element);
  };

  // 鼠标移动时找到真正可选的元素，并把 hover class 挪过去。
  const handleMouseMove = (event: MouseEvent) => {
    if (!isSelecting) return;
    const target = getSelectableElement(event);
    setHover(target);
  };

  // 点击时按父子关系处理三种情况：取消已有选择、父元素替换子元素、追加新选择。
  const handleClick = (event: MouseEvent) => {
    if (!isSelecting) return;
    const target = getSelectableElement(event);
    if (!target) return;

    // 选择模式中点击页面元素不应该触发网页原本的链接、按钮或业务事件。
    event.preventDefault();
    event.stopPropagation();

    // 点击已选元素本身，或点击已选元素内部的子元素，都视为取消该已选容器。
    const containingSelection = selectedElements.find(
      (item) => item.element === target || item.element.contains(target),
    );
    if (containingSelection) {
      removeSelected(containingSelection);
      setHover(target);
      return;
    }

    // 点击某个已选子容器的父容器时，用父容器替换这些子容器，避免父子嵌套。
    const selectedDescendants = selectedElements.filter((item) =>
      target.contains(item.element),
    );
    if (selectedDescendants.length > 0) {
      replaceDescendantsWithParent(target, selectedDescendants);
      setHover(target);
      return;
    }

    addSelected(target);
    setHover(target);
  };

  // Escape 只退出选择模式，不清空已经选中的容器。
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isSelecting || event.key !== "Escape") return;
    stop();
  };

  // 开启选择模式：注册捕获阶段事件，优先于页面自身事件处理选择点击。
  const start = () => {
    setSelecting(true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  };

  // 退出选择模式：移除事件监听和 hover 高亮，但保留 selected 高亮。
  const stop = () => {
    setSelecting(false);
    clearHover();
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
  };

  // 清空所有选择：同时清理页面上的 selected class 和 UI 列表。
  const clear = () => {
    selectedElements.forEach((item) =>
      item.element.classList.remove(SELECTED_CLASS),
    );
    selectedElements = [];
    emitChange();
  };

  // 从 UI 列表删除某一项时，根据 id 找到对应 DOM 元素并清理 selected class。
  const remove = (id: string) => {
    const selected = selectedElements.find((item) => item.id === id);
    if (!selected) return;
    removeSelected(selected);
  };

  // SPA 路由切换后，容器引用可能还在，但内部文本已经变化；刷新会重新读取当前 DOM 摘要和有效状态。
  const refresh = () => {
    const containers = toContainerViews(selectedElements);
    onChange(containers);
    return containers;
  };

  // content script 失效或页面卸载时做完整清理，避免给网页残留 class/style。
  const destroy = () => {
    stop();
    clear();
    clearHover();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.classList.remove("page-translate-is-selecting");
  };

  return {
    start,
    stop,
    clear,
    remove,
    refresh,
    destroy,
    getContainers: () => toContainerViews(selectedElements),
    // 开始翻译需要读取真实 DOM 引用生成快照；这里返回浅拷贝，避免外部改动选择控制器的内部顺序。
    getSelectedElements: () => toSelectedDomElements(selectedElements),
    getIsSelecting: () => isSelecting,
  };
}

// 从事件路径中找出可选择元素；如果事件来自插件浮窗自身，则直接忽略。
function getSelectableElement(event: MouseEvent): HTMLElement | null {
  const path = event.composedPath();
  if (path.some(isFloatingPopupNode)) return null;

  const target = path.find(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  if (!target) return null;

  return findSelectableAncestor(target);
}

// 从实际命中的节点向上找一个合适的容器元素，跳过不可选节点。
function findSelectableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current !== document.documentElement) {
    if (isSelectableElement(current)) return current;
    current = current.parentElement;
  }
  return null;
}

// 判断元素是否适合作为容器：排除插件自身、页面结构节点、隐藏节点和过小节点。
function isSelectableElement(element: HTMLElement): boolean {
  if (isFloatingPopupNode(element)) return false;
  if (
    ["HTML", "BODY", "HEAD", "SCRIPT", "STYLE", "LINK", "META"].includes(
      element.tagName,
    )
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    style.pointerEvents !== "none"
  );
}

// WXT 的 Shadow DOM 宿主是自定义元素；选择页面内容时必须避开它。
function isFloatingPopupNode(node: EventTarget): boolean {
  return (
    node instanceof HTMLElement &&
    [FLOATING_POPUP_TAG, TRANSLATION_WINDOW_TAG].includes(node.tagName)
  );
}

// 注入宿主页面样式：hover 用蓝色，selected 用绿色；outline 不影响布局尺寸。
function injectSelectionStyle() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    html.page-translate-is-selecting,
    html.page-translate-is-selecting * {
      cursor: crosshair !important;
    }

    .${HOVER_CLASS} {
      outline: 2px solid rgba(14, 165, 233, 0.95) !important;
      border-radius: 4px !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.18) !important;
    }

    .${SELECTED_CLASS} {
      outline: 2px solid rgba(16, 185, 129, 0.95) !important;
      border-radius: 4px !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.16) !important;
    }
  `;
  document.documentElement.append(style);
}

function normalizeSelectedIndexes() {
  // 序号在输出给 UI 时按数组顺序动态生成。
  // 这里保留一个显式步骤，表示选择列表已完成维护。
}

// 将内部 DOM 引用转换成 React 列表使用的轻量数据，避免 UI 组件直接操作 DOM。
function toContainerViews(
  selectedElements: SelectedElement[],
): SelectedContainer[] {
  return selectedElements.map((item, index) => ({
    id: item.id,
    index: index + 1,
    summary: item.element.isConnected
      ? getElementSummary(item.element)
      : "已选元素已从当前页面中移除",
    status: item.element.isConnected ? "valid" : "lost",
    message: item.element.isConnected ? undefined : "该元素已从当前页面中移除。",
  }));
}

function toSelectedDomElements(
  selectedElements: SelectedElement[],
): SelectedDomElement[] {
  return selectedElements.map((item, index) => ({
    id: item.id,
    index: index + 1,
    summary: getElementSummary(item.element),
    element: item.element,
  }));
}

// 从元素文本生成简短摘要；后续接 DOM 快照时可替换为更稳定的摘要逻辑。
function getElementSummary(element: HTMLElement): string {
  const text =
    element.innerText || element.textContent || element.tagName.toLowerCase();
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return `<${element.tagName.toLowerCase()}>`;
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}
