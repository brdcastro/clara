# Clara — guide for coding agents

Clara is an LLM-first browser prototype (see README.md for architecture and
the hard-won gotchas — read both before touching code). The repo owner tests
the UI himself and rarely reads this repo; commits/pushes are expected from
agents directly, small and frequent, in English.

## Working rules

- **Never launch the Electron app** (`npm start`) — the owner runs it and
  sends screenshots. Verify headlessly instead:
  - `node --check` every file you touch (main is ESM, preload is CJS,
    renderer files are classic scripts — no modules).
  - `scripts/smoke-*.mjs` are real end-to-end tests but **spend the owner's
    ChatGPT subscription quota** — run them only when agent-facing behavior
    changed (contract, tools, MCP plumbing), not for UI-only edits.
- Simplicity first: vanilla JS, no frameworks, no build step, no new
  dependencies without a strong reason.
- Code, comments and commits in English; user-facing UI strings in PT-BR.
- Cuts visual identity (warm paper `#F8F7F3`, ink `#1C1612`, azure
  `#0D8FF0`; EB Garamond / Inter / JetBrains Mono). Match it.

## Landmines (details in README "Gotchas")

- Always disable inherited global MCP servers in Codex config overrides.
- MCP servers need `default_tools_approval_mode: "approve"`.
- Never reparent or `display:none` a `<webview>`.
- `srcdoc` iframes inherit the parent CSP.
- One turn at a time per thread (queues in AgentService).
- `agent-home/AGENTS.md` is generated — edit SOUL/USER/MEMORY/CONTRACT.
- `agent-home/history/` and USER/MEMORY content are the owner's personal
  data: never commit real entries, never paste them into issues/PRs.
