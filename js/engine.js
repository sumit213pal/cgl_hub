// Test engine: question pool, picking, attempts (paper / section timers), scoring, mistakes, answer-key recalculation.
import db from "./db.js";
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { S, ui, bus, toast } from "./state.js";
import { MIN_Q, shuffle, clamp, r2, dayKey, timerPlan, fmtDateTime } from "./util.js";

export const subjName = id => SUBJECT_MAP[id]?.short || id;
export const subjIcon = id => SUBJECT_MAP[id]?.icon || "";
export const cache = { q: {}, k: {} };
const finalizing = new Set(), advancing = new Set();

// ---------- question pool (from the tiny per-subject index docs: 1 read per subject) ----------
let memo = { a: null, b: null };
function build() {
  if (memo.a === S.qindex && memo.b === S.reports) return memo;
  const held = new Set(S.reports.filter(r => r.status !== "done").map(r => r.qid));   // reported questions are held back until the admin resolves the report
  memo = { a: S.qindex, b: S.reports, all: [], raw: [], by: {} };
  for (const d of S.qindex) for (const s of d.items || []) {
    const [id, t, df, y, tk, ok] = s.split("|"), o = { id, t, d: df, y, tk, ok, s: d.id, held: held.has(id) };
    memo.by[id] = o; memo.raw.push(o); if (!o.held) memo.all.push(o);
  }
  return memo;
}
export const pool = () => build().all;
export const rawPool = () => build().raw;
export const meta = id => build().by[id];
export const scope = (f = {}) => pool().filter(q => (!f.subject || q.s === f.subject) && (!f.topic || q.t === f.topic) && (!f.diff || q.d === String(f.diff)[0]) && (!f.pyq || q.y));
export const seenIds = () => { const s = new Set(); S.attempts.forEach(a => (a.questionIds || []).forEach(id => s.add(id))); return s; };
export function dupMaps() {
  const ids = new Set(), tk = new Map(), ok = new Map();
  rawPool().forEach(q => { ids.add(q.id); if (q.tk) tk.set(q.tk, q.id); if (q.ok) ok.set(q.ok + "|" + q.t, q.id); });
  return { ids, tk, ok };
}

// ---------- my statistics (practice-mode attempts are not counted) ----------
export const submitted = () => S.attempts.filter(a => a.status === "submitted" && a.result && a.mode !== "learn").sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
export function stats() {
  const byTopic = {}, bySubject = {}, add = (m, k, v) => { const x = (m[k] ||= { c: 0, w: 0, u: 0, t: 0 }); x.c += v.c; x.w += v.w; x.u += v.u; x.t += v.t || 0; };
  const attempts = submitted();
  attempts.forEach(a => { Object.entries(a.result.byTopic || {}).forEach(([k, v]) => add(byTopic, k, v)); Object.entries(a.result.bySubject || {}).forEach(([k, v]) => add(bySubject, k, v)); });
  return { byTopic, bySubject, attempts };
}
export function weakTopics(limit = 3) {
  return Object.entries(stats().byTopic).map(([t, v]) => ({ t, v, att: v.c + v.w, acc: v.c / Math.max(1, v.c + v.w) * 100 })).filter(x => x.att >= MIN_Q && x.acc < 75 && TOPIC_MAP[x.t]).sort((a, b) => a.acc - b.acc).slice(0, limit);
}

