// Smoke test: codex -> Clara MCP server (HTTP) -> browser tools, no Electron.
// Exercises open_url (part 2), read_page (part 3) and interact (part 4)
// against a stub bridge. Usage: node scripts/smoke-mcp.mjs
import { startMcpServer } from "../agent/mcp-server.js";
import { AgentService } from "../agent/agent.js";

const FAKE_PAGE = {
  tabId: "tab-1",
  url: "https://news.exemplo.com/",
  title: "Notícias do Exemplo",
  text:
    "Notícias do Exemplo\n\nManchete: Cometa vira-lata é fotografado sobre o Atlântico.\n" +
    "Astrônomos amadores registraram na terça-feira um cometa apelidado de vira-lata.\n" +
    "Previsão: chuva de granizo no litoral na sexta-feira.",
  elements: [
    { ref: 1, tag: "input", type: "search", label: "Buscar notícias" },
    { ref: 2, tag: "button", label: "Buscar" },
    { ref: 3, tag: "a", label: "Sobre", href: "/sobre" },
  ],
};

const calls = [];
const bridge = {
  async openUrl(conversationId, url) {
    calls.push({ tool: "open_url", url });
    return { tabId: "tab-1", url, title: FAKE_PAGE.title };
  },
  listTabs() {
    calls.push({ tool: "list_tabs" });
    return [{ tabId: "tab-1", url: FAKE_PAGE.url, title: FAKE_PAGE.title }];
  },
  async readPage(conversationId, tabId) {
    calls.push({ tool: "read_page", tabId: tabId ?? null });
    return FAKE_PAGE;
  },
  async interact(conversationId, tabId, action) {
    calls.push({ tool: "interact", ...action });
    return { ok: true, did: action.action };
  },
};

const { port, close } = await startMcpServer(bridge);
console.log("mcp server on port", port);
const agent = new AgentService({ mcpPort: port });

async function scenario(label, prompt) {
  console.log(`\n=== ${label}: "${prompt}"`);
  const t0 = Date.now();
  await agent.send("conv-test", prompt, (e) => {
    if (e.type === "item.completed" && e.item?.type === "mcp_tool_call") {
      console.log("  tool:", e.item.tool, JSON.stringify(e.item.arguments), "->", e.item.status);
    }
    if (e.type === "item.completed" && e.item?.type === "agent_message") {
      console.log("  resposta:", e.item.text.replace(/\n/g, " ").slice(0, 200));
    }
    if (e.type === "error" || e.type === "turn.failed") {
      console.log("  ERRO:", JSON.stringify(e));
    }
  });
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

await scenario("parte 2+3: abrir e ler", "Abre news.exemplo.com e me diz qual é a manchete de hoje");
await scenario("parte 4: interagir", "Pesquisa por 'granizo' nesse site");

console.log("\n--- bridge calls ---");
for (const call of calls) console.log(" ", JSON.stringify(call));
close();
