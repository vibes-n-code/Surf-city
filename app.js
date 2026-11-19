// Surf City training tracker. The schedule lives in plan.json; progress lives in localStorage.
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAYNAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LS = "surfcity-progress-v1";
const LS_PLAN = "surfcity-plan-cache";

let PLAN, START, RACE, WEEKS, SESSIONS = [];
let state = {};
const openWeeks = new Set();
let firstRender = true;
let selWeek = null;

function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmt(d) { return MON[d.getMonth()] + " " + d.getDate(); }
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function miStr(n) { return (Math.round(n * 10) / 10).toString(); }

function buildPlan(plan) {
  PLAN = plan;
  START = parseDate(plan.planStart);
  RACE = parseDate(plan.race.date);
  WEEKS = plan.weeks;
  SESSIONS = [];
  const last = WEEKS.length - 1;
  WEEKS.forEach((w, wi) => {
    w.sessions = DAYS.map((day, di) => {
      const date = addDays(START, wi * 7 + di);
      const key = "w" + wi + "-" + day;
      let s;
      if (w[day]) {
        const r = w[day];
        const type = day === "mon" || day === "wed" ? "run" : day === "sat" ? "long" : day === "sun" && wi === last ? "race" : "run";
        s = { type, mi: r[0], title: r[1], desc: r[2] || "", optional: day === "fri" && !w.friRequired };
      } else if (day === "mon") s = { type: "class", title: "Good day for a class", desc: wi === last ? "Keep it light, upper body and core" : "", mi: 0 };
      else if (day === "wed") s = wi === last ? { type: "rest", title: "Rest", desc: "Skip classes this week", mi: 0 } : { type: "class", title: "Good day for a class", desc: wi >= 9 ? "Go easy on legs during peak and taper" : "", mi: 0 };
      else if (day === "sun") s = { type: "rest", title: "Rest", desc: wi === 0 ? "" : "Or run the long run today if Saturday doesn't work", mi: 0 };
      else s = { type: "rest", title: day === "fri" && wi === last ? "Travel / rest" : "Rest", mi: 0 };
      // Strength after Tue/Thu runs and on Sun; lighter in taper, none race week, never the day before the long run
      const strengthDays = wi === last ? [] : wi === last - 1 ? ["tue", "thu"] : ["tue", "thu", "sun"];
      s.strength = strengthDays.includes(day);
      Object.assign(s, { key, date, day: di, week: wi });
      if (s.type !== "rest") SESSIONS.push(s);
      return s;
    });
    w.start = addDays(START, wi * 7);
    w.plan = w.sessions.reduce((a, s) => a + s.mi, 0);
  });
}

// ---- Storage ----
function loadState() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { "w0-tue": { done: true, actual: 6.07, t: 0 } }; // first run, logged before the app existed
}
function saveState() {
  try { localStorage.setItem(LS, JSON.stringify(state)); setStatus("Saved on this phone."); }
  catch (e) { setStatus("Couldn't save. Your browser may be in private mode.", true); }
}

function isDone(s) { return !!(state[s.key] && state[s.key].done); }
function milesFor(s) {
  const v = state[s.key];
  if (!v || !v.done) return 0;
  return typeof v.actual === "number" ? v.actual : s.mi;
}
function toggle(key) {
  const s = SESSIONS.find(x => x.key === key);
  const cur = state[key] || {};
  if (cur.done) {
    const label = s ? DAYNAME[s.day] + ", " + fmt(s.date) + " · " + s.title : "this session";
    const mi = typeof cur.actual === "number" ? miStr(cur.actual) + " mi" : null;
    confirmUncheck(label, mi, () => {
      state[key] = { done: false, actual: cur.actual, date: cur.date, t: Date.now() };
      editing.delete(key); // keep miles so re-checking restores them
      saveState(); render();
    });
  } else {
    state[key] = { done: true, actual: typeof cur.actual === "number" ? cur.actual : (s && s.mi ? s.mi : null), date: cur.date, t: Date.now() };
    saveState(); render();
  }
}

