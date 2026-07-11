/* Clara renderer — conversations, floating chat overlay, stage, composer.
   Layout model: with no site open a conversation is a normal feed; once a
   tab exists the site takes the whole main area (the stage) and the chat
   becomes a floating overlay above the composer, collapsed to the last
   user/agent exchange. Scrolling over the bubbles expands the history;
   interacting with the site collapses it again. */

const feedsEl = document.getElementById("feeds");
const itemListEl = document.getElementById("item-list");
const newConvBtn = document.getElementById("new-conv");
const newGroupBtn = document.getElementById("new-group");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stageEl = document.getElementById("stage");
const stageViewsEl = document.getElementById("stage-views");
const stageHead = stageEl.querySelector(".site-head");
const composerWrapEl = document.getElementById("composer-wrap");
const groupHomeEl = document.getElementById("group-home");
const homeTitleEl = groupHomeEl.querySelector(".home-title");
const homeSummaryEl = groupHomeEl.querySelector(".home-summary");
const homeGridEl = groupHomeEl.querySelector(".home-grid");

const conversations = new Map();
// Sidebar groups: user-made collections of items. A conversation lives in at
// most one group; ungrouped ones render at the root.
const groups = new Map(); // id -> { id, name, collapsed, convIds: [] }
let activeId = null;
let activeHome = null; // groupId whose home page is on stage, or null
let nextId = 1;
let nextTabId = 1;
let nextGroupId = 1;
let activeConsent = null; // { tabId, finish }

const session = window.ClaraSession({
  conversations,
  groups,
  getActiveId: () => activeId,
  getCounters: () => ({ nextId, nextTabId, nextGroupId }),
});

const SUGGESTIONS = [
  "Como funcionam juros compostos? Me dá um simulador",
  "Abre o site do Hacker News",
  "Uma calculadora de gorjeta",
];

/* ── Card HTML wrapper ───────────────────────────────── */

const CARD_STYLE = `
  :root {
    --bg:#F8F7F3; --surface:#FFFFFF; --ink:#1C1612; --ink-dim:#3B3128;
    --ink-muted:#6C5E4E; --accent:#0D8FF0; --border:#E6DFD1;
    --serif:"EB Garamond",Georgia,serif; --sans:"Inter",system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,monospace;
  }
  html,body { margin:0; background:transparent; color:var(--ink);
    font:14.5px/1.55 var(--sans); -webkit-font-smoothing:antialiased; }
  body { padding:18px 22px; }
  h1,h2,h3,h4 { font-family:var(--serif); font-weight:600; line-height:1.25; margin:0 0 .5em; }
  h1 { font-size:24px; } h2 { font-size:20px; } h3 { font-size:17px; }
  p { margin:0 0 .7em; } p:last-child { margin-bottom:0; }
  a { color:var(--accent); }
  ul,ol { margin:0 0 .7em; padding-left:1.3em; }
  table { border-collapse:collapse; width:100%; margin:0 0 .7em; }
  th,td { border-bottom:1px solid var(--border); padding:7px 10px; text-align:left; }
  th { font-family:var(--mono); font-size:10.5px; text-transform:uppercase;
    letter-spacing:.07em; color:var(--ink-muted); font-weight:500; }
  code { font-family:var(--mono); font-size:.88em; background:var(--bg);
    padding:1px 5px; border-radius:4px; }
  pre { background:var(--bg); border:1px solid var(--border); border-radius:8px;
    padding:12px 14px; overflow-x:auto; margin:0 0 .7em; }
  pre code { background:none; padding:0; }
  button,input,select { font-family:var(--sans); font-size:14px; }
`;

const FONTS_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&family=Inter:opsz,wght@14..32,100..900&family=JetBrains+Mono:wght@400;500;700&display=swap">';

