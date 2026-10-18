// Student pages: Home, Tests (papers / practice / history), Result, Mistakes, Progress, Syllabus (+ topic drawer), Library.
import db from "./db.js";
import { ADMIN_EMAIL, TARGET_DATE } from "./config.js";
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { S, ui, bus, toast, A, f } from "./state.js";
import { esc, DAY, MIN_Q, STRONG, WEAK, fmtDur, fmtDate, fmtDay, ago, rate, topicState, stack, trendSVG, isUrl, ytId, drivePreview, imgUrl, download, timerPlan } from "./util.js";
import { toCSV } from "./csv.js";
import * as E from "./engine.js";
import { STATUS, users, nameOf, avatar, color, statusOf, pct, streak, weekHours, today } from "./people.js";

const $ = s => document.querySelector(s), L = "ABCD";
const fm = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return !m ? `${r}s` : r ? `${m}m ${r}s` : `${m}m`; };
const sel = (value, opts, attr) => `<select ${attr}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
export const statusSelect = tid => { const c = statusOf(S.me.uid, tid); return `<select class="status s-${c}" data-status="${tid}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${c === k ? "selected" : ""}>${v}</option>`).join("")}</select>`; };
const topicOpts = (sid, all = "All topics") => !sid ? [["", all]] : [["", all], ...SUBJECT_MAP[sid].topics.map(t => [t.id, `${t.name} (${E.scope({ topic: t.id }).length})`])];
const subjectOpts = (all = "All subjects") => [["", all], ...SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`])];

// ===================== HOME =====================
export function viewHome() {
  const me = S.me.uid, days = Math.ceil((new Date(TARGET_DATE) - new Date(today())) / DAY), notice = S.notices.find(n => n.id === "current" && n.text);
  const running = S.attempts.filter(a => a.status === "running"), daily = S.attempts.find(a => a.daily === new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)), open = E.mistakeIds().length, weak = E.weakTopics(3), bank = E.pool().length;
  return `
  <header class="page-head"><div><h1>Hi ${esc(S.me.name.split(" ")[0])} 👋</h1><p class="muted">${days > 0 ? `${days} days to your target (${esc(TARGET_DATE)})` : "Target date reached – keep going!"}</p></div>
    <div class="row"><button class="btn" data-a="logStudy">+ Log study</button><button class="btn ghost mobile-only" data-a="changePw">🔑</button><button class="btn ghost mobile-only" data-a="logout">Log out</button></div></header>
  ${notice ? `<div class="notice">📌 ${esc(notice.text)}</div>` : ""}
  <section class="card"><h2>Today</h2>
    ${running.map(a => `<div class="li"><span class="grow">▶ <b>${esc(a.title)}</b> is in progress</span><button class="btn sm primary" data-a="resume:${a.id}">Resume</button></div>`).join("")}
    <div class="li"><span class="grow">📅 Daily drill <span class="muted">(10 questions)</span>${daily?.status === "submitted" ? ` · <b>${daily.result.score}/${daily.result.max}</b>` : ""}</span>
      <button class="btn sm ${daily?.status === "submitted" ? "" : "primary"}" data-a="daily" ${bank ? "" : "disabled"}>${daily ? (daily.status === "running" ? "Resume" : "See result") : "Start"}</button></div>
    <div class="li"><span class="grow">❌ Mistakes to practise: <b>${open}</b></span><button class="btn sm" data-a="practiceMistakes" ${open ? "" : "disabled"}>Practise</button></div>
    <div class="li"><span class="grow">📝 Full papers &amp; mini mocks</span><a class="btn sm" href="#tests">Open Tests</a></div></section>
  <div class="grid two">
    <section class="card"><h2>My progress</h2>
      <div class="big-row"><div class="big-pct">${pct(me)}%</div><div class="grow"><div class="bar"><i style="width:${pct(me)}%"></i></div><div class="small muted">syllabus topics done · 🔥 ${streak(me)}-day streak · ⏱ ${weekHours(me)}h this week</div></div></div>
      <h3>Weak topics</h3>${weak.map(x => `<div class="li"><span class="grow">${esc(TOPIC_MAP[x.t].name)}</span><span class="chip off">${Math.round(x.acc)}%</span><button class="btn sm" data-a="practiceTopic:${x.t}">Practise</button></div>`).join("") || `<p class="muted small">${E.submitted().length ? "None right now 👍" : "Take a test and your weak topics will show up here."}</p>`}</section>
    <section class="card"><h2>Group</h2>${users().map(u => `<div class="prog-row">${avatar(u.id, 26)}<span class="name">${esc(u.name.split(" ")[0])}</span><div class="bar sm grow"><i style="width:${pct(u.id)}%;background:${color(u.id)}"></i></div><b>${pct(u.id)}%</b><span class="small muted">🔥${streak(u.id)}</span></div>`).join("")}</section>
  </div>`;
}
A.logStudy = () => {
  bus.modal(`<h2>Log study time</h2><form id="mForm" class="form"><label>Date<input type="date" name="date" class="input" value="${today()}" required></label>
    <label>Hours<input type="number" name="hours" class="input" min="0.25" max="18" step="0.25" value="2" required></label>
    <label>Subject<select name="subject" class="input">${SUBJECTS.map(s => `<option value="${s.id}">${s.icon} ${esc(s.name)}</option>`).join("")}</select></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
  $("#mForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); await db.add("logs", { uid: S.me.uid, date: v.date, hours: Number(v.hours), subject: v.subject, note: "" }); bus.closeModal(); toast("Logged ✔"); };
};

// ===================== TESTS =====================
function paperCard(p) {
  const mine = S.attempts.filter(a => a.paperId === p.id), run = mine.find(a => a.status === "running"), ex = E.examAttempts(p.id), pc = ex.map(a => a.result.percent), av = E.availability(p), left = E.attemptsLeft(p), plan = E.planOf(p);
  return `<div class="card paper"><div class="row"><b class="grow">${esc(p.title)}</b>${p.published ? "" : `<span class="chip low">Draft</span>`}</div>
    <div class="meta"><span>${p.total} questions</span>${(p.sections || []).length > 1 ? `<span>${p.sections.map(s => `${E.subjIcon(s.subject)}${s.count}`).join(" ")}</span>` : ""}<span>⏱ ${plan.type === "none" ? "no timer" : (plan.type === "section" ? "sections " : "") + fm(plan.durationSec)}</span><span>+${p.pos}/−${p.neg}</span></div>
    ${ex.length ? `<div class="small">Attempts <b>${ex.length}</b> · first <b>${pc[0]}%</b> · best <b>${Math.max(...pc)}%</b></div>` : ""}
    ${av.msg ? `<div class="small ${av.open ? "muted" : "down"}">${esc(av.msg)}</div>` : ""}${left !== null ? `<div class="small muted">${left} exam attempt${left === 1 ? "" : "s"} left</div>` : ""}
    <div class="row">${run ? `<button class="btn primary" data-a="resume:${run.id}">▶ Resume</button>` : `<button class="btn primary" data-a="openStart:${p.id}">Start</button>`}${ex.length ? `<a class="btn" href="#result/${ex.at(-1).id}">Last result</a>` : ""}</div></div>`;
}
function papersTab() {
  const all = S.papers.filter(p => p.published || S.me.isAdmin), years = [...new Set(all.map(p => String(p.year || "")))].filter(Boolean).sort().reverse(), shifts = [...new Set(all.map(p => p.shift).filter(Boolean))].sort();
  const list = all.filter(p => (!ui.pf.year || String(p.year) === ui.pf.year) && (!ui.pf.shift || p.shift === ui.pf.shift)).sort((a, b) => (b.examDate || String(b.year)).localeCompare(a.examDate || String(a.year)) || String(a.shift).localeCompare(String(b.shift)));
  const by = {}; list.forEach(p => (by[p.year || "Other"] ||= []).push(p));
  return `${all.length > 3 ? `<div class="toolbar">${f.select("pf.year", [["", "All years"], ...years.map(y => [y, y])], "data-rerender")}${f.select("pf.shift", [["", "All shifts"], ...shifts.map(s => [s, s])], "data-rerender")}</div>` : ""}
    ${Object.keys(by).sort().reverse().map(y => `<h3 class="year-h">${esc(y)}</h3><div class="grid cards">${by[y].map(paperCard).join("")}</div>`).join("") || `<div class="card"><p class="empty">No papers yet. ${S.me.isAdmin ? `Import a CSV in <a href="#admin">Admin → Questions</a> – papers are created automatically from <b>paperName + examDate + shift</b>.` : "The admin can add them by importing a CSV."}</p></div>`}`;
}
function practiceTab() {
  const g = ui.gen, avail = E.scope({ subject: g.subject, topic: g.topic, diff: g.diff }).length, n = Math.min(Number(g.count) || 0, avail), mini = ui.mini;
  const dur = g.timer === "none" ? "no timer" : fm(timerPlan({ timerType: "paper", paperMode: g.timer, secPerQ: g.sec, manualMin: g.min }, [{ sub: "x", n }]).durationSec);
  const miniPlan = timerPlan({ timerType: "section" }, SUBJECTS.filter(s => mini[s.id] > 0).map(s => ({ sub: s.id, n: Number(mini[s.id]) })));
  return `<section class="card"><h2>Quick practice</h2><div class="form-grid">
      <label>Questions from<div class="rg">${f.radio("gen.source", "random", "Random")}${f.radio("gen.source", "unseen", "Unseen only")}${f.radio("gen.source", "weak", "My weak topics")}${f.radio("gen.source", "mistakes", "My mistakes")}</div></label>
      <label>Subject${f.select("gen.subject", subjectOpts(), "data-rerender")}</label><label>Topic${f.select("gen.topic", topicOpts(g.subject), "data-rerender")}</label>
      <label>Difficulty${f.select("gen.diff", [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "data-rerender")}</label><label>Questions${f.num("gen.count", 'min="1" max="100" data-rerender')}</label>
      <label>Timer<div class="rg">${f.radio("gen.timer", "auto", "Auto")}${f.radio("gen.timer", "manual", "Manual")}${f.radio("gen.timer", "none", "None")}</div></label>
      ${g.timer === "auto" ? `<label>Seconds per question${f.select("gen.sec", [[30, "30"], [45, "45"], [60, "60"], [90, "90"]], "data-rerender")}</label>` : ""}${g.timer === "manual" ? `<label>Total minutes${f.num("gen.min", 'min="1" max="240" data-rerender')}</label>` : ""}
      <label class="center">${f.check("gen.learn", "Practice mode – see the answer after each question")}</label></div>
    <div class="sum">${avail} questions match · test will have <b>${n}</b> · ${g.learn ? "untimed" : dur} · +2 / −0.5</div><button class="btn primary" data-a="startPractice" ${avail ? "" : "disabled"}>Start</button></section>
    <section class="card"><h2>Mini mock <small class="muted">sections with their own timers</small></h2><div class="form-grid mini">${SUBJECTS.filter(s => ["quant", "reasoning", "english", "ga"].includes(s.id)).map(s => `<label>${s.icon} ${esc(s.short)}${f.num("mini." + s.id, 'min="0" max="50" data-rerender')}</label>`).join("")}</div>
      <div class="sum">${miniPlan.total} questions · ${miniPlan.sections.map(s => `${E.subjName(s.sub)} ${fm(s.sec)}`).join(" · ") || "–"} · total ${fm(miniPlan.durationSec)}</div><button class="btn primary" data-a="startMini">Start mini mock</button></section>`;
}
function historyTab() {
  return `<section class="card"><div class="table-wrap"><table class="list"><tr><th>Test</th><th>Score</th><th>Accuracy</th><th>Time</th><th>Date</th><th></th></tr>
    ${S.attempts.slice(0, 50).map(a => a.status === "running" ? `<tr><td>${esc(a.title)}</td><td colspan="4"><span class="chip warn">In progress</span></td><td><button class="btn sm primary" data-a="resume:${a.id}">Resume</button></td></tr>`
      : `<tr><td>${esc(a.title)}${a.mode === "learn" ? ` <span class="chip low">practice</span>` : ""}</td><td><b>${a.result.score}</b>/${a.result.max} <small class="muted">(${a.result.percent}%)</small></td><td>${a.result.accuracy}%</td><td>${fmtDur(a.result.timeUsed)}</td><td>${fmtDate(a.submittedAt)}</td><td><a class="btn sm" href="#result/${a.id}">Open</a></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No attempts yet.</td></tr>`}</table></div></section>`;
}
export function viewTests() {
  const running = S.attempts.filter(a => a.status === "running"), tabs = [["papers", "Papers"], ["practice", "Practice"], ["history", "History"]];
  return `<header class="page-head"><div><h1>Tests</h1><p class="muted">${E.pool().length} questions in the bank</p></div></header>
    ${running.map(a => `<div class="notice">▶ <span class="grow"><b>${esc(a.title)}</b> is in progress</span><button class="btn sm primary" data-a="resume:${a.id}">Resume</button></div>`).join("")}
    ${!E.pool().length ? `<div class="card tip"><b>The question bank is empty.</b> ${S.me.isAdmin ? `Import a CSV in <a href="#admin">Admin → Questions</a>.` : "Ask the admin to import the questions."}</div>` : ""}
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${ui.testTab === k ? "on" : ""}" data-a="ttab:${k}">${l}</button>`).join("")}</div>
    ${ui.testTab === "papers" ? papersTab() : ui.testTab === "practice" ? practiceTab() : historyTab()}`;
}
// start dialog: exam mode (timers, counts) or practice mode (untimed, answers shown)
function startDialog() {
  const p = S.papers.find(x => x.id === ui.start.id); if (!p) return; const m = ui.start.mode, plan = E.planOf(p), av = E.availability(p), left = E.attemptsLeft(p);
  const block = m === "exam" ? (!av.open ? `${av.msg} – exam mode isn't available right now.` : left === 0 ? "No exam attempts left." : "") : av.state === "upcoming" ? av.msg : "";
  bus.modal(`<h2>${esc(p.title)}</h2><p class="muted small">${p.total} questions · +${p.pos} / −${p.neg}</p>
    <div class="mode-pick"><label class="mode-card ${m === "exam" ? "on" : ""}"><input type="radio" name="start.mode" data-bind="start.mode" data-remodal value="exam" ${m === "exam" ? "checked" : ""}><b>🎯 Exam mode</b><small>${plan.type === "section" ? "Section timers, sections lock when submitted." : plan.type === "paper" ? "One timer for the whole paper." : "No timer."} Counts in your progress.</small></label>
      <label class="mode-card ${m === "learn" ? "on" : ""}"><input type="radio" name="start.mode" data-bind="start.mode" data-remodal value="learn" ${m === "learn" ? "checked" : ""}><b>📘 Practice mode</b><small>No timer, move freely, see the answer after each question. Not counted in progress.</small></label></div>
    ${m === "exam" && plan.type === "section" ? `<table class="list"><tr><th>Section</th><th>Qs</th><th>Time</th></tr>${plan.sections.map(s => `<tr><td>${E.subjIcon(s.sub)} ${esc(E.subjName(s.sub))}</td><td>${s.n}</td><td>${fm(s.sec)}</td></tr>`).join("")}<tr><th>Total</th><th>${plan.total}</th><th>${fm(plan.durationSec)}</th></tr></table>` : ""}
    ${m === "exam" && plan.type === "paper" ? `<p>⏱ <b>${fm(plan.durationSec)}</b> for the whole paper.</p>` : ""}${m === "exam" && left !== null ? `<p class="small muted">${left} exam attempt${left === 1 ? "" : "s"} left.</p>` : ""}
    ${block ? `<p class="msg">${esc(block)}</p>` : ""}<div class="row mt-s"><button class="btn primary big" data-a="doStart" ${block ? "disabled" : ""}>Start ${m === "exam" ? "exam" : "practice"}</button><button class="btn ghost" data-close="modal">Cancel</button></div>`);
}
A.openStart = id => { ui.start = { id, mode: "exam" }; startDialog(); bus.wireModal(); };
A.reopen = () => { startDialog(); bus.wireModal(); };
A.doStart = () => { const s = ui.start; bus.closeModal(); E.startPaper(s.id, s.mode); };
A.ttab = t => { ui.testTab = t; bus.render(); };
A.resume = id => bus.openRunner(id);
A.daily = () => E.startDaily(); A.startPractice = () => E.startPractice(); A.startMini = () => E.startMini();
A.practiceMistakes = () => E.startMistakes(); A.practiceSaved = () => E.startSaved(); A.practiceTopic = id => E.startTopic(id);