function confirmUncheck(label, mi, onYes) {
  const m = document.getElementById("confirm");
  document.getElementById("confirm-text").textContent = label + (mi ? " (" + mi + ")" : "");
  m.classList.add("show");
  const yes = document.getElementById("confirm-yes"), no = document.getElementById("confirm-no");
  const close = () => { m.classList.remove("show"); yes.onclick = no.onclick = m.onclick = null; };
  yes.onclick = () => { close(); onYes(); };
  no.onclick = close;
  m.onclick = e => { if (e.target === m) close(); };
  no.focus();
}
function setActual(key, val) {
  const n = parseFloat(val);
  const cur = state[key] || { done: true };
  const next = { done: true, actual: isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null };
  if (cur.done && cur.actual === next.actual) return;
  next.date = cur.date; next.t = Date.now();
  state[key] = next; saveState(); render();
}
function toggleRehab(wi, i) {
  const key = "w" + wi + "-rehab";
  const cur = (state[key] && state[key].count) || 0;
  state[key] = { count: cur === i + 1 ? i : i + 1, t: Date.now() };
  saveState(); render();
}

// Gels to carry, assuming ~9 min/mi: first at 30 min, then every 30 min
function fuelFor(s) {
  if (!s.mi || s.mi < 7) return "";
  if (s.mi < 11) return "Fuel: optional 1 gel";
  const gels = Math.floor((s.mi * 9 - 30) / 30) + 1;
  return "Fuel: " + gels + " gels + water & electrolytes";
}