// ---------- picking questions ----------
export const order = (p, seen) => [...shuffle(p.filter(q => !seen.has(q.id))), ...shuffle(p.filter(q => seen.has(q.id)))];   // unseen first
function weightedPick(cands, n) {
  const st = stats(), w = q => { const v = st.byTopic[q.t], att = v ? v.c + v.w : 0; return att >= MIN_Q ? 0.1 + (1 - v.c / att) * 0.9 : att > 0 ? 0.35 : 0.3; };
  return cands.map(q => ({ q, k: Math.pow(Math.random(), 1 / Math.max(0.01, w(q))) })).sort((a, b) => b.k - a.k).slice(0, n).map(x => x.q);
}
export const mistakeIds = () => S.mistakes.filter(m => !m.resolved).map(m => m.qid);
export function pickCounts(counts) {
  const seen = seenIds(), picked = [], short = [];
  for (const s of SUBJECTS) { const n = Number(counts[s.id]) || 0; if (!n) continue; const take = order(scope({ subject: s.id }), seen).slice(0, n); picked.push(...take); if (take.length < n) short.push(`${s.short}: wanted ${n}, bank has ${take.length}`); }
  return { picked, short };
}

// ---------- loading ----------
export async function loadQuestions(ids) { const need = ids.filter(id => !cache.q[id]); if (need.length) (await db.getMany("questions", need)).forEach(d => (cache.q[d.id] = d)); return ids.map(id => cache.q[id]).filter(Boolean); }
export async function loadKeys(ids) { const need = ids.filter(id => !cache.k[id]); if (need.length) (await db.getMany("answerKeys", need)).forEach(d => (cache.k[d.id] = d)); return ids.map(id => cache.k[id]).filter(Boolean); }

// ---------- papers: window, attempts, timer ----------
export function availability(p) {
  const now = Date.now(), f = p.availableFrom || 0, u = p.availableUntil || 0;
  if (f && now < f) return { open: false, state: "upcoming", msg: `Opens ${fmtDateTime(f)}` };
  if (u && now > u) return { open: false, state: "closed", msg: `Closed ${fmtDateTime(u)}` };
  return { open: true, state: "open", msg: u ? `Closes ${fmtDateTime(u)}` : "" };
}
export const attemptsLeft = p => { const used = S.attempts.filter(a => a.paperId === p.id && a.mode !== "learn").length; return p.maxAttempts > 0 ? Math.max(0, p.maxAttempts - used) : null; };
export const groupsOf = p => (p.sections || []).map(s => ({ sub: s.subject, n: s.count }));
export const planOf = p => timerPlan(p, groupsOf(p));
export const examAttempts = paperId => S.attempts.filter(a => a.paperId === paperId && a.status === "submitted" && a.mode !== "learn" && a.result).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

// ---------- attempts ----------
const runsOf = picked => { const g = []; picked.forEach((q, i) => { const l = g.at(-1); if (l && l.sub === q.s) { l.n++; l.to = i; } else g.push({ sub: q.s, n: 1, from: i, to: i }); }); return g; };
async function begin(o) {
  try {
    let ordered = o.picked;
    if (!o.ordered) ordered = SUBJECTS.flatMap(s => shuffle(o.picked.filter(q => q.s === s.id)));
    const runs = runsOf(ordered), mode = o.mode === "learn" ? "learn" : "exam";
    let plan = timerPlan(o.cfg || { timerType: "none" }, runs.map(r => ({ sub: r.sub, n: r.n })));
    if (mode === "learn") plan = { type: "none", durationSec: 0, sections: [] };
    const now = Date.now(), ids = ordered.map(q => q.id);
    const data = { uid: S.me.uid, kind: o.kind || "practice", mode, title: o.title, paperId: o.paperId || "", daily: o.daily || "", questionIds: ids, qmeta: Object.fromEntries(ordered.map(q => [q.id, `${q.s}|${q.t}`])),
      answers: {}, marked: {}, timeSpent: {}, last: 0, pos: Number(o.pos ?? 2), neg: Number(o.neg ?? 0.5), timerType: plan.type, durationSec: plan.durationSec, startedAt: now, deadline: plan.type === "paper" ? now + plan.durationSec * 1000 : 0, status: "running" };
    if (plan.type === "section") Object.assign(data, { secs: runs.map((r, i) => ({ sub: r.sub, from: r.from, to: r.to, sec: plan.sections[i].sec })), secIdx: 0, phase: "running", secStart: now, secDeadline: now + plan.sections[0].sec * 1000, secLog: {} });
    const id = await db.add("attempts", data);
    await bus.openRunner(id, data);
  } catch (e) { console.error(e); toast("Could not start the test: " + (e.code || e.message)); }
}
const autoCfg = sec => ({ timerType: "paper", paperMode: "auto", secPerQ: sec });
const noQuestions = () => toast("No questions available yet – ask the admin to import some.");

