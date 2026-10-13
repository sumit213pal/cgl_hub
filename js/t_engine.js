// Test engine: question pools, selection, attempts (paper / section timers), scoring, spaced mistakes, recalculation.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { MIN_Q, DAY, SPACED, MASTER_AFTER, KIND, shuffle, clamp, r2, dayKey, timerPlan, parseHist, fmtDateTime } from "./t_util.js";
import { indexString } from "./csv.js";

export function initEngine(X) {
  const { S, db, toast } = X;
  const finalizing = new Set(), advancing = new Set();

  // ---------- pool (built from the light-weight qindex docs: 1 read per subject) ----------
  // index item: id|topic|diff(e/m/h)|year|status(v=verified,r=needs review)|textKey|optionsKey
  let memo = { a: null, b: null, all: [], raw: [], by: {} };
  const build = () => {
    if (memo.a === S.qindex && memo.b === S.flags) return;
    const flagged = new Set(S.flags.map(f => f.id));
    memo = { a: S.qindex, b: S.flags, all: [], raw: [], by: {} };
    for (const d of S.qindex) for (const s of d.items || []) {
      const [id, t, df, y, st, tk, ok] = s.split("|");
      const o = { id, t, d: df, y, st: st || "r", tk, ok, s: d.id, flag: flagged.has(id) };
      memo.by[id] = o; memo.raw.push(o); if (!o.flag) memo.all.push(o);   // questions reported by students are held back from random tests
    }
  };
  X.allPool = () => { build(); return memo.all; };
  X.rawPool = () => { build(); return memo.raw; };
  X.metaOf = id => { build(); return memo.by[id]; };
  X.scope = (f = {}) => X.allPool().filter(q => (!f.subject || q.s === f.subject) && (!f.topic || q.t === f.topic) && (!f.diff || q.d === String(f.diff)[0]) && (!f.verifiedOnly || q.st === "v") && (!f.pyq || q.y));
  X.seen = () => { const s = new Set(); S.attempts.forEach(a => (a.questionIds || []).forEach(id => s.add(id))); return s; };
  X.dupMaps = () => {
    build(); const ids = new Set(memo.raw.map(q => q.id)), tk = new Map(), ok = new Map();
    memo.raw.forEach(q => { if (q.tk) tk.set(q.tk, q.id); if (q.ok) ok.set(q.ok + "|" + q.t, q.id); });
    return { ids, tk, ok };
  };
  X.subjName = id => (SUBJECT_MAP[id]?.name || id).split(" (")[0];
  X.subjIcon = id => SUBJECT_MAP[id]?.icon || "";

  // ---------- statistics from my submitted attempts (learning-mode attempts are kept separate unless asked for) ----------
  X.submitted = (o = {}) => S.attempts.filter(a => a.status === "submitted" && a.result && (o.learning || a.mode !== "learning")).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  X.examAttempts = key => S.attempts.filter(a => (a.paperId === key || a.testId === key) && a.status === "submitted" && a.mode !== "learning" && a.result).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  X.stats = (o = {}) => {
    const byTopic = {}, bySubject = {};
    const add = (m, k, v) => { const x = (m[k] ||= { c: 0, w: 0, u: 0, t: 0 }); x.c += v.c; x.w += v.w; x.u += v.u; x.t += v.t || 0; };
    const att = X.submitted(o);
    att.forEach(a => { Object.entries(a.result.byTopic || {}).forEach(([k, v]) => add(byTopic, k, v)); Object.entries(a.result.bySubject || {}).forEach(([k, v]) => add(bySubject, k, v)); });
    return { byTopic, bySubject, attempts: att };
  };
  X.weakTopics = (limit = 5) => {
    const st = X.stats();
    return Object.entries(st.byTopic).map(([t, v]) => ({ t, v, att: v.c + v.w, acc: v.c / Math.max(1, v.c + v.w) * 100 }))
      .filter(x => x.att >= MIN_Q && x.acc < 75 && TOPIC_MAP[x.t]).sort((a, b) => a.acc - b.acc).slice(0, limit);
  };
  const topicWeight = (t, st) => { const v = st.byTopic[t], att = v ? v.c + v.w : 0; if (att >= MIN_Q) return 0.1 + (1 - v.c / att) * 0.9; return att > 0 ? 0.35 : 0.3; };

  // ---------- selection ----------
  const weighted = (cands, n, wf) => cands.map(q => ({ q, k: Math.pow(Math.random(), 1 / Math.max(0.01, wf(q))) })).sort((a, b) => b.k - a.k).slice(0, n).map(x => x.q);
  X.weightedPick = (cands, n) => { const st = X.stats(); return weighted(cands, n, q => topicWeight(q.t, st)); };
  const order = (p, seen, prefer) => prefer ? [...shuffle(p.filter(q => !seen.has(q.id))), ...shuffle(p.filter(q => seen.has(q.id)))] : shuffle(p);
  X.order = order;
  X.pickBlueprint = (rows, { preferUnseen = true, verifiedOnly = false } = {}) => {
    const seen = X.seen(), used = new Set(), picked = [], short = [];
    for (const r of rows) {
      const cnt = Number(r.count) || 0;
      const p = order(X.scope({ subject: r.subject, topic: r.topic, diff: r.diff, verifiedOnly }).filter(q => !used.has(q.id)), seen, preferUnseen);
      const take = p.slice(0, cnt); take.forEach(q => { used.add(q.id); picked.push(q); });
      if (take.length < cnt) short.push(`${X.subjName(r.subject)}${r.topic ? " › " + (TOPIC_MAP[r.topic]?.name || "") : ""}: need ${cnt}, ${verifiedOnly ? "verified " : ""}bank has ${take.length}`);
    }
    return { picked, short };
  };
  X.mistakeIds = (unresolvedOnly = true) => S.mistakes.filter(m => !unresolvedOnly || !m.resolved).map(m => m.qid);
  X.dueMistakes = () => S.mistakes.filter(m => !m.resolved && (m.due || 0) <= Date.now());
  X.smartPick = (n = 20) => {
    const all = X.allPool(); if (!all.length) return [];
    const seen = X.seen(), used = new Set(), out = [];
    const add = arr => { for (const q of arr) { if (out.length >= n) break; if (q && !used.has(q.id)) { used.add(q.id); out.push(q); } } };
    add(shuffle(X.dueMistakes().map(m => m.qid)).map(X.metaOf).filter(q => q && !q.flag).slice(0, Math.round(n * 0.3)));
    add(shuffle(X.mistakeIds(true)).map(X.metaOf).filter(q => q && !q.flag).slice(0, Math.round(n * 0.1)));
    add(X.weightedPick(all.filter(q => !used.has(q.id)), Math.round(n * 0.4)));
    add(shuffle(all.filter(q => !used.has(q.id) && !seen.has(q.id))).slice(0, n - out.length));
    add(X.weightedPick(all.filter(q => !used.has(q.id)), n - out.length));
    return out;
  };

  // ---------- loading ----------
  X.cache = { q: {}, k: {} };
  X.loadQuestions = async ids => { const need = ids.filter(id => !X.cache.q[id]); if (need.length) (await db.getMany("questions", need)).forEach(d => (X.cache.q[d.id] = d)); return ids.map(id => X.cache.q[id]).filter(Boolean); };
  X.loadKeys = async ids => { const need = ids.filter(id => !X.cache.k[id]); if (need.length) (await db.getMany("answerKeys", need)).forEach(d => (X.cache.k[d.id] = d)); return ids.map(id => X.cache.k[id]).filter(Boolean); };

  // ---------- availability / attempts ----------
  X.availability = it => {
    const now = Date.now(), f = it.availableFrom || 0, u = it.availableUntil || 0;
    if (f && now < f) return { state: "upcoming", open: false, msg: `Opens ${fmtDateTime(f)}` };
    if (u && now > u) return { state: "closed", open: false, msg: `Closed ${fmtDateTime(u)}` };
    return { state: "open", open: true, msg: u ? `Closes ${fmtDateTime(u)}` : "" };
  };
  X.attemptsLeft = (it, kind) => {
    const used = S.attempts.filter(a => (kind === "paper" ? a.paperId === it.id : a.testId === it.id) && a.mode !== "learning").length;
    return it.maxAttempts > 0 ? Math.max(0, it.maxAttempts - used) : null;
  };
  X.itemOf = a => (a.paperId ? S.papers.find(p => p.id === a.paperId) : a.testId ? S.tests.find(t => t.id === a.testId) : null);
  X.solutionsLocked = a => { const it = X.itemOf(a); return !!(it && a.mode !== "learning" && it.solutionsAfter === "afterClose" && it.availableUntil && Date.now() < it.availableUntil); };

  X.groupsOfItem = it => it.sections ? it.sections.map(s => ({ sub: s.subject, n: s.count })) : (() => {
    const m = {}; (it.blueprint || []).forEach(r => (m[r.subject] = (m[r.subject] || 0) + (Number(r.count) || 0)));
    return SUBJECTS.filter(s => m[s.id]).map(s => ({ sub: s.id, n: m[s.id] }));
  })();
  // v3 compatibility: tests saved by the older version used timerMode (auto/manual/none) instead of timerType
  const normCfg = it => (it.timerType ? it : it.timerMode ? { ...it, timerType: it.timerMode === "none" ? "none" : "paper", paperMode: it.timerMode } : it);
  X.normAttempt = a => (a.timerType ? a : { ...a, timerType: a.deadline ? "paper" : "none" });
  X.planOf = it => timerPlan(normCfg(it), X.groupsOfItem(it));
  X.planOfCfg = (cfg, groups) => timerPlan(cfg, groups);
  const runsOf = picked => { const g = []; picked.forEach((q, i) => { const l = g[g.length - 1]; if (l && l.sub === q.s) { l.n++; l.to = i; } else g.push({ sub: q.s, n: 1, from: i, to: i }); }); return g; };

  // ---------- attempts ----------
  X.createAttempt = async o => {
    let ordered = o.picked;
    if (!o.ordered) {
      const groups = SUBJECTS.map(s => o.picked.filter(q => q.s === s.id)).filter(g => g.length);
      ordered = groups.flatMap(g => (o.shuffleQ === false ? g : shuffle(g)));
    }
    const ids = ordered.map(q => q.id), qmeta = Object.fromEntries(ordered.map(q => [q.id, `${q.s}|${q.t}`]));
    const optionOrder = {}; if (o.shuffleOpt) ids.forEach(id => (optionOrder[id] = shuffle([0, 1, 2, 3])));
    const runs = runsOf(ordered);
    let plan = timerPlan(o.cfg || { timerType: "none" }, runs.map(r => ({ sub: r.sub, n: r.n })));
    const mode = o.mode === "learning" ? "learning" : "exam";
    if (mode === "learning") plan = o.useTimer && plan.durationSec ? { type: "paper", durationSec: plan.durationSec, sections: [] } : { type: "none", durationSec: 0, sections: [] };
    const now = Date.now();
    const data = {
      uid: S.me.uid, kind: o.kind || "practice", mode, title: o.title, testId: o.testId || "", paperId: o.paperId || "", daily: o.daily || "",
      questionIds: ids, qmeta, optionOrder, answers: {}, marked: {}, timeSpent: {}, visits: {}, hist: {}, last: 0, pos: Number(o.pos) || 2, neg: Number(o.neg) || 0,
      timerType: plan.type, durationSec: plan.durationSec, startedAt: now, deadline: plan.type === "paper" ? now + plan.durationSec * 1000 : 0, status: "running"
    };
    if (plan.type === "section") Object.assign(data, { secs: runs.map((r, i) => ({ sub: r.sub, from: r.from, to: r.to, sec: plan.sections[i].sec })), secIdx: 0, phase: "running", secStart: now, secDeadline: now + plan.sections[0].sec * 1000, secLog: {} });
    const id = await db.add("attempts", data);
    return { id, data };
  };
  X.beginAttempt = async o => {
    try { const { id, data } = await X.createAttempt(o); await X.openRunner(id, data); }
    catch (e) { console.error(e); toast("Could not start the test: " + (e.code || e.message)); }
  };
  const clampN = n => clamp(Math.round(Number(n) || 10), 1, 100);
  const cfgOf = it => { const n = normCfg(it); return { timerType: n.timerType || "none", paperMode: n.paperMode, secPerQ: n.secPerQ, manualMin: n.manualMin, secBySub: n.secBySub, minBySub: n.minBySub }; };

  X.startPaper = async (id, o = {}) => {
    const p = S.papers.find(x => x.id === id); if (!p) return;
    const run = S.attempts.find(a => a.paperId === id && a.status === "running"); if (run) return X.openRunner(run.id);
    const mode = o.mode === "learning" ? "learning" : "exam", av = X.availability(p);
    if (mode === "exam") {
      if (!av.open) return toast(`This paper is not open for exam mode – ${av.msg}.`);
      if (X.attemptsLeft(p, "paper") === 0) return toast("No exam attempts left. You can still use Learning mode.");
      if (p.requireVerified && (p.qids || []).some(q => X.metaOf(q)?.st !== "v")) return toast("This paper has unverified questions – the admin must verify it first.");
    } else if (av.state === "upcoming") return toast(`Not available yet – ${av.msg}.`);
    const picked = (p.qids || []).map(qid => { const [s, t] = (p.qmeta?.[qid] || "|").split("|"); return { id: qid, s: s || X.metaOf(qid)?.s, t: t || X.metaOf(qid)?.t }; }).filter(q => q.s);
    if (!picked.length) return toast("This paper has no questions.");
    await X.beginAttempt({ title: p.title, kind: "paper", mode, picked, ordered: true, paperId: id, pos: p.pos, neg: p.neg, cfg: cfgOf(p), useTimer: !!o.useTimer, shuffleOpt: !!p.shuffleOpt });
  };
  X.startTest = async (id, o = {}) => {
    const t = S.tests.find(x => x.id === id); if (!t) return;
    const run = S.attempts.find(a => a.testId === id && a.status === "running"); if (run) return X.openRunner(run.id);
    const mode = o.mode === "learning" ? "learning" : "exam", av = X.availability(t);
    if (mode === "exam") {
      if (!av.open) return toast(`This test is not open – ${av.msg}.`);
      if (X.attemptsLeft(t, "test") === 0) return toast("No exam attempts left. You can still use Learning mode.");
    } else if (av.state === "upcoming") return toast(`Not available yet – ${av.msg}.`);
    let picked;
    if (t.mode === "fixed") picked = (t.questionIds || []).map(qid => { const [s, tp] = (t.qmeta?.[qid] || "|").split("|"); return { id: qid, s, t: tp }; });
    else { const r = X.pickBlueprint(t.blueprint || [], { preferUnseen: true, verifiedOnly: !!t.verifiedOnly }); picked = r.picked; if (r.short.length) toast("Some sections have fewer questions in the bank than planned."); }
    if (!picked.length) return toast("This test has no questions available yet.");
    await X.beginAttempt({ title: t.title, kind: "mock", mode, picked, testId: id, pos: t.pos, neg: t.neg, cfg: cfgOf(t), useTimer: !!o.useTimer, shuffleQ: t.shuffleQ !== false, shuffleOpt: !!t.shuffleOpt });
  };
  X.startGen = async () => {
    const g = X.st.gen, n = clampN(g.count), seen = X.seen();
    const cands = X.scope({ subject: g.subject, topic: g.topic, diff: g.diff });
    let picked = [], kind = "practice", title = "Practice test";
    if (g.source === "random") { picked = order(cands, seen, true).slice(0, n); title = "Random practice"; }
    else if (g.source === "unseen") { picked = shuffle(cands.filter(q => !seen.has(q.id))).slice(0, n); title = "Unseen questions"; }
    else if (g.source === "weak") { picked = X.weightedPick(cands, n); kind = "weak"; title = "Weak-topic practice"; }
    else if (g.source === "mistakes") { const ids = new Set(X.mistakeIds(true)); picked = shuffle(cands.filter(q => ids.has(q.id))).slice(0, n); kind = "mistakes"; title = "Practice my mistakes"; }
    else if (g.source === "due") { const ids = new Set(X.dueMistakes().map(m => m.qid)); picked = shuffle(cands.filter(q => ids.has(q.id))).slice(0, n); kind = "mistakes"; title = "Mistakes due for review"; }
    if (!picked.length) return toast(g.source === "mistakes" || g.source === "due" ? "No mistakes match this filter." : g.source === "unseen" ? "You've seen every question in this selection. Try 'Random mix'." : "No questions available – ask the admin to import questions, or relax the filters.");
    if (picked.length < n) toast(`Only ${picked.length} questions available – starting with ${picked.length}.`);
    const cfg = { timerType: g.timerMode === "none" ? "none" : "paper", paperMode: g.timerMode, secPerQ: g.secPerQ, manualMin: g.manualMin };
    await X.beginAttempt({ title, kind, mode: g.learning ? "learning" : "exam", picked, pos: g.pos, neg: g.neg, cfg, useTimer: cfg.timerType !== "none", shuffleQ: true, shuffleOpt: !!g.shuffleOpt });
  };
  const quick = (title, kind, picked, extra = {}) => X.beginAttempt({ title, kind, picked, pos: 2, neg: 0.5, cfg: { timerType: "paper", paperMode: "auto", secPerQ: extra.sec || 45 }, shuffleQ: true, ...extra });
  X.startSmart = async (n = 20) => { const p = X.smartPick(n); if (!p.length) return toast("The question bank is empty – ask the admin to import questions first."); await quick("1-click revision test", "smart", p); };
  X.startIds = async (ids, title, kind) => {
    const picked = shuffle(ids).map(X.metaOf).filter(q => q && !q.flag).slice(0, 30);
    if (!picked.length) return toast("Nothing to practise yet."); await quick(title, kind, picked, { sec: 60 });
  };
  X.startTopic = async topicId => {
    const picked = order(X.scope({ topic: topicId }), X.seen(), true).slice(0, 10);
    if (!picked.length) return toast("No questions for this topic in the bank yet.");
    await quick(`Topic practice – ${TOPIC_MAP[topicId]?.name || ""}`, "topic", picked, { sec: 60 });
  };
  X.dailyAttempt = () => S.attempts.find(a => a.daily === dayKey());
  X.startDaily = async () => {
    const ex = X.dailyAttempt(); if (ex) return ex.status === "running" ? X.openRunner(ex.id) : (location.hash = "result/" + ex.id);
    const seen = X.seen();
    const pick = sub => { const py = X.scope({ subject: sub, pyq: true }); return order(py.length >= 5 ? py : X.scope({ subject: sub }), seen, true).slice(0, 5); };
    const picked = ["quant", "reasoning", "english", "ga"].flatMap(pick);
    if (!picked.length) return toast("The question bank is empty – ask the admin to import questions first.");
    await quick(`Daily PYQ drill · ${dayKey()}`, "daily", picked, { daily: dayKey() });
  };

  // ---------- smart reattempt options ----------
  X.reattemptIds = (a, kind) => {
    const q = a.result?.q || {}, ids = Object.keys(q), wrong = id => q[id][0] >= 0 && q[id][0] !== q[id][1], skip = id => q[id][0] < 0;
    if (kind === "wrong") return ids.filter(wrong); if (kind === "skip") return ids.filter(skip); if (kind === "both") return ids.filter(id => wrong(id) || skip(id));
    if (kind === "slow") return ids.filter(id => q[id][2] > 60);
    if (kind === "changed") return ids.filter(id => { const ev = parseHist(a.hist?.[id]); return ev.some((e, i) => i > 0 && e.o !== ev[i - 1].o); });
    return [];
  };
  X.startReattempt = async (aid, kind) => {
    const a = S.attempts.find(x => x.id === aid); if (!a?.result) return;
    if (kind === "full") {
      if (a.paperId) return X.openStart("paper", a.paperId); if (a.testId) return X.openStart("test", a.testId);
      return toast("Use one of the other re-attempt options for generated tests.");
    }
    let picked;
    if (kind === "weak") {
      const topics = new Set(Object.entries(a.result.byTopic || {}).filter(([t, v]) => v.w > 0 && v.c / Math.max(1, v.c + v.w) < 0.75 && TOPIC_MAP[t]).map(([t]) => t));
      const seen = X.seen(); picked = order(X.allPool().filter(q => topics.has(q.t)), seen, true).slice(0, 15);
    } else picked = X.reattemptIds(a, kind).map(X.metaOf).filter(q => q && !q.flag);
    if (!picked.length) return toast(kind === "weak" ? "No weak topics found in this attempt." : "No questions match that option.");
    const names = { wrong: "wrong", skip: "unattempted", both: "wrong + unattempted", slow: "slow", changed: "answer-changed", weak: "weak-topic" };
    await X.beginAttempt({ title: `Retest (${names[kind]}) – ${a.title}`.slice(0, 100), kind: "retest", picked, pos: a.pos, neg: a.neg, cfg: { timerType: "paper", paperMode: "auto", secPerQ: 60 }, shuffleQ: true });
  };
  X.startRetest = aid => X.startReattempt(aid, "wrong");

  // ---------- scoring ----------
  function changeStats(a, q, pos, neg) {
    let changed = 0, c2w = 0, w2c = 0, last2 = 0; const timed = a.timerType && a.timerType !== "none";
    for (const [id, h] of Object.entries(a.hist || {})) {
      const ev = parseHist(h), r = q[id]; if (ev.length < 2 || !r) continue;
      let prev = ev[0].o, ch = 0;
      for (let i = 1; i < ev.length; i++) { if (ev[i].o !== prev) { ch++; if (timed && ev[i].rem >= 0 && ev[i].rem <= 120) last2++; } prev = ev[i].o; }
      if (!ch) continue; changed++;
      const picks = ev.map(e => e.o).filter(o => o >= 0);
      if (r[0] >= 0 && r[0] !== r[1] && picks.includes(r[1])) c2w++;
      if (r[0] === r[1] && picks[0] !== undefined && picks[0] !== r[1]) w2c++;
    }
    return { changed, c2w, w2c, last2: timed ? last2 : -1, net: r2((w2c - c2w) * (pos + neg)) };
  }
  /** Build the full result from the per-question map q = {id: [chosen, correct, seconds]} (also used when an answer key is corrected). */
  X.buildResult = (a, q) => {
    const pos = Number(a.pos) || 0, neg = Number(a.neg) || 0, ids = a.questionIds || [];
    let c = 0, w = 0, u = 0; const byTopic = {}, bySubject = {}, secArr = (a.secs || []).map(s => ({ sub: s.sub, n: 0, c: 0, w: 0, u: 0, sec: s.sec }));
    ids.forEach((id, i) => {
      const r = q[id]; if (!r) return;
      const [sub, tp] = (a.qmeta?.[id] || "|").split("|"), t = r[2] || 0;
      // (guard: Firestore rejects empty map keys, so questions without topic/subject info only count towards the totals)
      const bt = tp ? (byTopic[tp] ||= { c: 0, w: 0, u: 0, t: 0 }) : { c: 0, w: 0, u: 0, t: 0 }, bs = sub ? (bySubject[sub] ||= { c: 0, w: 0, u: 0, t: 0 }) : { c: 0, w: 0, u: 0, t: 0 };
      bt.t += t; bs.t += t;
      const k = r[0] < 0 ? "u" : r[0] === r[1] ? "c" : "w";
      if (k === "c") { c++; bt.c++; bs.c++; } else if (k === "w") { w++; bt.w++; bs.w++; } else { u++; bt.u++; bs.u++; }
      const si = (a.secs || []).findIndex(s => i >= s.from && i <= s.to); if (si >= 0) { secArr[si].n++; secArr[si][k]++; }
    });
    const total = c + w + u, score = r2(c * pos - w * neg);
    const res = {
      score, max: r2(total * pos), correct: c, wrong: w, unattempted: u, total, accuracy: c + w ? Math.round((c / (c + w)) * 1000) / 10 : 0,
      percent: total && pos ? Math.round((score / (total * pos)) * 1000) / 10 : 0, timeUsed: Math.round(Object.values(q).reduce((s, r) => s + (r[2] || 0), 0)),
      byTopic, bySubject, q, chg: changeStats(a, q, pos, neg)
    };
    if (a.secs) res.bySection = secArr.map((s, i) => ({ ...s, used: a.secLog?.[i]?.used ?? 0, exp: a.secLog?.[i]?.exp ? 1 : 0, score: r2(s.c * pos - s.w * neg) }));
    return res;
  };

  X.finalize = async (aid, how = "manual", patch = {}) => {
    if (finalizing.has(aid)) return; finalizing.add(aid);
    try {
      const rs = X.runnerState(aid), cur = rs ? rs.a : S.attempts.find(x => x.id === aid);
      if (!cur) return;
      const a = { ...cur, ...(rs ? { answers: rs.answers, marked: rs.marked, timeSpent: rs.timeSpent, visits: rs.visits, hist: rs.hist, secLog: rs.secLog, secIdx: rs.secIdx } : {}), ...patch };
      const ids = a.questionIds || [], keys = await X.loadKeys(ids);
      if (!keys.length) { toast("Could not load the answer key – check your connection and try again."); return; }
      const q = {};
      ids.forEach(id => { const k = X.cache.k[id]; if (!k) return; const ans = a.answers?.[id]; q[id] = [ans === undefined || ans === null ? -1 : ans, k.correct, Math.round(a.timeSpent?.[id] || 0)]; });
      const result = X.buildResult(a, q), round = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Math.round(v * 10) / 10]));
      await db.update("attempts", aid, { answers: a.answers || {}, marked: a.marked || {}, timeSpent: round(a.timeSpent), visits: a.visits || {}, hist: a.hist || {}, secLog: a.secLog || {}, status: "submitted", submittedAt: Date.now(), result, phase: "done" });

      const jobs = [], day = dayKey(), now = Date.now();
      // mistake notebook with spaced revision (due in 1 day, then 3; mastered after 2 correct answers on separate days)
      for (const id of ids) {
        const r = q[id]; if (!r) continue;
        const [sub, tp] = (a.qmeta?.[id] || "|").split("|"), ex = S.mistakes.find(m => m.qid === id), docId = `${S.me.uid}_${id}`;
        if (r[0] >= 0 && r[0] !== r[1]) jobs.push(db.set("mistakes", docId, { uid: S.me.uid, qid: id, subject: sub, topicId: tp, count: (ex?.count || 0) + 1, resolved: false, mastered: false, stage: 0, okDays: [], due: now + SPACED[0] * DAY, wrongAt: now, lastAt: now }));
        else if (r[0] === r[1] && ex && !ex.resolved) {
          let ok = [...(ex.okDays || [])];
          if (!ok.includes(day) && dayKey(ex.wrongAt || ex.lastAt || 0) !== day) ok.push(day);
          if (ok.length >= MASTER_AFTER) jobs.push(db.set("mistakes", docId, { uid: S.me.uid, resolved: true, mastered: true, due: 0, okDays: ok, lastAt: now }));
          else { const stage = ok.length > (ex.okDays || []).length ? (ex.stage || 0) + 1 : (ex.stage || 0); jobs.push(db.set("mistakes", docId, { uid: S.me.uid, stage, okDays: ok, due: ok.length > (ex.okDays || []).length ? now + SPACED[Math.min(stage, SPACED.length - 1)] * DAY : ex.due || 0, lastAt: now })); }
        }
      }
      if (a.mode !== "learning") {
        const prev = S.progress[S.me.uid]?.tstats || {}, next = {};
        Object.entries(result.byTopic).forEach(([t, v]) => { if (t) next[t] = { c: (prev[t]?.c || 0) + v.c, w: (prev[t]?.w || 0) + v.w }; });
        jobs.push(db.set("progress", S.me.uid, { tstats: next }));
        jobs.push(db.set("scores", aid, { uid: S.me.uid, at: now, title: a.title, kind: a.kind, mode: a.mode, paperId: a.paperId || "", percent: result.percent, accuracy: result.accuracy, score: result.score, max: result.max, createdAt: now }));
      }
      const top = Object.entries(result.bySubject).sort((x, y) => (y[1].c + y[1].w + y[1].u) - (x[1].c + x[1].w + x[1].u))[0]?.[0] || "quant";
      jobs.push(db.add("logs", { uid: S.me.uid, date: dayKey(), hours: Math.max(0.05, Math.round((result.timeUsed / 3600) * 100) / 100), subject: top, note: `${KIND[a.kind] || "Test"}: ${a.title}` }));
      jobs.push(X.logActivity(`scored ${result.score}/${result.max} in ${a.title}`));
      await Promise.allSettled(jobs);

      if (rs) X.closeRunner();
      if (how === "auto") toast("⏰ Time's up – your test was submitted automatically.");
      location.hash = "result/" + aid;
    } catch (e) { console.error(e); toast("Submit failed: " + (e.code || e.message) + " – your answers are saved, try again."); }
    finally { finalizing.delete(aid); }
  };

  // ---------- sections that ran out of time while the tab was closed / in the background ----------
  X.autoAdvance = async a => {
    if (advancing.has(a.id)) return null; advancing.add(a.id);
    try {
      const i = a.secIdx || 0, s = a.secs[i], secLog = { ...(a.secLog || {}), [i]: { used: s.sec, exp: 1 } };
      if (i >= a.secs.length - 1) { await X.finalize(a.id, "auto", { secLog }); return { done: true }; }
      const patch = { secLog, secIdx: i + 1, phase: "break", secStart: 0, secDeadline: 0 };
      await db.update("attempts", a.id, patch); return { done: false, patch };
    } finally { advancing.delete(a.id); }
  };
  X.onAttempts = () => {
    S.attempts.filter(a => a.status === "running" && !X.runnerState(a.id)).map(X.normAttempt).forEach(a => {
      if (a.timerType === "paper" && a.deadline && Date.now() >= a.deadline && !finalizing.has(a.id)) X.finalize(a.id, "auto");
      else if (a.timerType === "section" && a.phase === "running" && a.secDeadline && Date.now() >= a.secDeadline) X.autoAdvance(a);
    });
  };

  // ---------- answer-key corrected → recalculate past attempts ----------
  X.recalcAttempts = async (qid, newCorrect) => {
    const list = await db.query("attempts", [["questionIds", qid, "array-contains"]], 500);
    let n = 0;
    for (const a of list) {
      if (a.status !== "submitted" || !a.result?.q?.[qid] || a.result.q[qid][1] === newCorrect) continue;
      const q = { ...a.result.q }; q[qid] = [q[qid][0], newCorrect, q[qid][2]];
      const res = X.buildResult(a, q);
      await db.update("attempts", a.id, { result: res, recalc: { at: Date.now(), qid, prev: a.result.score } });
      await db.update("scores", a.id, { percent: res.percent, accuracy: res.accuracy, score: res.score }).catch(() => {});
      n++;
    }
    return n;
  };

  // ---------- question status (verified / needs review) ----------
  X.setStatus = async (ids, status) => {
    const letter = status === "verified" ? "v" : "r";
    await db.batchUpdate(ids.map(id => ({ col: "questions", id, data: { status } })));
    const by = {}; ids.forEach(id => { const m = X.metaOf(id); if (m) (by[m.s] ||= new Set()).add(id); });
    for (const [sub, set] of Object.entries(by)) {
      const cur = (await db.get("qindex", sub))?.items || [];
      await db.set("qindex", sub, { items: cur.map(s => { const p = s.split("|"); if (set.has(p[0])) { p[4] = letter; } return p.join("|"); }), updatedAt: Date.now() });
    }
  };
}
