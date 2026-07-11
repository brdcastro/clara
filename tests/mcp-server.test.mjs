import { test } from "node:test";
import assert from "node:assert/strict";
import { imageBlockFromDataUrl } from "../agent/mcp-server.js";

test("imageBlockFromDataUrl: parses a png data URL into an MCP image block", () => {
  const block = imageBlockFromDataUrl("data:image/png;base64,AAAABBBB");
  assert.deepEqual(block, { type: "image", mimeType: "image/png", data: "AAAABBBB" });
});

test("imageBlockFromDataUrl: returns null for missing or non-data input", () => {
  assert.equal(imageBlockFromDataUrl(undefined), null);
  assert.equal(imageBlockFromDataUrl(null), null);
  assert.equal(imageBlockFromDataUrl("https://example.com/x.png"), null);
  assert.equal(imageBlockFromDataUrl(""), null);
});

test("imageBlockFromDataUrl: supports jpeg mime type", () => {
  const block = imageBlockFromDataUrl("data:image/jpeg;base64,ZZZZ");
  assert.equal(block.mimeType, "image/jpeg");
  assert.equal(block.data, "ZZZZ");
});
