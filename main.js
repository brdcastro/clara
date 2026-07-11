import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "./agent/agent.js";
import { startMcpServer } from "./agent/mcp-server.js";
import { createHistory } from "./agent/history.js";
import { createStore } from "./agent/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const history = createHistory(path.join(__dirname, "agent-home"));
const store = createStore(app.getPath("userData"));

let win = null;
let agent = null;

// Main-process mirror of the renderer's tab registry, so list_tabs can be
// answered synchronously. conversationId -> Map<tabId, {tabId, url, title}>
const tabs = new Map();

let requestCounter = 0;

// Tool round-trips: ask the renderer to do something (open a card, extract a
// page, perform an action), wait for its reply or time out. The renderer
// answers on `clara:<kind>-done:<requestId>`.
function askRenderer(kind, payload, timeoutMs) {
  if (!win) return Promise.resolve({ error: "window not ready" });
  return new Promise((resolve) => {
    const requestId = `${kind}-${++requestCounter}`;
    const channel = `clara:${kind}-done:${requestId}`;
    const timer = setTimeout(() => {
      ipcMain.removeAllListeners(channel);
      resolve({ error: "timed out" });
    }, timeoutMs);
    ipcMain.once(channel, (_event, result) => {
      clearTimeout(timer);
      resolve(result);
    });
    win.webContents.send(`clara:${kind}`, { requestId, ...payload });
  });
}

const bridge = {
  openUrl: (conversationId, url) =>
    askRenderer("open-tab", { conversationId, url }, 15000),
  listTabs: (conversationId) => [...(tabs.get(conversationId)?.values() ?? [])],
  readPage: async (conversationId, tabId) => {
    const result = await askRenderer("read-page", { conversationId, tabId }, 15000);
    // Agent reads are the freshest snapshots — archive them too.
    if (!result.error) history.record(result);
    return result;
  },
  // Long timeout: the first interaction on a tab waits for user consent.
  interact: (conversationId, tabId, action) =>
    askRenderer("interact", { conversationId, tabId, action }, 120000),
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    // Translucent blurred sidebar (macOS vibrancy); the main area paints its
    // own solid background in CSS.
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      webviewTag: true,
    },
  });
  win.loadFile("renderer/index.html");
}

// Links that would open a new window (target=_blank, window.open) become
// Clara tabs instead: deny the popup and hand the URL to the renderer, which
// opens it as a sibling tab in the origin's group.
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url, disposition }) => {
    win?.webContents.send("clara:popup", {
      sourceWebContentsId: contents.id,
      url,
      disposition,
    });
    return { action: "deny" };
  });
});

app.whenReady().then(async () => {
  const { port } = await startMcpServer(bridge);
  agent = new AgentService({ mcpPort: port });
  createWindow();

  // One-off utility prompts (e.g. group-home summaries) on a shared thread.
  ipcMain.handle("clara:summarize", (_event, { prompt }) =>
    agent.summarize(prompt)
  );

  ipcMain.handle("clara:send", (_event, { conversationId, text }) =>
    agent.send(conversationId, text, (event) => {
      win?.webContents.send("clara:event", { conversationId, event });
    })
  );

  ipcMain.on("clara:abort", (_event, { conversationId }) => {
    agent.abort(conversationId);
  });

  ipcMain.on("clara:warmup", (_event, { conversationId }) => {
    agent.warmup(conversationId);
  });

  // Session persistence: the renderer rehydrates from this on boot, then
  // pushes snapshots as state changes. Thread ids are merged in from the
  // agent (authoritative) so conversations resume the right Codex thread.
  ipcMain.handle("clara:load-session", () => store.load());

  ipcMain.on("clara:register-resume", (_event, { conversationId, threadId }) => {
    agent.registerResume(conversationId, threadId);
  });

  ipcMain.on("clara:save-session", (_event, state) => {
    for (const conv of state.conversations ?? []) {
      conv.threadId = agent.threadId(conv.id) ?? conv.threadId ?? null;
    }
    store.save(state);
  });

  ipcMain.on("clara:tab-updated", (_event, { conversationId, tab }) => {
    if (!tabs.has(conversationId)) tabs.set(conversationId, new Map());
    tabs.get(conversationId).set(tab.tabId, tab);
  });

  ipcMain.on("clara:tab-closed", (_event, { conversationId, tabId }) => {
    tabs.get(conversationId)?.delete(tabId);
  });

  ipcMain.on("clara:page-captured", (_event, payload) => {
    history.record(payload);
  });
});

app.on("window-all-closed", () => app.quit());
