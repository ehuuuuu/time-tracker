// popup.js

let currentYear, currentMonth;
let dailyLog = {};
let currentHostname = null;
let currentLabel = "none";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();

  const [hostRes, logRes] = await Promise.all([
    sendMsg({ type: "GET_CURRENT_HOST" }),
    sendMsg({ type: "GET_DAILY_LOG" })
  ]);

  dailyLog = logRes.log || {};
  currentHostname = hostRes.hostname;
  currentLabel = hostRes.label || "none";

  renderHeader();
  renderSiteControl();
  renderCalendar();

  document.getElementById("prev-month").addEventListener("click", () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
  });
  document.getElementById("next-month").addEventListener("click", () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
  });
}

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader() {
  const today = new Date().toISOString().slice(0, 10);
  const ms = dailyLog[today] || 0;
  const sign = ms >= 0 ? "+" : "-";
  const timeStr = formatMs(Math.abs(ms));

  document.getElementById("plusminus").textContent = "+/- Tracker";
  document.getElementById("today-score").textContent =
    `Today: ${sign}${timeStr} net time`;
}

// ── Site control ──────────────────────────────────────────────────────────────

function renderSiteControl() {
  document.getElementById("hostname-display").textContent =
    currentHostname || "No trackable page";

  const btns = document.querySelectorAll("#label-buttons button");
  btns.forEach(btn => {
    btn.classList.remove("active-pos", "active-none", "active-neg");
    if (btn.dataset.label === currentLabel) {
      btn.classList.add(
        currentLabel === "positive" ? "active-pos"
        : currentLabel === "negative" ? "active-neg"
        : "active-none"
      );
    }
    btn.addEventListener("click", async () => {
      if (!currentHostname) return;
      currentLabel = btn.dataset.label;
      await sendMsg({ type: "SET_LABEL", hostname: currentHostname, label: currentLabel });
      renderSiteControl();
    });
  });
}

// ── Calendar ──────────────────────────────────────────────────────────────────

function renderCalendar() {
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  document.getElementById("month-label").textContent =
    `${monthNames[currentMonth]} ${currentYear}`;

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  // Day labels
  DAYS.forEach(d => {
    const el = document.createElement("div");
    el.className = "day-label";
    el.textContent = d.slice(0, 1);
    grid.appendChild(el);
  });

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // Compute max absolute value for color scaling (per displayed month)
  let maxAbs = 1;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(currentYear, currentMonth, d);
    const val = dailyLog[key] || 0;
    if (Math.abs(val) > maxAbs) maxAbs = Math.abs(val);
  }

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    grid.appendChild(el);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(currentYear, currentMonth, d);
    const ms = dailyLog[key] || 0;
    const el = document.createElement("div");
    el.className = "day-cell";
    if (key === today) el.classList.add("today");

    const intensity = Math.min(Math.abs(ms) / maxAbs, 1);
    if (ms > 0) {
      el.style.backgroundColor = positiveColor(intensity);
    } else if (ms < 0) {
      el.style.backgroundColor = negativeColor(intensity);
    }

    // Tooltip
    if (ms !== 0) {
      const sign = ms > 0 ? "+" : "-";
      el.title = `${key}: ${sign}${formatMs(Math.abs(ms))}`;
    } else {
      el.title = `${key}: no data`;
    }

    grid.appendChild(el);
  }
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// GitHub-style green: low opacity at low intensity, rich green at high
function positiveColor(t) {
  // from #0e4429 (dim) to #3fb950 (bright)
  const r = Math.round(14 + t * (63 - 14));
  const g = Math.round(68 + t * (185 - 68));
  const b = Math.round(41 + t * (80 - 41));
  return `rgb(${r},${g},${b})`;
}

function negativeColor(t) {
  // from #4a1b1b (dim) to #f85149 (bright)
  const r = Math.round(74 + t * (248 - 74));
  const g = Math.round(27 + t * (81 - 27));
  const b = Math.round(27 + t * (73 - 27));
  return `rgb(${r},${g},${b})`;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function formatMs(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function sendMsg(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

init();