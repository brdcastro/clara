import fs from "node:fs";
import path from "node:path";

// Persists the UI session (conversations, tabs, groups, chat messages) as a
// single JSON file so Clara survives restarts. The renderer owns the shape;
// this module only reads/writes and debounces disk writes.
export function createStore(userDataDir) {
  const file = path.join(userDataDir, "session.json");
  let writeTimer = null;

  function load() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  function save(state) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      try {
        fs.writeFileSync(file, JSON.stringify(state));
      } catch {
        /* best-effort; a failed save just loses the latest session */
      }
    }, 400);
  }

  return { load, save };
}
