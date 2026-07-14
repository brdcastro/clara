# Clara

**An LLM-first browser.** No URL bar — a chat composer drives everything.
Ask, and Clara answers as rich interactive HTML; name a site, and it takes
the stage while the conversation floats above it. She reads the pages you
open, acts on them with your consent, remembers who you are, keeps a
searchable memory of everywhere you've been, and curates tabs into groups
with thumbnails and her own summaries.

Runs entirely on your **ChatGPT subscription** via the Codex SDK — no API
key, no per-token bill. macOS, Electron, vanilla JS, MIT.

> Prototype status: built agent-first (see CLAUDE.md); UI screenshots coming.

## Highlights

- **Answers are interfaces**: replies render as sandboxed HTML cards — from a
  one-line answer to a working calculator or comparison table.
- **Sites are conversation**: open/read/interact tools let Clara browse with
  you (first interaction per tab requires your consent).
- **Memory with a soul**: SOUL/USER/MEMORY files compose her identity; she
  updates her own notes as she learns you.
- **"Onde eu vi aquilo?"**: every visited page is archived as grep-able
  markdown; Clara searches her own history to answer.
- **Groups with a home**: popup links auto-group with their origin; each
  group gets a home page with thumbnails and an LLM-written summary.

## Run

```bash
npm install
npm start          # Electron app
npm run check      # node --check every source file (fast, offline)
npm test           # node:test unit tests (offline, no quota)
npm run dist       # package dist/mac-arm64/Clara.app (unsigned, no icon yet)
node scripts/smoke-mcp.mjs   # end-to-end agent test — SPENDS ChatGPT quota
```

Packaged builds move Clara's agent home to `userData/agent-home` (seeded on
first run) since the app bundle is read-only; downloads save to ~/Downloads
with a notice in the feed.

## Architecture

```
main.js                    Electron main — window, IPC, tool round-trips (askRenderer)
preload.cjs                contextBridge: window.clara { send, onEvent, onToolRequest, reply, … }
agent/agent.js             AgentService — one Codex instance+thread per conversation
                           (startThread / resumeThread for persistence)
agent/mcp-server.js        Clara's tools over streamable HTTP: open_url, list_tabs,
                           read_page, interact (stateless, /mcp/<conversationId>)
agent/store.js             session.json read/write (debounced) in userData
renderer/session.js        serialize/rehydrate the UI to/from that store
tests/                     node:test offline units (store round-trip, resume)
agent-home/                Clara's home. AGENTS.md is GENERATED per new thread
                           from SOUL.md (voice) + USER.md (user profile) +
                           MEMORY.md (her lessons) + CONTRACT.md (harness rules).
                           history/ archives every visited page as grep-able
                           markdown (visits.log + pages/*.md)
renderer/app.js            UI: sidebar (tabs+conversations), stage, chat overlay,
                           composer, consent bar for agent interactions
renderer/page-scripts.js   JS injected into webviews: extract text+refs, act on refs
```

**Layout model**: a conversation starts as a normal chat feed. Once a tab
exists, the site takes the whole main area (the stage) and the chat becomes
an autonomous companion dock above the composer. The latest exchange stays
visible for a short handoff, then settles into a small **Conversa** control so
it does not cover the site. Sending or receiving reveals it again; the control
opens the latest exchange/history, while clicking the site or pressing Esc
dismisses it.

**Sidebar**: tabs and conversations are deliberately the same thing — one
item per context. An item with one tab wears that page's favicon/title; with
several tabs its pages nest under it. Users can create custom groups
(folder-plus button, rename via double-click) and drag items into them or to
an exact position; conversations and groups can both be reordered, and
dropping on the list background ungroups. The sidebar is translucent over macOS vibrancy
(`vibrancy: "sidebar"` + transparent body, solid `#main`).

**Auto-groups & group home**: target=_blank / window.open popups are denied
in main and reopened as sibling items, auto-grouped with the origin site
(group named after its domain; cmd+click keeps focus via disposition).
Clicking a group header opens the **group home** on the stage: thumbnail
grid of the group's pages (captured on page settle via `capturePage`) plus a
2–3 sentence summary written by Clara on a shared utility thread
(`agent.summarize`), cached by member-URL key and refreshed when membership
changes. Esc or opening any item leaves the home.

- **Agent**: `@openai/codex-sdk` → spawns bundled `codex exec`. Auth comes from
  `~/.codex/auth.json` (ChatGPT login). Threads persist in `~/.codex/sessions`.
- **Cards**: short agent replies can be Markdown (rendered locally) or simple
  HTML; substantial replies are HTML pages. Both render in sandboxed
  `iframe[srcdoc]` (`allow-scripts`, no `allow-same-origin`). A wrapper injects
  Cuts design tokens + Google Fonts and reports height via `postMessage`.
