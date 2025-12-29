const STORAGE_KEY = "fastingTrackerStateV1";

const FAST_TYPES = [
  {
    id: "16_8",
    label: "16:8",
    durationHours: 16,
    bullets: [
      "Classic daily fasting schedule",
      "Supports insulin sensitivity",
      "Flexible eating window"
    ]
  },
  {
    id: "18_6",
    label: "18:6",
    durationHours: 18,
    bullets: [
      "Longer fat-burning window",
      "Improves metabolic switching",
      "Appetite regulation support"
    ]
  },
  {
    id: "20_4",
    label: "20:4",
    durationHours: 20,
    bullets: [
      "Extended fasting period",
      "May enhance autophagy",
      "Requires nutrient-dense meals"
    ]
  },
  {
    id: "24",
    label: "24h",
    durationHours: 24,
    bullets: [
      "One-meal-per-day style",
      "Simplifies food planning",
      "Break fast mindfully"
    ]
  }
];

const defaultState = {
  settings: {
    defaultFastTypeId: "16_8",
    notifyOnEnd: true,
    hourlyReminders: true
  },
  activeFast: null,
  history: [],
  reminders: {
    endNotified: false,
    lastHourlyAt: null
  }
};

let state = loadState();
let selectedFastTypeId = state.settings.defaultFastTypeId;
let tickTimer = null;
let calendarMonth = startOfMonth(new Date());
let selectedDayKey = formatDateKey(new Date());

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  startTick();
  registerServiceWorker();
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(defaultState);
    return Object.assign(clone(defaultState), JSON.parse(raw));
  } catch {
    return clone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function initUI() {
  initTabs();
  initFastTypeChips();
  initButtons();
  initSettings();
  initCalendar();
  updateTimerMeta();
  renderAll();
}

function initTabs() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  switchTab("timer");
}

function switchTab(tab) {
  ["timer", "history", "settings"].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
    const btn = document.querySelector(`.nav-btn[data-tab="${t}"]`);
    btn.classList.toggle("nav-btn-active", t === tab);
    btn.classList.toggle("text-slate-100", t === tab);
    btn.classList.toggle("text-slate-500", t !== tab);
  });
  if (tab === "history") {
    renderCalendar();
    renderDayDetails();
    renderRecentFasts();
  }
  if (tab === "settings") renderSettings();
}

function initFastTypeChips() {
  const container = document.getElementById("fast-type-chips");
  container.innerHTML = "";
  FAST_TYPES.forEach(type => {
    const btn = document.createElement("button");
    btn.className = "px-3 py-1.5 rounded-full text-xs border";
    btn.textContent = type.label;
    btn.onclick = () => {
      selectedFastTypeId = type.id;
      highlightFastTypes();
      updateTimerMeta();
      openFastTypeModal(type);
    };
    btn.dataset.id = type.id;
    container.appendChild(btn);
  });
  highlightFastTypes();
}

function highlightFastTypes() {
  document.querySelectorAll("#fast-type-chips button").forEach(b => {
    const active = b.dataset.id === selectedFastTypeId;
    b.classList.toggle("bg-cyan-500", active);
    b.classList.toggle("text-black", active);
    b.classList.toggle("bg-slate-800", !active);
    b.classList.toggle("text-white", !active);
  });
}

function openFastTypeModal(type) {
  const modal = document.getElementById("fast-type-modal");
  document.getElementById("modal-type-label").textContent = `${type.label} fast`;
  document.getElementById("modal-type-duration").textContent = `${type.durationHours} hours`;
  const list = document.getElementById("modal-bullets");
  list.innerHTML = "";
  type.bullets.forEach(b => {
    const li = document.createElement("li");
    li.textContent = b;
    list.appendChild(li);
  });
  document.getElementById("modal-use-type").onclick = () => modal.classList.add("hidden");
  document.getElementById("modal-close").onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}

function getSelectedFastType() {
  return FAST_TYPES.find(f => f.id === selectedFastTypeId);
}

