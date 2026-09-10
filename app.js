// ---------- constants ----------

const CHECKPOINTS = [
  { key: "h1", label: "+1h", hours: 1 },
  { key: "h2", label: "+2h", hours: 2 },
  { key: "h3", label: "+3h", hours: 3 },
];

const LINE_COLORS = ["#C98A2C", "#6B7F5B", "#A23E48", "#5B7A93", "#8C6E4B"];

// ---------- indexeddb ----------

const DB_NAME = "meal-diary-db";
const STORE = "kv";

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet(key, fallback) {
  try {
    const db = await dbOpen();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => resolve(fallback);
    });
  } catch (err) {
    return fallback;
  }
}

async function kvSet(key, value) {
  try {
    const db = await dbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Save failed", key, err);
    return false;
  }
}

// ---------- utils ----------

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return String(Math.round(n * 10) / 10);
}

function toDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function fmtDateTime(iso) {
  return toDate(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}

function fmtShortDate(iso) {
  return toDate(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtRelativeTime(iso) {
  const ms = Date.now() - toDate(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtShortDate(iso);
}

function toInputLocal(iso) {
  const d = toDate(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputLocal(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function getDueCheckpoints(entry) {
  const entryTime = toDate(entry.timestamp).getTime();
  const now = Date.now();
  return CHECKPOINTS.filter((c) => {
    const val = entry[c.key];
    const missing = val === null || val === undefined || val === "";
    return missing && now >= entryTime + c.hours * 3600 * 1000;
  });
}

function mealStats(mealId, entries) {
  const list = entries.filter((e) => e.mealId === mealId);
  const insulins = list.map((e) => Number(e.insulin)).filter((n) => !Number.isNaN(n));
  const avgInsulin = insulins.length ? insulins.reduce((a, b) => a + b, 0) / insulins.length : null;
  const lastUsed = list.reduce((max, e) => Math.max(max, toDate(e.timestamp).getTime()), 0);
  return { count: list.length, avgInsulin, lastUsed: lastUsed || null };
}

function lastDoseInfo(meals, entries) {
  if (!entries.length) return null;
  const sorted = entries.slice().sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp));
  const last = sorted[0];
  const meal = meals.find((m) => m.id === last.mealId);
  return { entry: last, mealName: meal ? meal.name : "a meal" };
}

function resizeImageToBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function buildCSV(meals, entries) {
  const header = ["Date", "Time", "Meal", "Carbs (g)", "Insulin (units)", "Extended bolus (units)", "Before (mmol/L)", "+1h", "+2h", "+3h", "Notes"];
  const rows = entries
    .slice()
    .sort((a, b) => toDate(a.timestamp) - toDate(b.timestamp))
    .map((e) => {
      const meal = meals.find((m) => m.id === e.mealId);
      const d = toDate(e.timestamp);
      return [
        d.toLocaleDateString(),
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        meal ? meal.name : "Meal",
        e.carbs ?? "", e.insulin ?? "", e.extended ?? "", e.preBSL ?? "", e.h1 ?? "", e.h2 ?? "", e.h3 ?? "", e.notes ?? "",
      ];
    });
  const esc = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function downloadCSV(meals, entries) {
  const csv = buildCSV(meals, entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meal-diary-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- icons (small inline SVGs, no external dependency) ----------

const ICONS = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  camera: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  sun: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/></svg>',
  moon: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  repeat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
};

// ---------- state ----------

const state = {
  meals: [],
  entries: [],
  theme: "light",
  view: "home",
  selectedMealId: null,
  expandedEntryId: null,
  search: "",
  loaded: false,
};

async function persistMeals() { await kvSet("meals", state.meals); }
async function persistEntries() { await kvSet("entries", state.entries); }
async function persistTheme() { await kvSet("theme", state.theme); }

// ---------- toast ----------

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 2200);
}

// ---------- focus-preserving render ----------

function renderMainPreservingFocus() {
  const active = document.activeElement;
  const shouldRestore = active && active.id && document.getElementById("main").contains(active);
  const savedId = shouldRestore ? active.id : null;
  const savedStart = shouldRestore && "selectionStart" in active ? active.selectionStart : null;
  renderMain();
  if (savedId) {
    const el = document.getElementById(savedId);
    if (el) {
      el.focus();
      if (savedStart !== null && "setSelectionRange" in el) {
        try { el.setSelectionRange(savedStart, savedStart); } catch (e) { /* ignore */ }
      }
    }
  }
}

// ---------- top-level render ----------

function renderMain() {
  const main = document.getElementById("main");
  if (state.view === "meal" && state.selectedMealId) {
    const meal = state.meals.find((m) => m.id === state.selectedMealId);
    if (meal) {
      main.innerHTML = renderMealDetailHTML(meal);
      return;
    }
  }
  main.innerHTML = renderHomeHTML();
}

function renderHomeHTML() {
  const dueList = state.entries
    .filter((e) => Date.now() - toDate(e.timestamp).getTime() <= 24 * 3600 * 1000)
    .flatMap((e) => {
      const due = getDueCheckpoints(e);
      if (!due.length) return [];
      const meal = state.meals.find((m) => m.id === e.mealId);
      return [{ entryId: e.id, mealId: e.mealId, mealName: meal ? meal.name : "Meal", label: due[0].label }];
    });

  const last = lastDoseInfo(state.meals, state.entries);

  const mealsWithStats = state.meals.map((m) => ({ meal: m, stats: mealStats(m.id, state.entries) }));
  mealsWithStats.sort((a, b) => (b.stats.lastUsed || 0) - (a.stats.lastUsed || 0));
  const q = state.search.trim().toLowerCase();
  const filtered = mealsWithStats.filter(({ meal }) => meal.name.toLowerCase().includes(q));

  return `
    <div class="view">
      <div class="app-header">
        <div>
          <div class="app-title">Meal Diary</div>
          <div class="app-subtitle">Carbs, insulin, and how it went</div>
        </div>
        <button type="button" class="theme-toggle" data-action="toggle-theme" aria-label="Toggle dark mode">
          ${state.theme === "dark" ? ICONS.sun : ICONS.moon}
        </button>
      </div>

      ${last ? `<div class="last-dose">Last dose: <strong>${fmtRelativeTime(last.entry.timestamp)}</strong> — ${fmtNum(last.entry.insulin)}u for ${escapeHtml(last.mealName)}</div>` : ""}

      ${renderCheckpointBanner(dueList)}

      <div class="search-row">
        ${ICONS.search}
        <input type="text" id="search-input" class="search-input" placeholder="Search meals" value="${escapeHtml(state.search)}" data-action="search-input" />
      </div>

      <button type="button" class="btn-secondary btn-block" style="margin-bottom:16px" data-action="open-add-meal">
        ${ICONS.plus} Add a meal
      </button>

      <div class="meal-list">
        ${state.meals.length === 0 ? `<div class="empty-note">No meals yet. Add the first one to start her reference list.</div>` : ""}
        ${state.meals.length > 0 && filtered.length === 0 ? `<div class="empty-note">No meals match "${escapeHtml(state.search)}".</div>` : ""}
        ${filtered.map(({ meal, stats }) => renderMealListItem(meal, stats)).join("")}
      </div>

      <div class="data-row">
        <button type="button" class="btn-ghost" data-action="open-backup">Copy backup</button>
        <button type="button" class="btn-ghost" data-action="open-restore">Restore backup</button>
        <button type="button" class="btn-ghost" data-action="export-csv">Export CSV</button>
      </div>
    </div>
  `;
}

function renderCheckpointBanner(items) {
  if (!items.length) return "";
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return `
    <div class="banner">
      <div class="banner-title">${items.length === 1 ? "1 meal is waiting on a follow-up reading" : `${items.length} meals are waiting on a follow-up reading`}</div>
      <div class="banner-chips">
        ${shown.map((it) => `<button type="button" class="chip chip-berry" data-action="jump-entry" data-meal-id="${it.mealId}" data-entry-id="${it.entryId}">${escapeHtml(it.mealName)} needs ${it.label}</button>`).join("")}
        ${extra > 0 ? `<span class="chip-more">+${extra} more</span>` : ""}
      </div>
    </div>
  `;
}

function renderMealListItem(meal, stats) {
  const substat = stats.count > 0
    ? `Logged ${stats.count} ${stats.count === 1 ? "time" : "times"}${stats.avgInsulin !== null ? `, averaging ${fmtNum(stats.avgInsulin)}u` : ""}`
    : "Not logged yet";
  return `
    <button type="button" class="meal-row" data-action="open-meal" data-meal-id="${meal.id}">
      <div class="meal-row-main">
        <div class="meal-name">${escapeHtml(meal.name)}</div>
        <div class="meal-stats">
          <span class="pill pill-mustard">${meal.carbs}g carbs</span>
          <span class="meal-substat">${substat}</span>
        </div>
      </div>
      <span class="meal-row-chevron">${ICONS.chevron}</span>
    </button>
  `;
}

function renderMealDetailHTML(meal) {
  const stats = mealStats(meal.id, state.entries);
  const entries = state.entries
    .filter((e) => e.mealId === meal.id)
    .sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp));

  return `
    <div class="view">
      <div class="view-header">
        <button type="button" class="btn-icon" data-action="back-home" aria-label="Back">${ICONS.back}</button>
        <div class="view-header-title">${escapeHtml(meal.name)}</div>
        <div class="view-header-spacer"></div>
      </div>

      <div class="meal-hero">
        <div class="meal-hero-carbs">${meal.carbs}g carbs</div>
        <div class="meal-hero-sub">${stats.count > 0 ? `Logged ${stats.count} ${stats.count === 1 ? "time" : "times"}${stats.avgInsulin !== null ? `, averaging ${fmtNum(stats.avgInsulin)}u` : ""}` : "Not logged yet"}</div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn-primary btn-block" data-action="open-log-entry" data-meal-id="${meal.id}">Log this meal</button>
        ${entries.length > 0 ? `<button type="button" class="btn-secondary" data-action="repeat-last" data-meal-id="${meal.id}" aria-label="Repeat last entry">${ICONS.repeat}</button>` : ""}
      </div>

      ${renderTrendChart(entries)}

      <div class="diary-section">
        <div class="diary-section-title">Diary</div>
        ${entries.length === 0 ? `<div class="empty-note">No entries yet. Log this meal to start her record.</div>` : ""}
        ${entries.map((e) => renderDiaryEntry(e)).join("")}
      </div>

      <div class="meal-delete-row">
        <button type="button" class="btn-ghost-danger" data-action="delete-meal-confirm" data-meal-id="${meal.id}">${ICONS.trash} Delete meal</button>
      </div>
    </div>
  `;
}

function renderDiaryEntry(entry) {
  const expanded = state.expandedEntryId === entry.id;
  const sequence = [
    { label: "Before", value: entry.preBSL },
    ...CHECKPOINTS.map((c) => ({ label: c.label, value: entry[c.key] })),
  ].filter((s) => s.value !== null && s.value !== undefined && s.value !== "");
  const summaryLine = sequence.length ? `${sequence.map((s) => fmtNum(s.value)).join(" \u2192 ")} mmol/L` : "No blood sugar logged yet";
  const dueNow = getDueCheckpoints(entry);
  const insulinText = entry.extended !== null && entry.extended !== undefined && entry.extended !== ""
    ? `${fmtNum(entry.insulin)}u + ${fmtNum(entry.extended)}u extended`
    : `${fmtNum(entry.insulin)}u insulin`;

  let detail = "";
  if (expanded) {
    const fields = [{ key: "preBSL", label: "Before" }, ...CHECKPOINTS.map((c) => ({ key: c.key, label: c.label }))]
      .map((f) => renderFieldRow(entry, f.key, f.label))
      .join("");

    detail = `
      <div class="diary-detail">
        <div class="detail-grid" data-entry-id="${entry.id}">${fields}</div>
        <div class="entry-notes-wrap" data-entry-id="${entry.id}">
          ${entry.notes
            ? `<div class="field-row-label">Notes</div><div class="entry-notes-text">${escapeHtml(entry.notes)}</div><button type="button" class="btn-tiny-ghost" data-action="edit-notes" data-entry-id="${entry.id}">Edit note</button>`
            : `<button type="button" class="btn-tiny-add" data-action="edit-notes" data-entry-id="${entry.id}">+ Add note</button>`}
        </div>
        ${entry.photo ? `<div class="diary-photo"><img src="${entry.photo}" alt="Meal" /></div>` : ""}
        <div class="diary-actions">
          <button type="button" class="btn-ghost-danger" data-action="delete-entry-confirm" data-entry-id="${entry.id}">${ICONS.trash} Delete entry</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="diary-item">
      <button type="button" class="diary-summary" data-action="toggle-entry" data-entry-id="${entry.id}">
        <div class="diary-summary-left">
          <div class="diary-date">${fmtDateTime(entry.timestamp)}</div>
          <div class="diary-meta">${fmtNum(entry.carbs)}g carbs, ${insulinText}</div>
          <div class="diary-bsl">${summaryLine}</div>
        </div>
        ${dueNow.length > 0 && !expanded ? `<span class="chip chip-berry-outline">Add ${dueNow[0].label}</span>` : ""}
      </button>
      ${detail}
    </div>
  `;
}

function renderFieldRow(entry, key, label) {
  const value = entry[key];
  const has = value !== null && value !== undefined && value !== "";
  return `
    <div class="field-row" data-field-key="${key}">
      <div class="field-row-label">${label}</div>
      <div class="field-row-body">
        ${has
          ? `<div class="field-row-value">${fmtNum(value)} mmol/L</div>`
          : `<button type="button" class="btn-tiny-add" data-action="start-add-field" data-entry-id="${entry.id}" data-field-key="${key}">+ Add</button>`}
      </div>
    </div>
  `;
}

function renderTrendChart(entries) {
  const usable = entries
    .filter((e) => [e.preBSL, e.h1, e.h2, e.h3].filter((v) => v !== null && v !== undefined && v !== "").length >= 2)
    .slice(0, 5);
  if (usable.length < 1) return "";

  const stageKeys = ["preBSL", "h1", "h2", "h3"];
  const allVals = [];
  usable.forEach((e) => stageKeys.forEach((k) => { if (e[k] !== null && e[k] !== undefined && e[k] !== "") allVals.push(Number(e[k])); }));
  const minV = Math.min(...allVals, 4);
  const maxV = Math.max(...allVals, 10);
  const pad = (maxV - minV) * 0.15 || 1;
  const yMin = Math.max(0, minV - pad);
  const yMax = maxV + pad;

  const W = 300, H = 160, L = 28, R = 8, T = 10, B = 22;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i) => L + (plotW * i) / (stageKeys.length - 1);
  const y = (v) => T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridLines = [0, 0.5, 1].map((f) => {
    const yy = T + plotH * f;
    const val = Math.round(yMax - (yMax - yMin) * f);
    return `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#D9CBAE" stroke-dasharray="3 3" />
            <text x="2" y="${yy + 3}" font-size="9" fill="#6B5F63">${val}</text>`;
  }).join("");

  const labels = ["Before", "+1h", "+2h", "+3h"];
  const xLabels = labels.map((lab, i) => `<text x="${x(i)}" y="${H - 4}" font-size="9" fill="#6B5F63" text-anchor="middle">${lab}</text>`).join("");

  const lines = usable.map((e, idx) => {
    const color = LINE_COLORS[idx % LINE_COLORS.length];
    const pts = stageKeys
      .map((k, i) => (e[k] === null || e[k] === undefined || e[k] === "" ? null : `${x(i)},${y(Number(e[k]))}`))
      .filter(Boolean);
    const dots = stageKeys
      .map((k, i) => (e[k] === null || e[k] === undefined || e[k] === "" ? "" : `<circle cx="${x(i)}" cy="${y(Number(e[k]))}" r="3" fill="${color}" />`))
      .join("");
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" />${dots}`;
  }).join("");

  const legend = usable.map((e, idx) => `
    <div class="trend-legend-item">
      <span class="trend-swatch" style="background:${LINE_COLORS[idx % LINE_COLORS.length]}"></span>
      ${fmtShortDate(e.timestamp)} (${fmtNum(e.insulin)}u${e.extended !== null && e.extended !== undefined ? `+${fmtNum(e.extended)}u ext` : ""})
    </div>
  `).join("");

  return `
    <div class="trend-card">
      <div class="trend-title">Response pattern</div>
      <div class="trend-sub">How blood sugar moved after past doses of this meal</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
        ${gridLines}${xLabels}${lines}
      </svg>
      <div class="trend-legend">${legend}</div>
    </div>
  `;
}

// ---------- event delegation ----------

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const [meals, entries, theme] = await Promise.all([
    kvGet("meals", []),
    kvGet("entries", []),
    kvGet("theme", "light"),
  ]);
  state.meals = Array.isArray(meals) ? meals : [];
  state.entries = Array.isArray(entries) ? entries : [];
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
  state.loaded = true;

  renderMain();
  document.getElementById("main").addEventListener("click", onMainClick);
  document.getElementById("main").addEventListener("input", onMainInput);
}

function onMainInput(e) {
  if (e.target.dataset.action === "search-input") {
    state.search = e.target.value;
    renderMainPreservingFocus();
  }
}

async function onMainClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "toggle-theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    await persistTheme();
    renderMain();
    return;
  }

  if (action === "open-add-meal") return openAddMealSheet();
  if (action === "open-backup") return openBackupSheet();
  if (action === "open-restore") return openRestoreSheet();
  if (action === "export-csv") {
    if (!state.entries.length) { showToast("No entries yet to export"); return; }
    downloadCSV(state.meals, state.entries);
    showToast("CSV downloaded");
    return;
  }

  if (action === "open-meal") {
    state.selectedMealId = btn.dataset.mealId;
    state.expandedEntryId = null;
    state.view = "meal";
    renderMain();
    return;
  }

  if (action === "back-home") {
    state.view = "home";
    renderMain();
    return;
  }

  if (action === "jump-entry") {
    state.selectedMealId = btn.dataset.mealId;
    state.expandedEntryId = btn.dataset.entryId;
    state.view = "meal";
    renderMain();
    return;
  }

  if (action === "open-log-entry") {
    const meal = state.meals.find((m) => m.id === btn.dataset.mealId);
    if (meal) openLogEntrySheet(meal, null);
    return;
  }

  if (action === "repeat-last") {
    const meal = state.meals.find((m) => m.id === btn.dataset.mealId);
    if (!meal) return;
    const entries = state.entries.filter((e) => e.mealId === meal.id).sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp));
    if (entries.length) openLogEntrySheet(meal, entries[0]);
    return;
  }

  if (action === "toggle-entry") {
    const id = btn.dataset.entryId;
    state.expandedEntryId = state.expandedEntryId === id ? null : id;
    renderMain();
    return;
  }

  if (action === "start-add-field") {
    startAddField(btn.dataset.entryId, btn.dataset.fieldKey);
    return;
  }

  if (action === "edit-notes") {
    startEditNotes(btn.dataset.entryId);
    return;
  }

  if (action === "delete-entry-confirm") {
    if (btn.dataset.confirming === "1") {
      await deleteEntry(btn.dataset.entryId);
    } else {
      btn.dataset.confirming = "1";
      btn.className = "btn-danger";
      btn.innerHTML = "Tap again to delete";
    }
    return;
  }

  if (action === "delete-meal-confirm") {
    if (btn.dataset.confirming === "1") {
      await deleteMeal(btn.dataset.mealId);
    } else {
      btn.dataset.confirming = "1";
      btn.className = "btn-danger";
      btn.innerHTML = "Tap again to delete this meal and its diary";
    }
    return;
  }
}