- **Identity**: Cuts (EB Garamond / Inter / JetBrains Mono, warm paper + azure).
  Tokens mirrored from `GemmaLite/Packages/GemmaDesign/DesignTokens.swift`.

## Gotchas (learned the hard way)

- **Global MCP servers hang codex exec.** The user's `~/.codex/config.toml`
  registers ChatGPT.app MCP servers (`node_repl`, `figma`); inheriting them
  stalls turns indefinitely. `AgentService` must always pass
  `mcp_servers.<name>.enabled=false` overrides (plus `notify=[]`).
- **MCP tool calls need `default_tools_approval_mode = "approve"`.** Without
  it, non-interactive exec raises an approval elicitation that auto-resolves
  to Cancel and every Clara tool call fails as "cancelled".
- **Tool→feed scoping**: Clara's MCP server runs over local HTTP and the
  conversation id is in the URL path (`/mcp/<conversationId>`), one Codex
  instance per conversation. Tool calls land in the right feed with no
  session state on the server (stateless transport, fresh per request).
- **Never reparent or `display:none` a `<webview>`** — both reload/detach the
  guest. All webviews live stacked in `#stage-views` and switch via
  `visibility`.
- **Cold start**: first turn on a thread ≈ 40s; warm turns ≈ 6s. Conversations
  are warmed up on creation (one hidden "ok" turn) so the first real answer is
  fast. Disable in `renderer/app.js` (`window.clara.warmup`) if quota matters.
- **`srcdoc` iframes inherit the parent CSP** — the CSP in `renderer/index.html`
  deliberately allows inline scripts/styles, Google Fonts and https images so
  LLM cards work. The iframe sandbox is the real security boundary.
- Turns on one thread must never overlap; `AgentService` serializes them with
  a per-conversation promise queue.

## Roadmap

1. ✅ **Shell + rich HTML** — sidebar/feed/composer, agent → HTML cards, warmup.
2. ✅ **Navigation** — `open_url`/`list_tabs` tools (app MCP server over local
   HTTP), site cards via `<webview>` inline in the feed, stage mode, tabs in
   the sidebar, omnibox fast path for typed URLs.
3. ✅ **Reading** — `read_page`: injected extractor returns url/title/main text
   (25k char cap) + up to 150 visible interactive elements tagged with
   `data-clara-ref`.
4. ✅ **Interaction** — `interact { ref, action: click|fill|press_enter, text }`.
   First interaction on a tab shows a consent bar on the site card
   ("Permitir nesta aba" / "Negar"); approval sticks per tab. React-safe fill
   (native value setter + input/change events), Enter simulation with
   `form.requestSubmit()` fallback.

All four verified headless via `scripts/smoke-mcp.mjs` (stub bridge): the
agent opens → reads → answers from content, and fill→re-read→click→re-read
for interactions.

## Soul, memory & history (Hermes-inspired)

- **Identity composition**: every new thread regenerates `AGENTS.md` from
  SOUL + USER + MEMORY + CONTRACT, so Clara always starts with her current
  self. Edit those four files, never AGENTS.md.
- **Self-written memory**: the sandbox is `workspace-write` scoped to
  agent-home; the contract tells Clara to silently update USER.md (facts
  about the user) and MEMORY.md (her own lessons).
- **Browsing history**: the renderer snapshots every settled page
  (`did-stop-loading` + 1.2s debounce) and main archives it under
  `agent-home/history/` — `visits.log` plus one markdown file per URL.
  Agent `read_page` results are archived too. "Onde eu vi X?" is answered by
  Clara grepping her own history (no dedicated search tool needed).
  History is unbounded for now and gitignored (personal data).

Verified headless via `scripts/smoke-memory.mjs`: identity recall, history
grep ("abajur" → page title+url+detail), and a USER.md self-update.

## Persistence

The whole UI session (conversations, tabs, groups, chat messages, active
selection) is serialized to `session.json` in Electron's `userData` and
rehydrated on boot. Webviews reload from their saved URLs; Codex conversations
resume by thread id (`resumeThread`), so follow-up messages continue the same
thread. Saves are debounced; the thread id is captured from the
`thread.started` event and merged in main (authoritative). Covered by
`tests/store.test.mjs` and `tests/agent.test.mjs`.

## Ideas beyond the prototype

Persistence (conversations survive restart via `resumeThread`), model/effort
picker in the UI, `@mozilla/readability` for cleaner extraction, screenshots
of tabs as model input (`local_image`), webview `target=_blank` handling,
dark mode.
