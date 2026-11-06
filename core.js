// The pure half of the app, loaded as a plain script before the UI.

// Default contexts — seed only. Since schema v2 the live list is state.contexts,
// editable in-app (Sync & Backup → Contexts); this constant is the fallback/seed.
const CONTEXTS = ["@anywhere","@calls","@computer","@errands","@home","@office"];
// GTD's other two "engage" criteria beyond context: energy available and time at hand.
// Optional on a Next Action; "" = unset. Stored as these literal labels.
const ENERGIES = ["Low","Med","High"];
const TIMES    = ["<15m","<1h",">1h"];
const LISTS    = ["inbox","next","projects","waiting","someday","reference","done"];
// Sidebar order — GTD workflow order (capture→clarify→organize→reflect→engage):
// Inbox → the organize lists → Calendar/Weekly Review (reflect) → Done. Today leads
// as the daily home. `today`/`calendar`/`review` are cross-list views, not stored
// lists, so they stay out of LISTS to keep data/count logic untouched.
const NAV      = ["today","inbox","next","waiting","projects","someday","reference","calendar","review","chat","done"];
// Lists whose items can carry a dueDate and so appear on the Calendar.
const DATED    = ["next","waiting","projects","someday"];
// Lists the Today view draws from — actionable work only. Projects are outcomes
// (you do their next actions, not the project), and Someday is "not now", so neither
// belongs in "do today"; their dates still show on the Calendar.
const TODAY_LISTS = ["next","waiting"];
const META = {
  today:     { icon:"🎯", label:"Today",          hint:"Your focus for today — plan and engage" },
  review:    { icon:"🔄", label:"Weekly Review",   hint:"Reflect: get clear, get current, get creative" },
  inbox:     { icon:"📥", label:"Inbox",         hint:"Capture everything — process later" },
  next:      { icon:"⚡", label:"Next Actions",   hint:"Next physical, visible actions" },
  calendar:  { icon:"📅", label:"Calendar",       hint:"Scheduled items by due date" },
  projects:  { icon:"📋", label:"Projects",       hint:"Outcomes needing more than one step" },
  waiting:   { icon:"⏳", label:"Waiting For",    hint:"Delegated to or expected from others" },
  someday:   { icon:"🌟", label:"Someday/Maybe",  hint:"Ideas to revisit when the time is right" },
  reference: { icon:"📁", label:"Reference",      hint:"Non-actionable — keep for future lookup" },
  chat:      { icon:"✨", label:"Agent",          hint:"Ask, or tell it what to do — you approve every change" },
  done:      { icon:"✅", label:"Done",           hint:"Completed items" },
};

