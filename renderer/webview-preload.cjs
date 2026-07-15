/* Trusted guest preload: report deliberate pointer/scroll engagement to the
   host renderer. Remote pages cannot access ipcRenderer through this file. */

const { ipcRenderer } = require("electron");

let lastNotice = 0;

function reportEngagement(event) {
  if (!event.isTrusted) return;
  const now = Date.now();
  if (now - lastNotice < 120) return;
  lastNotice = now;
  ipcRenderer.sendToHost("clara:engaged", { type: event.type });
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("pointerdown", reportEngagement, true);
  document.addEventListener("wheel", reportEngagement, { capture: true, passive: true });
});