// ---------- inline field editing ----------

function startAddField(entryId, fieldKey) {
  const grid = document.querySelector(`.detail-grid[data-entry-id="${entryId}"]`);
  if (!grid) return;
  const row = grid.querySelector(`.field-row[data-field-key="${fieldKey}"] .field-row-body`);
  if (!row) return;
  row.innerHTML = `
    <div class="field-row-edit">
      <input type="number" inputmode="decimal" step="0.1" class="field-input field-input-inline" id="inline-input-${entryId}-${fieldKey}" />
      <button type="button" class="btn-tiny-primary" id="inline-save-${entryId}-${fieldKey}">Save</button>
      <button type="button" class="btn-tiny-ghost" id="inline-cancel-${entryId}-${fieldKey}">Cancel</button>
    </div>
  `;
  const input = document.getElementById(`inline-input-${entryId}-${fieldKey}`);
  input.focus();
  document.getElementById(`inline-save-${entryId}-${fieldKey}`).addEventListener("click", async () => {
    const val = input.value;
    if (val === "" || Number.isNaN(Number(val))) return;
    const entry = state.entries.find((x) => x.id === entryId);
    if (entry) {
      entry[fieldKey] = Number(val);
      await persistEntries();
      showToast("Reading saved");
    }
    renderMain();
  });
  document.getElementById(`inline-cancel-${entryId}-${fieldKey}`).addEventListener("click", () => renderMain());
}

