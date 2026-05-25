// 该组件负责渲染网页内的对照翻译弹窗。
// 当前阶段只展示原文快照和译文占位，同时提供拖拽、缩放、关闭隐藏和最小化恢复能力。

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
import { FileText, Languages, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

export interface SelectedElementSnapshot {
  id: string;
  index: number;
  summary: string;
  html: string;
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
    // resize 尺寸保存在组件状态中，后续最小化/恢复时可以维持用户刚刚调整过的窗口大小。
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
    // 拖拽结束时记录实际位置；恢复最小化时继续使用这个受控位置，不再回到默认右上角。
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
    // 恢复前再次 clamp，可以覆盖 DevTools 开关、窗口缩小等导致的旧位置越界。
    setPosition((currentPosition) =>
      clampPosition(currentPosition, size, viewport.width, viewport.height),
    );
    setIsMinimized(false);
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
          <section className="flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-white/90 bg-[linear-gradient(145deg,_rgba(253,254,255,0.98)_0%,_rgba(246,251,255,0.96)_48%,_rgba(255,255,255,0.98)_100%)] text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
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
              <TranslationColumn title="原文" tone="source">
                <div className="space-y-4">
                  {snapshots.map((snapshot) => (
                    <article
                      key={snapshot.id}
                      className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
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

              <TranslationColumn title="译文" tone="target">
                <div className="flex min-h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 p-6 text-center">
                  <div className="max-w-[260px] space-y-3">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                      <Maximize2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-900">
                        译文待接入
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        本轮先完成原文快照和弹窗交互，后续再接入 LLM
                        翻译结果回填。
                      </p>
                    </div>
                  </div>
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
}

function TranslationColumn({ title, tone, children }: TranslationColumnProps) {
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
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
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