// ===================== QUESTION CARD + RESULT =====================
export function qCard(q, o = {}) {
  const k = E.cache.k[q.id], correct = o.correct ?? k?.correct, chosen = o.chosen, bm = S.bookmarks.some(b => b.qid === q.id);
  const opts = q.options.map((t, j) => { const isC = j === correct, isY = j === chosen && chosen >= 0; return `<div class="ropt ${isC ? "ok" : isY ? "bad" : ""}"><b>${L[j]}</b><span>${esc(t)}</span>${isC ? "<em>✔ Correct</em>" : isY ? "<em>✖ Your answer</em>" : ""}</div>`; }).join("");
  const exp = ui.exp[q.id] && k ? `<div class="expl"><b>Explanation</b><p>${esc(k.explanation || "No explanation has been added for this question yet.")}</p>${k.videoUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(k.videoUrl)}">▶ Watch solution</a>` : ""}</div>` : "";
  return `<div class="rcard ${o.state || ""}"><div class="rhead"><b>${o.no ? "Q" + o.no : ""}</b><span class="chip">${esc(TOPIC_MAP[q.topicId]?.name || "")}</span>${o.state === "ok" ? `<span class="chip ok">Correct</span>` : o.state === "bad" ? `<span class="chip off">Wrong</span>` : o.state === "skip" ? `<span class="chip low">Skipped</span>` : ""}${q.year ? `<small class="muted">PYQ ${esc(q.year)}</small>` : ""}${o.time !== undefined ? `<small class="muted">⏱ ${o.time}s</small>` : ""}</div>
    <div class="rq">${esc(q.question)}</div>${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="" referrerpolicy="no-referrer">` : ""}<div class="ropts">${opts}</div>${exp}
    <div class="row ractions"><button class="btn sm" data-a="explain:${q.id}">${ui.exp[q.id] ? "Hide" : "💡 Explanation"}</button><button class="btn sm ${bm ? "primary" : ""}" data-a="save:${q.id}">${bm ? "⭐ Saved" : "☆ Save"}</button><button class="btn sm ghost" data-a="report:${q.id}">🚩 Report</button></div></div>`;
}
A.explain = async id => { if (ui.exp[id]) delete ui.exp[id]; else { await E.loadKeys([id]); ui.exp[id] = true; } bus.render(); };
A.save = async id => { const ex = S.bookmarks.some(b => b.qid === id), docId = `${S.me.uid}_${id}`; if (ex) await db.remove("bookmarks", docId); else { const m = E.meta(id); await db.set("bookmarks", docId, { uid: S.me.uid, qid: id, subject: m?.s || "", topicId: m?.t || "", at: Date.now() }); } };
A.report = id => {
  bus.modal(`<h2>Report this question</h2><form id="mForm" class="form"><label>What's wrong?<select name="reason" class="input">${["Wrong answer key", "Incorrect option", "Question incomplete", "Explanation unclear", "Duplicate question", "Image missing", "Other"].map(r => `<option>${r}</option>`).join("")}</select></label>
    <label>Details (optional)<textarea name="text" class="input" rows="3" maxlength="500"></textarea></label><div class="row"><button class="btn primary">Send to admin</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>
    <p class="small muted">Until the admin checks it, this question won't appear in new random tests.</p>`);
  $("#mForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); await db.add("reports", { uid: S.me.uid, qid: id, reason: v.reason, text: v.text.trim(), status: "open" }); bus.closeModal(); toast("Thanks – the admin will check it ✔"); };
};
export function viewResult() {
  const a = S.attempts.find(x => x.id === S.arg); if (!a) return `<p class="empty">Loading…</p><a class="btn" href="#tests">Back to tests</a>`;
  if (a.status === "running") return `<div class="card"><b>This test is still in progress.</b> <button class="btn primary" data-a="resume:${a.id}">Resume</button></div>`;
  const r = a.result, rows = Object.entries(r.byTopic || {}).filter(([t]) => TOPIC_MAP[t]).map(([t, v]) => ({ t, v, st: topicState(v), tot: v.c + v.w + v.u, acc: rate(v.c, v.w) })).sort((x, y) => (x.acc ?? 101) - (y.acc ?? 101));
  const nWrong = E.retestIds(a, "wrong").length, nBoth = E.retestIds(a, "both").length, rv = ui.review[a.id], ex = a.paperId ? E.examAttempts(a.paperId) : [], idx = ex.findIndex(x => x.id === a.id), focus = rows.filter(x => x.v.w > 0).slice(0, 3);
  return `<header class="page-head"><div><a href="#tests" class="small">← Tests</a><h1>${esc(a.title)}</h1><p class="muted">${a.mode === "learn" ? "Practice mode · " : ""}${fmtDate(a.submittedAt)} · +${a.pos}${a.neg ? ` / −${a.neg}` : ""} marking</p></div>
      <div class="row"><button class="btn primary" data-a="retest:${a.id}:wrong" ${nWrong ? "" : "disabled"}>Retest wrong (${nWrong})</button><button class="btn" data-a="retest:${a.id}:both" ${nBoth ? "" : "disabled"}>Wrong + skipped (${nBoth})</button></div></header>
    ${a.recalc ? `<div class="notice">🔧 The admin corrected an answer key – your score changed from <b>${a.recalc.prev}</b> to <b>${r.score}</b>.</div>` : ""}
    <section class="card score"><div><small class="muted">Your score</small><div class="big-score">${r.score}<span>/ ${r.max}</span></div><div class="muted">${r.percent}% · accuracy ${r.accuracy}%${ex.length > 1 && idx >= 0 ? ` · attempt ${idx + 1} of ${ex.length} (first: ${ex[0].result.percent}%)` : ""}</div></div>
      <div class="chips2"><span class="c-a">${r.correct}<small>Correct</small></span><span class="c-n">${r.wrong}<small>Wrong</small></span><span class="c-v">${r.unattempted}<small>Skipped</small></span><span class="c-m">${fmtDur(r.timeUsed)}<small>Time${a.durationSec ? " of " + fmtDur(a.durationSec) : ""}</small></span></div></section>
    ${r.bySection ? `<section class="card"><h2>Sections</h2><div class="table-wrap"><table class="list"><tr><th>Section</th><th>Score</th><th>Accuracy</th><th>Answered</th><th>Time</th></tr>${r.bySection.map(s => `<tr><td>${E.subjIcon(s.sub)} ${esc(E.subjName(s.sub))}</td><td><b>${s.score}</b></td><td>${rate(s.c, s.w) ?? "–"}%</td><td>${s.c + s.w}/${s.n}</td><td>${fmtDur(s.used)} / ${fmtDur(s.sec)} ${s.exp ? `<span class="chip off">time up</span>` : ""}</td></tr>`).join("")}</table></div></section>` : ""}
    ${focus.length ? `<section class="card focus"><h2>Work on these next</h2><div class="row">${focus.map(x => `<div class="focus-item"><b>${esc(TOPIC_MAP[x.t].name)}</b><small>${x.v.c}/${x.v.c + x.v.w} correct</small><button class="btn sm" data-a="practiceTopic:${x.t}">Practise 10</button></div>`).join("")}</div></section>` : ""}
    <section class="card"><h2>Topics</h2><p class="small muted">Strong ≥ ${STRONG}% · Needs revision ${WEAK}–${STRONG - 1}% · Weak &lt; ${WEAK}% (judged after ${MIN_Q}+ attempted questions)</p>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct</th><th style="width:30%">Result</th><th>Status</th></tr>${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c}/${x.tot}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="chip ${x.st.cls}">${x.st.label}</span></td></tr>`).join("")}</table></div></section>
    <section class="card"><div class="row"><h2 class="grow">Review &amp; explanations</h2>${rv ? ["all", "wrong", "skip"].map(k => `<button class="tab ${rv.filter === k ? "on" : ""}" data-a="rfilter:${a.id}:${k}">${{ all: "All", wrong: "Wrong", skip: "Skipped" }[k]}</button>`).join("") : ""}</div>
      ${rv ? a.questionIds.map((id, i) => { const q = E.cache.q[id], x = r.q?.[id]; if (!q || !x) return ""; const state = x[0] < 0 ? "skip" : x[0] === x[1] ? "ok" : "bad"; if ((rv.filter === "wrong" && state !== "bad") || (rv.filter === "skip" && state !== "skip")) return ""; return qCard(q, { no: i + 1, chosen: x[0], correct: x[1], state, time: x[2] }); }).join("") || `<p class="empty">Nothing here.</p>`
        : `<p class="muted">See each question with your answer, the correct answer and the explanation.</p><button class="btn primary" data-a="review:${a.id}">Open review</button>`}</section>`;
}
A.review = async id => { const a = S.attempts.find(x => x.id === id); await E.loadQuestions(a.questionIds); ui.review[id] = { filter: "all" }; bus.render(); };
A.rfilter = arg => { const [id, k] = arg.split(":"); ui.review[id].filter = k; bus.render(); };
A.retest = arg => { const [id, k] = arg.split(":"); E.startRetest(id, k); };

// ===================== MISTAKES =====================
export function viewMistakes() {
  const open = S.mistakes.filter(m => !m.resolved), list = S.mistakes.filter(m => ui.nbShow === "all" || (ui.nbShow === "done" ? m.resolved : !m.resolved)).sort((a, b) => (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) || (b.lastAt || 0) - (a.lastAt || 0));
  const row = (id, head, right) => `<div class="nb-row"><div class="nb-h">${head}${right}</div>${ui.open[id] && E.cache.q[id] ? qCard(E.cache.q[id]) : ""}</div>`;
  return `<header class="page-head"><div><h1>Mistakes</h1><p class="muted">Questions you got wrong. Answer one correctly twice and it's marked done.</p></div>
      <div class="row">${ui.nbTab === "mistakes" ? `<button class="btn primary" data-a="practiceMistakes" ${open.length ? "" : "disabled"}>Practise (${open.length})</button><button class="btn ghost" data-a="exportMistakes">⬇ CSV</button>` : `<button class="btn primary" data-a="practiceSaved" ${S.bookmarks.length ? "" : "disabled"}>Practise saved (${S.bookmarks.length})</button>`}</div></header>
    <div class="tabs"><button class="tab ${ui.nbTab === "mistakes" ? "on" : ""}" data-a="nbtab:mistakes">❌ Mistakes <small>${open.length}</small></button><button class="tab ${ui.nbTab === "saved" ? "on" : ""}" data-a="nbtab:saved">⭐ Saved <small>${S.bookmarks.length}</small></button></div>
    <section class="card">${ui.nbTab === "mistakes" ? `<div class="toolbar">${["open", "done", "all"].map(s => `<button class="tab ${ui.nbShow === s ? "on" : ""}" data-a="nbshow:${s}">${{ open: "Open", done: "Done", all: "All" }[s]}</button>`).join("")}</div>`
        + (list.map(m => row(m.qid, `<div class="grow"><b>${esc(TOPIC_MAP[m.topicId]?.name || "Question")}</b> <small class="muted">${E.subjIcon(m.subject)} ${esc(E.subjName(m.subject))}</small> <span class="chip off">wrong ×${m.count || 1}</span>${m.resolved ? ` <span class="chip ok">done</span>` : ""}</div>`, `<button class="btn sm" data-a="toggleq:${m.qid}">${ui.open[m.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-a="resolve:${m.qid}">${m.resolved ? "Reopen" : "✓ Done"}</button>`)).join("") || `<p class="empty">Nothing here. Wrong answers from your tests appear automatically.</p>`)
      : [...S.bookmarks].sort((a, b) => (b.at || 0) - (a.at || 0)).map(b => row(b.qid, `<div class="grow"><b>${esc(TOPIC_MAP[b.topicId]?.name || "Saved question")}</b> <small class="muted">${E.subjIcon(b.subject)} ${esc(E.subjName(b.subject))}</small></div>`, `<button class="btn sm" data-a="toggleq:${b.qid}">${ui.open[b.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-a="save:${b.qid}">Remove</button>`)).join("") || `<p class="empty">Tap ☆ Save on any question in a result review.</p>`}</section>`;
}
A.nbtab = t => { ui.nbTab = t; bus.render(); }; A.nbshow = s => { ui.nbShow = s; bus.render(); };
A.toggleq = async id => { if (ui.open[id]) delete ui.open[id]; else { await Promise.all([E.loadQuestions([id]), E.loadKeys([id])]); if (!E.cache.q[id]) return toast("This question is no longer in the bank."); ui.open[id] = true; } bus.render(); };
A.resolve = async id => { const ex = S.mistakes.find(m => m.qid === id); await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, resolved: !ex?.resolved, okCount: ex?.resolved ? 0 : 2 }); };
A.exportMistakes = async () => {
  const ids = S.mistakes.map(m => m.qid); await Promise.all([E.loadQuestions(ids), E.loadKeys(ids)]);
  download("my_mistakes.csv", toCSV(S.mistakes.map(m => { const q = E.cache.q[m.qid], k = E.cache.k[m.qid]; return { topic: TOPIC_MAP[m.topicId]?.name || "", question: q?.question || "(removed)", A: q?.options?.[0] || "", B: q?.options?.[1] || "", C: q?.options?.[2] || "", D: q?.options?.[3] || "", correct: k ? L[k.correct] : "", explanation: k?.explanation || "", timesWrong: m.count || 1, status: m.resolved ? "done" : "open" }; }), ["topic", "question", "A", "B", "C", "D", "correct", "explanation", "timesWrong", "status"]));
};

// ===================== PROGRESS =====================
export function viewProgress() {
  const st = E.stats(), att = st.attempts;
  if (!att.length) return `<header class="page-head"><div><h1>Progress</h1></div></header><div class="card"><p class="empty">Take your first test to see your trend and topic-wise accuracy.</p><a class="btn primary" href="#tests">Go to Tests</a></div>`;
  const trend = att.slice(-15), subs = Object.entries(st.bySubject);
  const rows = Object.entries(st.byTopic).filter(([t, v]) => TOPIC_MAP[t] && v.c + v.w > 0 && (!ui.progSubject || TOPIC_MAP[t].subject === ui.progSubject)).map(([t, v]) => ({ t, v, s: topicState(v), acc: rate(v.c, v.w) })).sort((a, b) => a.acc - b.acc);
  const papers = S.papers.map(p => ({ p, ex: E.examAttempts(p.id) })).filter(x => x.ex.length);
  return `<header class="page-head"><div><h1>Progress</h1><p class="muted">${att.length} test${att.length > 1 ? "s" : ""} in exam mode (practice mode isn't counted)</p></div></header>
    <div class="grid two"><section class="card"><h2>Score trend</h2>${trendSVG(trend.map(a => Math.max(0, a.result.percent)), trend.map(a => fmtDate(a.submittedAt)))}</section>
      <section class="card"><h2>Subjects</h2>${subs.map(([sid, v]) => `<div class="sub-row"><div class="sub-h"><b>${E.subjIcon(sid)} ${esc(E.subjName(sid))}</b><span class="small">${rate(v.c, v.w) ?? "–"}% · ${Math.round(v.t / Math.max(1, v.c + v.w + v.u))}s/question</span></div>${stack(v.c, v.w, v.u)}</div>`).join("")}</section></div>
    ${papers.length ? `<section class="card"><h2>Papers</h2><div class="table-wrap"><table class="list"><tr><th>Paper</th><th>Attempts</th><th>First</th><th>Best</th><th>Last</th></tr>${papers.map(({ p, ex }) => { const pc = ex.map(a => a.result.percent); return `<tr><td>${esc(p.title)}</td><td>${ex.length}</td><td>${pc[0]}%</td><td><b>${Math.max(...pc)}%</b></td><td>${pc.at(-1)}%</td></tr>`; }).join("")}</table></div></section>` : ""}
    <section class="card"><div class="row"><h2 class="grow">Topics (weakest first)</h2><button class="tab ${!ui.progSubject ? "on" : ""}" data-a="progsub:">All</button>${SUBJECTS.filter(s => subs.some(([k]) => k === s.id)).map(s => `<button class="tab ${ui.progSubject === s.id ? "on" : ""}" data-a="progsub:${s.id}">${s.icon}</button>`).join("")}</div>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct</th><th style="width:28%">Result</th><th>Status</th><th></th></tr>${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c}/${x.v.c + x.v.w}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="chip ${x.s.cls}">${x.s.label}</span></td><td><button class="btn sm" data-a="practiceTopic:${x.t}">Practise</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No data yet.</td></tr>`}</table></div></section>`;
}
A.progsub = s => { ui.progSubject = s; bus.render(); };

