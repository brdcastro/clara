# Clara

LLM-first browser prototype: no URL bar — a chat composer drives everything.
The agent answers as rich interactive HTML cards, opens real sites inline in
the feed, reads them, and interacts with them (with per-tab user consent).

Runs on the user's **ChatGPT subscription** via the Codex SDK — no API key.

## Run

```bash
npm install
npm start          # Electron app
npm run smoke      # agent-only smoke test (no UI)
```

## Architecture

```
main.js                    Electron main — window, IPC, tool round-trips (askRenderer)
preload.cjs                contextBridge: window.clara { send, onEvent, onToolRequest, reply, … }
agent/agent.js             AgentService — one Codex instance+thread per conversation
agent/mcp-server.js        Clara's tools over streamable HTTP: open_url, list_tabs,
                           read_page, interact (stateless, /mcp/<conversationId>)
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
a floating overlay above the composer, collapsed to the last user/agent
exchange. Scrolling over the bubbles expands the history; clicking into the
site (or Esc, or sending a message) collapses it back.

**Sidebar**: tabs and conversations are deliberately the same thing — one
item per context. An item with one tab wears that page's favicon/title; with
several tabs its pages nest under it. Users can create custom groups
(❐ button, name editable inline) and drag items into them; dropping on the
list background ungroups. The sidebar is translucent over macOS vibrancy
(`vibrancy: "sidebar"` + transparent body, solid `#main`).

- **Agent**: `@openai/codex-sdk` → spawns bundled `codex exec`. Auth comes from
  `~/.codex/auth.json` (ChatGPT login). Threads persist in `~/.codex/sessions`.
- **Cards**: agent replies are HTML fragments rendered in sandboxed
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

## Ideas beyond the prototype

Persistence (conversations survive restart via `resumeThread`), model/effort
picker in the UI, `@mozilla/readability` for cleaner extraction, screenshots
of tabs as model input (`local_image`), webview `target=_blank` handling,
dark mode.
