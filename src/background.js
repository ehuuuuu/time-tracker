// background.js — MV3 service worker

const IDLE_THRESHOLD_S = 60;

let session = null; // { hostname, startMs, label }

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getHostname(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (["chrome:", "chrome-extension:", "about:", "edge:", "data:"].includes(protocol)) return null;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function getLabels() {
  const { labels = {} } = await chrome.storage.local.get("labels");
  return labels;
}

async function getDailyLog() {
  const { dailyLog = {} } = await chrome.storage.local.get("dailyLog");
  return dailyLog;
}

// ── Session management ────────────────────────────────────────────────────────

async function startSession(url) {
  await commitSession();
  const hostname = getHostname(url);
  if (!hostname) return;
  const labels = await getLabels();
  const label = labels[hostname] || "none";
  session = { hostname, startMs: Date.now(), label };
  await chrome.storage.local.set({ activeSession: session });
}

async function commitSession() {
  let s = session;
  if (!s) {
    const { activeSession } = await chrome.storage.local.get("activeSession");
    if (!activeSession) return;
    s = activeSession;
  }
  session = null;
  await chrome.storage.local.set({ activeSession: null });

  if (!s || !s.label || !s.startMs) return;

  const elapsedMs = Date.now() - s.startMs;
  if (elapsedMs < 1000) return;

  const startD = new Date(s.startMs);
  const startDate = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-${String(startD.getDate()).padStart(2, "0")}`;
  const endDate = todayKey();
  const dailyLog = await getDailyLog();

  if (startDate === endDate) {
    applyTime(dailyLog, startDate, elapsedMs, s.label, s.hostname);
  } else {
    const midnightAfterStart = new Date(startD);
    midnightAfterStart.setDate(midnightAfterStart.getDate() + 1);
    midnightAfterStart.setHours(0, 0, 0, 0);
    const msOnStartDay = midnightAfterStart - s.startMs;
    applyTime(dailyLog, startDate, msOnStartDay, s.label, s.hostname);
    const msOnEndDay = Date.now() - midnightAfterStart;
    if (msOnEndDay > 0) applyTime(dailyLog, endDate, msOnEndDay, s.label, s.hostname);
  }

  await chrome.storage.local.set({ dailyLog });
}

function applyTime(log, dateKey, ms, label, hostname) {
  if (label === "none") return;
  if (label === "positive") {
    log[dateKey] = (log[dateKey] || 0) + ms;
    log[dateKey + "_pos"] = (log[dateKey + "_pos"] || 0) + ms;
  } else {
    log[dateKey] = (log[dateKey] || 0) - ms;
    log[dateKey + "_neg"] = (log[dateKey + "_neg"] || 0) + ms;
  }
  // Per-site breakdown
  const sitesKey = dateKey + "_sites";
  if (!log[sitesKey]) log[sitesKey] = {};
  const delta = label === "positive" ? ms : -ms;
  log[sitesKey][hostname] = (log[sitesKey][hostname] || 0) + delta;
}

// ── Event listeners ───────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) await startSession(tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active && tab.url) {
    await startSession(tab.url);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await commitSession();
  } else {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.url) await startSession(tab.url);
  }
});

chrome.alarms.create("tick", { periodInMinutes: 1 / 12 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  const state = await chrome.idle.queryState(IDLE_THRESHOLD_S);
  if (state === "idle" || state === "locked") {
    await commitSession();
  } else {
    const { activeSession } = await chrome.storage.local.get("activeSession");
    const current = session || activeSession;
    if (current?.hostname && current?.label) {
      await commitSession();
      session = { hostname: current.hostname, startMs: Date.now(), label: current.label };
      await chrome.storage.local.set({ activeSession: session });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await commitSession();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_CURRENT_HOST") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const hostname = tabs[0]?.url ? getHostname(tabs[0].url) : null;
      const labels = await getLabels();
      sendResponse({ hostname, label: labels[hostname] || "none" });
    });
    return true;
  }

  if (msg.type === "SET_LABEL") {
    (async () => {
      const labels = await getLabels();
      if (msg.label === "none") {
        delete labels[msg.hostname];
      } else {
        labels[msg.hostname] = msg.label;
      }
      await chrome.storage.local.set({ labels });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) await startSession(tab.url);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "GET_DAILY_LOG") {
    getDailyLog().then(log => sendResponse({ log }));
    return true;
  }

  if (msg.type === "GET_LABELS") {
    getLabels().then(labels => sendResponse({ labels }));
    return true;
  }

  if (msg.type === "REMOVE_LABEL") {
    (async () => {
      const labels = await getLabels();
      delete labels[msg.hostname];
      await chrome.storage.local.set({ labels });
      sendResponse({ ok: true });
    })();
    return true;
  }
});