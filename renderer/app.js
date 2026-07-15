/* Clara renderer — conversations, floating chat overlay, stage, composer.
   Layout model: with no site open a conversation is a normal feed; once a
   tab exists the site takes the whole main area (the stage) and the chat
   becomes an autonomous companion dock above the composer. It keeps the last
   exchange visible briefly, then settles into a small conversation control;
   sending/receiving reveals it and deliberate site interaction dismisses it. */

const feedsEl = document.getElementById("feeds");
const itemListEl = document.getElementById("item-list");
const newConvBtn = document.getElementById("new-conv");
const newGroupBtn = document.getElementById("new-group");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stageEl = document.getElementById("stage");
const stageViewsEl = document.getElementById("stage-views");
const siteControlsEl = document.getElementById("site-controls");
const composerFaviconEl = document.getElementById("composer-favicon");
const composerWrapEl = document.getElementById("composer-wrap");
const chatToggleEl = document.getElementById("chat-toggle");
const chatToggleLabelEl = chatToggleEl.querySelector(".chat-toggle-label");
const chatToggleCountEl = chatToggleEl.querySelector(".chat-toggle-count");
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
let renderedContextKey = null;
let modeAnimationTimer = null;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#1C1814; --surface:#242019; --ink:#F2EFE8; --ink-dim:#D8D1C5;
      --ink-muted:#9D9080; --accent:#1E97F2; --border:#332D25;
    }
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

/* Substantial answers become a full page on the stage (the site stays in
   the tab behind, like navigating away in the same tab). The model marks
   them with <!--clara:page-->; a heuristic promotes unmarked big answers. */

const PAGE_MARKER = /^\s*<!--\s*clara:page\s*-->/i;

function isPageAnswer(html) {
  if (PAGE_MARKER.test(html)) return true;
  if (!window.ClaraFormat.isHtmlFragment(html)) return false;
  return html.length > 1600 || /<table[\s>]|<h1[\s>]/i.test(html);
}

