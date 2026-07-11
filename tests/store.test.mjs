import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../agent/store.js";

test("store: load returns null when no session file exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clara-store-"));
  const store = createStore(dir);
  assert.equal(store.load(), null);
});

test("store: save then load round-trips the session (after debounce)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clara-store-"));
  const store = createStore(dir);
  const state = {
    activeId: "conv-2",
    counters: { nextId: 3, nextTabId: 5, nextGroupId: 2 },
    conversations: [
      { id: "conv-1", title: "Hacker News", threadId: "th_abc", tabs: [], messages: [] },
      {
        id: "conv-2",
        title: null,
        threadId: null,
        activeTabId: "tab-4",
        tabs: [{ tabId: "tab-4", url: "https://example.com/", title: "Example" }],
        messages: [{ role: "user", text: "oi" }],
      },
    ],
    groups: [{ id: 1, name: "Pesquisa", collapsed: false, convIds: ["conv-1"] }],
  };

  store.save(state);
  await new Promise((r) => setTimeout(r, 500)); // wait past the 400ms debounce

  const loaded = store.load();
  assert.deepEqual(loaded, state);
});

test("store: rapid saves debounce to the last state", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clara-store-"));
  const store = createStore(dir);
  for (let i = 0; i < 5; i++) store.save({ activeId: `conv-${i}`, conversations: [] });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(store.load().activeId, "conv-4");
});