// ── Helpers ───────────────────────────────────────────────────
const ts      = () => new Date().toISOString();
const mk      = t  => ({ id: Date.now()+Math.random(), title:t.trim(), created:ts(), projectId:"", context:"@anywhere", dueDate:"", dueTime:"", startDate:"", waitingFor:"", energy:"", time:"", _updatedAt: Date.now() });
const exProj  = t  => { const m=(t||"").match(/^\[([^\]]+)\]/); return m?m[1]:null; };
const fmtDate = d  => { try{ return new Date(d).toLocaleDateString("vi-VN",{day:"2-digit",month:"2-digit",year:"numeric"}); }catch{return d||"";} };
// "HH:MM" (24h) → "h:mm AM/PM"; blank stays blank. Optional time turns a due DATE into a
// true time-specific appointment (GTD hard landscape). A bare date stays day-scale.
const fmtTime = t  => { if(!t) return ""; const [h,m]=t.split(":").map(Number); const ap=h<12?"AM":"PM"; const h12=h%12||12; return `${h12}:${String(m).padStart(2,"0")} ${ap}`; };
const dueLabel= (d,tm) => d ? (tm ? `${d} ${fmtTime(tm)}` : d) : "";
const isoDate = d  => { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
const relTime = t  => { if(!t) return ""; const s=Math.max(0,Math.floor((Date.now()-t)/1000)); if(s<60) return "just now"; const m=Math.floor(s/60); if(m<60) return m+"m ago"; const h=Math.floor(m/60); if(h<24) return h+"h ago"; return Math.floor(h/24)+"d ago"; };
const isOver  = d  => d && new Date(d+"T23:59") < new Date();
// GTD tickler: an item with a future start date is "deferred" — hidden from the active
// Next Actions / Waiting / Today lists until its start day, then it resurfaces.
const isDeferred = (i, today) => i.startDate && i.startDate > today;
const fresh   = () => ({ schemaVersion:SCHEMA_VERSION, inbox:[], next:[], projects:[], waiting:[], someday:[], reference:[], done:[],
                         contexts:[...CONTEXTS], agentContext:"", pomoConfig:{ ...POMO_DEFAULTS }, tombstones:{}, _reviewedAt:0, _metaUpdatedAt:0, _updatedAt:0 });
// How we were launched. The OS/launcher starts us at start_url with a query:
// ?title/&text/&url from the PWA share target, or ?view/&capture/&headless
// from a home-screen shortcut or the Android widget.
// ONE parser on purpose — reading is destructive (the query is stripped right after
// so a reload can't replay it), so two independent readers would starve each other.
//   capture      shared text to drop straight into the Inbox ("" = not a share)
//   view         nav key to open on boot ("" = default)
//   focusCapture autofocus the quick-capture box
//   headless     offscreen sync run (Android worker) — skip UI-only work
const readLaunchIntent = () => {
  const out = { capture:"", view:"", focusCapture:false, headless:false };
  try {
    if (!location.search) return out;
    const p = new URLSearchParams(location.search);
    const parts = [];
    ["title","text","url"].forEach(k => { const v=(p.get(k)||"").trim(); if (v && !parts.includes(v)) parts.push(v); });
    out.capture      = parts.join(" — ");
    const v          = (p.get("view")||"").trim();
    out.view         = NAV.includes(v) ? v : "";
    out.focusCapture = p.get("capture")  === "1";
    out.headless     = p.get("headless") === "1";
    history.replaceState(null, "", location.pathname);
  } catch {}
  return out;
};
// ═══ DATA CORE (schema v2) ═══════════════════════════════════
// Pure data functions — no DOM, no network. tests/test_data_core.js runs this file in a bare
// Node VM, so keep it free of JSX and browser APIs.
//
// Schema v2: every item carries its own `_updatedAt` (ms) and an explicit
// `projectId` link (no more [Project] title prefixes in stored data);
// the state carries `contexts` (user-editable), `tombstones` {id: deletedAt}
// so deletions survive merging, and `_metaUpdatedAt` for non-item settings.
const SCHEMA_VERSION = 2;
const ARCHIVE_DAYS   = 90;   // done items older than this rotate into the archive store
const TOMB_DAYS      = 60;   // tombstones are pruned after this (all devices have synced)

const pickLists      = src => Object.fromEntries(LISTS.map(l => [l, Array.isArray(src[l]) ? src[l] : []]));
const looksLikeState = d   => d && typeof d === "object" && LISTS.some(l => Array.isArray(d[l]));
const sameState      = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const stripPrefix    = t   => (t||"").replace(/^\[[^\]]+\]\s*/, "").trim();

// id → title for everything that can BE a project (active, deferred, or closed).
const projIndex = s => {
  const m = new Map();
  ["projects","someday","done"].forEach(l => (s[l]||[]).forEach(p => { if (!m.has(p.id)) m.set(p.id, p.title); }));
  return m;
};

// Capture convenience: typing "[Project] action" links the action to an EXISTING
// project by name (active or someday). No match ⇒ the title stays as typed.
const linkByPrefix = (title, s) => {
  const p = exProj(title);
  if (p) {
    const key = p.trim().toLowerCase();
    const hit = ["projects","someday"].flatMap(l => s[l]||[]).find(x => (x.title||"").trim().toLowerCase() === key);
    if (hit) return { title: stripPrefix(title), projectId: hit.id };
  }
  return { title: (title||"").trim(), projectId: "" };
};

// Upgrade any stored/imported/remote state to schema v2. v1 → v2 stamps every
// item with the old state-level clock and converts [Project] title prefixes to
// projectId links (matched case-insensitively against projects/someday/done).
const migrate = raw => {
  if (!looksLikeState(raw)) return null;
  const s = { ...fresh(), ...pickLists(raw) };
  s._reviewedAt = raw._reviewedAt || 0;
  if (raw._reviewDay != null) s._reviewDay = raw._reviewDay;
  s._updatedAt     = raw._updatedAt || 0;
  s.contexts       = Array.isArray(raw.contexts) && raw.contexts.length ? [...raw.contexts] : [...CONTEXTS];
  s.agentContext   = typeof raw.agentContext === "string" ? raw.agentContext : "";
  s.pomoConfig     = pomoSettings(raw.pomoConfig);
  s.tombstones     = raw.tombstones && typeof raw.tombstones === "object" ? { ...raw.tombstones } : {};
  s._metaUpdatedAt = raw._metaUpdatedAt || 0;
  if ((raw.schemaVersion || 1) < 2) {
    const stamp  = raw._updatedAt || Date.now();
    const byName = new Map();
    ["projects","someday","done"].forEach(l => (s[l]||[]).forEach(p => {
      const k = (p.title||"").trim().toLowerCase();
      if (k && !byName.has(k)) byName.set(k, p.id);
    }));
    LISTS.forEach(l => { s[l] = (s[l]||[]).map(i => {
      const out = { ...i };
      if (out._updatedAt == null) out._updatedAt = stamp;
      if (out.projectId === undefined) {
        const p  = exProj(out.title);
        const id = p ? byName.get(p.trim().toLowerCase()) : undefined;
        if (id !== undefined && id !== out.id) { out.projectId = id; out.title = stripPrefix(out.title) || out.title; }
        else out.projectId = "";
      }
      return out;
    }); });
    if (!raw._metaUpdatedAt) s._metaUpdatedAt = stamp;
  }
  s.schemaVersion = SCHEMA_VERSION;
  return s;
};