function wrapPageHtml(html) {
  const PAGE_STYLE =
    CARD_STYLE +
    `
    html, body { background: var(--bg); }
    body { padding: 52px 44px 150px; }
    .clara-page-col { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 32px; } h2 { font-size: 23px; } h3 { font-size: 18px; }
    body { font-size: 15px; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS_LINK}<style>${PAGE_STYLE}</style></head><body><div class="clara-page-col">${html}</div></body></html>`;
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

function createConversation({ warmup = true, restore = null, focus = true } = {}) {
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
    messages: [], // { role: "user"|"ai"|"error", text?, html?, page? }
    tabs: new Map(), // tabId -> { tabId, url, title, favicon, webview, interactAllowed }
    activeTabId: restore?.activeTabId ?? null,
    pageFrame: null, // stage iframe for page answers
    showingPage: false,
    overlayTimer: null,
    overlayTransitionTimer: null,
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
  if (focus) activate(id);
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

function convLabel(conv) {
  const tab = conv.tabs.get(conv.activeTabId) ?? [...conv.tabs.values()][0];
  const pageTitle = tab?.title || (tab ? domainOf(tab.url) : null);
  const text = conv.title ?? pageTitle ?? "Nova aba";
  let meta = null;
  if (conv.tabs.size > 1) meta = `${conv.tabs.size} páginas`;
  else if (pageTitle && pageTitle !== text) meta = pageTitle;
  else if (tab && domainOf(tab.url) !== text) meta = domainOf(tab.url);
  return { text, meta, favicon: tab?.favicon ?? null };
}

function makeFavicon(src) {
  const favicon = document.createElement("img");
  favicon.className = "item-favicon";
  if (src) favicon.src = src;
  else favicon.classList.add("empty");
  return favicon;
}

function dataTransferHas(event, type) {
  return Array.from(event.dataTransfer?.types ?? []).includes(type);
}

function reorderMap(map, ids) {
  const entries = new Map(map);
  map.clear();
  for (const id of ids) {
    const value = entries.get(id);
    if (value) map.set(id, value);
  }
}

function moveConversation(convId, { groupId = null, targetId = null, after = true } = {}) {
  if (!conversations.has(convId) || convId === targetId) return;

  const current = groupOf(convId);
  if (current) current.convIds = current.convIds.filter((id) => id !== convId);

  if (groupId != null) {
    const destination = groups.get(groupId);
    if (!destination) return;
    const ids = destination.convIds.filter((id) => id !== convId);
    const targetIndex = targetId == null ? -1 : ids.indexOf(targetId);
    const insertAt = targetIndex === -1 ? ids.length : targetIndex + (after ? 1 : 0);
    ids.splice(insertAt, 0, convId);
    destination.convIds = ids;
  } else {
    const rootIds = [...conversations.keys()].filter(
      (id) => id !== convId && !groupOf(id)
    );
    const targetIndex = targetId == null ? -1 : rootIds.indexOf(targetId);
    const insertAt = targetIndex === -1 ? rootIds.length : targetIndex + (after ? 1 : 0);
    rootIds.splice(insertAt, 0, convId);

    const rootSet = new Set(rootIds);
    const groupedIds = [...conversations.keys()].filter((id) => !rootSet.has(id));
    reorderMap(conversations, [...rootIds, ...groupedIds]);
  }

  renderSidebar();
  session.scheduleSave();
}

function moveGroup(groupId, targetId, after) {
  if (!groups.has(groupId) || !groups.has(targetId) || groupId === targetId) return;
  const ids = [...groups.keys()].filter((id) => id !== groupId);
  const targetIndex = ids.indexOf(targetId);
  ids.splice(targetIndex + (after ? 1 : 0), 0, groupId);
  reorderMap(groups, ids);
  renderSidebar();
  session.scheduleSave();
}

function clearDropMarkers() {
  for (const el of itemListEl.querySelectorAll(".drop-before, .drop-after, .drop-target")) {
    el.classList.remove("drop-before", "drop-after", "drop-target");
  }
}

function attachConversationDropTarget(item, targetConvId, groupId) {
  item.addEventListener("dragover", (event) => {
    if (!dataTransferHas(event, "text/clara-conv")) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropMarkers();
    const rect = item.getBoundingClientRect();
    item.classList.add(event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
  });
  item.addEventListener("dragleave", () => {
    item.classList.remove("drop-before", "drop-after");
  });
  item.addEventListener("drop", (event) => {
    const convId = event.dataTransfer.getData("text/clara-conv");
    if (!convId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = item.getBoundingClientRect();
    moveConversation(convId, {
      groupId,
      targetId: targetConvId,
      after: event.clientY > rect.top + rect.height / 2,
    });
  });
}

function renderConvItem(conv, { groupId = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "item-wrap";
  wrap.dataset.sidebarKey = `conv:${conv.id}`;

  const item = document.createElement("div");
  item.className = "conv-item" + (conv.id === activeId ? " active" : "");
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  if (conv.id === activeId) item.setAttribute("aria-current", "page");

  const { text, meta, favicon } = convLabel(conv);
  item.appendChild(makeFavicon(favicon));
  const copy = document.createElement("span");
  copy.className = "item-copy";
  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = text;
  copy.appendChild(label);
  if (meta) {
    const sublabel = document.createElement("span");
    sublabel.className = "item-meta";
    sublabel.textContent = meta;
    copy.appendChild(sublabel);
  }
  item.appendChild(copy);

  const grip = document.createElement("span");
  grip.className = "item-grip";
  grip.setAttribute("aria-hidden", "true");
  grip.textContent = "⋮⋮";
  item.appendChild(grip);

  item.onclick = () => activate(conv.id);
  item.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(conv.id);
    }
  };
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/clara-conv", conv.id);
    event.dataTransfer.effectAllowed = "move";
    item.classList.add("dragging");
  });
  item.addEventListener("dragend", () => {
    item.classList.remove("dragging");
    clearDropMarkers();
  });
  attachConversationDropTarget(item, conv.id, groupId);
  wrap.appendChild(item);

  // A single tab IS the item; multiple tabs show as its pages.
  if (conv.tabs.size > 1) {
    for (const tab of conv.tabs.values()) {
      const sub = document.createElement("div");
      sub.className =
        "tab-item" +
        (conv.id === activeId && tab.tabId === conv.activeTabId ? " active" : "");
      sub.tabIndex = 0;
      sub.setAttribute("role", "button");
      sub.appendChild(makeFavicon(tab.favicon));

      const subLabel = document.createElement("span");
      subLabel.className = "item-label";
      subLabel.textContent = tab.title || domainOf(tab.url);
      sub.appendChild(subLabel);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.setAttribute("aria-label", `Fechar ${tab.title || domainOf(tab.url)}`);
      closeBtn.onclick = (event) => {
        event.stopPropagation();
        closeTab(conv, tab.tabId);
      };
      sub.appendChild(closeBtn);

      sub.onclick = () => {
        activate(conv.id);
        setActiveTab(conv, tab.tabId);
      };
      sub.onkeydown = (event) => {
        if (event.target !== sub) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          sub.click();
        }
      };
      wrap.appendChild(sub);
    }
  }

  return wrap;
}