function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// The day a session was actually done, if it was moved off its planned day
function effDate(s) { const v = state[s.key]; return v && v.done && v.date ? parseDate(v.date) : s.date; }
function setRunDate(key, val) {
  const s = SESSIONS.find(x => x.key === key);
  const cur = state[key];
  if (!s || !cur || !cur.done || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
  const date = val === iso(s.date) ? undefined : val;
  if (date === cur.date) return;
  state[key] = Object.assign({}, cur, { date, t: Date.now() });
  saveState(); render();
}
// Entries Claude logs in log.json; the newer of each entry wins
function mergeRemote(remote) {
  let changed = false;
  for (const k in remote) {
    const r = remote[k], l = state[k];
    if (!r || typeof r !== "object") continue;
    if (!l || (r.t || 0) > (l.t || 0)) { state[k] = r; changed = true; }
  }
  if (changed) { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }
  return changed;
}

// ---- Render ----
const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>';

function currentWeekIndex(today) {
  const diff = Math.floor((today - START) / 86400000);
  return Math.max(0, Math.min(WEEKS.length - 1, Math.floor(diff / 7)));
}

function renderStatic() {
  const r = PLAN.race;
  document.getElementById("race-sub").textContent =
    DAYNAME[(RACE.getDay() + 6) % 7] + ", " + fmt(RACE) + ", " + RACE.getFullYear() + " · " + r.start + " · " + r.place;
  document.getElementById("goals").innerHTML = PLAN.goals.map((g, i) =>
    '<span class="chip' + (i ? " alt" : "") + '">' + esc(g.label + " " + g.time + " · " + g.pace) + "</span>").join("");
  document.getElementById("pace-rows").innerHTML = PLAN.paces.map(p =>
    '<div class="pace-row"><span>' + esc(p[0]) + '</span><span class="num">' + esc(p[1]) +
    (p[2] ? ' <span class="muted" style="font-size:14px">' + esc(p[2]) + "</span>" : "") + "</span></div>").join("");
  document.getElementById("pace-note").textContent = PLAN.paceNote || "";
}

function render() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cw = currentWeekIndex(today);
  if (firstRender) openWeeks.add(cw);

  document.getElementById("days").textContent = Math.max(0, Math.round((RACE - today) / 86400000));

  const totalDone = SESSIONS.reduce((a, s) => a + milesFor(s), 0);
  const runs = SESSIONS.filter(s => s.mi > 0);
  const runsDone = runs.filter(isDone).length;
  const w = WEEKS[cw];
  const weekDone = w.sessions.reduce((a, s) => a + milesFor(s), 0);
  document.getElementById("s-miles").innerHTML = miStr(totalDone);
  document.getElementById("s-week").innerHTML = miStr(weekDone) + " <small>/ " + miStr(w.plan) + "</small>";
  document.getElementById("s-runs").innerHTML = runsDone + " <small>/ " + runs.length + "</small>";

  renderToday(today);

  // Chart
  const maxPlan = Math.max(...WEEKS.map(x => x.race ? 0 : x.plan));
  const max = Math.max(40, Math.ceil(maxPlan / 10) * 10);
  const bars = document.getElementById("bars");
  const xl = document.getElementById("xlabels");
  bars.style.gridTemplateColumns = xl.style.gridTemplateColumns = "repeat(" + WEEKS.length + ", 1fr)";
  let bh = "";
  for (let v = 10; v <= max; v += 10) bh += '<div class="grid-line" style="bottom:' + (v / max * 100) + '%"><span>' + v + "</span></div>";
  let xh = "";
  let prevMonth = -1;
  WEEKS.forEach((wk, i) => {
    const done = wk.sessions.reduce((a, s) => a + milesFor(s), 0);
    const ph = Math.min(100, wk.plan / max * 100);
    const fh = wk.plan ? Math.min(100, done / wk.plan * 100) : 0;
    bh += '<button class="bar' + (i === cw ? " now" : "") + (wk.race ? " race" : "") + (i === selWeek ? " sel" : "") + '" data-jump="' + i + '" aria-label="Week ' + i + ", " + fmt(wk.start) + ": " + miStr(done) + " of " + miStr(wk.plan) + ' miles. Open week.">' +
      '<div class="plan" style="height:' + ph + '%"><div class="fill" style="height:' + fh + '%"></div></div></button>';
    const m = wk.start.getMonth();
    xh += '<div class="' + (i === cw ? "now" : "") + '" data-jump="' + i + '"><span class="mo">' + (m !== prevMonth ? MON[m] : "") + "</span>" + wk.start.getDate() + "</div>";
    prevMonth = m;
  });
  const cap = WEEKS[selWeek === null ? cw : selWeek];
  const capDone = cap.sessions.reduce((a, s) => a + milesFor(s), 0);
  document.getElementById("chart-cap").innerHTML = "<b>Week " + WEEKS.indexOf(cap) + "</b>" + fmt(cap.start) + " – " + fmt(addDays(cap.start, 6)) +
    ' · <span class="muted">' + miStr(capDone) + " of " + miStr(cap.plan) + " mi</span>";
  bars.innerHTML = bh; xl.innerHTML = xh;

  // Weeks
  let html = "";
  WEEKS.forEach((wk, wi) => {
    const done = wk.sessions.reduce((a, s) => a + milesFor(s), 0);
    const pct = wk.plan ? Math.min(100, done / wk.plan * 100) : 0;
    const phCls = wk.cut ? "cut" : wk.peak ? "peak" : wk.race ? "race" : "";
    const end = addDays(wk.start, 6);
    html += '<details class="week' + (wi === cw ? " current" : "") + '" data-week="' + wi + '"' + (openWeeks.has(wi) ? " open" : "") + ">" +
      '<summary><div class="wk-title"><h3>Week ' + wi + '</h3><span class="phase ' + phCls + '">' + esc(wk.ph) + "</span></div>" +
      '<div class="wk-miles"><span class="num">' + miStr(done) + '</span><div class="of">of ' + miStr(wk.plan) + " mi</div></div>" +
      '<div class="wk-dates">' + fmt(wk.start) + " – " + fmt(end) + (wi === cw ? " · this week" : "") + "</div>" +
      '<div class="progress"><div style="width:' + pct + '%"></div></div></summary>';
    if (wk.checkpoint) html += '<div class="wk-note check-note">' + esc(wk.checkpoint) + "</div>";
    if (wk.note) html += '<div class="wk-note">' + esc(wk.note) + "</div>";
    html += '<div class="days">';
    wk.sessions.forEach(s => html += daySlot(s, today));
    html += "</div>";
    const rc = (state["w" + wi + "-rehab"] && state["w" + wi + "-rehab"].count) || 0;
    html += '<div class="rehab"><span class="lbl">Strength routine (3×)</span>';
    for (let i = 0; i < 3; i++) html += '<button class="dot' + (i < rc ? " on" : "") + '" aria-label="Strength session ' + (i + 1) + (i < rc ? ", done" : "") + '" data-rehab="' + wi + ":" + i + '"></button>';
    html += "</div></details>";
  });
  document.getElementById("weeks").innerHTML = html;
  firstRender = false;
}

