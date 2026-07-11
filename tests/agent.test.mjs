import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentService } from "../agent/agent.js";

// These exercise only the resume bookkeeping — no Codex process is spawned,
// so they cost nothing and run in CI.

test("agent: threadId is null before any thread or resume id", () => {
  const agent = new AgentService();
  assert.equal(agent.threadId("conv-1"), null);
});

test("agent: registerResume makes threadId report the resumed id", () => {
  const agent = new AgentService();
  agent.registerResume("conv-1", "th_resumed");
  assert.equal(agent.threadId("conv-1"), "th_resumed");
});

test("agent: registerResume ignores empty thread ids", () => {
  const agent = new AgentService();
  agent.registerResume("conv-1", null);
  agent.registerResume("conv-1", "");
  assert.equal(agent.threadId("conv-1"), null);
});