function renderGroup(group) {
  const wrap = document.createElement("div");
  wrap.className = "group-wrap";
  wrap.dataset.sidebarKey = `group:${group.id}`;

  const head = document.createElement("div");
  head.className = "group-head";
  head.draggable = true;
  head.tabIndex = 0;
  head.setAttribute("role", "button");

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
  let grip = null;
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
    grip?.setAttribute("aria-label", `Reordenar grupo ${group.name}`);
    session.scheduleSave();
  });
  group._startRename = startRename;

  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = String(group.convIds.length);

  grip = document.createElement("span");
  grip.className = "group-grip";
  grip.setAttribute("aria-label", `Reordenar grupo ${group.name}`);
  grip.textContent = "⋮⋮";
  grip.onclick = (event) => event.stopPropagation();
  head.addEventListener("dragstart", (event) => {
    if (name.isContentEditable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/clara-group", String(group.id));
    event.dataTransfer.effectAllowed = "move";
    wrap.classList.add("dragging");
  });
  head.addEventListener("dragend", () => {
    wrap.classList.remove("dragging");
    clearDropMarkers();
  });

  head.append(chevron, name, count, grip);
  head.onclick = () => openGroupHome(group.id);
  head.onkeydown = (event) => {
    if (event.target !== head) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openGroupHome(group.id);
    }
  };
  head.addEventListener("dragover", (event) => {
    const isConversation = dataTransferHas(event, "text/clara-conv");
    const isGroup = dataTransferHas(event, "text/clara-group");
    if (!isConversation && !isGroup) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropMarkers();
    if (isConversation) {
      head.classList.add("drop-target");
    } else {
      const rect = head.getBoundingClientRect();
      head.classList.add(event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
    }
  });
  head.addEventListener("dragleave", () => {
    head.classList.remove("drop-target", "drop-before", "drop-after");
  });
  head.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const convId = event.dataTransfer.getData("text/clara-conv");
    const draggedGroupId = Number(event.dataTransfer.getData("text/clara-group"));
    if (convId) {
      moveConversation(convId, { groupId: group.id });
    } else if (draggedGroupId) {
      const rect = head.getBoundingClientRect();
      moveGroup(draggedGroupId, group.id, event.clientY > rect.top + rect.height / 2);
    }
  });

  wrap.appendChild(head);
  if (!group.collapsed) {
    for (const convId of group.convIds) {
      const conv = conversations.get(convId);
      if (conv) wrap.appendChild(renderConvItem(conv, { groupId: group.id }));
    }
  }
  return wrap;
}

function renderSidebar() {
  const previousRects = new Map(
    [...itemListEl.querySelectorAll("[data-sidebar-key]")].map((el) => [
      el.dataset.sidebarKey,
      el.getBoundingClientRect(),
    ])
  );
  itemListEl.innerHTML = "";
  for (const group of groups.values()) {
    itemListEl.appendChild(renderGroup(group));
  }
  for (const [id, conv] of conversations) {
    if (!groupOf(id)) itemListEl.appendChild(renderConvItem(conv));
  }

  if (!prefersReducedMotion.matches && previousRects.size) {
    requestAnimationFrame(() => {
      for (const el of itemListEl.querySelectorAll("[data-sidebar-key]")) {
        const previous = previousRects.get(el.dataset.sidebarKey);
        if (!previous) continue;
        const next = el.getBoundingClientRect();
        const deltaY = previous.top - next.top;
        if (Math.abs(deltaY) < 1) continue;
        el.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      }
    });
  }
}

