import {
  Eraser,
  Languages,
  MousePointer2,
  Play,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { statusMeta, type PopupSurface, type SelectedContainer } from "./types";

interface ContainerManagerProps {
  surface: PopupSurface;
  containers: SelectedContainer[];
  selectedCount: number;
  canTranslate: boolean;
  isSelecting?: boolean;
  onOpenSettings: () => void;
  onStartSelecting?: () => void;
  onStopSelecting?: () => void;
  onClearSelection?: () => void;
  onRemoveContainer?: (id: string) => void;
  onStartTranslation?: () => void;
  onClose?: () => void;
  translationError?: string;
}

export function ContainerManager({
  surface,
  containers,
  selectedCount,
  canTranslate,
  isSelecting = false,
  onOpenSettings,
  onStartSelecting,
  onStopSelecting,
  onClearSelection,
  onRemoveContainer,
  onStartTranslation,
  onClose,
  translationError,
}: ContainerManagerProps) {
  // 空列表时展示占位卡片；有数据时展示 content script 同步过来的真实选择结果。
  const hasContainers = containers.length > 0;

  return (
    <section
      className={cn(
        "flex h-[532px] flex-col",
        surface === "floating" &&
          "h-[min(532px,calc(100vh-32px))] max-h-[calc(100vh-32px)] rounded-[24px] bg-transparent",
      )}
    >
      <header className="flex items-start justify-between border-b border-white/55 px-4 py-3.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-soft">
              <Languages className="h-4 w-4" />
            </div>
            <h1 className="text-[15px] font-semibold leading-5 text-slate-950">
              网页对照翻译
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            aria-label="打开配置"
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:bg-white/80 hover:text-slate-950 hover:shadow-sm"
            onClick={onOpenSettings}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            aria-label="关闭弹窗"
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:bg-white/80 hover:text-red-600 hover:shadow-sm"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              已选容器
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-slate-500 hover:bg-white/70 hover:text-slate-900"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
          </div>

          {hasContainers ? (
            <div className="space-y-2">
              {containers.map((container) => {
                const meta = statusMeta[container.status];

                return (
                  <Card
                    key={container.id}
                    className={cn(
                      "border-slate-200/80 bg-white px-3 py-3 transition-colors",
                      container.status === "lost" && "bg-amber-50/45",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                        {container.index}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="line-clamp-2 text-[13px] leading-5 text-slate-700">
                          {container.summary}
                        </p>
                        {container.message ? (
                          <p className="text-xs leading-5 text-amber-700">
                            {container.message}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="删除容器"
                            onClick={() => onRemoveContainer?.(container.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="flex min-h-[260px] mt-6 items-center justify-center border-dashed border-slate-200/90 bg-white/72 px-6 py-8 text-center shadow-none">
              <div className="space-y-3">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                  <MousePointer2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-900">
                    暂无已选容器
                  </p>
                  <p className="text-xs leading-5 text-slate-500">
                    点击下方“选择”，在网页中选择需要对照翻译的内容区域。
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <footer className="space-y-2 border-t border-t-white/55 bg-white/50 px-4 py-3.5">
        {translationError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {translationError}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={isSelecting ? "secondary" : "outline"}
            size="sm"
            className={cn(
              isSelecting &&
                "bg-sky-100 text-sky-800 hover:bg-sky-200 hover:text-sky-900",
            )}
            onClick={isSelecting ? onStopSelecting : onStartSelecting}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            {isSelecting ? "退出选择" : "选择"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClearSelection}>
            <Eraser className="h-3.5 w-3.5" />
            清空
          </Button>
        </div>
        <Button
          className="w-full bg-stone-800 text-white hover:bg-stone-950"
          disabled={!canTranslate}
          onClick={onStartTranslation}
        >
          <Play className="h-4 w-4" />
          开始翻译
        </Button>
      </footer>
    </section>
  );
}
