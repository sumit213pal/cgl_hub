// Student-facing pages: Tests (paper library, tests, practice, history), start dialog, Result, question card.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { MIN_Q, STRONG, WEAK, DEFAULT_SEC, KIND, fmtDur, fmtDate, fmtDay, fmtDateTime, rate, topicState, donut, stack, imgUrl, parseHist } from "./t_util.js";

export function initViews(X) {
  const { S, st, db, $, esc, toast } = X, A = X.act, ui = X.ui, L = "ABCD";
  const kindBadge = k => `<span class="badge">${KIND[k] || "Test"}</span>`;
  const secDefaults = [[30, "30 sec / question"], [45, "45 sec / question"], [60, "60 sec / question"], [90, "90 sec / question"]];
  const pf = n => (n === null || n === undefined ? "–" : n + "%");

  // ---------- reusable question card (result review + notebook) ----------
  X.qCard = (q, o = {}) => {
    const k = X.cache.k[q.id], chosen = o.chosen, correct = o.locked ? -1 : (o.correct ?? k?.correct);
    const opts = (q.options || []).map((t, j) => {
      const isC = j === correct, isY = j === chosen && chosen >= 0;
      return `<div class="ropt ${isC ? "ok" : isY ? "bad" : ""}"><b>${L[j]}</b><span>${X.oHtml(q, j)}</span>${isC ? "<em>✔ Correct</em>" : isY ? "<em>✖ Your answer</em>" : ""}</div>`;
    }).join("");
    const bm = S.bookmarks.some(b => b.qid === q.id), mk = S.mistakes.find(m => m.qid === q.id), note = S.qnotes.find(n => n.qid === q.id);
    const exp = st.exp[q.id] && k && !o.locked
      ? `<div class="expl"><b>Explanation</b><p>${esc(X.langGet() === "hi" && k.explanationHi ? k.explanationHi : k.explanation || "No explanation has been added for this question yet.")}</p>
         <div class="row">${k.videoUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(k.videoUrl)}">▶ Watch solution</a>` : ""}${k.notesUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(k.notesUrl)}">📄 Open notes</a>` : ""}</div></div>` : "";
    const noteBox = st.noteOpen[q.id]
      ? `<div class="notebox"><textarea class="input" rows="2" maxlength="600" data-note="${q.id}" placeholder="My private note (e.g. a shortcut, or why I got it wrong)…">${esc(note?.text || "")}</textarea><button class="btn sm primary" data-t="saveNote:${q.id}">Save note</button></div>`
      : note ? `<div class="mynote">📝 <b>My note:</b> ${esc(note.text)}</div>` : "";
    const stBadge = o.state === "ok" ? `<span class="badge ok">Correct</span>` : o.state === "bad" ? `<span class="badge off">Wrong</span>` : o.state === "skip" ? `<span class="badge low">Skipped</span>` : "";
    return `<div class="rcard ${o.state || ""}">
      <div class="rhead"><b>${o.no ? "Q" + o.no : ""}</b><span class="chip">${esc(TOPIC_MAP[q.topicId]?.name || "")}</span>${stBadge}${q.year ? `<small class="muted">PYQ ${esc(q.year)}${q.shift ? " · " + esc(q.shift) : ""}</small>` : ""}${o.time !== undefined ? `<small class="muted">⏱ ${o.time}s</small>` : ""}${o.extra || ""}</div>
      <div class="rq">${X.qHtml(q)}</div>
      ${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="" referrerpolicy="no-referrer">` : ""}
      <div class="ropts">${opts}</div>${exp}${noteBox}
      <div class="row ractions">
        ${o.locked ? `<span class="badge warn">🔒 Solutions unlock ${esc(o.unlock || "later")}</span>` : `<button class="btn sm" data-t="explain:${q.id}">${st.exp[q.id] ? "Hide" : "💡 Show"} explanation</button>`}
        <button class="btn sm ${bm ? "primary" : ""}" data-t="save:${q.id}">${bm ? "⭐ Saved" : "☆ Save"}</button>
        <button class="btn sm ${mk?.confused ? "primary" : ""}" data-t="confused:${q.id}">❓ ${mk?.confused ? "Marked as doubt" : "I didn't understand"}</button>
        <button class="btn sm ${note ? "primary" : ""}" data-t="noteToggle:${q.id}">📝 Note</button>
        ${o.locked ? "" : `<button class="btn sm ghost" data-t="aiprompt:${q.id}" title="Copies a ready-made prompt for ChatGPT / Claude / Gemini">🤖 Explain with AI</button>`}
        <button class="btn sm ghost" data-t="report:${q.id}">🚩 Report</button>
      </div></div>`;
  };

  // ---------- TESTS page ----------
  const secChips = plan => plan.type === "section"
    ? plan.sections.map(s => `<span class="chip">${X.subjIcon(s.sub)} ${esc(X.subjName(s.sub))} · ${s.n}Q · ${X.fmtMin(s.sec)}</span>`).join("")
    : (plan.sections.length ? "" : "");
  const planLine = (it, plan) => {
    const g = X.groupsOfItem(it);
    if (plan.type === "section") return `⏱ Section timers · total ${X.fmtMin(plan.durationSec)}`;
    if (plan.type === "paper") return `⏱ ${X.fmtMin(plan.durationSec)} for the whole paper`;
    return "⏱ No timer";
  };

  function paperCard(p) {
    const mine = S.attempts.filter(a => a.paperId === p.id), run = mine.find(a => a.status === "running");
    const ex = mine.filter(a => a.status === "submitted" && a.mode !== "learning" && a.result).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const lrn = mine.filter(a => a.status === "submitted" && a.mode === "learning");
    const av = X.availability(p), left = X.attemptsLeft(p, "paper"), plan = X.planOf(p);
    const ver = (p.qids || []).filter(id => X.metaOf(id)?.st === "v").length, tot = (p.qids || []).length;
    const pc = ex.map(a => a.result.percent);
    return `<div class="card paper-card">
      <div class="row"><b class="grow">${esc(p.title)}</b>${p.published ? "" : `<span class="badge low">Draft</span>`}<span class="badge">${esc(p.tier || "Tier I")}</span></div>
      <div class="meta"><span>📅 ${esc(fmtDay(p.examDate) || p.year || "")}</span>${p.shift ? `<span>🕘 ${esc(p.shift)}</span>` : ""}<span>📝 ${p.total || tot} questions</span><span>+${p.pos} / −${p.neg}</span></div>
      <div class="chips-wrap">${(p.sections || []).map(s => `<span class="chip">${X.subjIcon(s.subject)} ${esc(X.subjName(s.subject))} ${s.count}</span>`).join("")}</div>
      <div class="small muted">${planLine(p, plan)}</div>
      <div class="small">${ver === tot ? `<span class="badge ok">✔ ${ver}/${tot} verified</span>` : `<span class="badge warn">${ver}/${tot} verified</span>`} ${av.msg ? `<span class="badge ${av.open ? "" : "off"}">${esc(av.msg)}</span>` : ""} <span class="muted">${left === null ? "Unlimited attempts" : left + " exam attempt" + (left === 1 ? "" : "s") + " left"}</span></div>
      ${ex.length ? `<div class="attempt-line">Attempts: <b>${ex.length}</b> · First <b>${pc[0]}%</b> · Best <b>${Math.max(...pc)}%</b> · Last <b>${pc.at(-1)}%</b>${ex.length > 1 ? ` · <span class="${pc.at(-1) - pc[0] >= 0 ? "up" : "down"}">${pc.at(-1) - pc[0] >= 0 ? "▲" : "▼"} ${Math.abs(Math.round((pc.at(-1) - pc[0]) * 10) / 10)}</span>` : ""}</div>` : ""}
      ${lrn.length ? `<div class="small muted">📘 ${lrn.length} learning-mode attempt${lrn.length > 1 ? "s" : ""}</div>` : ""}
      <div class="row">${run ? `<button class="btn primary" data-t="resume:${run.id}">▶ Resume ${run.mode === "learning" ? "(learning)" : ""}</button>` : `<button class="btn primary" data-t="openStart:paper:${p.id}">Start</button>`}
        ${ex.length ? `<a class="btn" href="#result/${ex.at(-1).id}">Last result</a>` : ""}${mine.length ? `<button class="btn ghost sm" data-t="histToggle:${p.id}">History ${st.histOpen[p.id] ? "▲" : "▼"}</button>` : ""}</div>
      ${st.histOpen[p.id] ? `<div class="hist-list">${[...mine].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).map(a => {
        const n = ex.findIndex(x => x.id === a.id) + 1;
        return `<div class="li"><span class="grow">${a.mode === "learning" ? `<span class="badge low">Learning</span>` : `<span class="badge">Exam #${n || "–"}</span>`} ${fmtDate(a.startedAt)} ${a.status === "running" ? `<span class="badge warn">in progress</span>` : `· <b>${a.result.score}</b>/${a.result.max} (${a.result.percent}%) · ${fmtDur(a.result.timeUsed)}`}</span>${a.status === "submitted" ? `<a class="btn sm" href="#result/${a.id}">Open</a>` : `<button class="btn sm" data-t="resume:${a.id}">Resume</button>`}</div>`;
      }).join("")}</div>` : ""}
    </div>`;
  }

  function testCard(t) {
    const mine = S.attempts.filter(a => a.testId === t.id), run = mine.find(a => a.status === "running");
    const ex = mine.filter(a => a.status === "submitted" && a.mode !== "learning" && a.result);
    const left = X.attemptsLeft(t, "test"), av = X.availability(t), plan = X.planOf(t);
    const best = ex.length ? Math.max(...ex.map(a => a.result.percent)) : null;
    return `<div class="card test-card">
      <div class="row"><b class="grow">${esc(t.title)}</b>${t.mode === "fixed" ? `<span class="badge">Fixed paper</span>` : `<span class="badge">Random</span>`}</div>
      ${t.desc ? `<p class="small muted">${esc(t.desc)}</p>` : ""}
      <div class="meta"><span>📝 ${t.total} questions</span><span>${planLine(t, plan)}</span><span>+${t.pos} / −${t.neg}</span><span>🔁 ${left === null ? "Unlimited" : left + " attempt" + (left === 1 ? "" : "s") + " left"}</span></div>
      <div class="chips-wrap">${secChips(plan)}</div>
      ${av.msg ? `<div class="small"><span class="badge ${av.open ? "" : "off"}">${esc(av.msg)}</span></div>` : ""}
      ${best !== null ? `<p class="small">Best: <b>${best}%</b> · ${ex.length} exam attempt${ex.length > 1 ? "s" : ""}</p>` : ""}
      <div class="row">${run ? `<button class="btn primary" data-t="resume:${run.id}">▶ Resume</button>` : `<button class="btn primary" data-t="openStart:test:${t.id}">Start</button>`}${ex.length ? `<a class="btn" href="#result/${ex.at(-1).id}">Last result</a>` : ""}</div></div>`;
  }

  const papersTab = () => {
    const f = st.pf, all = S.papers.filter(p => p.published || S.me.isAdmin);
    const years = [...new Set(all.map(p => String(p.year || "")))].filter(Boolean).sort().reverse();
    const shifts = [...new Set(all.map(p => p.shift).filter(Boolean))].sort();
    const status = p => { const m = S.attempts.filter(a => a.paperId === p.id); return m.some(a => a.status === "running") ? "progress" : m.some(a => a.status === "submitted" && a.mode !== "learning") ? "attempted" : "new"; };
    const list = all.filter(p => (!f.year || String(p.year) === f.year) && (!f.shift || p.shift === f.shift) && (!f.tier || p.tier === f.tier) && (!f.status || status(p) === f.status))
      .sort((a, b) => (b.examDate || String(b.year)).localeCompare(a.examDate || String(a.year)) || String(a.shift).localeCompare(String(b.shift)));
    const byYear = {}; list.forEach(p => (byYear[p.year || "Other"] ||= []).push(p));
    return `
    <div class="toolbar">${ui.select("pf.year", [["", "All years"], ...years.map(y => [y, y])], "data-rerender")}${ui.select("pf.shift", [["", "All shifts"], ...shifts.map(s => [s, s])], "data-rerender")}
      ${ui.select("pf.tier", [["", "All tiers"], ["Tier I", "Tier I"], ["Tier II", "Tier II"]], "data-rerender")}${ui.select("pf.status", [["", "Any status"], ["new", "Not attempted"], ["progress", "In progress"], ["attempted", "Attempted"]], "data-rerender")}</div>
    ${Object.keys(byYear).sort().reverse().map(y => `<h2 class="year-h">${esc(y)} <small class="muted">${byYear[y].length} paper${byYear[y].length > 1 ? "s" : ""}</small></h2><div class="grid cards">${byYear[y].map(paperCard).join("")}</div>`).join("") ||
      `<div class="card"><p class="empty">No full papers yet. ${S.me.isAdmin ? `Import a CSV in <a href="#admin" data-admintab="qbank">Admin → Question bank</a> – papers are created automatically from <b>paperName + examDate + shift</b>.` : "The admin can add them by importing a CSV."}</p></div>`}`;
  };

  const practiceTab = () => {
    const g = st.gen, avail = X.scope({ subject: g.subject, topic: g.topic, diff: g.diff }).length, n = Math.min(Number(g.count) || 0, avail);
    const plan = X.planOfCfg({ timerType: g.timerMode === "none" ? "none" : "paper", paperMode: g.timerMode, secPerQ: g.secPerQ, manualMin: g.manualMin }, [{ sub: "x", n }]);
    const d = X.dailyAttempt();
    return `
    <div class="grid two">
      <div class="card"><h2>📅 Daily PYQ drill</h2><p class="small muted">5 questions each from Quant, Reasoning, English and GA – PYQs you haven't seen yet come first. One drill per day.</p>
        ${d ? `<p>${d.status === "submitted" ? `✅ Done today: <b>${d.result.score}/${d.result.max}</b>` : "⏳ In progress"}</p>` : ""}
        <button class="btn primary" data-t="daily">${d ? (d.status === "running" ? "▶ Resume today's drill" : "View today's result") : "Start today's drill"}</button></div>
      <div class="card"><h2>⚡ 1-click revision</h2><p class="small muted">A mix of mistakes that are due, weak topics and unseen questions – no setup.</p><button class="btn primary" data-t="smart">Start 20-question revision</button>
        <button class="btn" data-t="practiceDue" ${X.dueMistakes().length ? "" : "disabled"}>Mistakes due today (${X.dueMistakes().length})</button></div>
    </div>
    <section class="card"><h2>🎯 Create your own test</h2>
      <div class="form-grid">
        <label>Questions from<div class="rg">${ui.radio("gen.source", "random", "Random mix")}${ui.radio("gen.source", "weak", "Weak topics")}${ui.radio("gen.source", "mistakes", "My mistakes")}${ui.radio("gen.source", "due", "Mistakes due")}${ui.radio("gen.source", "unseen", "Unseen only")}</div></label>
        <label>Subject${ui.select("gen.subject", X.subjectOpts(), "data-rerender")}</label>
        <label>Topic${ui.select("gen.topic", X.topicOpts(g.subject), "data-rerender")}</label>
        <label>Difficulty${ui.select("gen.diff", [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "data-rerender")}</label>
        <label>Number of questions${ui.num("gen.count", 'min="1" max="100" data-rerender')}</label>
        <label>Timer<div class="rg">${ui.radio("gen.timerMode", "auto", "Auto (per question)")}${ui.radio("gen.timerMode", "manual", "Manual")}${ui.radio("gen.timerMode", "none", "No timer")}</div></label>
        ${g.timerMode === "auto" ? `<label>Time per question${ui.select("gen.secPerQ", secDefaults, "data-rerender")}</label>` : ""}
        ${g.timerMode === "manual" ? `<label>Total minutes${ui.num("gen.manualMin", 'min="1" max="240" data-rerender')}</label>` : ""}
        <label>Marks per correct / wrong<div class="row">${ui.num("gen.pos", 'step="0.25" min="0"')}${ui.num("gen.neg", 'step="0.25" min="0"')}</div></label>
        <label class="center">${ui.check("gen.shuffleOpt", "Shuffle options")}${ui.check("gen.learning", "📘 Learning mode (check answers while practising)")}</label>
      </div>
      <div class="gen-sum">📦 ${avail} questions match · test will have <b>${n}</b> · ${plan.type === "none" ? "No timer" : fmtDur(plan.durationSec)}</div>
      <button class="btn primary" data-t="gen" ${avail ? "" : "disabled"}>Start test</button>
    </section>`;
  };

  const historyTab = () => {
    const h = st.hist, list = S.attempts.filter(a => (!h.kind || a.kind === h.kind) && (!h.mode || (h.mode === "learning" ? a.mode === "learning" : a.mode !== "learning")));
    return `<section class="card"><div class="toolbar">${ui.select("hist.kind", [["", "All types"], ...Object.entries(KIND)], "data-rerender")}${ui.select("hist.mode", [["", "Exam + learning"], ["exam", "Exam mode only"], ["learning", "Learning mode only"]], "data-rerender")}</div>
      <div class="table-wrap"><table class="list"><tr><th>Test</th><th>Type</th><th>Mode</th><th>Score</th><th>Accuracy</th><th>Time</th><th>Date</th><th></th></tr>
      ${list.slice(0, 60).map(a => a.status === "running"
        ? `<tr><td>${esc(a.title)}</td><td>${kindBadge(a.kind)}</td><td>${a.mode === "learning" ? "Learning" : "Exam"}</td><td colspan="4"><span class="badge warn">In progress</span></td><td><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></td></tr>`
        : `<tr><td>${esc(a.title)}</td><td>${kindBadge(a.kind)}</td><td>${a.mode === "learning" ? `<span class="badge low">Learning</span>` : "Exam"}</td><td><b>${a.result.score}</b>/${a.result.max} <small class="muted">(${a.result.percent}%)</small></td><td>${a.result.accuracy}%</td><td>${fmtDur(a.result.timeUsed)}</td><td>${fmtDate(a.submittedAt)}</td><td><a class="btn sm" href="#result/${a.id}">Result</a></td></tr>`).join("") || `<tr><td colspan="8" class="empty">No attempts yet.</td></tr>`}
      </table></div></section>`;
  };

  X.viewTests = () => {
    const bank = X.allPool().length, running = S.attempts.filter(a => a.status === "running"), tab = st.testTab, tests = S.tests.filter(t => t.published || S.me.isAdmin);
    const tabs = [["papers", `🗃 Paper library <small>${S.papers.filter(p => p.published).length}</small>`], ["tests", `🧪 Mock tests <small>${tests.length}</small>`], ["practice", "🎯 Practice"], ["history", "📋 History"]];
    return `
    <header class="page-head"><div><h1>📝 Tests</h1><p class="muted">Timed MCQ practice from the group's question bank (${bank} questions).</p></div>
      <div class="row"><button class="btn" data-t="daily">📅 Daily drill</button><button class="btn primary" data-t="smart">⚡ 1-click revision</button></div></header>
    ${running.map(a => `<div class="notice">⏳ <span class="grow"><b>${esc(a.title)}</b> is in progress${a.mode === "learning" ? " (learning mode)" : ""}.</span><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></div>`).join("")}
    ${!bank ? `<div class="card tip"><b>The question bank is empty.</b> ${S.me.isAdmin ? `Go to <a href="#admin" data-admintab="qbank">Admin → Question bank</a> and import your CSV.` : "Ask the admin to import the PYQ questions."}</div>` : ""}
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-t="ttab:${k}">${l}</button>`).join("")}</div>
    ${tab === "papers" ? papersTab() : tab === "tests" ? `<div class="grid cards">${tests.map(testCard).join("") || `<p class="empty">No mock tests published yet.</p>`}</div>` : tab === "practice" ? practiceTab() : historyTab()}`;
  };

  // ---------- start dialog (exam mode / learning mode) ----------
  X.openStart = (kind, id) => {
    const it = kind === "paper" ? S.papers.find(p => p.id === id) : S.tests.find(t => t.id === id); if (!it) return;
    if (!st.start || st.start.id !== id) st.start = { kind, id, mode: "exam", useTimer: false };
    const s = st.start, plan = X.planOf(it), av = X.availability(it), left = X.attemptsLeft(it, kind);
    const unver = kind === "paper" && it.requireVerified && (it.qids || []).some(q => X.metaOf(q)?.st !== "v");
    let block = "";
    if (s.mode === "exam") block = !av.open ? `${av.msg} – exam mode is not available right now.` : left === 0 ? "No exam attempts left." : unver ? "This paper still has unverified questions." : "";
    else if (av.state === "upcoming") block = av.msg;
    X.showModal(`<h2>${esc(it.title)}</h2>
      <p class="muted small">${it.total || it.qids?.length || ""} questions · +${it.pos} / −${it.neg}${it.examDate ? " · " + esc(fmtDay(it.examDate)) : ""}${it.shift ? " · " + esc(it.shift) : ""}</p>
      <div class="mode-pick">
        <label class="mode-card ${s.mode === "exam" ? "on" : ""}"><input type="radio" name="start.mode" data-bind="start.mode" data-remodal value="exam" ${s.mode === "exam" ? "checked" : ""}><b>🎯 Exam mode</b><small>${plan.type === "section" ? "Section timers · sections lock when submitted · solutions after submission" : plan.type === "paper" ? "Total timer · solutions after submission" : "No timer · solutions after submission"}. Counts in your analytics.</small></label>
        <label class="mode-card ${s.mode === "learning" ? "on" : ""}"><input type="radio" name="start.mode" data-bind="start.mode" data-remodal value="learning" ${s.mode === "learning" ? "checked" : ""}><b>📘 Learning mode</b><small>Move freely, check each answer right away. Doesn't affect exam analytics or readiness. Unlimited attempts.</small></label>
      </div>
      ${s.mode === "exam" && plan.type === "section" ? `<table class="list"><tr><th>Section</th><th>Questions</th><th>Time</th></tr>${plan.sections.map(x => `<tr><td>${X.subjIcon(x.sub)} ${esc(X.subjName(x.sub))}</td><td>${x.n}</td><td>${X.fmtMin(x.sec)}</td></tr>`).join("")}<tr><th>Total</th><th>${plan.total}</th><th>${X.fmtMin(plan.durationSec)}</th></tr></table>` : ""}
      ${s.mode === "exam" && plan.type === "paper" ? `<p>⏱ <b>${X.fmtMin(plan.durationSec)}</b> for the whole paper.</p>` : ""}
      ${s.mode === "learning" && plan.durationSec ? `<label class="check">${ui.check("start.useTimer", `Use a total timer of ${X.fmtMin(plan.durationSec)}`, "data-remodal")}</label>` : ""}
      <label class="mt-s">Language<select class="input sm" data-tchange="setLang"><option value="en" ${X.langGet() === "en" ? "selected" : ""}>English</option><option value="hi" ${X.langGet() === "hi" ? "selected" : ""}>हिन्दी (where available)</option><option value="both" ${X.langGet() === "both" ? "selected" : ""}>Both</option></select></label>
      <p class="small muted mt-s">${s.mode === "exam" ? (left === null ? "Unlimited exam attempts." : `${left} exam attempt${left === 1 ? "" : "s"} left.`) : ""} ${av.msg && s.mode === "exam" ? esc(av.msg) + "." : ""}</p>
      ${block ? `<p class="msg">${esc(block)}</p>` : ""}
      <div class="row mt-s"><button class="btn primary big" data-t="doStart" ${block ? "disabled" : ""}>Start ${s.mode === "exam" ? "exam" : "learning"}</button><button class="btn ghost" data-close="modal">Cancel</button></div>`);
  };
  X.reopen = () => X.openStart(st.start.kind, st.start.id);
  A.openStart = arg => { const [k, id] = arg.split(":"); X.openStart(k, id); };
  A.doStart = () => { const s = st.start; X.closeModal(); (s.kind === "paper" ? X.startPaper : X.startTest)(s.id, { mode: s.mode, useTimer: s.useTimer }); };
  A.setLang = (_, el) => X.langSet(el.value);

  // ---------- RESULT page ----------
  const classify = (v, target) => {
    const att = v.c + v.w; if (att < MIN_Q) return null;
    const acc = (v.c / att) * 100, avg = v.t / Math.max(1, att + v.u), high = acc >= STRONG, fast = avg <= target;
    if (high && fast) return { l: "Strong", cls: "ok", tip: "Accurate and quick – keep revising to hold it." };
    if (high) return { l: "Improve speed", cls: "warn", tip: "Accurate but slow – practise this with a timer." };
    if (fast) return { l: "Rushing / guessing", cls: "off", tip: "Fast but inaccurate – slow down, read carefully, avoid guessing." };
    return { l: "Concept gap", cls: "off", tip: "Slow and inaccurate – revise the theory before more timed practice." };
  };
  X.classify = classify;

  X.viewResult = () => {
    const a = S.attempts.find(x => x.id === S.arg);
    if (!a) return `<p class="empty">Loading result…</p><a class="btn" href="#tests">Back to tests</a>`;
    if (a.status === "running") return `<div class="card"><b>This test is still in progress.</b> <button class="btn primary" data-t="resume:${a.id}">Resume</button></div>`;
    const r = a.result, locked = X.solutionsLocked(a), it = X.itemOf(a), unlock = it?.availableUntil ? fmtDateTime(it.availableUntil) : "";
    const key = a.paperId || a.testId, exams = key ? X.examAttempts(key) : [], idx = exams.findIndex(x => x.id === a.id);
    const rows = Object.entries(r.byTopic || {}).filter(([t]) => TOPIC_MAP[t]).map(([t, v]) => ({ t, v, st: topicState(v), tot: v.c + v.w + v.u, acc: rate(v.c, v.w) })).sort((x, y) => (x.acc ?? 101) - (y.acc ?? 101));
    const focus = rows.filter(x => x.v.w > 0).slice(0, 3), subs = Object.entries(r.bySubject || {});
    const cnt = k => X.reattemptIds(a, k).length;
    const rv = st.review[a.id], ch = r.chg || {}, sec = r.bySection;
    const cmp = key && a.mode !== "learning" && idx >= 0 && exams.length > 1 ? (() => {
      const first = exams[0].result.percent, best = Math.max(...exams.map(x => x.result.percent)), d = r.percent - first;
      return `<div class="card cmp"><b>Attempt ${idx + 1} of ${exams.length}</b> for this ${a.paperId ? "paper" : "test"} · <span class="muted">first attempt = your honest benchmark</span>
        <div class="chips2"><span>${first}%<small>First attempt</small></span><span>${r.percent}%<small>This attempt</small></span><span class="${d >= 0 ? "c-a" : "c-n"}">${d >= 0 ? "+" : ""}${Math.round(d * 10) / 10}<small>vs first</small></span><span>${best}%<small>Best so far</small></span></div></div>`;
    })() : "";
    let secBlock = "";
    if (sec) {
      const avgT = s => (s.used || 0) / Math.max(1, s.n), fast = [...sec].sort((x, y) => avgT(x) - avgT(y))[0], low = [...sec].filter(s => s.c + s.w > 0).sort((x, y) => (rate(x.c, x.w) ?? 101) - (rate(y.c, y.w) ?? 101))[0];
      secBlock = `<section class="card"><h2>🧭 Section-wise result</h2>
        <div class="table-wrap"><table class="list"><tr><th>Section</th><th>Score</th><th>Accuracy</th><th>Answered</th><th>Time used / allotted</th><th>Note</th></tr>
        ${sec.map(s => `<tr><td>${X.subjIcon(s.sub)} ${esc(X.subjName(s.sub))}</td><td><b>${s.score}</b></td><td>${pf(rate(s.c, s.w))}</td><td>${s.c + s.w}/${s.n}</td><td>${fmtDur(s.used)} / ${fmtDur(s.sec)}</td><td>${s.exp ? `<span class="badge off">⏰ Time expired${s.u ? ` – ${s.u} unanswered` : ""}</span>` : `<span class="badge ok">Submitted</span>`}</td></tr>`).join("")}</table></div>
        <p class="small">⚡ Fastest section: <b>${esc(X.subjName(fast.sub))}</b> (${Math.round(avgT(fast))}s/question)${low ? ` · 🎯 Lowest accuracy: <b>${esc(X.subjName(low.sub))}</b> (${pf(rate(low.c, low.w))})` : ""}</p></section>`;
    }
    const chgBlock = ch.changed > 0 || ch.last2 > 0 ? `<section class="card"><h2>🔄 Answer-change analysis</h2><div class="chips2"><span>${ch.changed}<small>Questions changed</small></span><span class="c-n">${ch.c2w}<small>Correct → wrong</small></span><span class="c-a">${ch.w2c}<small>Wrong → correct</small></span>${ch.last2 >= 0 ? `<span>${ch.last2}<small>Changed in last 2 min</small></span>` : ""}<span class="${ch.net >= 0 ? "c-a" : "c-n"}">${ch.net > 0 ? "+" : ""}${ch.net}<small>Net marks from changes</small></span></div>
      <p class="small muted">${ch.net < 0 ? "Changing answers cost you marks here – trust your first instinct unless you can prove it wrong." : ch.net > 0 ? "Your changes gained marks – reviewing before submitting paid off." : "Changes balanced out."}</p></section>` : "";
    // timeline
    const tl = a.questionIds.map((id, i) => {
      const q = r.q?.[id]; if (!q) return "";
      const state = q[0] < 0 ? "skip" : q[0] === q[1] ? "ok" : "bad", ev = parseHist(a.hist?.[id]), chg = ev.filter((e, j) => j > 0 && e.o !== ev[j - 1].o).length, vis = a.visits?.[id] || 0;
      return `<span class="tl ${state} ${q[2] > 60 ? "slow" : ""}" title="Q${i + 1}: ${q[2]}s${vis > 1 ? " · visited " + vis + "×" : ""}${chg ? " · changed " + chg + "×" : ""}">Q${i + 1} ${q[2]}s ${state === "ok" ? "✅" : state === "bad" ? "❌" : "⏭"}${vis > 1 ? ` ↻${vis}` : ""}${chg ? ` ✎${chg}` : ""}</span>`;
    });
    const tlBlock = `<details class="card"><summary><b>⏳ Question-attempt timeline</b> <span class="muted small">time per question · ↻ revisits · ✎ answer changes · amber = over 60 s</span></summary>
      ${(sec || [{ sub: null, n: a.questionIds.length }]).map((s, si) => { const from = sec ? a.secs[si].from : 0, to = sec ? a.secs[si].to : a.questionIds.length - 1; return `<div class="tl-sec">${sec ? `<b>${X.subjIcon(s.sub)} ${esc(X.subjName(s.sub))}</b>` : ""}<div class="tl-row">${tl.slice(from, to + 1).join("")}</div></div>`; }).join("")}</details>`;
    return `
    <header class="page-head"><div><a href="#tests" class="small">← Back to tests</a><h1>${esc(a.title)}</h1><p class="muted">${kindBadge(a.kind)} ${a.mode === "learning" ? `<span class="badge low">📘 Learning mode</span>` : `<span class="badge">🎯 Exam mode</span>`} ${fmtDate(a.submittedAt)} · +${a.pos}${a.neg ? ` / −${a.neg}` : ""} marking</p></div>
      <div class="row"><button class="btn primary" data-t="reattempt:${a.id}:wrong" ${cnt("wrong") ? "" : "disabled"}>🔁 Retest wrong (${cnt("wrong")})</button><button class="btn" data-t="smart">⚡ Revision test</button></div></header>
    ${a.recalc ? `<div class="notice">🔧 <span class="grow">Score updated after the admin corrected an answer key. Old score: <b>${a.recalc.prev}</b> → new score: <b>${r.score}</b>.</span></div>` : ""}
    <section class="grid result-top">
      <div class="card score-card"><small class="muted">Your score</small><div class="big-score">${r.score}<span>/ ${r.max}</span></div><div class="muted">${r.percent}% · accuracy ${r.accuracy}%</div>
        <div class="chips2"><span class="c-a">${r.correct}<small>Correct</small></span><span class="c-n">${r.wrong}<small>Wrong</small></span><span class="c-v">${r.unattempted}<small>Skipped</small></span><span class="c-m">${fmtDur(r.timeUsed)}<small>Time used${a.durationSec ? " of " + fmtDur(a.durationSec) : ""}</small></span></div></div>
      <div class="card center-col">${donut(r.correct, r.wrong, r.unattempted)}<div class="legend"><span><i class="dot" style="background:#10b981"></i>Correct</span><span><i class="dot" style="background:#ef4444"></i>Wrong</span><span><i class="dot" style="background:#d1d5db"></i>Skipped</span></div></div>
    </section>
    ${cmp}${secBlock}
    ${focus.length ? `<section class="card focus"><h2>🎯 Work on these next</h2><div class="row">${focus.map(x => `<div class="focus-item"><b>${esc(TOPIC_MAP[x.t].name)}</b><small>${x.v.c}/${x.v.c + x.v.w} correct · <span class="badge ${x.st.cls}">${x.st.label}</span></small><div class="row"><button class="btn sm" data-t="practiceTopic:${x.t}">Practise 10 Qs</button><button class="btn sm ghost" data-t="topicRes:${x.t}">📚 Notes &amp; videos</button></div></div>`).join("")}</div></section>` : ""}
    <section class="card"><h2>Subject-wise performance &amp; time pressure</h2>
      ${subs.map(([sid, v]) => {
        const si = sec?.find(x => x.sub === sid), target = si ? si.sec / Math.max(1, si.n) : DEFAULT_SEC[sid] || 45, cl = classify(v, target), n = v.c + v.w + v.u;
        return `<div class="sub-row"><div class="sub-h"><b>${X.subjIcon(sid)} ${esc(X.subjName(sid))}</b><span>${v.c}/${n} correct${rate(v.c, v.w) !== null ? ` · accuracy ${rate(v.c, v.w)}%` : ""} · avg ${Math.round(v.t / Math.max(1, n))}s/question</span></div>${stack(v.c, v.w, v.u)}
          ${cl ? `<div class="small"><span class="badge ${cl.cls}">${cl.l}</span> <span class="muted">${cl.tip}</span></div>` : ""}</div>`;
      }).join("")}
      <p class="small muted">Suggestions come from simple rules (accuracy ≥ ${STRONG}% and average time within the target), not from AI.</p></section>
    ${chgBlock}
    <section class="card"><h2>Topic-wise analysis</h2>
      <p class="small muted">Strong ≥ ${STRONG}% · Needs revision ${WEAK}–${STRONG - 1}% · Weak &lt; ${WEAK}% (judged only when ${MIN_Q}+ questions were attempted).</p>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct</th><th style="width:28%">Accuracy</th><th>Status</th><th>Avg time</th><th></th></tr>
      ${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c}/${x.tot}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="badge ${x.st.cls}">${x.st.label}</span></td><td>${Math.round(x.v.t / (x.tot || 1))}s</td><td><button class="btn sm" data-t="practiceTopic:${x.t}">Practise</button></td></tr>`).join("")}</table></div></section>
    ${tlBlock}
    <section class="card"><h2>🔁 Re-attempt options</h2><div class="row">
      ${a.paperId || a.testId ? `<button class="btn" data-t="reattempt:${a.id}:full">Full ${a.paperId ? "paper" : "test"}</button>` : ""}
      <button class="btn" data-t="reattempt:${a.id}:wrong" ${cnt("wrong") ? "" : "disabled"}>Wrong only (${cnt("wrong")})</button>
      <button class="btn" data-t="reattempt:${a.id}:skip" ${cnt("skip") ? "" : "disabled"}>Unattempted only (${cnt("skip")})</button>
      <button class="btn" data-t="reattempt:${a.id}:both" ${cnt("both") ? "" : "disabled"}>Wrong + unattempted (${cnt("both")})</button>
      <button class="btn" data-t="reattempt:${a.id}:slow" ${cnt("slow") ? "" : "disabled"}>Slow (&gt; 60 s) (${cnt("slow")})</button>
      <button class="btn" data-t="reattempt:${a.id}:changed" ${cnt("changed") ? "" : "disabled"}>Answer changed (${cnt("changed")})</button>
      <button class="btn" data-t="reattempt:${a.id}:weak" ${focus.length ? "" : "disabled"}>Weak topics from this test (new questions)</button></div></section>
    <section class="card"><div class="row"><h2 class="grow">Question review &amp; explanations</h2>
      ${rv && !locked ? ["all", "wrong", "skip", "ok"].map(f => `<button class="tab ${rv.filter === f ? "on" : ""}" data-t="rfilter:${a.id}:${f}">${{ all: "All", wrong: "Wrong", skip: "Skipped", ok: "Correct" }[f]}</button>`).join("") : ""}</div>
      ${locked ? `<p class="badge warn">🔒 Solutions unlock ${esc(unlock)} so everyone can take the test first.</p>` : rv ? reviewList(a, rv) : `<p class="muted">See every question with your answer, the correct answer, the explanation, your notes and the video solution (if added).</p><button class="btn primary" data-t="review:${a.id}">Open question review</button>`}
    </section>`;
  };

  function reviewList(a, rv) {
    const out = [];
    a.questionIds.forEach((id, i) => {
      const q = X.cache.q[id], r = a.result.q?.[id]; if (!q || !r) return;
      const state = r[0] < 0 ? "skip" : r[0] === r[1] ? "ok" : "bad";
      if (rv.filter === "wrong" && state !== "bad") return; if (rv.filter === "skip" && state !== "skip") return; if (rv.filter === "ok" && state !== "ok") return;
      out.push(X.qCard(q, { no: i + 1, chosen: r[0], correct: r[1], state, time: r[2] }));
    });
    return out.join("") || `<p class="empty">Nothing in this filter.</p>`;
  }

  // ---------- actions ----------
  A.ttab = t => { st.testTab = t; X.rerender(); };
  A.histToggle = id => { st.histOpen[id] = !st.histOpen[id]; X.rerender(); };
  A.resume = id => X.openRunner(id);
  A.gen = () => X.startGen();
  A.smart = () => X.startSmart(20);
  A.daily = () => X.startDaily();
  A.practiceDue = () => X.startIds(X.dueMistakes().map(m => m.qid), "Mistakes due for review", "mistakes");
  A.reattempt = arg => { const [id, kind] = arg.split(":"); return X.startReattempt(id, kind); };
  A.practiceTopic = id => X.startTopic(id);
  A.topicRes = id => X.openTopicDrawer?.(id);
  A.review = async id => {
    const a = S.attempts.find(x => x.id === id); if (!a) return;
    toast("Loading questions…"); await X.loadQuestions(a.questionIds); st.review[id] = { filter: "all" }; X.rerender();
  };
  A.rfilter = arg => { const [id, f] = arg.split(":"); st.review[id].filter = f; X.rerender(); };
  A.explain = async id => { if (st.exp[id]) { delete st.exp[id]; return X.rerender(); } await X.loadKeys([id]); st.exp[id] = true; X.rerender(); };
  A.toggleq = async id => {
    if (st.open[id]) { delete st.open[id]; return X.rerender(); }
    await Promise.all([X.loadQuestions([id]), X.loadKeys([id])]);
    if (!X.cache.q[id]) return toast("This question is no longer in the bank.");
    st.open[id] = true; X.rerender();
  };
  A.save = async id => {
    const ex = S.bookmarks.find(b => b.qid === id), docId = `${S.me.uid}_${id}`;
    if (ex) return db.remove("bookmarks", docId).then(() => toast("Removed from saved"));
    const m = X.metaOf(id); await db.set("bookmarks", docId, { uid: S.me.uid, qid: id, subject: m?.s || "", topicId: m?.t || "", at: Date.now() }); toast("Saved ⭐");
  };
  A.confused = async id => {
    const m = X.metaOf(id), ex = S.mistakes.find(x => x.qid === id);
    await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, qid: id, subject: m?.s || ex?.subject || "", topicId: m?.t || ex?.topicId || "", confused: !ex?.confused, count: ex?.count || 0, resolved: false, due: ex?.due || Date.now(), lastAt: Date.now() });
    toast(ex?.confused ? "Doubt cleared" : "Added to your notebook as a doubt");
  };
  A.noteToggle = id => { st.noteOpen[id] = !st.noteOpen[id]; X.rerender(); };
  A.saveNote = async id => {
    const el = document.querySelector(`[data-note="${id}"]`), text = (el?.value || "").trim();
    if (!text) await db.remove("qnotes", `${S.me.uid}_${id}`); else await db.set("qnotes", `${S.me.uid}_${id}`, { uid: S.me.uid, qid: id, text, at: Date.now() });
    delete st.noteOpen[id]; toast(text ? "Note saved ✔" : "Note removed"); X.rerender();
  };
  A.aiprompt = async id => {
    await Promise.all([X.loadQuestions([id]), X.loadKeys([id])]); const q = X.cache.q[id], k = X.cache.k[id]; if (!q || !k) return toast("Question not available.");
    const text = `Explain this SSC CGL question like I'm a beginner. Give a simple step-by-step method and, if one exists, a quick shortcut.\n\nQuestion: ${q.question}\n${q.options.map((o, j) => `${L[j]}) ${o}`).join("\n")}\n\nCorrect answer: ${L[k.correct]}) ${q.options[k.correct]}\n${k.explanation ? "Given explanation: " + k.explanation : ""}`;
    navigator.clipboard.writeText(text).then(() => toast("AI prompt copied – paste it into ChatGPT / Claude / Gemini"), () => toast("Copy failed"));
  };
  A.report = id => {
    X.showModal(`<h2>🚩 Report this question</h2><form id="repForm" class="form">
      <label>What's wrong?<select name="reason" class="input">${["Wrong answer key", "Incorrect option", "Question incomplete", "Explanation unclear", "Duplicate question", "Image missing", "Other"].map(r => `<option>${r}</option>`).join("")}</select></label>
      <label>Details (optional)<textarea name="text" class="input" rows="3" maxlength="500" placeholder="e.g. correct answer should be C because…"></textarea></label>
      <div class="row"><button class="btn primary">Send to admin</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#repForm").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await db.add("reports", { uid: S.me.uid, qid: id, reason: f.reason, text: f.text.trim(), status: "open" });
      db.set("flags", id, { uid: S.me.uid, at: Date.now() }).catch(() => {});   // holds the question back from random tests until the admin reviews it
      X.closeModal(); toast("Thanks – the admin will review it ✔");
    };
  };
}