// Dropping on the list background ungroups the item and places it last.
itemListEl.addEventListener("dragover", (event) => {
  if (!dataTransferHas(event, "text/clara-conv")) return;
  event.preventDefault();
  clearDropMarkers();
  itemListEl.classList.add("drop-root");
});
itemListEl.addEventListener("dragleave", (event) => {
  if (!itemListEl.contains(event.relatedTarget)) itemListEl.classList.remove("drop-root");
});
itemListEl.addEventListener("drop", (event) => {
  const convId = event.dataTransfer.getData("text/clara-conv");
  itemListEl.classList.remove("drop-root");
  if (convId) moveConversation(convId);
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
  empty.className = "empty-state";
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

function contextKey(conv, { homeOpen, siteMode }) {
  if (homeOpen) return `home:${activeHome}`;
  if (!siteMode) return `feed:${conv?.id ?? "none"}`;
  const view = conv.showingPage ? "answer" : conv.activeTabId ?? "stage";
  return `site:${conv.id}:${view}`;
}

function animateModeEntry(siteLike) {
  clearTimeout(modeAnimationTimer);
  document.body.classList.remove("stage-entering", "feed-entering");
  if (prefersReducedMotion.matches) return;
  void document.body.offsetWidth;
  document.body.classList.add(siteLike ? "stage-entering" : "feed-entering");
  modeAnimationTimer = setTimeout(() => {
    document.body.classList.remove("stage-entering", "feed-entering");
  }, 480);
}

function syncMode() {
  const conv = activeConv();
  if (activeHome != null && !groups.has(activeHome)) activeHome = null;
  const homeOpen = activeHome != null;
  const siteMode = !!conv && (conv.tabs.size > 0 || conv.showingPage);
  const nextContextKey = contextKey(conv, { homeOpen, siteMode });
  const contextChanged = nextContextKey !== renderedContextKey;
  document.body.classList.toggle("home-mode", homeOpen);
  document.body.classList.toggle("site-mode", siteMode);
  stageEl.hidden = !siteMode && !homeOpen;
  groupHomeEl.hidden = !homeOpen;
  if (siteMode && !conv.tabs.has(conv.activeTabId)) {
    conv.activeTabId = [...conv.tabs.keys()].pop() ?? null;
  }
  renderStage();
  renderSidebar();
  updateComposer();
  if (conv) {
    updateLastPair(conv);
    if (siteMode) {
      if (contextChanged) {
        if (conv.messages.length || conv.statusEl) {
          revealOverlay(conv);
          if (!conv.running) scheduleOverlayMinimize(conv, 3600);
        } else {
          collapseOverlay(conv, { minimize: true, immediate: true });
        }
      }
    } else {
      resetOverlay(conv);
    }
  }
  updateChatToggle();
  if (contextChanged) animateModeEntry(siteMode || homeOpen);
  renderedContextKey = nextContextKey;
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
  children
    .filter((el) => el.classList.contains("overlay-hidden"))
    .forEach((el, i) => {
      el.style.setProperty("--history-enter-delay", `${Math.min(i, 5) * 24}ms`);
      el.style.setProperty("--history-exit-delay", `${Math.min(i, 4) * 10}ms`);
    });
}

function clearOverlayTimers(conv) {
  clearTimeout(conv.overlayTimer);
  clearTimeout(conv.overlayTransitionTimer);
  conv.overlayTimer = null;
  conv.overlayTransitionTimer = null;
}

function resetOverlay(conv) {
  clearOverlayTimers(conv);
  conv.feedEl.classList.remove(
    "expanded",
    "minimized",
    "overlay-entering",
    "overlay-collapsing"
  );
}

function updateChatToggle() {
  const conv = activeConv();
  const visible =
    !!conv &&
    document.body.classList.contains("site-mode") &&
    activeHome == null &&
    (conv.messages.length > 0 || !!conv.statusEl);
  chatToggleEl.hidden = !visible;
  if (!visible) return;

  const expanded = conv.feedEl.classList.contains("expanded");
  const minimized = conv.feedEl.classList.contains("minimized");
  chatToggleEl.setAttribute("aria-expanded", String(!minimized));
  chatToggleLabelEl.textContent = expanded
    ? "Ocultar"
    : minimized
      ? "Conversa"
      : "Ver histórico";
  chatToggleCountEl.textContent = conv.messages.length ? String(conv.messages.length) : "";
}

function revealOverlay(conv) {
  clearOverlayTimers(conv);
  conv.feedEl.classList.remove("minimized", "expanded", "overlay-collapsing");
  conv.feedEl.classList.add("overlay-entering");
  conv.overlayTransitionTimer = setTimeout(() => {
    conv.feedEl.classList.remove("overlay-entering");
    conv.overlayTransitionTimer = null;
  }, 300);
  scrollToBottom(conv);
  updateChatToggle();
}

function expandOverlay(conv) {
  clearOverlayTimers(conv);
  conv.feedEl.classList.remove("minimized", "overlay-collapsing");
  conv.feedEl.classList.add("expanded", "overlay-entering");
  conv.overlayTransitionTimer = setTimeout(() => {
    conv.feedEl.classList.remove("overlay-entering");
    conv.overlayTransitionTimer = null;
  }, 360);
  scrollToBottom(conv);
  updateChatToggle();
}

function collapseOverlay(conv, { minimize = false, immediate = false } = {}) {
  clearOverlayTimers(conv);
  const finish = () => {
    conv.feedEl.classList.remove("expanded", "overlay-collapsing", "overlay-entering");
    conv.feedEl.classList.toggle("minimized", minimize);
    conv.overlayTransitionTimer = null;
    scrollToBottom(conv);
    updateChatToggle();
  };

  if (
    conv.feedEl.classList.contains("expanded") &&
    !immediate &&
    !prefersReducedMotion.matches
  ) {
    conv.feedEl.classList.add("overlay-collapsing");
    conv.overlayTransitionTimer = setTimeout(finish, 170);
  } else {
    finish();
  }
}

function scheduleOverlayMinimize(conv, delay = 4200) {
  clearTimeout(conv.overlayTimer);
  if (
    conv !== activeConv() ||
    conv.running ||
    conv.feedEl.classList.contains("expanded") ||
    !document.body.classList.contains("site-mode")
  ) {
    return;
  }
  conv.overlayTimer = setTimeout(() => {
    collapseOverlay(conv, { minimize: true });
  }, delay);
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
    if (conv) collapseOverlay(conv, { minimize: true });
  }
});