// ===================== SYLLABUS + TOPIC DRAWER =====================
export function viewSyllabus() {
  const sub = SUBJECT_MAP[ui.subject], q = ui.search.toLowerCase(), us = users().filter(u => u.id !== S.me.uid);
  const topics = sub.topics.filter(t => (ui.filter === "all" || statusOf(S.me.uid, t.id) === ui.filter) && t.name.toLowerCase().includes(q));
  return `<header class="page-head"><div><h1>Syllabus</h1><p class="muted">Mark your status. Open a topic for videos, notes and practice.</p></div></header>
    <div class="tabs">${SUBJECTS.map(s => `<button class="tab ${s.id === ui.subject ? "on" : ""}" data-subject="${s.id}">${s.icon} ${esc(s.short)} <small>${pct(S.me.uid, s.id)}%</small></button>`).join("")}</div>
    <div class="card"><div class="toolbar"><input id="search" class="input" placeholder="Search topic…" value="${esc(ui.search)}"><select id="filter" class="input"><option value="all">All topics</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${ui.filter === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="topics">${topics.map(t => { const nr = S.resources.filter(r => r.topicId === t.id).length, nq = E.scope({ topic: t.id }).length;
        return `<div class="topic"><button class="tname" data-topic="${t.id}">${esc(t.name)}</button><div class="counts">${nq ? `<span title="Questions in bank">❓${nq}</span>` : ""}${nr ? `<span title="Videos, notes & links">📎${nr}</span>` : ""}</div>
          <div class="friends">${us.map(u => `<i class="dot s-${statusOf(u.id, t.id)}" style="outline-color:${color(u.id)}" title="${esc(nameOf(u.id))}: ${STATUS[statusOf(u.id, t.id)]}"></i>`).join("")}</div>${statusSelect(t.id)}</div>`; }).join("") || `<p class="empty">No topics match.</p>`}</div></div>`;
}
export function openTopic(tid) {
  ui.openTopic = tid; const t = TOPIC_MAP[tid], nq = E.scope({ topic: tid }).length;
  $("#drawerPanel").innerHTML = `<div class="drawer-head"><div><small class="muted">${SUBJECT_MAP[t.subject].icon} ${esc(SUBJECT_MAP[t.subject].name)}</small><h2>${esc(t.name)}</h2></div><button class="x big" data-close="drawer">✕</button></div>
    <div class="row">${statusSelect(tid)}${nq ? `<button class="btn primary" data-a="drawerPractice:${tid}">Practise 10 questions (${nq} in bank)</button>` : `<span class="muted small">No questions for this topic yet</span>`}</div>
    <div id="drawerBody"></div>
    <form id="resForm" class="card form"><b>Add a video, note or link</b>
      <select name="type" class="input"><option value="youtube">▶️ YouTube video</option><option value="drive">📄 Google Drive file</option><option value="note">📝 Short note / formula</option><option value="link">🔗 Other link</option></select>
      <input name="title" class="input" placeholder="Title" required maxlength="120"><input name="url" class="input" placeholder="Paste the link (not needed for a note)"><textarea name="text" class="input" rows="3" maxlength="1500" placeholder="Note text (for 'Short note / formula')"></textarea><button class="btn primary">Add</button></form>`;
  $("#drawer").classList.remove("hidden"); drawerBody();
  $("#resForm").onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), url = (v.url || "").trim(), text = (v.text || "").trim();
    if (v.type === "note" ? !text : !isUrl(url)) return toast(v.type === "note" ? "Write the note text." : "Paste a valid link (https://…)");
    await db.add("resources", { uid: S.me.uid, topicId: tid, type: v.type, title: v.title.trim(), url: v.type === "note" ? "" : url, text: v.type === "note" ? text : "" }); e.target.reset(); toast("Added ✔");
  };
}
export function drawerBody() {
  const tid = ui.openTopic, el = $("#drawerBody"); if (!el) return; const res = S.resources.filter(r => r.topicId === tid), vids = res.filter(r => r.type === "youtube"), rest = res.filter(r => r.type !== "youtube");
  el.innerHTML = `<div class="who">${users().filter(u => u.id !== S.me.uid).map(u => `<span class="chip s-${statusOf(u.id, tid)}">${esc(nameOf(u.id))}: ${STATUS[statusOf(u.id, tid)]}</span>`).join(" ")}</div>
    <h3>▶️ Videos (${vids.length})</h3><div class="res-grid">${vids.map(resCard).join("") || `<p class="empty">No videos yet.</p>`}</div><h3>📎 Notes &amp; links (${rest.length})</h3><div class="res-grid">${rest.map(resCard).join("") || `<p class="empty">Nothing yet.</p>`}</div>`;
}
A.drawerPractice = id => { $("#drawer").classList.add("hidden"); ui.openTopic = null; E.startTopic(id); };

