import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Browsing history lives inside the agent home as plain grep-able files, so
// Clara can answer "where did I see…" by searching her own directory:
//   history/visits.log   — ISO-timestamp<TAB>url<TAB>title per visit
//   history/pages/*.md   — latest text snapshot per page (frontmatter + body)
export function createHistory(agentHome) {
  const dir = path.join(agentHome, "history");
  const pagesDir = path.join(dir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  function pageFile(url) {
    const u = new URL(url);
    const hash = crypto
      .createHash("sha1")
      .update(u.origin + u.pathname + u.search)
      .digest("hex")
      .slice(0, 8);
    const slug = (u.hostname + u.pathname)
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    return path.join(pagesDir, `${slug}-${hash}.md`);
  }

  function record({ url, title, text }) {
    if (!url || url.startsWith("about:") || url.startsWith("data:")) return;
    try {
      const ts = new Date().toISOString();
      const cleanTitle = (title ?? "").replace(/[\n\t]/g, " ").trim();
      fs.appendFileSync(
        path.join(dir, "visits.log"),
        `${ts}\t${url}\t${cleanTitle}\n`
      );
      if (!text?.trim()) return;
      const frontmatter = `---\nurl: ${url}\ntitle: ${cleanTitle}\ncaptured_at: ${ts}\n---\n\n`;
      fs.writeFileSync(pageFile(url), frontmatter + text.trim() + "\n");
    } catch {
      // History is best-effort; never let it break a navigation.
    }
  }

  return { record };
}