chatToggleEl.onclick = () => {
  const conv = activeConv();
  if (!conv) return;
  if (conv.feedEl.classList.contains("minimized")) {
    revealOverlay(conv);
    scheduleOverlayMinimize(conv, 5000);
  } else if (conv.feedEl.classList.contains("expanded")) {
    collapseOverlay(conv, { minimize: true });
  } else {
    expandOverlay(conv);
  }
};

/* ── Feed cards ──────────────────────────────────────── */

function scrollToBottom(conv) {
  conv.feedEl.scrollTop = conv.feedEl.scrollHeight;
}

// DOM-only builders (used both live and during rehydration).
function renderUserBubble(conv, text) {
  conv.innerEl.querySelector(".empty-state")?.remove();
  const el = document.createElement("div");
  el.className = "msg-user";
  el.textContent = text;
  conv.innerEl.appendChild(el);
  updateLastPair(conv);
  scrollToBottom(conv);
}

function renderAiBubble(conv, html) {
  conv.innerEl.querySelector(".empty-state")?.remove();
  const card = document.createElement("div");
  card.className = "card-ai";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = wrapCardHtml(window.ClaraFormat.bubbleHtml(stripFences(html)));
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
  else if (msg.role === "ai" && msg.page) renderPageStub(conv, msg.html);
  else if (msg.role === "ai") renderAiBubble(conv, msg.html);
  else if (msg.role === "error") renderErrorBubble(conv, msg.text);
}

