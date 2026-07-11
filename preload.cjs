const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clara", {
  send: (conversationId, text, context) =>
    ipcRenderer.invoke("clara:send", { conversationId, text, context }),
  abort: (conversationId) => ipcRenderer.send("clara:abort", { conversationId }),
  warmup: (conversationId) => ipcRenderer.send("clara:warmup", { conversationId }),
  onEvent: (fn) => {
    ipcRenderer.on("clara:event", (_event, payload) => fn(payload));
  },

  // Tool requests from main (open-tab, read-page, interact). Each carries a
  // requestId; the renderer answers with reply(kind, requestId, result).
  onToolRequest: (kind, fn) => {
    ipcRenderer.on(`clara:${kind}`, (_event, payload) => fn(payload));
  },
  reply: (kind, requestId, result) =>
    ipcRenderer.send(`clara:${kind}-done:${requestId}`, result),

  // Tab lifecycle reports so main can answer list_tabs synchronously.
  tabUpdated: (conversationId, tab) =>
    ipcRenderer.send("clara:tab-updated", { conversationId, tab }),
  tabClosed: (conversationId, tabId) =>
    ipcRenderer.send("clara:tab-closed", { conversationId, tabId }),

  // Page snapshots for the browsing-history archive.
  pageCaptured: (payload) => ipcRenderer.send("clara:page-captured", payload),

  // Denied window.open/target=_blank popups, redirected into Clara tabs.
  onPopup: (fn) => {
    ipcRenderer.on("clara:popup", (_event, payload) => fn(payload));
  },

  // Finished downloads (saved to ~/Downloads).
  onDownloadDone: (fn) => {
    ipcRenderer.on("clara:download-done", (_event, payload) => fn(payload));
  },

  // One-off utility prompt (group-home summaries); resolves with HTML text.
  summarize: (prompt) => ipcRenderer.invoke("clara:summarize", { prompt }),

  // Session persistence.
  loadSession: () => ipcRenderer.invoke("clara:load-session"),
  saveSession: (state) => ipcRenderer.send("clara:save-session", state),
  registerResume: (conversationId, threadId) =>
    ipcRenderer.send("clara:register-resume", { conversationId, threadId }),
});
