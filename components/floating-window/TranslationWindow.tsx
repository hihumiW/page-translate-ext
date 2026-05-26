// 该组件负责渲染网页内的对照翻译弹窗。
// 提供拖拽、缩放、关闭隐藏、最小化恢复、等高骨架屏、以及双栏段落精准同步滚动能力。

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import Draggable, {
  type DraggableData,
  type DraggableEvent,
} from "react-draggable";
import { ResizableBox, type ResizeCallbackData } from "react-resizable";
import {
  FileText,
  Languages,
  Minimize2,
  X,
  AlertCircle,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { getTranslatedHtml } from "@/utils/dom/xml-converter";
import { browser } from "wxt/browser";
import { isHostPageDark } from "@/utils/dom/theme";

export interface SelectedElementSnapshot {
  id: string;
  index: number;
  summary: string;
  html: string;
  status?: "translating" | "success" | "error";
  translations?: Record<string, string>;
  errorMsg?: string;
}

interface WindowSize {
  width: number;
  height: number;
}

interface WindowPosition {
  x: number;
  y: number;
}

export interface TranslationWindowLayout {
  size: WindowSize;
  position: WindowPosition;
}

interface TranslationWindowProps {
  snapshots: SelectedElementSnapshot[];
  initialLayout?: TranslationWindowLayout;
  onLayoutChange?: (layout: TranslationWindowLayout) => void;
}

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 680;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 320;
const VIEWPORT_PADDING = 32;
const VIEWPORT_EDGE_PADDING = 16;

export function TranslationWindow({
  snapshots,
  initialLayout,
  onLayoutChange,
}: TranslationWindowProps) {
  const dragNodeRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize();
  const snapshotKey = snapshots.map((snapshot) => snapshot.id).join("|");

  const [size, setSize] = useState<WindowSize>(
    () =>
      getInitialLayout(initialLayout, window.innerWidth, window.innerHeight)
        .size,
  );
  const [position, setPosition] = useState<WindowPosition>(
    () =>
      getInitialLayout(initialLayout, window.innerWidth, window.innerHeight)
        .position,
  );
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // 初始化载入用户的主题配置，若无则根据网页深浅色自适应
  useEffect(() => {
    browser.storage.local.get("pageTranslate.theme").then((res) => {
      const savedTheme = res["pageTranslate.theme"];
      if (savedTheme === "light" || savedTheme === "dark") {
        setTheme(savedTheme);
      } else {
        setTheme(isHostPageDark() ? "dark" : "light");
      }
    });
  }, [snapshotKey]);

  // 当 theme 状态变更时，将 dark 类名动态增删到父级 Shadow UI 根节点，驱动 CSS 变量及类名覆盖生效
  useEffect(() => {
    const rootEl = dragNodeRef.current?.parentElement;
    const targetEl = rootEl || document.getElementById("page-translate-window-root");
    if (targetEl) {
      if (theme === "dark") {
        targetEl.classList.add("dark");
      } else {
        targetEl.classList.remove("dark");
      }
    }
  }, [theme]);

  const handleToggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    void browser.storage.local.set({ "pageTranslate.theme": nextTheme });
  };

  // 左右滚动容器的 Refs 和防止联动死锁的主动滚动锁
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const scrollLockRef = useRef<"left" | "right" | null>(null);

  useEffect(() => {
    // 视口变化时不重置用户拖拽过的位置，只把窗口尺寸和位置收敛到当前屏幕可见范围内。
    setSize((currentSize) => {
      const nextSize = clampSize(currentSize, viewport.width, viewport.height);
      setPosition((currentPosition) =>
        clampPosition(
          currentPosition,
          nextSize,
          viewport.width,
          viewport.height,
        ),
      );
      return nextSize;
    });
  }, [viewport.height, viewport.width]);

  useEffect(() => {
    // 新一轮翻译会替换 snapshots；无论旧弹窗之前是关闭还是最小化，都要重新展示新内容。
    setIsVisible(true);
    setIsMinimized(false);
    setPosition((currentPosition) =>
      clampPosition(currentPosition, size, viewport.width, viewport.height),
    );
  }, [snapshotKey]);

  const maxConstraints = useMemo<[number, number]>(
    () => [
      Math.max(MIN_WIDTH, viewport.width - VIEWPORT_PADDING),
      Math.max(MIN_HEIGHT, viewport.height - VIEWPORT_PADDING),
    ],
    [viewport.height, viewport.width],
  );

  const handleResize = (_event: SyntheticEvent, data: ResizeCallbackData) => {
    const nextSize = {
      width: data.size.width,
      height: data.size.height,
    };
    setSize(nextSize);
    setPosition((currentPosition) =>
      clampPosition(currentPosition, nextSize, viewport.width, viewport.height),
    );
  };

  const handleResizeStop = (
    _event: SyntheticEvent,
    data: ResizeCallbackData,
  ) => {
    const nextSize = {
      width: data.size.width,
      height: data.size.height,
    };
    const nextPosition = clampPosition(
      position,
      nextSize,
      viewport.width,
      viewport.height,
    );

    setSize(nextSize);
    setPosition(nextPosition);
    onLayoutChange?.({ size: nextSize, position: nextPosition });
  };

  const handleDragStop = (_event: DraggableEvent, data: DraggableData) => {
    const nextPosition = clampPosition(
      { x: data.x, y: data.y },
      size,
      viewport.width,
      viewport.height,
    );

    setPosition(nextPosition);
    onLayoutChange?.({ size, position: nextPosition });
  };

  const handleRestore = () => {
    setPosition((currentPosition) =>
      clampPosition(currentPosition, size, viewport.width, viewport.height),
    );
    setIsMinimized(false);
  };

  // 双栏精准段落对齐同步滚动算法
  const alignScrolling = (
    sourceEl: HTMLDivElement,
    targetEl: HTMLDivElement,
  ) => {
    const cards = Array.from(
      sourceEl.querySelectorAll("article[data-snapshot-id]"),
    );
    if (cards.length === 0) return;

    const viewportTop = sourceEl.getBoundingClientRect().top;
    let activeIndex = -1;
    let relativeOffset = 0;

    // 寻找当前处于源视口顶端（或首个未被完全滑出）的卡片
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const rect = card.getBoundingClientRect();
      if (rect.bottom > viewportTop + 4) {
        activeIndex = i;
        relativeOffset = rect.top - viewportTop; // 记录卡片头部偏离视口顶部的相对距离
        break;
      }
    }

    if (activeIndex !== -1) {
      const targetCards = Array.from(
        targetEl.querySelectorAll("article[data-snapshot-id]"),
      );
      const targetCard = targetCards[activeIndex];
      if (targetCard) {
        // 计算目标卡片在目标容器内的当前相对顶端位置
        const currentTargetCardTop =
          targetCard.getBoundingClientRect().top -
          targetEl.getBoundingClientRect().top;
        // 利用相对位置偏置的差值，更新目标容器的滚动距离以对齐
        targetEl.scrollTop += currentTargetCardTop - relativeOffset;
      }
    }
  };

  const handleLeftScroll = () => {
    if (scrollLockRef.current === "right") {
      // 释放由右侧联动引起的滚动锁定，避开死循环
      scrollLockRef.current = null;
      return;
    }
    const leftEl = leftScrollRef.current;
    const rightEl = rightScrollRef.current;
    if (!leftEl || !rightEl) return;

    scrollLockRef.current = "left";
    alignScrolling(leftEl, rightEl);
  };

  const handleRightScroll = () => {
    if (scrollLockRef.current === "left") {
      // 释放由左侧联动引起的滚动锁定，避开死循环
      scrollLockRef.current = null;
      return;
    }
    const leftEl = leftScrollRef.current;
    const rightEl = rightScrollRef.current;
    if (!leftEl || !rightEl) return;

    scrollLockRef.current = "right";
    alignScrolling(rightEl, leftEl);
  };

  if (!isVisible) return null;

  if (isMinimized) {
    return (
      <button
        type="button"
        className="pointer-events-auto fixed bottom-5 right-5 z-[2147483647] flex items-center gap-2 rounded-full border border-white/90 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-[0_18px_45px_rgba(15,23,42,0.22)] transition hover:bg-slate-50"
        onClick={handleRestore}
      >
        <Languages className="h-4 w-4 text-sky-700" />
        恢复翻译弹窗
      </button>
    );
  }

  return (
    <Draggable
      nodeRef={dragNodeRef}
      handle=".page-translate-window-drag-handle"
      cancel="button,a,input,textarea,.react-resizable-handle"
      bounds="parent"
      position={position}
      onStop={handleDragStop}
    >
      <div
        ref={dragNodeRef}
        className="pointer-events-auto fixed left-0 top-0 z-[2147483647]"
      >
        <ResizableBox
          width={size.width}
          height={size.height}
          minConstraints={[MIN_WIDTH, MIN_HEIGHT]}
          maxConstraints={maxConstraints}
          axis="both"
          handleSize={[18, 18]}
          lockAspectRatio={false}
          transformScale={1}
          onResize={handleResize}
          onResizeStop={handleResizeStop}
          resizeHandles={["se"]}
        >
          <section className="page-translate-window-panel flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-white/90 bg-[linear-gradient(145deg,_rgba(253,254,255,0.98)_0%,_rgba(246,251,255,0.96)_48%,_rgba(255,255,255,0.98)_100%)] text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <header className="page-translate-window-drag-handle flex cursor-move items-center justify-between border-b border-white/65 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-soft">
                  <Languages className="h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-[15px] font-semibold leading-5 text-slate-950">
                    对照翻译
                  </h1>
                  <p className="text-xs leading-5 text-slate-500">
                    已载入 {snapshots.length} 个原文片段
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  aria-label={theme === "light" ? "切换至深色模式" : "切换至浅色模式"}
                  variant="ghost"
                  size="icon"
                  className="text-slate-500 hover:bg-white/80 hover:text-slate-950 hover:shadow-sm"
                  onClick={handleToggleTheme}
                >
                  {theme === "light" ? (
                    <Moon className="h-4 w-4 text-slate-600" />
                  ) : (
                    <Sun className="h-4 w-4 text-amber-500" />
                  )}
                </Button>
                <Button
                  aria-label="最小化翻译弹窗"
                  variant="ghost"
                  size="icon"
                  className="text-slate-500 hover:bg-white/80 hover:text-slate-950 hover:shadow-sm"
                  onClick={() => setIsMinimized(true)}
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
                <Button
                  aria-label="关闭翻译弹窗"
                  variant="ghost"
                  size="icon"
                  className="text-slate-500 hover:bg-white/80 hover:text-red-600 hover:shadow-sm"
                  onClick={() => setIsVisible(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-0">
              <TranslationColumn
                title="原文"
                tone="source"
                scrollRef={leftScrollRef}
                onScroll={handleLeftScroll}
              >
                <div className="space-y-4">
                  {snapshots.map((snapshot) => (
                    <article
                      key={snapshot.id}
                      data-snapshot-id={snapshot.id}
                      className="page-translate-card rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
                    >
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                          {snapshot.index}
                        </span>
                        <span className="line-clamp-1">{snapshot.summary}</span>
                      </div>
                      <div
                        className="page-translate-original-content"
                        dangerouslySetInnerHTML={{ __html: snapshot.html }}
                      />
                    </article>
                  ))}
                </div>
              </TranslationColumn>

              <TranslationColumn
                title="译文"
                tone="target"
                scrollRef={rightScrollRef}
                onScroll={handleRightScroll}
              >
                <div className="space-y-4">
                  {snapshots.map((snapshot) => (
                    <article
                      key={snapshot.id}
                      data-snapshot-id={snapshot.id}
                      className={cn(
                        "page-translate-card rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm",
                        snapshot.status === "translating" &&
                          "page-translate-skeleton-loading",
                        snapshot.status === "error" &&
                          "border-rose-200 bg-rose-50/20",
                      )}
                    >
                      <div className="mb-3 flex items-center justify-between text-xs font-medium text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                            {snapshot.index}
                          </span>
                          <span className="line-clamp-1">
                            {snapshot.summary}
                          </span>
                        </div>
                        {snapshot.status === "translating" && (
                          <div className="flex items-center text-sky-600 gap-1.5 font-semibold">
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          </div>
                        )}
                      </div>

                      {snapshot.status === "error" ? (
                        <div className="flex items-start gap-2 text-rose-800 text-xs py-4 leading-5">
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                          <span className="break-all">
                            {snapshot.errorMsg || "翻译出错。"}
                          </span>
                        </div>
                      ) : (
                        <div
                          className="page-translate-original-content"
                          dangerouslySetInnerHTML={{
                            __html: getTranslatedHtml(
                              snapshot.html,
                              snapshot.translations || {},
                              snapshot.status !== "translating",
                            ),
                          }}
                        />
                      )}
                    </article>
                  ))}
                </div>
              </TranslationColumn>
            </div>
          </section>
        </ResizableBox>
      </div>
    </Draggable>
  );
}

interface TranslationColumnProps {
  title: string;
  tone: "source" | "target";
  children: ReactNode;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

function TranslationColumn({
  title,
  tone,
  children,
  scrollRef,
  onScroll,
}: TranslationColumnProps) {
  return (
    <section className="flex min-h-0 flex-col border-r border-white/70 last:border-r-0">
      <div className="flex items-center gap-2 border-b border-white/65 bg-white/45 px-4 py-2.5">
        <FileText
          className={cn(
            "h-4 w-4",
            tone === "source" ? "text-slate-600" : "text-sky-700",
          )}
        />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto px-4 py-4"
      >
        {children}
      </div>
    </section>
  );
}

function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}

function getDefaultSize(viewportWidth: number, viewportHeight: number) {
  return {
    width: Math.min(
      DEFAULT_WIDTH,
      Math.max(MIN_WIDTH, viewportWidth - VIEWPORT_PADDING),
    ),
    height: Math.min(
      DEFAULT_HEIGHT,
      Math.max(MIN_HEIGHT, viewportHeight - VIEWPORT_PADDING),
    ),
  };
}

function getInitialLayout(
  initialLayout: TranslationWindowLayout | undefined,
  viewportWidth: number,
  viewportHeight: number,
): TranslationWindowLayout {
  const defaultSize = getDefaultSize(viewportWidth, viewportHeight);
  const size = initialLayout
    ? clampSize(initialLayout.size, viewportWidth, viewportHeight)
    : defaultSize;

  return {
    size,
    position: clampPosition(
      initialLayout?.position ?? getDefaultPosition(viewportWidth, size.width),
      size,
      viewportWidth,
      viewportHeight,
    ),
  };
}

function getDefaultPosition(viewportWidth: number, windowWidth: number) {
  return {
    x: Math.max(
      VIEWPORT_EDGE_PADDING,
      (viewportWidth - windowWidth - VIEWPORT_EDGE_PADDING) / 2,
    ),
    y: 128,
  };
}

function clampSize(
  size: { width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    width: Math.min(
      Math.max(size.width, MIN_WIDTH),
      Math.max(MIN_WIDTH, viewportWidth - VIEWPORT_PADDING),
    ),
    height: Math.min(
      Math.max(size.height, MIN_HEIGHT),
      Math.max(MIN_HEIGHT, viewportHeight - VIEWPORT_PADDING),
    ),
  };
}

function clampPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
) {
  const maxX = Math.max(
    VIEWPORT_EDGE_PADDING,
    viewportWidth - size.width - VIEWPORT_EDGE_PADDING,
  );
  const maxY = Math.max(
    VIEWPORT_EDGE_PADDING,
    viewportHeight - size.height - VIEWPORT_EDGE_PADDING,
  );

  return {
    x: Math.min(Math.max(position.x, VIEWPORT_EDGE_PADDING), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_EDGE_PADDING), maxY),
  };
}