// A page answer shows on the stage; the chat gets a clickable stub so the
// history stays navigable.
function renderPageStub(conv, html) {
  conv.innerEl.querySelector(".empty-state")?.remove();
  const stub = document.createElement("div");
  stub.className = "page-stub";
  stub.innerHTML = '<span class="page-stub-icon">▤</span><span>Resposta aberta como página — clique para reabrir</span>';
  stub.onclick = () => showPage(conv, html);
  conv.innerEl.appendChild(stub);
  updateLastPair(conv);
  scrollToBottom(conv);
}

function showPage(conv, html) {
  if (!conv.pageFrame) {
    const frame = document.createElement("iframe");
    frame.className = "page-view";
    frame.setAttribute("sandbox", "allow-scripts");
    stageViewsEl.appendChild(frame);
    conv.pageFrame = frame;
  }
  conv.pageFrame.srcdoc = wrapPageHtml(stripFences(html).replace(PAGE_MARKER, ""));
  conv.showingPage = true;
  syncMode();
}

function hidePage(conv) {
  conv.showingPage = false;
  syncMode();
}

// Live adders: render + record + persist.
function addUserCard(conv, text) {
  renderUserBubble(conv, text);
  conv.messages.push({ role: "user", text });
  if (conv === activeConv() && document.body.classList.contains("site-mode")) {
    revealOverlay(conv);
  }
  session.scheduleSave();
}

function addAiCard(conv, html) {
  const clean = stripFences(html);
  if (isPageAnswer(clean)) {
    renderPageStub(conv, html);
    showPage(conv, html);
    conv.messages.push({ role: "ai", html, page: true });
  } else {
    renderAiBubble(conv, html);
    conv.messages.push({ role: "ai", html });
  }
  if (conv === activeConv() && document.body.classList.contains("site-mode")) {
    revealOverlay(conv);
  }
  session.scheduleSave();
}

function addErrorCard(conv, message) {
  renderErrorBubble(conv, message);
  conv.messages.push({ role: "error", text: message });
  if (conv === activeConv() && document.body.classList.contains("site-mode")) {
    revealOverlay(conv);
  }
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
  if (conv === activeConv() && document.body.classList.contains("site-mode")) {
    revealOverlay(conv);
  }
  scrollToBottom(conv);
}

function clearStatus(conv) {
  const status = conv.statusEl;
  conv.statusEl = null;
  if (!status) return;
  const remove = () => {
    status.remove();
    updateLastPair(conv);
    updateChatToggle();
  };
  if (prefersReducedMotion.matches) {
    remove();
    return;
  }
  status.classList.add("bubble-exit");
  status.addEventListener("animationend", remove, { once: true });
  setTimeout(() => {
    if (status.isConnected) remove();
  }, 220);
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
  renderSiteControls();
  window.clara.tabUpdated(conv.id, { tabId: tab.tabId, url: tab.url, title: tab.title });
  session.scheduleSave();
}

