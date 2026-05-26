import React from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi } from "wxt/client";
import {
  TranslationWindow,
  type SelectedElementSnapshot,
  type TranslationWindowLayout,
} from "@/components/floating-window/TranslationWindow";
import type { SelectedContainer } from "@/components/popup/types";
import {
  createReadableDomSnapshot,
  hasReadableText,
  isElementVisible,
} from "@/utils/dom/readable-snapshot";
import { createSelectionController } from "@/utils/dom/selection-controller";
import App from "./popup/App";
import popupStyles from "./popup/style.css?inline";
import { getLLMConfig } from "@/utils/storage/config";
import {
  htmlToTranslationXml,
  extractTranslationsFromXml,
  splitSnapshotIntoParagraphChunks,
} from "@/utils/dom/xml-converter";
import { isHostPageDark } from "@/utils/dom/theme";

type FloatingPopupMessage = {
  type: "PAGE_TRANSLATE_TOGGLE_FLOATING_POPUP";
};

const TRANSLATION_WINDOW_LAYOUT_STORAGE_KEY =
  "pageTranslate.translationWindowLayout";

export default defineContentScript({
  matches: ["<all_urls>"],
  async main(ctx) {
    // 浮窗本身按需 mount；选中元素状态则保存在 content script 内存中。
    let isPopupMounted = false;
    let popupRoot: Root | undefined;
    let isTranslationMounted = false;
    let translationRoot: Root | undefined;
    let selectedContainers: SelectedContainer[] = [];
    let isSelecting = false;
    let translationError: string | undefined;
    let translationSnapshots: SelectedElementSnapshot[] = [];
    let translationRunId = 0;
    let translationWindowLayout = await loadTranslationWindowLayout();

    // React 浮窗是受控渲染：DOM 选择控制器变化后，重新把最新状态传给 App。
    const renderApp = () => {
      popupRoot?.render(
        <React.StrictMode>
          <App
            surface="floating"
            containers={selectedContainers}
            isSelecting={isSelecting}
            onStartSelecting={() => selectionController.start()}
            onStopSelecting={() => selectionController.stop()}
            onClearSelection={() => {
              translationError = undefined;
              selectionController.clear();
            }}
            onRemoveContainer={(id) => {
              translationError = undefined;
              selectionController.remove(id);
            }}
            onStartTranslation={handleStartTranslation}
            onClose={() => popupUi.remove()}
            translationError={translationError}
          />
        </React.StrictMode>,
      );
    };

    const renderTranslationWindow = () => {
      translationRoot?.render(
        <React.StrictMode>
          <TranslationWindow
            key={translationRunId}
            snapshots={translationSnapshots}
            initialLayout={translationWindowLayout}
            onLayoutChange={(layout) => {
              translationWindowLayout = layout;
              void saveTranslationWindowLayout(layout);
            }}
          />
        </React.StrictMode>,
      );
    };

    // 选择控制器只负责页面 DOM 高亮和选择规则，UI 通过回调同步状态。
    const selectionController = createSelectionController({
      onChange(containers) {
        selectedContainers = containers;
        translationError = undefined;
        renderApp();
      },
      onSelectingChange(nextIsSelecting) {
        isSelecting = nextIsSelecting;
        renderApp();
      },
    });

    const updateSnapshotStatus = (
      id: string,
      status: "success" | "error" | "translating",
      translations?: Record<string, string>,
      errorMsg?: string,
    ) => {
      translationSnapshots = translationSnapshots.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              translations: {
                ...(item.translations || {}),
                ...(translations || {}),
              },
              errorMsg: errorMsg !== undefined ? errorMsg : item.errorMsg,
            }
          : item,
      );
      renderTranslationWindow();
    };

    const handleStartTranslation = async () => {
      // 开始翻译前先退出选择模式，避免用户点击翻译弹窗时仍触发页面元素选择。
      selectionController.stop();
      selectionController.refresh();

      // 开始前先校验 LLM 配置有效性
      const config = await getLLMConfig();
      if (!config.baseUrl) {
        translationError =
          "请点击右上角齿轮图标，配置大模型 API 接口后再开始翻译。";
        renderApp();
        return;
      }

      const selectedElements = selectionController.getSelectedElements();
      if (selectedElements.length === 0) {
        translationError = "请先在页面中选择需要翻译的内容区域。";
        renderApp();
        return;
      }

      const lostIds = new Set(
        selectedElements
          .filter((item) => !item.element.isConnected)
          .map((item) => item.id),
      );

      // 直接使用用户选中的原始 element 列表，恢复完整大卡片的连贯阅读排版
      const readableElements = selectedElements.filter(
        (item) => item.element.isConnected && hasReadableText(item.element),
      );

      selectedContainers = selectionController.getContainers();

      if (readableElements.length === 0) {
        translationError =
          lostIds.size > 0
            ? "已选内容都已丢失，请重新选择后再开始翻译。"
            : "已选内容没有可翻译文本，请选择包含文字的区域。";
        renderApp();
        return;
      }

      const snapshots = readableElements
        .map((item) => {
          const snapshot = createReadableDomSnapshot(item.element);
          return {
            id: item.id,
            index: item.index,
            summary: item.summary,
            html: snapshot.html,
            textLength: snapshot.textLength,
            status: "translating" as const,
            translations: {},
          };
        })
        .filter((snapshot) => snapshot.textLength > 0);

      if (snapshots.length === 0) {
        translationError = "已选内容无法生成有效原文快照，请换一个内容区域。";
        renderApp();
        return;
      }

      // 翻译弹窗与管理浮窗分离；新一轮开始时只替换快照内容，再关闭管理浮窗。
      translationSnapshots = snapshots;
      translationRunId += 1;
      if (isTranslationMounted) {
        renderTranslationWindow();
      } else {
        translationUi.mount();
        isTranslationMounted = true;
      }
      popupUi.remove();

      // 维护各快照卡片的逻辑 Chunk 计数器和翻译错误状态
      const remainingChunksMap: Record<string, number> = {};
      const errorMap: Record<string, { hasError: boolean; message: string }> =
        {};
      const tasks: (() => Promise<void>)[] = [];

      snapshots.forEach((snapshot) => {
        // 使用 1800 字符的大粒度语境平衡划分，绝不拦腰切断句子
        const chunks = splitSnapshotIntoParagraphChunks(snapshot.html, 1800);

        if (chunks.length === 0) {
          remainingChunksMap[snapshot.id] = 0;
          updateSnapshotStatus(snapshot.id, "success", {});
          return;
        }

        remainingChunksMap[snapshot.id] = chunks.length;
        errorMap[snapshot.id] = { hasError: false, message: "" };

        chunks.forEach((chunkIds) => {
          tasks.push(() => {
            const xml = htmlToTranslationXml(snapshot.html, chunkIds);

            if (!xml.trim()) {
              remainingChunksMap[snapshot.id]--;
              if (remainingChunksMap[snapshot.id] === 0) {
                const errState = errorMap[snapshot.id];
                updateSnapshotStatus(
                  snapshot.id,
                  errState.hasError ? "error" : "success",
                  {},
                  errState.hasError ? errState.message : undefined,
                );
              }
              return Promise.resolve();
            }

            const host =
              typeof window !== "undefined" ? window.location.host : "";
            console.log(
              `Sending translation chunk request for snapshot ${snapshot.id}`,
              {
                chunkIds: Array.from(chunkIds),
                xml,
                host,
              },
            );

            return browser.runtime
              .sendMessage({
                type: "PAGE_TRANSLATE_TRANSLATE_BATCH",
                xml,
                host,
              })
              .then((res: any) => {
                remainingChunksMap[snapshot.id]--;
                console.log(
                  `Translation chunk result for snapshot ${snapshot.id}`,
                  res,
                );

                if (res && res.success && res.text) {
                  const translations = extractTranslationsFromXml(res.text);
                  const isFinished = remainingChunksMap[snapshot.id] === 0;
                  const errState = errorMap[snapshot.id];

                  updateSnapshotStatus(
                    snapshot.id,
                    isFinished
                      ? errState.hasError
                        ? "error"
                        : "success"
                      : "translating",
                    translations,
                    isFinished && errState.hasError
                      ? errState.message
                      : undefined,
                  );
                } else {
                  errorMap[snapshot.id].hasError = true;
                  errorMap[snapshot.id].message =
                    res?.error || "翻译接口响应异常";

                  const isFinished = remainingChunksMap[snapshot.id] === 0;
                  updateSnapshotStatus(
                    snapshot.id,
                    isFinished ? "error" : "translating",
                    undefined,
                    isFinished ? errorMap[snapshot.id].message : undefined,
                  );
                }
              })
              .catch((err: any) => {
                remainingChunksMap[snapshot.id]--;
                errorMap[snapshot.id].hasError = true;
                errorMap[snapshot.id].message = err.message || String(err);

                const isFinished = remainingChunksMap[snapshot.id] === 0;
                updateSnapshotStatus(
                  snapshot.id,
                  isFinished ? "error" : "translating",
                  undefined,
                  isFinished ? errorMap[snapshot.id].message : undefined,
                );
              });
          });
        });
      });

      // 运行最大并发为 6 的队列
      void runWithConcurrencyLimit(tasks, 6);
    };

    const popupUi = await createShadowRootUi(ctx, {
      name: "page-translate-floating-popup",
      position: "modal",
      zIndex: 2147483647,
      isolateEvents: true,
      css: `
        ${popupStyles}

        :host {
          all: initial;
        }

        html,
        body {
          width: auto;
          min-width: 0;
          min-height: 0;
          margin: 0;
          overflow: visible;
          background: transparent;
          pointer-events: none;
        }

        #page-translate-floating-root {
          position: fixed;
          top: 16px;
          right: 16px;
          width: 390px;
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 32px);
          pointer-events: auto;
        }
      `,
      onMount(uiContainer) {
        const rootElement = document.createElement("div");
        rootElement.id = "page-translate-floating-root";
        if (isHostPageDark()) {
          rootElement.classList.add("dark");
        }
        uiContainer.append(rootElement);

        // 每次打开管理浮窗都重新检查 DOM，适配 SPA 内部内容变化但外层容器引用不变的情况。
        selectedContainers = selectionController.refresh();

        // 每次浮窗重新 mount 时创建新的 React root，并使用内存中的选择状态恢复 UI。
        popupRoot = ReactDOM.createRoot(rootElement);
        renderApp();

        return popupRoot;
      },
      onRemove(mountedRoot) {
        selectionController.stop();
        mountedRoot?.unmount();
        popupRoot = undefined;
        isPopupMounted = false;
      },
    });

    const translationUi = await createShadowRootUi(ctx, {
      name: "page-translate-window",
      position: "modal",
      zIndex: 2147483647,
      isolateEvents: true,
      css: `
        ${popupStyles}

        :host {
          all: initial;
        }

        html,
        body {
          width: auto;
          min-width: 0;
          min-height: 0;
          margin: 0;
          overflow: visible;
          background: transparent;
          pointer-events: none;
        }

        #page-translate-window-root {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        .react-resizable {
          position: relative;
        }

        .react-resizable-handle {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 42px;
          height: 42px;
          cursor: se-resize;
          border-bottom-right-radius: 24px;
          background: linear-gradient(135deg, transparent 0%, transparent 45%, rgba(226, 232, 240, 0.72) 100%);
          transition: background 160ms ease;
        }

        .react-resizable-handle:hover {
          background: linear-gradient(135deg, transparent 0%, transparent 38%, rgba(203, 213, 225, 0.86) 100%);
        }

        
  
    
        .react-resizable-handle::after {
            content: "";
            position: absolute;
            border-right: 2px solid rgba(100, 116, 139, 0.72);
            border-bottom: 2px solid rgba(100, 116, 139, 0.72);
            border-bottom-right-radius: 16px;
            pointer-events: none;
            right: 8px;
            bottom: 9px;
            width: 13px;
            height: 13px;
        }

        .page-translate-original-content {
          color: #0f172a;
          font-size: 14px;
          line-height: 1.7;
          overflow-wrap: anywhere;
        }

        .page-translate-original-content * {
          max-width: 100%;
        }

        .page-translate-original-content table {
          width: 100%;
          border-collapse: collapse;
        }

        .page-translate-original-content pre,
        .page-translate-original-content code {
          white-space: pre-wrap;
          word-break: break-word;
        }
      `,
      onMount(uiContainer) {
        const rootElement = document.createElement("div");
        rootElement.id = "page-translate-window-root";
        if (isHostPageDark()) {
          rootElement.classList.add("dark");
        }
        uiContainer.append(rootElement);

        // 翻译弹窗单独挂载，关闭/最小化只影响组件自身状态，不会清掉当前快照数据。
        translationRoot = ReactDOM.createRoot(rootElement);
        renderTranslationWindow();

        return translationRoot;
      },
      onRemove(mountedRoot) {
        mountedRoot?.unmount();
        translationRoot = undefined;
        isTranslationMounted = false;
      },
    });

    const handleMessage = (message: unknown) => {
      const typedMessage = message as Partial<FloatingPopupMessage>;
      if (typedMessage?.type !== "PAGE_TRANSLATE_TOGGLE_FLOATING_POPUP") return;

      // 插件 icon 点击采用 toggle 行为：已打开则关闭，未打开则挂载浮窗。
      if (isPopupMounted) {
        popupUi.remove();
        return;
      }

      popupUi.mount();
      isPopupMounted = true;
    };

    browser.runtime.onMessage.addListener(handleMessage);
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(handleMessage);
      popupUi.remove();
      translationUi.remove();
      selectionController.destroy();
    });
  },
});