const editing = new Set();

// What to show besides runs: a run moved onto a class day replaces the class; a day freed up by a moved run becomes a class day
// (unless tomorrow is the long run or race)
function classRef(slot, runsHere, slotRunMoved) {
  if (slot.type === "class") return runsHere.length ? null : slot;
  if (slot.type === "rest") return runsHere.length ? null : slot;
  if (slotRunMoved && !runsHere.length) {
    const tomorrow = WEEKS.flatMap(w => w.sessions).find(s => sameDay(s.date, addDays(slot.date, 1)));
    const beforeLong = tomorrow && (tomorrow.type === "long" || tomorrow.type === "race");
    return beforeLong ? { type: "rest", title: "Rest" } : { type: "class", title: "Good day for a class", desc: "Freed up by your moved run" };
  }
  return null;
}

// One row per calendar day: whatever is planned there, plus any run moved onto it
function daySlot(slot, today) {
  const date = slot.date;
  const isToday = sameDay(date, today);
  const runsHere = SESSIONS.filter(s => s.mi > 0 && sameDay(effDate(s), date));
  const slotRunMoved = slot.mi > 0 && !sameDay(effDate(slot), date);
  let body = "";
  const ref = classRef(slot, runsHere, slotRunMoved);
  if (ref) body += plainEntry(ref);
  runsHere.forEach(r => body += runEntry(r, date));
  if (slot.strength) body += '<span class="str-tag">' + (runsHere.length ? "+ Strength routine after" : "Strength routine · 15 min") + "</span>";
  const allDone = runsHere.length && runsHere.every(isDone);
  return '<div class="day' + (isToday ? " is-today" : "") + (allDone ? " done" : "") + '"><div class="d"><b>' + DAYNAME[slot.day] + "</b>" + fmt(date) + '</div><div class="what">' + body + "</div></div>";
}

function plainEntry(s) {
  return '<div class="entry ' + s.type + '"><div class="e-main"><div class="title">' + esc(s.title) + "</div>" +
    (s.desc ? '<div class="desc">' + esc(s.desc) + "</div>" : "") + "</div></div>";
}

function runEntry(s, shownDate) {
  const done = isDone(s);
  const v = state[s.key] || {};
  let m = '<div class="title">' + '<span class="mi">' + miStr(s.mi) + "</span>" + esc(s.title) + (s.optional ? '<span class="opt">optional</span>' : "") + "</div>";
  if (!sameDay(s.date, shownDate)) m += '<div class="moved">Moved from ' + DAYNAME[s.day] + "</div>";
  if (s.desc && !done) m += '<div class="desc">' + esc(s.desc) + "</div>";
  if (fuelFor(s) && !done) m += '<span class="fuel-tag">' + esc(fuelFor(s)) + "</span>";
  if (done) {
    const a = typeof v.actual === "number" ? v.actual : s.mi;
    if (editing.has(s.key)) {
      const wkStart = WEEKS[s.week].start;
      let opts = "";
      for (let i = 0; i < 7; i++) {
        const d = addDays(wkStart, i), val = iso(d);
        opts += '<option value="' + val + '"' + (sameDay(d, effDate(s)) ? " selected" : "") + ">" + DAYNAME[i] + " " + fmt(d) + "</option>";
      }
      m += '<div class="edit-row"><label>Miles <input type="number" inputmode="decimal" step="0.01" min="0" value="' + a + '" data-actual="' + s.key + '"></label>' +
        '<label>Day <select data-date="' + s.key + '">' + opts + "</select></label>" +
        '<button type="button" class="link" data-edit="' + s.key + '">Done</button></div>';
    } else {
      m += '<div class="logged">' + miStr(a) + " mi logged <button type=\"button\" class=\"link\" data-edit=\"" + s.key + '">Edit</button></div>';
    }
  }
  const box = '<button class="check' + (done ? " on" : "") + '" data-toggle="' + s.key + '" aria-pressed="' + done + '" aria-label="Mark ' + esc(s.title) + " " + (done ? "not done" : "done") + '">' + CHECK + "</button>";
  return '<div class="entry run' + (done ? " is-done" : "") + '"><div class="e-main">' + m + "</div>" + box + "</div>";
}