function createTab(conv, url, { restore = null } = {}) {
  conv.innerEl.querySelector(".empty-state")?.remove();

  const tabId = restore?.tabId ?? `tab-${nextTabId++}`;
  const webview = document.createElement("webview");
  webview.className = "site-view";
  webview.setAttribute(
    "preload",
    new URL("webview-preload.cjs", window.location.href).href
  );
  webview.setAttribute("src", url);
  webview.dataset.tabId = tabId;
  stageViewsEl.appendChild(webview);

  // ownerConv is dynamic: group_tabs can move a tab to another conversation,
  // so every listener resolves the owner at event time.
  const tab = {
    tabId,
    url,
    title: restore?.title || domainOf(url),
    favicon: restore?.favicon ?? null,
    webview,
    interactAllowed: false,
    ownerConv: conv,
    loading: true,
  };
  conv.tabs.set(tabId, tab);
  conv.activeTabId = tabId;
  conv.showingPage = false; // a new site takes the stage over any page answer

  webview.addEventListener("page-title-updated", (e) => {
    tab.title = e.title;
    syncTab(tab.ownerConv, tab);
  });
  webview.addEventListener("page-favicon-updated", (e) => {
    tab.favicon = e.favicons?.[0] ?? null;
    renderSidebar();
    renderSiteControls();
  });
  webview.addEventListener("did-navigate", (e) => {
    tab.url = e.url;
    syncTab(tab.ownerConv, tab);
  });
  webview.addEventListener("did-navigate-in-page", (e) => {
    if (!e.isMainFrame) return;
    tab.url = e.url;
    syncTab(tab.ownerConv, tab);
  });
  webview.addEventListener("did-start-loading", () => {
    tab.loading = true;
    renderStage();
  });
  webview.addEventListener("did-stop-loading", () => {
    tab.loading = false;
    renderStage();
    if (tab.ownerConv === activeConv()) scheduleOverlayMinimize(tab.ownerConv, 2400);
  });

  // Guest input does not bubble through the host <webview>, so the trusted
  // guest preload reports deliberate pointer and scroll engagement.
  const dismissOverlay = () => {
    const owner = tab.ownerConv;
    if (owner === activeConv() && !owner.feedEl.classList.contains("minimized")) {
      collapseOverlay(owner, { minimize: true });
    }
  };
  webview.addEventListener("focus", dismissOverlay);
  webview.addEventListener("ipc-message", (event) => {
    if (event.channel === "clara:engaged") dismissOverlay();
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
  conv.showingPage = false; // choosing a site brings it forward
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
// A conversation's page answer, when open, covers its site.
function renderStage() {
  const active = activeConv();
  const pageOpen = activeHome == null && !!active?.showingPage;
  const shown = activeHome != null || pageOpen ? null : displayedTab();
  for (const conv of conversations.values()) {
    for (const tab of conv.tabs.values()) {
      tab.webview.classList.toggle("shown", tab === shown);
    }
    if (conv.pageFrame) {
      conv.pageFrame.classList.toggle("shown", conv === active && pageOpen);
    }
  }
  document.body.classList.toggle("site-loading", !!shown?.loading);
  renderSiteControls();
}

// Site controls live inside the composer pill (one floating strip). When a
// page answer is on stage, back/close act on the page (returning to the
// site), Chrome-style same-tab navigation.
function renderSiteControls() {
  const conv = activeConv();
  const pageOpen = activeHome == null && !!conv?.showingPage;
  const tab = activeHome != null ? null : displayedTab();
  siteControlsEl.hidden = !tab && !pageOpen;
  if (siteControlsEl.hidden) return;
  if (!pageOpen && tab?.favicon) {
    composerFaviconEl.src = tab.favicon;
    composerFaviconEl.hidden = false;
  } else {
    composerFaviconEl.hidden = true;
    composerFaviconEl.removeAttribute("src");
  }
}

siteControlsEl.querySelector('[data-act="back"]').onclick = () => {
  const conv = activeConv();
  if (conv?.showingPage) hidePage(conv);
  else displayedTab()?.webview.goBack();
};
siteControlsEl.querySelector('[data-act="fwd"]').onclick = () => {
  const conv = activeConv();
  const pageHtml = conv && !conv.showingPage ? lastPageHtml(conv) : null;
  if (pageHtml && conv.pageFrame) showPage(conv, pageHtml);
  else displayedTab()?.webview.goForward();
};
siteControlsEl.querySelector('[data-act="reload"]').onclick = () => {
  const conv = activeConv();
  if (!conv?.showingPage) displayedTab()?.webview.reload();
};
siteControlsEl.querySelector('[data-act="close"]').onclick = () => {
  const conv = activeConv();
  if (conv?.showingPage) hidePage(conv);
  else if (conv?.activeTabId) closeTab(conv, conv.activeTabId);
};

function lastPageHtml(conv) {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].page) return conv.messages[i].html;
  }
  return null;
}

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