// Stamp `_updatedAt` on every item that changed vs `prev` (same-reference items
// skip instantly, deep-equal copies skip too), bump `_metaUpdatedAt` when the
// settings (contexts / review day) changed, and advance the state clock.
// Mutations build plain next-states; `upd` runs them through here — no call
// site has to remember to stamp anything.
const stampChanges = (prev, next) => {
  const t   = Date.now();
  const out = { ...next };
  LISTS.forEach(l => {
    const pm = new Map(((prev && prev[l]) || []).map(i => [i.id, i]));
    out[l] = (next[l] || []).map(i => {
      const p = pm.get(i.id);
      if (p === i) return i;
      if (p && JSON.stringify(p) === JSON.stringify(i)) return i;
      return { ...i, _updatedAt: t };
    });
  });
  if (prev && (JSON.stringify(prev.contexts) !== JSON.stringify(next.contexts) || prev._reviewDay !== next._reviewDay || prev.agentContext !== next.agentContext || JSON.stringify(prev.pomoConfig) !== JSON.stringify(next.pomoConfig)))
    out._metaUpdatedAt = t;
  out._updatedAt = t;
  return out;
};

// Item-level merge — the heart of multi-device sync. Union across ALL lists
// keyed by item id; on a clash the copy with the newer `_updatedAt` wins whole
// (fields AND which list it lives in, so moves propagate). Ties keep `a` —
// call with local first. A tombstone kills any copy older than the deletion,
// so deletes propagate instead of resurrecting. Two devices editing DIFFERENT
// items concurrently now both keep their changes (v1 whole-state LWW lost one).
// Finished sessions survive whichever copy wins. Crediting stamps nothing, so a device
// waking with a stale copy can't beat an edit made elsewhere while it slept. Days are
// sorted so two devices serialize alike and sync settles.
const withPomos = (winner, x, y) => {
  if (!x.pomos && !y.pomos) return winner;
  const days = { ...x.pomos };
  Object.entries(y.pomos||{}).forEach(([d, c]) => { days[d] = Math.max(days[d]||0, c); });
  return { ...winner, pomos: Object.fromEntries(Object.entries(days).sort()) };
};
const mergeStates = (a, b) => {
  const A = migrate(a) || fresh(), B = migrate(b) || fresh();
  const index = s => { const m = new Map(); LISTS.forEach(l => (s[l]||[]).forEach(i => { if (!m.has(i.id)) m.set(i.id, { i, l }); })); return m; };
  const ia = index(A), ib = index(B);
  const tombs = { ...A.tombstones };
  Object.entries(B.tombstones).forEach(([id, t]) => { if (!(tombs[id] >= t)) tombs[id] = t; });
  const out = fresh();
  const seen = new Set();
  const choose = id => {
    const ea = ia.get(id), eb = ib.get(id);
    const e  = !eb ? ea : !ea ? eb : ((eb.i._updatedAt||0) > (ea.i._updatedAt||0) ? eb : ea);
    if (!(tombs[id] > (e.i._updatedAt||0))) out[e.l].push(ea && eb ? withPomos(e.i, ea.i, eb.i) : e.i);
  };
  LISTS.forEach(l => (A[l]||[]).forEach(i => { if (!seen.has(i.id)) { seen.add(i.id); choose(i.id); } }));
  LISTS.forEach(l => (B[l]||[]).forEach(i => { if (!seen.has(i.id)) { seen.add(i.id); choose(i.id); } }));
  const cutoff = Date.now() - TOMB_DAYS*86400000;
  out.tombstones = Object.fromEntries(Object.entries(tombs).filter(([,t]) => t >= cutoff));
  const meta = (B._metaUpdatedAt||0) > (A._metaUpdatedAt||0) ? B : A;
  out.contexts = Array.isArray(meta.contexts) && meta.contexts.length ? [...meta.contexts] : [...CONTEXTS];
  if (meta._reviewDay != null) out._reviewDay = meta._reviewDay;
  out.agentContext = meta.agentContext || "";
  out.pomoConfig = pomoSettings(meta.pomoConfig);
  out._metaUpdatedAt = Math.max(A._metaUpdatedAt||0, B._metaUpdatedAt||0);
  out._reviewedAt    = Math.max(A._reviewedAt||0,    B._reviewedAt||0);
  out._updatedAt     = Math.max(A._updatedAt||0,     B._updatedAt||0);
  return out;
};

