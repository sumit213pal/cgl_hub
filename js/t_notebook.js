// Notebook (mistakes with spaced revision, saved questions, private notes), Analytics, dashboard coach card, student exports.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { MIN_Q, STRONG, WEAK, REASONS, DAY, fmtDate, fmtDay, fmtDur, r1, rate, topicState, stack, ring, trendSVG, dayKey, download } from "./t_util.js";
import { toCSV } from "./csv.js";

export function initNotebook(X) {
  const { S, st, db, $, esc, toast } = X, A = X.act, L = "ABCD";
  const pf = n => (n === null || n === undefined ? "–" : n + "%");

  const mstate = m => m.mastered ? `<span class="badge ok">✅ Mastered</span>` : m.resolved ? `<span class="badge ok">resolved</span>`
    : (m.due || 0) <= Date.now() ? `<span class="badge warn">🔔 Due for review</span>` : `<span class="badge low">Next review ${fmtDay(dayKey(m.due))}</span>`;

  // ---------- NOTEBOOK ----------
  X.viewNotebook = () => {
    const tab = st.nbTab, unres = S.mistakes.filter(m => !m.resolved), due = X.dueMistakes();
    const mk = S.mistakes.filter(m => st.nbStatus === "all" || (st.nbStatus === "resolved" ? m.resolved : !m.resolved));
    const reasons = Object.fromEntries(Object.keys(REASONS).map(k => [k, 0])); let unc = 0;
    unres.forEach(m => (m.reason ? reasons[m.reason]++ : unc++));
    const tot = unres.length || 1;
    const byTopic = {}; unres.forEach(m => { if (m.topicId) byTopic[m.topicId] = (byTopic[m.topicId] || 0) + 1; });
    const repeated = Object.entries(byTopic).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const rowFor = (id, head, right) => `<div class="nb-row"><div class="nb-h">${head}${right}</div>${st.open[id] && X.cache.q[id] ? X.qCard(X.cache.q[id], {}) : ""}</div>`;
    const mkRows = [...mk].sort((a, b) => ((a.resolved ? 1 : 0) - (b.resolved ? 1 : 0)) || (a.due || 0) - (b.due || 0)).map(m => {
      const note = S.qnotes.find(n => n.qid === m.qid);
      return rowFor(m.qid,
        `<div class="grow"><b>${esc(TOPIC_MAP[m.topicId]?.name || "Question")}</b> <small class="muted">${SUBJECT_MAP[m.subject]?.icon || ""} ${esc(X.subjName(m.subject))}</small>
         ${m.count ? `<span class="badge off">wrong ×${m.count}</span>` : ""}${m.confused ? ` <span class="badge warn">❓ doubt</span>` : ""} ${mstate(m)}
         <div class="small muted">last ${fmtDate(m.lastAt)}${(m.okDays || []).length ? ` · correct on ${(m.okDays || []).length} day${(m.okDays || []).length > 1 ? "s" : ""} (mastered after 2)` : ""}</div>${note ? `<div class="mynote">📝 ${esc(note.text)}</div>` : ""}</div>`,
        `<select class="input sm" data-tchange="reason:${m.qid}"><option value="">Why did I miss it?</option>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}" ${m.reason === k ? "selected" : ""}>${v}</option>`).join("")}</select>
         <button class="btn sm" data-t="toggleq:${m.qid}">${st.open[m.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-t="resolve:${m.qid}">${m.resolved ? "Reopen" : "✓ Resolved"}</button>`);
    }).join("");
    const bmRows = [...S.bookmarks].sort((a, b) => (b.at || 0) - (a.at || 0)).map(b => rowFor(b.qid,
      `<div class="grow"><b>${esc(TOPIC_MAP[b.topicId]?.name || "Saved question")}</b> <small class="muted">${SUBJECT_MAP[b.subject]?.icon || ""} ${esc(X.subjName(b.subject))}</small><div class="small muted">saved ${fmtDate(b.at)}</div></div>`,
      `<button class="btn sm" data-t="toggleq:${b.qid}">${st.open[b.qid] ? "Hide" : "View"}</button><button class="btn sm ghost" data-t="save:${b.qid}">Remove</button>`)).join("");
    return `
    <header class="page-head"><div><h1>📓 Notebook</h1><p class="muted">Wrong answers (with spaced revision), starred questions and your private notes.</p></div>
      <div class="row">${tab === "mistakes" ? `<button class="btn primary" data-t="practiceDue" ${due.length ? "" : "disabled"}>🔔 Practise due today (${due.length})</button><button class="btn" data-t="practiceMistakes" ${unres.length ? "" : "disabled"}>All unresolved (${unres.length})</button><button class="btn ghost" data-t="exportMistakes">⬇ Export CSV</button>`
        : `<button class="btn primary" data-t="practiceSaved" ${S.bookmarks.length ? "" : "disabled"}>Practise saved (${S.bookmarks.length})</button><button class="btn ghost" data-t="exportSaved">⬇ Export CSV</button>`}</div></header>
    <div class="tabs"><button class="tab ${tab === "mistakes" ? "on" : ""}" data-t="nbtab:mistakes">❌ Mistakes <small>${unres.length}</small></button><button class="tab ${tab === "saved" ? "on" : ""}" data-t="nbtab:saved">⭐ Saved <small>${S.bookmarks.length}</small></button></div>
    ${tab === "mistakes" ? `
      <section class="card"><h2>🧠 How the revision schedule works</h2><p class="small muted">A wrong answer is due for review <b>1 day</b> later. Answer it correctly (on a different day) and the next review is <b>3 days</b> later. Two correct answers on separate days = <b>mastered ✅</b>. A new wrong answer restarts the schedule.</p></section>
      ${repeated.length ? `<section class="card focus"><h2>🔥 Topics with repeated mistakes</h2><div class="row">${repeated.map(([t, n]) => `<div class="focus-item"><b>${esc(TOPIC_MAP[t]?.name || t)}</b><small>${n} unresolved mistakes</small><div class="row"><button class="btn sm" data-t="practiceTopic:${t}">Practise 10 Qs</button><button class="btn sm" data-t="topicRes:${t}">▶ Videos &amp; notes</button><button class="btn sm" data-t="vaultTopic:${t}">📐 Formula sheet</button></div></div>`).join("")}</div></section>` : ""}
      <section class="card"><h2>Why am I missing questions?</h2>
        ${unres.length ? `<div class="reason-bars">${[...Object.entries(REASONS), ["none", "Not classified yet"]].map(([k, lab]) => { const n = k === "none" ? unc : reasons[k]; return `<div class="rb"><span>${lab}</span><div class="bar sm"><i style="width:${(n / tot) * 100}%;background:${k === "none" ? "#d1d5db" : "#4f46e5"}"></i></div><b>${n}</b></div>`; }).join("")}</div><p class="small muted">Tag each mistake below – the pattern tells you whether to study concepts, practise calculations, or manage time.</p>` : `<p class="empty">No unresolved mistakes. Take a test and they'll appear here automatically.</p>`}
      </section>
      <section class="card"><div class="row"><h2 class="grow">My mistakes</h2>${["unresolved", "resolved", "all"].map(s => `<button class="tab ${st.nbStatus === s ? "on" : ""}" data-t="nbstatus:${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>
        ${mkRows || `<p class="empty">Nothing here.</p>`}</section>`
      : `<section class="card"><h2>Saved questions</h2>${bmRows || `<p class="empty">Tap ☆ Save on any question during review to keep it here.</p>`}</section>`}`;
  };

  A.practiceMistakes = () => X.startIds(X.mistakeIds(true), "Practice my mistakes", "mistakes");
  A.practiceSaved = () => X.startIds(S.bookmarks.map(b => b.qid), "Practice saved questions", "practice");
  A.nbtab = t => { st.nbTab = t; X.rerender(); };
  A.nbstatus = s => { st.nbStatus = s; X.rerender(); };
  A.anSubject = s => { st.anSubject = s; X.rerender(); };
  A.anTopic = (_, el) => { st.anTopic = el.value; X.rerender(); };
  A.anLearning = (_, el) => { st.anLearning = el.checked; X.rerender(); };
  A.resolve = async id => { const ex = S.mistakes.find(x => x.qid === id); await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, resolved: !ex?.resolved, mastered: false, due: ex?.resolved ? Date.now() : 0, lastAt: Date.now() }); };
  A.reason = async (id, el) => { await db.set("mistakes", `${S.me.uid}_${id}`, { uid: S.me.uid, reason: el.value }); };
  A.vaultTopic = id => { st.vault.subject = TOPIC_MAP[id].subject; st.vault.topic = id; location.hash = "vault"; };

  const exportQs = async (rows, file) => {
    const ids = rows.map(r => r.qid); toast("Preparing export…");
    await Promise.all([X.loadQuestions(ids), X.loadKeys(ids)]);
    const out = rows.map(r => { const q = X.cache.q[r.qid], k = X.cache.k[r.qid], n = S.qnotes.find(x => x.qid === r.qid); return { topic: TOPIC_MAP[r.topicId]?.name || "", question: q?.question || "(removed)", optionA: q?.options?.[0] || "", optionB: q?.options?.[1] || "", optionC: q?.options?.[2] || "", optionD: q?.options?.[3] || "", correct: k ? L[k.correct] : "", explanation: k?.explanation || "", timesWrong: r.count || "", status: r.mastered ? "mastered" : r.resolved ? "resolved" : r.count ? "open" : "", myNote: n?.text || "" }; });
    download(file, toCSV(out, ["topic", "question", "optionA", "optionB", "optionC", "optionD", "correct", "explanation", "timesWrong", "status", "myNote"]));
  };
  A.exportMistakes = () => exportQs(S.mistakes, "my_mistakes.csv");
  A.exportSaved = () => exportQs(S.bookmarks, "my_saved_questions.csv");

  // ---------- ANALYTICS ----------
  X.viewAnalytics = () => {
    const stt = X.stats({ learning: st.anLearning }), att = stt.attempts, exam = X.submitted();
    const head = `<header class="page-head"><div><h1>📈 Analytics</h1><p class="muted">${exam.length} exam-mode test${exam.length === 1 ? "" : "s"}${st.anLearning ? " + learning-mode attempts" : " (learning-mode practice is kept separate)"}.</p></div>
      <label class="check">${`<input type="checkbox" data-tchange="anLearning" ${st.anLearning ? "checked" : ""}> Include learning-mode attempts`}</label></header>`;
    if (!att.length) return `${head}<div class="card"><p class="empty">Take your first test to unlock topic-wise analysis, trends and your exam-readiness score.</p><a class="btn primary" href="#tests">Go to tests</a></div>`;
    const base = exam.length ? exam : att, last5 = base.slice(-5), recent = last5.reduce((s, a) => s + Math.max(0, a.result.percent), 0) / last5.length;
    const syl = X.pct(S.me.uid), bankTopics = new Set(X.allPool().map(q => q.t));
    const covered = [...bankTopics].filter(t => { const v = stt.byTopic[t]; return v && v.c + v.w >= MIN_Q; }).length, cov = bankTopics.size ? (covered / bankTopics.size) * 100 : 0;
    const ready = Math.round(0.5 * recent + 0.3 * syl + 0.2 * cov), label = ready >= 80 ? "Exam ready" : ready >= 65 ? "On track" : ready >= 40 ? "Building" : "Early stage";
    const trend = att.slice(-15);
    const rows = Object.entries(stt.byTopic).filter(([t]) => TOPIC_MAP[t] && (!st.anSubject || TOPIC_MAP[t].subject === st.anSubject)).map(([t, v]) => ({ t, v, s: topicState(v), acc: rate(v.c, v.w), tot: v.c + v.w + v.u })).filter(x => x.v.c + x.v.w > 0).sort((a, b) => (a.acc ?? 101) - (b.acc ?? 101));
    const subs = Object.entries(stt.bySubject);
    // paper comparison (first attempt vs best vs last)
    const papers = S.papers.map(p => ({ p, ex: X.examAttempts(p.id) })).filter(x => x.ex.length).sort((a, b) => (a.p.examDate || String(a.p.year)).localeCompare(b.p.examDate || String(b.p.year)));
    const pTopics = {}; papers.forEach(({ ex }) => ex.forEach(a => Object.entries(a.result.byTopic || {}).forEach(([t, v]) => { const o = (pTopics[t] ||= { c: 0, w: 0, papers: new Set() }); o.c += v.c; o.w += v.w; o.papers.add(a.paperId); })));
    const pRows = Object.entries(pTopics).filter(([t, v]) => TOPIC_MAP[t] && v.c + v.w >= MIN_Q).map(([t, v]) => ({ t, acc: rate(v.c, v.w), n: v.papers.size })).sort((a, b) => a.acc - b.acc).slice(0, 6);
    // single-topic improvement over time
    const tTopics = Object.keys(stt.byTopic).filter(t => TOPIC_MAP[t]).sort((a, b) => TOPIC_MAP[a].name.localeCompare(TOPIC_MAP[b].name));
    const sel = st.anTopic && stt.byTopic[st.anTopic] ? st.anTopic : "";
    const tSeries = sel ? att.map(a => ({ a, v: a.result.byTopic?.[sel] })).filter(x => x.v && x.v.c + x.v.w > 0) : [];
    return `${head}
    <section class="grid two">
      <div class="card center-col">${ring(ready, `Exam readiness · <b>${label}</b>`)}<p class="small muted center">50% recent test score (${Math.round(recent)}%) + 30% syllabus completed (${syl}%) + 20% topics practised in tests (${Math.round(cov)}%). A guide, not a prediction.</p></div>
      <div class="card"><h2>Score &amp; accuracy trend</h2>${trendSVG([{ name: "Score %", color: "#4f46e5", vals: trend.map(a => Math.max(0, a.result.percent)) }, { name: "Accuracy %", color: "#10b981", vals: trend.map(a => a.result.accuracy) }], trend.map(a => fmtDate(a.submittedAt)))}</div>
    </section>
    ${papers.length ? `<section class="card"><h2>🗃 Paper comparison <small class="muted">(exam mode)</small></h2>
      <div class="table-wrap"><table class="list"><tr><th>Paper</th><th>Attempts</th><th>First attempt</th><th>Best</th><th>Last</th><th>Δ first→last</th><th>Time (last)</th></tr>
      ${papers.map(({ p, ex }) => { const pc = ex.map(a => a.result.percent), d = Math.round((pc.at(-1) - pc[0]) * 10) / 10; return `<tr><td>${esc(p.title)}</td><td>${ex.length}</td><td>${pc[0]}%</td><td><b>${Math.max(...pc)}%</b></td><td>${pc.at(-1)}%</td><td class="${d >= 0 ? "up" : "down"}">${ex.length > 1 ? (d >= 0 ? "▲ " : "▼ ") + Math.abs(d) : "–"}</td><td>${fmtDur(ex.at(-1).result.timeUsed)}</td></tr>`; }).join("")}</table></div>
      ${pRows.length ? `<p class="small"><b>Weakest topics across papers:</b> ${pRows.map(x => `${esc(TOPIC_MAP[x.t].name)} <span class="badge off">${x.acc}%</span> <small class="muted">(${x.n} paper${x.n > 1 ? "s" : ""})</small>`).join(" · ")}</p>` : ""}</section>` : ""}
    <section class="card"><h2>Subject-wise accuracy &amp; speed</h2>
      <div class="table-wrap"><table class="list"><tr><th>Subject</th><th>Questions</th><th style="width:28%">Result</th><th>Accuracy</th><th>Avg time</th><th>Insight</th></tr>
      ${subs.map(([sid, v]) => { const cl = X.classify(v, 45), n = v.c + v.w + v.u; return `<tr><td>${X.subjIcon(sid)} ${esc(X.subjName(sid))}</td><td>${n}</td><td>${stack(v.c, v.w, v.u)}</td><td>${pf(rate(v.c, v.w))}</td><td>${Math.round(v.t / Math.max(1, n))}s</td><td class="small">${cl ? `<span class="badge ${cl.cls}">${cl.l}</span> ${cl.tip}` : "<span class='muted'>need more data</span>"}</td></tr>`; }).join("")}</table></div></section>
    <section class="card"><h2>📉 Topic improvement over time</h2>
      <select class="input sm" data-tchange="anTopic"><option value="">Pick a topic…</option>${tTopics.map(t => `<option value="${t}" ${sel === t ? "selected" : ""}>${esc(TOPIC_MAP[t].name)}</option>`).join("")}</select>
      ${sel ? trendSVG([{ name: TOPIC_MAP[sel].name + " accuracy", color: "#d97706", vals: tSeries.map(x => rate(x.v.c, x.v.w) ?? 0) }], tSeries.map(x => fmtDate(x.a.submittedAt))) : `<p class="muted small">Choose a topic to see how your accuracy changed from test to test.</p>`}</section>
    <section class="card"><div class="row"><h2 class="grow">Topic-wise accuracy (all tests)</h2>
      <button class="tab ${!st.anSubject ? "on" : ""}" data-t="anSubject:">All</button>${SUBJECTS.filter(s => subs.some(([k]) => k === s.id)).map(s => `<button class="tab ${st.anSubject === s.id ? "on" : ""}" data-t="anSubject:${s.id}">${s.icon}</button>`).join("")}</div>
      <div class="table-wrap"><table class="list"><tr><th>Topic</th><th>Correct / attempted</th><th style="width:26%">Accuracy</th><th>Status</th><th>Avg time</th><th></th></tr>
      ${rows.map(x => `<tr><td>${esc(TOPIC_MAP[x.t].name)}</td><td>${x.v.c} / ${x.v.c + x.v.w}</td><td>${stack(x.v.c, x.v.w, x.v.u)}</td><td><span class="badge ${x.s.cls}">${x.s.label}</span></td><td>${Math.round(x.v.t / Math.max(1, x.tot))}s</td><td><button class="btn sm" data-t="practiceTopic:${x.t}">Practise</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No data for this subject yet.</td></tr>`}</table></div>
      <p class="small muted">${bankTopics.size - covered} of ${bankTopics.size} topics in the bank still need ${MIN_Q}+ attempted questions for a reliable status.</p></section>`;
  };

  // ---------- dashboard coach ----------
  X.coachCard = () => {
    const run = S.attempts.filter(a => a.status === "running"), weak = X.weakTopics(3), due = X.dueMistakes().length, unres = S.mistakes.filter(m => !m.resolved).length, rev = X.dueCount(), bank = X.allPool().length;
    const hasData = X.submitted().length > 0, d = X.dailyAttempt();
    return `<section class="card coach"><h2>🎯 Today's focus</h2>
      ${run.map(a => `<div class="notice">⏳ <span class="grow">Test in progress: <b>${esc(a.title)}</b></span><button class="btn sm primary" data-t="resume:${a.id}">Resume</button></div>`).join("")}
      <div class="coach-grid">
        <div><small class="muted">Weak topics</small>${weak.length ? weak.map(x => `<div class="li"><span class="grow">${esc(TOPIC_MAP[x.t].name)}</span><span class="badge off">${Math.round(x.acc)}%</span></div>`).join("") : `<p class="small muted">${hasData ? "No weak topics right now 👍" : "Take a test to find your weak topics."}</p>`}</div>
        <div><small class="muted">To do today</small>
          <div class="li"><span class="grow">📅 Daily PYQ drill</span>${d ? (d.status === "submitted" ? `<span class="badge ok">done ${d.result.score}/${d.result.max}</span>` : `<span class="badge warn">in progress</span>`) : `<span class="badge low">not started</span>`}</div>
          <div class="li"><span class="grow">🔔 Mistakes due for review</span><a href="#notebook"><b>${due}</b></a></div>
          <div class="li"><span class="grow">🔁 Topics due for revision</span><b>${rev}</b></div>
          <div class="li"><span class="grow">❌ Unresolved mistakes</span><b>${unres}</b></div></div>
      </div>
      <div class="row"><button class="btn primary" data-t="daily" ${bank ? "" : "disabled"}>📅 ${d ? (d.status === "running" ? "Resume daily drill" : "Today's result") : "Daily drill"}</button><button class="btn primary" data-t="smart" ${bank ? "" : "disabled"}>⚡ 1-click revision</button><a class="btn" href="#tests">📝 Papers &amp; tests</a><a class="btn" href="#analytics">📈 Analytics</a></div></section>`;
  };
}