function startEditNotes(entryId) {
  const wrap = document.querySelector(`.entry-notes-wrap[data-entry-id="${entryId}"]`);
  if (!wrap) return;
  const entry = state.entries.find((x) => x.id === entryId);
  const current = entry && entry.notes ? entry.notes : "";
  wrap.innerHTML = `
    <textarea class="field-input" id="notes-edit-${entryId}" rows="2" placeholder="e.g. extra cheese, ate late">${escapeHtml(current)}</textarea>
    <div style="display:flex; gap:8px; margin-top:6px;">
      <button type="button" class="btn-tiny-primary" id="notes-save-${entryId}">Save</button>
      <button type="button" class="btn-tiny-ghost" id="notes-cancel-${entryId}">Cancel</button>
    </div>
  `;
  const textarea = document.getElementById(`notes-edit-${entryId}`);
  textarea.focus();
  document.getElementById(`notes-save-${entryId}`).addEventListener("click", async () => {
    const val = textarea.value.trim();
    if (entry) {
      entry.notes = val === "" ? null : val;
      await persistEntries();
      showToast("Note saved");
    }
    renderMain();
  });
  document.getElementById(`notes-cancel-${entryId}`).addEventListener("click", () => renderMain());
}

async function deleteEntry(entryId) {
  state.entries = state.entries.filter((e) => e.id !== entryId);
  state.expandedEntryId = null;
  await persistEntries();
  showToast("Entry deleted");
  renderMain();
}