// Archive store (separate from live state so day-to-day sync stays small):
// append-only union by id, newest first.
const mergeArchive = (a, b) => {
  const m = new Map();
  [...(Array.isArray(a)?a:[]), ...(Array.isArray(b)?b:[])].forEach(i => { if (i && !m.has(i.id)) m.set(i.id, i); });
  return Array.from(m.values()).sort((x, y) => String(y.doneAt||y.created||"").localeCompare(String(x.doneAt||x.created||"")));
};

// Rotate done items older than ARCHIVE_DAYS into the archive. They're
// tombstoned in the live state so other devices retire their copies through
// the normal merge instead of resurrecting them. Returns null when nothing
// needs to move.
const splitArchive = (state, archive) => {
  const cut = new Date(Date.now() - ARCHIVE_DAYS*86400000).toISOString();
  const stay = [], go = [];
  (state.done||[]).forEach(i => ((i.doneAt||i.created||"") < cut ? go : stay).push(i));
  if (!go.length) return null;
  const t = Date.now();
  const tombs = { ...state.tombstones };
  go.forEach(i => { tombs[i.id] = t; });
  return { state: { ...state, done: stay, tombstones: tombs, _updatedAt: t },
           archive: mergeArchive(archive, go) };
};

// Today = a derived cross-list view, never a stored list: the actionable items
// from TODAY_LISTS that want attention now, deduped by id with priority
// overdue > focus > due > started, ties broken by dueTime (timed appointments
// first). Each row carries `_list` (where it actually lives) and `_kind`.
// Shared by TodayView, FloatToday, the sidebar badge and the Android widget
// snapshot so the four can never drift apart.
const TODAY_RANK = { overdue:0, focus:1, due:2, started:3 };
const todayRows = (state, todayISO) => {
  const seen = new Set(), rows = [];
  TODAY_LISTS.forEach(l => (state[l]||[]).forEach(i => {
    if (seen.has(i.id) || isDeferred(i, todayISO)) return;   // tickler: not actionable yet
    const od    = !!(i.dueDate && i.dueDate < todayISO);
    const due   = i.dueDate === todayISO;
    const foc   = l === "next" && i.focusDate === todayISO;
    // tickler fired: its start date has arrived — surface it as on-deck
    const start = !!(i.startDate && i.startDate <= todayISO);
    if (!(od || due || foc || start)) return;
    seen.add(i.id);
    rows.push({ ...i, _list:l, _kind: od ? "overdue" : foc ? "focus" : due ? "due" : "started" });
  }));
  return rows.sort((a, b) => (TODAY_RANK[a._kind] - TODAY_RANK[b._kind])
                          || ((a.dueTime||"24:00").localeCompare(b.dueTime||"24:00")));
};

// ── AI ops ────────────────────────────────────────────────────
// Claude never sees a real item id (they're floats — costly to serialize, easy to
// mangle) and never mutates anything itself. aiProjection mints short aliases
// (n3, p1, w2) and hands back the alias→id map; the model proposes ops against
// those aliases; applyAiOps resolves them and folds the whole batch into ONE plain
// next state. Stamping stays with `upd` — same division of labour as drainWidgetOps.
const AI_OPS       = ["add","update","move","link","focus","complete","trash","remember"];
const AI_OPS_MAX   = 40;                                 // a runaway model may not rewrite the system
const AI_ADD_LISTS = LISTS.filter(l => l !== "done");    // reaching done is `complete`, not `add`
const AI_PATCH     = ["title","context","dueDate","dueTime","startDate","waitingFor","energy","time"];
const AI_LETTER    = { inbox:"i", next:"n", projects:"p", waiting:"w", someday:"s", reference:"r", done:"d" };
const aiIsDate     = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
const aiIsTime     = v => /^\d{2}:\d{2}$/.test(String(v||""));

