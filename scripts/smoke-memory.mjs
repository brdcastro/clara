// Smoke test: soul/memory/history — no Electron.
// 1. identity: composed AGENTS.md gives Clara the USER.md profile
// 2. history recall: grep over history/pages answers "onde eu vi…"
// 3. memory write: workspace-write lets Clara update MEMORY.md
// Restores USER.md/MEMORY.md afterwards. Usage: node scripts/smoke-memory.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpServer } from "../agent/mcp-server.js";
import { AgentService } from "../agent/agent.js";
import { createHistory } from "../agent/history.js";

const HOME = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-home");
const backups = new Map();
for (const f of ["USER.md", "MEMORY.md"]) {
  backups.set(f, fs.readFileSync(path.join(HOME, f), "utf8"));
}

// Seed a fake visited page about "abajur".
const history = createHistory(HOME);
history.record({
  url: "https://design.exemplo.com/iluminacao-escandinava",
  title: "Iluminação escandinava: 12 ideias",
  text:
    "Guia de iluminação escandinava. Destaque: o abajur Gräshoppa da Gubi, " +
    "design de Greta Grossman em 1947, tripé inclinado em aço. Outras opções: " +
    "PH5 da Louis Poulsen e a luminária AJ de Arne Jacobsen.",
});

const bridge = {
  openUrl: async (c, url) => ({ tabId: "tab-1", url, title: "ok" }),
  listTabs: () => [],
  readPage: async () => ({ error: "no tab open" }),
  interact: async () => ({ error: "no tab open" }),
};
const { port, close } = await startMcpServer(bridge);
const agent = new AgentService({ mcpPort: port });

async function scenario(label, prompt) {
  console.log(`\n=== ${label}: "${prompt}"`);
  const t0 = Date.now();
  await agent.send("conv-mem", prompt, (e) => {
    if (e.type === "item.completed" && e.item?.type === "command_execution") {
      console.log("  shell:", e.item.command.slice(0, 90));
    }
    if (e.type === "item.completed" && e.item?.type === "agent_message") {
      console.log("  resposta:", e.item.text.replace(/\n/g, " ").slice(0, 220));
    }
    if (e.type === "error" || e.type === "turn.failed") console.log("  ERRO:", JSON.stringify(e));
  });
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

await scenario("identidade", "Quem sou eu e como prefiro receber respostas?");
await scenario("histórico", "Onde foi que eu vi aquela referência de abajur?");
await scenario(
  "memória",
  "Aprenda para sempre: meu monitor é ultrawide, então tabelas largas funcionam bem para mim. Guarde isso."
);

console.log("\n--- USER.md/MEMORY.md diff vs. seed ---");
for (const [f, seed] of backups) {
  const now = fs.readFileSync(path.join(HOME, f), "utf8");
  console.log(now === seed ? `  ${f}: unchanged` : `  ${f}: MODIFIED ->`);
  if (now !== seed) {
    const added = now.split("\n").filter((l) => !seed.includes(l) && l.trim());
    for (const line of added) console.log(`    + ${line}`);
  }
}

// Restore seeds so the test leaves no trace in the identity files.
for (const [f, seed] of backups) fs.writeFileSync(path.join(HOME, f), seed);
console.log("\n(USER.md/MEMORY.md restaurados ao estado seed)");
close();
