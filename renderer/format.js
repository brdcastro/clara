/* Small, dependency-free Markdown renderer for conversational replies.
   Rich/page answers remain authored as HTML and run in the existing sandbox. */

(function exposeClaraFormat() {
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeHref(value) {
    const href = value.trim();
    // `inlineMarkdown` has already escaped the whole source before links are
    // recognized, so the href is safe to interpolate without double-escaping.
    return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
  }

  function inlineMarkdown(value) {
    const code = [];
    let html = escapeHtml(value).replace(/`([^`]+)`/g, (_match, content) => {
      const token = `@@CLARA_CODE_${code.length}@@`;
      code.push(`<code>${content}</code>`);
      return token;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const safe = safeHref(href);
      return safe
        ? `<a href="${safe}" target="_blank" rel="noreferrer">${label}</a>`
        : label;
    });
    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|\s)\*([^*]+)\*(?=\s|[.,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|\s)_([^_]+)_(?=\s|[.,;:!?]|$)/g, "$1<em>$2</em>");

    return html.replace(/@@CLARA_CODE_(\d+)@@/g, (_match, index) => code[Number(index)]);
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown).replace(/\r\n?/g, "\n").trim().split("\n");
    const output = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      output.push(`</${list}>`);
      list = null;
    };

    for (const line of lines) {
      if (/^```/.test(line)) {
        flushParagraph();
        closeList();
        if (code) {
          output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
          code = null;
        } else {
          code = [];
        }
        continue;
      }
      if (code) {
        code.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      const item = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
      if (item) {
        flushParagraph();
        const type = /^\d/.test(item[1]) ? "ol" : "ul";
        if (list !== type) {
          closeList();
          output.push(`<${type}>`);
          list = type;
        }
        output.push(`<li>${inlineMarkdown(item[2])}</li>`);
        continue;
      }

      const quote = line.match(/^>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        closeList();
        output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }

      closeList();
      paragraph.push(line.trim());
    }

    if (code) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    flushParagraph();
    closeList();
    return output.join("");
  }

  function isHtmlFragment(value) {
    return /^\s*(?:<!--|<[a-z][\s>])/i.test(String(value));
  }

  window.ClaraFormat = {
    bubbleHtml: (value) => (isHtmlFragment(value) ? String(value) : markdownToHtml(value)),
    isHtmlFragment,
    markdownToHtml,
  };
})();