// The one rendering of state for a prompt, and the one alias scheme. Line-oriented
// (≈40% fewer tokens than JSON for the same fields); empty fields are omitted.
// No raw item id ever appears in `text` — that is the point, and it is asserted.
//   opts = { lists?, max?, doneDays?, fields?:"title" }
const aiProjection = (state, todayISO, opts) => {
  const o     = opts || {};
  const lists = Array.isArray(o.lists) && o.lists.length ? o.lists : ["inbox","next","waiting","projects","someday"];
  const max   = o.max > 0 ? o.max : 120;
  const brief = o.fields === "title";
  const names = projIndex(state);
  const refs = {}, counts = {}, out = [];
  let truncated = false;
  const src = {};
  lists.forEach(l => {
    let all = state[l] || [];
    if (l === "done" && o.doneDays > 0) {
      const cut = Date.now() - o.doneDays * 86400000;
      all = all.filter(i => i.doneAt && new Date(i.doneAt).getTime() >= cut);
    }
    counts[l] = all.length;
    if (all.length > max) truncated = true;
    src[l] = all.slice(0, max);
  });
  // alias every shown item first, so a linked action can point at its project's alias
  const alias = new Map();
  lists.forEach(l => src[l].forEach((i, k) => { if (!alias.has(i.id)) alias.set(i.id, (AI_LETTER[l]||"x") + (k+1)); }));
  lists.forEach(l => {
    if (!src[l].length) return;
    out.push("## " + l + (counts[l] > src[l].length ? ` (showing ${src[l].length} of ${counts[l]})` : ""));
    src[l].forEach((i, k) => {
      const a = (AI_LETTER[l]||"x") + (k+1);
      refs[a] = i.id;
      const f = [a, (i.title||"").trim()];
      if (!brief) {
        if (i.context && i.context !== "@anywhere") f.push(i.context);
        if (i.dueDate)    f.push("due " + i.dueDate + (i.dueTime ? " " + i.dueTime : ""));
        if (i.startDate)  f.push("start " + i.startDate);
        if (i.waitingFor) f.push("for:" + i.waitingFor);
        if (todayISO && i.focusDate === todayISO) f.push("focus");
        if (i.projectId)  f.push("proj " + (alias.get(i.projectId) || names.get(i.projectId) || "?"));
        const et = [i.energy ? "E:"+i.energy : "", i.time ? "T:"+i.time : ""].filter(Boolean).join(" ");
        if (et) f.push(et);
        if (i.pomos) f.push("pomodoros " + pomoTotal(i));
      }
      out.push(f.join(" | "));
    });
  });
  return { refs, text: out.join("\n"), counts, truncated };
};

