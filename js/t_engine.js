// Test engine: question pools, random/weak-topic selection, attempt creation, scoring.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { MIN_Q, shuffle, clamp, r2, KIND } from "./t_util.js";

export function initEngine(X) {
  const { S, db, toast } = X;
  const finalizing = new Set();

  // ---------- pool (built from the light-weight qindex docs: 1 read per subject) ----------
  let memo = { ref: null, all: [], by: {} };
  const build = () => {
    if (memo.ref === S.qindex) return;
    memo = { ref: S.qindex, all: [], by: {} };
    for (const d of S.qindex) for (const s of d.items || []) {
      const [id, t, df, y] = s.split("|");
      const o = { id, t, d: df, y, s: d.id };
      memo.all.push(o); memo.by[id] = o;
    }
  };
  X.allPool = () => { build(); return memo.all; };
  X.metaOf = id => { build(); return memo.by[id]; };
  X.scope = (f = {}) => X.allPool().filter(q => (!f.subject || q.s === f.subject) && (!f.topic || q.t === f.topic) && (!f.diff || q.d === String(f.diff)[0]));
  X.seen = () => { const s = new Set(); S.attempts.forEach(a => (a.questionIds || []).forEach(id => s.add(id))); return s; };

  // ---------- statistics from my submitted attempts ----------
  X.submitted = () => S.attempts.filter(a => a.status === "submitted" && a.result).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  X.stats = () => {
    const byTopic = {}, bySubject = {};
    const add = (m, k, v) => { const o = (m[k] ||= { c: 0, w: 0, u: 0, t: 0 }); o.c += v.c; o.w += v.w; o.u += v.u; o.t += v.t || 0; };
    const att = X.submitted();
    att.forEach(a => {
      Object.entries(a.result.byTopic || {}).forEach(([k, v]) => add(byTopic, k, v));
      Object.entries(a.result.bySubject || {}).forEach(([k, v]) => add(bySubject, k, v));
    });
    return { byTopic, bySubject, attempts: att };
  };
  X.weakTopics = (limit = 5) => {
    const st = X.stats();
    return Object.entries(st.byTopic)
      .map(([t, v]) => ({ t, v, att: v.c + v.w, acc: v.c / Math.max(1, v.c + v.w) * 100 }))
      .filter(x => x.att >= MIN_Q && x.acc < 75 && TOPIC_MAP[x.t])
      .sort((a, b) => a.acc - b.acc).slice(0, limit);
  };
  const topicWeight = (t, st) => {
    const v = st.byTopic[t], att = v ? v.c + v.w : 0;
    if (att >= MIN_Q) return 0.1 + (1 - v.c / att) * 0.9;
    return att > 0 ? 0.35 : 0.3;
  };

  // ---------- selection ----------
  const weighted = (cands, n, wf) => cands.map(q => ({ q, k: Math.pow(Math.random(), 1 / Math.max(0.01, wf(q))) }))
    .sort((a, b) => b.k - a.k).slice(0, n).map(x => x.q);
  X.weightedPick = (cands, n) => { const st = X.stats(); return weighted(cands, n, q => topicWeight(q.t, st)); };
  const order = (p, seen, prefer) => prefer
    ? [...shuffle(p.filter(q => !seen.has(q.id))), ...shuffle(p.filter(q => seen.has(q.id)))] : shuffle(p);

  X.pickBlueprint = (rows, { preferUnseen = true } = {}) => {
    const seen = X.seen(), used = new Set(), picked = [], short = [];
    for (const r of rows) {
      const cnt = Number(r.count) || 0;
      const p = order(X.scope({ subject: r.subject, topic: r.topic, diff: r.diff }).filter(q => !used.has(q.id)), seen, preferUnseen);
      const take = p.slice(0, cnt);
      take.forEach(q => { used.add(q.id); picked.push(q); });
      if (take.length < cnt) short.push(`${SUBJECT_MAP[r.subject]?.name}${r.topic ? " › " + (TOPIC_MAP[r.topic]?.name || "") : ""}: need ${cnt}, bank has ${take.length}`);
    }
    return { picked, short };
  };
  X.mistakeIds = (unresolvedOnly = true) => S.mistakes.filter(m => !unresolvedOnly || !m.resolved).map(m => m.qid);

  X.smartPick = (n = 20) => {
    const all = X.allPool(); if (!all.length) return [];
    const seen = X.seen(), used = new Set(), out = [];
    const add = arr => { for (const q of arr) { if (out.length >= n) break; if (q && !used.has(q.id)) { used.add(q.id); out.push(q); } } };
    add(shuffle(X.mistakeIds(true)).map(X.metaOf).filter(Boolean).slice(0, Math.round(n * 0.3)));
    add(X.weightedPick(all.filter(q => !used.has(q.id)), Math.round(n * 0.4)));
    add(shuffle(all.filter(q => !used.has(q.id) && !seen.has(q.id))).slice(0, n - out.length));
    add(X.weightedPick(all.filter(q => !used.has(q.id)), n - out.length));
    return out;
  };

  // ---------- loading ----------
  X.cache = { q: {}, k: {} };
  X.loadQuestions = async ids => {
    const need = ids.filter(id => !X.cache.q[id]);
    if (need.length) (await db.getMany("questions", need)).forEach(d => (X.cache.q[d.id] = d));
    return ids.map(id => X.cache.q[id]).filter(Boolean);
  };
  X.loadKeys = async ids => {
    const need = ids.filter(id => !X.cache.k[id]);
    if (need.length) (await db.getMany("answerKeys", need)).forEach(d => (X.cache.k[d.id] = d));
    return ids.map(id => X.cache.k[id]).filter(Boolean);
  };

  // ---------- timer ----------
  X.calcDuration = (n, mode, sec, min) => {
    if (mode === "none") return 0;
    if (mode === "manual" && Number(min) > 0) return Math.round(Number(min) * 60);
    return Math.round(n * (Number(sec) || 45));
  };

  // ---------- attempts ----------
  X.createAttempt = async o => {
    const groups = SUBJECTS.map(s => o.picked.filter(q => q.s === s.id)).filter(g => g.length);
    const ordered = groups.flatMap(g => (o.shuffleQ === false ? g : shuffle(g)));
    const ids = ordered.map(q => q.id);
    const qmeta = Object.fromEntries(ordered.map(q => [q.id, `${q.s}|${q.t}`]));
    const optionOrder = {};
    if (o.shuffleOpt) ids.forEach(id => (optionOrder[id] = shuffle([0, 1, 2, 3])));
    const durationSec = X.calcDuration(ids.length, o.timerMode, o.secPerQ, o.manualMin);
    const now = Date.now();
    const data = {
      uid: S.me.uid, kind: o.kind || "practice", title: o.title, testId: o.testId || "", questionIds: ids, qmeta, optionOrder,
      answers: {}, marked: {}, timeSpent: {}, last: 0, pos: Number(o.pos) || 2, neg: Number(o.neg) || 0,
      durationSec, startedAt: now, deadline: durationSec ? now + durationSec * 1000 : 0, status: "running"
    };
    const id = await db.add("attempts", data);
    return { id, data };
  };
  X.beginAttempt = async o => {
    try {
      const { id, data } = await X.createAttempt(o);
      await X.openRunner(id, data);
    } catch (e) { console.error(e); toast("Could not start the test: " + (e.code || e.message)); }
  };

  const clampN = n => clamp(Math.round(Number(n) || 10), 1, 100);

  X.startTest = async testId => {
    const t = S.tests.find(x => x.id === testId); if (!t) return;
    const run = S.attempts.find(a => a.testId === testId && a.status === "running");
    if (run) return X.openRunner(run.id);
    const used = S.attempts.filter(a => a.testId === testId).length;
    if (t.maxAttempts > 0 && used >= t.maxAttempts) return toast("No attempts left for this test.");
    let picked;
    if (t.mode === "fixed") picked = (t.questionIds || []).map(id => { const [s, tp] = (t.qmeta?.[id] || "|").split("|"); return { id, s, t: tp }; });
    else { const r = X.pickBlueprint(t.blueprint || [], { preferUnseen: true }); picked = r.picked; if (r.short.length) toast("Some sections have fewer questions in the bank than planned."); }
    if (!picked.length) return toast("This test has no questions available yet.");
    await X.beginAttempt({ title: t.title, kind: "mock", testId: t.id, picked, pos: t.pos, neg: t.neg, timerMode: t.timerMode, secPerQ: t.secPerQ, manualMin: t.manualMin, shuffleQ: t.shuffleQ !== false, shuffleOpt: !!t.shuffleOpt });
  };

  X.startGen = async () => {
    const g = X.st.gen, n = clampN(g.count);
    const cands = X.scope({ subject: g.subject, topic: g.topic, diff: g.diff });
    const seen = X.seen();
    let picked = [], kind = "practice", title = "Practice test";
    if (g.source === "random") { picked = order(cands, seen, true).slice(0, n); title = "Random practice"; }
    else if (g.source === "unseen") { picked = shuffle(cands.filter(q => !seen.has(q.id))).slice(0, n); title = "Unseen questions"; }
    else if (g.source === "weak") { picked = X.weightedPick(cands, n); kind = "weak"; title = "Weak-topic practice"; }
    else if (g.source === "mistakes") {
      const ids = new Set(X.mistakeIds(true)); picked = shuffle(cands.filter(q => ids.has(q.id))).slice(0, n); kind = "mistakes"; title = "Practice my mistakes";
    }
    if (!picked.length) return toast(g.source === "mistakes" ? "No unresolved mistakes match this filter." : g.source === "unseen" ? "You've seen every question in this selection. Try 'Random mix'." : "No questions available – ask the admin to import questions, or relax the filters.");
    if (picked.length < n) toast(`Only ${picked.length} questions available – starting with ${picked.length}.`);
    await X.beginAttempt({ title, kind, picked, pos: g.pos, neg: g.neg, timerMode: g.timerMode, secPerQ: g.secPerQ, manualMin: g.manualMin, shuffleQ: true, shuffleOpt: !!g.shuffleOpt });
  };

  X.startSmart = async (n = 20) => {
    const picked = X.smartPick(n);
    if (!picked.length) return toast("The question bank is empty – ask the admin to import questions first.");
    await X.beginAttempt({ title: "1-click revision test", kind: "smart", picked, pos: 2, neg: 0.5, timerMode: "auto", secPerQ: 45, shuffleQ: true });
  };
  X.startRetest = async aid => {
    const a = S.attempts.find(x => x.id === aid); if (!a?.result) return;
    const ids = Object.entries(a.result.q || {}).filter(([, v]) => v[0] >= 0 && v[0] !== v[1]).map(([id]) => id);
    const picked = ids.map(X.metaOf).filter(Boolean);
    if (!picked.length) return toast(ids.length ? "Those questions are no longer in the bank." : "No wrong answers in this test – nice!");
    await X.beginAttempt({ title: `Retest – ${a.title}`, kind: "retest", picked, pos: a.pos, neg: a.neg, timerMode: "auto", secPerQ: 60, shuffleQ: true });
  };
  X.startIds = async (ids, title, kind) => {
    const picked = shuffle(ids).map(X.metaOf).filter(Boolean).slice(0, 30);
    if (!picked.length) return toast("Nothing to practise yet.");
    await X.beginAttempt({ title, kind, picked, pos: 2, neg: 0.5, timerMode: "auto", secPerQ: 60, shuffleQ: true });
  };
  X.startTopic = async topicId => {
    const picked = order(X.scope({ topic: topicId }), X.seen(), true).slice(0, 10);
    if (!picked.length) return toast("No questions for this topic in the bank yet.");
    await X.beginAttempt({ title: `Topic practice – ${TOPIC_MAP[topicId]?.name || ""}`, kind: "topic", picked, pos: 2, neg: 0.5, timerMode: "auto", secPerQ: 60, shuffleQ: true });
  };

  // ---------- scoring ----------
  X.finalize = async (aid, how = "manual") => {
    if (finalizing.has(aid)) return; finalizing.add(aid);
    try {
      const rs = X.runnerState(aid);
      const a = rs?.a || S.attempts.find(x => x.id === aid);
      if (!a) return;
      const answers = rs ? rs.answers : (a.answers || {}), marked = rs ? rs.marked : (a.marked || {}), timeSpent = rs ? rs.timeSpent : (a.timeSpent || {});
      const ids = a.questionIds || [];
      const keys = await X.loadKeys(ids);
      if (!keys.length) { toast("Could not load the answer key – check your connection and try again."); finalizing.delete(aid); return; }
      let c = 0, w = 0, u = 0;
      const byTopic = {}, bySubject = {}, q = {};
      for (const id of ids) {
        const k = X.cache.k[id]; if (!k) continue;
        const [sub, tp] = (a.qmeta?.[id] || "|").split("|");
        const t = Math.round(timeSpent[id] || 0), ans = answers[id];
        const bt = (byTopic[tp] ||= { c: 0, w: 0, u: 0, t: 0 }), bs = (bySubject[sub] ||= { c: 0, w: 0, u: 0, t: 0 });
        bt.t += t; bs.t += t;
        if (ans === undefined || ans === null) { u++; bt.u++; bs.u++; q[id] = [-1, k.correct, t]; }
        else if (ans === k.correct) { c++; bt.c++; bs.c++; q[id] = [ans, k.correct, t]; }
        else { w++; bt.w++; bs.w++; q[id] = [ans, k.correct, t]; }
      }
      const total = c + w + u, pos = Number(a.pos) || 0, neg = Number(a.neg) || 0;
      const result = {
        score: r2(c * pos - w * neg), max: r2(total * pos), correct: c, wrong: w, unattempted: u, total,
        accuracy: c + w ? Math.round((c / (c + w)) * 1000) / 10 : 0,
        percent: total ? Math.round(((c * pos - w * neg) / (total * pos || 1)) * 1000) / 10 : 0,
        timeUsed: Math.round(Object.values(timeSpent).reduce((s, v) => s + v, 0)), byTopic, bySubject, q
      };
      const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
      await db.update("attempts", aid, { answers, marked, timeSpent: round(timeSpent), status: "submitted", submittedAt: Date.now(), result });

      // mistake notebook + study log + activity (best effort)
      const jobs = [];
      for (const id of ids) {
        const r = q[id]; if (!r) continue;
        const [sub, tp] = (a.qmeta?.[id] || "|").split("|");
        const ex = S.mistakes.find(m => m.qid === id);
        if (r[0] >= 0 && r[0] !== r[1]) jobs.push(db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, qid: id, subject: sub, topicId: tp, count: (ex?.count || 0) + 1, resolved: false, lastAt: Date.now() }));
        else if (r[0] === r[1] && ex && !ex.resolved) jobs.push(db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, qid: id, resolved: true, lastAt: Date.now() }));
      }
      const top = Object.entries(bySubject).sort((x, y) => (y[1].c + y[1].w + y[1].u) - (x[1].c + x[1].w + x[1].u))[0]?.[0] || "quant";
      jobs.push(db.add("logs", { uid: S.me.uid, date: X.today(), hours: Math.max(0.05, Math.round((result.timeUsed / 3600) * 100) / 100), subject: top, note: `${KIND[a.kind] || "Test"}: ${a.title}` }));
      jobs.push(X.logActivity(`scored ${result.score}/${result.max} in ${a.title}`));
      await Promise.allSettled(jobs);

      if (rs) X.closeRunner();
      if (how === "auto") toast("⏰ Time's up – your test was submitted automatically.");
      location.hash = "result/" + aid;
    } catch (e) {
      console.error(e); toast("Submit failed: " + (e.code || e.message) + " – your answers are saved, try again.");
    } finally { finalizing.delete(aid); }
  };

  // attempts whose timer expired while the tab was closed → submit them automatically
  X.onAttempts = () => {
    S.attempts.filter(a => a.status === "running" && a.deadline && Date.now() >= a.deadline && !finalizing.has(a.id) && !X.runnerState(a.id))
      .forEach(a => X.finalize(a.id, "auto"));
  };
}