async function deleteMeal(mealId) {
  state.entries = state.entries.filter((e) => e.mealId !== mealId);
  state.meals = state.meals.filter((m) => m.id !== mealId);
  state.view = "home";
  state.selectedMealId = null;
  await Promise.all([persistMeals(), persistEntries()]);
  showToast("Meal deleted");
  renderMain();
}

// ---------- sheets (built once per open, not re-rendered while open) ----------

function openSheet(html) {
  const root = document.getElementById("sheet-root");
  root.innerHTML = html;
  root.style.display = "block";
  return root;
}

function closeSheet() {
  const root = document.getElementById("sheet-root");
  root.innerHTML = "";
  root.style.display = "none";
}

function openAddMealSheet() {
  const root = openSheet(`
    <div class="sheet-scrim" id="scrim">
      <div class="sheet">
        <div class="sheet-header">
          <button type="button" class="btn-ghost" id="cancel-btn">Cancel</button>
          <div class="sheet-title">Add a meal</div>
          <div class="sheet-header-spacer"></div>
        </div>
        <div class="sheet-body">
          <label class="field-label" for="meal-name">Name</label>
          <input id="meal-name" class="field-input" type="text" placeholder="e.g. Porridge with banana" />
          <label class="field-label" for="meal-carbs">Carbs (g)</label>
          <input id="meal-carbs" class="field-input" type="number" inputmode="decimal" placeholder="e.g. 42" />
          <button type="button" class="btn-primary btn-block" id="save-btn" disabled style="margin-top:16px">Save meal</button>
        </div>
      </div>
    </div>
  `);
  const nameEl = document.getElementById("meal-name");
  const carbsEl = document.getElementById("meal-carbs");
  const saveBtn = document.getElementById("save-btn");
  const validate = () => {
    saveBtn.disabled = !(nameEl.value.trim().length > 0 && carbsEl.value !== "" && !Number.isNaN(Number(carbsEl.value)));
  };
  nameEl.addEventListener("input", validate);
  carbsEl.addEventListener("input", validate);
  root.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.getElementById("cancel-btn").addEventListener("click", closeSheet);
  saveBtn.addEventListener("click", async () => {
    const meal = { id: uid(), name: nameEl.value.trim(), carbs: Number(carbsEl.value), createdAt: new Date().toISOString() };
    state.meals = [meal, ...state.meals];
    await persistMeals();
    closeSheet();
    showToast("Meal added");
    renderMain();
  });
  nameEl.focus();
}

