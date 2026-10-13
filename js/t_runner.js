// Full-screen timed MCQ runner: paper timer / section timers (sections lock when finished), learning mode, languages, autosave, resume.
import { SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { clock, imgUrl, fmtDur } from "./t_util.js";

export function initRunner(X) {
  const { S, db, $, esc, toast, modal, closeModal } = X;
  let R = null;
  const host = () => $("#runner");
  const L = "ABCD";

  X.isRunning = () => !!R;
  X.runnerState = id => {
    if (!R || R.id !== id) return null;
    commit();
    return { a: R.a, answers: R.answers, marked: R.marked, timeSpent: R.timeSpent, visits: R.visits, hist: R.hist, secLog: R.secLog, secIdx: R.secIdx };
  };

  const sectioned = () => !!R.a.secs;
  const sec = () => R.a.secs[R.secIdx];
  const range = () => (sectioned() ? [sec().from, sec().to] : [0, R.qs.length - 1]);
  const learning = () => R.a.mode === "learning";
  const commit = () => {
    if (!R || R.phase === "break") return;
    const now = Date.now(), id = R.qs[R.idx]?.id;
    if (id) R.timeSpent[id] = (R.timeSpent[id] || 0) + (now - R.tStart) / 1000;
    R.tStart = now;
  };
  const rounded = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  async function saveNow() {
    if (!R) return;
    clearTimeout(R.saveT); commit();
    const p = { answers: R.answers, marked: R.marked, timeSpent: rounded(R.timeSpent), visits: R.visits, hist: R.hist, last: R.idx };
    if (sectioned()) Object.assign(p, { secIdx: R.secIdx, phase: R.phase, secStart: R.secStart, secDeadline: R.secDeadline, secLog: R.secLog });
    try { await db.update("attempts", R.id, p); } catch (e) { console.warn("autosave failed", e.code); }
  }
  const queueSave = () => { clearTimeout(R.saveT); R.saveT = setTimeout(saveNow, 3000); };
  const remNow = () => {
    if (sectioned()) return Math.max(0, Math.ceil((R.secDeadline - Date.now()) / 1000));
    if (R.a.timerType === "paper") return Math.max(0, Math.ceil((R.a.deadline - Date.now()) / 1000));
    return -1;
  };

  X.closeRunner = () => {
    if (R) { clearInterval(R.timer); clearTimeout(R.saveT); }
    R = null;
    host().classList.add("hidden"); host().innerHTML = ""; document.body.classList.remove("noscroll");
    X.rerender();
  };

  X.openRunner = async (aid, data) => {
    let a = data ? { id: aid, ...data } : S.attempts.find(x => x.id === aid);
    if (!a) return toast("Test not found.");
    a = X.normAttempt(a);
    if (a.status !== "running") { location.hash = "result/" + aid; return; }
    if (a.timerType === "paper" && a.deadline && Date.now() >= a.deadline) return X.finalize(a.id, "auto");
    if (a.timerType === "section" && a.phase === "running" && a.secDeadline && Date.now() >= a.secDeadline) {
      const r = await X.autoAdvance(a); if (!r || r.done) return; a = { ...a, ...r.patch };
    }
    if (R) X.closeRunner();
    host().classList.remove("hidden"); document.body.classList.add("noscroll");
    host().innerHTML = `<div class="r-loading">Loading questions…</div>`;
    let loaded = [];
    try { loaded = await X.loadQuestions(a.questionIds); if (a.mode === "learning") await X.loadKeys(a.questionIds); } catch (e) { console.error(e); }
    if (!loaded.length) { X.closeRunner(); return toast("Could not load the questions. Check your connection."); }
    const map = Object.fromEntries(loaded.map(q => [q.id, q]));
    const qs = a.questionIds.map(id => map[id] || { id, subject: (a.qmeta?.[id] || "|").split("|")[0], topicId: (a.qmeta?.[id] || "|").split("|")[1], question: "(This question was removed from the bank.)", options: ["—", "—", "—", "—"], removed: true });
    R = {
      id: a.id, a, qs, idx: 0, answers: { ...(a.answers || {}) }, marked: { ...(a.marked || {}) }, timeSpent: { ...(a.timeSpent || {}) }, visits: { ...(a.visits || {}) }, hist: { ...(a.hist || {}) },
      secIdx: a.secIdx || 0, phase: a.phase === "break" ? "break" : "running", secStart: a.secStart || 0, secDeadline: a.secDeadline || 0, secLog: { ...(a.secLog || {}) },
      tStart: Date.now(), saveT: null, warned: new Set(), pal: false, checked: {}, ending: false, lang: X.langGet()
    };
    const [f, t] = range(); R.idx = Math.min(Math.max(a.last || 0, f), t);
    if (R.phase === "running") R.visits[R.qs[R.idx].id] = (R.visits[R.qs[R.idx].id] || 0) + 1;
    R.timer = setInterval(tick, 1000);
    render(); tick();
  };

  function tick() {
    if (!R) return;
    const el = $("#rTimer"); if (!el || R.phase === "break") return;
    const a = R.a;
    if (sectioned()) {
      const rem = Math.ceil((R.secDeadline - Date.now()) / 1000);
      if (rem <= 0) { el.textContent = "00:00"; if (!R.ending) endSection("auto"); return; }
      el.textContent = clock(rem); el.classList.toggle("danger", rem <= 60);
      for (const th of [600, 300, 60]) if (rem <= th && sec().sec > th * 1.5 && !R.warned.has(R.secIdx + ":" + th)) { R.warned.add(R.secIdx + ":" + th); toast(`⏳ ${th / 60} minute${th > 60 ? "s" : ""} left in this section`); break; }
    } else if (a.timerType === "paper") {
      const rem = Math.ceil((a.deadline - Date.now()) / 1000);
      if (rem <= 0) { el.textContent = "00:00"; if (!R.ending) { R.ending = true; clearInterval(R.timer); X.finalize(R.id, "auto"); } return; }
      el.textContent = clock(rem); el.classList.toggle("danger", rem <= 60);
      for (const th of [600, 300, 60]) if (rem <= th && a.durationSec > th * 1.5 && !R.warned.has(th)) { R.warned.add(th); toast(`⏳ ${th / 60} minute${th > 60 ? "s" : ""} remaining`); break; }
    } else el.textContent = "⏱ " + clock((Date.now() - a.startedAt) / 1000);
  }

  const counts = (f, t) => {
    let ans = 0, mk = 0, na = 0, nv = 0;
    for (let i = f; i <= t; i++) { const q = R.qs[i], a = R.answers[q.id] !== undefined, m = !!R.marked[q.id], v = (R.visits[q.id] || 0) > 0 || i === R.idx; if (a) ans++; if (m) mk++; if (!a && v) na++; if (!v) nv++; }
    return { ans, mk, na, nv };
  };

  // ----- language -----
  const qHtml = q => { const lg = R.lang; if (lg === "hi" && q.qHi) return esc(q.qHi); if (lg === "both" && q.qHi) return `${esc(q.question)}<div class="hi">${esc(q.qHi)}</div>`; return esc(q.question); };
  const oHtml = (q, j) => { const lg = R.lang, hi = q.optionsHi?.[j]; if (lg === "hi" && hi) return esc(hi); if (lg === "both" && hi) return `${esc(q.options[j])}<div class="hi">${esc(hi)}</div>`; return esc(q.options[j]); };

  function render() {
    if (!R) return;
    if (R.phase === "break") return renderBreak();
    const a = R.a, q = R.qs[R.idx], qid = q.id, [f, t] = range(), n = R.qs.length;
    const perm = a.optionOrder?.[qid] || [0, 1, 2, 3], cur = R.answers[qid], marked = !!R.marked[qid], c = counts(f, t);
    const chk = learning() && R.checked[qid], key = X.cache.k[qid];
    const tp = TOPIC_MAP[q.topicId]?.name || "";
    const note = learning() ? S.qnotes.find(x => x.qid === qid) : null;
    const subs = sectioned() ? a.secs.map(s => s.sub) : [...new Set(R.qs.map(x => x.subject))];
    const tabs = sectioned()
      ? a.secs.map((s, i) => `<span class="r-tab sec ${i < R.secIdx ? "done" : i === R.secIdx ? "on" : "lock"}">${i < R.secIdx ? "✓ " : i > R.secIdx ? "🔒 " : ""}${SUBJECT_MAP[s.sub]?.icon || ""} ${esc((SUBJECT_MAP[s.sub]?.name || s.sub).split(" (")[0])}</span>`).join("")
      : subs.map(sid => `<button class="r-tab ${sid === q.subject ? "on" : ""}" data-r="subj:${sid}">${SUBJECT_MAP[sid]?.icon || ""} ${esc((SUBJECT_MAP[sid]?.name || sid).split(" (")[0])}</button>`).join("");
    const pal = (sectioned() ? [a.secs[R.secIdx].sub] : subs).map(sid => {
      const items = []; for (let i = f; i <= t; i++) if (R.qs[i].subject === sid || sectioned()) items.push(i);
      return `<div class="pal-sec"><b>${esc(SUBJECT_MAP[sid]?.name || sid)}</b><div class="pal-grid">${items.map(i => {
        const x = R.qs[i], has = R.answers[x.id] !== undefined, m = R.marked[x.id], v = (R.visits[x.id] || 0) > 0 || i === R.idx;
        return `<button class="pbtn ${m ? (has ? "pm pa" : "pm") : has ? "pa" : v ? "pn" : ""} ${i === R.idx ? "cur" : ""}" data-r="jump:${i}">${i + 1}</button>`;
      }).join("")}</div></div>`;
    }).join("");
    const lastSec = !sectioned() || R.secIdx === a.secs.length - 1;
    host().innerHTML = `
      <div class="r-top">
        <div class="r-title"><b>${esc(a.title)}</b><small>${learning() ? "📘 Learning mode · " : ""}${sectioned() ? `Section ${R.secIdx + 1}/${a.secs.length} · ${esc(X.subjName(sec().sub))} · ` : ""}${n} questions · +${a.pos}${a.neg ? ` / −${a.neg}` : ""}</small></div>
        <select class="input sm" data-rlang title="Language"><option value="en" ${R.lang === "en" ? "selected" : ""}>English</option><option value="hi" ${R.lang === "hi" ? "selected" : ""}>हिन्दी</option><option value="both" ${R.lang === "both" ? "selected" : ""}>Both</option></select>
        <div class="r-timer ${a.timerType !== "none" ? "" : "free"}" id="rTimer">--:--</div>
        <div class="row"><button class="btn sm" data-r="exit">Save &amp; exit</button><button class="btn sm primary" data-r="submit">${lastSec ? "Submit test" : "Submit section"}</button></div>
      </div>
      <div class="r-tabs">${tabs}</div>
      <div class="r-body">
        <section class="r-main">
          <div class="r-qhead"><b>Question ${R.idx + 1} <span class="muted">of ${n}</span></b><span class="chip">${esc(tp)}</span>${marked ? `<span class="badge">Marked for review</span>` : ""}</div>
          <div class="r-q">${qHtml(q)}</div>
          ${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="question figure" referrerpolicy="no-referrer">` : ""}
          <div class="r-opts">${perm.map((orig, p) => {
            const isC = chk && key && orig === key.correct, isBad = chk && key && cur === orig && orig !== key.correct;
            return `<button class="r-opt ${cur === orig ? "on" : ""} ${isC ? "good" : ""} ${isBad ? "bad" : ""}" data-r="opt:${orig}"><span>${L[p]}</span><div>${oHtml(q, orig)}</div></button>`;
          }).join("")}</div>
          ${learning() && cur !== undefined && !chk ? `<button class="btn mt-s" data-r="check">✔ Check answer</button>` : ""}
          ${chk && key ? `<div class="expl"><b>${cur === key.correct ? "✅ Correct" : "❌ Not quite – correct answer is " + L[perm.indexOf(key.correct)]}</b><p>${esc(R.lang === "hi" && key.explanationHi ? key.explanationHi : key.explanation || "No explanation added for this question yet.")}</p>${key.videoUrl ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(key.videoUrl)}">▶ Watch solution</a>` : ""}</div>` : ""}
          ${note ? `<div class="mynote">📝 <b>My note:</b> ${esc(note.text)}</div>` : ""}
        </section>
        <aside class="r-pal ${R.pal ? "open" : ""}">
          <div class="r-cnt"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${c.na}<small>Not answered</small></span><span class="c-m">${c.mk}<small>Marked</small></span><span class="c-v">${c.nv}<small>Not visited</small></span></div>
          ${sectioned() ? `<p class="small muted">🔒 You cannot return to this section after you submit it.</p>` : ""}
          ${pal}
        </aside>
      </div>
      <div class="r-foot">
        <button class="btn" data-r="prev" ${R.idx === f ? "disabled" : ""}>← Previous</button>
        <button class="btn" data-r="clear" ${cur === undefined ? "disabled" : ""}>Clear</button>
        <button class="btn mobile-only" data-r="pal">☰ Palette</button>
        <span class="grow"></span>
        <button class="btn" data-r="mark">${marked ? "Unmark review" : "Mark for review &amp; next"}</button>
        <button class="btn primary" data-r="next">${R.idx === t ? "Save" : "Save &amp; next"}</button>
      </div>`;
    tick();
  }

  function renderBreak() {
    const a = R.a, pi = R.secIdx - 1, prev = a.secs[pi], next = a.secs[R.secIdx], c = counts(prev.from, prev.to), lg = R.secLog[pi] || {};
    const total = prev.to - prev.from + 1;
    host().innerHTML = `
      <div class="r-top"><div class="r-title"><b>${esc(a.title)}</b><small>Section break</small></div><div class="r-timer free" id="rTimer">—</div><div class="row"><button class="btn sm" data-r="exit">Save &amp; exit</button></div></div>
      <div class="r-tabs">${a.secs.map((s, i) => `<span class="r-tab sec ${i < R.secIdx ? "done" : i === R.secIdx ? "on" : "lock"}">${i < R.secIdx ? "✓ " : i > R.secIdx ? "🔒 " : ""}${SUBJECT_MAP[s.sub]?.icon || ""} ${esc(X.subjName(s.sub))}</span>`).join("")}</div>
      <div class="r-break"><div class="break-card">
        <h2>${SUBJECT_MAP[prev.sub]?.icon || ""} ${esc(X.subjName(prev.sub))} — completed</h2>
        ${lg.exp ? `<p class="badge warn">⏰ Time ran out for this section</p>` : ""}
        <div class="cnt-row"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${total - c.ans}<small>Unanswered</small></span><span class="c-m">${c.mk}<small>Marked</small></span><span class="c-v">${fmtDur(lg.used || 0)}<small>Time used</small></span></div>
        <p class="muted small">This section is now locked – you can't go back to it.</p>
        <hr>
        <h3>Next: ${SUBJECT_MAP[next.sub]?.icon || ""} ${esc(X.subjName(next.sub))}</h3>
        <p>${next.to - next.from + 1} questions · <b>${fmtDur(next.sec)}</b></p>
        <button class="btn primary big" data-r="nextsec">▶ Start ${esc(X.subjName(next.sub))}</button>
        <p class="small muted">The timer for the next section starts when you press the button.</p>
      </div></div>`;
  }

  function go(i) {
    commit(); const [f, t] = range(); R.idx = Math.max(f, Math.min(t, i)); R.pal = false;
    const id = R.qs[R.idx].id; R.visits[id] = (R.visits[id] || 0) + 1; R.tStart = Date.now();
    queueSave(); render(); host().querySelector(".r-main")?.scrollTo(0, 0);
  }
  function pick(v) {
    const qid = R.qs[R.idx].id; if (R.answers[qid] === v || (v < 0 && R.answers[qid] === undefined)) return;
    R.hist[qid] = (R.hist[qid] ? R.hist[qid] + "," : "") + v + ":" + remNow();
    if (v < 0) { delete R.answers[qid]; delete R.checked[qid]; } else R.answers[qid] = v;
    queueSave(); render();
  }

  async function endSection(how) {
    if (!R || R.ending) return; R.ending = true;
    commit();
    const i = R.secIdx, s = sec(), used = how === "auto" ? s.sec : Math.min(s.sec, Math.round((Date.now() - R.secStart) / 1000));
    R.secLog[i] = { used, exp: how === "auto" ? 1 : 0 };
    if (i >= R.a.secs.length - 1) { await saveNow(); await X.finalize(R.id, how, { secLog: R.secLog }); if (R) R.ending = false; return; }
    R.secIdx = i + 1; R.phase = "break"; R.secStart = 0; R.secDeadline = 0; R.ending = false;
    await saveNow(); render();
    if (how === "auto") toast(`⏰ ${X.subjName(s.sub)} time is over – section submitted.`);
  }
  function startNextSection() {
    const s = sec(), now = Date.now();
    R.phase = "running"; R.secStart = now; R.secDeadline = now + s.sec * 1000; R.idx = s.from; R.tStart = now;
    R.visits[R.qs[R.idx].id] = (R.visits[R.qs[R.idx].id] || 0) + 1;
    saveNow(); render();
  }

  function confirmSubmit() {
    commit(); const [f, t] = range(), c = counts(f, t), total = t - f + 1, rem = remNow(), lastSec = !sectioned() || R.secIdx === R.a.secs.length - 1;
    modal(`<h2>${lastSec ? "Submit test?" : "Submit this section?"}</h2>
      <div class="cnt-row"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${total - c.ans}<small>Unanswered</small></span><span class="c-m">${c.mk}<small>Marked</small></span></div>
      ${rem >= 0 ? `<p class="muted">Time left${sectioned() ? " in this section" : ""}: <b>${clock(rem)}</b></p>` : ""}
      <p class="muted small">${sectioned() && !lastSec ? "🔒 You will NOT be able to return to this section." : "You can't change answers after submitting."}</p>
      <div class="row"><button class="btn primary" id="rConfirm">Yes, submit</button><button class="btn ghost" data-close="modal">Keep working</button></div>`);
    $("#rConfirm").onclick = () => { closeModal(); if (sectioned()) endSection("manual"); else { R.ending = true; X.finalize(R.id, "manual"); } };
  }

  function act(s) {
    if (!R) return;
    const [k, arg] = s.split(":");
    if (k === "exit") { saveNow().then(() => { X.closeRunner(); toast("Saved. Resume anytime from the Tests page."); location.hash = "tests"; }); return; }
    if (R.phase === "break") { if (k === "nextsec") startNextSection(); return; }
    const qid = R.qs[R.idx].id;
    if (k === "opt") pick(Number(arg));
    else if (k === "clear") pick(-1);
    else if (k === "next") go(R.idx + 1);
    else if (k === "prev") go(R.idx - 1);
    else if (k === "mark") { if (R.marked[qid]) { delete R.marked[qid]; queueSave(); render(); } else { R.marked[qid] = true; go(R.idx + 1); } }
    else if (k === "jump") go(Number(arg));
    else if (k === "subj") go(R.qs.findIndex(q => q.subject === arg));
    else if (k === "pal") { R.pal = !R.pal; render(); }
    else if (k === "check") { R.checked[qid] = true; if (!X.cache.k[qid]) toast("Answer key not available."); render(); }
    else if (k === "submit") confirmSubmit();
  }

  host().addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) act(b.dataset.r); });
  host().addEventListener("change", e => { if (e.target.matches("[data-rlang]") && R) { R.lang = e.target.value; X.langSet(R.lang); render(); } });
  document.addEventListener("keydown", e => {
    if (!R || R.phase === "break" || !$("#modal").classList.contains("hidden") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(), perm = R.a.optionOrder?.[R.qs[R.idx].id] || [0, 1, 2, 3];
    if (k.length === 1 && "abcd".includes(k)) act("opt:" + perm["abcd".indexOf(k)]);
    else if (k.length === 1 && "1234".includes(k)) act("opt:" + perm[Number(k) - 1]);
    else if (e.key === "ArrowRight") act("next"); else if (e.key === "ArrowLeft") act("prev");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && R) saveNow(); });
  window.addEventListener("beforeunload", e => { if (R) { e.preventDefault(); e.returnValue = ""; } });
}
