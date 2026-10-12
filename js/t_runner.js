// Full-screen timed MCQ test runner (timer, palette, mark for review, autosave, resume, auto-submit).
import { SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { clock, imgUrl } from "./t_util.js";

export function initRunner(X) {
  const { S, db, $, esc, toast, modal, closeModal } = X;
  let R = null;
  const host = () => $("#runner");
  const L = "ABCD";

  X.isRunning = () => !!R;
  X.runnerState = id => {
    if (!R || R.id !== id) return null;
    commit();
    return { a: R.a, answers: R.answers, marked: R.marked, timeSpent: R.timeSpent };
  };

  const commit = () => {
    if (!R) return;
    const now = Date.now(), id = R.qs[R.idx]?.id;
    if (id) R.timeSpent[id] = (R.timeSpent[id] || 0) + (now - R.tStart) / 1000;
    R.tStart = now;
  };
  const rounded = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  async function saveNow() {
    if (!R) return;
    clearTimeout(R.saveT); commit();
    try { await db.update("attempts", R.id, { answers: R.answers, marked: R.marked, timeSpent: rounded(R.timeSpent), last: R.idx }); R.dirty = false; } catch (e) { console.warn("autosave failed", e.code); }
  }
  const queueSave = () => { R.dirty = true; clearTimeout(R.saveT); R.saveT = setTimeout(saveNow, 3000); };

  X.closeRunner = () => {
    if (R) { clearInterval(R.timer); clearTimeout(R.saveT); }
    R = null;
    host().classList.add("hidden"); host().innerHTML = ""; document.body.classList.remove("noscroll");
    X.rerender();
  };

  X.openRunner = async (aid, data) => {
    const a = data ? { id: aid, ...data } : S.attempts.find(x => x.id === aid);
    if (!a) return toast("Test not found.");
    if (a.status !== "running") { location.hash = "result/" + aid; return; }
    if (a.deadline && Date.now() >= a.deadline) return X.finalize(a.id, "auto");
    if (R) X.closeRunner();
    host().classList.remove("hidden"); document.body.classList.add("noscroll");
    host().innerHTML = `<div class="r-loading">Loading questions…</div>`;
    let qs = [];
    try { qs = await X.loadQuestions(a.questionIds); } catch (e) { console.error(e); }
    if (!qs.length) { X.closeRunner(); return toast("Could not load the questions. Check your connection."); }
    if (qs.length < a.questionIds.length) toast(`${a.questionIds.length - qs.length} question(s) were removed from the bank and will be skipped.`);
    R = { id: a.id, a, qs, idx: Math.min(a.last || 0, qs.length - 1), answers: { ...(a.answers || {}) }, marked: { ...(a.marked || {}) },
      timeSpent: { ...(a.timeSpent || {}) }, visited: new Set(), tStart: Date.now(), saveT: null, warned: new Set(), pal: false };
    Object.keys(R.answers).forEach(id => R.visited.add(id));
    R.timer = setInterval(tick, 1000);
    render(); tick();
  };

  function tick() {
    if (!R) return;
    const el = $("#rTimer"); if (!el) return;
    const a = R.a;
    if (a.deadline) {
      const rem = Math.ceil((a.deadline - Date.now()) / 1000);
      if (rem <= 0) { el.textContent = "00:00"; clearInterval(R.timer); X.finalize(R.id, "auto"); return; }
      el.textContent = clock(rem); el.classList.toggle("danger", rem <= 60);
      for (const th of [600, 300, 60]) if (rem <= th && a.durationSec > th * 1.5 && !R.warned.has(th)) { R.warned.add(th); toast(`⏳ ${th / 60} minute${th > 60 ? "s" : ""} remaining`); break; }
    } else el.textContent = "⏱ " + clock((Date.now() - a.startedAt) / 1000);
  }

  function counts() {
    let ans = 0, mk = 0, na = 0, nv = 0;
    R.qs.forEach(q => {
      const a = R.answers[q.id] !== undefined, m = !!R.marked[q.id], v = R.visited.has(q.id);
      if (a) ans++; if (m) mk++; if (!a && v) na++; if (!v) nv++;
    });
    return { ans, mk, na, nv };
  }

  function render() {
    if (!R) return;
    const a = R.a, n = R.qs.length, q = R.qs[R.idx], qid = q.id;
    R.visited.add(qid);
    const perm = a.optionOrder?.[qid] || [0, 1, 2, 3];
    const subs = [...new Set(R.qs.map(x => x.subject))];
    const cur = R.answers[qid], c = counts(), marked = !!R.marked[qid];
    const tp = TOPIC_MAP[q.topicId]?.name || "";
    const pal = subs.map(sid => {
      const items = R.qs.map((x, i) => ({ x, i })).filter(o => o.x.subject === sid);
      return `<div class="pal-sec"><b>${esc(SUBJECT_MAP[sid]?.name || sid)}</b><div class="pal-grid">${items.map(({ x, i }) => {
        const has = R.answers[x.id] !== undefined, m = R.marked[x.id], v = R.visited.has(x.id);
        const cls = m ? (has ? "pm pa" : "pm") : has ? "pa" : v ? "pn" : "";
        return `<button class="pbtn ${cls} ${i === R.idx ? "cur" : ""}" data-r="jump:${i}">${i + 1}</button>`;
      }).join("")}</div></div>`;
    }).join("");
    host().innerHTML = `
      <div class="r-top">
        <div class="r-title"><b>${esc(a.title)}</b><small>${n} questions · +${a.pos}${a.neg ? ` / −${a.neg}` : ""}</small></div>
        <div class="r-timer ${a.deadline ? "" : "free"}" id="rTimer">--:--</div>
        <div class="row"><button class="btn sm" data-r="exit">Save &amp; exit</button><button class="btn sm primary" data-r="submit">Submit test</button></div>
      </div>
      <div class="r-tabs">${subs.map(sid => `<button class="r-tab ${sid === q.subject ? "on" : ""}" data-r="subj:${sid}">${SUBJECT_MAP[sid]?.icon || ""} ${esc((SUBJECT_MAP[sid]?.name || sid).split(" (")[0])}</button>`).join("")}</div>
      <div class="r-body">
        <section class="r-main">
          <div class="r-qhead"><b>Question ${R.idx + 1} <span class="muted">of ${n}</span></b><span class="chip">${esc(tp)}</span>${marked ? `<span class="badge">Marked for review</span>` : ""}</div>
          <div class="r-q">${esc(q.question)}</div>
          ${q.imageUrl ? `<img class="r-img" src="${esc(imgUrl(q.imageUrl))}" alt="question figure" referrerpolicy="no-referrer">` : ""}
          <div class="r-opts">${perm.map((orig, p) => `<button class="r-opt ${cur === orig ? "on" : ""}" data-r="opt:${orig}"><span>${L[p]}</span><div>${esc(q.options[orig])}</div></button>`).join("")}</div>
        </section>
        <aside class="r-pal ${R.pal ? "open" : ""}">
          <div class="r-cnt"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${c.na}<small>Not answered</small></span><span class="c-m">${c.mk}<small>Marked</small></span><span class="c-v">${c.nv}<small>Not visited</small></span></div>
          ${pal}
        </aside>
      </div>
      <div class="r-foot">
        <button class="btn" data-r="prev" ${R.idx === 0 ? "disabled" : ""}>← Previous</button>
        <button class="btn" data-r="clear" ${cur === undefined ? "disabled" : ""}>Clear</button>
        <button class="btn mobile-only" data-r="pal">☰ Palette</button>
        <span class="grow"></span>
        <button class="btn" data-r="mark">${marked ? "Unmark review" : "Mark for review &amp; next"}</button>
        <button class="btn primary" data-r="next">${R.idx === n - 1 ? "Save" : "Save &amp; next"}</button>
      </div>`;
    tick();
  }

  function go(i) { commit(); R.idx = Math.max(0, Math.min(R.qs.length - 1, i)); R.pal = false; queueSave(); render(); host().querySelector(".r-main")?.scrollTo(0, 0); }

  function confirmSubmit() {
    commit(); const c = counts(), rem = R.a.deadline ? Math.max(0, Math.ceil((R.a.deadline - Date.now()) / 1000)) : null;
    modal(`<h2>Submit test?</h2>
      <div class="cnt-row"><span class="c-a">${c.ans}<small>Answered</small></span><span class="c-n">${c.na + c.nv}<small>Unanswered</small></span><span class="c-m">${c.mk}<small>Marked</small></span></div>
      ${rem !== null ? `<p class="muted">Time left: <b>${clock(rem)}</b></p>` : ""}
      <p class="muted small">You can't change answers after submitting.</p>
      <div class="row"><button class="btn primary" id="rConfirm">Yes, submit</button><button class="btn ghost" data-close="modal">Keep working</button></div>`);
    $("#rConfirm").onclick = () => { closeModal(); X.finalize(R.id, "manual"); };
  }

  function act(s) {
    if (!R) return;
    const [k, arg] = s.split(":"), qid = R.qs[R.idx].id;
    if (k === "opt") { R.answers[qid] = Number(arg); queueSave(); render(); }
    else if (k === "clear") { delete R.answers[qid]; queueSave(); render(); }
    else if (k === "next") go(R.idx + 1);
    else if (k === "prev") go(R.idx - 1);
    else if (k === "mark") { if (R.marked[qid]) { delete R.marked[qid]; queueSave(); render(); } else { R.marked[qid] = true; go(R.idx + 1); } }
    else if (k === "jump") go(Number(arg));
    else if (k === "subj") go(R.qs.findIndex(q => q.subject === arg));
    else if (k === "pal") { R.pal = !R.pal; render(); }
    else if (k === "submit") confirmSubmit();
    else if (k === "exit") { saveNow().then(() => { X.closeRunner(); toast(R === null ? "Saved. Resume anytime from the Tests page." : ""); location.hash = "tests"; }); }
  }

  host().addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (b) act(b.dataset.r); });
  document.addEventListener("keydown", e => {
    if (!R || !$("#modal").classList.contains("hidden") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if ("abcd".includes(k) && k.length === 1) { const perm = R.a.optionOrder?.[R.qs[R.idx].id] || [0, 1, 2, 3]; act("opt:" + perm["abcd".indexOf(k)]); }
    else if ("1234".includes(k) && k.length === 1) { const perm = R.a.optionOrder?.[R.qs[R.idx].id] || [0, 1, 2, 3]; act("opt:" + perm[Number(k) - 1]); }
    else if (e.key === "ArrowRight") act("next"); else if (e.key === "ArrowLeft") act("prev");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && R) saveNow(); });
  window.addEventListener("beforeunload", e => { if (R) { e.preventDefault(); e.returnValue = ""; } });
}
