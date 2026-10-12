// Student-facing pages: Tests, Result, Notebook (mistakes + saved), Analytics, dashboard coach card.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { MIN_Q, STRONG, WEAK, REASONS, KIND, DIFFS, REPORT_REASONS, fmtDur, fmtDate, r1, rate, getPath, topicState, donut, stack, ring, trendSVG, imgUrl } from "./t_util.js";

export function initViews(X) {
  const { S, st, db, $, esc, toast, avatar } = X;
  const A = (X.act = {});
  const L = "ABCD";

  // ---------- small UI builders bound to the `st` state object ----------
  const val = p => getPath(st, p);
  const ui = (X.ui = {
    num: (p, extra = "") => `<input class="input" type="number" data-bind="${p}" value="${esc(val(p))}" ${extra}>`,
    text: (p, extra = "") => `<input class="input" data-bind="${p}" value="${esc(val(p))}" ${extra}>`,
    area: (p, extra = "") => `<textarea class="input" data-bind="${p}" ${extra}>${esc(val(p))}</textarea>`,
    select: (p, opts, extra = "") => `<select class="input" data-bind="${p}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val(p)) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`,
    radio: (p, v, label) => `<label class="radio"><input type="radio" name="${p}" data-bind="${p}" data-rerender value="${esc(v)}" ${val(p) === v ? "checked" : ""}> ${label}</label>`,
    check: (p, label, extra = "") => `<label class="check"><input type="checkbox" data-bind="${p}" ${val(p) ? "checked" : ""} ${extra}> ${label}</label>`
  });
  const subjectOpts = (all = "All subjects") => [["", all], ...SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`])];
  X.topicOpts = (subject, all = "All topics") => {
    if (!subject) return [["", all]];
    return [["", all], ...SUBJECT_MAP[subject].topics.map(t => [t.id, `${t.name} (${X.scope({ topic: t.id }).length})`])];
  };
  const kindBadge = k => `<span class="badge">${KIND[k] || "Test"}</span>`;
  const secDefaults = [[30, "30 sec / question"], [45, "45 sec / question"], [60, "60 sec / question"], [90, "90 sec / question"]];

  // ---------- reusable question card (result review + notebook) ----------
  X.qCard = (q, o = {}) => {
    const k = X.cache.k[q.id];
    const correct = o.correct ?? k?.correct;
    const chosen = o.chosen;
    const opts = (q.options || []).map((t, j) => {
      const isC = j === correct, isY = j === chosen && chosen >= 0;
      return `<div class="ropt ${isC ? "ok" : isY ? "bad" : ""}"><b>${L[j]}</b><span>${esc(t)}</span>${isC ? "<em>✔ Correct</em>" : isY ? "<em>✖ Your answer</em>" : ""}</div>`;
    }).join("");
    const bm = S.bookmarks.some(b => b.qid === q.id);
    const mk = S.mistakes.find(m => m.qid === q.id);
    const exp = st.exp[q.id] && k
      ? `<div class="expl"><b>Explanation</b><p>${esc(k.explanation || "No explanation has been added for this question yet.")}</p>
         <div class="row">${k.videoUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(k.videoUrl)}">▶ Watch solution</a>` : ""}${k.notesUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(k.notesUrl)}">📄 Open notes</a>` : ""}</div></div>` : "";
    const stBadge = o.state === "ok" ? `<span class="badge ok">Correct</span>` : o.state === "bad" ? `<span class="badge off">Wrong</span>` : o.state === "skip" ? `<span class="badge low">Skipped</span>` : "";
    return `<div class="rcard ${o.state || ""}">
      <div class="rhead"><b>${o.no ? "Q" + o.no : ""}</b><span class="chip">${esc(TOPIC_MAP[q.topicId]?.name || "")}</span>${stBadge}${q.year ? `<small class="muted">PYQ ${esc(q.year)}</small>` : ""}${o.time !== undefined ? `<small class="muted">⏱ ${o.time}s</small>` : ""}</div>
      <div class="rq">${esc(q.question)}</div>
      ${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="" referrerpolicy="no-referrer">` : ""}
      <div class="ropts">${opts}</div>${exp}
      <div class="row ractions">
        <button class="btn sm" data-t="explain:${q.id}">${st.exp[q.id] ? "Hide" : "💡 Show"} explanation</button>
        <button class="btn sm ${bm ? "primary" : ""}" data-t="save:${q.id}">${bm ? "⭐ Saved" : "☆ Save"}</button>
        <button class="btn sm ${mk?.confused ? "primary" : ""}" data-t="confused:${q.id}">❓ ${mk?.confused ? "Marked as doubt" : "I didn't understand"}</button>
        <button class="btn sm ghost" data-t="report:${q.id}">🚩 Report</button>
      </div></div>`;
  };

  // ---------- TESTS page ----------
  function testCard(t) {
    const mine = S.attempts.filter(a => a.testId === t.id);
    const run = mine.find(a => a.status === "running");
    const done = mine.filter(a => a.status === "submitted");
    const left = t.maxAttempts > 0 ? Math.max(0, t.maxAttempts - mine.length) : null;
    const dur = t.timerMode === "none" ? "No timer" : fmtDur(X.calcDuration(t.total, t.timerMode, t.secPerQ, t.manualMin));
    const best = done.length ? Math.max(...done.map(a => a.result.percent)) : null;
    return `<div class="card test-card">
      <div class="row"><b class="grow">${esc(t.title)}</b>${t.mode === "fixed" ? `<span class="badge">Fixed paper</span>` : `<span class="badge">Random</span>`}</div>
      ${t.desc ? `<p class="small muted">${esc(t.desc)}</p>` : ""}
      <div class="meta"><span>📝 ${t.total} questions</span><span>⏱ ${dur}</span><span>+${t.pos} / −${t.neg}</span><span>🔁 ${left === null ? "Unlimited" : left + " attempt" + (left === 1 ? "" : "s") + " left"}</span></div>
      ${best !== null ? `<p class="small">Best score: <b>${best}%</b> · ${done.length} attempt${done.length > 1 ? "s" : ""}</p>` : ""}
      <div class="row">${run ? `<button class="btn primary" data-t="resume:${run.id}">▶ Resume</button>` : left === 0 ? `<button class="btn" disabled>No attempts left</button>` : `<button class="btn primary" data-t="start:${t.id}">Start test</button>`}
      ${done.length ? `<a class="btn" href="#result/${done.at(-1).id}">Last result</a>` : ""}</div></div>`;
  }

  X.viewTests = () => {
    const g = st.gen, bank = X.allPool().length;
    const running = S.attempts.filter(a => a.status === "running");
    const tests = S.tests.filter(t => t.published);
    const avail = X.scope({ subject: g.subject, topic: g.topic, diff: g.diff }).length;
    const n = Math.min(Number(g.count) || 0, avail);
    const dur = g.timerMode === "none" ? "No timer" : fmtDur(X.calcDuration(n, g.timerMode, g.secPerQ, g.manualMin));
    const recent = S.attempts.slice(0, 12);
    return `
    <header class="page-head"><div><h1>📝 Tests</h1><p class="muted">Timed MCQ practice from the group's question bank (${bank} questions).</p></div>
      <button class="btn primary" data-t="smart">⚡ 1-click revision test</button></header>
    ${running.map(a => `<div class="notice">⏳ <span class="grow"><b>${esc(a.title)}</b> is in progress.</span><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></div>`).join("")}
    ${!bank ? `<div class="card tip"><b>The question bank is empty.</b> ${S.me.isAdmin ? `Go to <a href="#admin" data-admintab="qbank">Admin → Question bank</a> and import your CSV.` : "Ask the admin to import the PYQ questions."}</div>` : ""}

    <h2>Tests from admin</h2>
    <div class="grid cards">${tests.map(testCard).join("") || `<p class="empty">No tests published yet.</p>`}</div>

    <section class="card"><h2>🎯 Create your own test</h2>
      <div class="form-grid">
        <label>Questions from<div class="rg">${ui.radio("gen.source", "random", "Random mix")}${ui.radio("gen.source", "weak", "Weak topics")}${ui.radio("gen.source", "mistakes", "My mistakes")}${ui.radio("gen.source", "unseen", "Unseen only")}</div></label>
        <label>Subject${ui.select("gen.subject", subjectOpts(), "data-rerender")}</label>
        <label>Topic${ui.select("gen.topic", X.topicOpts(g.subject), "data-rerender")}</label>
        <label>Difficulty${ui.select("gen.diff", [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "data-rerender")}</label>
        <label>Number of questions${ui.num("gen.count", 'min="1" max="100"')}</label>
        <label>Timer<div class="rg">${ui.radio("gen.timerMode", "auto", "Auto (per question)")}${ui.radio("gen.timerMode", "manual", "Manual")}${ui.radio("gen.timerMode", "none", "No timer")}</div></label>
        ${g.timerMode === "auto" ? `<label>Time per question${ui.select("gen.secPerQ", secDefaults, "data-rerender")}</label>` : ""}
        ${g.timerMode === "manual" ? `<label>Total minutes${ui.num("gen.manualMin", 'min="1" max="240"')}</label>` : ""}
        <label>Marks per correct / wrong<div class="row">${ui.num("gen.pos", 'step="0.25" min="0"')}${ui.num("gen.neg", 'step="0.25" min="0"')}</div></label>
        <label class="center">${ui.check("gen.shuffleOpt", "Shuffle options")}</label>
      </div>
      <div class="gen-sum">📦 ${avail} questions match · test will have <b>${n}</b> · ${dur}</div>
      <button class="btn primary" data-t="gen" ${avail ? "" : "disabled"}>Start test</button>
    </section>

    <section class="card"><h2>Recent attempts</h2>
      <div class="table-wrap"><table class="list"><tr><th>Test</th><th>Type</th><th>Score</th><th>Accuracy</th><th>Time</th><th>Date</th><th></th></tr>
      ${recent.map(a => a.status === "running"
        ? `<tr><td>${esc(a.title)}</td><td>${kindBadge(a.kind)}</td><td colspan="4"><span class="badge warn">In progress</span></td><td><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></td></tr>`
        : `<tr><td>${esc(a.title)}</td><td>${kindBadge(a.kind)}</td><td><b>${a.result.score}</b>/${a.result.max} <small class="muted">(${a.result.percent}%)</small></td><td>${a.result.accuracy}%</td><td>${fmtDur(a.result.timeUsed)}</td><td>${fmtDate(a.submittedAt)}</td><td><a class="btn sm" href="#result/${a.id}">Result</a></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No attempts yet – start your first test above.</td></tr>`}
      </table></div></section>`;
  };

  // ---------- RESULT page ----------
  const insight = (v, target) => {
    const att = v.c + v.w; if (att < MIN_Q) return "";
    const acc = (v.c / att) * 100, avg = v.t / att;
    if (acc < WEAK && avg < target * 0.6) return "⚡ Fast but inaccurate – slow down and read carefully; avoid guessing.";
    if (acc < WEAK && avg > target * 1.2) return "🧠 Slow and inaccurate – likely a concept gap. Revise the theory first.";
    if (acc < WEAK) return "📚 Low accuracy – revise concepts and practise more of this section.";
    if (acc >= STRONG && avg > target * 1.2) return "⏱ Accurate but slow – practise for speed.";
    if (acc >= STRONG) return "✅ Strong section – keep revising to hold it.";
    return "🔁 Decent – clear the weak topics to cross 75%.";
  };

  X.viewResult = () => {
    const a = S.attempts.find(x => x.id === S.arg);
    if (!a) return `<p class="empty">Loading result…</p><a class="btn" href="#tests">Back to tests</a>`;
    if (a.status === "running") return `<div class="card"><b>This test is still in progress.</b> <button class="btn primary" data-t="resume:${a.id}">Resume</button></div>`;
    const r = a.result, target = a.durationSec && r.total ? a.durationSec / r.total : 45;
    const rows = Object.entries(r.byTopic || {}).filter(([t]) => TOPIC_MAP[t]).map(([t, v]) => ({ t, v, st: topicState(v), tot: v.c + v.w + v.u, acc: rate(v.c, v.w) }))
      .sort((x, y) => (x.acc ?? 101) - (y.acc ?? 101));
    const focus = rows.filter(x => x.v.w > 0).slice(0, 3);
    const subs = Object.entries(r.bySubject || {});
    const wrongN = Object.values(r.q || {}).filter(v => v[0] >= 0 && v[0] !== v[1]).length;
    const rv = st.review[a.id];
    return `
    <header class="page-head"><div><a href="#tests" class="small">← Back to tests</a><h1>${esc(a.title)}</h1><p class="muted">${kindBadge(a.kind)} ${fmtDate(a.submittedAt)} · +${a.pos}${a.neg ? ` / −${a.neg}` : ""} marking</p></div>
      <div class="row"><button class="btn primary" data-t="retest:${a.id}" ${wrongN ? "" : "disabled"}>🔁 Retest wrong (${wrongN})</button><button class="btn" data-t="smart">⚡ Revision test</button></div></header>

    <section class="grid result-top">
      <div class="card score-card"><small class="muted">Your score</small><div class="big-score">${r.score}<span>/ ${r.max}</span></div><div class="muted">${r.percent}% · accuracy ${r.accuracy}%</div>
        <div class="chips2"><span class="c-a">${r.correct}<small>Correct</small></span><span class="c-n">${r.wrong}<small>Wrong</small></span><span class="c-v">${r.unattempted}<small>Skipped</small></span><span class="c-m">${fmtDur(r.timeUsed)}<small>Time used${a.durationSec ? " of " + fmtDur(a.durationSec) : ""}</small></span></div></div>
      <div class="card center-col">${donut(r.correct, r.wrong, r.unattempted)}<div class="legend"><span><i class="dot" style="background:#10b981"></i>Correct</span><span><i class="dot" style="background:#ef4444"></i>Wrong</span><span><i class="dot" style="background:#d1d5db"></i>Skipped</span></div></div>
    </section>

    ${focus.length ? `<section class="card focus"><h2>🎯 Work on these next</h2><div class="row">${focus.map(x => `<div class="focus-item"><b>${esc(TOPIC_MAP[x.t].name)}</b><small>${x.v.c}/${x.v.c + x.v.w} correct · <span class="badge ${x.st.cls}">${x.st.label}</span></small><button class="btn sm" data-t="practiceTopic:${x.t}">Practise 10 Qs</button></div>`).join("")}</div></section>` : ""}

    <section class="card"><h2>Subject-wise performance</h2>
      ${subs.map(([sid, v]) => `<div class="sub-row"><div class="sub-h"><b>${SUBJECT_MAP[sid]?.icon || ""} ${esc(SUBJECT_MAP[sid]?.name || sid)}</b><span>${v.c}/${v.c + v.w + v.u} correct${rate(v.c, v.w) !== null ? ` · accuracy ${rate(v.c, v.w)}%` : ""}</span></div>${stack(v.c, v.w, v.u)}<div class="small muted">${insight(v, target)}</div></div>`).join("")}
    </section>

    <section class="card"><h2>Topic-wise analysis</h2>
      <p class="small muted">Strong ≥ ${STRONG}% · Needs revision ${WEAK}–${STRONG - 1}% · Weak &lt; ${WEAK}% (judged only when ${MIN_Q}+ questions were attempted).</p>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct</th><th style="width:28%">Accuracy</th><th>Status</th><th>Avg time</th><th></th></tr>
      ${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c}/${x.tot}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="badge ${x.st.cls}">${x.st.label}</span></td><td>${Math.round(x.v.t / (x.tot || 1))}s</td><td><button class="btn sm" data-t="practiceTopic:${x.t}">Practise</button></td></tr>`).join("")}</table></div></section>

    <section class="card"><div class="row"><h2 class="grow">Question review &amp; explanations</h2>
      ${rv ? ["all", "wrong", "skip", "ok"].map(f => `<button class="tab ${rv.filter === f ? "on" : ""}" data-t="rfilter:${a.id}:${f}">${{ all: "All", wrong: "Wrong", skip: "Skipped", ok: "Correct" }[f]}</button>`).join("") : ""}</div>
      ${rv ? reviewList(a, rv) : `<p class="muted">See every question with your answer, the correct answer, the explanation and the video solution (if added).</p><button class="btn primary" data-t="review:${a.id}">Open question review</button>`}
    </section>`;
  };

  function reviewList(a, rv) {
    const out = [];
    a.questionIds.forEach((id, i) => {
      const q = X.cache.q[id]; const r = a.result.q?.[id]; if (!q || !r) return;
      const state = r[0] < 0 ? "skip" : r[0] === r[1] ? "ok" : "bad";
      if (rv.filter === "wrong" && state !== "bad") return;
      if (rv.filter === "skip" && state !== "skip") return;
      if (rv.filter === "ok" && state !== "ok") return;
      out.push(X.qCard(q, { no: i + 1, chosen: r[0], correct: r[1], state, time: r[2] }));
    });
    return out.join("") || `<p class="empty">Nothing in this filter.</p>`;
  }

  // ---------- NOTEBOOK ----------
  X.viewNotebook = () => {
    const tab = st.nbTab;
    const mk = S.mistakes.filter(m => (st.nbStatus === "all" || (st.nbStatus === "resolved" ? m.resolved : !m.resolved)));
    const unres = S.mistakes.filter(m => !m.resolved);
    const reasons = Object.fromEntries(Object.keys(REASONS).map(k => [k, 0])); let unc = 0;
    unres.forEach(m => (m.reason ? reasons[m.reason]++ : unc++));
    const tot = unres.length || 1;
    const rowFor = (id, head, right) => `<div class="nb-row"><div class="nb-h">${head}${right}</div>${st.open[id] && X.cache.q[id] ? X.qCard(X.cache.q[id], {}) : ""}</div>`;
    const mkRows = mk.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).map(m => rowFor(m.qid,
      `<div class="grow"><b>${esc(TOPIC_MAP[m.topicId]?.name || "Question")}</b> <small class="muted">${SUBJECT_MAP[m.subject]?.icon || ""} ${esc(SUBJECT_MAP[m.subject]?.name?.split(" ")[0] || "")}</small>
        ${m.count ? `<span class="badge off">wrong ×${m.count}</span>` : ""}${m.confused ? ` <span class="badge warn">❓ doubt</span>` : ""}${m.resolved ? ` <span class="badge ok">resolved</span>` : ""}<div class="small muted">last ${fmtDate(m.lastAt)}</div></div>`,
      `<select class="input sm" data-tchange="reason:${m.qid}"><option value="">Why did I miss it?</option>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}" ${m.reason === k ? "selected" : ""}>${v}</option>`).join("")}</select>
       <button class="btn sm" data-t="toggleq:${m.qid}">${st.open[m.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-t="resolve:${m.qid}">${m.resolved ? "Reopen" : "✓ Resolved"}</button>`)).join("");
    const bmRows = [...S.bookmarks].sort((a, b) => (b.at || 0) - (a.at || 0)).map(b => rowFor(b.qid,
      `<div class="grow"><b>${esc(TOPIC_MAP[b.topicId]?.name || "Saved question")}</b> <small class="muted">${SUBJECT_MAP[b.subject]?.icon || ""} ${esc(SUBJECT_MAP[b.subject]?.name?.split(" ")[0] || "")}</small><div class="small muted">saved ${fmtDate(b.at)}</div></div>`,
      `<button class="btn sm" data-t="toggleq:${b.qid}">${st.open[b.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-t="save:${b.qid}">Remove</button>`)).join("");
    return `
    <header class="page-head"><div><h1>📓 Notebook</h1><p class="muted">Your wrong answers and starred questions in one place.</p></div>
      <div class="row">${tab === "mistakes" ? `<button class="btn primary" data-t="practiceMistakes" ${unres.length ? "" : "disabled"}>Practise my mistakes (${unres.length})</button>` : `<button class="btn primary" data-t="practiceSaved" ${S.bookmarks.length ? "" : "disabled"}>Practise saved (${S.bookmarks.length})</button>`}</div></header>
    <div class="tabs"><button class="tab ${tab === "mistakes" ? "on" : ""}" data-t="nbtab:mistakes">❌ Mistakes <small>${unres.length}</small></button><button class="tab ${tab === "saved" ? "on" : ""}" data-t="nbtab:saved">⭐ Saved <small>${S.bookmarks.length}</small></button></div>
    ${tab === "mistakes" ? `
      <section class="card"><h2>Why am I missing questions?</h2>
        ${unres.length ? `<div class="reason-bars">${[...Object.entries(REASONS), ["none", "Not classified yet"]].map(([k, lab]) => { const n = k === "none" ? unc : reasons[k]; return `<div class="rb"><span>${lab}</span><div class="bar sm"><i style="width:${(n / tot) * 100}%;background:${k === "none" ? "#d1d5db" : "#4f46e5"}"></i></div><b>${n}</b></div>`; }).join("")}</div><p class="small muted">Tag each mistake below – the pattern tells you whether to study concepts, practise calculations, or manage time.</p>` : `<p class="empty">No unresolved mistakes. Take a test and they'll appear here automatically.</p>`}
      </section>
      <section class="card"><div class="row"><h2 class="grow">My mistakes</h2>${["unresolved", "resolved", "all"].map(s => `<button class="tab ${st.nbStatus === s ? "on" : ""}" data-t="nbstatus:${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>
        ${mkRows || `<p class="empty">Nothing here.</p>`}</section>`
      : `<section class="card"><h2>Saved questions</h2>${bmRows || `<p class="empty">Tap ☆ Save on any question during review to keep it here.</p>`}</section>`}`;
  };

  // ---------- ANALYTICS ----------
  X.viewAnalytics = () => {
    const stt = X.stats(), att = stt.attempts;
    if (!att.length) return `<header class="page-head"><div><h1>📈 Analytics</h1></div></header><div class="card"><p class="empty">Take your first test to unlock topic-wise analysis, trends and your exam-readiness score.</p><a class="btn primary" href="#tests">Go to tests</a></div>`;
    const last5 = att.slice(-5), recent = last5.reduce((s, a) => s + Math.max(0, a.result.percent), 0) / last5.length;
    const syl = X.pct(S.me.uid);
    const bankTopics = new Set(X.allPool().map(q => q.t));
    const covered = [...bankTopics].filter(t => { const v = stt.byTopic[t]; return v && v.c + v.w >= MIN_Q; }).length;
    const cov = bankTopics.size ? (covered / bankTopics.size) * 100 : 0;
    const ready = Math.round(0.5 * recent + 0.3 * syl + 0.2 * cov);
    const label = ready >= 80 ? "Exam ready" : ready >= 65 ? "On track" : ready >= 40 ? "Building" : "Early stage";
    const trend = att.slice(-15);
    const rows = Object.entries(stt.byTopic).filter(([t]) => TOPIC_MAP[t] && (!st.anSubject || TOPIC_MAP[t].subject === st.anSubject))
      .map(([t, v]) => ({ t, v, s: topicState(v), acc: rate(v.c, v.w), tot: v.c + v.w + v.u })).filter(x => x.v.c + x.v.w > 0).sort((a, b) => (a.acc ?? 101) - (b.acc ?? 101));
    const subs = Object.entries(stt.bySubject);
    return `
    <header class="page-head"><div><h1>📈 Analytics</h1><p class="muted">Based on ${att.length} submitted test${att.length > 1 ? "s" : ""}.</p></div></header>
    <section class="grid two">
      <div class="card center-col">${ring(ready, `Exam readiness · <b>${label}</b>`)}<p class="small muted center">50% recent test score (${Math.round(recent)}%) + 30% syllabus completed (${syl}%) + 20% topics practised in tests (${Math.round(cov)}%). A guide, not a prediction.</p></div>
      <div class="card"><h2>Score &amp; accuracy trend</h2>${trendSVG([{ name: "Score %", color: "#4f46e5", vals: trend.map(a => Math.max(0, a.result.percent)) }, { name: "Accuracy %", color: "#10b981", vals: trend.map(a => a.result.accuracy) }])}</div>
    </section>
    <section class="card"><h2>Subject-wise accuracy &amp; speed</h2>
      <div class="table-wrap"><table class="list"><tr><th>Subject</th><th>Questions</th><th style="width:30%">Result</th><th>Accuracy</th><th>Avg time</th><th>Insight</th></tr>
      ${subs.map(([sid, v]) => `<tr><td>${SUBJECT_MAP[sid]?.icon || ""} ${esc(SUBJECT_MAP[sid]?.name || sid)}</td><td>${v.c + v.w + v.u}</td><td>${stack(v.c, v.w, v.u)}</td><td>${rate(v.c, v.w) ?? "–"}%</td><td>${Math.round(v.t / Math.max(1, v.c + v.w + v.u))}s</td><td class="small">${insight(v, 45) || "<span class='muted'>need more data</span>"}</td></tr>`).join("")}</table></div></section>
    <section class="card"><div class="row"><h2 class="grow">Topic-wise accuracy (all tests)</h2>
      <button class="tab ${!st.anSubject ? "on" : ""}" data-t="anSubject:">All</button>${SUBJECTS.filter(s => subs.some(([k]) => k === s.id)).map(s => `<button class="tab ${st.anSubject === s.id ? "on" : ""}" data-t="anSubject:${s.id}">${s.icon}</button>`).join("")}</div>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct / attempted</th><th style="width:26%">Accuracy</th><th>Status</th><th>Avg time</th><th></th></tr>
      ${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c} / ${x.v.c + x.v.w}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="badge ${x.s.cls}">${x.s.label}</span></td><td>${Math.round(x.v.t / Math.max(1, x.tot))}s</td><td><button class="btn sm" data-t="practiceTopic:${x.t}">Practise</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No data for this subject yet.</td></tr>`}</table></div>
      <p class="small muted">${[...bankTopics].length - covered} of ${bankTopics.size} topics in the bank still need ${MIN_Q}+ attempted questions for a reliable status.</p></section>`;
  };

  // ---------- dashboard coach ----------
  X.coachCard = () => {
    const run = S.attempts.filter(a => a.status === "running");
    const weak = X.weakTopics(3), unres = S.mistakes.filter(m => !m.resolved).length, due = X.dueCount(), bank = X.allPool().length;
    const hasData = X.submitted().length > 0;
    return `<section class="card coach"><h2>🎯 Today's focus</h2>
      ${run.map(a => `<div class="notice">⏳ <span class="grow">Test in progress: <b>${esc(a.title)}</b></span><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></div>`).join("")}
      <div class="coach-grid">
        <div><small class="muted">Weak topics</small>${weak.length ? weak.map(x => `<div class="li"><span class="grow">${esc(TOPIC_MAP[x.t].name)}</span><span class="badge off">${Math.round(x.acc)}%</span></div>`).join("") : `<p class="small muted">${hasData ? "No weak topics right now 👍" : "Take a test to find your weak topics."}</p>`}</div>
        <div><small class="muted">To do today</small>
          <div class="li"><span class="grow">🔁 Topics due for revision</span><b>${due}</b></div>
          <div class="li"><span class="grow">❌ Unresolved mistakes</span><a href="#notebook"><b>${unres}</b></a></div></div>
      </div>
      <div class="row"><button class="btn primary" data-t="smart" ${bank ? "" : "disabled"}>⚡ 1-click revision test</button><a class="btn" href="#tests">📝 All tests</a><a class="btn" href="#analytics">📈 Analytics</a></div></section>`;
  };

  // ---------- actions ----------
  A.start = id => X.startTest(id);
  A.resume = id => X.openRunner(id);
  A.gen = () => X.startGen();
  A.smart = () => X.startSmart(20);
  A.retest = id => X.startRetest(id);
  A.practiceTopic = id => X.startTopic(id);
  A.practiceMistakes = () => X.startIds(X.mistakeIds(true), "Practice my mistakes", "mistakes");
  A.practiceSaved = () => X.startIds(S.bookmarks.map(b => b.qid), "Practice saved questions", "practice");
  A.nbtab = t => { st.nbTab = t; X.rerender(); };
  A.nbstatus = s => { st.nbStatus = s; X.rerender(); };
  A.anSubject = s => { st.anSubject = s; X.rerender(); };
  A.review = async id => {
    const a = S.attempts.find(x => x.id === id); if (!a) return;
    toast("Loading questions…");
    await X.loadQuestions(a.questionIds);
    st.review[id] = { filter: "all" }; X.rerender();
  };
  A.rfilter = (arg) => { const [id, f] = arg.split(":"); st.review[id].filter = f; X.rerender(); };
  A.explain = async id => {
    if (st.exp[id]) { delete st.exp[id]; return X.rerender(); }
    await X.loadKeys([id]); st.exp[id] = true; X.rerender();
  };
  A.toggleq = async id => {
    if (st.open[id]) { delete st.open[id]; return X.rerender(); }
    await Promise.all([X.loadQuestions([id]), X.loadKeys([id])]);
    if (!X.cache.q[id]) return toast("This question is no longer in the bank.");
    st.open[id] = true; X.rerender();
  };
  A.save = async id => {
    const ex = S.bookmarks.find(b => b.qid === id), docId = `${S.me.uid}_${id}`;
    if (ex) return db.remove("bookmarks", docId).then(() => toast("Removed from saved"));
    const m = X.metaOf(id);
    await db.set("bookmarks", docId, { uid: S.me.uid, qid: id, subject: m?.s || "", topicId: m?.t || "", at: Date.now() }); toast("Saved ⭐");
  };
  A.confused = async id => {
    const m = X.metaOf(id), ex = S.mistakes.find(x => x.qid === id);
    await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, qid: id, subject: m?.s || ex?.subject || "", topicId: m?.t || ex?.topicId || "", confused: !ex?.confused, count: ex?.count || 0, resolved: false, lastAt: Date.now() });
    toast(ex?.confused ? "Doubt cleared" : "Added to your notebook as a doubt");
  };
  A.resolve = async id => { const ex = S.mistakes.find(x => x.qid === id); await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, resolved: !ex?.resolved, lastAt: Date.now() }); };
  A.reason = async (id, el) => { await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, reason: el.value }); };
  A.report = id => {
    X.showModal(`<h2>🚩 Report this question</h2><form id="repForm" class="form">
      <label>What's wrong?<select name="reason" class="input">${REPORT_REASONS.map(r => `<option>${r}</option>`).join("")}</select></label>
      <label>Details (optional)<textarea name="text" class="input" rows="3" maxlength="500" placeholder="e.g. correct answer should be C because…"></textarea></label>
      <div class="row"><button class="btn primary">Send to admin</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#repForm").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await db.add("reports", { uid: S.me.uid, qid: id, reason: f.reason, text: f.text.trim(), status: "open" });
      X.closeModal(); toast("Thanks – the admin will review it ✔");
    };
  };
  A.delattempt = async id => { if (confirm("Delete this attempt?")) await db.remove("attempts", id); };
}