async function loadTranslationWindowLayout(): Promise<
  TranslationWindowLayout | undefined
> {
  const stored = await browser.storage.local.get(
    TRANSLATION_WINDOW_LAYOUT_STORAGE_KEY,
  );
  const layout = stored[TRANSLATION_WINDOW_LAYOUT_STORAGE_KEY];
  return isTranslationWindowLayout(layout) ? layout : undefined;
}

async function saveTranslationWindowLayout(layout: TranslationWindowLayout) {
  await browser.storage.local.set({
    [TRANSLATION_WINDOW_LAYOUT_STORAGE_KEY]: layout,
  });
}

function isTranslationWindowLayout(
  value: unknown,
): value is TranslationWindowLayout {
  if (!value || typeof value !== "object") return false;

  const layout = value as Partial<TranslationWindowLayout>;
  return (
    isFiniteNumber(layout.size?.width) &&
    isFiniteNumber(layout.size?.height) &&
    isFiniteNumber(layout.position?.x) &&
    isFiniteNumber(layout.position?.y)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "tr",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "section",
  "article",
  "div",
  "ul",
  "ol",
  "dl",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "td",
  "th",
]);

function isBlockElement(el: HTMLElement): boolean {
  return BLOCK_TAGS.has(el.tagName.toLowerCase());
}

function extractReadableBlocks(el: HTMLElement): HTMLElement[] {
  const text = el.innerText || el.textContent || "";
  const textLen = text.replace(/\s+/g, " ").trim().length;
  // 如果节点文本字数小于 300 字，无需再拆分，保持上下文完整
  if (textLen < 300) {
    return [el];
  }

  const children = Array.from(el.children).filter(
    (child) => child instanceof HTMLElement,
  ) as HTMLElement[];
  const hasBlockChild = children.some(isBlockElement);

  if (hasBlockChild) {
    const blocks: HTMLElement[] = [];
    children.forEach((child) => {
      blocks.push(...extractReadableBlocks(child));
    });
    return blocks.filter((block) => {
      const blockText = (block.innerText || block.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return blockText.length > 0;
    });
  }

  return [el];
}

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const p = Promise.resolve()
      .then(() => task())
      .then((res) => {
        results[i] = res;
      });
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}