function openLogEntrySheet(meal, prefillEntry) {
  const root = openSheet(`
    <div class="sheet-scrim" id="scrim">
      <div class="sheet">
        <div class="sheet-header">
          <button type="button" class="btn-ghost" id="cancel-btn">Cancel</button>
          <div class="sheet-title">Log ${escapeHtml(meal.name)}</div>
          <div class="sheet-header-spacer"></div>
        </div>
        <div class="sheet-body">
          <label class="field-label" for="entry-when">When</label>
          <input id="entry-when" class="field-input" type="datetime-local" />
          <label class="field-label" for="entry-carbs">Carbs (g)</label>
          <input id="entry-carbs" class="field-input" type="number" inputmode="decimal" />
          <label class="field-label" for="entry-insulin">Insulin (units)</label>
          <input id="entry-insulin" class="field-input" type="number" inputmode="decimal" step="0.5" placeholder="e.g. 4.5" />
          <div id="extended-field-wrap"></div>
          <label class="field-label" for="entry-prebsl">Blood sugar before (mmol/L)</label>
          <input id="entry-prebsl" class="field-input" type="number" inputmode="decimal" step="0.1" placeholder="Optional" />
          <label class="field-label" for="entry-notes">Notes</label>
          <textarea id="entry-notes" class="field-input" rows="2" placeholder="Optional — e.g. extra cheese, ate late"></textarea>
          <label class="field-label">Photo</label>
          <div class="photo-field" id="photo-field">
            <button type="button" class="btn-secondary" id="photo-add-btn">${ICONS.camera} Add a photo</button>
            <input type="file" accept="image/*" capture="environment" id="photo-input" style="display:none" />
          </div>
          <button type="button" class="btn-primary btn-block" id="save-btn" style="margin-top:16px" disabled>Save entry</button>
          <div class="field-hint">Add the +1h, +2h and +3h readings once you have them — just open this entry again.</div>
        </div>
      </div>
    </div>
  `);

  document.getElementById("entry-when").value = toInputLocal(new Date().toISOString());
  document.getElementById("entry-carbs").value = prefillEntry ? prefillEntry.carbs : meal.carbs;
  document.getElementById("entry-insulin").value = prefillEntry ? prefillEntry.insulin : "";
  let photo = null;

  const extendedWrap = document.getElementById("extended-field-wrap");
  const prefillExtended = prefillEntry && prefillEntry.extended !== null && prefillEntry.extended !== undefined ? prefillEntry.extended : null;
  function renderExtendedCollapsed() {
    extendedWrap.innerHTML = `<button type="button" class="btn-tiny-add" id="add-extended-btn">+ Split with extended bolus</button>`;
    document.getElementById("add-extended-btn").addEventListener("click", renderExtendedExpanded);
  }
  function renderExtendedExpanded() {
    extendedWrap.innerHTML = `
      <label class="field-label" for="entry-extended">Extended bolus (units)</label>
      <div class="field-row-edit">
        <input id="entry-extended" class="field-input field-input-inline" type="number" inputmode="decimal" step="0.5" placeholder="units" value="${prefillExtended !== null ? prefillExtended : ""}" />
        <button type="button" class="btn-tiny-ghost" id="remove-extended-btn">Remove</button>
      </div>
    `;
    document.getElementById("remove-extended-btn").addEventListener("click", renderExtendedCollapsed);
  }
  if (prefillExtended !== null) renderExtendedExpanded(); else renderExtendedCollapsed();

  const carbsEl = document.getElementById("entry-carbs");
  const insulinEl = document.getElementById("entry-insulin");
  const saveBtn = document.getElementById("save-btn");
  const validate = () => {
    saveBtn.disabled = !(carbsEl.value !== "" && !Number.isNaN(Number(carbsEl.value)) && insulinEl.value !== "" && !Number.isNaN(Number(insulinEl.value)));
  };
  carbsEl.addEventListener("input", validate);
  insulinEl.addEventListener("input", validate);
  validate();

  const photoInput = document.getElementById("photo-input");
  document.getElementById("photo-add-btn").addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    const field = document.getElementById("photo-field");
    field.innerHTML = `<div class="field-hint" style="margin-top:0">Processing photo…</div>`;
    try {
      photo = await resizeImageToBase64(file, 640, 0.62);
      field.innerHTML = `
        <div class="photo-preview">
          <img src="${photo}" alt="Meal" />
          <button type="button" class="photo-remove" id="photo-remove-btn" aria-label="Remove photo">${ICONS.x}</button>
        </div>
      `;
      document.getElementById("photo-remove-btn").addEventListener("click", () => {
        photo = null;
        field.innerHTML = `
          <button type="button" class="btn-secondary" id="photo-add-btn2">${ICONS.camera} Add a photo</button>
        `;
        document.getElementById("photo-add-btn2").addEventListener("click", () => photoInput.click());
      });
    } catch (err) {
      showToast("Couldn't process that photo");
      field.innerHTML = `<button type="button" class="btn-secondary" id="photo-add-btn2">${ICONS.camera} Add a photo</button>`;
      document.getElementById("photo-add-btn2").addEventListener("click", () => photoInput.click());
    }
  });

  root.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.getElementById("cancel-btn").addEventListener("click", closeSheet);

  saveBtn.addEventListener("click", async () => {
    const extEl = document.getElementById("entry-extended");
    const extended = extEl && extEl.value !== "" && !Number.isNaN(Number(extEl.value)) ? Number(extEl.value) : null;
    const notesVal = document.getElementById("entry-notes").value.trim();
    const entry = {
      id: uid(),
      mealId: meal.id,
      timestamp: fromInputLocal(document.getElementById("entry-when").value),
      carbs: Number(carbsEl.value),
      insulin: Number(insulinEl.value),
      extended,
      preBSL: document.getElementById("entry-prebsl").value === "" ? null : Number(document.getElementById("entry-prebsl").value),
      notes: notesVal === "" ? null : notesVal,
      h1: null, h2: null, h3: null,
      photo: photo || null,
    };
    state.entries = [entry, ...state.entries];
    await persistEntries();
    state.expandedEntryId = entry.id;
    closeSheet();
    showToast("Entry logged");
    renderMain();
  });
}

