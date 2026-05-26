import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/cn";
import { getLLMConfig, saveLLMConfig, type LLMConfig } from "@/utils/storage/config";
import { browser } from "wxt/browser";
import type { PopupSurface } from "./types";

interface SettingsPanelProps {
  surface: PopupSurface;
  onBack: () => void;
  onClose?: () => void;
}

export function SettingsPanel({
  surface,
  onBack,
  onClose,
}: SettingsPanelProps) {
  const [config, setConfig] = useState<LLMConfig>({
    baseUrl: "",
    apiToken: "",
    modelName: "",
    targetLang: "",
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getLLMConfig().then((data) => {
      setConfig(data);
      setLoading(false);
    });
  }, []);

  // 监听测试结果的变化，若有结果则自动平滑滚动到底部
  useEffect(() => {
    if (testResult && scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 60);
    }
  }, [testResult]);

  const handleChange = (key: keyof LLMConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setTestResult(null); // 修改参数后清除测试结果
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveLLMConfig(config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error("Failed to save LLM config:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.baseUrl) {
      setTestResult({ success: false, message: "请先输入 Base URL。" });
      setTestStatus("failed");
      setTimeout(() => setTestStatus("idle"), 2000);
      return;
    }
    setIsTesting(true);
    setTestStatus("testing");
    setTestResult(null);
    try {
      const res = (await browser.runtime.sendMessage({
        type: "PAGE_TRANSLATE_TEST_CONNECTION",
        config: {
          baseUrl: config.baseUrl,
          apiToken: config.apiToken,
          modelName: config.modelName,
        },
      })) as { success: boolean; error?: string };

      if (res && res.success) {
        setTestResult({
          success: true,
          message: "连接测试成功！大模型接口联通正常。",
        });
        setTestStatus("success");
      } else {
        setTestResult({
          success: false,
          message: res?.error || "连接测试失败，请检查配置信息。",
        });
        setTestStatus("failed");
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `通信异常: ${err.message || String(err)}。请确认插件后台 background 服务运行正常。`,
      });
      setTestStatus("failed");
    } finally {
      setIsTesting(false);
      // 展示结果 2 秒后恢复初始按钮状态
      setTimeout(() => setTestStatus("idle"), 2000);
    }
  };

  if (loading) {
    return (
      <div className={cn(
        "flex h-[532px] items-center justify-center bg-[linear-gradient(180deg,_#f8fbff_0%,_#f3f6fa_100%)]",
        surface === "floating" && "h-[min(532px,calc(100vh-32px))] rounded-[24px]"
      )}>
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section
      className={cn(
        "page-translate-settings-panel flex h-[532px] flex-col bg-[linear-gradient(180deg,_#f8fbff_0%,_#f3f6fa_100%)]",
        surface === "floating" &&
          "h-[min(532px,calc(100vh-32px))] max-h-[calc(100vh-32px)] rounded-[24px] bg-transparent",
      )}
    >
      <header className="flex items-center justify-between border-b border-white/55 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Button
            aria-label="返回容器管理"
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:bg-white/80 hover:text-slate-950 hover:shadow-sm"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-[15px] font-semibold leading-5 text-slate-950">
              LLM 配置
            </h1>
          </div>
        </div>

        <Button
          aria-label="关闭弹窗"
          variant="ghost"
          size="icon"
          className="text-slate-500 hover:bg-white/80 hover:text-red-600 hover:shadow-sm"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div 
        ref={scrollContainerRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5"
      >
        <Card className="space-y-3.5 border-slate-200/80 bg-white p-3.5">
          <Field label="Base URL">
            <Input
              placeholder="https://api.openai.com/v1"
              value={config.baseUrl}
              onChange={(e) => handleChange("baseUrl", e.target.value)}
            />
          </Field>
          <Field label="API Token">
            <Input
              type="password"
              placeholder="sk-..."
              value={config.apiToken}
              onChange={(e) => handleChange("apiToken", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-[1.15fr_0.85fr] gap-2.5">
            <Field label="模型名称">
              <Input 
                placeholder="gpt-4o-mini" 
                value={config.modelName}
                onChange={(e) => handleChange("modelName", e.target.value)}
              />
            </Field>
            <Field label="目标语言">
              <Input 
                placeholder="中文" 
                value={config.targetLang}
                onChange={(e) => handleChange("targetLang", e.target.value)}
              />
            </Field>
          </div>
        </Card>

        {testResult && (
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-3.5 text-xs leading-5",
              testResult.success
                ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
                : "border-rose-200 bg-rose-50/60 text-rose-800"
            )}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            )}
            <span className="break-all">{testResult.message}</span>
          </div>
        )}
      </div>

      <footer className="space-y-2 border-t border-white/55 bg-white/50 px-4 py-3.5">
        <Button 
          variant="outline" 
          className={cn(
            "w-full transition-all duration-300",
            testStatus === "success" && "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800",
            testStatus === "failed" && "border-rose-500 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800",
          )}
          onClick={handleTestConnection}
          disabled={isTesting || testStatus !== "idle"}
        >
          {testStatus === "testing" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-slate-500 mr-2" />
              正在测试连接...
            </>
          ) : testStatus === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mr-2" />
              测试成功！
            </>
          ) : testStatus === "failed" ? (
            <>
              <AlertCircle className="h-4 w-4 text-rose-600 mr-2" />
              测试失败！
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 text-slate-500 mr-2" />
              测试连通性
            </>
          )}
        </Button>
        <Button 
          className="w-full bg-stone-800 text-white hover:bg-stone-950"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              正在保存...
            </>
          ) : saveSuccess ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400 mr-2" />
              保存成功！
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              保存配置
            </>
          )}
        </Button>
      </footer>
    </section>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-700 font-medium text-xs">{label}</Label>
      {children}
    </div>
  );
}