// group_tabs: split this conversation's tabs into their own sidebar items
// inside a named group (created or reused by name). The chat conversation
// itself joins the group as its root item.
window.clara.onToolRequest("group-tabs", ({ requestId, conversationId, name, tabIds }) => {
  const conv = conversations.get(conversationId);
  if (!conv) {
    window.clara.reply("group-tabs", requestId, { error: "unknown conversation" });
    return;
  }
  const wanted = tabIds?.length ? tabIds : [...conv.tabs.keys()];
  const targets = wanted.map((id) => conv.tabs.get(id)).filter(Boolean);
  if (!targets.length) {
    window.clara.reply("group-tabs", requestId, {
      error: "no matching tabs in this conversation — open pages first",
    });
    return;
  }

  const trimmed = (name ?? "").trim() || "Grupo";
  let group = [...groups.values()].find(
    (g) => g.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (!group) group = createGroup(trimmed);
  if (!groupOf(conv.id)) group.convIds.push(conv.id);

  const items = [];
  for (const tab of targets) {
    const target = createConversation({ warmup: false, focus: false });
    conv.tabs.delete(tab.tabId);
    window.clara.tabClosed(conv.id, tab.tabId);
    tab.ownerConv = target;
    target.tabs.set(tab.tabId, tab);
    target.activeTabId = tab.tabId;
    target.innerEl.querySelector(".empty-state")?.remove();
    window.clara.tabUpdated(target.id, { tabId: tab.tabId, url: tab.url, title: tab.title });
    group.convIds.push(target.id);
    items.push({ tabId: tab.tabId, conversationId: target.id, title: tab.title, url: tab.url });
  }
  if (!conv.tabs.has(conv.activeTabId)) {
    conv.activeTabId = [...conv.tabs.keys()].pop() ?? null;
  }

  syncMode();
  session.scheduleSave();
  // Show the payoff: the group home with thumbnails + summary.
  openGroupHome(group.id);
  window.clara.reply("group-tabs", requestId, {
    groupId: group.id,
    name: group.name,
    items,
  });
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

/* ── Downloads ───────────────────────────────────────── */

// Transient notice pill in the active feed when a download finishes.
window.clara.onDownloadDone(({ filename, state }) => {
  const conv = activeConv();
  if (!conv) return;
  const notice = document.createElement("div");
  notice.className = "status-line notice";
  const label =
    state === "completed"
      ? `arquivo baixado: ${filename} — pasta Downloads`
      : `download falhou: ${filename}`;
  notice.innerHTML = '<span class="pulse"></span><span class="label"></span>';
  notice.querySelector(".label").textContent = label;
  conv.innerEl.appendChild(notice);
  updateLastPair(conv);
  scrollToBottom(conv);
  setTimeout(() => notice.remove(), 8000);
});

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
  if (!running && conv === activeConv()) scheduleOverlayMinimize(conv, 4400);
  if (conv.id === activeId) updateComposer();
}

function updateComposer() {
  const conv = activeConv();
  const running = conv?.running ?? false;
  sendBtn.classList.toggle("running", running);
  sendBtn.title = running ? "Parar" : "Enviar";
  renderContextChips();
  updateChatToggle();
}

// Contextual suggestions over an open site (cheap heuristics, no model call).
const contextChipsEl = document.getElementById("context-chips");

function renderContextChips() {
  const conv = activeConv();
  const siteOpen = !!conv && conv.tabs.size > 0 && activeHome == null;
  const show = siteOpen && !conv.running;
  contextChipsEl.hidden = !show;
  if (!show) return;

  const chips = ["Resume esta página", "O que vale minha atenção aqui?"];
  if (conv.tabs.size > 1) chips.push("Compara as abas abertas");
  contextChipsEl.innerHTML = "";
  for (const text of chips) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = text;
    chip.onclick = () => sendMessage(text);
    contextChipsEl.appendChild(chip);
  }
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
  setRunning(conv, true);
  setStatus(conv, "pensando…");
  window.clara.send(conv.id, trimmed, browserContext(conv));

  inputEl.value = "";
  autosize();
}

// Ambient state sent with every message so "esta página" resolves without
// the model having to guess or call list_tabs first.
function browserContext(conv) {
  if (!conv.tabs.size) return null;
  const active = conv.tabs.get(conv.activeTabId);
  return {
    activeTab: active
      ? { tabId: active.tabId, title: active.title, url: active.url }
      : null,
    tabs: [...conv.tabs.values()].map((t) => ({
      tabId: t.tabId,
      title: t.title,
      url: t.url,
    })),
  };
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
