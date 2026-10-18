// Full-screen timed MCQ runner: whole-paper timer or per-section timers (finished sections lock), practice mode, autosave, resume.
import db from "./db.js";
import { SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { S, bus, toast } from "./state.js";
import { esc, clock, fmtDur, imgUrl } from "./util.js";
import { cache, loadQuestions, loadKeys, finalize, autoAdvance, subjName, subjIcon } from "./engine.js";

const L = "ABCD", $ = s => document.querySelector(s), host = () => $("#runner");
let R = null;

const sectioned = () => !!R.a.secs, sec = () => R.a.secs[R.secIdx], learn = () => R.a.mode === "learn";
const range = () => (sectioned() ? [sec().from, sec().to] : [0, R.qs.length - 1]);
const rounded = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
function commit() { if (!R || R.phase === "break") return; const now = Date.now(), id = R.qs[R.idx]?.id; if (id) R.timeSpent[id] = (R.timeSpent[id] || 0) + (now - R.tStart) / 1000; R.tStart = now; }
async function saveNow() {
  if (!R) return; clearTimeout(R.saveT); commit();
  const p = { answers: R.answers, marked: R.marked, timeSpent: rounded(R.timeSpent), last: R.idx };
  if (sectioned()) Object.assign(p, { secIdx: R.secIdx, phase: R.phase, secStart: R.secStart, secDeadline: R.secDeadline, secLog: R.secLog });
  try { await db.update("attempts", R.id, p); } catch (e) { console.warn("autosave failed", e.code); }
}
const queueSave = () => { clearTimeout(R.saveT); R.saveT = setTimeout(saveNow, 3000); };
const remNow = () => (sectioned() ? Math.max(0, Math.ceil((R.secDeadline - Date.now()) / 1000)) : R.a.timerType === "paper" ? Math.max(0, Math.ceil((R.a.deadline - Date.now()) / 1000)) : -1);

bus.runnerState = id => { if (!R || R.id !== id) return null; commit(); return { a: R.a, answers: R.answers, marked: R.marked, timeSpent: R.timeSpent, secLog: R.secLog, secIdx: R.secIdx }; };
bus.closeRunner = () => { if (R) { clearInterval(R.timer); clearTimeout(R.saveT); } R = null; host().classList.add("hidden"); host().innerHTML = ""; document.body.classList.remove("noscroll"); bus.render(); };
bus.openRunner = async (aid, data) => {
  let a = data ? { id: aid, ...data } : S.attempts.find(x => x.id === aid);
  if (!a) return toast("Test not found.");
  if (a.status !== "running") { location.hash = "result/" + aid; return; }
  if (a.timerType === "paper" && a.deadline && Date.now() >= a.deadline) return finalize(a.id, "auto");
  if (a.timerType === "section" && a.phase === "running" && a.secDeadline && Date.now() >= a.secDeadline) { const r = await autoAdvance(a); if (!r || r.done) return; a = { ...a, ...r.patch }; }
  if (R) bus.closeRunner();
  host().classList.remove("hidden"); document.body.classList.add("noscroll"); host().innerHTML = `<div class="r-loading">Loading questions…</div>`;
  let loaded = []; try { loaded = await loadQuestions(a.questionIds); if (a.mode === "learn") await loadKeys(a.questionIds); } catch (e) { console.error(e); }
  if (!loaded.length) { bus.closeRunner(); return toast("Couldn't load the questions. Check your connection."); }
  const map = Object.fromEntries(loaded.map(q => [q.id, q]));
  const qs = a.questionIds.map(id => map[id] || { id, subject: (a.qmeta?.[id] || "|").split("|")[0], topicId: (a.qmeta?.[id] || "|").split("|")[1], question: "(This question was removed from the bank.)", options: ["—", "—", "—", "—"] });
  R = { id: a.id, a, qs, idx: 0, answers: { ...(a.answers || {}) }, marked: { ...(a.marked || {}) }, timeSpent: { ...(a.timeSpent || {}) }, visited: new Set(Object.keys(a.answers || {})),
    secIdx: a.secIdx || 0, phase: a.phase === "break" ? "break" : "running", secStart: a.secStart || 0, secDeadline: a.secDeadline || 0, secLog: { ...(a.secLog || {}) }, tStart: Date.now(), saveT: null, warned: new Set(), pal: false, checked: {}, ending: false };
  const [f, t] = range(); R.idx = Math.min(Math.max(a.last || 0, f), t);
  R.timer = setInterval(tick, 1000); render(); tick();
};

function tick() {
  if (!R) return; const el = $("#rTimer"); if (!el || R.phase === "break") return; const a = R.a;
  if (sectioned()) {
    const rem = Math.ceil((R.secDeadline - Date.now()) / 1000);
    if (rem <= 0) { el.textContent = "00:00"; if (!R.ending) endSection("auto"); return; }
    el.textContent = clock(rem); el.classList.toggle("danger", rem <= 60);
    for (const th of [300, 60]) if (rem <= th && sec().sec > th * 1.5 && !R.warned.has(R.secIdx + ":" + th)) { R.warned.add(R.secIdx + ":" + th); toast(`⏳ ${th / 60} min left in this section`); break; }
  } else if (a.timerType === "paper") {
    const rem = Math.ceil((a.deadline - Date.now()) / 1000);
    if (rem <= 0) { el.textContent = "00:00"; if (!R.ending) { R.ending = true; clearInterval(R.timer); finalize(R.id, "auto"); } return; }
    el.textContent = clock(rem); el.classList.toggle("danger", rem <= 60);
    for (const th of [300, 60]) if (rem <= th && a.durationSec > th * 1.5 && !R.warned.has(th)) { R.warned.add(th); toast(`⏳ ${th / 60} min left`); break; }
  } else el.textContent = "⏱ " + clock((Date.now() - a.startedAt) / 1000);
}
function counts(f, t) { let ans = 0, mk = 0, nv = 0; for (let i = f; i <= t; i++) { const q = R.qs[i]; if (R.answers[q.id] !== undefined) ans++; if (R.marked[q.id]) mk++; if (!R.visited.has(q.id) && i !== R.idx) nv++; } return { ans, mk, nv, left: t - f + 1 - ans }; }

function render() {
  if (!R) return; if (R.phase === "break") return renderBreak();
  const a = R.a, q = R.qs[R.idx], qid = q.id, [f, t] = range(), n = R.qs.length, cur = R.answers[qid], marked = !!R.marked[qid], c = counts(f, t), chk = learn() && R.checked[qid], key = cache.k[qid];
  R.visited.add(qid);
  const subs = sectioned() ? a.secs.map(s => s.sub) : [...new Set(R.qs.map(x => x.subject))];
  const tabs = sectioned() ? a.secs.map((s, i) => `<span class="r-tab sec ${i < R.secIdx ? "done" : i === R.secIdx ? "on" : "lock"}">${i < R.secIdx ? "✓ " : i > R.secIdx ? "🔒 " : ""}${subjIcon(s.sub)} ${esc(subjName(s.sub))}</span>`).join("")
    : subs.length > 1 ? subs.map(sid => `<button class="r-tab ${sid === q.subject ? "on" : ""}" data-r="subj:${sid}">${subjIcon(sid)} ${esc(subjName(sid))}</button>`).join("") : "";
  const items = []; for (let i = f; i <= t; i++) items.push(i);
  const lastSec = !sectioned() || R.secIdx === a.secs.length - 1;
  host().innerHTML = `
    <div class="r-top"><div class="r-title"><b>${esc(a.title)}</b><small>${learn() ? "Practice mode · " : ""}${sectioned() ? `Section ${R.secIdx + 1}/${a.secs.length} · ${esc(subjName(sec().sub))} · ` : ""}${n} questions · +${a.pos}${a.neg ? ` / −${a.neg}` : ""}</small></div>
      <div class="r-timer ${a.timerType !== "none" ? "" : "free"}" id="rTimer">--:--</div>
      <div class="row"><button class="btn sm" data-r="exit">Save &amp; exit</button><button class="btn sm primary" data-r="submit">${lastSec ? "Submit test" : "Submit section"}</button></div></div>
    ${tabs ? `<div class="r-tabs">${tabs}</div>` : ""}
    <div class="r-body"><section class="r-main">
        <div class="r-qhead"><b>Question ${R.idx + 1} <span class="muted">of ${n}</span></b><span class="chip">${esc(TOPIC_MAP[q.topicId]?.name || "")}</span>${marked ? `<span class="chip warn">Marked</span>` : ""}</div>
        <div class="r-q">${esc(q.question)}</div>${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="" referrerpolicy="no-referrer">` : ""}
        <div class="r-opts">${[0, 1, 2, 3].map(o => { const isC = chk && key && o === key.correct, isBad = chk && key && cur === o && o !== key.correct;
          return `<button class="r-opt ${cur === o ? "on" : ""} ${isC ? "good" : ""} ${isBad ? "bad" : ""}" data-r="opt:${o}"><span>${L[o]}</span><div>${esc(q.options[o])}</div></button>`; }).join("")}</div>
        ${learn() && cur !== undefined && !chk ? `<button class="btn mt-s" data-r="check">✔ Check answer</button>` : ""}
        ${chk && key ? `<div class="expl"><b>${cur === key.correct ? "✅ Correct" : "❌ Correct answer is " + L[key.correct]}</b><p>${esc(key.explanation || "No explanation added yet.")}</p>${key.videoUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(key.videoUrl)}">▶ Watch solution</a>` : ""}</div>` : ""}
      </section>
      <aside class="r-pal ${R.pal ? "open" : ""}"><div class="r-cnt"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${c.left}<small>Left</small></span><span class="c-m">${c.mk}<small>Marked</small></span></div>
        ${sectioned() ? `<p class="small muted">🔒 You can't return to this section after submitting it.</p>` : ""}
        <div class="pal-grid">${items.map(i => { const x = R.qs[i], has = R.answers[x.id] !== undefined, m = R.marked[x.id], v = R.visited.has(x.id); return `<button class="pbtn ${m ? (has ? "pm pa" : "pm") : has ? "pa" : v ? "pn" : ""} ${i === R.idx ? "cur" : ""}" data-r="jump:${i}">${i + 1}</button>`; }).join("")}</div></aside></div>
    <div class="r-foot"><button class="btn" data-r="prev" ${R.idx === f ? "disabled" : ""}>← Prev</button><button class="btn" data-r="clear" ${cur === undefined ? "disabled" : ""}>Clear</button><button class="btn mobile-only" data-r="pal">☰</button><span class="grow"></span>
      <button class="btn" data-r="mark">${marked ? "Unmark" : "Mark &amp; next"}</button><button class="btn primary" data-r="next">${R.idx === t ? "Save" : "Save &amp; next"}</button></div>`;
  tick();
}
function renderBreak() {
  const a = R.a, pi = R.secIdx - 1, prev = a.secs[pi], next = a.secs[R.secIdx], c = counts(prev.from, prev.to), lg = R.secLog[pi] || {}, total = prev.to - prev.from + 1;
  host().innerHTML = `<div class="r-top"><div class="r-title"><b>${esc(a.title)}</b><small>Section break</small></div><div class="row"><button class="btn sm" data-r="exit">Save &amp; exit</button></div></div>
    <div class="r-tabs">${a.secs.map((s, i) => `<span class="r-tab sec ${i < R.secIdx ? "done" : i === R.secIdx ? "on" : "lock"}">${i < R.secIdx ? "✓ " : i > R.secIdx ? "🔒 " : ""}${subjIcon(s.sub)} ${esc(subjName(s.sub))}</span>`).join("")}</div>
    <div class="r-break"><div class="break-card"><h2>${subjIcon(prev.sub)} ${esc(subjName(prev.sub))} — done</h2>${lg.exp ? `<p class="chip warn">⏰ Time ran out for this section</p>` : ""}
      <div class="cnt-row"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${total - c.ans}<small>Unanswered</small></span><span class="c-v">${fmtDur(lg.used || 0)}<small>Time used</small></span></div>
      <p class="muted small">This section is locked now.</p><hr><h3>Next: ${subjIcon(next.sub)} ${esc(subjName(next.sub))}</h3><p>${next.to - next.from + 1} questions · <b>${fmtDur(next.sec)}</b></p>
      <button class="btn primary big" data-r="nextsec">▶ Start ${esc(subjName(next.sub))}</button><p class="small muted">Its timer starts when you press the button.</p></div></div>`;
}
function go(i) { commit(); const [f, t] = range(); R.idx = Math.max(f, Math.min(t, i)); R.pal = false; R.tStart = Date.now(); queueSave(); render(); host().querySelector(".r-main")?.scrollTo(0, 0); }
function pick(v) {
  const id = R.qs[R.idx].id; if (R.answers[id] === v || (v < 0 && R.answers[id] === undefined)) return;
  if (v < 0) { delete R.answers[id]; delete R.checked[id]; } else R.answers[id] = v; queueSave(); render();
}
async function endSection(how) {
  if (!R || R.ending) return; R.ending = true; commit();
  const i = R.secIdx, s = sec(), used = how === "auto" ? s.sec : Math.min(s.sec, Math.round((Date.now() - R.secStart) / 1000));
  R.secLog[i] = { used, exp: how === "auto" ? 1 : 0 };
  if (i >= R.a.secs.length - 1) { await saveNow(); await finalize(R.id, how, { secLog: R.secLog }); if (R) R.ending = false; return; }
  R.secIdx = i + 1; R.phase = "break"; R.secStart = 0; R.secDeadline = 0; R.ending = false; await saveNow(); render();
  if (how === "auto") toast(`⏰ ${subjName(s.sub)} time is over – section submitted.`);
}
function startNextSection() { const s = sec(), now = Date.now(); R.phase = "running"; R.secStart = now; R.secDeadline = now + s.sec * 1000; R.idx = s.from; R.tStart = now; saveNow(); render(); }
function confirmSubmit() {
  commit(); const [f, t] = range(), c = counts(f, t), rem = remNow(), lastSec = !sectioned() || R.secIdx === R.a.secs.length - 1;
  bus.modal(`<h2>${lastSec ? "Submit test?" : "Submit this section?"}</h2><div class="cnt-row"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${c.left}<small>Unanswered</small></span><span class="c-m">${c.mk}<small>Marked</small></span></div>
    ${rem >= 0 ? `<p class="muted">Time left${sectioned() ? " in this section" : ""}: <b>${clock(rem)}</b></p>` : ""}<p class="muted small">${sectioned() && !lastSec ? "🔒 You won't be able to return to this section." : "You can't change answers after submitting."}</p>
    <div class="row"><button class="btn primary" id="rConfirm">Yes, submit</button><button class="btn ghost" data-close="modal">Keep working</button></div>`);
  $("#rConfirm").onclick = () => { bus.closeModal(); if (sectioned()) endSection("manual"); else { R.ending = true; finalize(R.id, "manual"); } };
}
function act(s) {
  if (!R) return; const [k, arg] = s.split(":");
  if (k === "exit") { saveNow().then(() => { bus.closeRunner(); location.hash = "tests"; }); return; }
  if (R.phase === "break") { if (k === "nextsec") startNextSection(); return; }
  const qid = R.qs[R.idx].id;
  if (k === "opt") pick(Number(arg)); else if (k === "clear") pick(-1); else if (k === "next") go(R.idx + 1); else if (k === "prev") go(R.idx - 1);
  else if (k === "mark") { if (R.marked[qid]) { delete R.marked[qid]; queueSave(); render(); } else { R.marked[qid] = true; go(R.idx + 1); } }
  else if (k === "jump") go(Number(arg)); else if (k === "subj") go(R.qs.findIndex(q => q.subject === arg)); else if (k === "pal") { R.pal = !R.pal; render(); }
  else if (k === "check") { R.checked[qid] = true; render(); } else if (k === "submit") confirmSubmit();
}
host().addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) act(b.dataset.r); });
document.addEventListener("keydown", e => {
  if (!R || R.phase === "break" || !$("#modal").classList.contains("hidden") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (k.length === 1 && "abcd".includes(k)) act("opt:" + "abcd".indexOf(k)); else if (k.length === 1 && "1234".includes(k)) act("opt:" + (Number(k) - 1)); else if (e.key === "ArrowRight") act("next"); else if (e.key === "ArrowLeft") act("prev");
});
document.addEventListener("visibilitychange", () => { if (document.hidden && R) saveNow(); });
window.addEventListener("beforeunload", e => { if (R) { e.preventDefault(); e.returnValue = ""; } });
bus.isRunning = () => !!R;
