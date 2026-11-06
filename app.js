const { useState, useEffect, useCallback } = React;
const APP_VERSION = "v45";
const LAUNCH = readLaunchIntent();
function App() {
  const [items, setItems] = useState(null);
  const [active, setActive] = useState(LAUNCH.view || "today");
  const [ctx, setCtx] = useState("all");
  const [capture, setCapture] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", context: "@anywhere", dueDate: "", dueTime: "", startDate: "", waitingFor: "", energy: "", time: "" });
  const [enerF, setEnerF] = useState("all");
  const [timeF, setTimeF] = useState("all");
  const [procItem, setProcItem] = useState(null);
  const [complCand, setComplCand] = useState(null);
  const [promoteCand, setPromoteCand] = useState(null);
  const [editCand, setEditCand] = useState(null);
  const [history, setHistory] = useState([]);
  const [showData, setShowData] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const fileInputRef = React.useRef(null);
  const importMode = React.useRef("merge");
  const [odAccount, setOdAccount] = useState(() => Drive.account());
  const [syncing, setSyncing] = useState(false);
  const [aiKeyTick, setAiKeyTick] = useState(0);
  const [aiModel, setAiModel] = useState(() => Ai.model());
  const [aiTest, setAiTest] = useState(null);
  const [syncTick, setSyncTick] = useState(0);
  const [archive, setArchiveState] = useState([]);
  const itemsRef = React.useRef(null);
  const archiveRef = React.useRef([]);
  const lastSyncRef = React.useRef(0);
  const driveTimer = React.useRef(null);
  const setArchive = (a) => {
    archiveRef.current = a;
    setArchiveState(a);
    Store.saveArchive(a);
  };
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    if (!items || !WidgetBridge.available()) return;
    const pm = projIndex(items);
    WidgetBridge.publish(
      items,
      isoDate(/* @__PURE__ */ new Date()),
      (i) => i && i.projectId && pm.get(i.projectId) || null
    );
  }, [items]);
  useEffect(() => {
    const h = () => setUpdateReady(true);
    window.addEventListener("gtd:update-ready", h);
    return () => window.removeEventListener("gtd:update-ready", h);
  }, []);
  useEffect(() => {
    const m = Drive.init();
    if (!m) return;
    m.handleRedirectPromise().then((res) => {
      if (res && res.account) {
        m.setActiveAccount(res.account);
        try {
          localStorage.setItem(OD_FLAG, "1");
        } catch {
        }
        setOdAccount(Drive.account());
        syncNow();
      }
    }).catch(() => {
    });
  }, []);
  const adopt = useCallback((merged) => {
    const cur = itemsRef.current || fresh();
    const final = mergeStates(cur, merged);
    if (!sameState(final, cur)) {
      setItems(final);
      setHistory([]);
    }
    Store.saveLocal(final);
    return final;
  }, []);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== LS_KEY || !e.newValue) return;
      let theirs = null;
      try {
        theirs = migrate(JSON.parse(e.newValue));
      } catch {
      }
      if (!theirs) return;
      const cur = itemsRef.current || fresh(), final = mergeStates(cur, theirs);
      if (sameState(final, cur)) return;
      itemsRef.current = final;
      setItems(final);
      setHistory([]);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const fullSync = useCallback(async () => {
    const cur = itemsRef.current || fresh();
    const [drive, dArch] = await Promise.all([Drive.pull(), Drive.pullArchive()]);
    let merged = mergeStates(cur, drive && drive.data);
    let arch = mergeArchive(archiveRef.current, dArch && dArch.data);
    const rot = splitArchive(merged, arch);
    if (rot) {
      merged = rot.state;
      arch = rot.archive;
    }
    const final = adopt(merged);
    if (!sameState(arch, archiveRef.current) || rot) setArchive(arch);
    if (Drive.enabled() && (!drive || !sameState(drive.data, final))) {
      const res = await Drive.push(final);
      if (res.merged) adopt(res.merged);
    }
    const archOutdated = (rem) => !Array.isArray(rem) || rem.length !== arch.length;
    if (Drive.enabled() && arch.length && archOutdated(dArch && dArch.data)) Drive.pushArchive(arch);
    lastSyncRef.current = Date.now();
    setSyncTick((t) => t + 1);
  }, [adopt]);
  const fullSyncRef = React.useRef(fullSync);
  useEffect(() => {
    fullSyncRef.current = fullSync;
  }, [fullSync]);
  useEffect(() => {
    const local = Store.loadLocal() || fresh();
    const shared = LAUNCH.capture;
    const seeded = shared ? stampChanges(local, { ...local, inbox: [mk(shared), ...local.inbox] }) : local;
    itemsRef.current = seeded;
    setItems(seeded);
    Store.saveLocal(seeded);
    archiveRef.current = Store.loadArchive();
    setArchiveState(archiveRef.current);
    fullSyncRef.current();
  }, []);
  useEffect(() => {
    const id = setInterval(async () => {
      const drive = Drive.enabled() ? await Drive.pull() : null;
      if (!(drive && drive.data)) return;
      const cur = itemsRef.current || fresh();
      const final = adopt(mergeStates(cur, drive.data));
      if (!sameState(final, cur)) {
        lastSyncRef.current = Date.now();
        setSyncTick((t) => t + 1);
      }
      if (!sameState(drive.data, final)) {
        const res = await Drive.push(final);
        if (res.merged) adopt(res.merged);
      }
    }, 45e3);
    return () => clearInterval(id);
  }, [adopt]);
  const drivePush = useCallback((d) => {
    if (!Drive.enabled()) return;
    if (driveTimer.current) clearTimeout(driveTimer.current);
    driveTimer.current = setTimeout(() => {
      Drive.push(d).then((res) => {
        if (!res.ok) return;
        if (res.merged) adopt(res.merged);
        lastSyncRef.current = Date.now();
        setSyncTick((t) => t + 1);
      });
    }, 2e3);
  }, [adopt]);
  const persist = useCallback((d) => {
    Store.saveLocal(d);
    drivePush(d);
  }, [drivePush]);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await fullSync();
    } finally {
      setSyncing(false);
    }
  }, [fullSync]);
  const connectDrive = useCallback(async () => {
    if (typeof msal === "undefined") {
      alert("The Microsoft sign-in library couldn't load (network or content blocker). Check your connection and reload, then try again.");
      return;
    }
    if (WidgetBridge.available()) {
      try {
        Drive.init();
        Drive._msal.loginRedirect({ scopes: MS_SCOPES });
        return;
      } catch {
      }
    }
    try {
      const a = await Drive.connect();
      setOdAccount(a);
      if (a) await syncNow();
      else alert("Sign-in didn't complete — the popup may have been blocked. Allow popups for this site and try again.");
    } catch (err) {
      const code = err && (err.errorCode || err.name) || "";
      if (/popup/i.test(code) || /popup/i.test(err && err.message || "")) {
        try {
          Drive.init();
          Drive._msal.loginRedirect({ scopes: MS_SCOPES });
          return;
        } catch {
        }
      }
      alert("Could not connect to OneDrive: " + (err && err.message ? err.message : "check your client ID / app registration / redirect URI."));
    }
  }, [syncNow]);
  const disconnectDrive = useCallback(async () => {
    await Drive.disconnect();
    setOdAccount(null);
    setSyncTick((t) => t + 1);
  }, []);
  const aiOn = React.useMemo(() => Ai.enabled(), [aiKeyTick]);
  const aiOnline = Ai.online();
  const saveAiKey = useCallback((k) => {
    Ai.setKey(k);
    setAiTest(null);
    setAiKeyTick((t) => t + 1);
  }, []);
  const pickModel = useCallback((id) => {
    Ai.setModel(id);
    setAiModel(id);
  }, []);
  const testAiKey = useCallback(async () => {
    setAiTest("…");
    const r = await Ai.ping();
    setAiTest(r.ok ? { ok: true } : { ok: false, msg: r.msg });
  }, []);
  const upd = useCallback((d) => {
    const stamped = stampChanges(items, d);
    setHistory((h) => [...h.slice(-19), items]);
    setItems(stamped);
    persist(stamped);
  }, [items, persist]);
  const [pomo, setPomo] = useState(() => Pomo.load());
  const loaded = !!items;
  useEffect(() => {
    if (!loaded || LAUNCH.headless) return;
    const baseTitle = document.title;
    const tick = () => {
      const cur = Pomo.load(), now = Date.now();
      const { timer, credited, finished } = pomoTick(cur, now);
      if (timer !== cur) Pomo.save(timer);
      if (credited) {
        const live = itemsRef.current, next = pomoCredit(live, timer.itemId, isoDate(cur.endsAt));
        if (next !== live) {
          itemsRef.current = next;
          setItems(next);
          setHistory([]);
          persist(next);
        }
      }
      if (finished && now - cur.endsAt < 12e4) Pomo.alert(POMO_MSG[finished]);
      setPomo((p) => sameState(p, timer) ? p : timer);
      document.title = timer && timer.endsAt ? `${pomoClock(timer.endsAt - now)} ${timer.phase === "work" ? "🍅" : "☕"} ${baseTitle}` : baseTitle;
    };
    tick();
    const id = setInterval(tick, 1e3);
    return () => {
      clearInterval(id);
      document.title = baseTitle;
    };
  }, [loaded, persist]);
  const savePomo = (t) => {
    Pomo.save(t);
    setPomo(t);
  };
  const startPomo = (item) => {
    Pomo.arm();
    savePomo(pomoStart(Pomo.load(), item, Date.now(), itemsRef.current.pomoConfig));
  };
  const canStartPomo = !pomo || pomo.phase !== "work";
  const captureThought = (t) => {
    upd({ ...items, inbox: [mk(t), ...items.inbox] });
    const cur = Pomo.load();
    if (cur && cur.phase === "work") savePomo({ ...cur, marks: (cur.marks || 0) + 1 });
  };
  const agent = useAgentSession(items, archive, pomo);
  const renderPomoBar = (onCapture) => /* @__PURE__ */ React.createElement(
    PomoBar,
    {
      pomo,
      compact: !onCapture,
      onStop: () => savePomo(null),
      onCapture,
      onBreak: () => savePomo(pomoBreakStart(pomo, Date.now(), itemsRef.current.pomoConfig)),
      config: items && items.pomoConfig,
      onSkip: () => savePomo({ ...pomo, phase: "idle", endsAt: 0 }),
      onNext: () => startPomo({ id: pomo.itemId, title: pomo.title })
    }
  );
  const [aiJob, setAiJob] = useState(null);
  useEffect(() => {
    if (active === "chat" && !Ai.enabled()) setActive("today");
  }, [active, aiKeyTick]);
  const aiAbort = React.useRef(null);
  const runAi = useCallback(async (kind, target) => {
    if (aiAbort.current) aiAbort.current.abort();
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAiJob({ kind, target, busy: true, error: "", data: null, refs: {} });
    const cur = itemsRef.current || fresh(), day = isoDate(/* @__PURE__ */ new Date());
    const r = kind === "clarify" ? await AiTasks.clarify(cur, target, day, { ref: "c1", signal: ctrl.signal }) : kind === "breakdown" ? await AiTasks.breakdown(cur, target, day, { signal: ctrl.signal }) : await AiTasks.review(cur, target, day, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    setAiJob((j) => j && j.kind === kind ? { ...j, busy: false, error: r.ok ? "" : r.msg, data: r.ok ? r.data : null, refs: r.refs || {} } : j);
  }, []);
  const closeAi = useCallback(() => {
    if (aiAbort.current) {
      aiAbort.current.abort();
      aiAbort.current = null;
    }
    setAiJob(null);
  }, []);
  const applyAi = useCallback((ops, refs) => {
    const cur = itemsRef.current || fresh();
    const res = applyAiOps(cur, ops, { refs: refs || {}, todayISO: isoDate(/* @__PURE__ */ new Date()) });
    if (res.state !== cur) upd(res.state);
    return res;
  }, [upd]);
  const aiPreview = React.useMemo(() => {
    if (!aiJob || !aiJob.data) return null;
    const ops = aiJob.data.ops || [];
    return { ops, results: applyAiOps(items, ops, { refs: aiJob.refs, todayISO: isoDate(/* @__PURE__ */ new Date()) }).results };
  }, [aiJob, items]);
  const aiPanel = (kind) => {
    if (!aiOn) return null;
    const job = aiJob && aiJob.kind === kind ? aiJob : null;
    const d = job && job.data;
    const notes = !d ? [] : kind === "clarify" ? [d.reasoning].filter(Boolean) : kind === "breakdown" ? [d.outcome && "Outcome: " + d.outcome, d.nextAction && "Next action: " + d.nextAction].filter(Boolean) : [d.headline].filter(Boolean);
    return {
      online: aiOnline,
      active: !!job,
      busy: !!(job && job.busy),
      error: job ? job.error : "",
      data: d || null,
      notes,
      ops: aiPreview ? aiPreview.ops : [],
      results: aiPreview ? aiPreview.results : [],
      onApply: (chosen) => {
        const ops = (aiPreview ? aiPreview.ops : []).filter((_, i) => chosen.indexOf(i) >= 0);
        applyAi(ops, job ? job.refs : {});
        closeAi();
      },
      onClose: closeAi
    };
  };
  const drainWidgetOps = useCallback(() => {
    const ops = WidgetBridge.drain();
    if (!ops.length) return null;
    const cur = itemsRef.current || fresh();
    const n = applyWidgetOps(cur, ops, ts(), isoDate(/* @__PURE__ */ new Date()));
    if (n === cur) return null;
    const stamped = stampChanges(cur, n);
    itemsRef.current = stamped;
    setHistory((h) => [...h.slice(-19), cur]);
    setItems(stamped);
    persist(stamped);
    return stamped;
  }, [persist]);
  useEffect(() => {
    if (!WidgetBridge.available()) return;
    drainWidgetOps();
    const onVis = () => {
      if (document.visibilityState === "visible") drainWidgetOps();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [drainWidgetOps]);
  const headlessRef = React.useRef(false);
  useEffect(() => {
    if (!LAUNCH.headless || !items || headlessRef.current || !WidgetBridge.available()) return;
    headlessRef.current = true;
    (async () => {
      try {
        drainWidgetOps();
        await fullSyncRef.current();
        if (Drive.enabled()) await Drive.push(itemsRef.current);
      } catch {
      }
      WidgetBridge.ready();
    })();
  }, [items, drainWidgetOps]);
  const undo = useCallback(() => {
    if (history.length === 0) return;
    const prev = stampChanges(items, history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setItems(prev);
    persist(prev);
  }, [history, items, persist]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
  const triggerImport = (mode) => {
    importMode.current = mode;
    if (fileInputRef.current) fileInputRef.current.click();
  };
  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        alert("Could not read that file — is it a valid GTD backup (.json)?");
        return;
      }
      if (!looksLikeState(parsed)) {
        alert("That doesn't look like a GTD backup file.");
        return;
      }
      const mig = migrate(parsed);
      const next = importMode.current === "replace" ? (() => {
        const keep = /* @__PURE__ */ new Set();
        LISTS.forEach((l) => (mig[l] || []).forEach((i) => keep.add(i.id)));
        const tombs = { ...mig.tombstones };
        LISTS.forEach((l) => (items[l] || []).forEach((i) => {
          if (!keep.has(i.id)) tombs[i.id] = Date.now();
        }));
        return { ...mig, tombstones: tombs };
      })() : mergeStates(items, mig);
      if (Array.isArray(parsed.archive) && parsed.archive.length) {
        setArchive(importMode.current === "replace" ? parsed.archive : mergeArchive(archiveRef.current, parsed.archive));
      } else if (importMode.current === "replace") {
        setArchive([]);
      }
      upd(next);
      setShowData(false);
      alert(importMode.current === "replace" ? "Data replaced from backup." : "Backup merged in.");
    };
    reader.readAsText(f);
  };
  const quickCapture = () => {
    if (!capture.trim()) return;
    captureThought(capture);
    setCapture("");
  };
  const addItem = () => {
    if (!form.title.trim()) return;
    const linked = active === "next" || active === "waiting" ? linkByPrefix(form.title, items) : { title: form.title.trim(), projectId: "" };
    const item = { ...mk(linked.title), projectId: linked.projectId, context: form.context, dueDate: form.dueDate, dueTime: form.dueDate ? form.dueTime : "", startDate: form.startDate, waitingFor: form.waitingFor, energy: active === "next" ? form.energy : "", time: active === "next" ? form.time : "" };
    upd({ ...items, [active]: [item, ...items[active]] });
    setForm({ title: "", context: "@anywhere", dueDate: "", dueTime: "", startDate: "", waitingFor: "", energy: "", time: "" });
    setShowForm(false);
  };
  const move = (from, id, to, patch = {}) => {
    const item = items[from].find((i) => i.id === id);
    if (!item) return;
    upd({ ...items, [from]: items[from].filter((i) => i.id !== id), [to]: [{ ...item, ...patch }, ...items[to]] });
    setProcItem(null);
  };
  const del = (list, id) => upd({
    ...items,
    [list]: items[list].filter((i) => i.id !== id),
    tombstones: { ...items.tombstones, [id]: Date.now() }
  });
  const applyEdit = (list, item, patch) => {
    if (list === "projects") {
      upd({ ...items, projects: items.projects.map((p) => p.id === item.id ? { ...p, title: patch.title, dueDate: patch.dueDate, dueTime: patch.dueTime, startDate: patch.startDate } : p) });
      return;
    }
    upd({ ...items, [list]: items[list].map((i) => i.id === item.id ? {
      ...i,
      title: patch.title,
      projectId: patch.projectId !== void 0 ? patch.projectId : i.projectId,
      context: patch.context,
      dueDate: patch.dueDate,
      dueTime: patch.dueTime,
      startDate: patch.startDate,
      waitingFor: patch.waitingFor,
      energy: patch.energy,
      time: patch.time
    } : i) });
  };
  const toggleFocus = (id) => {
    const t = isoDate(/* @__PURE__ */ new Date());
    upd({ ...items, next: items.next.map((i) => i.id === id ? { ...i, focusDate: i.focusDate === t ? "" : t } : i) });
  };
  const handleStalledDecision = (decision, proj, extra) => {
    let n = { ...items };
    if (decision === "next" && extra) {
      const a = { ...mk(extra.title), projectId: proj.id, context: extra.context, dueDate: extra.dueDate };
      n = { ...n, next: [a, ...n.next] };
    }
    if (decision === "waiting" && extra) {
      const w = { ...mk(extra.waitingFor), waitingFor: extra.waitingFor, projectId: proj.id };
      n = { ...n, waiting: [w, ...n.waiting] };
    }
    if (decision === "someday")
      n = { ...n, projects: n.projects.filter((p) => p.id !== proj.id), someday: [proj, ...n.someday] };
    if (decision === "close")
      n = { ...n, projects: n.projects.filter((p) => p.id !== proj.id), done: [{ ...proj, doneAt: ts() }, ...n.done] };
    upd(n);
  };
  const confirmComplete = (list, id, decision, nextAct) => {
    const item = items[list].find((i) => i.id === id);
    if (!item) return;
    const pid = item.projectId || "";
    let n = { ...items, [list]: items[list].filter((i) => i.id !== id), done: [{ ...item, doneAt: ts() }, ...items.done] };
    if (decision === "next" && nextAct) n = { ...n, next: [nextAct, ...n.next] };
    if (decision === "close" && pid) {
      const p = n.projects.find((p2) => p2.id === pid);
      if (p) n = { ...n, projects: n.projects.filter((x) => x.id !== pid), done: [{ ...p, doneAt: ts() }, ...n.done] };
    }
    if (decision === "waiting" && nextAct && pid) {
      const waitItem = { ...mk(nextAct.waitingFor), waitingFor: nextAct.waitingFor, projectId: pid };
      n = { ...n, waiting: [waitItem, ...n.waiting] };
    }
    if (decision === "someday" && pid) {
      const p = n.projects.find((p2) => p2.id === pid);
      if (p) n = { ...n, projects: n.projects.filter((x) => x.id !== pid), someday: [p, ...n.someday] };
      const dropIds = n.next.filter((a) => a.projectId === pid).map((a) => a.id);
      n = {
        ...n,
        next: n.next.filter((a) => a.projectId !== pid),
        tombstones: { ...n.tombstones, ...Object.fromEntries(dropIds.map((x) => [x, Date.now()])) }
      };
    }
    upd(n);
    setComplCand(null);
  };
  const renderChat = (compact) => /* @__PURE__ */ React.createElement(
    ChatView,
    {
      compact,
      agent,
      model: aiModel,
      onModel: pickModel,
      items,
      todayISO: isoDate(/* @__PURE__ */ new Date()),
      onApply: applyAi,
      onSaveContext: (text) => upd({ ...itemsRef.current, agentContext: text })
    }
  );
  const renderReview = (onGoto) => {
    const at = items._reviewedAt || 0;
    return /* @__PURE__ */ React.createElement(
      WeeklyReview,
      {
        items,
        todayISO: isoDate(/* @__PURE__ */ new Date()),
        reviewedAt: at,
        daysSinceReview: at ? Math.floor((Date.now() - at) / 864e5) : null,
        reviewDay: items._reviewDay == null ? 6 : items._reviewDay,
        onSetReviewDay: (d) => upd({ ...items, _reviewDay: d }),
        onComplete: () => upd({ ...items, _reviewedAt: Date.now() }),
        onGoto,
        ai: aiOn ? { ...aiPanel("review"), onRun: (facts) => runAi("review", facts) } : null
      }
    );
  };
  const [deskFloat, setDeskFloat] = useState(false);
  React.useEffect(() => {
    if (window.GTDDesktop) window.GTDDesktop.onMode((m) => setDeskFloat(m === "float"));
  }, []);
  const showMain = () => {
    if (window.GTDDesktop) window.GTDDesktop.expand();
    window.focus();
  };
  const renderFloat = () => {
    const today = isoDate(/* @__PURE__ */ new Date());
    const pm = projIndex(items);
    return /* @__PURE__ */ React.createElement(
      FloatToday,
      {
        items,
        todayISO: today,
        pnameOf: (i) => i && i.projectId && pm.get(i.projectId) || null,
        onComplete: (list, it) => confirmComplete(list, it.id, "later", null),
        onToggleFocus: toggleFocus,
        canUndo: history.length > 0,
        onUndo: undo,
        onOpen: (v) => {
          setActive(v);
          setCtx("all");
          setShowForm(false);
          showMain();
        },
        onCapture: captureThought,
        onStartPomo: canStartPomo ? startPomo : null,
        pomoBar: renderPomoBar(null),
        updateReady,
        onReload: () => window.location.reload(),
        inbox: {
          next: (it, title) => move("inbox", it.id, "next", { title, context: "@anywhere" }),
          start: canStartPomo ? (it, title) => {
            move("inbox", it.id, "next", { title, context: "@anywhere" });
            startPomo({ id: it.id, title });
          } : null,
          to: (it, list, patch) => move("inbox", it.id, list, patch),
          trash: (it) => del("inbox", it.id),
          more: (it) => {
            setProcItem(it);
            showMain();
          },
          sort: aiOn ? () => agent.send(AGENT_SORT_INBOX) : null
        },
        renderView: (v, onGoto) => v === "chat" ? renderChat(true) : v === "review" ? renderReview(onGoto) : v === "calendar" ? /* @__PURE__ */ React.createElement(
          CalendarView,
          {
            compact: true,
            items,
            pnameOf: (i) => i && i.projectId && pm.get(i.projectId) || null,
            onComplete: (list, it) => confirmComplete(list, it.id, "later", null),
            onEdit: (list, item) => {
              setEditCand({ list, item });
              showMain();
            },
            onGoto
          }
        ) : null,
        onClose: showMain
      }
    );
  };
  const captureRef = React.useRef(null);
  React.useEffect(() => {
    if (!LAUNCH.focusCapture) return;
    const t = setTimeout(() => {
      try {
        captureRef.current && captureRef.current.focus();
      } catch (e) {
      }
    }, 60);
    return () => clearTimeout(t);
  }, []);
  if (!items) return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#64748b", fontSize: 14 } }, "Loading…");
  if (deskFloat) return renderFloat();
  const raw = items[active] || [];
  const shown = active === "next" ? raw.filter((i) => (ctx === "all" || i.context === ctx) && (enerF === "all" || i.energy === enerF) && (timeF === "all" || i.time === timeF)) : raw;
  const counts = Object.fromEntries(LISTS.map((l) => [l, (items[l] || []).length]));
  const todayStart = /* @__PURE__ */ new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayDone = (items.done || []).filter((i) => new Date(i.doneAt || i.created) >= todayStart).length;
  const plannedCount = DATED.reduce((n, l) => n + (items[l] || []).filter((i) => i.dueDate).length, 0);
  const todayISO = isoDate(/* @__PURE__ */ new Date());
  const canDefer = active === "next" || active === "waiting";
  const liveShown = canDefer ? shown.filter((i) => !isDeferred(i, todayISO)) : shown;
  const deferredShown = canDefer ? shown.filter((i) => isDeferred(i, todayISO)).sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  const todayList = todayRows(items, todayISO);
  const todayFocus = { count: todayList.length, overdue: todayList.some((r) => r._kind === "overdue") };
  const pmap = projIndex(items);
  const pnameOf = (i) => i && i.projectId && pmap.get(i.projectId) || null;
  const ctxs = items.contexts && items.contexts.length ? items.contexts : CONTEXTS;
  const projActions = {};
  const projWaiting = {};
  (items.next || []).forEach((a) => {
    if (a.projectId) (projActions[a.projectId] = projActions[a.projectId] || []).push(a);
  });
  (items.waiting || []).forEach((a) => {
    if (a.projectId) (projWaiting[a.projectId] = projWaiting[a.projectId] || []).push(a);
  });
  const reviewedAt = items._reviewedAt || 0;
  const reviewDay = items._reviewDay == null ? 6 : items._reviewDay;
  const daysSinceReview = reviewedAt ? Math.floor((Date.now() - reviewedAt) / 864e5) : null;
  const reviewWindowStart = (() => {
    const d = /* @__PURE__ */ new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (d.getDay() - reviewDay + 7) % 7);
    return d.getTime();
  })();
  const reviewDue = reviewedAt < reviewWindowStart;
  const odReady = Drive.available();
  const odOn = odReady && Drive.enabled() && !!odAccount;
  const syncLabel = !odReady ? null : !odOn ? "☁ Connect OneDrive" : syncing ? "☁ Syncing…" : typeof navigator !== "undefined" && navigator.onLine === false ? "☁ Offline" : lastSyncRef.current ? `☁ Synced ${relTime(lastSyncRef.current)}` : "☁ Connected";
  return /* @__PURE__ */ React.createElement("div", { className: "app-shell", style: { fontFamily: "'Inter',system-ui,sans-serif", background: "#f1f5f9", color: "#1e293b" } }, /* @__PURE__ */ React.createElement("div", { className: "nav-backdrop" + (navOpen ? " show" : ""), onClick: () => setNavOpen(false) }), /* @__PURE__ */ React.createElement("aside", { className: "app-sidebar" + (navOpen ? " open" : "") }, /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 16px 12px", borderBottom: "1px solid rgba(255,255,255,.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 15, color: "#f1f5f9", letterSpacing: "-.3px" } }, "GTD System"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#475569", marginTop: 2 } }, "David Allen methodology")), /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 5 } }, "Quick Capture"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: captureRef,
      value: capture,
      onChange: (e) => setCapture(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && quickCapture(),
      placeholder: "Capture a thought…",
      style: { flex: 1, padding: "6px 8px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 6, color: "#f1f5f9", fontSize: 11, outline: "none" }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: quickCapture,
      style: { padding: "6px 9px", background: "#6366f1", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14, lineHeight: 1 }
    },
    "+"
  ))), /* @__PURE__ */ React.createElement("nav", { style: { flex: 1, padding: "6px 8px" } }, NAV.filter((l) => l !== "chat" || aiOn).map((l) => {
    const m = META[l], on = active === l;
    const reviewPill = l === "review" && reviewDue;
    const badge = l === "done" ? todayDone : l === "calendar" ? plannedCount : l === "today" ? todayFocus.count : l === "review" || l === "chat" ? 0 : counts[l];
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: l,
        onClick: () => {
          setActive(l);
          setCtx("all");
          setShowForm(false);
          setNavOpen(false);
        },
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 10px", background: on ? "rgba(99,102,241,.18)" : "transparent", border: "none", borderRadius: 7, cursor: "pointer", color: on ? "#a5b4fc" : "#64748b", fontSize: 12, fontWeight: on ? 600 : 400, textAlign: "left", marginBottom: 1 }
      },
      /* @__PURE__ */ React.createElement("span", null, m.icon, " ", m.label),
      reviewPill ? /* @__PURE__ */ React.createElement("span", { style: { background: "#f59e0b", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 20, fontWeight: 700 } }, "due") : badge > 0 && /* @__PURE__ */ React.createElement("span", { style: { background: l === "inbox" ? "#ef4444" : l === "done" ? "#10b981" : l === "calendar" ? "#6366f1" : l === "today" ? todayFocus.overdue ? "#ef4444" : "#6366f1" : "#1e293b", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 20, fontWeight: 700 } }, badge)
    );
  })), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,.06)" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setShowData(true);
        setNavOpen(false);
      },
      style: { display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "transparent", border: "1px solid rgba(255,255,255,.1)", borderRadius: 7, color: "#64748b", cursor: "pointer", fontSize: 11, fontWeight: 600, textAlign: "left" },
      onMouseEnter: (e) => e.currentTarget.style.color = "#a5b4fc",
      onMouseLeave: (e) => e.currentTarget.style.color = "#64748b"
    },
    "⇅ Sync & Backup"
  ), syncLabel && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowData(true),
      style: { display: "block", width: "100%", marginTop: 5, padding: "0 2px", background: "none", border: "none", color: odOn ? "#475569" : "#6366f1", cursor: "pointer", fontSize: 10, textAlign: "left" }
    },
    syncLabel
  )), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 16px", borderTop: "1px solid rgba(255,255,255,.04)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#1e293b" } }, "Capture → Clarify → Organize → Reflect → Engage"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#475569", marginTop: 3 } }, "GTD ", APP_VERSION))), /* @__PURE__ */ React.createElement("div", { className: "app-main" }, /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 22px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "nav-toggle",
      onClick: () => setNavOpen(true),
      title: "Menu",
      "aria-label": "Open menu",
      style: { width: 38, height: 38, flexShrink: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, cursor: "pointer", fontSize: 17, color: "#475569", lineHeight: 1 }
    },
    "☰"
  ), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 17, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, META[active].icon, " ", META[active].label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, META[active].hint))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } }, history.length > 0 && /* @__PURE__ */ React.createElement("button", { onClick: undo, title: "Undo (Ctrl+Z)", className: "btn btn-ghost btn-sm" }, "↩ Undo"), canStartPomo && active !== "today" && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => startPomo({ id: null, title: active === "next" && ctx !== "all" ? `Batch ${ctx}` : META[active].label }),
      title: "Start a pomodoro on this view — clear the Inbox, run the review, or batch small actions in one context",
      "aria-label": "Start a pomodoro on this view",
      className: "btn btn-ghost btn-sm"
    },
    "🍅"
  ), window.GTDDesktop && /* @__PURE__ */ React.createElement("button", { onClick: window.GTDDesktop.float, title: "Shrink to a floating, always-on-top window", className: "btn btn-ghost btn-sm" }, "⤢ Float"), active !== "done" && active !== "calendar" && active !== "today" && active !== "review" && active !== "chat" && /* @__PURE__ */ React.createElement("button", { onClick: () => setShowForm((s) => !s), className: "btn btn-pri btn-sm" }, showForm ? "Cancel" : "+ Add"))), renderPomoBar(captureThought), active === "next" && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 22px", background: "#fff", borderBottom: "1px solid var(--line)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", flexShrink: 0 } }, ["all", ...ctxs].map((c) => /* @__PURE__ */ React.createElement("button", { key: c, onClick: () => setCtx(c), className: "chip" + (ctx === c ? " on" : "") }, c === "all" ? "All" : c)), /* @__PURE__ */ React.createElement("span", { style: { width: 1, height: 18, background: "var(--line)", margin: "0 3px" } }), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: enerF,
      onChange: (e) => setEnerF(e.target.value),
      title: "Filter by energy available",
      className: "chip" + (enerF !== "all" ? " on" : ""),
      style: { padding: "3px 8px" }
    },
    /* @__PURE__ */ React.createElement("option", { value: "all" }, "🔋 Any energy"),
    ENERGIES.map((e) => /* @__PURE__ */ React.createElement("option", { key: e, value: e }, "🔋 ", e))
  ), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: timeF,
      onChange: (e) => setTimeF(e.target.value),
      title: "Filter by time available",
      className: "chip" + (timeF !== "all" ? " on" : ""),
      style: { padding: "3px 8px" }
    },
    /* @__PURE__ */ React.createElement("option", { value: "all" }, "⏱ Any time"),
    TIMES.map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t }, "⏱ ", t))
  )), showForm && active !== "done" && /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 22px", background: "var(--bg-form)", borderBottom: "1px solid var(--line)", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      className: "in",
      style: { flex: 1 },
      value: form.title,
      onChange: (e) => setForm({ ...form, title: e.target.value }),
      onKeyDown: (e) => e.key === "Enter" && addItem(),
      placeholder: placeFor(active)
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "btn btn-pri", onClick: addItem }, "Add")), ["next", "projects", "waiting"].includes(active) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 9 } }, active === "next" && /* @__PURE__ */ React.createElement("label", { className: "fld" }, /* @__PURE__ */ React.createElement("span", null, "Context"), /* @__PURE__ */ React.createElement("select", { className: "in in-sm", value: form.context, onChange: (e) => setForm({ ...form, context: e.target.value }) }, ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c)))), active === "waiting" && /* @__PURE__ */ React.createElement("label", { className: "fld", style: { flex: "1 1 160px" } }, /* @__PURE__ */ React.createElement("span", null, "From whom"), /* @__PURE__ */ React.createElement("input", { className: "in in-sm", value: form.waitingFor, onChange: (e) => setForm({ ...form, waitingFor: e.target.value }), placeholder: "Person / source" })), active === "next" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "fld" }, /* @__PURE__ */ React.createElement("span", null, "Energy"), /* @__PURE__ */ React.createElement("select", { className: "in in-sm", value: form.energy, onChange: (e) => setForm({ ...form, energy: e.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "—"), ENERGIES.map((en) => /* @__PURE__ */ React.createElement("option", { key: en, value: en }, en)))), /* @__PURE__ */ React.createElement("label", { className: "fld" }, /* @__PURE__ */ React.createElement("span", null, "Time"), /* @__PURE__ */ React.createElement("select", { className: "in in-sm", value: form.time, onChange: (e) => setForm({ ...form, time: e.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "—"), TIMES.map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t }, t))))), /* @__PURE__ */ React.createElement("label", { className: "fld" }, /* @__PURE__ */ React.createElement("span", null, "Start"), /* @__PURE__ */ React.createElement("input", { className: "in in-sm", type: "date", value: form.startDate, onChange: (e) => setForm({ ...form, startDate: e.target.value }) })), /* @__PURE__ */ React.createElement("label", { className: "fld" }, /* @__PURE__ */ React.createElement("span", null, "Due"), /* @__PURE__ */ React.createElement("input", { className: "in in-sm", type: "date", value: form.dueDate, onChange: (e) => setForm({ ...form, dueDate: e.target.value, dueTime: e.target.value ? form.dueTime : "" }) })), form.dueDate && /* @__PURE__ */ React.createElement("label", { className: "fld", title: "Optional — set a time only for a real appointment" }, /* @__PURE__ */ React.createElement("span", null, "Time"), /* @__PURE__ */ React.createElement("input", { className: "in in-sm", type: "time", value: form.dueTime, onChange: (e) => setForm({ ...form, dueTime: e.target.value }) })))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "14px 22px" } }, active === "today" ? /* @__PURE__ */ React.createElement(
    TodayView,
    {
      items,
      todayISO,
      pnameOf,
      reviewDue,
      daysSinceReview,
      onComplete: (list, item) => setComplCand({ list, item }),
      onToggleFocus: toggleFocus,
      onStartPomo: canStartPomo ? startPomo : null,
      onEdit: (list, item) => setEditCand({ list, item }),
      onGoto: (list) => {
        setActive(list);
        setCtx("all");
        setNavOpen(false);
      }
    }
  ) : active === "calendar" ? /* @__PURE__ */ React.createElement(
    CalendarView,
    {
      items,
      pnameOf,
      onComplete: (list, item) => setComplCand({ list, item }),
      onEdit: (list, item) => setEditCand({ list, item }),
      onGoto: (list) => {
        setActive(list);
        setCtx("all");
        setNavOpen(false);
      }
    }
  ) : active === "chat" ? renderChat(false) : active === "review" ? renderReview((list) => {
    setActive(list);
    setCtx("all");
    setNavOpen(false);
  }) : active === "projects" ? shown.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { list: "projects" }) : shown.map((p) => /* @__PURE__ */ React.createElement(
    ProjCard,
    {
      key: p.id,
      proj: p,
      actions: projActions[p.id] || [],
      waiting: projWaiting[p.id] || [],
      ctxs,
      onDelete: () => del("projects", p.id),
      onEdit: () => setEditCand({ list: "projects", item: p }),
      onCompleteAction: (l, id) => setComplCand({ list: l, item: (items[l] || []).find((i) => i.id === id) }),
      onDeleteAction: (l, id) => del(l, id),
      onStalledDecision: handleStalledDecision,
      onAiBreakdown: aiOn ? (pr) => runAi("breakdown", pr) : null
    }
  )) : active === "done" ? /* @__PURE__ */ React.createElement(DoneView, { items: shown, pnameOf, archiveCount: archive.length, move, del }) : active === "inbox" ? shown.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { list: "inbox" }) : /* @__PURE__ */ React.createElement(
    InboxFocus,
    {
      item: shown[shown.length - 1],
      total: shown.length,
      onProcess: () => setProcItem(shown[shown.length - 1]),
      onSort: aiOn ? () => {
        agent.send(AGENT_SORT_INBOX);
        setActive("chat");
      } : null
    }
  ) : liveShown.length === 0 && deferredShown.length === 0 ? /* @__PURE__ */ React.createElement(EmptyState, { list: active, ctx }) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, liveShown.map((item) => /* @__PURE__ */ React.createElement(
    ItemCard,
    {
      key: item.id,
      item,
      list: active,
      pname: pnameOf(item),
      onComplete: () => setComplCand({ list: active, item }),
      onDelete: () => del(active, item.id),
      onProcess: null,
      onRestore: active === "done" ? () => move("done", item.id, "next", { doneAt: void 0 }) : null,
      onMove: ["next", "waiting", "someday", "projects", "reference"].includes(active) ? (to) => upd({ ...items, [active]: items[active].filter((i) => i.id !== item.id), [to]: [item, ...items[to] || []] }) : null,
      onPromote: active === "next" ? () => setPromoteCand(item) : null,
      onEdit: ["next", "waiting", "someday", "reference"].includes(active) ? () => setEditCand({ list: active, item }) : null,
      onToggleFocus: active === "next" ? () => toggleFocus(item.id) : null,
      focused: active === "next" && item.focusDate === todayISO,
      onStartPomo: active === "next" && canStartPomo ? () => startPomo(item) : null,
      currentList: active
    }
  )), deferredShown.length > 0 && /* @__PURE__ */ React.createElement(DeferredSection, { count: deferredShown.length }, deferredShown.map((item) => /* @__PURE__ */ React.createElement(
    ItemCard,
    {
      key: item.id,
      item,
      list: active,
      pname: pnameOf(item),
      onComplete: () => setComplCand({ list: active, item }),
      onDelete: () => del(active, item.id),
      onProcess: null,
      onRestore: null,
      onMove: (to) => upd({ ...items, [active]: items[active].filter((i) => i.id !== item.id), [to]: [item, ...items[to] || []] }),
      onPromote: active === "next" ? () => setPromoteCand(item) : null,
      onEdit: () => setEditCand({ list: active, item }),
      onToggleFocus: null,
      focused: false,
      currentList: active
    }
  )))))), /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: fileInputRef,
      type: "file",
      accept: "application/json,.json",
      onChange: onImportFile,
      style: { display: "none" }
    }
  ), showData && /* @__PURE__ */ React.createElement(
    DataModal,
    {
      counts,
      archiveCount: archive.length,
      pomoConfig: items.pomoConfig,
      onPomoConfig: (c) => upd({ ...itemsRef.current, pomoConfig: c }),
      contexts: ctxs,
      onAddContext: (c) => {
        let x = (c || "").trim();
        if (!x) return;
        if (!x.startsWith("@")) x = "@" + x;
        if (items.contexts.some((e) => e.toLowerCase() === x.toLowerCase())) return;
        upd({ ...items, contexts: [...items.contexts, x] });
      },
      onDelContext: (c) => {
        if (c === "@anywhere") return;
        upd({ ...items, contexts: items.contexts.filter((x) => x !== c) });
      },
      onExport: () => exportData({ ...items, archive }),
      onImport: triggerImport,
      cloud: {
        ready: odReady,
        configured: !!MS_CLIENT_ID,
        account: odAccount,
        syncing,
        lastSynced: lastSyncRef.current,
        onConnect: connectDrive,
        onDisconnect: disconnectDrive,
        onSyncNow: syncNow
      },
      ai: {
        hasKey: aiOn,
        masked: Ai.masked(),
        model: aiModel,
        onModel: pickModel,
        online: aiOnline,
        test: aiTest,
        onSave: saveAiKey,
        onClear: () => saveAiKey(""),
        onTest: testAiKey
      },
      onClose: () => setShowData(false)
    }
  ), complCand && complCand.item && /* @__PURE__ */ React.createElement(
    CompleteModal,
    {
      item: complCand.item,
      list: complCand.list,
      pname: pnameOf(complCand.item),
      ctxs,
      onConfirm: (d, a) => confirmComplete(complCand.list, complCand.item.id, d, a),
      onClose: () => setComplCand(null)
    }
  ), promoteCand && /* @__PURE__ */ React.createElement(
    PromoteModal,
    {
      item: promoteCand,
      onConfirm: (outcome) => {
        const proj = { ...mk(outcome), dueDate: promoteCand.dueDate || "" };
        upd({
          ...items,
          next: items.next.map((a) => a.id === promoteCand.id ? { ...a, projectId: proj.id } : a),
          projects: [proj, ...items.projects]
        });
        setPromoteCand(null);
      },
      onClose: () => setPromoteCand(null)
    }
  ), editCand && /* @__PURE__ */ React.createElement(
    EditModal,
    {
      item: editCand.item,
      list: editCand.list,
      ctxs,
      projects: items.projects,
      onConfirm: (patch) => {
        applyEdit(editCand.list, editCand.item, patch);
        setEditCand(null);
      },
      onClose: () => setEditCand(null)
    }
  ), aiJob && aiJob.kind === "breakdown" && /* @__PURE__ */ React.createElement(
    AiModal,
    {
      title: "✨ Break down a project",
      subtitle: aiJob.target ? aiJob.target.title : "",
      ai: { ...aiPanel("breakdown"), onRun: () => runAi("breakdown", aiJob.target) }
    }
  ), procItem && /* @__PURE__ */ React.createElement(
    ProcessModal,
    {
      item: procItem,
      ctxs,
      ai: aiOn ? { ...aiPanel("clarify"), onRun: () => runAi("clarify", procItem) } : null,
      onMove: (to, patch) => move("inbox", procItem.id, to, patch),
      onMoveAsProject: (patch, first) => {
        const src = items.inbox.find((i) => i.id === procItem.id);
        if (!src) return;
        let n = { ...items, inbox: items.inbox.filter((i) => i.id !== procItem.id), projects: [{ ...src, ...patch }, ...items.projects] };
        if (first.type === "next") {
          const a = { ...mk(first.title), projectId: src.id, context: first.context, dueDate: first.dueDate, dueTime: first.dueTime || "", startDate: first.startDate };
          n = { ...n, next: [a, ...n.next] };
        } else {
          const w = { ...mk(first.waitingFor), waitingFor: first.waitingFor, projectId: src.id };
          n = { ...n, waiting: [w, ...n.waiting] };
        }
        upd(n);
        setProcItem(null);
      },
      onTrash: () => {
        del("inbox", procItem.id);
        setProcItem(null);
      },
      onClose: () => setProcItem(null)
    }
  ), updateReady && /* @__PURE__ */ React.createElement("div", { style: {
    position: "fixed",
    left: "50%",
    bottom: 18,
    transform: "translateX(-50%)",
    zIndex: 400,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    background: "#1e293b",
    color: "#f1f5f9",
    borderRadius: 10,
    boxShadow: "0 10px 30px rgba(0,0,0,.3)",
    fontSize: 12,
    maxWidth: "92vw"
  } }, /* @__PURE__ */ React.createElement("span", null, "🔄 A new version is ready."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => window.location.reload(),
      style: { padding: "5px 12px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700 }
    },
    "Reload"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setUpdateReady(false),
      title: "Dismiss",
      style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1, padding: "0 2px" }
    },
    "×"
  )));
}
function DoneView({ items, pnameOf, archiveCount, move, del }) {
  const [groupBy, setGroupBy] = useState("time");
  const archiveNote = archiveCount > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", padding: "10px 2px 0" } }, "🗄 ", archiveCount, " older item", archiveCount !== 1 ? "s" : "", " in the archive (rotated out after ", ARCHIVE_DAYS, " days — included in backup files).");
  if (items.length === 0) return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(EmptyState, { list: "done" }), archiveNote);
  const groups = groupBy === "time" ? doneByTime(items) : doneByProject(items, pnameOf);
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginBottom: 12 } }, [["time", "By date"], ["project", "By project"]].map(([g, lbl]) => /* @__PURE__ */ React.createElement("button", { key: g, onClick: () => setGroupBy(g), className: "chip" + (groupBy === g ? " on" : "") }, lbl))), groups.map((g) => /* @__PURE__ */ React.createElement(
    DoneGroup,
    {
      key: g.label,
      group: g,
      pnameOf,
      onRestore: (id) => move("done", id, "next", { doneAt: void 0 }),
      onDelete: (id) => del("done", id)
    }
  )), archiveNote);
}
function DoneGroup({ group, pnameOf, onRestore, onDelete }) {
  const [open, setOpen] = useState(group.defaultOpen);
  return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setOpen((o) => !o),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "7px 12px",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        marginBottom: open ? 6 : 0
      }
    },
    /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 11, fontWeight: 700, color: "#475569" } }, group.label),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#94a3b8" } }, group.items.length, " item", group.items.length !== 1 ? "s" : ""),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#94a3b8", display: "inline-block", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" } }, "▼")
  ), open && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5, paddingLeft: 4 } }, group.items.map((item) => /* @__PURE__ */ React.createElement(
    ItemCard,
    {
      key: item.id,
      item,
      list: "done",
      pname: pnameOf ? pnameOf(item) : null,
      onRestore: () => onRestore(item.id),
      onDelete: () => onDelete(item.id)
    }
  ))));
}
function ProjCard({ proj, actions, waiting, ctxs, onDelete, onEdit, onCompleteAction, onDeleteAction, onStalledDecision, onAiBreakdown }) {
  const [open, setOpen] = useState(false);
  const [stalledPhase, setStalledPhase] = useState(null);
  const [naTitle, setNaTitle] = useState("");
  const [naCtx, setNaCtx] = useState("@anywhere");
  const [naDue, setNaDue] = useState("");
  const [waitTxt, setWaitTxt] = useState("");
  const stalled = actions.length === 0 && waiting.length === 0;
  const delegated = actions.length === 0 && waiting.length > 0;
  const resetStalled = () => {
    setStalledPhase(null);
    setNaTitle("");
    setNaDue("");
    setWaitTxt("");
  };
  return /* @__PURE__ */ React.createElement("div", { style: { border: `1px solid ${stalled ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 10, overflow: "hidden", marginBottom: 8, background: "#fff" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setOpen((o) => !o),
      style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: stalled ? "#fffbeb" : "#f8fafc", cursor: "pointer", gap: 10 }
    },
    /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 7 } }, "📋 ", proj.title, stalled && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, background: "#fef9c3", color: "#92400e", padding: "1px 7px", borderRadius: 20, fontWeight: 700 } }, "⚠️ stalled"), delegated && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, background: "#eff6ff", color: "#1e40af", padding: "1px 7px", borderRadius: 20, fontWeight: 700 } }, "⏳ waiting")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginTop: 2 } }, actions.length, " active action", actions.length !== 1 ? "s" : "", waiting.length ? ` · ${waiting.length} waiting` : "", proj.dueDate ? ` · 📅 ${proj.dueDate}` : "")),
    onAiBreakdown && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          onAiBreakdown(proj);
        },
        title: "Ask Claude for the next action",
        className: "ibtn",
        style: { fontSize: 13 }
      },
      "✨"
    ),
    onEdit && /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
      e.stopPropagation();
      onEdit();
    }, title: "Edit", className: "ibtn", style: { fontSize: 13 } }, "✎"),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#94a3b8", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" } }, "▼")
  ), open && /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 14px", borderTop: "1px solid #e2e8f0" } }, stalled ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#92400e", background: "#fffbeb", padding: "7px 10px", borderRadius: 7, marginBottom: 10 } }, "No active next action — how do you want to handle this project?"), stalledPhase === null && /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setStalledPhase("define"),
      style: { padding: "9px 10px", background: "#f5f3ff", border: "1.5px solid #6366f1", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#4338ca", textAlign: "left" }
    },
    "⚡ Define next action",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#6366f1", marginTop: 1 } }, "Keep it moving")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        onStalledDecision("close", proj, null);
      },
      style: { padding: "9px 10px", background: "#f0fdf4", border: "1.5px solid #10b981", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#065f46", textAlign: "left" }
    },
    "🎉 Mark complete",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#10b981", marginTop: 1 } }, "Outcome achieved")
  ), onAiBreakdown && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onAiBreakdown(proj),
      style: { padding: "9px 10px", background: "#faf5ff", border: "1.5px solid #c4b5fd", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#5b21b6", textAlign: "left" }
    },
    "✨ Ask Claude",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#8b5cf6", marginTop: 1 } }, "Name the very next action")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setStalledPhase("waiting"),
      style: { padding: "9px 10px", background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#1e40af", textAlign: "left" }
    },
    "⏳ Waiting for…",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#3b82f6", marginTop: 1 } }, "Ball is in someone else's court")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        onStalledDecision("someday", proj, null);
      },
      style: { padding: "9px 10px", background: "#f8fafc", border: "1.5px solid #94a3b8", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#475569", textAlign: "left" }
    },
    "💤 Someday/Maybe",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#64748b", marginTop: 1 } }, "Not a priority now")
  )), stalledPhase === "define" && /* @__PURE__ */ React.createElement("div", { style: { background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 12px", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "#4338ca", marginBottom: 6 } }, "Next action for ", /* @__PURE__ */ React.createElement("em", null, proj.title)), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: naTitle,
      onChange: (e) => setNaTitle(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && naTitle.trim()) {
          onStalledDecision("next", proj, { title: naTitle.trim(), context: naCtx, dueDate: naDue });
          resetStalled();
        }
      },
      placeholder: "What is the very next physical action?",
      style: { width: "100%", padding: "7px 9px", border: "1px solid #c4b5fd", borderRadius: 7, fontSize: 12, outline: "none", marginBottom: 6 }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 } }, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: naCtx,
      onChange: (e) => setNaCtx(e.target.value),
      style: { padding: "6px 8px", border: "1px solid #c4b5fd", borderRadius: 7, fontSize: 11, background: "#fff" }
    },
    ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c))
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: naDue,
      onChange: (e) => setNaDue(e.target.value),
      style: { padding: "6px 8px", border: "1px solid #c4b5fd", borderRadius: 7, fontSize: 11 }
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (naTitle.trim()) {
          onStalledDecision("next", proj, { title: naTitle.trim(), context: naCtx, dueDate: naDue });
          resetStalled();
        }
      },
      disabled: !naTitle.trim(),
      style: { flex: 1, padding: "7px", background: naTitle.trim() ? "#6366f1" : "#e2e8f0", color: naTitle.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: 7, cursor: naTitle.trim() ? "pointer" : "default", fontSize: 12, fontWeight: 600 }
    },
    "✓ Add action"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: resetStalled,
      style: { padding: "7px 12px", background: "transparent", border: "1px solid #ddd6fe", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#6366f1" }
    },
    "Cancel"
  ))), stalledPhase === "waiting" && /* @__PURE__ */ React.createElement("div", { style: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "#1e40af", marginBottom: 6 } }, "What are you waiting for?"), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: waitTxt,
      onChange: (e) => setWaitTxt(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && waitTxt.trim()) {
          onStalledDecision("waiting", proj, { waitingFor: waitTxt.trim() });
          resetStalled();
        }
      },
      placeholder: "e.g. John's approval on the proposal",
      style: { width: "100%", padding: "7px 9px", border: "1px solid #93c5fd", borderRadius: 7, fontSize: 12, outline: "none", marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (waitTxt.trim()) {
          onStalledDecision("waiting", proj, { waitingFor: waitTxt.trim() });
          resetStalled();
        }
      },
      disabled: !waitTxt.trim(),
      style: { flex: 1, padding: "7px", background: waitTxt.trim() ? "#3b82f6" : "#e2e8f0", color: waitTxt.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: 7, cursor: waitTxt.trim() ? "pointer" : "default", fontSize: 12, fontWeight: 600 }
    },
    "⏳ Add to Waiting For"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: resetStalled,
      style: { padding: "7px 12px", background: "transparent", border: "1px solid #bfdbfe", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#3b82f6" }
    },
    "Cancel"
  )))) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5 } }, actions.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, style: { display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 8px", background: "#f8fafc", borderRadius: 7, border: "1px solid #e2e8f0" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onCompleteAction("next", a.id),
      style: { width: 17, height: 17, borderRadius: "50%", border: "2px solid #cbd5e1", background: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 1 },
      onMouseEnter: (e) => e.target.style.borderColor = "#6366f1",
      onMouseLeave: (e) => e.target.style.borderColor = "#cbd5e1"
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 500, wordBreak: "break-word" } }, a.title), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" } }, a.context && a.context !== "@anywhere" && /* @__PURE__ */ React.createElement(Tag, { bg: "#ede9fe", c: "#5b21b6" }, a.context), a.dueDate && /* @__PURE__ */ React.createElement(Tag, { bg: isOver(a.dueDate) ? "#fef2f2" : "#f0fdf4", c: isOver(a.dueDate) ? "#b91c1c" : "#166534" }, isOver(a.dueDate) ? "⚠️ " : "📅 ", dueLabel(a.dueDate, a.dueTime)))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onDeleteAction("next", a.id),
      style: { background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", fontSize: 15, lineHeight: 1 },
      onMouseEnter: (e) => e.target.style.color = "#ef4444",
      onMouseLeave: (e) => e.target.style.color = "#cbd5e1"
    },
    "×"
  ))), waiting.map((w) => /* @__PURE__ */ React.createElement("div", { key: w.id, style: { display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 8px", background: "#fffbeb", borderRadius: 7, border: "1px solid #fde68a" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onCompleteAction("waiting", w.id),
      title: "Received / resolved",
      style: { width: 17, height: 17, borderRadius: "50%", border: "2px solid #fcd34d", background: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 1 },
      onMouseEnter: (e) => e.target.style.borderColor = "#f59e0b",
      onMouseLeave: (e) => e.target.style.borderColor = "#fcd34d"
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 500, wordBreak: "break-word" } }, "⏳ ", w.title), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" } }, w.waitingFor && /* @__PURE__ */ React.createElement(Tag, { bg: "#fffbeb", c: "#b45309" }, "👤 ", w.waitingFor), w.dueDate && /* @__PURE__ */ React.createElement(Tag, { bg: isOver(w.dueDate) ? "#fef2f2" : "#f0fdf4", c: isOver(w.dueDate) ? "#b91c1c" : "#166534" }, isOver(w.dueDate) ? "⚠️ " : "📅 ", dueLabel(w.dueDate, w.dueTime)))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onDeleteAction("waiting", w.id),
      style: { background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", fontSize: 15, lineHeight: 1 },
      onMouseEnter: (e) => e.target.style.color = "#ef4444",
      onMouseLeave: (e) => e.target.style.color = "#cbd5e1"
    },
    "×"
  )))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onDelete,
      style: { marginTop: 10, width: "100%", padding: "6px", background: "transparent", border: "1px dashed #fca5a5", borderRadius: 7, cursor: "pointer", fontSize: 11, color: "#ef4444" }
    },
    "Remove project"
  )));
}
function DeferredSection({ count, children }) {
  const [open, setOpen] = useState(false);
  return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, border: "1px dashed #cbd5e1", borderRadius: 9, background: "#fafafa" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setOpen((o) => !o),
      style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#64748b" }
    },
    /* @__PURE__ */ React.createElement("span", null, "⏳ Scheduled to start later · ", count),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9 } }, open ? "▲" : "▼")
  ), open && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "0 10px 10px" } }, children));
}
function ItemCard({ item, list, pname, onComplete, onDelete, onProcess, onRestore, onMove, onPromote, onToggleFocus, onStartPomo, onEdit, focused, currentList }) {
  const [menuPos, setMenuPos] = useState(null);
  const moveRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const showMove = !!menuPos;
  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    const below = window.innerHeight - r.bottom;
    if (below < 220) setMenuPos({ bottom: window.innerHeight - r.top + 4, right });
    else setMenuPos({ top: r.bottom + 4, right });
  };
  useEffect(() => {
    if (!showMove) return;
    const close = (e) => {
      if (moveRef.current && moveRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenuPos(null);
    };
    const dismiss = () => setMenuPos(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [showMove]);
  const ov = isOver(item.dueDate) && list !== "done";
  const displayTitle = item.title;
  const MOVE_TARGETS = { next: ["waiting", "someday", "reference"], waiting: ["next", "someday"], someday: ["next", "waiting", "projects"], projects: ["next", "waiting", "someday"], reference: ["next", "someday"] };
  const targets = onMove ? MOVE_TARGETS[currentList] || [] : [];
  const targetLabel = { next: "Next Actions", waiting: "Waiting For", someday: "Someday/Maybe", projects: "Projects", reference: "Reference" };
  return /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", borderRadius: 9, padding: "11px 14px", border: `1px solid ${ov ? "#fca5a5" : "#e2e8f0"}`, display: "flex", alignItems: "flex-start", gap: 10, opacity: list === "done" ? 0.55 : 1, position: "relative" } }, list !== "inbox" && list !== "done" && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onComplete,
      style: { width: 18, height: 18, borderRadius: "50%", border: "2px solid #cbd5e1", background: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 2 },
      onMouseEnter: (e) => e.target.style.borderColor = "#6366f1",
      onMouseLeave: (e) => e.target.style.borderColor = "#cbd5e1"
    }
  ), list === "inbox" && /* @__PURE__ */ React.createElement("div", { style: { width: 18, flexShrink: 0 } }), list === "done" && /* @__PURE__ */ React.createElement("div", { style: { width: 18, height: 18, borderRadius: "50%", background: "#6366f1", flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#fff", fontSize: 9 } }, "✓")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, pname && list !== "projects" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#7c3aed", fontWeight: 600, marginBottom: 2 } }, "📋 ", pname), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 500, textDecoration: list === "done" ? "line-through" : "none", color: list === "done" ? "#94a3b8" : "#1e293b", wordBreak: "break-word" } }, displayTitle), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(ItemTags, { item, ov }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4, flexShrink: 0, alignItems: "center" } }, onStartPomo && /* @__PURE__ */ React.createElement("button", { onClick: onStartPomo, title: "Start a pomodoro", "aria-label": "Start a pomodoro", className: "ibtn", style: { fontSize: 13 } }, "🍅"), onProcess && /* @__PURE__ */ React.createElement("button", { onClick: onProcess, style: { padding: "3px 8px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 700 } }, "Process"), onRestore && /* @__PURE__ */ React.createElement("button", { onClick: onRestore, style: { padding: "3px 8px", background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 5, cursor: "pointer", fontSize: 10 } }, "Restore"), onToggleFocus && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onToggleFocus,
      title: focused ? "Remove from today's focus" : "Focus for today",
      style: { background: "none", border: "none", cursor: "pointer", color: focused ? "#f59e0b" : "#cbd5e1", fontSize: 15, lineHeight: 1, padding: "0 1px" }
    },
    focused ? "★" : "☆"
  ), onEdit && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onEdit,
      title: "Edit",
      style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13, lineHeight: 1, padding: "0 2px" },
      onMouseEnter: (e) => e.target.style.color = "#6366f1",
      onMouseLeave: (e) => e.target.style.color = "#94a3b8"
    },
    "✎"
  ), (targets.length > 0 || onPromote) && /* @__PURE__ */ React.createElement("div", { ref: moveRef, style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      ref: btnRef,
      onClick: () => showMove ? setMenuPos(null) : openMenu(),
      style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13, lineHeight: 1, padding: "0 2px" },
      title: "Move to…"
    },
    "⇄"
  ), showMove && ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement("div", { ref: menuRef, style: { position: "fixed", top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 300, minWidth: 160, overflow: "hidden" } }, targets.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", padding: "7px 12px 4px" } }, "Move to"), targets.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t,
        onClick: () => {
          onMove(t);
          setMenuPos(null);
        },
        style: { display: "block", width: "100%", padding: "7px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, textAlign: "left", color: "#1e293b" },
        onMouseEnter: (e) => e.currentTarget.style.background = "#f1f5f9",
        onMouseLeave: (e) => e.currentTarget.style.background = "none"
      },
      targetLabel[t]
    ))), onPromote && /* @__PURE__ */ React.createElement(React.Fragment, null, targets.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "#f1f5f9", margin: "3px 0" } }), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          onPromote();
          setMenuPos(null);
        },
        style: { display: "block", width: "100%", padding: "7px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, textAlign: "left", color: "#4338ca", fontWeight: 600 },
        onMouseEnter: (e) => e.currentTarget.style.background = "#f5f3ff",
        onMouseLeave: (e) => e.currentTarget.style.background = "none"
      },
      "📋 Make into project"
    ))),
    document.body
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onDelete,
      style: { background: "none", border: "none", cursor: "pointer", color: "#cbd5e1", fontSize: 16, lineHeight: 1 },
      onMouseEnter: (e) => e.target.style.color = "#ef4444",
      onMouseLeave: (e) => e.target.style.color = "#cbd5e1"
    },
    "×"
  )));
}
function TodayView({ items, todayISO, pnameOf, reviewDue, daysSinceReview, onComplete, onToggleFocus, onStartPomo, onGoto, onEdit }) {
  const dateLabel = (/* @__PURE__ */ new Date(todayISO + "T00:00")).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const [hideReview, setHideReview] = useState(false);
  const rows = todayRows(items, todayISO);
  const overdue = rows.filter((r) => r._kind === "overdue");
  const focus = rows.filter((r) => r._kind === "focus");
  const due = rows.filter((r) => r._kind === "due");
  const started = rows.filter((r) => r._kind === "started");
  const total = rows.length;
  const yesterday = isoDate((/* @__PURE__ */ new Date(todayISO + "T12:00")).getTime() - 864e5);
  const pomoToday = pomoTally(items, todayISO, todayISO), pomoYday = pomoTally(items, yesterday, yesterday);
  const Row = ({ i, ov }) => {
    const pname = pnameOf(i);
    const title = i.title;
    const foc = i._list === "next" && i.focusDate === todayISO;
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px", border: `1px solid ${ov ? "#fca5a5" : "#e2e8f0"}`, borderRadius: 9, background: ov ? "#fff7f7" : "#fff" } }, i._list !== "projects" ? /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onComplete(i._list, { ...i }),
        title: "Mark done",
        style: { width: 18, height: 18, borderRadius: "50%", border: "2px solid #cbd5e1", background: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 1 },
        onMouseEnter: (e) => e.target.style.borderColor = "#6366f1",
        onMouseLeave: (e) => e.target.style.borderColor = "#cbd5e1"
      }
    ) : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, flexShrink: 0, marginTop: 1 } }, "📋"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, pname && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#7c3aed", fontWeight: 600, marginBottom: 2 } }, "📋 ", pname), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 500, wordBreak: "break-word" } }, title), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement(Tag, { bg: "#eef2ff", c: "#4338ca" }, META[i._list].icon, " ", META[i._list].label), /* @__PURE__ */ React.createElement(ItemTags, { item: i, ov }))), i._list === "next" && onStartPomo && /* @__PURE__ */ React.createElement("button", { onClick: () => onStartPomo(i), title: "Start a pomodoro", "aria-label": "Start a pomodoro", className: "ibtn", style: { fontSize: 13, flexShrink: 0 } }, "🍅"), i._list === "next" && onToggleFocus && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onToggleFocus(i.id),
        title: foc ? "Remove from today's focus" : "Focus for today",
        style: { background: "none", border: "none", cursor: "pointer", color: foc ? "#f59e0b" : "#cbd5e1", fontSize: 15, lineHeight: 1, padding: "0 1px", flexShrink: 0 }
      },
      foc ? "★" : "☆"
    ), onEdit && i._list !== "projects" && /* @__PURE__ */ React.createElement("button", { onClick: () => onEdit(i._list, i), title: "Edit", className: "ibtn", style: { fontSize: 13, flexShrink: 0 } }, "✎"), /* @__PURE__ */ React.createElement("button", { onClick: () => onGoto(i._list), title: "Open " + META[i._list].label, className: "ibtn", style: { fontSize: 14, flexShrink: 0 } }, "↗"));
  };
  const Section = ({ label, list, ov }) => list.length === 0 ? null : /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 7 } }, label, " ", /* @__PURE__ */ React.createElement("span", { style: { color: "#cbd5e1" } }, "· ", list.length)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, list.map((i) => /* @__PURE__ */ React.createElement(Row, { key: i.id, i, ov: ov || i.dueDate && i.dueDate < todayISO }))));
  return /* @__PURE__ */ React.createElement("div", null, reviewDue && !hideReview && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", marginBottom: 14, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18, flexShrink: 0 } }, "🔄"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: "#92400e" } }, "Time for your Weekly Review"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#b45309", marginTop: 1 } }, daysSinceReview === null ? "You haven't run one yet — it's the habit that keeps GTD trustworthy." : `It's been ${daysSinceReview} days. A quick pass keeps your system trustworthy.`)), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onGoto("review"),
      style: { flexShrink: 0, padding: "6px 12px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }
    },
    "Start"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setHideReview(true),
      title: "Dismiss for now",
      style: { flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "#b45309", fontSize: 16, lineHeight: 1, padding: "0 2px" }
    },
    "×"
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, dateLabel), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b" } }, total, " ", total === 1 ? "item" : "items", " on deck", (pomoToday > 0 || pomoYday > 0) && /* @__PURE__ */ React.createElement("span", { title: "Finished sessions on actions. Yesterday's number is the honest guide to how much fits today." }, " · 🍅 ", pomoToday, " today · ", pomoYday, " yesterday"))), total === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "48px 20px", color: "#94a3b8" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 38, marginBottom: 10 } }, "🎯"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "#475569" } }, "No plan for today yet."), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, marginTop: 4, marginBottom: 16 } }, "Star the next actions you'll focus on today — nothing's due or overdue."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onGoto("next"),
      style: { padding: "8px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }
    },
    "⚡ Pick from Next Actions"
  )) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Section, { label: "⚠️ Overdue", list: overdue, ov: true }), /* @__PURE__ */ React.createElement(Section, { label: "🎯 Focused today", list: focus, ov: false }), /* @__PURE__ */ React.createElement(Section, { label: "📅 Due today", list: due, ov: false }), /* @__PURE__ */ React.createElement(Section, { label: "🚀 Ready to start", list: started, ov: false })));
}
function PomoBar({ pomo, config, compact, onStop, onBreak, onSkip, onNext, onCapture }) {
  const [, setNow] = useState(0);
  const [thought, setThought] = useState("");
  const [big, setBig] = useState(false);
  const box = React.useRef(null);
  const fire = () => {
    const t = thought.trim();
    if (!t) return;
    onCapture(t);
    setThought("");
  };
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1e3);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!pomo) setBig(false);
  }, [pomo]);
  useEffect(() => {
    if (big && box.current) box.current.focus();
  }, [big]);
  if (!pomo) return null;
  const notif = window.Notification ? Notification.permission : "granted";
  const look = { work: ["#fef2f2", "#b91c1c", "🍅"], rest: ["#f0fdf4", "#166534", "☕"], break: ["#f0fdf4", "#166534", "☕"], idle: ["#f1f5f9", "#475569", "🍅"] }[pomo.phase];
  const stopped = pomo.phase === "idle" || pomo.phase === "rest";
  const clockSize = stopped ? "min(13vw,30vh)" : "min(28vw,50vh)";
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      role: "timer",
      ref: box,
      tabIndex: big ? -1 : void 0,
      onKeyDown: (e) => {
        if (big && e.key === "Escape") setBig(false);
      },
      style: big ? { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, position: "fixed", inset: 0, zIndex: 150, outline: "none", background: look[0], color: look[1] } : { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: compact ? "2px 8px" : "8px 14px", background: look[0], color: look[1], borderBottom: "1px solid #e2e8f0", flexShrink: 0 }
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: big ? clockSize : compact ? 12 : 15, lineHeight: big ? 1 : void 0, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, !big && look[2] + " ", pomo.phase === "idle" ? "Break over" : pomo.phase === "rest" ? "Session done" : pomoClock(pomo.endsAt - Date.now())),
    /* @__PURE__ */ React.createElement("span", { style: big ? { maxWidth: "100%", fontSize: "max(14px,min(4vw,6vh))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { flex: "1 1 90px", minWidth: 0, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, big && look[2] + " ", pomo.phase === "break" ? "Break — step away" : pomo.title),
    /* @__PURE__ */ React.createElement("div", { style: big ? { display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10 } : { display: "contents" } }, pomo.done > 0 && /* @__PURE__ */ React.createElement("span", { title: "Sessions finished in this run", style: { fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" } }, "× ", pomo.done), pomo.phase === "work" && pomo.marks > 0 && /* @__PURE__ */ React.createElement("span", { title: "Thoughts captured during this session", style: { fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" } }, "’ ", pomo.marks), notif !== "granted" && /* @__PURE__ */ React.createElement(
      "button",
      {
        disabled: notif === "denied",
        onClick: () => {
          window.focus();
          Pomo.arm();
        },
        className: "btn btn-ghost btn-sm",
        title: notif === "denied" ? "Blocked: allow notifications for this site in the browser's settings" : "Get a notification when the timer ends. The prompt appears in the main window."
      },
      "🔕 ",
      notif === "denied" ? "Blocked" : "Turn on"
    ), pomo.phase === "rest" && /* @__PURE__ */ React.createElement("button", { onClick: onBreak, className: "btn btn-pri btn-sm" }, "☕ Start ", pomoBreakMs(pomo.done, config) / 6e4, " min break"), (pomo.phase === "break" || pomo.phase === "rest") && /* @__PURE__ */ React.createElement("button", { onClick: onSkip, className: "btn btn-ghost btn-sm" }, "Skip"), pomo.phase === "idle" && /* @__PURE__ */ React.createElement("button", { onClick: onNext, className: "btn btn-pri btn-sm" }, "▶ Next"), /* @__PURE__ */ React.createElement("button", { onClick: () => setBig((b) => !b), title: big ? "Back to the small timer (Esc)" : "Enlarge the clock", "aria-label": big ? "Back to the small timer" : "Enlarge the clock", className: "ibtn", style: { fontSize: 15 } }, big ? "⤡" : "⛶"), /* @__PURE__ */ React.createElement("button", { onClick: onStop, title: "Stop (an unfinished session isn't counted)", "aria-label": "Stop timer", className: "ibtn", style: { fontSize: 15 } }, "×")),
    onCapture && pomo.phase === "work" && /* @__PURE__ */ React.createElement(
      "input",
      {
        value: thought,
        onChange: (e) => setThought(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && fire(),
        placeholder: "Something on your mind? Enter sends it to the Inbox — keep going.",
        "aria-label": "Capture to Inbox",
        className: "in in-sm",
        style: big ? { width: "min(560px,100%)" } : { flex: "1 1 100%", minWidth: 0 }
      }
    )
  );
}
function ItemTags({ item, ov }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, item.context && item.context !== "@anywhere" && /* @__PURE__ */ React.createElement(Tag, { bg: "#ede9fe", c: "#5b21b6" }, item.context), item.waitingFor && /* @__PURE__ */ React.createElement(Tag, { bg: "#fffbeb", c: "#b45309" }, "👤 ", item.waitingFor), item.energy && /* @__PURE__ */ React.createElement(Tag, { bg: "#f1f5f9", c: "#475569" }, "🔋 ", item.energy), item.time && /* @__PURE__ */ React.createElement(Tag, { bg: "#f1f5f9", c: "#475569" }, "⏱ ", item.time), item.startDate && /* @__PURE__ */ React.createElement(Tag, { bg: "#eff6ff", c: "#1d4ed8" }, "🕒 ", item.startDate), item.dueDate && /* @__PURE__ */ React.createElement(Tag, { bg: ov ? "#fef2f2" : "#f0fdf4", c: ov ? "#b91c1c" : "#166534" }, ov ? "⚠️ " : "📅 ", dueLabel(item.dueDate, item.dueTime)), /* @__PURE__ */ React.createElement(PomoTag, { item }), item.doneAt && /* @__PURE__ */ React.createElement(Tag, { bg: "#f0fdf4", c: "#166534" }, "✓ ", fmtDate(item.doneAt)));
}
function PomoTag({ item }) {
  const n = pomoTotal(item);
  if (!n) return null;
  const big = !item.doneAt && n >= POMO_SPLIT;
  return /* @__PURE__ */ React.createElement(Tag, { bg: big ? "#fffbeb" : "#fef2f2", c: big ? "#b45309" : "#b91c1c" }, "🍅 ", n, big ? " · break it down?" : "");
}
function FloatToday({ items, todayISO, pnameOf, canUndo, onUndo, onOpen, onComplete, onToggleFocus, onStartPomo, pomoBar, onCapture, onClose, updateReady, onReload, renderView, inbox }) {
  const [tab, setTab] = useState("today");
  const [text, setText] = useState("");
  const fire = () => {
    const t = text.trim();
    if (!t) return;
    onCapture(t);
    setText("");
  };
  const today = todayRows(items, todayISO);
  const listRows = (l) => (items[l] || []).filter((i) => !((l === "next" || l === "waiting") && isDeferred(i, todayISO))).map((i) => ({ ...i, _list: l }));
  const rows = tab === "today" ? today : tab === "done" ? listRows("done").slice(0, 50) : listRows(tab);
  const count = (v) => v === "today" ? today.length : v === "inbox" ? (items.inbox || []).length : 0;
  const iconBtn = { background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 };
  const special = renderView(tab, setTab);
  const card = tab === "inbox" && rows.length ? rows[rows.length - 1] : null;
  const listed = card ? rows.slice(0, -1) : rows;
  const waitingInbox = (tab === "today" || tab === "next") && (items.inbox || []).length;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Inter',system-ui,sans-serif" } }, /* @__PURE__ */ React.createElement("nav", { style: { display: "flex", alignItems: "center", padding: "3px 4px", background: "#1e293b", flexShrink: 0 } }, NAV.filter((v) => v !== "chat" || Ai.enabled()).map((v) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: v,
      onClick: () => setTab(v),
      title: META[v].label,
      "aria-label": META[v].label,
      style: { ...iconBtn, flex: "1 1 0", minWidth: 0, padding: "4px 0", fontSize: 13, borderRadius: 5, position: "relative", background: tab === v ? "rgba(99,102,241,.45)" : "none" }
    },
    META[v].icon,
    count(v) > 0 && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: 0, right: 1, fontSize: 8, fontWeight: 700, color: "#fff", background: v === "inbox" ? "#ef4444" : "#6366f1", borderRadius: 8, padding: "0 3px" } }, count(v))
  )), canUndo && /* @__PURE__ */ React.createElement("button", { onClick: onUndo, title: "Undo", "aria-label": "Undo", style: { ...iconBtn, color: "#cbd5e1", fontSize: 13, padding: "0 5px" } }, "↩"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, title: "Back to the main window", "aria-label": "Back to the main window", style: { ...iconBtn, color: "#94a3b8", fontSize: 14, padding: "0 4px" } }, "⛶")), pomoBar, updateReady && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", background: "#312e81", color: "#e0e7ff", fontSize: 11, flexShrink: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0 } }, "🔄 A new version is ready."), /* @__PURE__ */ React.createElement("button", { onClick: onReload, style: { padding: "2px 8px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700 } }, "Refresh")), tab !== "chat" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4, padding: "4px 6px", background: "#fff", borderBottom: "1px solid #e2e8f0", flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: text,
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && fire(),
      placeholder: "Capture a thought…",
      "aria-label": "Capture to Inbox",
      className: "in in-sm",
      style: { flex: 1, minWidth: 0 }
    }
  ), onStartPomo && /* @__PURE__ */ React.createElement("button", { onClick: () => onStartPomo({ id: null, title: META[tab].label }), title: "Start a pomodoro on " + META[tab].label, "aria-label": "Start a pomodoro on " + META[tab].label, style: { ...iconBtn, fontSize: 14 } }, "🍅")), special ? /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: 6, background: "#fff" } }, special) : /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", background: "#fff" } }, card && /* @__PURE__ */ React.createElement(FloatProcess, { key: card.id, item: card, total: rows.length, inbox, onSorted: () => setTab("chat") }), !card && rows.length === 0 && (waitingInbox ? /* @__PURE__ */ React.createElement("button", { onClick: () => setTab("inbox"), style: { ...iconBtn, display: "block", width: "100%", color: "#6366f1", fontSize: 12, fontWeight: 600, padding: "16px 8px" } }, "📥 ", (items.inbox || []).length, " in the Inbox — turn them into next actions →") : /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "#94a3b8", fontSize: 11, padding: "16px 8px" } }, META[tab].icon, " Nothing here.")), listed.map((i) => {
    const foc = i._list === "next" && i.focusDate === todayISO;
    const late = i.dueDate && i.dueDate < todayISO && i._list !== "done";
    const pname = pnameOf(i);
    return /* @__PURE__ */ React.createElement("div", { key: i.id, style: { display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 12 } }, (i._list === "next" || i._list === "waiting") && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onComplete(i._list, i),
        title: "Mark done",
        "aria-label": "Mark done: " + i.title,
        style: { ...iconBtn, width: 14, height: 14, borderRadius: "50%", border: "2px solid #cbd5e1", background: "#fff" }
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onOpen(i._list),
        title: (pname ? pname + " · " : "") + i.title + " (open in the main window)",
        style: { ...iconBtn, flex: 1, minWidth: 0, fontSize: 12, textAlign: "left", color: late ? "#b91c1c" : "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
      },
      i.title
    ), i.dueDate && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, color: late ? "#b91c1c" : "#64748b", flexShrink: 0 } }, dueLabel(i.dueDate, i.dueTime)), pomoTotal(i) > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, color: "#b91c1c", flexShrink: 0 } }, "🍅", pomoTotal(i)), i._list === "next" && onStartPomo && /* @__PURE__ */ React.createElement("button", { onClick: () => onStartPomo(i), title: "Start a pomodoro", "aria-label": "Start a pomodoro: " + i.title, style: { ...iconBtn, fontSize: 12 } }, "🍅"), i._list === "next" && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onToggleFocus(i.id),
        title: foc ? "Unfocus" : "Focus for today",
        "aria-label": (foc ? "Unfocus: " : "Focus for today: ") + i.title,
        style: { ...iconBtn, color: foc ? "#f59e0b" : "#cbd5e1", fontSize: 13 }
      },
      foc ? "★" : "☆"
    ));
  })));
}
function FloatProcess({ item, total, inbox, onSorted }) {
  const [title, setTitle] = useState(item.title);
  const t = title.trim();
  const small = { padding: "2px 6px", fontSize: 10.5, background: "#fff", border: "1px solid #ddd6fe", borderRadius: 5, cursor: "pointer", color: "#4338ca", whiteSpace: "nowrap" };
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "5px 6px", background: "#f5f3ff", borderBottom: "1px solid #ddd6fe" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#6d28d9", marginBottom: 3 } }, total, " to process · what's the next physical action?"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 4 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: title,
      onChange: (e) => setTitle(e.target.value),
      onFocus: (e) => e.target.select(),
      "aria-label": "Next action",
      onKeyDown: (e) => {
        if (e.key === "Enter" && t && !e.nativeEvent.isComposing) inbox.next(item, t);
      },
      className: "in in-sm",
      style: { flex: 1, minWidth: 0 }
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.next(item, t), disabled: !t, title: "Make it a next action (Enter)", "aria-label": "Make it a next action", className: "btn btn-pri btn-sm" }, "⚡"), inbox.start && /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.start(item, t), disabled: !t, title: "Make it a next action and start a pomodoro on it", "aria-label": "Make it a next action and start a pomodoro", className: "btn btn-ghost btn-sm" }, "🍅")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 3 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.to(item, "done", { doneAt: ts() }), title: "Took under two minutes: already done", style: small }, "✓ Done"), /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.to(item, "someday", {}), style: small }, "🌟 Someday"), /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.to(item, "reference", {}), style: small }, "📁 Reference"), /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.trash(item), title: "Trash", "aria-label": "Trash", style: small }, "🗑"), /* @__PURE__ */ React.createElement("button", { onClick: () => inbox.more(item), title: "Project, waiting for, dates (opens the main window)", style: small }, "⋯ More"), inbox.sort && /* @__PURE__ */ React.createElement("button", { onClick: () => {
    inbox.sort();
    onSorted();
  }, title: "The Agent proposes for the whole inbox; nothing changes until you approve", style: small }, "✨ All")));
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function CalendarView({ compact, items, pnameOf, onComplete, onGoto, onEdit }) {
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = isoDate(today);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayISO);
  const byDate = {};
  DATED.forEach((l) => (items[l] || []).forEach((i) => {
    if (i.dueDate) (byDate[i.dueDate] = byDate[i.dueDate] || []).push({ ...i, _list: l, _kind: "due" });
    if (i.startDate) (byDate[i.startDate] = byDate[i.startDate] || []).push({ ...i, _list: l, _kind: "start" });
  }));
  const sortKey = (x) => x._kind === "start" ? "25:00" : x.dueTime || "24:00";
  Object.values(byDate).forEach((arr) => arr.sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
  const y = cursor.getFullYear(), mo = cursor.getMonth();
  const startDow = (new Date(y, mo, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, mo, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const stepMonth = (n) => setCursor(new Date(y, mo + n, 1));
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(todayISO);
  };
  const selItems = byDate[selected] || [];
  const navBtn = { width: 30, height: 30, borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", color: "#475569", fontSize: 14, lineHeight: 1 };
  const dot = { next: "#6366f1", waiting: "#f59e0b", projects: "#7c3aed", someday: "#94a3b8" };
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => stepMonth(-1), style: navBtn, title: "Previous month" }, "‹"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 700, minWidth: 148, textAlign: "center" } }, monthLabel), /* @__PURE__ */ React.createElement("button", { onClick: () => stepMonth(1), style: navBtn, title: "Next month" }, "›")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: goToday,
      style: { padding: "6px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#475569" }
    },
    "Today"
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: compact ? 2 : 4, marginBottom: 4 } }, WEEKDAYS.map((w) => /* @__PURE__ */ React.createElement("div", { key: w, style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", textAlign: "center", padding: "2px 0" } }, w))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: compact ? 2 : 4 } }, cells.map((d, idx) => {
    if (!d) return /* @__PURE__ */ React.createElement("div", { key: idx, style: { minHeight: compact ? 30 : 74, background: "#f8fafc", borderRadius: 8 } });
    const iso = isoDate(d);
    const dayList = byDate[iso] || [];
    const isToday = iso === todayISO;
    const isSel = iso === selected;
    const overdue = iso < todayISO;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: idx,
        onClick: () => setSelected(iso),
        style: {
          minHeight: compact ? 30 : 74,
          textAlign: "left",
          padding: compact ? "1px" : "5px 6px",
          borderRadius: compact ? 6 : 8,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          background: isSel ? "#eef2ff" : "#fff",
          border: `1px solid ${isSel ? "#6366f1" : "#e2e8f0"}`,
          outline: "none"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", { style: {
        fontSize: 11,
        fontWeight: 700,
        width: 20,
        height: 20,
        lineHeight: "20px",
        textAlign: "center",
        borderRadius: "50%",
        background: isToday ? "#6366f1" : "transparent",
        color: isToday ? "#fff" : "#475569"
      } }, d.getDate())),
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: compact ? "row" : "column", justifyContent: compact ? "center" : "flex-start", gap: 2, overflow: "hidden" } }, dayList.slice(0, 3).map((i) => {
        const isStart = i._kind === "start";
        const od = overdue && !isStart;
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: i.id + i._kind,
            title: (isStart ? "Starts: " : "") + i.title,
            style: {
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: 9,
              lineHeight: 1.2,
              color: od ? "#b91c1c" : "#334155",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }
          },
          /* @__PURE__ */ React.createElement("span", { style: {
            width: 5,
            height: 5,
            borderRadius: "50%",
            flexShrink: 0,
            boxSizing: "border-box",
            background: isStart ? "transparent" : od ? "#ef4444" : dot[i._list] || "#94a3b8",
            border: isStart ? "1.5px solid #1d4ed8" : "none"
          } }),
          !compact && /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, !isStart && i.dueTime ? /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700 } }, i.dueTime, " ") : null, i._list === "next" ? i.title.replace(/^\[[^\]]+\]\s*/, "") : i.title)
        );
      }), !compact && dayList.length > 3 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#94a3b8", fontWeight: 600 } }, "+", dayList.length - 3, " more"))
    );
  })), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: selItems.length ? 10 : 0 } }, (/* @__PURE__ */ new Date(selected + "T00:00")).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), selected === todayISO && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 8, fontSize: 10, color: "#6366f1", fontWeight: 700 } }, "TODAY")), selItems.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#94a3b8", fontStyle: "italic" } }, "Nothing scheduled.") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, selItems.map((i) => {
    const isStart = i._kind === "start";
    const ov = selected < todayISO && !isStart;
    const pname = pnameOf(i);
    const title = i.title;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: i.id + i._kind,
        style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px", border: `1px solid ${ov ? "#fca5a5" : "#e2e8f0"}`, borderRadius: 9, background: ov ? "#fff7f7" : "#fff" }
      },
      i._list !== "projects" ? /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => onComplete(i._list, { ...i }),
          title: "Mark done",
          style: { width: 18, height: 18, borderRadius: "50%", border: "2px solid #cbd5e1", background: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 1 },
          onMouseEnter: (e) => e.target.style.borderColor = "#6366f1",
          onMouseLeave: (e) => e.target.style.borderColor = "#cbd5e1"
        }
      ) : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, flexShrink: 0, marginTop: 1 } }, "📋"),
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, pname && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#7c3aed", fontWeight: 600, marginBottom: 2 } }, "📋 ", pname), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 500, wordBreak: "break-word" } }, title), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement(Tag, { bg: "#eef2ff", c: "#4338ca" }, META[i._list].icon, " ", META[i._list].label), i.context && i.context !== "@anywhere" && /* @__PURE__ */ React.createElement(Tag, { bg: "#ede9fe", c: "#5b21b6" }, i.context), i.waitingFor && /* @__PURE__ */ React.createElement(Tag, { bg: "#fffbeb", c: "#b45309" }, "👤 ", i.waitingFor), isStart && /* @__PURE__ */ React.createElement(Tag, { bg: "#eff6ff", c: "#1d4ed8" }, "🕒 starts"), !isStart && i.dueTime && /* @__PURE__ */ React.createElement(Tag, { bg: "#f0fdf4", c: "#166534" }, "⏰ ", fmtTime(i.dueTime)), ov && /* @__PURE__ */ React.createElement(Tag, { bg: "#fef2f2", c: "#b91c1c" }, "⚠️ overdue"))),
      onEdit && i._list !== "reference" && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => onEdit(i._list, i),
          title: "Edit",
          style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13, lineHeight: 1, padding: "0 2px", flexShrink: 0 },
          onMouseEnter: (e) => e.currentTarget.style.color = "#6366f1",
          onMouseLeave: (e) => e.currentTarget.style.color = "#94a3b8"
        },
        "✎"
      ),
      /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => onGoto(i._list),
          title: "Open " + META[i._list].label,
          style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, lineHeight: 1, padding: "0 2px", flexShrink: 0 },
          onMouseEnter: (e) => e.currentTarget.style.color = "#6366f1",
          onMouseLeave: (e) => e.currentTarget.style.color = "#94a3b8"
        },
        "↗"
      )
    );
  }))));
}
function WeeklyReview({ items, todayISO, reviewedAt, daysSinceReview, reviewDay, onSetReviewDay, onComplete, onGoto, ai }) {
  const [done, setDone] = useState({});
  const toggle = (k) => setDone((d) => ({ ...d, [k]: !d[k] }));
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const inbox = (items.inbox || []).length;
  const nextC = (items.next || []).length;
  const someC = (items.someday || []).length;
  const waiting = items.waiting || [];
  const staleWait = waiting.filter((w) => w.created && Date.now() - new Date(w.created) > 7 * 864e5).length;
  const projects = items.projects || [];
  const linkedActive = /* @__PURE__ */ new Set();
  ["next", "waiting"].forEach((l) => (items[l] || []).forEach((a) => {
    if (a.projectId) linkedActive.add(a.projectId);
  }));
  const stalled = projects.filter((p) => !linkedActive.has(p.id));
  let overdue = 0, upcoming = 0;
  DATED.forEach((l) => (items[l] || []).forEach((i) => {
    if (i.dueDate) {
      i.dueDate < todayISO ? overdue++ : upcoming++;
    }
  }));
  const phases = [
    { name: "1 · Get clear", key: "clear", color: "#0ea5e9", steps: [
      { k: "collect", label: "Collect loose papers & materials", hint: "Round up stray notes, receipts, cards — drop them in your Inbox." },
      { k: "inbox", label: "Process your Inbox to zero", hint: "Decide what each item is and where it belongs — don't put anything back.", goto: "inbox", count: inbox, danger: inbox > 0, note: inbox === 0 ? "empty ✓" : null },
      { k: "mind", label: "Empty your head", hint: "Capture any uncaptured commitments, ideas, or open loops." }
    ] },
    { name: "2 · Get current", key: "current", color: "#6366f1", steps: [
      { k: "next", label: "Review Next Actions", hint: "Tick off completed ones; is each still the real next step?", goto: "next", count: nextC },
      { k: "cal", label: "Review Calendar — past & upcoming", hint: "Check last week for loose ends, the week ahead for commitments.", goto: "calendar", count: overdue + upcoming, danger: overdue > 0, note: overdue > 0 ? `${overdue} overdue` : null },
      { k: "waiting", label: "Review Waiting For", hint: "Anyone to follow up on or nudge?", goto: "waiting", count: waiting.length, note: staleWait > 0 ? `${staleWait} over a week old` : null },
      { k: "projects", label: "Review Projects", hint: "Every active project needs a defined next action.", goto: "projects", count: projects.length, danger: stalled.length > 0, note: stalled.length > 0 ? `${stalled.length} stalled` : null },
      { k: "someday", label: "Review Someday/Maybe", hint: "Anything ready to activate? Anything to let go?", goto: "someday", count: someC }
    ] },
    { name: "3 · Get creative", key: "creative", color: "#10b981", steps: [
      { k: "creative", label: "Add new ideas & projects", hint: "What's possible now? Capture anything fresh that surfaced." }
    ] }
  ];
  const pomoWeek = pomoTally(items, isoDate((/* @__PURE__ */ new Date(todayISO + "T12:00")).getTime() - 6 * 864e5), todayISO);
  const facts = [
    `inbox: ${inbox}`,
    `next actions: ${nextC}`,
    `waiting: ${waiting.length} (${staleWait} over a week old)`,
    `projects: ${projects.length} (${stalled.length} stalled: ${stalled.map((p) => p.title).join("; ") || "none"})`,
    `someday: ${someC}`,
    `dated: ${overdue} overdue, ${upcoming} upcoming`,
    `weekly review: ${daysSinceReview === null ? "never run" : daysSinceReview + " days since the last one"}`,
    `pomodoros in the last 7 days: ${pomoWeek}`
  ].join("\n");
  const obsFor = (key) => (ai && ai.data && ai.data.observations || []).filter((o) => o.phase === key);
  const allSteps = phases.flatMap((p) => p.steps);
  const completed = allSteps.filter((s) => done[s.k]).length;
  const pct = Math.round(completed / allSteps.length * 100);
  const finish = () => {
    onComplete();
    setDone({});
  };
  const lastTxt = reviewedAt ? daysSinceReview === 0 ? "Last reviewed today 🎉" : `Last reviewed ${daysSinceReview} day${daysSinceReview === 1 ? "" : "s"} ago` : "You haven't run a Weekly Review yet";
  return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 1180, margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, "🔄 Weekly Review"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: daysSinceReview >= 7 || daysSinceReview === null ? "#b45309" : "#64748b" } }, lastTxt)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b" } }, "The habit that keeps your system trustworthy. Walk each step, then mark it complete.", pomoWeek > 0 && ` 🍅 ${pomoWeek} focused sessions in the last 7 days.`), onSetReviewDay && /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b", whiteSpace: "nowrap" } }, "Review day", /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "in in-sm",
      value: reviewDay,
      onChange: (e) => onSetReviewDay(Number(e.target.value)),
      title: "The reminder appears from this day each week until you complete the review"
    },
    WD.map((d, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: i }, d))
  ))), ai && (ai.active ? /* @__PURE__ */ React.createElement(
    AiOpsReview,
    {
      ops: ai.ops,
      results: ai.results,
      notes: ai.notes,
      busy: ai.busy,
      error: ai.error,
      applyLabel: "Apply",
      onApply: ai.onApply,
      onRetry: () => ai.onRun(facts),
      onCancel: ai.onClose
    }
  ) : /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => ai.onRun(facts),
      disabled: !ai.online,
      title: ai.online ? "" : "Offline — Claude needs a connection",
      style: {
        width: "100%",
        padding: "10px 12px",
        marginBottom: 14,
        textAlign: "left",
        background: ai.online ? "#faf5ff" : "#f8fafc",
        border: `1.5px solid ${ai.online ? "#c4b5fd" : "#e2e8f0"}`,
        borderRadius: 9,
        cursor: ai.online ? "pointer" : "default",
        fontSize: 12,
        fontWeight: 600,
        color: ai.online ? "#5b21b6" : "#94a3b8"
      }
    },
    "✨ Coach me through this review",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: ai.online ? "#8b5cf6" : "#cbd5e1", marginTop: 2 } }, "Reads your lists and says what actually needs attention — nothing changes without your OK")
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 8, background: "#e2e8f0", borderRadius: 20, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { width: `${pct}%`, height: "100%", background: pct === 100 ? "#10b981" : "#6366f1", transition: "width .2s" } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#475569", minWidth: 78, textAlign: "right" } }, completed, "/", allSteps.length, " steps")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", marginBottom: 18 } }, phases.map((ph) => /* @__PURE__ */ React.createElement("div", { key: ph.name, style: { border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 14, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: ph.color, textTransform: "uppercase", letterSpacing: ".8px", borderBottom: `2px solid ${ph.color}22`, paddingBottom: 7 } }, ph.name), obsFor(ph.key).map((o, k) => /* @__PURE__ */ React.createElement("div", { key: "obs" + k, style: {
    fontSize: 11,
    color: "#5b21b6",
    background: "#faf5ff",
    border: "1px solid #ddd6fe",
    borderRadius: 8,
    padding: "8px 10px",
    lineHeight: 1.5
  } }, "✨ ", o.text)), ph.steps.map((s) => {
    const on = !!done[s.k];
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: s.k,
        style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: `1px solid ${on ? "#86efac" : "#e2e8f0"}`, borderRadius: 9, background: on ? "#f0fdf4" : "#fff" }
      },
      /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => toggle(s.k),
          title: on ? "Mark not done" : "Mark done",
          style: { width: 18, height: 18, borderRadius: "50%", border: `2px solid ${on ? "#10b981" : "#cbd5e1"}`, background: on ? "#10b981" : "#fff", color: "#fff", cursor: "pointer", flexShrink: 0, marginTop: 1, fontSize: 11, lineHeight: 1, padding: 0 }
        },
        on ? "✓" : ""
      ),
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 500, textDecoration: on ? "line-through" : "none", color: on ? "#64748b" : "#1e293b" } }, s.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", marginTop: 2 } }, s.hint), (s.count !== void 0 || s.note) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap", alignItems: "center" } }, s.count !== void 0 && /* @__PURE__ */ React.createElement(Tag, { bg: "#eef2ff", c: "#4338ca" }, s.count, " item", s.count === 1 ? "" : "s"), s.note && /* @__PURE__ */ React.createElement(Tag, { bg: s.danger ? "#fef2f2" : "#f0fdf4", c: s.danger ? "#b91c1c" : "#166534" }, s.note)), s.goto && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => onGoto(s.goto),
          title: "Open " + (META[s.goto]?.label || s.goto),
          className: "btn btn-ghost btn-sm",
          style: { marginTop: 7, whiteSpace: "nowrap" }
        },
        "Open →"
      ))
    );
  })))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: finish,
      style: { width: "100%", padding: "12px", background: pct === 100 ? "#10b981" : "#6366f1", color: "#fff", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700, marginTop: 4 }
    },
    pct === 100 ? "✓ Complete Weekly Review" : "Mark Weekly Review complete"
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 8 } }, "Completing resets the 7-day clock and clears the “due” reminder."));
}
function CompleteModal({ item, list, pname, ctxs, onConfirm, onClose }) {
  const [phase, setPhase] = useState(pname ? "decide" : "simple");
  const [nextTitle, setNextTitle] = useState("");
  const [nextCtx, setNextCtx] = useState(item.context || "@anywhere");
  const [nextDue, setNextDue] = useState("");
  const [waitingFor, setWaitingFor] = useState("");
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 };
  const box = { background: "#fff", borderRadius: 14, padding: 22, width: 420, maxWidth: "92vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.2)" };
  if (phase === "simple") return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 5 } }, "Mark as done?"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 16, fontStyle: "italic" } }, '"', item.title, '"'), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onConfirm("later", null),
      style: { flex: 1, padding: "9px", background: "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }
    },
    "✓ Done"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onClose,
      style: { flex: 1, padding: "9px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#64748b" }
    },
    "Cancel"
  ))));
  if (phase === "decide") return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 4 } }, "Action complete ✓"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 12, fontStyle: "italic" } }, '"', item.title, '"'), /* @__PURE__ */ React.createElement("div", { style: { background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#5b21b6" } }, "📋 ", /* @__PURE__ */ React.createElement("strong", null, pname), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 3, fontSize: 11, color: "#7c3aed", fontStyle: "italic" } }, "GTD: every project must always have a defined next action.")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 } }, "What's next for this project?"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPhase("define"),
      style: { padding: "11px 13px", background: "#f5f3ff", border: "1.5px solid #6366f1", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#4338ca", textAlign: "left" }
    },
    "⚡ Define the next action now",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#6366f1", marginTop: 2 } }, "Recommended — keeps the project moving")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onConfirm("close", null),
      style: { padding: "11px 13px", background: "#f0fdf4", border: "1.5px solid #10b981", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#065f46", textAlign: "left" }
    },
    "🎉 Project is complete — close it",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#10b981", marginTop: 2 } }, "The outcome has been fully achieved")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPhase("waiting"),
      style: { padding: "11px 13px", background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#1e40af", textAlign: "left" }
    },
    "⏳ Waiting for someone/something",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#3b82f6", marginTop: 2 } }, "The ball is in someone else's court")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onConfirm("someday", null),
      style: { padding: "11px 13px", background: "#f8fafc", border: "1.5px solid #94a3b8", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#475569", textAlign: "left" }
    },
    "💤 Move to Someday/Maybe",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#64748b", marginTop: 2 } }, "Not a current priority — incubate it")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onConfirm("later", null),
      style: { padding: "11px 13px", background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#92400e", textAlign: "left" }
    },
    "🔄 Decide at next Weekly Review",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#b45309", marginTop: 2 } }, "⚠️ Project will appear as stalled until then")
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onClose,
      style: { marginTop: 10, width: "100%", padding: "8px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#64748b" }
    },
    "Cancel"
  )));
  if (phase === "define") return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPhase("decide"),
      style: { background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 12, marginBottom: 12, padding: 0 }
    },
    "← Back"
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 3 } }, "Next action for: ", /* @__PURE__ */ React.createElement("span", { style: { color: "#6366f1" } }, pname)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 12 } }, "What is the very next ", /* @__PURE__ */ React.createElement("em", null, "physical, visible"), " action?"), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: nextTitle,
      onChange: (e) => setNextTitle(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && nextTitle.trim()) onConfirm("next", { ...mk(nextTitle.trim()), projectId: item.projectId, context: nextCtx, dueDate: nextDue });
      },
      placeholder: "e.g. Gọi điện cho anh Sơn về tiến độ",
      style: { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4 } }, "Context"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: nextCtx,
      onChange: (e) => setNextCtx(e.target.value),
      style: { width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12, background: "#fff" }
    },
    ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c))
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4 } }, "Due date"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: nextDue,
      onChange: (e) => setNextDue(e.target.value),
      style: { width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (nextTitle.trim()) onConfirm("next", { ...mk(nextTitle.trim()), projectId: item.projectId, context: nextCtx, dueDate: nextDue });
      },
      disabled: !nextTitle.trim(),
      style: { flex: 1, padding: "9px", background: nextTitle.trim() ? "#6366f1" : "#e2e8f0", color: nextTitle.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, cursor: nextTitle.trim() ? "pointer" : "default", fontSize: 13, fontWeight: 600 }
    },
    "✓ Done & add next action"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onClose,
      style: { flex: 1, padding: "9px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#64748b" }
    },
    "Cancel"
  ))));
  if (phase === "waiting") return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPhase("decide"),
      style: { background: "none", border: "none", cursor: "pointer", color: "#3b82f6", fontSize: 12, marginBottom: 12, padding: 0 }
    },
    "← Back"
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 3 } }, "Waiting for: ", /* @__PURE__ */ React.createElement("span", { style: { color: "#3b82f6" } }, pname)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 12 } }, "What or who are you waiting for before this project can move forward?"), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: waitingFor,
      onChange: (e) => setWaitingFor(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && waitingFor.trim()) onConfirm("waiting", { waitingFor: waitingFor.trim() });
      },
      placeholder: "e.g. John's approval on the proposal",
      style: { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 14 }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (waitingFor.trim()) onConfirm("waiting", { waitingFor: waitingFor.trim() });
      },
      disabled: !waitingFor.trim(),
      style: { flex: 1, padding: "9px", background: waitingFor.trim() ? "#3b82f6" : "#e2e8f0", color: waitingFor.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, cursor: waitingFor.trim() ? "pointer" : "default", fontSize: 13, fontWeight: 600 }
    },
    "⏳ Add to Waiting For"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onClose,
      style: { flex: 1, padding: "9px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#64748b" }
    },
    "Cancel"
  ))));
  return null;
}
const AI_REASON = {
  "no-such-item": "that item is gone",
  "no-such-list": "not a valid list",
  "no-such-project": "no such project",
  "empty-title": "empty title",
  "wrong-list": "only next actions can be focused",
  "noop": "already true",
  "unknown-op": "unsupported action",
  "bad-shape": "malformed",
  "too-many": "batch too long"
};
function AiOpsReview({ ops, results, notes, busy, error, onApply, onRetry, onCancel, applyLabel }) {
  const [off, setOff] = useState({});
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    setOff({});
  }, [results]);
  useEffect(() => {
    if (!busy) {
      setSecs(0);
      return;
    }
    const t = setInterval(() => setSecs((n) => n + 1), 1e3);
    return () => clearInterval(t);
  }, [busy]);
  const rows = results || [];
  const chosen = rows.filter((r) => r.ok && !off[r.i]).map((r) => r.i);
  const box = { border: "1px solid #ddd6fe", background: "#faf5ff", borderRadius: 9, padding: "11px 13px", marginBottom: 10 };
  if (busy) return /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#5b21b6", fontWeight: 600 } }, "✨ Asking Claude… ", secs > 2 ? `${secs}s` : ""), secs > 20 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#8b5cf6", marginTop: 4, lineHeight: 1.5 } }, "Longer than usual. It gives up at 60s — check DevTools → Network → “messages” if this repeats."), onCancel && /* @__PURE__ */ React.createElement("button", { onClick: onCancel, className: "btn btn-ghost btn-sm", style: { marginTop: 8 } }, "Cancel"));
  if (error) return /* @__PURE__ */ React.createElement("div", { style: { ...box, borderColor: "#fca5a5", background: "#fef2f2" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#b91c1c", lineHeight: 1.5 } }, error), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8 } }, onRetry && /* @__PURE__ */ React.createElement("button", { onClick: onRetry, className: "btn btn-pri btn-sm" }, "Try again"), onCancel && /* @__PURE__ */ React.createElement("button", { onClick: onCancel, className: "btn btn-ghost btn-sm" }, "Dismiss")));
  if (!rows.length && !(notes || []).length) return null;
  return /* @__PURE__ */ React.createElement("div", { style: box }, (notes || []).map((n, k) => /* @__PURE__ */ React.createElement("div", { key: k, style: { fontSize: 12, color: "#4c1d95", lineHeight: 1.5, marginBottom: 6 } }, n)), rows.map((r) => {
    const op = (ops || [])[r.i] || {};
    return /* @__PURE__ */ React.createElement("label", { key: r.i, style: {
      display: "flex",
      gap: 8,
      alignItems: "flex-start",
      padding: "5px 0",
      cursor: r.ok ? "pointer" : "default",
      opacity: r.ok ? 1 : 0.5
    } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        disabled: !r.ok,
        checked: r.ok && !off[r.i],
        onChange: () => setOff((o) => ({ ...o, [r.i]: !o[r.i] })),
        style: { marginTop: 2 }
      }
    ), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "#1e293b" } }, r.effect || op.op), !r.ok && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#b91c1c", marginLeft: 6 } }, "— skipped: ", AI_REASON[r.reason] || r.reason), op.why && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: 1 } }, op.why), r.ok && r.clamped && r.clamped.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#b45309", marginTop: 1 } }, "ignored: ", r.clamped.join(", "))));
  }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 9 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onApply(chosen),
      disabled: !chosen.length,
      style: {
        flex: 1,
        padding: "8px",
        border: "none",
        borderRadius: 7,
        fontSize: 12,
        fontWeight: 600,
        background: chosen.length ? "#6366f1" : "#e2e8f0",
        color: chosen.length ? "#fff" : "#94a3b8",
        cursor: chosen.length ? "pointer" : "default"
      }
    },
    applyLabel || "Apply",
    " ",
    chosen.length ? `${chosen.length} of ${rows.length}` : ""
  ), onCancel && /* @__PURE__ */ React.createElement("button", { onClick: onCancel, className: "btn btn-ghost btn-sm" }, "Discard")));
}
function AiModal({ title, subtitle, ai }) {
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 };
  const box = { background: "#fff", borderRadius: 14, padding: 22, width: 460, maxWidth: "92vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.2)" };
  return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && ai.onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 4 } }, title), subtitle && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 12, fontStyle: "italic" } }, '"', subtitle, '"'), /* @__PURE__ */ React.createElement(
    AiOpsReview,
    {
      ops: ai.ops,
      results: ai.results,
      notes: ai.notes,
      busy: ai.busy,
      error: ai.error,
      applyLabel: "Add",
      onApply: ai.onApply,
      onRetry: ai.onRun,
      onCancel: ai.onClose
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: ai.onClose, className: "btn btn-ghost btn-sm", style: { width: "100%" } }, "Close")));
}
function useAgentSession(items, archive, pomo) {
  const [msgs, setMsgs] = useState(() => {
    try {
      const m = JSON.parse(localStorage.getItem(AGENT_LS));
      return Array.isArray(m) ? m : [];
    } catch {
      return [];
    }
  });
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cost, setCost] = useState(0);
  const [proposal, setProposal] = useState(null);
  const [attached, setAttached] = useState([]);
  const abort = React.useRef(null);
  useEffect(() => {
    try {
      localStorage.setItem(AGENT_LS, JSON.stringify(msgs.slice(-AGENT_KEEP)));
    } catch {
    }
  }, [msgs]);
  const send = async (q) => {
    if (abort.current) return;
    const history = [...msgs, { role: "user", content: q }];
    setMsgs(history);
    setError("");
    setProposal(null);
    setStep("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timerLine = pomo && pomo.phase === "work" ? `They are in a pomodoro on "${pomo.title}" with ${pomoClock(pomo.endsAt - Date.now())} left; keep it short and don't pull them off it.` : "No pomodoro is running.";
    const model = Ai.model();
    const r = await AiTasks.agent(items, archive, history, isoDate(/* @__PURE__ */ new Date()), timerLine, { model, attached, signal: ctrl.signal, onStep: setStep });
    abort.current = null;
    setBusy(false);
    setStep("");
    if (r.usage) setCost((c) => c + agentCost(r.usage, model));
    if (!r.ok) {
      if (r.code !== "cancelled") setError(r.msg);
      return;
    }
    if (r.text) setMsgs((h) => [...h, { role: "assistant", content: r.text }]);
    if (r.ops.length) setProposal({ ops: r.ops, refs: r.refs });
  };
  return {
    msgs,
    step,
    busy,
    error,
    cost,
    proposal,
    attached,
    send,
    setProposal,
    attach: (files) => setAttached((p) => attachAdd(p, files)),
    detach: () => setAttached([]),
    stop: () => {
      if (abort.current) abort.current.abort();
    },
    clear: () => {
      setMsgs([]);
      setProposal(null);
      setError("");
      setAttached([]);
    }
  };
}
function ModelSelect({ compact, value, onChange }) {
  return /* @__PURE__ */ React.createElement(
    "select",
    {
      value,
      onChange: (e) => onChange(e.target.value),
      className: "in in-sm",
      "aria-label": "Claude model",
      title: "Model for the agent and every AI task. Prices are USD per million tokens, in/out.",
      style: { width: "auto", maxWidth: "100%", fontSize: compact ? 11 : 12, padding: compact ? "1px 2px" : void 0 }
    },
    AI_MODELS.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id }, compact ? m.name : `${m.name} · $${m.price.input}/$${m.price.output}`))
  );
}
function ChatView({ compact, agent, model, onModel, items, todayISO, onApply, onSaveContext }) {
  const { msgs, step, busy, error, cost, proposal } = agent;
  const [draft, setDraft] = useState("");
  const [ctxText, setCtxText] = useState(null);
  const foot = React.useRef(null);
  const input = React.useRef(null);
  const filePick = React.useRef(null);
  const dirPick = React.useRef(null);
  const started = msgs.length > 0;
  const canAttach = !compact && !window.AndroidWidget;
  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    agent.attach(files);
  };
  useEffect(() => {
    if (started && foot.current) foot.current.scrollIntoView({ block: "end" });
  }, [msgs, busy, proposal, error]);
  useEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, compact ? 72 : 200) + "px";
  }, [draft]);
  const results = proposal ? applyAiOps(items, proposal.ops, { refs: proposal.refs, todayISO }).results : [];
  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    agent.send(q);
  };
  const bubble = (role, text, k) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start", marginBottom: compact ? 5 : 8 } }, /* @__PURE__ */ React.createElement("div", { style: {
    maxWidth: compact ? "92%" : "82%",
    padding: compact ? "5px 8px" : "9px 12px",
    borderRadius: compact ? 9 : 12,
    fontSize: compact ? 12 : 13,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: role === "user" ? "#6366f1" : "#fff",
    color: role === "user" ? "#fff" : "#1e293b",
    border: role === "user" ? "none" : "1px solid #e2e8f0"
  } }, text));
  return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 760, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap", marginBottom: compact ? 4 : 10 } }, !compact && /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 12, color: "#64748b" } }, "It reads your whole system and proposes changes. Nothing changes until you approve."), /* @__PURE__ */ React.createElement(ModelSelect, { compact, value: model, onChange: onModel }), canAttach && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { ref: filePick, type: "file", multiple: true, onChange: onPick, style: { display: "none" } }), /* @__PURE__ */ React.createElement("input", { ref: dirPick, type: "file", webkitdirectory: "", onChange: onPick, style: { display: "none" } }), /* @__PURE__ */ React.createElement("button", { onClick: () => filePick.current.click(), className: "btn btn-ghost btn-sm", title: "Let the agent read files" }, "📎 Files"), /* @__PURE__ */ React.createElement("button", { onClick: () => dirPick.current.click(), className: "btn btn-ghost btn-sm", title: "Let the agent read a folder. Hidden files are left out." }, "📁 Folder")), /* @__PURE__ */ React.createElement("button", { onClick: () => setCtxText(ctxText === null ? items.agentContext || "" : null), className: "btn btn-ghost btn-sm", title: "What it knows", "aria-label": "What it knows" }, compact ? "🧠" : "🧠 What it knows"), started && /* @__PURE__ */ React.createElement("button", { onClick: agent.clear, disabled: busy, className: "btn btn-ghost btn-sm" }, "New chat")), ctxText !== null && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: ctxText,
      onChange: (e) => setCtxText(e.target.value),
      rows: compact ? 3 : 5,
      className: "in in-sm",
      style: { width: "100%", resize: "vertical", fontFamily: "inherit" },
      placeholder: "Who you are, what matters now, how you want it to help. Follows you to all your devices.",
      "aria-label": "What the agent knows about you"
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
    onSaveContext(ctxText);
    setCtxText(null);
  }, className: "btn btn-pri btn-sm" }, "Save"), /* @__PURE__ */ React.createElement("button", { onClick: () => setCtxText(null), className: "btn btn-ghost btn-sm" }, "Cancel"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", marginBottom: compact ? 5 : 12, display: "flex", flexDirection: "column", justifyContent: started ? "flex-start" : "flex-end" } }, !started && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: compact ? 14 : 22, fontWeight: 700, color: "#334155" } }, "What should we look at?"), msgs.map((m, k) => bubble(m.role, m.content, k)), busy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", marginBottom: 8 } }, step ? `reading: ${step}…` : "thinking…"), error && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#b91c1c", padding: "8px 0" } }, error), proposal && /* @__PURE__ */ React.createElement(
    AiOpsReview,
    {
      ops: proposal.ops,
      results,
      applyLabel: "Approve",
      onApply: (chosen) => {
        onApply(proposal.ops.filter((_, i) => chosen.indexOf(i) >= 0), proposal.refs);
        agent.setProposal(null);
      },
      onCancel: () => agent.setProposal(null)
    }
  ), /* @__PURE__ */ React.createElement("div", { ref: foot })), agent.attached.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginBottom: 6, fontSize: compact ? 10 : 11, color: "#475569" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, "📎 ", agent.attached.length, " file", agent.attached.length === 1 ? "" : "s", ", ", attachSize(agent.attached.reduce((n, e) => n + e.size, 0)), ". The names and whatever it reads go to Anthropic."), /* @__PURE__ */ React.createElement("button", { onClick: agent.detach, disabled: busy, className: "btn btn-ghost btn-sm" }, "Remove")), /* @__PURE__ */ React.createElement("div", { className: "agent-box", style: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: compact ? 10 : 16,
    padding: compact ? "4px 4px 4px 9px" : "12px 12px 12px 16px",
    boxShadow: compact ? "none" : "0 4px 16px rgba(15,23,42,.08)"
  } }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      ref: input,
      autoFocus: !window.matchMedia("(pointer:coarse)").matches,
      rows: compact ? 1 : 2,
      value: draft,
      placeholder: "Ask, or tell it what to do…",
      "aria-label": "Message to the agent",
      style: { flex: 1, minWidth: 0, border: "none", outline: "none", resize: "none", background: "transparent", color: "#1e293b", fontFamily: "inherit", fontSize: compact ? 12.5 : 15, lineHeight: 1.45, padding: compact ? "3px 0" : 0 },
      onChange: (e) => setDraft(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      }
    }
  ), busy ? /* @__PURE__ */ React.createElement("button", { onClick: agent.stop, className: "btn btn-ghost btn-sm" }, "Stop") : /* @__PURE__ */ React.createElement("button", { onClick: submit, disabled: !draft.trim(), className: "btn btn-pri btn-sm" }, "Send")), !started && /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflow: "hidden", paddingTop: 12, textAlign: "center", fontSize: 12, color: "#94a3b8", lineHeight: 1.7 } }, !compact && /* @__PURE__ */ React.createElement(React.Fragment, null, "Try: “what should I do in the next hour?” · “turn my inbox into next actions” · “which projects haven't moved?” · “how many pomodoros did I spend on the report?”")), cost > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: compact ? 2 : 6, textAlign: "right" } }, "≈ $", cost.toFixed(3), " this session"));
}
function PromoteModal({ item, onConfirm, onClose }) {
  const actionText = item.title;
  const [outcome, setOutcome] = useState("");
  const can = outcome.trim();
  const confirm = () => {
    if (can) onConfirm(outcome.trim());
  };
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "mbox" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 3 } }, "Make into a project"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 14 } }, "GTD: a project is a multi-step outcome. This action stays on as its first next action."), /* @__PURE__ */ React.createElement("div", { style: { background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#5b21b6" } }, "⚡ ", /* @__PURE__ */ React.createElement("strong", null, actionText)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 } }, 'Project outcome — what does "done" look like?'), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      className: "in",
      style: { marginBottom: 14 },
      value: outcome,
      onChange: (e) => setOutcome(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && can && confirm(),
      placeholder: "e.g. Bathroom leak fully fixed"
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: confirm, disabled: !can, className: "btn btn-pri", style: { flex: 1 } }, "📋 Create project"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, className: "btn btn-ghost", style: { flex: 1 } }, "Cancel"))));
}
function EditModal({ item, list, ctxs, projects, onConfirm, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [projectId, setProjectId] = useState(item.projectId || "");
  const [context, setContext] = useState(item.context || "@anywhere");
  const [dueDate, setDueDate] = useState(item.dueDate || "");
  const [dueTime, setDueTime] = useState(item.dueTime || "");
  const [startDate, setStartDate] = useState(item.startDate || "");
  const [waitingFor, setWaitingFor] = useState(item.waitingFor || "");
  const [energy, setEnergy] = useState(item.energy || "");
  const [time, setTime] = useState(item.time || "");
  const can = title.trim();
  const showCtx = list === "next";
  const showWait = list === "waiting";
  const showProj = list === "next" || list === "waiting";
  const showDue = ["next", "projects", "waiting", "someday"].includes(list);
  const resolvePid = () => {
    if (projectId === "") return "";
    const hit = (projects || []).find((p) => String(p.id) === String(projectId));
    return hit ? hit.id : item.projectId;
  };
  const confirm = () => {
    if (can) onConfirm({ title: title.trim(), projectId: resolvePid(), context, dueDate, dueTime: dueDate ? dueTime : "", startDate, waitingFor: waitingFor.trim(), energy, time });
  };
  const lbl = { marginBottom: 6 };
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "mbox" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 14 } }, "Edit ", META[list]?.label || "item"), /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, list === "projects" ? "Project outcome" : "Title"), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      className: "in",
      style: { marginBottom: 14 },
      value: title,
      onChange: (e) => setTitle(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && can && confirm()
    }
  ), showProj && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Project"), /* @__PURE__ */ React.createElement("select", { className: "in", style: { marginBottom: 14 }, value: projectId, onChange: (e) => setProjectId(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "— none —"), (projects || []).map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, "📋 ", p.title)), projectId && !(projects || []).some((p) => String(p.id) === String(projectId)) && /* @__PURE__ */ React.createElement("option", { value: projectId }, "📋 (current link)"))), showCtx && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Context"), /* @__PURE__ */ React.createElement("select", { className: "in", style: { marginBottom: 14 }, value: context, onChange: (e) => setContext(e.target.value) }, ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Energy"), /* @__PURE__ */ React.createElement("select", { className: "in", value: energy, onChange: (e) => setEnergy(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "—"), ENERGIES.map((en) => /* @__PURE__ */ React.createElement("option", { key: en, value: en }, "🔋 ", en)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Time needed"), /* @__PURE__ */ React.createElement("select", { className: "in", value: time, onChange: (e) => setTime(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "—"), TIMES.map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t }, "⏱ ", t)))))), showWait && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Waiting for whom?"), /* @__PURE__ */ React.createElement("input", { className: "in", style: { marginBottom: 14 }, value: waitingFor, onChange: (e) => setWaitingFor(e.target.value) })), showDue && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Start date (defer until)"), /* @__PURE__ */ React.createElement("input", { className: "in", style: { marginBottom: 14 }, type: "date", value: startDate, onChange: (e) => setStartDate(e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Due date"), /* @__PURE__ */ React.createElement("input", { className: "in", style: { marginBottom: dueDate ? 8 : 14 }, type: "date", value: dueDate, onChange: (e) => {
    setDueDate(e.target.value);
    if (!e.target.value) setDueTime("");
  } }), dueDate && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "slabel", style: lbl }, "Due time ", /* @__PURE__ */ React.createElement("span", { style: { textTransform: "none", fontWeight: 400, color: "#cbd5e1" } }, "· optional, for appointments")), /* @__PURE__ */ React.createElement("input", { className: "in", style: { marginBottom: 14 }, type: "time", value: dueTime, onChange: (e) => setDueTime(e.target.value) }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: confirm, disabled: !can, className: "btn btn-pri", style: { flex: 1 } }, "Save"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, className: "btn btn-ghost", style: { flex: 1 } }, "Cancel"))));
}
function InboxFocus({ item, total, onProcess, onSort }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px 24px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 28 } }, total, " item", total !== 1 ? "s" : "", " to process"), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "28px", width: "100%", maxWidth: 520, boxShadow: "0 4px 24px rgba(0,0,0,.07)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 10 } }, "Oldest item"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 17, fontWeight: 600, color: "#1e293b", lineHeight: 1.45, marginBottom: 24 } }, item.title), /* @__PURE__ */ React.createElement("div", { style: { background: "#f5f3ff", borderRadius: 8, padding: "9px 12px", marginBottom: 22, fontSize: 11, color: "#6366f1", fontStyle: "italic" } }, "GTD: process top to bottom, oldest first. Make a decision on each item — never put it back."), /* @__PURE__ */ React.createElement("button", { onClick: onProcess, className: "btn btn-pri", style: { width: "100%", padding: "13px", fontSize: 14, borderRadius: 9, fontWeight: 700 } }, "Process this item →"), onSort && /* @__PURE__ */ React.createElement("button", { onClick: onSort, className: "btn btn-ghost", style: { width: "100%", marginTop: 8 } }, "✨ Have the Agent propose for the whole inbox")));
}
function ProcessModal({ item, ctxs, ai, onMove, onMoveAsProject, onTrash, onClose }) {
  const [due, setDue] = useState("");
  const [from, setFrom] = useState("");
  const [phase, setPhase] = useState("main");
  const [firstType, setFirstType] = useState("next");
  const [naTitle, setNaTitle] = useState("");
  const [naCtx, setNaCtx] = useState("@anywhere");
  const [naDue, setNaDue] = useState("");
  const [naDueTime, setNaDueTime] = useState("");
  const [naStart, setNaStart] = useState("");
  const [waitTxt, setWaitTxt] = useState("");
  const [secsLeft, setSecsLeft] = useState(120);
  useEffect(() => {
    if (phase !== "doit") return;
    setSecsLeft(120);
    const id = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1e3);
    return () => clearInterval(id);
  }, [phase]);
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 };
  const box = { background: "#fff", borderRadius: 14, padding: 22, width: 420, maxWidth: "92vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.2)" };
  const Opt = ({ bg, border, color, onClick, children }) => /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      style: { padding: "9px 12px", background: bg, border: `1px solid ${border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500, textAlign: "left", color, width: "100%" }
    },
    children
  );
  const Divider = ({ label }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, margin: "12px 0 8px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: "#e2e8f0" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px" } }, label), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: "#e2e8f0" } }));
  const tabBtn = (label, active, onClick) => /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      style: {
        flex: 1,
        padding: "8px",
        fontSize: 12,
        fontWeight: 600,
        border: `1.5px solid ${active ? "#6366f1" : "#e2e8f0"}`,
        borderRadius: 7,
        cursor: "pointer",
        background: active ? "#6366f1" : "#fff",
        color: active ? "#fff" : "#64748b"
      }
    },
    label
  );
  if (phase === "doit") {
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;
    const over = secsLeft === 0;
    return /* @__PURE__ */ React.createElement("div", { style: overlay }, /* @__PURE__ */ React.createElement("div", { style: { ...box, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 } }, "Do it now"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600, color: "#1e293b", lineHeight: 1.4, marginBottom: 20 } }, item.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 52, fontWeight: 800, letterSpacing: "-2px", color: over ? "#ef4444" : secsLeft <= 30 ? "#f59e0b" : "#10b981", marginBottom: 6, fontVariantNumeric: "tabular-nums" } }, timeStr), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", marginBottom: 24 } }, over ? "Time's up — did you finish?" : "2-minute timer running…"), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onMove("done", { doneAt: ts() }),
        style: { width: "100%", padding: "13px", background: "#10b981", color: "#fff", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 8 }
      },
      "✓ Done — back to inbox"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPhase("main"),
        style: { width: "100%", padding: "9px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 9, cursor: "pointer", fontSize: 12, color: "#64748b" }
      },
      "Takes longer — defer it instead"
    )));
  }
  if (phase === "next") {
    const can = naTitle.trim();
    const confirm = () => {
      if (can) onMove("next", { title: naTitle.trim(), context: naCtx, dueDate: naDue, dueTime: naDue ? naDueTime : "", startDate: naStart });
    };
    return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPhase("main"),
        style: { background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 12, marginBottom: 12, padding: 0 }
      },
      "← Back"
    ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 3 } }, "Define the next action"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 10 } }, "GTD: the inbox note is just a reminder — name the concrete, physical action you'll actually do."), /* @__PURE__ */ React.createElement("div", { style: { background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#5b21b6" } }, "💭 ", /* @__PURE__ */ React.createElement("strong", null, item.title)), /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        value: naTitle,
        onChange: (e) => setNaTitle(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && can && confirm(),
        placeholder: "What is the very next physical action?",
        style: { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 8 }
      }
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        value: naCtx,
        onChange: (e) => setNaCtx(e.target.value),
        style: { width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12, background: "#fff", marginBottom: 8 }
      },
      ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c))
    ), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600 } }, "Start (defer until)", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: naStart,
        onChange: (e) => setNaStart(e.target.value),
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    )), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600 } }, "Due", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: naDue,
        onChange: (e) => {
          setNaDue(e.target.value);
          if (!e.target.value) setNaDueTime("");
        },
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    )), naDue && /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600, gridColumn: "1 / -1" }, title: "Optional — set a time only for a real appointment" }, "Due time (optional)", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "time",
        value: naDueTime,
        onChange: (e) => setNaDueTime(e.target.value),
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    ))), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: confirm,
        disabled: !can,
        style: {
          width: "100%",
          padding: "10px",
          background: can ? "#6366f1" : "#e2e8f0",
          color: can ? "#fff" : "#94a3b8",
          border: "none",
          borderRadius: 8,
          cursor: can ? "pointer" : "default",
          fontSize: 13,
          fontWeight: 600
        }
      },
      "✓ Add to Next Actions"
    )));
  }
  if (phase === "project") {
    const canConfirm = firstType === "next" ? naTitle.trim() : waitTxt.trim();
    const confirm = () => {
      const first = firstType === "next" ? { type: "next", title: naTitle.trim(), context: naCtx, dueDate: naDue, dueTime: naDue ? naDueTime : "", startDate: naStart } : { type: "waiting", waitingFor: waitTxt.trim() };
      onMoveAsProject({ dueDate: due }, first);
    };
    return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPhase("main"),
        style: { background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 12, marginBottom: 12, padding: 0 }
      },
      "← Back"
    ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 3 } }, "New project: ", /* @__PURE__ */ React.createElement("span", { style: { color: "#6366f1" } }, item.title)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 14 } }, "GTD: every project needs a first next action or a waiting-for before it's active."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 14 } }, tabBtn("⚡ Next Action", firstType === "next", () => setFirstType("next")), tabBtn("⏳ Waiting For", firstType === "waiting", () => setFirstType("waiting"))), firstType === "next" ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        value: naTitle,
        onChange: (e) => setNaTitle(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && canConfirm && confirm(),
        placeholder: "What is the very next physical action?",
        style: { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 8 }
      }
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        value: naCtx,
        onChange: (e) => setNaCtx(e.target.value),
        style: { width: "100%", padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12, background: "#fff", marginBottom: 8 }
      },
      ctxs.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c))
    ), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600 } }, "Start (defer until)", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: naStart,
        onChange: (e) => setNaStart(e.target.value),
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    )), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600 } }, "Due", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: naDue,
        onChange: (e) => {
          setNaDue(e.target.value);
          if (!e.target.value) setNaDueTime("");
        },
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    )), naDue && /* @__PURE__ */ React.createElement("label", { style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: "#94a3b8", fontWeight: 600, gridColumn: "1 / -1" }, title: "Optional — set a time only for a real appointment" }, "Due time (optional)", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "time",
        value: naDueTime,
        onChange: (e) => setNaDueTime(e.target.value),
        style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
      }
    )))) : /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        value: waitTxt,
        onChange: (e) => setWaitTxt(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && canConfirm && confirm(),
        placeholder: "Waiting for whom / what?",
        style: { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, outline: "none", marginBottom: 14 }
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: confirm,
        disabled: !canConfirm,
        style: {
          width: "100%",
          padding: "10px",
          background: canConfirm ? "#6366f1" : "#e2e8f0",
          color: canConfirm ? "#fff" : "#94a3b8",
          border: "none",
          borderRadius: 8,
          cursor: canConfirm ? "pointer" : "default",
          fontSize: 13,
          fontWeight: 600
        }
      },
      "✓ Create project + add ",
      firstType === "next" ? "next action" : "waiting for"
    )));
  }
  return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 4 } }, "Clarify this item"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 10, fontStyle: "italic" } }, '"', item.title, '"'), ai && (ai.active ? /* @__PURE__ */ React.createElement(
    AiOpsReview,
    {
      ops: ai.ops,
      results: ai.results,
      notes: ai.notes,
      busy: ai.busy,
      error: ai.error,
      applyLabel: "Apply",
      onApply: ai.onApply,
      onRetry: ai.onRun,
      onCancel: ai.onClose
    }
  ) : /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: ai.onRun,
      disabled: !ai.online,
      title: ai.online ? "" : "Offline — Claude needs a connection",
      style: {
        width: "100%",
        padding: "9px 12px",
        background: ai.online ? "#faf5ff" : "#f8fafc",
        border: `1.5px solid ${ai.online ? "#c4b5fd" : "#e2e8f0"}`,
        borderRadius: 8,
        cursor: ai.online ? "pointer" : "default",
        fontSize: 12,
        fontWeight: 600,
        color: ai.online ? "#5b21b6" : "#94a3b8",
        textAlign: "left",
        marginBottom: 4
      }
    },
    "✨ Ask Claude to clarify this",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: ai.online ? "#8b5cf6" : "#cbd5e1", marginTop: 2 } }, "Suggests where it belongs — you approve before anything changes")
  )), /* @__PURE__ */ React.createElement(Divider, { label: "Actionable" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPhase("doit"),
      style: { padding: "9px 12px", background: "#ecfdf5", border: "1.5px solid #34d399", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, textAlign: "left", color: "#065f46", width: "100%" }
    },
    "✅ Do it now — under 2 minutes",
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#10b981", marginTop: 2 } }, "Starts a 2-min timer — mark done when finished")
  ), /* @__PURE__ */ React.createElement(Opt, { bg: "#f5f3ff", border: "#c4b5fd", color: "#5b21b6", onClick: () => {
    setNaTitle(item.title);
    setNaCtx("@anywhere");
    setNaDue("");
    setNaDueTime("");
    setNaStart("");
    setPhase("next");
  } }, "⚡ Next Action — you do it"), /* @__PURE__ */ React.createElement(Opt, { bg: "#f5f3ff", border: "#ddd6fe", color: "#4338ca", onClick: () => {
    setNaTitle("");
    setNaCtx("@anywhere");
    setNaDue("");
    setNaDueTime("");
    setNaStart("");
    setPhase("project");
  } }, "📋 Project — multiple steps needed"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: from,
      onChange: (e) => setFrom(e.target.value),
      placeholder: "Waiting from whom?",
      style: { padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12, outline: "none" }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "date",
      value: due,
      onChange: (e) => setDue(e.target.value),
      style: { padding: "7px 9px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 12 }
    }
  ), /* @__PURE__ */ React.createElement(Opt, { bg: "#fffbeb", border: "#fde68a", color: "#92400e", onClick: () => onMove("waiting", { waitingFor: from, dueDate: due }) }, "⏳ Waiting For — someone else does it")), /* @__PURE__ */ React.createElement(Divider, { label: "Not actionable" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement(Opt, { bg: "#f0fdf4", border: "#86efac", color: "#166534", onClick: () => onMove("someday", {}) }, "🌟 Someday/Maybe — revisit when the time is right"), /* @__PURE__ */ React.createElement(Opt, { bg: "#eff6ff", border: "#93c5fd", color: "#1e40af", onClick: () => onMove("reference", {}) }, "📁 Reference — keep for future lookup"), /* @__PURE__ */ React.createElement(Opt, { bg: "#f8fafc", border: "#e2e8f0", color: "#475569", onClick: onTrash }, "🗑️ Trash — not needed")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, fontSize: 10, color: "#94a3b8", textAlign: "center", fontStyle: "italic" } }, "Click outside to come back to this item later.")));
}
function PomoSettings({ config, onChange }) {
  const [draft, setDraft] = useState({});
  const fields = [["work", "Pomodoro", "min"], ["short", "Short break", "min"], ["long", "Long break", "min"], ["every", "Long break every", "sessions"]];
  const save = (k) => {
    if (draft[k] == null) return;
    if (draft[k] !== "") onChange(pomoSettings({ ...config, [k]: draft[k] }));
    setDraft((d) => ({ ...d, [k]: null }));
  };
  return /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 } }, fields.map(([k, label, unit]) => /* @__PURE__ */ React.createElement("label", { key: k, style: { fontSize: 11, color: "#475569", fontWeight: 600 } }, label, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontWeight: 400 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: POMO_LIMITS[k][0],
      max: POMO_LIMITS[k][1],
      className: "in in-sm",
      style: { width: 64 },
      value: draft[k] != null ? draft[k] : config[k],
      onChange: (e) => setDraft({ ...draft, [k]: e.target.value }),
      onBlur: () => save(k),
      onKeyDown: (e) => {
        if (e.key === "Enter") e.target.blur();
      }
    }
  ), unit)))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: 6 } }, "Syncs to your other devices. A session already running keeps its length."));
}
function DataModal({ counts, archiveCount, pomoConfig, onPomoConfig, contexts, onAddContext, onDelContext, onExport, onImport, cloud, ai, onClose }) {
  const total = LISTS.reduce((n, l) => n + (counts[l] || 0), 0);
  const [newCtx, setNewCtx] = useState("");
  const fireAddCtx = () => {
    if (newCtx.trim()) {
      onAddContext(newCtx);
      setNewCtx("");
    }
  };
  const [key, setKey] = useState(""), [keyWarn, setKeyWarn] = useState("");
  const a = ai || {};
  const saveKey = () => {
    const v = key.trim();
    if (!v) return;
    setKeyWarn(v.startsWith("sk-ant-") ? "" : "That doesn't look like an Anthropic key, saving it anyway.");
    a.onSave && a.onSave(v);
    setKey("");
  };
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 };
  const box = { background: "#fff", borderRadius: 14, padding: 22, width: 420, maxWidth: "92vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.2)" };
  const card = (bg, border, color) => ({ padding: "11px 13px", background: bg, border: `1.5px solid ${border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color, textAlign: "left", width: "100%" });
  const head = { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 };
  const c = cloud || {};
  return /* @__PURE__ */ React.createElement("div", { style: overlay, onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { style: box }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 4 } }, "⇅ Sync & Backup"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#64748b", marginBottom: 14, lineHeight: 1.5 } }, "Keep devices in sync via your own OneDrive, or move data manually with a file.", /* @__PURE__ */ React.createElement("strong", null, " ", total), " item", total !== 1 ? "s" : "", " on this device", archiveCount ? ` (+ ${archiveCount} archived)` : "", "."), /* @__PURE__ */ React.createElement("div", { style: head }, "Cloud sync — OneDrive"), !c.configured ? /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 13px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 11, color: "#92400e", lineHeight: 1.5, marginBottom: 16 } }, "Not set up yet. Register a free Azure app, paste its ", /* @__PURE__ */ React.createElement("strong", null, "client ID"), " into", /* @__PURE__ */ React.createElement("code", { style: { background: "#fef3c7", padding: "0 4px", borderRadius: 3, margin: "0 2px" } }, "MS_CLIENT_ID"), "in ", /* @__PURE__ */ React.createElement("code", { style: { background: "#fef3c7", padding: "0 4px", borderRadius: 3 } }, "index.html"), ", then reload. See the README → “Cloud sync via OneDrive”.") : !c.account ? /* @__PURE__ */ React.createElement("button", { onClick: c.onConnect, style: { ...card("#eff6ff", "#3b82f6", "#1e40af"), marginBottom: 16 } }, "☁ Connect OneDrive", /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#3b82f6", marginTop: 2 } }, "Sign in with your Microsoft account — syncs every device, no server")) : /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: "#1e293b", marginBottom: 2 } }, "☁ Connected"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 2, wordBreak: "break-all" } }, c.account.username || "OneDrive"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginBottom: 10 } }, c.syncing ? "Syncing…" : c.lastSynced ? `Last synced ${relTime(c.lastSynced)}` : "Not synced yet"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: c.onSyncNow,
      disabled: c.syncing,
      style: { flex: 1, padding: "7px", background: c.syncing ? "#e2e8f0" : "#6366f1", color: c.syncing ? "#94a3b8" : "#fff", border: "none", borderRadius: 7, cursor: c.syncing ? "default" : "pointer", fontSize: 12, fontWeight: 600 }
    },
    c.syncing ? "Syncing…" : "↻ Sync now"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: c.onDisconnect,
      style: { padding: "7px 12px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#64748b" }
    },
    "Disconnect"
  ))), /* @__PURE__ */ React.createElement("div", { style: head }, "Claude — AI assistant"), !a.hasKey ? /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", lineHeight: 1.5, marginBottom: 8 } }, "Paste an Anthropic API key to turn on Clarify, project breakdowns, the Weekly Review coach and the Agent. Leave it blank and the app behaves exactly as before."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "in in-sm",
      style: { flex: 1 },
      type: "password",
      value: key,
      autoComplete: "off",
      spellCheck: false,
      placeholder: "sk-ant-…",
      onChange: (e) => setKey(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && saveKey()
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: saveKey, className: "btn btn-pri btn-sm" }, "Save")), keyWarn && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#b45309", marginTop: 6 } }, keyWarn), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: 6 } }, "Get one at console.anthropic.com. Each device needs its own — the key is never synced.")) : /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: "#1e293b", marginBottom: 2 } }, "✨ Key saved"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginBottom: 2, wordBreak: "break-all" } }, a.masked), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "#94a3b8", marginBottom: 10 } }, /* @__PURE__ */ React.createElement(ModelSelect, { value: a.model, onChange: a.onModel }), !a.online && "offline"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: a.onTest,
      disabled: a.test === "…",
      style: { flex: 1, padding: "7px", background: a.test === "…" ? "#e2e8f0" : "#6366f1", color: a.test === "…" ? "#94a3b8" : "#fff", border: "none", borderRadius: 7, cursor: a.test === "…" ? "default" : "pointer", fontSize: 12, fontWeight: 600 }
    },
    a.test === "…" ? "Testing…" : "↻ Test key"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: a.onClear,
      style: { padding: "7px 12px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#64748b" }
    },
    "Remove"
  )), a.test && a.test !== "…" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, marginTop: 8, color: a.test.ok ? "#065f46" : "#b91c1c" } }, a.test.ok ? "✓ The key works." : a.test.msg)), /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 13px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 11, color: "#92400e", lineHeight: 1.5, marginBottom: 16 } }, "The key is stored unencrypted in this device's browser storage. It is never synced to OneDrive and never written into a backup file — but any script running on this page could read it. Use a key with a ", /* @__PURE__ */ React.createElement("strong", null, "spend limit"), " set in the Anthropic Console, and revoke it if you lose the device."), /* @__PURE__ */ React.createElement("div", { style: head }, "Pomodoro"), /* @__PURE__ */ React.createElement(PomoSettings, { config: pomoConfig, onChange: onPomoConfig }), /* @__PURE__ */ React.createElement("div", { style: head }, "Contexts"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 } }, (contexts || []).map((c2) => /* @__PURE__ */ React.createElement("span", { key: c2, className: "chip", style: { display: "inline-flex", alignItems: "center", gap: 5, cursor: "default" } }, c2, c2 !== "@anywhere" && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onDelContext(c2),
      title: `Remove ${c2}`,
      style: { background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 12, lineHeight: 1, padding: 0 }
    },
    "×"
  )))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "in in-sm",
      style: { flex: 1 },
      value: newCtx,
      placeholder: "@new-context",
      onChange: (e) => setNewCtx(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && fireAddCtx()
    }
  ), /* @__PURE__ */ React.createElement("button", { onClick: fireAddCtx, className: "btn btn-pri btn-sm" }, "Add")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: 6 } }, "Contexts live in your data and sync everywhere. Removing one doesn't touch existing items.")), /* @__PURE__ */ React.createElement("div", { style: head }, "Export"), /* @__PURE__ */ React.createElement("button", { onClick: onExport, style: { ...card("#f5f3ff", "#6366f1", "#4338ca"), marginBottom: 16 } }, "💾 Save backup file", /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#6366f1", marginTop: 2 } }, "Downloads gtd-backup-….json (uses the share sheet on phones)")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 } }, "Import from a backup file"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => onImport("merge"), style: card("#f0fdf4", "#10b981", "#065f46") }, "➕ Merge — keep both", /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#10b981", marginTop: 2 } }, "Adds the file's items to this device (same items aren't duplicated)")), /* @__PURE__ */ React.createElement("button", { onClick: () => onImport("replace"), style: card("#fef2f2", "#fca5a5", "#b91c1c") }, "♻️ Replace — overwrite this device", /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 400, color: "#ef4444", marginTop: 2 } }, "Discards what's here and loads the file exactly"))), /* @__PURE__ */ React.createElement("button", { onClick: onClose, className: "btn btn-ghost btn-sm", style: { marginTop: 14, width: "100%" } }, "Close")));
}
const Tag = ({ bg, c, children }) => /* @__PURE__ */ React.createElement("span", { style: { background: bg, color: c, fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 500 } }, children);
function EmptyState({ list, ctx }) {
  const m = {
    inbox: ["🎉", "Inbox Zero!", "Everything's captured and clarified. Mind like water."],
    next: ["⚡", "Clear horizons.", "No next actions — process your inbox."],
    projects: ["📋", "No projects yet.", "Add outcomes needing more than one step."],
    waiting: ["⏳", "Nothing waiting.", "Track items you've delegated to others."],
    someday: ["🌟", "Dream big.", "Capture ideas to revisit someday."],
    reference: ["📁", "No reference material.", "Store non-actionable items you want to keep."],
    done: ["🎉", "Nothing completed yet.", "Mark items done and they'll appear here."]
  };
  const [icon, title, sub] = m[list] || ["✨", "Empty", ""];
  return /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "52px 20px", color: "#94a3b8" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 38, marginBottom: 10 } }, icon), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "#475569" } }, title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, marginTop: 4 } }, list === "next" && ctx !== "all" ? `No actions in ${ctx}.` : sub));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
