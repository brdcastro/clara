// Standalone Clara MCP server with a stub bridge and request logging.
// Usage: node scripts/mcp-serve.mjs — prints the port, serves until killed.
import { startMcpServer } from "../agent/mcp-server.js";

const bridge = {
  async openUrl(conversationId, url) {
    console.log("[bridge] openUrl", conversationId, url);
    return { tabId: "tab-1", url, title: "Example Domain" };
  },
  listTabs(conversationId) {
    console.log("[bridge] listTabs", conversationId);
    return [];
  },
};

const { port } = await startMcpServer(bridge, {
  onRequest: (method, url) => console.log("[http]", method, url),
});
console.log("PORT=" + port);
