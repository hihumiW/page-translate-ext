import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Page Translate Compare",
    description: "Select page containers and preview side-by-side translation controls.",
    permissions: ["storage", "activeTab", "scripting"],
    action: {
      default_title: "打开网页对照翻译",
    },
  },
});