// ===================== LIBRARY =====================
export function resCard(r) {
  const id = r.type === "youtube" ? ytId(r.url) : null, t = TOPIC_MAP[r.topicId], can = r.uid === S.me.uid || S.me.isAdmin, prev = r.type === "drive" ? drivePreview(r.url) : null;
  return `<div class="res">${id ? `<button class="thumb" data-play="${id}" data-title="${esc(r.title)}"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""><span>▶</span></button>` : ""}
    <div class="res-body"><b>${r.type === "drive" ? "📄 " : r.type === "note" ? "📝 " : r.type === "link" ? "🔗 " : ""}${esc(r.title)}</b>${t ? `<button class="link small" data-topic="${t.id}">${esc(t.name)}</button>` : ""}${r.text ? `<p class="vtext">${esc(r.text)}</p>` : ""}
      <div class="row small muted">${avatar(r.uid, 18)} ${esc(nameOf(r.uid))} · ${ago(r.createdAt)}</div>
      <div class="row">${prev ? `<button class="btn sm" data-preview="${esc(prev)}" data-title="${esc(r.title)}">Preview</button>` : ""}${r.url ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}${can ? `<button class="btn sm ghost danger" data-del="resources:${r.id}">Delete</button>` : ""}</div></div></div>`;
}
export function viewLibrary() {
  const l = ui.lib, q = l.q.toLowerCase(), list = S.resources.filter(r => (!l.type || r.type === l.type) && (!l.subject || TOPIC_MAP[r.topicId]?.subject === l.subject) && `${r.title} ${r.text || ""} ${TOPIC_MAP[r.topicId]?.name || ""}`.toLowerCase().includes(q)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `<header class="page-head"><div><h1>Library</h1><p class="muted">Everything the group has shared – videos, Drive files, notes.</p></div><button class="btn primary" data-a="addRes">+ Add</button></header>
    <section class="card"><div class="row"><h2 class="grow">Drive folders</h2><button class="btn sm" data-a="addDrive">+ Add folder</button></div>
      ${S.drives.map(d => `<div class="li">${avatar(d.uid, 22)}<span class="grow"><b>${esc(d.label)}</b>${d.purpose ? ` <span class="muted small">– ${esc(d.purpose)}</span>` : ""}</span><a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open ↗</a>${d.uid === S.me.uid || S.me.isAdmin ? `<button class="x" data-del="drives:${d.id}">✕</button>` : ""}</div>`).join("") || `<p class="empty">Add a shared Google Drive folder link. When one Drive fills up, add a folder from another friend's Drive.</p>`}</section>
    <div class="card"><div class="toolbar"><input id="libq" class="input" placeholder="Search…" value="${esc(l.q)}">${f.select("lib.type", [["", "All types"], ["youtube", "Videos"], ["drive", "Drive files"], ["note", "Notes"], ["link", "Links"]], "data-rerender")}${f.select("lib.subject", subjectOpts(), "data-rerender")}</div><div class="res-grid">${list.map(resCard).join("") || `<p class="empty">Nothing here yet.</p>`}</div></div>`;
}
A.addDrive = () => {
  bus.modal(`<h2>Add a Google Drive folder</h2><form id="mForm" class="form"><label>Label<input name="label" class="input" required maxlength="80" placeholder="e.g. Sumit – GA notes"></label><label>Folder link<input name="url" class="input" required placeholder="https://drive.google.com/drive/folders/…"></label><label>What's inside? (optional)<input name="purpose" class="input" maxlength="120"></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
  $("#mForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (!isUrl(v.url.trim())) return toast("Paste a valid link"); await db.add("drives", { uid: S.me.uid, label: v.label.trim(), url: v.url.trim(), purpose: v.purpose.trim() }); bus.closeModal(); };
};
A.addRes = () => {
  bus.modal(`<h2>Add to the library</h2><form id="mForm" class="form"><label>Subject<select name="subject" class="input">${SUBJECTS.map(s => `<option value="${s.id}">${s.icon} ${esc(s.name)}</option>`).join("")}</select></label><label>Topic<select name="topicId" class="input"></select></label>
    <label>Type<select name="type" class="input"><option value="youtube">▶️ YouTube video</option><option value="drive">📄 Google Drive file</option><option value="note">📝 Short note / formula</option><option value="link">🔗 Other link</option></select></label>
    <label>Title<input name="title" class="input" required maxlength="120"></label><label>Link<input name="url" class="input" placeholder="https://… (not needed for a note)"></label><label>Note text<textarea name="text" class="input" rows="3" maxlength="1500"></textarea></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
  const fill = () => ($("#mForm [name=topicId]").innerHTML = SUBJECT_MAP[$("#mForm [name=subject]").value].topics.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")); fill(); $("#mForm [name=subject]").onchange = fill;
  $("#mForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), url = (v.url || "").trim(), text = (v.text || "").trim();
    if (v.type === "note" ? !text : !isUrl(url)) return toast(v.type === "note" ? "Write the note text." : "Paste a valid link");
    await db.add("resources", { uid: S.me.uid, topicId: v.topicId, type: v.type, title: v.title.trim(), url: v.type === "note" ? "" : url, text: v.type === "note" ? text : "" }); bus.closeModal(); toast("Added ✔"); };
};