function renderToday(today) {
  const el = document.getElementById("today");
  const runsToday = SESSIONS.filter(s => s.mi > 0 && sameDay(effDate(s), today));
  const slotToday = WEEKS.flatMap(w => w.sessions).find(s => sameDay(s.date, today));
  const refToday = slotToday ? classRef(slotToday, runsToday, slotToday.mi > 0 && !sameDay(effDate(slotToday), today)) : null;
  const todays = runsToday.concat(refToday && refToday.type === "class" ? [Object.assign({ key: "class-today" }, refToday)] : []);
  let h;
  if (today < START) h = "<h2>Plan starts " + fmt(START) + "</h2>";
  else if (today > RACE) h = '<h2>Race complete</h2><div class="today-item"><div class="t"><div class="title">You did it.</div></div></div>';
  else if (todays.length) {
    if (todays.every(s => s.type === "class")) h = "<h2>Today · No run</h2>"; else
    h = "<h2>Today · " + DAYNAME[(today.getDay() + 6) % 7] + ", " + fmt(today) + "</h2>";
    todays.forEach(s => {
      const done = isDone(s);
      h += '<div class="today-item"><div class="t"><div class="title">' + (s.mi ? miStr(s.mi) + " mi · " : "") + esc(s.title) + "</div>" +
        (s.desc ? '<div class="desc">' + esc(s.desc) + "</div>" : "") + (fuelFor(s) ? '<span class="fuel-tag">' + esc(fuelFor(s)) + "</span>" : "") + "</div>" +
        (s.type === "class" ? '<span class="opt-pill">optional</span>' : '<button class="btn' + (done ? " done" : "") + '" data-toggle="' + s.key + '">' + (done ? "Done ✓" : "Mark done") + "</button>") + "</div>";
    });
  } else h = "<h2>Today · Rest day</h2>";
  const todaySlot = WEEKS.flatMap(w => w.sessions).find(s => sameDay(s.date, today));
  if (todaySlot && todaySlot.strength && today <= RACE) {
    h += '<div class="today-item"><div class="t"><div class="title" style="font-size:20px">Strength routine</div><div class="desc">15 min · heel drops, clamshells, band walks, bridges, side plank, single-leg RDL</div></div><span class="str-tag">today</span></div>';
  }
  const next = SESSIONS.find(s => s.date > today && s.mi > 0 && !isDone(s));
  if (next && today <= RACE) {
    h += '<div class="today-item"><div class="t"><div class="desc">Next run · ' + DAYNAME[next.day] + ", " + fmt(next.date) + '</div><div class="title" style="font-size:20px">' + miStr(next.mi) + " mi · " + esc(next.title) + "</div>" + (next.desc ? '<div class="desc">' + esc(next.desc) + "</div>" : "") + "</div></div>";
  }
  el.innerHTML = h;
}

function setStatus(t, warn) { const e = document.getElementById("status"); e.textContent = t; e.className = "status" + (warn ? " warn" : ""); }

function jumpToWeek(i) {
  selWeek = i;
  openWeeks.add(i);
  render();
  const el = document.querySelector('details.week[data-week="' + i + '"]');
  if (!el) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

// ---- Backup ----
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: "surf-city", exported: new Date().toISOString(), progress: state }, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "surf-city-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus("Backup exported.");
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const progress = data.progress || data;
      if (typeof progress !== "object" || Array.isArray(progress)) throw new Error("bad");
      state = progress; saveState(); render();
      setStatus("Backup imported.");
    } catch (e) { setStatus("That file isn't a Surf City backup.", true); }
  };
  reader.readAsText(file);
}

