import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Page Translate",
    description:
      "选择网页上的文本，打开翻译弹窗对照原文和译文，提升外语阅读体验。基于 LLM 的翻译能力，支持多种语言互译。",
    permissions: ["storage", "activeTab", "scripting"],
    action: {
      default_title: "打开网页对照翻译",
    },
  },
});
