import { browser } from "wxt/browser";

export default defineBackground(() => {
  console.info("Page Translate Compare background is ready.");

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    await browser.tabs
      .sendMessage(tab.id, { type: "PAGE_TRANSLATE_TOGGLE_FLOATING_POPUP" })
      .catch((error) => {
        console.warn("Unable to toggle floating popup on this tab.", error);
      });
  });
});