// Fold a batch of model-proposed ops into ONE plain next state. Unknown or
// unapplicable ops are SKIPPED with a reason — nothing throws, so a half-wrong
// batch still applies its good half. A batch that changes nothing returns the
// input state BY REFERENCE, so the caller can skip upd (the `n === cur` idiom).
//   opts = { refs:{alias:id}, todayISO }
// → { state, results:[{i, op, ok, reason?, effect?, clamped}], applied, skipped }
const applyAiOps = (state, ops, opts) => {
  const o       = opts || {};
  const today   = o.todayISO || "";
  const refs    = { ...(o.refs || {}) };       // working map — `as` registers new items
  const results = [];
  if (!Array.isArray(ops)) return { state, results, applied:0, skipped:0 };
  let n = state;

  const ctxOf = raw => {
    const list = Array.isArray(state.contexts) && state.contexts.length ? state.contexts : CONTEXTS;
    const key  = String(raw||"").trim().toLowerCase();
    return list.find(c => String(c).toLowerCase() === key) || "";
  };
  // alias first, then a raw-id string match — the same string comparison the
  // Kotlin widget bridge uses, because ids cross both boundaries as strings.
  const find = ref => {
    const key = String(ref == null ? "" : ref);
    if (!key) return null;
    const id  = refs[key];
    for (const l of LISTS) {
      const arr = n[l] || [];
      const k = id !== undefined ? arr.findIndex(x => x.id === id)
                                 : arr.findIndex(x => String(x.id) === key);
      if (k >= 0) return { list:l, idx:k, item:arr[k] };
    }
    return null;
  };
  const projOf = (raw, clamped) => {
    if (raw === "" || raw == null) return "";                      // explicit unlink
    const hit = find(raw);
    if (hit && (hit.list === "projects" || hit.list === "someday")) return hit.item.id;
    const key = String(raw).trim().toLowerCase();
    const m   = ["projects","someday"].reduce((a,l) => a.concat(n[l]||[]), [])
                  .find(x => (x.title||"").trim().toLowerCase() === key);
    if (m) return m.id;
    clamped.push("project");
    return null;                                                   // unresolved is not the same as unlink
  };
  // Copy whitelisted fields across, dropping anything malformed instead of
  // rejecting the whole op — a bad date should not cost you a good action.
  const patch = (src, into, clamped) => {
    AI_PATCH.forEach(f => {
      if (!(f in src)) return;
      let v = src[f];
      if (f === "title")        { v = String(v||"").trim().slice(0,200); if (!v) return; }
      else if (f === "context") { const c = ctxOf(v); if (!c) { clamped.push("context"); return; } v = c; }
      else if (f === "dueDate" || f === "startDate") { v = String(v||""); if (v && !aiIsDate(v)) { clamped.push(f); return; } }
      else if (f === "dueTime") { v = String(v||""); if (v && !aiIsTime(v)) { clamped.push(f); return; } }
      else if (f === "energy")  { v = String(v||""); if (v && ENERGIES.indexOf(v) < 0) { clamped.push(f); return; } }
      else if (f === "time")    { v = String(v||""); if (v && TIMES.indexOf(v) < 0)    { clamped.push(f); return; } }
      else v = String(v||"");
      into[f] = v;
    });
    if (!into.dueDate) into.dueTime = "";     // a bare time is meaningless (mirrors the add form)
  };
  const put  = (list, idx, item) => { const a = [...(n[list]||[])]; a[idx] = item; n = { ...n, [list]: a }; };
  const pull = (list, idx)       => { n = { ...n, [list]: (n[list]||[]).filter((_,k) => k !== idx) }; };

  ops.forEach((op, i) => {
    const clamped = [];
    const skip = reason => { results.push({ i, op:(op && op.op) || "", ok:false, reason, clamped }); };
    const done = effect => { results.push({ i, op:op.op, ok:true, effect, clamped }); };
    if (i >= AI_OPS_MAX)                              return skip("too-many");
    if (!op || typeof op !== "object" || typeof op.op !== "string") return skip("bad-shape");
    if (AI_OPS.indexOf(op.op) < 0)                    return skip("unknown-op");

    if (op.op === "add") {
      const list = AI_ADD_LISTS.indexOf(String(op.list||"")) >= 0 ? String(op.list) : "";
      if (!list) return skip("no-such-list");
      const title = String(op.title||"").trim().slice(0,200);
      if (!title) return skip("empty-title");
      const it = mk(title);
      patch(op, it, clamped);
      it.title = title;
      if ("project" in op) { const p = projOf(op.project, clamped); it.projectId = p == null ? "" : p; }
      n = { ...n, [list]: [it, ...(n[list]||[])] };
      if (op.as) refs[String(op.as)] = it.id;          // later ops in this batch can reference it
      return done(`add → ${list}: ${title}`);
    }

    if (op.op === "remember") {
      const note = String(op.note||"").trim().slice(0,500);
      if (!note) return skip("empty-title");
      if ((n.agentContext||"").indexOf(note) >= 0) return skip("noop");
      n = { ...n, agentContext: [(n.agentContext||"").trim(), "- " + note].filter(Boolean).join("\n") };
      return done(`remember: ${note}`);
    }

    const hit = find(op.ref);
    if (!hit) return skip("no-such-item");
    const was = hit.item, name = (was.title||"").trim();

    if (op.op === "trash") {
      pull(hit.list, hit.idx);
      n = { ...n, tombstones: { ...n.tombstones, [was.id]: Date.now() } };   // or it resurrects from a peer
      return done(`trash: ${name}`);
    }
    if (op.op === "complete") {
      if (hit.list === "done") return skip("noop");
      pull(hit.list, hit.idx);
      n = { ...n, done: [{ ...was, doneAt: ts() }, ...(n.done||[])] };
      return done(`complete: ${name}`);
    }
    if (op.op === "focus") {
      if (hit.list !== "next") return skip("wrong-list");
      const want = op.on === false ? "" : today;
      if ((was.focusDate||"") === want) return skip("noop");
      put(hit.list, hit.idx, { ...was, focusDate: want });
      return done(want ? `focus today: ${name}` : `unfocus: ${name}`);
    }
    if (op.op === "link") {
      const p = projOf(op.project, clamped);
      if (p == null) return skip("no-such-project");
      if ((was.projectId||"") === (p||"")) return skip("noop");
      put(hit.list, hit.idx, { ...was, projectId: p });
      return done(p ? `link: ${name} → ${projIndex(n).get(p) || "project"}` : `unlink: ${name}`);
    }

    const next = { ...was };
    patch(op, next, clamped);
    if ("project" in op) { const p = projOf(op.project, clamped); if (p != null) next.projectId = p; }
    if (op.op === "update") {
      if (sameState(next, was)) return skip("noop");
      put(hit.list, hit.idx, next);
      return done(`update: ${(next.title||"").trim()}`);
    }
    // move
    const to = LISTS.indexOf(String(op.to||"")) >= 0 ? String(op.to) : "";
    if (!to) return skip("no-such-list");
    if (to === hit.list) {
      if (sameState(next, was)) return skip("noop");
      put(hit.list, hit.idx, next);
      return done(`update: ${(next.title||"").trim()}`);
    }
    pull(hit.list, hit.idx);
    if (to === "done") next.doneAt = ts();
    n = { ...n, [to]: [next, ...(n[to]||[])] };
    return done(`${(next.title||"").trim()} → ${to}`);
  });

  const applied = results.filter(r => r.ok).length;
  return { state: n, results, applied, skipped: results.length - applied };
};

