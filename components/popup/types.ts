export type PopupSurface = "popup" | "floating";

export type ContainerStatus =
  | "valid"
  | "lost"
  | "translating"
  | "translated"
  | "failed";

export interface SelectedContainer {
  id: string;
  index: number;
  summary: string;
  status: ContainerStatus;
  message?: string;
}

export const statusMeta: Record<
  ContainerStatus,
  { label: string; tone: "green" | "blue" | "amber" | "red" | "slate" }
> = {
  valid: { label: "有效", tone: "green" },
  lost: { label: "已丢失", tone: "amber" },
  translating: { label: "翻译中", tone: "blue" },
  translated: { label: "已翻译", tone: "green" },
  failed: { label: "失败", tone: "red" },
};
