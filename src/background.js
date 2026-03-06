// background.js — MV3 service worker

const TICK_INTERVAL_MS = 5000; // checkpoint every 5s
const IDLE_THRESHOLD_S = 60;   // consider idle after 60s

let session = null; // { hostname, startMs, label }

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
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
  await commitSession(); // flush any existing session first
  const labels = await getLabels();
  const hostname = getHostname(url);
  if (!hostname) return;
  const label = labels[hostname] || "none";
  session = { hostname, startMs: Date.now(), label };
  await chrome.storage.local.set({ activeSession: session });
}

async function commitSession() {
  if (!session) {
    // try to recover from storage (service worker may have been killed)
    const { activeSession } = await chrome.storage.local.get("activeSession");
    if (activeSession) session = activeSession;
    else return;
  }

  const elapsedMs = Date.now() - session.startMs;
  if (elapsedMs < 1000) { session = null; return; } // ignore sub-second blips

  // Handle cross-day splits
  const startDate = new Date(session.startMs).toISOString().slice(0, 10);
  const endDate = todayKey();

  const dailyLog = await getDailyLog();

  if (startDate === endDate) {
    applyTime(dailyLog, startDate, elapsedMs, session.label);
  } else {
    // Split at midnight boundaries
    const midnightAfterStart = new Date(startDate);
    midnightAfterStart.setDate(midnightAfterStart.getDate() + 1);
    const msOnStartDay = midnightAfterStart - session.startMs;
    applyTime(dailyLog, startDate, msOnStartDay, session.label);
    // For simplicity, attribute the rest to today (multi-day gaps are rare)
    const msOnEndDay = Date.now() - midnightAfterStart;
    if (msOnEndDay > 0) applyTime(dailyLog, endDate, msOnEndDay, session.label);
  }

  await chrome.storage.local.set({ dailyLog, activeSession: null });
  session = null;
}

function applyTime(log, dateKey, ms, label) {
  if (label === "none") return;
  if (label === "positive") {
    log[dateKey] = (log[dateKey] || 0) + ms;
    log[dateKey + "_pos"] = (log[dateKey + "_pos"] || 0) + ms;
  } else {
    log[dateKey] = (log[dateKey] || 0) - ms;
    log[dateKey + "_neg"] = (log[dateKey + "_neg"] || 0) + ms;
  }
}

async function endSession() {
  await commitSession();
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
    await endSession();
  } else {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.url) await startSession(tab.url);
  }
});

// Periodic checkpoint so we don't lose data if the worker is killed
chrome.alarms.create("tick", { periodInMinutes: 1 / 12 }); // every 5s equiv
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tick") return;
  const state = await chrome.idle.queryState(IDLE_THRESHOLD_S);
  if (state === "idle" || state === "locked") {
    await endSession();
  } else {
    // Re-checkpoint: commit and immediately restart the same session
    if (session) {
      const { hostname, label } = session;
      await commitSession();
      session = { hostname, startMs: Date.now(), label };
      await chrome.storage.local.set({ activeSession: session });
    }
  }
});

// Recover on service worker startup
chrome.runtime.onStartup.addListener(async () => {
  await commitSession();
});

// Message bridge for popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_CURRENT_HOST") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const hostname = tabs[0]?.url ? getHostname(tabs[0].url) : null;
      const labels = await getLabels();
      sendResponse({ hostname, label: labels[hostname] || "none" });
    });
    return true; // async
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
      // restart session with new label
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
});