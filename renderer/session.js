/* Session persistence: serialize the live UI (conversations, tabs, groups,
   chat messages, thread ids) and rehydrate on boot. Webviews reload from
   their URLs; Codex threads resume by id. Loaded before app.js; exposes
   window.ClaraSession as a factory. */

window.ClaraSession = function createSession({
  conversations,
  groups,
  getActiveId,
  getCounters,
}) {
  let saveTimer = null;

  function serialize() {
    return {
      activeId: getActiveId(),
      counters: getCounters(),
      conversations: [...conversations.values()].map((conv) => ({
        id: conv.id,
        title: conv.title,
        threadId: conv.threadId ?? null,
        activeTabId: conv.activeTabId,
        messages: conv.messages,
        tabs: [...conv.tabs.values()].map((tab) => ({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          favicon: tab.favicon,
        })),
      })),
      groups: [...groups.values()].map((group) => ({
        id: group.id,
        name: group.name,
        collapsed: group.collapsed,
        convIds: group.convIds,
      })),
    };
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => window.clara.saveSession(serialize()), 700);
  }

  return { scheduleSave, load: () => window.clara.loadSession() };
};