function openBackupSheet() {
  const text = JSON.stringify({ meals: state.meals, entries: state.entries });
  const root = openSheet(`
    <div class="sheet-scrim" id="scrim">
      <div class="sheet">
        <div class="sheet-header">
          <button type="button" class="btn-ghost" id="close-btn">Close</button>
          <div class="sheet-title">Backup</div>
          <div class="sheet-header-spacer"></div>
        </div>
        <div class="sheet-body">
          <div class="field-hint" style="margin-top:0">Copy this text and keep it somewhere safe, like a notes app. You can paste it back in with "Restore backup" later. Photos are included, so this may be long.</div>
          <textarea class="field-input backup-textarea" id="backup-text" readonly rows="8">${escapeHtml(text)}</textarea>
          <button type="button" class="btn-primary btn-block" id="copy-btn" style="margin-top:16px">Copy to clipboard</button>
        </div>
      </div>
    </div>
  `);
  const textarea = document.getElementById("backup-text");
  textarea.addEventListener("focus", () => textarea.select());
  root.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.getElementById("close-btn").addEventListener("click", closeSheet);
  document.getElementById("copy-btn").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = "Copied!";
      setTimeout(() => { e.target.textContent = "Copy to clipboard"; }, 2000);
    } catch (err) {
      textarea.focus();
      textarea.select();
    }
  });
}

