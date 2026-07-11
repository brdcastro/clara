// Smoke test: verify the Codex SDK runs against the ChatGPT subscription auth
// in ~/.codex (no API key). Usage: node scripts/smoke-codex.mjs
import { Codex } from "@openai/codex-sdk";

// Mirrors AgentService config: user's global MCP servers hang codex exec,
// so Clara always disables them.
const codex = new Codex({
  config: {
    notify: [],
    mcp_servers: {
      figma: { enabled: false },
      node_repl: { enabled: false },
    },
  },
});
const thread = codex.startThread({
  sandboxMode: "read-only",
  approvalPolicy: "never",
  skipGitRepoCheck: true,
  modelReasoningEffort: "low",
});

const t0 = Date.now();
const turn = await thread.run("Responda apenas com a palavra: ok");
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log("thread_id:", thread.id);
console.log("response:", JSON.stringify(turn.finalResponse));
console.log("usage:", JSON.stringify(turn.usage));
console.log("elapsed:", elapsed + "s");
