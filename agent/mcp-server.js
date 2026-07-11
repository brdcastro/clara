import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Clara's browser tools, served over streamable HTTP at /mcp/<conversationId>.
// Codex is configured per conversation with the matching URL, which is how a
// tool call knows which conversation's feed it acts on.
//
// bridge interface (implemented by the Electron main process):
//   openUrl(conversationId, url)             -> Promise<{ tabId, url, title } | { error }>
//   listTabs(conversationId)                 -> Array<{ tabId, url, title }>
//   readPage(conversationId, tabId?)         -> Promise<{ url, title, text, elements } | { error }>
//   interact(conversationId, tabId?, action) -> Promise<{ ok } | { error }>

function buildServer(conversationId, bridge) {
  const server = new McpServer({ name: "clara", version: "0.1.0" });

  server.registerTool(
    "open_url",
    {
      description:
        "Open a website as a live card in the user's feed. Returns the tab id, " +
        "final URL and page title. The card is immediately visible to the user.",
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const result = await bridge.openUrl(conversationId, normalized);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "list_tabs",
    {
      description:
        "List the tabs currently open in this conversation, with tab id, URL and title.",
      inputSchema: {},
    },
    async () => {
      const tabs = bridge.listTabs(conversationId);
      return { content: [{ type: "text", text: JSON.stringify(tabs) }] };
    }
  );

  server.registerTool(
    "read_page",
    {
      description:
        "Read the current content of an open tab: url, title, main text, and " +
        "the visible interactive elements (numbered refs usable with the " +
        "interact tool). Omit tab_id to read the most recently opened tab. " +
        "Set screenshot=true to also receive an image of the page — do this " +
        "for visual pages (charts, maps, diagrams, image-heavy layouts) where " +
        "the text alone is not enough.",
      inputSchema: {
        tab_id: z.string().optional(),
        screenshot: z.boolean().optional(),
      },
    },
    async ({ tab_id, screenshot }) => {
      const result = await bridge.readPage(conversationId, tab_id, { screenshot });
      const { screenshot: dataUrl, ...rest } = result;
      const content = [{ type: "text", text: JSON.stringify(rest) }];
      const image = imageBlockFromDataUrl(dataUrl);
      if (image) content.push(image);
      return { content };
    }
  );

  server.registerTool(
    "interact",
    {
      description:
        "Interact with an element of an open tab, identified by its ref from " +
        "read_page. Actions: click, fill (with text), press_enter. The first " +
        "interaction on a tab asks the user for permission; it may be denied. " +
        "After interacting, call read_page again to see the result.",
      inputSchema: {
        tab_id: z.string().optional(),
        ref: z.union([z.string(), z.number()]),
        action: z.enum(["click", "fill", "press_enter"]),
        text: z.string().optional(),
      },
    },
    async ({ tab_id, ref, action, text }) => {
      const result = await bridge.interact(conversationId, tab_id, { ref, action, text });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "group_tabs",
    {
      description:
        "Organize this conversation's tabs into a named sidebar group: each " +
        "tab becomes its own item inside the group (created if new, reused if " +
        "a group with that name already exists), and the group home opens " +
        "with thumbnails and a summary. Omit tab_ids to group every open tab. " +
        "Use after opening several related pages for the user.",
      inputSchema: {
        name: z.string(),
        tab_ids: z.array(z.string()).optional(),
      },
    },
    async ({ name, tab_ids }) => {
      const result = await bridge.groupTabs(conversationId, name, tab_ids);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  return server;
}

// Converts a `data:image/png;base64,…` URL into an MCP image content block,
// or null when there is no usable image.
export function imageBlockFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!match) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

// Stateless transport: fresh server+transport per request, no session ids.
export function startMcpServer(bridge, { onRequest } = {}) {
  const httpServer = http.createServer(async (req, res) => {
    onRequest?.(req.method, req.url);
    const match = req.url?.match(/^\/mcp\/([\w-]+)$/);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readBody(req);
      const server = buildServer(match[1], bridge);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err?.message ?? err) }));
      }
    }
  });

  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      resolve({
        port: httpServer.address().port,
        close: () => httpServer.close(),
      });
    });
  });
}
