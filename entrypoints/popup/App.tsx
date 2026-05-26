import { useEffect, useMemo, useState } from "react";
import { ContainerManager } from "@/components/popup/ContainerManager";
import { mockContainers } from "@/components/popup/mock-containers";
import { SettingsPanel } from "@/components/popup/SettingsPanel";
import type { PopupSurface, SelectedContainer } from "@/components/popup/types";
import { getLLMConfig, getPageContext, savePageContext } from "@/utils/storage/config";
import { cn } from "@/utils/cn";
import { isHostPageDark } from "@/utils/dom/theme";

type PopupView = "containers" | "settings";

interface AppProps {
  surface?: PopupSurface;
  containers?: SelectedContainer[];
  isSelecting?: boolean;
  onStartSelecting?: () => void;
  onStopSelecting?: () => void;
  onClearSelection?: () => void;
  onRemoveContainer?: (id: string) => void;
  onStartTranslation?: () => void;
  onClose?: () => void;
  translationError?: string;
}

function App({
  surface = "popup",
  containers = mockContainers,
  isSelecting = false,
  onStartSelecting,
  onStopSelecting,
  onClearSelection,
  onRemoveContainer,
  onStartTranslation,
  onClose,
  translationError,
}: AppProps) {
  const [view, setView] = useState<PopupView>("containers");
  const [isConfigValid, setIsConfigValid] = useState(false);
  const isDark = useMemo(() => isHostPageDark(), []);
  
  // 页面上下文相关状态
  const [pageContext, setPageContext] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  const currentHost = useMemo(() => {
    return typeof window !== "undefined" ? window.location.host : "";
  }, []);

  useEffect(() => {
    // 每次进入容器管理页面或初始化时，重新加载一次 LLM 配置校验其有效性，并载入页面上下文
    if (view === "containers") {
      getLLMConfig().then((config) => {
        // 校验基础配置：有 Base URL 即可（API Token 在本地部署时可为空）
        const isValid = !!(config && config.baseUrl && config.baseUrl.trim() !== "");
        setIsConfigValid(isValid);
      });

      if (currentHost) {
        getPageContext(currentHost).then((context) => {
          setPageContext(context);
        });
      }
    }
  }, [view, currentHost]);

  // 手动点击魔法棒，智能抓取清洗网页的 Title 与 Meta Description 并填入
  const handleAutoExtract = async () => {
    if (!currentHost) return;
    setIsExtracting(true);
    // 模拟一个小延时以便给用户清晰的 AI 提取动效反馈
    await new Promise((resolve) => setTimeout(resolve, 400));
    
    try {
      const title = document.title || "";
      const descMeta = document.querySelector('meta[name="description"]');
      const description = descMeta?.getAttribute("content") || "";

      // 清洗 Title 噪音后缀 (如 " - Google 搜索" 或 " | GitHub")
      let cleanTitle = title;
      const separators = [" - ", " | ", " _ "];
      for (const sep of separators) {
        if (title.includes(sep)) {
          cleanTitle = title.split(sep)[0];
          break;
        }
      }
      cleanTitle = cleanTitle.trim();

      let extracted = cleanTitle;
      if (description) {
        const cleanDesc = description.trim().slice(0, 80);
        extracted = `${cleanTitle} (${cleanDesc}...)`;
      }

      setPageContext(extracted);
      // 提取后直接静默保存，优化用户交互路径
      await savePageContext(currentHost, extracted);
    } catch (e) {
      console.error("Failed to auto extract page context:", e);
    } finally {
      setIsExtracting(false);
    }
  };

  // 失去焦点时自动保存。非空保存，空值清理缓存
  const handlePageContextSave = async () => {
    if (!currentHost) return;
    try {
      await savePageContext(currentHost, pageContext);
    } catch (e) {
      console.error("Failed to auto save page context:", e);
    }
  };

  const selectedCount = containers.length;
  
  // 必须配置有效且至少有一个未丢失的容器，才允许开始翻译
  const canTranslate = useMemo(
    () => isConfigValid && containers.some((item) => item.status !== "lost"),
    [isConfigValid, containers],
  );
  
  const isFloating = surface === "floating";

  // 合并传给 ContainerManager 的错误提示：优先展示翻译过程中的异常，若配置不完整则引导用户进行配置
  const mergedError = useMemo(() => {
    if (translationError) return translationError;
    if (!isConfigValid) {
      return "请点击右上角齿轮图标，配置大模型 API 接口后再开始翻译。";
    }
    return undefined;
  }, [translationError, isConfigValid]);

  return (
    <main
      className={cn(
        "overflow-hidden bg-transparent",
        isDark && "dark",
        isFloating
          ? cn(
              "pointer-events-auto w-[390px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] rounded-[24px] border shadow-[0_24px_80px_rgba(15,23,42,0.24)]",
              isDark
                ? "border-slate-800/90 bg-[linear-gradient(145deg,_rgba(15,23,42,0.98)_0%,_rgba(30,41,59,0.96)_48%,_rgba(15,23,42,0.98)_100%)] text-slate-100"
                : "border-white/90 bg-[linear-gradient(145deg,_rgba(253,254,255,0.98)_0%,_rgba(246,251,255,0.96)_48%,_rgba(255,255,255,0.98)_100%)] text-slate-950"
            )
          : "min-h-[532px]",
      )}
    >
      {view === "containers" ? (
        <ContainerManager
          surface={surface}
          containers={containers}
          selectedCount={selectedCount}
          canTranslate={canTranslate}
          isSelecting={isSelecting}
          onOpenSettings={() => setView("settings")}
          onStartSelecting={onStartSelecting}
          onStopSelecting={onStopSelecting}
          onClearSelection={onClearSelection}
          onRemoveContainer={onRemoveContainer}
          onStartTranslation={onStartTranslation}
          onClose={onClose}
          translationError={mergedError}
          // 对接页面上下文参数
          pageContext={pageContext}
          onPageContextChange={setPageContext}
          onPageContextSave={handlePageContextSave}
          onAutoExtract={handleAutoExtract}
          isExtracting={isExtracting}
        />
      ) : (
        <SettingsPanel
          surface={surface}
          onBack={() => setView("containers")}
          onClose={onClose}
        />
      )}
    </main>
  );
}

export default App;
