import { useMemo, useState } from "react";
import { ContainerManager } from "@/components/popup/ContainerManager";
import { mockContainers } from "@/components/popup/mock-containers";
import { SettingsPanel } from "@/components/popup/SettingsPanel";
import type { PopupSurface, SelectedContainer } from "@/components/popup/types";
import { cn } from "@/utils/cn";

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
  const selectedCount = containers.length;
  const canTranslate = useMemo(
    () => containers.some((item) => item.status !== "lost"),
    [containers],
  );
  const isFloating = surface === "floating";

  return (
    <main
      className={cn(
        "overflow-hidden bg-transparent",
        isFloating
          ? "pointer-events-auto w-[390px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] rounded-[24px] border border-white/90 bg-[linear-gradient(145deg,_rgba(253,254,255,0.98)_0%,_rgba(246,251,255,0.96)_48%,_rgba(255,255,255,0.98)_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
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
          translationError={translationError}
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