function initButtons() {
  document.getElementById("start-fast-btn").onclick = startFast;
  document.getElementById("end-fast-btn").onclick = () => finishFast(true);
  document.getElementById("complete-fast-btn").onclick = () => finishFast(false);
  document.getElementById("notifications-toggle").onclick = toggleNotifications;
  document.getElementById("clear-data").onclick = clearAllData;
  document.getElementById("export-data").onclick = exportData;
}

function startFast() {
  const type = getSelectedFastType();
  const now = Date.now();
  state.activeFast = {
    id: "fast_" + now,
    typeId: type.id,
    startTimestamp: now,
    endTimestamp: now + type.durationHours * 3600000,
    plannedDurationHours: type.durationHours,
    status: "active"
  };
  state.reminders = { endNotified: false, lastHourlyAt: null };
  saveState();
  renderAll();
}

function finishFast(early) {
  if (!state.activeFast) return;
  const end = early ? Date.now() : state.activeFast.endTimestamp;
  state.history.unshift({
    id: state.activeFast.id,
    typeId: state.activeFast.typeId,
    startTimestamp: state.activeFast.startTimestamp,
    endTimestamp: end,
    durationHours: ((end - state.activeFast.startTimestamp) / 3600000).toFixed(2)
  });
  state.activeFast = null;
  saveState();
  renderAll();
}

function startTick() {
  tickTimer = setInterval(tick, 1000);
}

function tick() {
  updateTimer();
  handleAlerts();
}

function updateTimer() {
  const ring = document.getElementById("progress-ring");
  const elapsedEl = document.getElementById("timer-elapsed");
  const remainingEl = document.getElementById("timer-remaining");
  const metaPlanned = document.getElementById("meta-planned");

  if (!state.activeFast) {
    ring.style.strokeDashoffset = "502.65";
    elapsedEl.textContent = "00:00";
    remainingEl.textContent = "Remaining: 00:00";
    metaPlanned.textContent = `${getSelectedFastType().durationHours} h`;
    return;
  }

  const now = Date.now();
  const total = state.activeFast.endTimestamp - state.activeFast.startTimestamp;
  const elapsed = now - state.activeFast.startTimestamp;
  const progress = Math.min(elapsed / total, 1);
  ring.style.strokeDashoffset = 502.65 * (1 - progress);
  elapsedEl.textContent = formatDuration(elapsed);
  remainingEl.textContent =
    elapsed < total
      ? "Remaining: " + formatDuration(total - elapsed)
      : "Over: " + formatDuration(elapsed - total);
}

function handleAlerts() {
  if (!state.activeFast) return;
  const now = Date.now();
  if (now >= state.activeFast.endTimestamp && !state.reminders.endNotified) {
    notify("Fast complete", "Your fasting goal has been reached.");
    state.reminders.endNotified = true;
    state.reminders.lastHourlyAt = now;
    saveState();
  }
}

function notify(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function toggleNotifications() {
  if (Notification.permission === "granted") return;
  Notification.requestPermission();
}

function initSettings() {
  const select = document.getElementById("default-fast-select");
  FAST_TYPES.forEach(t => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.label} (${t.durationHours}h)`;
    select.appendChild(o);
  });
  select.value = selectedFastTypeId;
  select.onchange = e => {
    selectedFastTypeId = e.target.value;
    state.settings.defaultFastTypeId = selectedFastTypeId;
    saveState();
    highlightFastTypes();
    updateTimerMeta();
  };
}

function renderSettings() {}

function renderAll() {
  highlightFastTypes();
  updateTimer();
}

function clearAllData() {
  if (!confirm("Clear all fasting data?")) return;
  state = clone(defaultState);
  saveState();
  renderAll();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fasting-history.json";
  a.click();
}

function initCalendar() {}

function renderCalendar() {}

function renderDayDetails() {}

function renderRecentFasts() {}

function updateTimerMeta() {
  document.getElementById("meta-planned").textContent =
    getSelectedFastType().durationHours + " h";
}

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
