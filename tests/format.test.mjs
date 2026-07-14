import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../renderer/format.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const format = context.window.ClaraFormat;

test("format: renders compact Markdown as semantic HTML", () => {
  const html = format.bubbleHtml("**Kyoto**\n\n- Gion\n- Arashiyama");
  assert.equal(html, "<p><strong>Kyoto</strong></p><ul><li>Gion</li><li>Arashiyama</li></ul>");
});

test("format: preserves intentional HTML fragments", () => {
  const html = "<p>Resposta <strong>curta</strong>.</p>";
  assert.equal(format.bubbleHtml(html), html);
});

test("format: preserves escaped query strings in safe Markdown links", () => {
  const html = format.bubbleHtml("[buscar](https://example.com/?a=1&b=2)");
  assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
});

test("format: escapes raw markup and rejects unsafe links in Markdown", () => {
  const html = format.bubbleHtml("Texto <script>alert(1)</script> [abrir](javascript:alert(1))");
  assert.equal(html, "<p>Texto &lt;script&gt;alert(1)&lt;/script&gt; abrir)</p>");
});
