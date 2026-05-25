import type { ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";
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
  return (
    <section
      className={cn(
        "flex h-[532px] flex-col bg-[linear-gradient(180deg,_#f8fbff_0%,_#f3f6fa_100%)]",
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

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        <Card className="space-y-3 border-slate-200/80 bg-white p-3.5">
          <Field label="Base URL">
            <Input
              placeholder="https://api.openai.com/v1"
              defaultValue="https://api.example.com/v1"
            />
          </Field>
          <Field label="API Token">
            <Input
              type="password"
              placeholder="sk-..."
              defaultValue="mock-token-for-preview"
            />
          </Field>
          <div className="grid grid-cols-[1.15fr_0.85fr] gap-2.5">
            <Field label="模型名称">
              <Input placeholder="gpt-4.1-mini" defaultValue="gpt-4.1-mini" />
            </Field>
            <Field label="目标语言">
              <Input placeholder="中文" defaultValue="中文" />
            </Field>
          </div>
          <Field label="系统提示">
            <Textarea defaultValue="保持原文结构，只返回结构化文本节点译文。" />
          </Field>
        </Card>
      </div>

      <footer className="space-y-2 border-t border-white/55 bg-white/50 px-4 py-3.5">
        <Button variant="outline" className="w-full">
          <Loader2 className="h-4 w-4" />
          测试连通性
        </Button>
        <Button className="w-full bg-stone-800 text-white hover:bg-stone-950">
          <CheckCircle2 className="h-4 w-4" />
          保存配置
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
      <Label>{label}</Label>
      {children}
    </div>
  );
}