function wrapCardHtml(html) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS_LINK}<style>${CARD_STYLE}</style></head><body>${html}<script>
    const report = () => parent.postMessage({ type: "clara:height", h: document.body.scrollHeight + 2 }, "*");
    new ResizeObserver(report).observe(document.body);
    addEventListener("load", report);
    report();
  <\/script></body></html>`;
}

function stripFences(text) {
  const match = text.match(/^\s*```(?:html)?\s*([\s\S]*?)\s*```\s*$/);
  return match ? match[1] : text;
}

window.addEventListener("message", (event) => {
  if (event.data?.type !== "clara:height") return;
  for (const iframe of document.querySelectorAll(".card-ai iframe")) {
    if (iframe.contentWindow === event.source) {
      iframe.style.height = Math.min(event.data.h, 640) + "px";
    }
  }
});

/* ── Conversations ───────────────────────────────────── */

function createConversation({ warmup = true, restore = null } = {}) {
  const id = restore?.id ?? `conv-${nextId++}`;
  const feedEl = document.createElement("div");
  feedEl.className = "feed";
  const innerEl = document.createElement("div");
  innerEl.className = "feed-inner";
  feedEl.appendChild(innerEl);
  feedsEl.appendChild(feedEl);

  const conv = {
    id,
    title: restore?.title ?? null,
    threadId: restore?.threadId ?? null,
    feedEl,
    innerEl,
    running: false,
    statusEl: null,
    messages: [], // { role: "user"|"ai"|"error", text?, html? }
    tabs: new Map(), // tabId -> { tabId, url, title, favicon, webview, interactAllowed }
    activeTabId: restore?.activeTabId ?? null,
  };
  conversations.set(id, conv);

  if (restore) {
    if (conv.threadId) window.clara.registerResume(id, conv.threadId);
    for (const msg of restore.messages ?? []) replayMessage(conv, msg);
    if (!conv.messages.length) renderEmptyState(conv);
    return conv; // caller handles tabs, sidebar, activation
  }

  renderEmptyState(conv);
  renderSidebar();
  activate(id);
  if (warmup) window.clara.warmup(id);
  session.scheduleSave();
  return conv;
}

function activate(id) {
  activeId = id;
  activeHome = null;
  for (const [cid, conv] of conversations) {
    conv.feedEl.classList.toggle("active", cid === id);
  }
  renderSidebar();
  syncMode();
  updateComposer();
  inputEl.focus();
}

function activeConv() {
  return conversations.get(activeId) ?? null;
}

/* ── Unified sidebar: items (chat+tabs) and custom groups ── */

function groupOf(convId) {
  for (const group of groups.values()) {
    if (group.convIds.includes(convId)) return group;
  }
  return null;
}

function moveToGroup(convId, groupId) {
  const current = groupOf(convId);
  if (current) current.convIds = current.convIds.filter((id) => id !== convId);
  if (groupId != null) groups.get(groupId)?.convIds.push(convId);
  renderSidebar();
  session.scheduleSave();
}

function convLabel(conv) {
  const tab = conv.tabs.get(conv.activeTabId) ?? [...conv.tabs.values()][0];
  if (tab) return { text: tab.title || domainOf(tab.url), favicon: tab.favicon };
  return { text: conv.title ?? "Nova aba", favicon: null };
}

function makeFavicon(src) {
  const favicon = document.createElement("img");
  favicon.className = "item-favicon";
  if (src) favicon.src = src;
  else favicon.classList.add("empty");
  return favicon;
}

function renderConvItem(conv) {
  const wrap = document.createElement("div");
  wrap.className = "item-wrap";

  const item = document.createElement("div");
  item.className = "conv-item" + (conv.id === activeId ? " active" : "");
  item.draggable = true;

  const { text, favicon } = convLabel(conv);
  item.appendChild(makeFavicon(favicon));
  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = text;
  item.appendChild(label);

  item.onclick = () => activate(conv.id);
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/clara-conv", conv.id);
    event.dataTransfer.effectAllowed = "move";
  });
  wrap.appendChild(item);

  // A single tab IS the item; multiple tabs show as its pages.
  if (conv.tabs.size > 1) {
    for (const tab of conv.tabs.values()) {
      const sub = document.createElement("div");
      sub.className =
        "tab-item" +
        (conv.id === activeId && tab.tabId === conv.activeTabId ? " active" : "");
      sub.appendChild(makeFavicon(tab.favicon));

      const subLabel = document.createElement("span");
      subLabel.className = "item-label";
      subLabel.textContent = tab.title || domainOf(tab.url);
      sub.appendChild(subLabel);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.onclick = (event) => {
        event.stopPropagation();
        closeTab(conv, tab.tabId);
      };
      sub.appendChild(closeBtn);

      sub.onclick = () => {
        activate(conv.id);
        setActiveTab(conv, tab.tabId);
      };
      wrap.appendChild(sub);
    }
  }

  return wrap;
}

function renderGroup(group) {
  const wrap = document.createElement("div");
  wrap.className = "group-wrap";

  const head = document.createElement("div");
  head.className = "group-head";

  const chevron = document.createElement("span");
  chevron.className = "group-chevron" + (group.collapsed ? " collapsed" : "");
  chevron.textContent = "▾";
  chevron.onclick = (event) => {
    event.stopPropagation();
    group.collapsed = !group.collapsed;
    renderSidebar();
    session.scheduleSave();
  };

  const name = document.createElement("span");
  name.className = "group-name";
  name.textContent = group.name;
  name.spellcheck = false;
  const startRename = () => {
    name.contentEditable = "true";
    name.focus();
    document.getSelection()?.selectAllChildren(name);
  };
  name.ondblclick = (event) => {
    event.stopPropagation();
    startRename();
  };
  name.onclick = (event) => {
    if (name.isContentEditable) event.stopPropagation();
  };
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      name.blur();
    }
  });
  name.addEventListener("blur", () => {
    group.name = name.textContent.trim() || "Grupo";
    name.textContent = group.name;
    name.contentEditable = "false";
    session.scheduleSave();
  });
  group._startRename = startRename;

  head.append(chevron, name);
  head.onclick = () => openGroupHome(group.id);
  head.addEventListener("dragover", (event) => {
    event.preventDefault();
    head.classList.add("drop-target");
  });
  head.addEventListener("dragleave", () => head.classList.remove("drop-target"));
  head.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const convId = event.dataTransfer.getData("text/clara-conv");
    if (convId) moveToGroup(convId, group.id);
  });

  wrap.appendChild(head);
  if (!group.collapsed) {
    for (const convId of group.convIds) {
      const conv = conversations.get(convId);
      if (conv) wrap.appendChild(renderConvItem(conv));
    }
  }
  return wrap;
}

function renderSidebar() {
  itemListEl.innerHTML = "";
  for (const group of groups.values()) {
    itemListEl.appendChild(renderGroup(group));
  }
  for (const [id, conv] of conversations) {
    if (!groupOf(id)) itemListEl.appendChild(renderConvItem(conv));
  }
}

// Dropping on the list background ungroups the item.
itemListEl.addEventListener("dragover", (event) => event.preventDefault());
itemListEl.addEventListener("drop", (event) => {
  const convId = event.dataTransfer.getData("text/clara-conv");
  if (convId) moveToGroup(convId, null);
});

function createGroup(name, id = nextGroupId++) {
  const group = {
    id,
    name,
    collapsed: false,
    convIds: [],
    summary: null,
    summaryKey: null,
  };
  groups.set(id, group);
  return group;
}

newGroupBtn.onclick = () => {
  const group = createGroup("Grupo");
  renderSidebar();
  group._startRename?.();
  session.scheduleSave();
};

/* ── Popups → sibling tabs in the origin's group ─────── */

function findConvByWebContentsId(webContentsId) {
  for (const conv of conversations.values()) {
    for (const tab of conv.tabs.values()) {
      if (tab.webContentsId === webContentsId) return { conv, tab };
    }
  }
  return null;
}

// A link opened "in a new window" becomes a sibling item, grouped with the
// site it came from (creating the group on first spawn).
window.clara.onPopup(({ sourceWebContentsId, url, disposition }) => {
  const origin = findConvByWebContentsId(sourceWebContentsId);
  if (!origin) return;
  const originConvId = origin.conv.id;

  let group = groupOf(originConvId);
  if (!group) {
    group = createGroup(domainOf(origin.tab.url));
    group.convIds.push(originConvId);
  }

  const conv = createConversation({ warmup: false });
  createTab(conv, url);
  group.convIds.push(conv.id);

  // Background dispositions (cmd+click) keep the origin focused.
  if (disposition === "background-tab") activate(originConvId);
  renderSidebar();
  session.scheduleSave();
});

/* ── Group home: thumbnails + Clara's summary ────────── */

function groupTabs(group) {
  const pairs = [];
  for (const convId of group.convIds) {
    const conv = conversations.get(convId);
    if (!conv) continue;
    for (const tab of conv.tabs.values()) pairs.push({ conv, tab });
  }
  return pairs;
}

function openGroupHome(groupId) {
  activeHome = groupId;
  syncMode();
  renderGroupHome();
  refreshGroupSummary(groups.get(groupId));
}

function renderGroupHome() {
  const group = activeHome != null ? groups.get(activeHome) : null;
  if (!group) return;

  homeTitleEl.textContent = group.name;
  homeSummaryEl.textContent =
    group.summary ?? "Clara está resumindo este grupo…";
  homeSummaryEl.classList.toggle("pending", !group.summary);

  homeGridEl.innerHTML = "";
  const pairs = groupTabs(group);
  for (const { conv, tab } of pairs) {
    const card = document.createElement("div");
    card.className = "home-card";

    const thumb = document.createElement("div");
    thumb.className = "home-thumb";
    if (tab.thumb) {
      const img = document.createElement("img");
      img.src = tab.thumb;
      thumb.appendChild(img);
    }

    const meta = document.createElement("div");
    meta.className = "home-meta";
    const title = document.createElement("div");
    title.className = "home-card-title";
    title.textContent = tab.title || domainOf(tab.url);
    const domain = document.createElement("div");
    domain.className = "home-card-domain";
    domain.textContent = domainOf(tab.url);
    meta.append(title, domain);

    card.append(thumb, meta);
    card.onclick = () => {
      activate(conv.id);
      setActiveTab(conv, tab.tabId);
    };
    homeGridEl.appendChild(card);
  }
  if (!pairs.length) {
    homeSummaryEl.textContent = "Grupo vazio — arraste itens para cá ou abra links do site.";
    homeSummaryEl.classList.remove("pending");
  }
}

async function refreshGroupSummary(group) {
  if (!group) return;
  const pairs = groupTabs(group);
  if (!pairs.length) return;
  const key = pairs.map((p) => p.tab.url).sort().join("|");
  if (group.summaryKey === key && group.summary) return;
  group.summaryKey = key;

  const pages = [];
  for (const { tab } of pairs) {
    let snippet = "";
    try {
      const page = await tab.webview.executeJavaScript(ClaraPageScripts.extract(), false);
      snippet = (page.text ?? "").replace(/\s+/g, " ").slice(0, 400);
    } catch {
      /* page unavailable — title and url still inform the summary */
    }
    pages.push(`- ${tab.title || "sem título"} (${tab.url}): ${snippet}`);
  }

  const prompt =
    `Resuma em 2 ou 3 frases (PT-BR) o grupo de abas "${group.name}": o que ` +
    `conecta as páginas e para que o usuário parece estar usando o conjunto. ` +
    `Responda APENAS com texto puro — sem HTML, sem markdown.\n\nPáginas:\n` +
    pages.join("\n");

  try {
    const raw = await window.clara.summarize(prompt);
    const text = raw.replace(/<[^>]+>/g, "").trim();
    group.summary = text || "(não consegui resumir o grupo)";
  } catch {
    group.summary = null;
    group.summaryKey = null;
  }
  if (activeHome === group.id) renderGroupHome();
}

function renderEmptyState(conv) {
  const empty = document.createElement("div");
  empty.className = "empty";
  const h1 = document.createElement("h1");
  h1.textContent = "O que vamos descobrir?";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const text of SUGGESTIONS) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = text;
    chip.onclick = () => sendMessage(text);
    chips.appendChild(chip);
  }
  empty.append(h1, chips);
  conv.innerEl.appendChild(empty);
}

/* ── Mode: feed vs. stage+overlay ────────────────────── */

function syncMode() {
  const conv = activeConv();
  if (activeHome != null && !groups.has(activeHome)) activeHome = null;
  const homeOpen = activeHome != null;
  const siteMode = !!conv && conv.tabs.size > 0;
  document.body.classList.toggle("home-mode", homeOpen);
  document.body.classList.toggle("site-mode", siteMode);
  stageEl.hidden = !siteMode && !homeOpen;
  groupHomeEl.hidden = !homeOpen;
  if (siteMode && !conv.tabs.has(conv.activeTabId)) {
    conv.activeTabId = [...conv.tabs.keys()].pop() ?? null;
  }
  renderStage();
  renderSidebar();
  if (conv) {
    updateLastPair(conv);
    collapseOverlay(conv);
  }
}

function updateLastPair(conv) {
  const children = [...conv.innerEl.children];
  let lastUserIdx = -1;
  children.forEach((el, i) => {
    if (el.classList.contains("msg-user")) lastUserIdx = i;
  });
  children.forEach((el, i) => {
    el.classList.toggle("overlay-hidden", lastUserIdx !== -1 && i < lastUserIdx);
  });
}

function expandOverlay(conv) {
  conv.feedEl.classList.add("expanded");
  scrollToBottom(conv);
}

function collapseOverlay(conv) {
  conv.feedEl.classList.remove("expanded");
  scrollToBottom(conv);
}

// Scrolling over the bubbles expands the chat history.
feedsEl.addEventListener(
  "wheel",
  () => {
    const conv = activeConv();
    if (!conv || !document.body.classList.contains("site-mode")) return;
    if (!conv.feedEl.classList.contains("expanded")) expandOverlay(conv);
  },
  { passive: true }
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (activeHome != null) {
      activeHome = null;
      syncMode();
      return;
    }
    const conv = activeConv();
    if (conv) collapseOverlay(conv);
  }
});

/* ── Feed cards ──────────────────────────────────────── */

function scrollToBottom(conv) {
  conv.feedEl.scrollTop = conv.feedEl.scrollHeight;
}

// DOM-only builders (used both live and during rehydration).
function renderUserBubble(conv, text) {
  conv.innerEl.querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = "msg-user";
  el.textContent = text;
  conv.innerEl.appendChild(el);
  updateLastPair(conv);
  scrollToBottom(conv);
}

function renderAiBubble(conv, html) {
  conv.innerEl.querySelector(".empty")?.remove();
  const card = document.createElement("div");
  card.className = "card-ai";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = wrapCardHtml(stripFences(html));
  card.appendChild(iframe);
  conv.innerEl.appendChild(card);
  updateLastPair(conv);
  scrollToBottom(conv);
}

function renderErrorBubble(conv, message) {
  const el = document.createElement("div");
  el.className = "card-error";
  el.textContent = message;
  conv.innerEl.appendChild(el);
  updateLastPair(conv);
  scrollToBottom(conv);
}

function replayMessage(conv, msg) {
  conv.messages.push(msg);
  if (msg.role === "user") renderUserBubble(conv, msg.text);
  else if (msg.role === "ai") renderAiBubble(conv, msg.html);
  else if (msg.role === "error") renderErrorBubble(conv, msg.text);
}

// Live adders: render + record + persist.
function addUserCard(conv, text) {
  renderUserBubble(conv, text);
  conv.messages.push({ role: "user", text });
  session.scheduleSave();
}

function addAiCard(conv, html) {
  renderAiBubble(conv, html);
  conv.messages.push({ role: "ai", html });
  session.scheduleSave();
}

function addErrorCard(conv, message) {
  renderErrorBubble(conv, message);
  conv.messages.push({ role: "error", text: message });
  session.scheduleSave();
}

function setStatus(conv, text) {
  if (!conv.statusEl) {
    conv.statusEl = document.createElement("div");
    conv.statusEl.className = "status-line";
    conv.statusEl.innerHTML = '<span class="pulse"></span><span class="label"></span>';
    conv.innerEl.appendChild(conv.statusEl);
    updateLastPair(conv);
  }
  conv.statusEl.querySelector(".label").textContent = text;
  scrollToBottom(conv);
}

function clearStatus(conv) {
  conv.statusEl?.remove();
  conv.statusEl = null;
}

/* ── Tabs & stage ────────────────────────────────────── */

function looksLikeUrl(text) {
  if (/^https?:\/\/\S+$/i.test(text)) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text);
}

function normalizeUrl(text) {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function syncTab(conv, tab) {
  renderSidebar();
  renderStageHead();
  window.clara.tabUpdated(conv.id, { tabId: tab.tabId, url: tab.url, title: tab.title });
  session.scheduleSave();
}

function createTab(conv, url, { restore = null } = {}) {
  conv.innerEl.querySelector(".empty")?.remove();

  const tabId = restore?.tabId ?? `tab-${nextTabId++}`;
  const webview = document.createElement("webview");
  webview.className = "site-view";
  webview.setAttribute("src", url);
  webview.dataset.tabId = tabId;
  stageViewsEl.appendChild(webview);

  const tab = {
    tabId,
    url,
    title: restore?.title || domainOf(url),
    favicon: restore?.favicon ?? null,
    webview,
    interactAllowed: false,
  };
  conv.tabs.set(tabId, tab);
  conv.activeTabId = tabId;

  webview.addEventListener("page-title-updated", (e) => {
    tab.title = e.title;
    syncTab(conv, tab);
  });
  webview.addEventListener("page-favicon-updated", (e) => {
    tab.favicon = e.favicons?.[0] ?? null;
    renderSidebar();
    renderStageHead();
  });
  webview.addEventListener("did-navigate", (e) => {
    tab.url = e.url;
    syncTab(conv, tab);
  });
  webview.addEventListener("did-navigate-in-page", (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    syncTab(conv, tab);
  });
  // Clicking into the site collapses the chat overlay.
  webview.addEventListener("focus", () => {
    collapseOverlay(conv);
  });

  webview.addEventListener(
    "dom-ready",
    () => {
      tab.webContentsId = webview.getWebContentsId();
    },
    { once: true }
  );

  // Archive every settled page (text snapshot + thumbnail) into the
  // browsing history / group home.
  let captureTimer = null;
  const capture = () => {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(async () => {
      try {
        const page = await webview.executeJavaScript(ClaraPageScripts.extract(), false);
        window.clara.pageCaptured({ url: page.url, title: page.title, text: page.text });
      } catch {
        /* page not ready or navigated away — next event recaptures */
      }
      if (webview.classList.contains("shown")) {
        try {
          const image = await webview.capturePage();
          try {
            tab.thumb = image.resize({ width: 640 }).toDataURL();
          } catch {
            tab.thumb = image.toDataURL();
          }
        } catch {
          /* hidden or mid-navigation — keep the previous thumb */
        }
      }
    }, 1200);
  };
  webview.addEventListener("did-stop-loading", capture);
  webview.addEventListener("did-navigate-in-page", (e) => {
    if (e.isMainFrame) capture();
  });

  syncMode();
  syncTab(conv, tab);
  return tab;
}

function setActiveTab(conv, tabId) {
  if (!conv.tabs.has(tabId)) return;
  conv.activeTabId = tabId;
  renderStage();
  renderSidebar();
  session.scheduleSave();
}

function closeTab(conv, tabId) {
  const tab = conv.tabs.get(tabId);
  if (!tab) return;
  if (activeConsent?.tabId === tabId) activeConsent.finish(false);
  tab.webview.remove();
  conv.tabs.delete(tabId);
  if (conv.activeTabId === tabId) {
    conv.activeTabId = [...conv.tabs.keys()].pop() ?? null;
  }
  syncMode();
  if (activeHome != null) renderGroupHome();
  window.clara.tabClosed(conv.id, tabId);
  session.scheduleSave();
}

function displayedTab() {
  const conv = activeConv();
  if (!conv) return null;
  return conv.tabs.get(conv.activeTabId) ?? null;
}

// Webviews must never be reparented or display:none'd (both reload/break the
// guest), so every webview stays in #stage-views and visibility toggles.
function renderStage() {
  const shown = activeHome != null ? null : displayedTab();
  for (const conv of conversations.values()) {
    for (const tab of conv.tabs.values()) {
      tab.webview.classList.toggle("shown", tab === shown);
    }
  }
  renderStageHead();
}

function renderStageHead() {
  const tab = displayedTab();
  if (!tab) return;
  stageHead.querySelector(".site-title").textContent = tab.title;
  stageHead.querySelector(".site-domain").textContent = domainOf(tab.url);
  const faviconEl = stageHead.querySelector(".site-favicon");
  if (tab.favicon) faviconEl.src = tab.favicon;
  else faviconEl.removeAttribute("src");
}

stageHead.querySelector('[data-act="back"]').onclick = () => displayedTab()?.webview.goBack();
stageHead.querySelector('[data-act="fwd"]').onclick = () => displayedTab()?.webview.goForward();
stageHead.querySelector('[data-act="reload"]').onclick = () => displayedTab()?.webview.reload();
stageHead.querySelector('[data-act="close"]').onclick = () => {
  const conv = activeConv();
  if (conv?.activeTabId) closeTab(conv, conv.activeTabId);
};
stageHead.addEventListener("mousedown", () => {
  const conv = activeConv();
  if (conv) collapseOverlay(conv);
});

/* ── Tool requests from the agent ────────────────────── */

function resolveTab(conv, tabId) {
  if (tabId) return conv.tabs.get(tabId) ?? null;
  return conv.tabs.get(conv.activeTabId) ?? [...conv.tabs.values()].pop() ?? null;
}

window.clara.onToolRequest("open-tab", ({ requestId, conversationId, url }) => {
  const conv = conversations.get(conversationId);
  if (!conv) {
    window.clara.reply("open-tab", requestId, { error: "unknown conversation" });
    return;
  }
  const tab = createTab(conv, url);
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    window.clara.reply("open-tab", requestId, {
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
    });
  };
  tab.webview.addEventListener("page-title-updated", () => setTimeout(settle, 150), { once: true });
  tab.webview.addEventListener("did-fail-load", (e) => {
    if (settled || !e.isMainFrame) return;
    settled = true;
    window.clara.reply("open-tab", requestId, {
      tabId: tab.tabId,
      url,
      error: `failed to load (${e.errorDescription || e.errorCode})`,
    });
  });
  setTimeout(settle, 8000);
});

window.clara.onToolRequest("read-page", async ({ requestId, conversationId, tabId, screenshot }) => {
  const conv = conversations.get(conversationId);
  const tab = conv && resolveTab(conv, tabId);
  if (!tab) {
    window.clara.reply("read-page", requestId, {
      error: "no such tab — call list_tabs or open_url first",
    });
    return;
  }
  try {
    const result = await tab.webview.executeJavaScript(ClaraPageScripts.extract(), true);
    result.tabId = tab.tabId;
    if (screenshot) {
      // Bring the tab on stage so capturePage has painted pixels to grab.
      setActiveTab(conv, tab.tabId);
      try {
        const image = await tab.webview.capturePage();
        result.screenshot = image.toDataURL();
      } catch {
        /* capture failed (hidden/navigating) — text-only result still useful */
      }
    }
    window.clara.reply("read-page", requestId, result);
  } catch (err) {
    window.clara.reply("read-page", requestId, { error: String(err?.message ?? err) });
  }
});

window.clara.onToolRequest("interact", async ({ requestId, conversationId, tabId, action }) => {
  const conv = conversations.get(conversationId);
  const tab = conv && resolveTab(conv, tabId);
  if (!tab) {
    window.clara.reply("interact", requestId, {
      error: "no such tab — call list_tabs or open_url first",
    });
    return;
  }
  const allowed = await ensureInteractionAllowed(conv, tab, action);
  if (!allowed) {
    window.clara.reply("interact", requestId, {
      error: "the user denied interaction with this page",
    });
    return;
  }
  try {
    const script = ClaraPageScripts.interact(action.ref, action.action, action.text);
    const result = await tab.webview.executeJavaScript(script, true);
    window.clara.reply("interact", requestId, result);
  } catch (err) {
    window.clara.reply("interact", requestId, { error: String(err?.message ?? err) });
  }
});

// First interaction on a tab shows a consent bar at the top of the stage.
// Approval sticks for that tab; denial answers just this call.
function ensureInteractionAllowed(conv, tab, action) {
  if (tab.interactAllowed) return Promise.resolve(true);
  setActiveTab(conv, tab.tabId);

  return new Promise((resolve) => {
    stageEl.querySelector(".consent-bar")?.remove();

    const bar = document.createElement("div");
    bar.className = "consent-bar";
    const what =
      action.action === "fill"
        ? `preencher “${(action.text ?? "").slice(0, 40)}”`
        : action.action === "click"
          ? "clicar num elemento"
          : "pressionar Enter";
    bar.innerHTML = `
      <span class="consent-label">Clara quer ${what} nesta página</span>
      <button class="consent-btn allow">Permitir nesta aba</button>
      <button class="consent-btn deny">Negar</button>`;

    const finish = (ok) => {
      bar.remove();
      activeConsent = null;
      if (ok) tab.interactAllowed = true;
      resolve(ok);
    };
    activeConsent = { tabId: tab.tabId, finish };
    bar.querySelector(".allow").onclick = () => finish(true);
    bar.querySelector(".deny").onclick = () => finish(false);
    setTimeout(() => {
      if (bar.isConnected) finish(false);
    }, 110000);

    stageEl.insertBefore(bar, stageViewsEl);
  });
}

/* ── Agent events ────────────────────────────────────── */

window.clara.onEvent(({ conversationId, event }) => {
  const conv = conversations.get(conversationId);
  if (!conv) return;

  switch (event.type) {
    case "thread.started":
      // Persist the Codex thread id so this conversation resumes on restart.
      if (event.thread_id && conv.threadId !== event.thread_id) {
        conv.threadId = event.thread_id;
        window.clara.registerResume(conv.id, event.thread_id);
        session.scheduleSave();
      }
      break;
    case "turn.started":
      setStatus(conv, "pensando…");
      break;
    case "item.started":
    case "item.updated": {
      const item = event.item;
      if (item?.type === "reasoning") setStatus(conv, "pensando…");
      if (item?.type === "command_execution") setStatus(conv, "executando…");
      if (item?.type === "web_search") setStatus(conv, `pesquisando: ${item.query ?? ""}`);
      if (item?.type === "mcp_tool_call") {
        const labels = {
          open_url: "abrindo site…",
          list_tabs: "olhando as abas…",
          read_page: "lendo a página…",
          interact: "interagindo com a página…",
        };
        setStatus(conv, labels[item.tool] ?? `${item.tool}…`);
      }
      break;
    }
    case "item.completed":
      if (event.item?.type === "agent_message") {
        clearStatus(conv);
        addAiCard(conv, event.item.text);
      }
      break;
    case "turn.completed":
      clearStatus(conv);
      setRunning(conv, false);
      break;
    case "turn.failed":
      clearStatus(conv);
      addErrorCard(conv, event.error?.message ?? "A resposta falhou.");
      setRunning(conv, false);
      break;
    case "error":
      clearStatus(conv);
      addErrorCard(conv, event.message ?? "Erro desconhecido.");
      setRunning(conv, false);
      break;
  }
});

/* ── Composer ────────────────────────────────────────── */

function setRunning(conv, running) {
  conv.running = running;
  if (conv.id === activeId) updateComposer();
}

function updateComposer() {
  const conv = activeConv();
  const running = conv?.running ?? false;
  sendBtn.classList.toggle("running", running);
  sendBtn.title = running ? "Parar" : "Enviar";
}

function sendMessage(text) {
  const conv = activeConv();
  if (!conv || conv.running) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  // Omnibox fast path: a URL-looking input opens directly, no agent turn.
  if (looksLikeUrl(trimmed)) {
    const url = normalizeUrl(trimmed);
    if (!conv.title) {
      conv.title = domainOf(url);
      renderSidebar();
    }
    createTab(conv, url);
    inputEl.value = "";
    autosize();
    return;
  }

  if (!conv.title) {
    conv.title = trimmed.length > 34 ? trimmed.slice(0, 34) + "…" : trimmed;
    renderSidebar();
  }
  addUserCard(conv, trimmed);
  collapseOverlay(conv);
  setRunning(conv, true);
  setStatus(conv, "pensando…");
  window.clara.send(conv.id, trimmed);

  inputEl.value = "";
  autosize();
}

sendBtn.onclick = () => {
  const conv = activeConv();
  if (conv?.running) {
    window.clara.abort(conv.id);
    setRunning(conv, false);
    clearStatus(conv);
  } else {
    sendMessage(inputEl.value);
  }
};

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage(inputEl.value);
  }
});

function autosize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px";
}
inputEl.addEventListener("input", autosize);

// The overlay is anchored right above the composer, which changes height as
// the textarea grows.
new ResizeObserver(() => {
  document.documentElement.style.setProperty(
    "--composer-h",
    composerWrapEl.offsetHeight + "px"
  );
}).observe(composerWrapEl);

newConvBtn.onclick = () => createConversation();

/* ── Boot / session restore ──────────────────────────── */

async function restoreSession() {
  let state;
  try {
    state = await window.clara.loadSession();
  } catch {
    state = null;
  }
  if (!state?.conversations?.length) return false;

  // Counters first, so restored ids never collide with new ones.
  nextId = state.counters?.nextId ?? 1;
  nextTabId = state.counters?.nextTabId ?? 1;
  nextGroupId = state.counters?.nextGroupId ?? 1;

  for (const savedConv of state.conversations) {
    const conv = createConversation({ restore: savedConv });
    for (const savedTab of savedConv.tabs ?? []) {
      createTab(conv, savedTab.url, { restore: savedTab });
    }
    if (savedConv.activeTabId && conv.tabs.has(savedConv.activeTabId)) {
      conv.activeTabId = savedConv.activeTabId;
    }
  }

  for (const savedGroup of state.groups ?? []) {
    const group = createGroup(savedGroup.name, savedGroup.id);
    group.collapsed = savedGroup.collapsed;
    group.convIds = savedGroup.convIds.filter((id) => conversations.has(id));
  }

  const first = state.activeId && conversations.has(state.activeId)
    ? state.activeId
    : conversations.keys().next().value;
  renderSidebar();
  activate(first);
  return true;
}

restoreSession().then((restored) => {
  if (!restored) createConversation();
});