// ── Pomodoro ──────────────────────────────────────────────────
// Phases: work → rest → break → idle. Only work and break run a clock, and each is started by
// hand; rest waits for that click, since the session often ends while the owner is mid-thought.
// `endsAt` is absolute, so a throttled or suspended page catches up correctly when it wakes.
// The timer is device-local; only finished sessions (item.pomos, {day: count}) go
// through sync. A session is indivisible: there is no pause or task switch, stopping
// voids it, and completing the action mid-session doesn't end it.
const POMO_DEFAULTS = { work:25, short:5, long:15, every:4 };     // minutes, and sessions per long break
const POMO_LIMITS = { work:[1,180], short:[1,60], long:[1,120], every:[1,12] };
// Whatever came in (a typed value, an old state, another device): every field usable.
const pomoSettings = raw => Object.fromEntries(Object.keys(POMO_DEFAULTS).map(k => {
  const v = raw && raw[k] != null ? Math.round(Number(raw[k])) : NaN;
  const [lo, hi] = POMO_LIMITS[k];
  return [k, Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : POMO_DEFAULTS[k]];
}));
const POMO_SPLIT = 5;     // this many sessions on one action: it's really a project
const POMO_MSG = { work:"Pomodoro done — take a break.", break:"Break over." };
const pomoBreakMs = (done, cfg = POMO_DEFAULTS) => (done % cfg.every === 0 ? cfg.long : cfg.short) * 60000;
const pomoStart = (cur, item, now, cfg = POMO_DEFAULTS) => ({
  phase:"work", itemId: item ? item.id : null, title: item ? (item.title||"") : "",
  done: cur ? cur.done : 0, marks:0, endsAt: now + cfg.work*60000,
});
const pomoBreakStart = (cur, now, cfg = POMO_DEFAULTS) => ({ ...cur, phase:"break", endsAt: now + pomoBreakMs(cur.done, cfg) });
// Same object back when nothing expired.
const pomoTick = (cur, now) => {
  if (cur && cur.phase === "work" && cur.endsAt <= now)
    return { timer:{ ...cur, phase:"rest", done: cur.done + 1, endsAt:0 }, credited:true, finished:"work" };
  if (cur && cur.phase === "break" && cur.endsAt <= now)
    return { timer:{ ...cur, phase:"idle", endsAt:0 }, credited:false, finished:"break" };
  return { timer:cur, credited:false, finished:null };
};
// Searches every list: the action may have been completed or moved mid-session.
const pomoCredit = (state, id, day) => {
  const l = id == null ? null : LISTS.find(k => (state[k]||[]).some(i => i.id === id));
  if (!l) return state;
  const bump = i => ({ ...i, pomos:{ ...i.pomos, [day]:((i.pomos||{})[day]||0)+1 } });
  return { ...state, [l]: state[l].map(i => i.id === id ? bump(i) : i) };
};
const pomoTotal = i => Object.values((i && i.pomos) || {}).reduce((n, c) => n + c, 0);
// Sessions credited to any action between two ISO days, inclusive.
const pomoTally = (state, from, to) => LISTS.flatMap(l => state[l]||[])
  .flatMap(i => Object.entries(i.pomos||{}))
  .reduce((n, [d, c]) => d >= from && d <= to ? n + c : n, 0);
// Item ids are floats, so they cross the bridge as strings and are compared as strings.
const applyWidgetOps = (state, ops, now, day) => {
  let n = state;
  ops.forEach(op => {
    const id = op && op.id != null ? String(op.id) : "";
    if (op.op === "capture" && (op.text||"").trim()) {
      n = { ...n, inbox:[mk(op.text), ...n.inbox] };
    } else if (op.op === "complete" && id) {
      TODAY_LISTS.forEach(l => {
        const it = (n[l]||[]).find(i => String(i.id) === id);
        if (!it) return;
        n = { ...n, [l]: n[l].filter(i => String(i.id) !== id), done:[{...it, doneAt:now}, ...n.done] };
      });
    } else if (op.op === "focus" && id && (n.next||[]).some(i => String(i.id) === id)) {
      n = { ...n, next: n.next.map(i => String(i.id) === id
        ? { ...i, focusDate: i.focusDate === day ? "" : day } : i) };
    }
  });
  return n;
};
// The ring ahead of this timer, for a native alarm that fires while the page can't run.
const pomoAlarms = t => (t && t.endsAt ? [{ at:t.endsAt, body:POMO_MSG[t.phase] }] : []);
const pomoClock = ms => {
  const s = Math.max(0, Math.ceil(ms/1000));
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
};