export async function startPaper(id, mode = "exam") {
  const p = S.papers.find(x => x.id === id); if (!p) return;
  const run = S.attempts.find(a => a.paperId === id && a.status === "running"); if (run) return bus.openRunner(run.id);
  const av = availability(p);
  if (mode === "exam") { if (!av.open) return toast(`Exam mode isn't open – ${av.msg}.`); if (attemptsLeft(p) === 0) return toast("No exam attempts left – you can still use Practice mode."); }
  else if (av.state === "upcoming") return toast(`Not available yet – ${av.msg}.`);
  const picked = (p.qids || []).map(qid => { const [s, t] = (p.qmeta?.[qid] || "|").split("|"); return { id: qid, s, t }; }).filter(q => q.s);
  if (!picked.length) return toast("This paper has no questions.");
  await begin({ title: p.title, kind: "paper", mode: mode === "learn" ? "learn" : "exam", picked, ordered: true, paperId: id, pos: p.pos, neg: p.neg, cfg: p });
}
export async function startPractice() {
  const g = ui.gen, n = clamp(Math.round(Number(g.count) || 10), 1, 100), seen = seenIds(), cands = scope({ subject: g.subject, topic: g.topic, diff: g.diff });
  let picked = [], title = "Practice";
  if (g.source === "random") { picked = order(cands, seen).slice(0, n); title = "Random practice"; }
  else if (g.source === "unseen") { picked = shuffle(cands.filter(q => !seen.has(q.id))).slice(0, n); title = "Unseen questions"; }
  else if (g.source === "weak") { picked = weightedPick(cands, n); title = "Weak-topic practice"; }
  else if (g.source === "mistakes") { const ids = new Set(mistakeIds()); picked = shuffle(cands.filter(q => ids.has(q.id))).slice(0, n); title = "Practice my mistakes"; }
  if (!picked.length) return toast(g.source === "mistakes" ? "No mistakes match this filter." : g.source === "unseen" ? "You've seen all of these – try 'Random'." : "No questions match – relax the filters.");
  if (picked.length < n) toast(`Only ${picked.length} questions available.`);
  const cfg = g.timer === "none" ? { timerType: "none" } : { timerType: "paper", paperMode: g.timer, secPerQ: g.sec, manualMin: g.min };
  await begin({ title, kind: "practice", mode: g.learn ? "learn" : "exam", picked, cfg });
}
export async function startMini() {
  const { picked, short } = pickCounts(ui.mini); if (!picked.length) return noQuestions();
  if (short.length) toast("Not enough questions: " + short.join("; "));
  await begin({ title: "Mini mock", kind: "mini", picked, cfg: { timerType: "section" } });
}
export async function startDaily() {
  const ex = S.attempts.find(a => a.daily === dayKey()); if (ex) return ex.status === "running" ? bus.openRunner(ex.id) : (location.hash = "result/" + ex.id);
  const { picked } = pickCounts({ quant: 3, reasoning: 3, english: 2, ga: 2 }); if (!picked.length) return noQuestions();
  await begin({ title: "Daily drill · " + dayKey(), kind: "daily", picked, daily: dayKey(), cfg: autoCfg(40) });
}
export async function startMistakes() {
  const picked = shuffle(mistakeIds()).map(meta).filter(q => q && !q.held).slice(0, 20); if (!picked.length) return toast("No open mistakes – nice!");
  await begin({ title: "Practice my mistakes", kind: "mistakes", picked, cfg: autoCfg(60) });
}
export async function startSaved() {
  const picked = shuffle(S.bookmarks.map(b => b.qid)).map(meta).filter(Boolean).slice(0, 30); if (!picked.length) return toast("Nothing saved yet.");
  await begin({ title: "Practice saved questions", kind: "practice", picked, cfg: autoCfg(60) });
}
export async function startTopic(tid) {
  const picked = order(scope({ topic: tid }), seenIds()).slice(0, 10); if (!picked.length) return toast("No questions for this topic yet.");
  await begin({ title: `Topic practice – ${TOPIC_MAP[tid]?.name || ""}`, kind: "practice", picked, cfg: autoCfg(60) });
}
export const retestIds = (a, kind) => Object.entries(a.result?.q || {}).filter(([, v]) => (kind === "wrong" ? v[0] >= 0 && v[0] !== v[1] : v[0] !== v[1])).map(([id]) => id);
export async function startRetest(aid, kind) {
  const a = S.attempts.find(x => x.id === aid); if (!a?.result) return;
  const picked = retestIds(a, kind).map(meta).filter(q => q && !q.held); if (!picked.length) return toast("Nothing to retest.");
  await begin({ title: `Retest – ${a.title}`.slice(0, 100), kind: "retest", picked, pos: a.pos, neg: a.neg, cfg: autoCfg(60) });
}