function openRestoreSheet() {
  const root = openSheet(`
    <div class="sheet-scrim" id="scrim">
      <div class="sheet">
        <div class="sheet-header">
          <button type="button" class="btn-ghost" id="cancel-btn">Cancel</button>
          <div class="sheet-title">Restore backup</div>
          <div class="sheet-header-spacer"></div>
        </div>
        <div class="sheet-body">
          <label class="field-label" for="restore-text">Paste backup text</label>
          <textarea id="restore-text" class="field-input backup-textarea" rows="8" placeholder="Paste the text you copied earlier"></textarea>
          <div class="restore-error" id="restore-error" style="display:none"></div>
          <button type="button" class="btn-primary btn-block" id="restore-btn" style="margin-top:16px" disabled>Restore</button>
          <div class="field-hint">This replaces everything currently in the app with the backup.</div>
        </div>
      </div>
    </div>
  `);
  const textEl = document.getElementById("restore-text");
  const btn = document.getElementById("restore-btn");
  const errEl = document.getElementById("restore-error");
  textEl.addEventListener("input", () => { btn.disabled = !textEl.value.trim(); });
  root.querySelector("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.getElementById("cancel-btn").addEventListener("click", closeSheet);
  btn.addEventListener("click", async () => {
    try {
      const parsed = JSON.parse(textEl.value);
      if (!parsed || !Array.isArray(parsed.meals) || !Array.isArray(parsed.entries)) {
        errEl.textContent = "That doesn't look like a valid backup.";
        errEl.style.display = "block";
        return;
      }
      state.meals = parsed.meals;
      state.entries = parsed.entries;
      await Promise.all([persistMeals(), persistEntries()]);
      closeSheet();
      showToast("Backup restored");
      renderMain();
    } catch (err) {
      errEl.textContent = "Couldn't read that — check you pasted the whole backup.";
      errEl.style.display = "block";
    }
  });
}