// ---- Events ----
document.addEventListener("click", e => {
  const t = e.target.closest("[data-toggle]");
  if (t) { e.preventDefault(); toggle(t.dataset.toggle); return; }
  const r = e.target.closest("[data-rehab]");
  if (r) { e.preventDefault(); const [wi, i] = r.dataset.rehab.split(":").map(Number); toggleRehab(wi, i); return; }
  const ed = e.target.closest("[data-edit]");
  if (ed) { const k = ed.dataset.edit; editing.has(k) ? editing.delete(k) : editing.add(k); render(); return; }
  const jmp = e.target.closest("[data-jump]");
  if (jmp) { jumpToWeek(+jmp.dataset.jump); return; }
  if (e.target.id === "export") exportBackup();
});
document.addEventListener("change", e => {
  const a = e.target.closest("[data-actual]");
  if (a) setActual(a.dataset.actual, a.value);
  const dt = e.target.closest("[data-date]");
  if (dt) setRunDate(dt.dataset.date, dt.value);
  if (e.target.id === "import-file" && e.target.files[0]) { importBackup(e.target.files[0]); e.target.value = ""; }
});
document.addEventListener("toggle", e => {
  const d = e.target;
  if (d.matches && d.matches("details.week")) { const wi = +d.dataset.week; d.open ? openWeeks.add(wi) : openWeeks.delete(wi); }
}, true);
// Refresh "today" when the app comes back to the foreground on a new day
// Each time the app comes back to the foreground, pick up plan changes and runs Claude logged
let lastSync = Date.now();
async function syncRemote() {
  try {
    const [pr, lr] = await Promise.all([fetch("plan.json", { cache: "no-cache" }), fetch("log.json", { cache: "no-cache" })]);
    if (pr.ok) {
      const plan = await pr.json();
      if (JSON.stringify(plan) !== JSON.stringify(PLAN && PLAN._raw)) {
        try { localStorage.setItem(LS_PLAN, JSON.stringify(plan)); } catch (e) {}
        plan._raw = JSON.parse(JSON.stringify(plan));
        buildPlan(plan); renderStatic();
      }
    }
    if (lr.ok) mergeRemote(await lr.json());
    showSynced();
  } catch (e) {}
  render();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !PLAN) return;
  render();
  if (Date.now() - lastSync > 15000) { lastSync = Date.now(); syncRemote(); }
});

// No pinch or double-tap zoom (iOS ignores user-scalable=no on its own)
["gesturestart", "gesturechange"].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// Refresh button: reload everything (app code, plan, logged runs). Progress stays on the phone.
document.getElementById("refresh").addEventListener("click", async () => {
  const btn = document.getElementById("refresh");
  btn.classList.add("spin");
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch (e) {}
  location.reload();
});
function showSynced() {
  const d = new Date(), h = d.getHours() % 12 || 12, m = String(d.getMinutes()).padStart(2, "0");
  document.getElementById("synced").textContent = "Updated " + h + ":" + m + (d.getHours() < 12 ? " AM" : " PM");
}

// ---- Boot ----
(async function boot() {
  state = loadState();
  let plan = null;
  try {
    const res = await fetch("plan.json", { cache: "no-cache" });
    if (res.ok) { plan = await res.json(); try { localStorage.setItem(LS_PLAN, JSON.stringify(plan)); } catch (e) {} }
  } catch (e) {}
  if (!plan) { try { plan = JSON.parse(localStorage.getItem(LS_PLAN)); } catch (e) {} }
  if (!plan) { setStatus("Couldn't load the plan. Connect to the internet and reopen the app.", true); return; }
  plan._raw = JSON.parse(JSON.stringify(plan));
  buildPlan(plan);
  try {
    const lr = await fetch("log.json", { cache: "no-cache" });
    if (lr.ok) mergeRemote(await lr.json());
  } catch (e) {}
  renderStatic();
  render();
  setStatus("Saved on this phone.");
  if (navigator.onLine !== false) showSynced();
  if ("serviceWorker" in navigator) {
    // When a new version of the app takes over, reload once so it shows right away
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
  }
})();