// ── Agent read tools ──────────────────────────────────────────
// What doesn't fit the prompt: old finished work and pomodoro history. Item titles come
// back as plain data with no aliases, because these rows can't be acted on.
const AGENT_ROWS = 40;
const agentTool = (name, input, state, archive, todayISO) => {
  const inp = input || {};
  const live = LISTS.flatMap(l => (state[l]||[]).map(i => ({ ...i, _list:l })));
  const old  = (archive||[]).map(i => ({ ...i, _list:"archive" }));
  if (name === "search_history") {
    const q = String(inp.query||"").trim().toLowerCase();
    const hits = [...live.filter(i => i._list === "done"), ...old]
      .filter(i => !q || (i.title||"").toLowerCase().indexOf(q) >= 0)
      .sort((a, b) => String(b.doneAt||"").localeCompare(String(a.doneAt||"")));
    if (!hits.length) return "No finished items match.";
    const rows = hits.slice(0, AGENT_ROWS).map(i =>
      [String(i.doneAt||"").slice(0,10) || "undated", (i.title||"").trim(), i.pomos ? "pomodoros " + pomoTotal(i) : ""].filter(Boolean).join(" | "));
    return (hits.length > AGENT_ROWS ? `Showing the newest ${AGENT_ROWS} of ${hits.length}.\n` : "") + rows.join("\n");
  }
  if (name === "pomodoro_stats") {
    const to = aiIsDate(inp.to) ? inp.to : todayISO, from = aiIsDate(inp.from) ? inp.from : to;
    const days = {}, byItem = [];
    [...live, ...old].forEach(i => {
      let n = 0;
      Object.entries(i.pomos||{}).forEach(([d, c]) => { if (d >= from && d <= to) { days[d] = (days[d]||0) + c; n += c; } });
      if (n) byItem.push(`${n} | ${(i.title||"").trim()}`);
    });
    const total = Object.values(days).reduce((a, b) => a + b, 0);
    if (!total) return `No sessions on actions between ${from} and ${to}.`;
    byItem.sort((a, b) => parseInt(b) - parseInt(a));
    return [`${total} sessions, ${from} to ${to}. Sessions not started on an action aren't counted.`,
            "By day: " + Object.keys(days).sort().map(d => `${d}=${days[d]}`).join(", "),
            ...byItem.slice(0, AGENT_ROWS)].join("\n");
  }
  return null;
};

// ── Files the owner attaches to the agent ─────────────────────
// Hidden paths and key files are dropped at the door, since picking a folder sweeps up
// whatever sits in it (.env, .git) and the names alone go out with every request.
const ATTACH_SKIP = /(^|\/)(\.[^/]*|node_modules|__pycache__)(\/|$)|\.(pem|key|pfx|p12)$/i;
const ATTACH_LIST_MAX = 400;
const ATTACH_CHUNK = 30000;
const attachAdd = (prev, files) => {
  const byPath = new Map(prev.map(e => [e.path, e]));
  files.forEach(f => {
    const path = f.webkitRelativePath || f.name;
    if (!ATTACH_SKIP.test(path)) byPath.set(path, { path, size:f.size, file:f });
  });
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
};
const attachSize = n => n < 1024 ? n + " B" : n < 1048576 ? Math.round(n/1024) + " KB" : (n/1048576).toFixed(1) + " MB";
const attachListing = list => {
  const rows = list.slice(0, ATTACH_LIST_MAX).map(e => `${e.path} (${attachSize(e.size)})`);
  return (list.length > ATTACH_LIST_MAX ? `Showing the first ${ATTACH_LIST_MAX} of ${list.length} files.\n` : "") + rows.join("\n");
};
const attachChunk = (path, text, offset, max) => {
  const from = Math.min(Math.max(parseInt(offset, 10) || 0, 0), text.length);
  const body = text.slice(from, from + max), to = from + body.length;
  return `${path}: characters ${from}-${to} of ${text.length}.` + (to < text.length ? ` Continue with offset ${to}.` : "") + "\n\n" + body;
};
