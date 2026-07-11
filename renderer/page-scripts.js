/* Scripts injected into site webviews via executeJavaScript.
   Loaded before app.js; exposes window.ClaraPageScripts. */

const ClaraPageScripts = {
  // Extracts readable text plus visible interactive elements. Elements are
  // tagged with data-clara-ref so a later interact() can find them.
  extract() {
    return `(() => {
      const MAX_TEXT = 25000;
      const MAX_ELEMENTS = 150;

      const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="searchbox"], [contenteditable="true"]';
      const elements = [];
      let ref = 0;
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width < 2 || rect.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
        ref += 1;
        el.setAttribute("data-clara-ref", String(ref));
        const label = (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "")
          .trim().replace(/\\s+/g, " ").slice(0, 80);
        const entry = { ref, tag: el.tagName.toLowerCase(), label };
        if (el.tagName === "A") entry.href = el.getAttribute("href");
        if (el.tagName === "INPUT") entry.type = el.type;
        elements.push(entry);
        if (elements.length >= MAX_ELEMENTS) break;
      }

      const root = document.querySelector('main, article, [role="main"]') || document.body;
      let text = (root.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\\n…[truncated]";

      return { url: location.href, title: document.title, text, elements };
    })()`;
  },

  // Performs one action on a previously tagged element.
  interact(ref, action, text) {
    const args = JSON.stringify({ ref: String(ref), action, text: text ?? "" });
    return `((args) => {
      const { ref, action, text } = args;
      const el = document.querySelector('[data-clara-ref="' + ref + '"]');
      if (!el) return { error: "ref not found — the page changed, call read_page again" };
      el.scrollIntoView({ block: "center" });

      if (action === "click") {
        el.click();
        return { ok: true, did: "click" };
      }
      if (action === "fill") {
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, text);
        else if ("value" in el) el.value = text;
        else el.textContent = text; // contenteditable
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, did: "fill" };
      }
      if (action === "press_enter") {
        el.focus();
        for (const type of ["keydown", "keypress", "keyup"]) {
          el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        }
        if (el.form?.requestSubmit) el.form.requestSubmit();
        return { ok: true, did: "press_enter" };
      }
      return { error: "unknown action: " + action };
    })(${args})`;
  },
};

window.ClaraPageScripts = ClaraPageScripts;
