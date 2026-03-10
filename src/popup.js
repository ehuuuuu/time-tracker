// popup.js

let currentYear, currentMonth;
let dailyLog = {};
let currentHostname = null;
let currentLabel = "none";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TOP_N = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

  renderMainTab();
  renderCalendar();

  const menuBtn = document.getElementById("menu-btn");
  const dropdown = document.getElementById("dropdown");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });
  console.log("menuBtn", menuBtn, "dropdown", dropdown);


  document.addEventListener("click", () => dropdown.classList.add("hidden"));

  document.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const tab = item.dataset.tab;
      document.querySelectorAll(".dropdown-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      showPanel(tab);
      document.getElementById("current-tab-label").textContent = item.textContent;
      dropdown.classList.add("hidden");
      if (tab === "labels") renderLabelsTab();
    });
  });

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

  document.getElementById("day-back").addEventListener("click", () => {
    showPanel("calendar");
    document.getElementById("current-tab-label").textContent = "Calendar";
    document.querySelectorAll(".dropdown-item").forEach(i => {
      i.classList.toggle("active", i.dataset.tab === "calendar");
    });
  });
}

function showPanel(name) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  document.getElementById(`tab-${name}`).classList.remove("hidden");
}

// ── Main tab ──────────────────────────────────────────────────────────────────

function renderMainTab() {
  const today = localDateKey();
  const net = dailyLog[today] || 0;
  const pos = dailyLog[today + "_pos"] || 0;
  const neg = dailyLog[today + "_neg"] || 0;

  const circle = document.getElementById("net-circle");
  circle.className = net > 0 ? "pos" : net < 0 ? "neg" : "";
  document.getElementById("net-sign").textContent = net >= 0 ? "+" : "−";
  document.getElementById("net-time").textContent = formatMs(Math.abs(net));

  const maxMs = Math.max(pos, neg, 1);
  document.getElementById("pos-bar").style.width = `${(pos / maxMs) * 100}%`;
  document.getElementById("neg-bar").style.width = `${(neg / maxMs) * 100}%`;
  document.getElementById("pos-time").textContent = formatMs(pos);
  document.getElementById("neg-time").textContent = formatMs(neg);

  document.getElementById("hostname-display").textContent =
    currentHostname || "No trackable page";

  document.querySelectorAll("#label-buttons button").forEach(btn => {
    btn.classList.remove("active-pos", "active-none", "active-neg");
    if (btn.dataset.label === currentLabel) {
      btn.classList.add(
        currentLabel === "positive" ? "active-pos"
        : currentLabel === "negative" ? "active-neg"
        : "active-none"
      );
    }
    btn.onclick = async () => {
      if (!currentHostname) return;
      currentLabel = btn.dataset.label;
      await sendMsg({ type: "SET_LABEL", hostname: currentHostname, label: currentLabel });
      renderMainTab();
    };
  });
}

// ── Labels tab ────────────────────────────────────────────────────────────────

async function renderLabelsTab() {
  const { labels } = await sendMsg({ type: "GET_LABELS" });
  const list = document.getElementById("labels-list");
  const empty = document.getElementById("labels-empty");
  list.innerHTML = "";

  const entries = Object.entries(labels || {});
  if (entries.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  entries.forEach(([hostname, label]) => {
    const row = document.createElement("div");
    row.className = "label-row";

    const badge = document.createElement("span");
    badge.className = `label-badge ${label === "positive" ? "badge-pos" : "badge-neg"}`;
    badge.textContent = label === "positive" ? "+" : "−";

    const name = document.createElement("span");
    name.className = "label-hostname";
    name.textContent = hostname;

    const del = document.createElement("button");
    del.className = "label-delete";
    del.textContent = "✕";
    del.onclick = async () => {
      await sendMsg({ type: "REMOVE_LABEL", hostname });
      renderLabelsTab();
    };

    row.appendChild(badge);
    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
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

  DAYS.forEach(d => {
    const el = document.createElement("div");
    el.className = "day-label";
    el.textContent = d.slice(0, 1);
    grid.appendChild(el);
  });

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = localDateKey();

  let maxAbs = 1;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = localDateKey(new Date(currentYear, currentMonth, d));
    const val = dailyLog[key] || 0;
    if (Math.abs(val) > maxAbs) maxAbs = Math.abs(val);
  }

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = localDateKey(new Date(currentYear, currentMonth, d));
    const ms = dailyLog[key] || 0;
    const el = document.createElement("div");
    el.className = "day-cell";
    if (key === today) el.classList.add("today");

    const intensity = Math.min(Math.abs(ms) / maxAbs, 1);
    if (ms > 0) el.style.backgroundColor = positiveColor(intensity);
    else if (ms < 0) el.style.backgroundColor = negativeColor(intensity);

    if (ms !== 0) {
      const sign = ms > 0 ? "+" : "−";
      el.dataset.key = key;
      el.dataset.net = ms;

      // Tooltip
      const tip = document.createElement("div");
      tip.className = "day-tooltip";
      tip.innerHTML = `<span class="tip-date">${key}</span><span class="tip-net ${ms > 0 ? "tip-pos" : "tip-neg"}">${sign}${formatMs(Math.abs(ms))}</span>`;
      el.appendChild(tip);

      el.addEventListener("click", () => renderDayDetail(key));
    }

    grid.appendChild(el);
  }
}

function positiveColor(t) {
  const r = Math.round(14 + t * (63 - 14));
  const g = Math.round(68 + t * (185 - 68));
  const b = Math.round(41 + t * (80 - 41));
  return `rgb(${r},${g},${b})`;
}

function negativeColor(t) {
  const r = Math.round(74 + t * (248 - 74));
  const g = Math.round(27 + t * (81 - 27));
  const b = Math.round(27 + t * (73 - 27));
  return `rgb(${r},${g},${b})`;
}

// ── Day detail ────────────────────────────────────────────────────────────────

function renderDayDetail(dateKey) {
  showPanel("day");
  document.getElementById("current-tab-label").textContent = dateKey;

  const net = dailyLog[dateKey] || 0;
  const sign = net >= 0 ? "+" : "−";
  const netEl = document.getElementById("day-net");
  netEl.textContent = `${sign}${formatMs(Math.abs(net))} net`;
  netEl.className = net >= 0 ? "day-net-pos" : "day-net-neg";

  const sites = dailyLog[dateKey + "_sites"] || {};
  const chart = document.getElementById("day-chart");
  chart.innerHTML = "";

  const entries = Object.entries(sites)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, TOP_N);

  if (entries.length === 0) {
    chart.innerHTML = `<div class="chart-empty">No site data recorded.</div>`;
    return;
  }

  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);

  entries.forEach(([hostname, ms]) => {
    const isPos = ms >= 0;
    const pct = (Math.abs(ms) / maxAbs) * 100;

    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("div");
    label.className = "chart-label";
    label.textContent = hostname;

    const track = document.createElement("div");
    track.className = "chart-track";

    const fill = document.createElement("div");
    fill.className = `chart-fill ${isPos ? "chart-fill-pos" : "chart-fill-neg"}`;
    fill.style.width = `${pct}%`;

    const time = document.createElement("div");
    time.className = `chart-time ${isPos ? "chart-time-pos" : "chart-time-neg"}`;
    const s = ms >= 0 ? "+" : "−";
    time.textContent = `${s}${formatMs(Math.abs(ms))}`;

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(time);
    chart.appendChild(row);
  });
}

init();