// ---------- scoring ----------
export function buildResult(a, q) {
  const pos = Number(a.pos) || 0, neg = Number(a.neg) || 0, ids = a.questionIds || [];
  let c = 0, w = 0, u = 0; const byTopic = {}, bySubject = {}, secArr = (a.secs || []).map(s => ({ sub: s.sub, n: 0, c: 0, w: 0, u: 0, sec: s.sec }));
  ids.forEach((id, i) => {
    const r = q[id]; if (!r) return; const [sub, tp] = (a.qmeta?.[id] || "|").split("|"), t = r[2] || 0;
    const bt = tp ? (byTopic[tp] ||= { c: 0, w: 0, u: 0, t: 0 }) : { c: 0, w: 0, u: 0, t: 0 }, bs = sub ? (bySubject[sub] ||= { c: 0, w: 0, u: 0, t: 0 }) : { c: 0, w: 0, u: 0, t: 0 };
    bt.t += t; bs.t += t; const k = r[0] < 0 ? "u" : r[0] === r[1] ? "c" : "w";
    if (k === "c") { c++; bt.c++; bs.c++; } else if (k === "w") { w++; bt.w++; bs.w++; } else { u++; bt.u++; bs.u++; }
    const si = (a.secs || []).findIndex(s => i >= s.from && i <= s.to); if (si >= 0) { secArr[si].n++; secArr[si][k]++; }
  });
  const total = c + w + u, score = r2(c * pos - w * neg);
  const res = { score, max: r2(total * pos), correct: c, wrong: w, unattempted: u, total, accuracy: c + w ? Math.round(c / (c + w) * 1000) / 10 : 0, percent: total && pos ? Math.round(score / (total * pos) * 1000) / 10 : 0,
    timeUsed: Math.round(Object.values(q).reduce((s, r) => s + (r[2] || 0), 0)), byTopic, bySubject, q };
  if (a.secs) res.bySection = secArr.map((s, i) => ({ ...s, used: a.secLog?.[i]?.used ?? 0, exp: a.secLog?.[i]?.exp ? 1 : 0, score: r2(s.c * pos - s.w * neg) }));
  return res;
}
export async function finalize(aid, how = "manual", patch = {}) {
  if (finalizing.has(aid)) return; finalizing.add(aid);
  try {
    const rs = bus.runnerState(aid), cur = rs ? rs.a : S.attempts.find(x => x.id === aid); if (!cur) return;
    const a = { ...cur, ...(rs ? { answers: rs.answers, marked: rs.marked, timeSpent: rs.timeSpent, secLog: rs.secLog, secIdx: rs.secIdx } : {}), ...patch };
    const ids = a.questionIds || []; if (!(await loadKeys(ids)).length) { toast("Couldn't load the answer key – check your connection and try again."); return; }
    const q = {}; ids.forEach(id => { const k = cache.k[id]; if (!k) return; const ans = a.answers?.[id]; q[id] = [ans == null ? -1 : ans, k.correct, Math.round(a.timeSpent?.[id] || 0)]; });
    const result = buildResult(a, q), rounded = Object.fromEntries(Object.entries(a.timeSpent || {}).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    await db.update("attempts", aid, { answers: a.answers || {}, marked: a.marked || {}, timeSpent: rounded, secLog: a.secLog || {}, status: "submitted", submittedAt: Date.now(), result, phase: "done" });
    const jobs = [], now = Date.now();
    for (const id of ids) {   // mistake notebook: wrong → open again; correct twice → resolved
      const r = q[id]; if (!r) continue; const [sub, tp] = (a.qmeta?.[id] || "|").split("|"), ex = S.mistakes.find(m => m.qid === id), docId = `${S.me.uid}_${id}`;
      if (r[0] >= 0 && r[0] !== r[1]) jobs.push(db.set("mistakes", docId, { uid: S.me.uid, qid: id, subject: sub, topicId: tp, count: (ex?.count || 0) + 1, okCount: 0, resolved: false, lastAt: now }));
      else if (r[0] === r[1] && ex && !ex.resolved) { const ok = (ex.okCount || 0) + 1; jobs.push(db.set("mistakes", docId, { uid: S.me.uid, okCount: ok, resolved: ok >= 2, lastAt: now })); }
    }
    jobs.push(db.add("logs", { uid: S.me.uid, date: dayKey(), hours: Math.max(0.05, Math.round(result.timeUsed / 3600 * 100) / 100), subject: Object.keys(result.bySubject)[0] || "quant", note: a.title }));
    await Promise.allSettled(jobs);
    if (rs) bus.closeRunner();
    if (how === "auto") toast("⏰ Time's up – your test was submitted.");
    location.hash = "result/" + aid;
  } catch (e) { console.error(e); toast("Submit failed: " + (e.code || e.message) + " – your answers are saved, try again."); }
  finally { finalizing.delete(aid); }
}
export async function autoAdvance(a) {   // a section's time ran out while the tab was closed
  if (advancing.has(a.id)) return null; advancing.add(a.id);
  try {
    const i = a.secIdx || 0, s = a.secs[i], secLog = { ...(a.secLog || {}), [i]: { used: s.sec, exp: 1 } };
    if (i >= a.secs.length - 1) { await finalize(a.id, "auto", { secLog }); return { done: true }; }
    const patch = { secLog, secIdx: i + 1, phase: "break", secStart: 0, secDeadline: 0 }; await db.update("attempts", a.id, patch); return { done: false, patch };
  } finally { advancing.delete(a.id); }
}
export function onAttempts() {   // runs whenever my attempts change: close anything whose time has run out
  S.attempts.filter(a => a.status === "running" && !bus.runnerState(a.id)).forEach(a => {
    if (a.timerType === "paper" && a.deadline && Date.now() >= a.deadline && !finalizing.has(a.id)) finalize(a.id, "auto");
    else if (a.timerType === "section" && a.phase === "running" && a.secDeadline && Date.now() >= a.secDeadline) autoAdvance(a);
  });
}
/** Admin fixed an answer key → recompute everyone's affected scores. */
export async function recalcAttempts(qid, newCorrect) {
  let n = 0;
  for (const a of await db.query("attempts", [["questionIds", qid, "array-contains"]], 500)) {
    if (a.status !== "submitted" || !a.result?.q?.[qid] || a.result.q[qid][1] === newCorrect) continue;
    const q = { ...a.result.q }; q[qid] = [q[qid][0], newCorrect, q[qid][2]];
    await db.update("attempts", a.id, { result: buildResult(a, q), recalc: { at: Date.now(), prev: a.result.score } }); n++;
  }
  return n;
}
