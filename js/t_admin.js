// Admin: question bank (CSV import with paper detection, duplicates, verification), paper library, test builder, reports, backup/export.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { CSV_HEADERS, CSV_HEADERS_HI, parseCSV, validateRows, groupPapers, importQuestions, removeFromIndex, toCSV, buildAIPrompt, fingerprint, paperDefaults } from "./csv.js";
import { DEFAULT_SEC, DIFFS, fmtDur, fmtDate, fmtDay, fmtDateTime, toLocalInput, fromLocalInput, download, dayKey } from "./t_util.js";

export function initAdmin(X) {
  const { S, st, db, $, esc, toast } = X, A = X.act, ui = X.ui, L = "ABCD";
  const NM = { quant: "Quant", reasoning: "Reasoning", english: "English", ga: "GA", computer: "Computer", stats: "Stats" };

  // ================= QUESTION BANK =================
  X.viewQBank = () => {
    const imp = st.imp, raw = X.rawPool(), total = raw.length, ver = raw.filter(q => q.st === "v").length, br = st.browse;
    return `
    <section class="card"><h2>📥 Import questions (CSV)</h2>
      <p class="muted small">Convert your PYQ PDF to CSV with any AI tool using the prompt, then upload the file. The check step shows what will be imported – nothing is saved until you press Import. Rows that share <b>paperName + examDate + shift</b> become one full paper in the Paper library.</p>
      <div class="row"><button class="btn" data-t="copyPrompt:0">📋 Copy AI prompt</button><button class="btn" data-t="copyPrompt:1">📋 Prompt (English + Hindi)</button><a class="btn" href="sample/cgl_questions_sample.csv" download>⬇ Sample CSV</a><button class="btn" data-t="newq">+ Add one question manually</button></div>
      <div class="drop mt-s"><input type="file" id="csvFile" accept=".csv,.txt,.tsv" data-tfile="csv"><span class="small muted">…or paste CSV text:</span>
        <textarea class="input" rows="3" data-bind="paste" placeholder="Paste CSV text here, then press Check"></textarea><button class="btn sm" data-t="checkPaste">Check pasted text</button></div>
      ${imp ? importPreview(imp) : ""}
    </section>

    <section class="card"><h2>📚 Question bank overview <small class="muted">(${total} questions · ${ver} verified · ${total - ver} need review · ${S.flags.length} reported)</small></h2>
      ${total ? SUBJECTS.map(s => { const list = raw.filter(q => q.s === s.id); if (!list.length) return ""; const by = {}; list.forEach(q => (by[q.t] = (by[q.t] || 0) + 1));
        return `<details class="ov"><summary><b>${s.icon} ${esc(s.name)}</b> <span class="badge">${list.length}</span> <span class="badge ok">${list.filter(q => q.st === "v").length} verified</span></summary>${s.topics.filter(t => by[t.id]).map(t => `<div class="li"><span class="grow">${esc(t.name)}</span><b>${by[t.id]}</b></div>`).join("")}</details>`; }).join("") : `<p class="empty">No questions yet.</p>`}
    </section>

    <section class="card"><h2>🔎 Browse, verify &amp; edit</h2>
      <p class="small muted"><b>Needs review</b> = imported but not yet checked. Only <b>verified</b> questions are used when a test is set to "verified only". Reported questions are held back from random tests until you resolve the report.</p>
      <div class="toolbar">${ui.select("browse.subject", SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}${ui.select("browse.topic", X.topicOpts(br.subject), "data-rerender")}
        ${ui.select("browse.status", [["", "Any status"], ["review", "Needs review"], ["verified", "Verified"], ["reported", "Reported"], ["disabled", "Disabled"]], "data-rerender")}<button class="btn primary" data-t="browse">Load (max 100)</button></div>
      ${br.loading ? `<p class="muted">Loading…</p>` : br.list ? `${br.list.length ? `<div class="row mb-s"><button class="btn sm" data-t="verifyShown">✔ Verify all shown (${br.list.filter(q => q.status !== "verified" && q.active !== false).length})</button></div>` : ""}` + (br.list.map(q => {
        const flagged = S.flags.some(f => f.id === q.id);
        return `<div class="nb-row"><div class="nb-h"><div class="grow"><b>${esc(q.question.slice(0, 140))}${q.question.length > 140 ? "…" : ""}</b><div class="small muted">${esc(TOPIC_MAP[q.topicId]?.name || q.topicId)} ${q.year ? "· " + q.year : ""} ${q.shift ? "· " + esc(q.shift) : ""} ${q.difficulty ? "· " + q.difficulty : ""}
          ${q.status === "verified" ? `<span class="badge ok">verified</span>` : `<span class="badge warn">needs review</span>`} ${flagged ? `<span class="badge off">🚩 reported</span>` : ""} ${q.active === false ? `<span class="badge off">disabled</span>` : ""} ${q.qHi ? `<span class="badge">हिन्दी</span>` : ""}</div></div>
          <button class="btn sm" data-t="editq:${q.id}">Edit</button>
          ${q.status === "verified" ? `<button class="btn sm" data-t="unverq:${q.id}">Unverify</button>` : `<button class="btn sm primary" data-t="verq:${q.id}">Verify</button>`}
          ${q.active === false ? `<button class="btn sm" data-t="actq:${q.id}">Enable</button>` : `<button class="btn sm" data-t="deactq:${q.id}">Disable</button>`}<button class="btn sm ghost danger" data-t="delq:${q.id}">Delete</button></div></div>`;
      }).join("") || `<p class="empty">No questions found.</p>`) : `<p class="muted small">Pick a subject / topic / status and press Load.</p>`}
    </section>`;
  };

  function importPreview(i) {
    const r = i.res, nSkip = Object.values(i.skip).filter(Boolean).length, ready = r.valid.filter(x => !i.skip[x._row]).length;
    const papersHtml = i.papers.length ? `<h3>🗃 Full papers detected</h3>${i.papers.map(p => {
      const warns = [], n = Object.keys(p.bySubject).length;
      if (p.tier === "Tier I" && (p.total !== 100 || n !== 4 || Object.values(p.bySubject).some(c => c !== 25))) warns.push("Tier-I papers normally have 4 sections × 25 questions = 100");
      if (p.rejected) warns.push(`${p.rejected} rejected row${p.rejected > 1 ? "s" : ""} – the paper will be incomplete`);
      if (p.noExpl) warns.push(`${p.noExpl} without explanation`); if (p.noImg) warns.push(`${p.noImg} figure question${p.noImg > 1 ? "s" : ""} without an image link`);
      const complete = !warns.some(w => /normally|rejected/.test(w));
      return `<label class="paper-det"><input type="checkbox" data-t="pcheck:${esc(p.key)}" ${i.createPapers[p.key] ? "checked" : ""}> <div><b>${esc(p.paperName)}</b> · ${esc(fmtDay(p.examDate) || p.year || "")} · ${esc(p.shift || "")} <span class="badge">${p.tier}</span> ${complete ? `<span class="badge ok">✅ complete</span>` : `<span class="badge warn">⚠ check</span>`}
        <div class="small">${Object.entries(p.bySubject).map(([s, c]) => `${X.subjIcon(s)} ${esc(X.subjName(s))} <b>${c}</b>`).join(" · ")} = <b>${p.total}</b> questions</div>
        ${warns.map(w => `<div class="small warnline">⚠ ${esc(w)}</div>`).join("")}</div></label>`;
    }).join("")}<p class="small muted">Ticked papers are created/updated in the Paper library (Admin → Papers lets you set timers, attempts and the exam window).</p>` : `<p class="small muted">No paper grouping found (add paperName + examDate/year + shift on every row to build full papers).</p>`;
    return `<div class="imp"><h3>Check result – ${esc(i.name)}</h3>
      <div class="chips2"><span>${r.total}<small>Rows</small></span><span class="c-a">${ready}<small>Ready to import</small></span><span class="c-m">${r.dupes.length}<small>Duplicates</small></span><span class="c-n">${r.errors.length}<small>Rejected</small></span><span class="c-v">${r.warnings.length}<small>Warnings</small></span><span class="c-m">${r.similar.length}<small>Possible duplicates</small></span></div>
      ${papersHtml}
      ${r.errors.length ? `<details open><summary><b>Rejected rows (${r.errors.length})</b> – fix these in the CSV and re-upload</summary><div class="errs">${r.errors.slice(0, 40).map(e => `<div><b>Row ${e.row}</b> – ${esc(e.msg)}</div>`).join("")}${r.errors.length > 40 ? `<div class="muted">…and ${r.errors.length - 40} more (download the rejected file)</div>` : ""}</div><button class="btn sm" data-t="rejected">⬇ Download rejected rows</button></details>` : ""}
      ${r.similar.length ? `<details open><summary><b>Possible duplicates (${r.similar.length})</b> – tick the ones you want to skip</summary><div class="errs sim">${r.similar.slice(0, 40).map(s => `<label class="check"><input type="checkbox" data-t="simskip:${s.row}" ${i.skip[s.row] ? "checked" : ""}> <span><b>Row ${s.row}</b> – ${esc(s.question)}… <span class="muted">(${esc(s.why)} · ${esc(s.other)})</span></span></label>`).join("")}</div><button class="btn sm" data-t="skipAllSim">Skip all possible duplicates</button> <button class="btn sm ghost" data-t="keepAllSim">Keep all</button></details>` : ""}
      ${r.dupes.length ? `<details><summary>Exact duplicates (${r.dupes.length}) – skipped automatically</summary><div class="errs">${r.dupes.slice(0, 20).map(d => `<div>Row ${d.row} – ${esc(d.why)}</div>`).join("")}</div></details>` : ""}
      ${r.warnings.length ? `<details><summary>Warnings (${r.warnings.length}) – still imported</summary><div class="errs">${r.warnings.slice(0, 30).map(w => `<div>Row ${w.row} – ${esc(w.msg)}</div>`).join("")}</div></details>` : ""}
      <div class="mt-s"><label class="check"><input type="checkbox" data-t="overwrite" ${i.overwrite ? "checked" : ""}> Overwrite questions that already exist (same questionId / same text) – a changed answer is logged in the answer-key history</label>
      <label class="check"><input type="checkbox" data-t="impVerified" ${i.verified ? "checked" : ""}> Mark imported questions as <b>Verified</b> (tick only if you have checked them or the source is trusted)</label></div>
      <div class="row mt-s"><button class="btn primary" data-t="doImport" ${ready ? "" : "disabled"}>Import ${ready} question${ready === 1 ? "" : "s"}${nSkip ? ` (skipping ${nSkip})` : ""}</button><button class="btn ghost" data-t="cancelImport">Cancel</button></div></div>`;
  }

  async function runCheck(text, name) {
    const rows = parseCSV(text);
    if (!rows.length) { st.imp = null; X.rerender(); return toast("No rows found. Is the first line the header row?"); }
    const missing = ["question", "optiona", "optionb", "optionc", "optiond", "correctoption", "subject", "topic"].filter(k => !(k in rows[0]));
    if (missing.length) { st.imp = null; X.rerender(); return toast("Missing columns: " + missing.join(", ")); }
    const bank = X.dupMaps(), res = validateRows(rows, bank, { overwrite: false }), papers = groupPapers(res.valid, res.errors);
    st.imp = { name, rows, bank, res, papers, overwrite: false, verified: false, skip: {}, createPapers: Object.fromEntries(papers.map(p => [p.key, true])) };
    X.rerender();
  }
  const recheck = () => {
    const i = st.imp; i.res = validateRows(i.rows, i.bank, { overwrite: i.overwrite }); i.papers = groupPapers(i.res.valid, i.res.errors);
    i.createPapers = Object.fromEntries(i.papers.map(p => [p.key, i.createPapers[p.key] ?? true])); X.rerender();
  };
  A.checkPaste = () => runCheck(st.paste, "pasted text");
  A.csv = async el => { const f = el.files[0]; if (!f) return; runCheck(await f.text(), f.name); el.value = ""; };
  A.overwrite = (_, el) => { st.imp.overwrite = el.checked; recheck(); };
  A.impVerified = (_, el) => { st.imp.verified = el.checked; };
  A.pcheck = (key, el) => { st.imp.createPapers[key] = el.checked; };
  A.simskip = (row, el) => { st.imp.skip[Number(row)] = el.checked; X.rerender(); };
  A.skipAllSim = () => { st.imp.res.similar.forEach(s => (st.imp.skip[s.row] = true)); X.rerender(); };
  A.keepAllSim = () => { st.imp.skip = {}; X.rerender(); };
  A.cancelImport = () => { st.imp = null; X.rerender(); };
  A.copyPrompt = flag => navigator.clipboard.writeText(buildAIPrompt(flag === "1")).then(() => toast("AI prompt copied – paste it into Claude/ChatGPT with your PDF"), () => toast("Copy failed"));
  A.rejected = () => {
    const rows = st.imp.res.errors.map(e => ({ ...Object.fromEntries(CSV_HEADERS.map(h => [h, e.raw[h.toLowerCase()] ?? ""])), error: e.msg }));
    download("rejected_rows.csv", toCSV(rows, [...CSV_HEADERS, "error"]));
  };
  A.doImport = async () => {
    const i = st.imp; if (!i) return; const rows = i.res.valid.filter(r => !i.skip[r._row]); if (!rows.length) return;
    const papers = i.papers.filter(p => i.createPapers[p.key]).map(p => ({ ...p, rows: p.rows.filter(r => !i.skip[r._row]) })).filter(p => p.rows.length);
    toast(`Importing ${rows.length} questions…`);
    try {
      const r = await importQuestions(db, rows, { status: i.verified ? "verified" : "review", papers });
      st.imp = null; X.logActivity(`imported ${r.n} questions${r.papers ? ` and ${r.papers} paper${r.papers > 1 ? "s" : ""}` : ""} into the bank`);
      toast(`✔ Imported ${r.n} questions${r.papers ? ` · ${r.papers} paper(s) added to the library` : ""}`); X.rerender();
    } catch (e) { console.error(e); toast("Import failed: " + (e.code || e.message)); }
  };

  // ---- browse / verify / edit ----
  A.browse = async () => {
    const br = st.browse; br.loading = true; X.rerender();
    try {
      const w = [["subject", br.subject]]; if (br.topic) w.push(["topicId", br.topic]);
      if (br.status === "review" || br.status === "verified") w.push(["status", br.status]); if (br.status === "disabled") w.push(["active", false]);
      let list = await db.query("questions", w, 100);
      if (br.status === "reported") list = list.filter(q => S.flags.some(f => f.id === q.id));
      br.list = list;
    } catch (e) { toast("Load failed: " + (e.code || e.message)); }
    br.loading = false; X.rerender();
  };
  const afterChange = async () => { if (st.browse.list) await A.browse(); else X.rerender(); };
  A.verq = async id => { await X.setStatus([id], "verified"); toast("Verified ✔"); afterChange(); };
  A.unverq = async id => { await X.setStatus([id], "review"); toast("Marked as needs review"); afterChange(); };
  A.verifyShown = async () => { const ids = st.browse.list.filter(q => q.status !== "verified" && q.active !== false).map(q => q.id); if (!ids.length) return; await X.setStatus(ids, "verified"); toast(`Verified ${ids.length} questions ✔`); afterChange(); };
  A.deactq = async id => { const [q] = await db.getMany("questions", [id]); await db.update("questions", id, { active: false }); if (q) await removeFromIndex(db, q.subject, id); delete X.cache.q[id]; toast("Disabled – it won't appear in new tests"); afterChange(); };
  A.actq = async id => {
    const [q] = await db.getMany("questions", [id]); if (!q) return;
    await db.update("questions", id, { active: true });
    const fp = fingerprint(q.question, q.options), cur = (await db.get("qindex", q.subject))?.items || [];
    await db.set("qindex", q.subject, { items: cur.filter(s => s.split("|")[0] !== id).concat(`${id}|${q.topicId}|${(q.difficulty || "")[0] || ""}|${q.year || ""}|${q.status === "verified" ? "v" : "r"}|${fp.tk}|${fp.ok}`), updatedAt: Date.now() });
    delete X.cache.q[id]; toast("Enabled"); afterChange();
  };
  A.delq = async id => {
    if (!confirm("Delete this question permanently? Old attempts keep their scores.")) return;
    const m = X.metaOf(id), [q] = m ? [] : await db.getMany("questions", [id]);
    await db.batchDelete([{ col: "questions", id }, { col: "answerKeys", id }]);
    const sub = m?.s || q?.subject; if (sub) await removeFromIndex(db, sub, id);
    delete X.cache.q[id]; delete X.cache.k[id]; toast("Deleted"); afterChange();
  };

  async function openEditor(id) {
    let q = null, k = null;
    if (id) { [q] = await db.getMany("questions", [id]); [k] = await db.getMany("answerKeys", [id]); if (!q) return toast("Question not found"); }
    const sub = q?.subject || "quant";
    X.showModal(`<h2>${q ? "Edit" : "Add"} question</h2><form id="qForm" class="form">
      <div class="form-grid"><label>Subject<select name="subject" class="input">${SUBJECTS.map(s => `<option value="${s.id}" ${s.id === sub ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
      <label>Topic<select name="topicId" class="input"></select></label>
      <label>Difficulty<select name="difficulty" class="input"><option value="">–</option>${Object.entries(DIFFS).map(([v, l]) => `<option value="${v}" ${q?.difficulty === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Year<input name="year" type="number" class="input" value="${esc(q?.year || "")}"></label>
      <label>Shift<input name="shift" class="input" value="${esc(q?.shift || "")}"></label>
      <label>Status<select name="status" class="input"><option value="review" ${q?.status !== "verified" ? "selected" : ""}>Needs review</option><option value="verified" ${q?.status === "verified" ? "selected" : ""}>Verified</option></select></label></div>
      <label>Question<textarea name="question" class="input" rows="3" required>${esc(q?.question || "")}</textarea></label>
      ${L.split("").map((l, j) => `<label>Option ${l}<input name="o${j}" class="input" required value="${esc(q?.options?.[j] || "")}"></label>`).join("")}
      <label>Correct option<select name="correct" class="input">${L.split("").map((l, j) => `<option value="${j}" ${k?.correct === j ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${q ? `<div class="keybox"><label>Reason if you change the answer key<input name="reason" class="input" placeholder="e.g. key in PDF was wrong"></label><label class="check"><input type="checkbox" name="recalc" checked> Recalculate scores of past attempts if the answer changes</label>
        <div class="small muted">Answer-key version <b>${k?.ver || 1}</b>${(k?.log || []).length ? ` · history: ${(k.log).map(l => `${L[l.from]}→${L[l.to]} (${fmtDate(l.at)}${l.reason ? ", " + esc(l.reason) : ""})`).join("; ")}` : ""}</div></div>` : ""}
      <label>Explanation<textarea name="explanation" class="input" rows="3">${esc(k?.explanation || "")}</textarea></label>
      <details><summary>Hindi text (optional)</summary><label>Question (हिन्दी)<textarea name="qHi" class="input" rows="2">${esc(q?.qHi || "")}</textarea></label>
        ${L.split("").map((l, j) => `<label>Option ${l} (हिन्दी)<input name="h${j}" class="input" value="${esc(q?.optionsHi?.[j] || "")}"></label>`).join("")}<label>Explanation (हिन्दी)<textarea name="explanationHi" class="input" rows="2">${esc(k?.explanationHi || "")}</textarea></label></details>
      <div class="form-grid"><label>Video link<input name="videoUrl" class="input" value="${esc(k?.videoUrl || "")}"></label><label>Notes link<input name="notesUrl" class="input" value="${esc(k?.notesUrl || "")}"></label><label>Image link<input name="imageUrl" class="input" value="${esc(q?.imageUrl || "")}"></label></div>
      <div class="row"><button class="btn primary">Save question</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    const f = $("#qForm");
    const fill = () => { f.topicId.innerHTML = SUBJECT_MAP[f.subject.value].topics.map(t => `<option value="${t.id}" ${q?.topicId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join(""); };
    fill(); f.subject.onchange = fill;
    f.onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f)), opts = [0, 1, 2, 3].map(j => v["o" + j].trim());
      if (new Set(opts).size < 4) return toast("Options must be different from each other");
      const isUrl = u => !u || /^https?:\/\/\S+$/i.test(u);
      if (![v.videoUrl, v.notesUrl, v.imageUrl].every(u => isUrl(u.trim()))) return toast("Links must start with http:// or https://");
      const hi = [0, 1, 2, 3].map(j => (v["h" + j] || "").trim()), hasHi = (v.qHi || "").trim() && hi.every(Boolean);
      const fp = fingerprint(v.question.trim(), opts);
      const row = {
        id: q?.id || "q" + fp.tk + Date.now().toString(36).slice(-4), subject: v.subject, topicId: v.topicId, topicName: TOPIC_MAP[v.topicId].name, subtopic: q?.subtopic || "", difficulty: v.difficulty,
        year: v.year ? Number(v.year) : "", shift: v.shift.trim(), examDate: q?.examDate || "", paperName: q?.paperName || "", paperKey: q?.paperKey || "", qno: q?.qno || 0, source: q?.source || "",
        question: v.question.trim(), options: opts, imageUrl: v.imageUrl.trim(), qHi: hasHi ? v.qHi.trim() : "", optionsHi: hasHi ? hi : [],
        correct: Number(v.correct), explanation: v.explanation.trim(), explanationHi: (v.explanationHi || "").trim(), videoUrl: v.videoUrl.trim(), notesUrl: v.notesUrl.trim(), tk: fp.tk, ok: fp.ok
      };
      const changed = q && k && k.correct !== row.correct;
      try {
        await importQuestions(db, [row], { status: v.status, existing: q ? new Set([q.id]) : undefined, reason: (v.reason || "").trim() || "Edited by admin" });
        if (q && q.subject !== row.subject) await removeFromIndex(db, q.subject, q.id);
        delete X.cache.q[row.id]; delete X.cache.k[row.id];
        let msg = "Question saved ✔";
        if (changed && v.recalc) { const n = await X.recalcAttempts(row.id, row.correct); msg += ` · ${n} past attempt${n === 1 ? "" : "s"} recalculated`; }
        X.closeModal(); toast(msg); afterChange();
      } catch (err) { toast("Save failed: " + (err.code || err.message)); }
    };
  }
  A.editq = id => openEditor(id);
  A.newq = () => openEditor(null);

  // ================= PAPER LIBRARY (admin) =================
  const cfgFields = ["timerType", "paperMode", "secPerQ", "manualMin", "secBySub", "minBySub", "pos", "neg", "maxAttempts", "published", "requireVerified", "shuffleOpt", "solutionsAfter"];
  X.viewAdminPapers = () => {
    const list = [...S.papers].sort((a, b) => (b.examDate || String(b.year)).localeCompare(a.examDate || String(a.year)) || String(a.shift).localeCompare(String(b.shift))), pe = st.pedit;
    const edit = pe ? `<section class="card editor"><h2>✎ Edit paper – ${esc(pe.titleShow)}</h2>
      <div class="form-grid"><label>Title${ui.text("pedit.title", 'maxlength="120"')}</label><label>Marks: correct / wrong<div class="row">${ui.num("pedit.pos", 'step="0.25" min="0"')}${ui.num("pedit.neg", 'step="0.25" min="0"')}</div></label>
        <label>Exam attempts per student (0 = unlimited)${ui.num("pedit.maxAttempts", 'min="0" max="50"')}</label></div>
      ${X.timerForm("pedit", pe.groups, pe.total)}
      <h3>Exam window (optional – for a group test)</h3>
      <div class="form-grid"><label>Opens${ui.dt("pedit.availableFrom")}</label><label>Closes${ui.dt("pedit.availableUntil")}</label>
        <label>Solutions<div class="rg">${ui.radio("pedit.solutionsAfter", "now", "Show right after submission")}${ui.radio("pedit.solutionsAfter", "afterClose", "Unlock when the window closes")}</div></label></div>
      <div class="rg">${ui.check("pedit.published", "Published (visible to students)")}${ui.check("pedit.requireVerified", "Exam mode only when every question is verified")}${ui.check("pedit.shuffleOpt", "Shuffle options")}</div>
      <p class="small muted">Questions and their order stay fixed so everyone gets the identical paper (year / date / shift). Re-import the CSV to change the questions.</p>
      <div class="row"><button class="btn primary" data-t="savePaper">Save paper</button><button class="btn ghost" data-t="cancelPaper">Cancel</button></div></section>` : "";
    return `${edit}
    <section class="card"><h2>🗃 Paper library (${list.length})</h2><p class="small muted">Papers are created automatically when you import a CSV that has <b>paperName + examDate + shift</b>. Students see them under Tests → Paper library.</p>
      <div class="table-wrap"><table class="list"><tr><th>Paper</th><th>Sections</th><th>Verified</th><th>Timer</th><th>Window</th><th>Status</th><th></th></tr>
      ${list.map(p => { const plan = X.planOf(p), ver = (p.qids || []).filter(id => X.metaOf(id)?.st === "v").length, tot = (p.qids || []).length;
        return `<tr><td><b>${esc(p.title)}</b><div class="small muted">${p.total} questions · ${esc(p.tier || "")}</div></td>
        <td class="small">${(p.sections || []).map(s => `${X.subjIcon(s.subject)} ${s.count}`).join(" · ")}</td>
        <td>${ver === tot ? `<span class="badge ok">${ver}/${tot}</span>` : `<span class="badge warn">${ver}/${tot}</span>`}</td>
        <td class="small">${plan.type === "none" ? "No timer" : plan.type === "paper" ? "Paper " + X.fmtMin(plan.durationSec) : "Sections " + X.fmtMin(plan.durationSec)}</td>
        <td class="small">${p.availableFrom || p.availableUntil ? `${p.availableFrom ? fmtDateTime(p.availableFrom) : "—"} → ${p.availableUntil ? fmtDateTime(p.availableUntil) : "—"}` : "Always open"}</td>
        <td>${p.published ? `<span class="badge ok">Published</span>` : `<span class="badge low">Draft</span>`}</td>
        <td><div class="row"><button class="btn sm" data-t="editPaper:${p.id}">Edit</button><button class="btn sm" data-t="pubPaper:${p.id}">${p.published ? "Unpublish" : "Publish"}</button><button class="btn sm" data-t="verifyPaper:${p.id}" ${ver === tot ? "disabled" : ""}>Verify all</button><button class="btn sm ghost danger" data-t="delPaper:${p.id}">Delete</button></div></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">No papers yet – import a CSV first.</td></tr>`}</table></div></section>`;
  };
  A.editPaper = id => {
    const p = S.papers.find(x => x.id === id); if (!p) return;
    st.pedit = { id, titleShow: p.title, title: p.title, timerType: p.timerType || "section", paperMode: p.paperMode || "auto", secPerQ: p.secPerQ || 45, manualMin: p.manualMin || 60, secBySub: { ...DEFAULT_SEC, ...(p.secBySub || {}) }, minBySub: { ...(p.minBySub || {}) }, equalTotal: 60,
      pos: p.pos ?? 2, neg: p.neg ?? 0.5, maxAttempts: p.maxAttempts || 0, published: p.published !== false, requireVerified: !!p.requireVerified, shuffleOpt: !!p.shuffleOpt, solutionsAfter: p.solutionsAfter || "now",
      availableFrom: toLocalInput(p.availableFrom), availableUntil: toLocalInput(p.availableUntil), groups: X.groupsOfItem(p), total: p.total };
    X.rerender(); window.scrollTo(0, 0);
  };
  A.cancelPaper = () => { st.pedit = null; X.rerender(); };
  A.savePaper = async () => {
    const e = st.pedit; if (!e) return;
    if (!(Number(e.pos) > 0)) return toast("Marks per correct answer must be greater than 0.");
    const from = fromLocalInput(e.availableFrom), until = fromLocalInput(e.availableUntil);
    if (from && until && until <= from) return toast("The closing time must be after the opening time.");
    const data = { title: (e.title || "").trim() || e.titleShow, availableFrom: from, availableUntil: until, updatedAt: Date.now() };
    cfgFields.forEach(k => (data[k] = e[k]));
    ["pos", "neg", "maxAttempts", "secPerQ", "manualMin"].forEach(k => (data[k] = Number(data[k]) || 0));
    try { await db.update("papers", e.id, data); st.pedit = null; toast("Paper saved ✔"); X.rerender(); } catch (err) { toast("Save failed: " + (err.code || err.message)); }
  };
  A.pubPaper = async id => { const p = S.papers.find(x => x.id === id); await db.update("papers", id, { published: !p.published }); };
  A.verifyPaper = async id => { const p = S.papers.find(x => x.id === id); await X.setStatus(p.qids, "verified"); toast("All questions in this paper verified ✔"); };
  A.delPaper = async id => { if (confirm("Delete this paper? The questions stay in the bank; past attempts keep their results.")) await db.remove("papers", id); };

  // ================= TEST BUILDER (random / fixed mini-mocks) =================
  X.newDraft = () => ({
    title: "", desc: "", mode: "random", verifiedOnly: false, rows: [{ subject: "quant", topic: "", diff: "", count: 8 }, { subject: "reasoning", topic: "", diff: "", count: 7 }, { subject: "english", topic: "", diff: "", count: 5 }, { subject: "ga", topic: "", diff: "", count: 5 }],
    timerType: "paper", paperMode: "auto", secPerQ: 45, manualMin: 20, secBySub: { ...DEFAULT_SEC }, minBySub: {}, equalTotal: 60, pos: 2, neg: 0.5, maxAttempts: 2, shuffleQ: true, shuffleOpt: false, published: true,
    availableFrom: "", availableUntil: "", solutionsAfter: "now"
  });
  const draftGroups = () => { const m = {}; st.draft.rows.forEach(r => (m[r.subject] = (m[r.subject] || 0) + (Number(r.count) || 0))); return SUBJECTS.filter(s => m[s.id]).map(s => ({ sub: s.id, n: m[s.id] })); };
  X.viewAdminTests = () => {
    const d = st.draft, g = draftGroups(), tot = g.reduce((s, x) => s + x.n, 0);
    return `
    <section class="card"><h2>🧪 Create a mock test <small class="muted">(random or fixed mini-mock – full year/shift papers come from the CSV import)</small></h2>
      <div class="form-grid"><label>Title${ui.text("draft.title", 'placeholder="e.g. Mini Mock 01" maxlength="80"')}</label><label>Description (optional)${ui.text("draft.desc", 'maxlength="160"')}</label></div>
      <label class="mt-s">Question selection<div class="rg">${ui.radio("draft.mode", "random", "🎲 Random – every student gets a different paper each attempt")}${ui.radio("draft.mode", "fixed", "📄 Fixed – same questions for everyone (picked now)")}</div></label>
      <div class="row mt-s"><b class="grow">Paper pattern</b><button class="btn sm" data-t="preset:mini">Mini 25 (8/7/5/5)</button><button class="btn sm" data-t="preset:tier1">Tier-I style 4×25</button><button class="btn sm" data-t="addRow">+ Add row</button></div>
      <div class="bp">${d.rows.map((r, i) => {
        const avail = X.scope({ subject: r.subject, topic: r.topic, diff: r.diff, verifiedOnly: d.verifiedOnly }).length, low = avail < (Number(r.count) || 0);
        return `<div class="bp-row"><label>Subject${ui.select(`draft.rows.${i}.subject`, SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}</label>
          <label>Topic${ui.select(`draft.rows.${i}.topic`, X.topicOpts(r.subject), "data-rerender")}</label>
          <label>Difficulty${ui.select(`draft.rows.${i}.diff`, [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "data-rerender")}</label>
          <label>Questions${ui.num(`draft.rows.${i}.count`, 'min="1" max="100" data-rerender')}</label>
          <div class="avail ${low ? "low" : ""}">${avail} in bank${low ? " ⚠" : ""}</div><button class="x" data-t="delRow:${i}" ${d.rows.length < 2 ? "disabled" : ""}>✕</button></div>`;
      }).join("")}</div>
      ${X.timerForm("draft", g, tot)}
      <div class="form-grid mt-s">
        <label>Marks: correct / wrong<div class="row">${ui.num("draft.pos", 'step="0.25" min="0"')}${ui.num("draft.neg", 'step="0.25" min="0"')}</div></label>
        <label>Exam attempts per student (0 = unlimited)${ui.num("draft.maxAttempts", 'min="0" max="50"')}</label>
        <label>Opens (optional)${ui.dt("draft.availableFrom")}</label><label>Closes (optional)${ui.dt("draft.availableUntil")}</label>
        <label>Solutions<div class="rg">${ui.radio("draft.solutionsAfter", "now", "Right after submission")}${ui.radio("draft.solutionsAfter", "afterClose", "When the window closes")}</div></label>
        <label class="center">${ui.check("draft.verifiedOnly", "Use verified questions only", "data-rerender")}${ui.check("draft.shuffleQ", "Shuffle questions inside each subject")}${ui.check("draft.shuffleOpt", "Shuffle options")}${ui.check("draft.published", "Publish immediately")}</label>
      </div>
      <div class="gen-sum">Total <b>${tot}</b> questions · +${d.pos} / −${d.neg}</div>
      <button class="btn primary" data-t="createTest">Create test</button></section>

    <section class="card"><h2>Existing tests (${S.tests.length})</h2>
      <div class="table-wrap"><table class="list"><tr><th>Title</th><th>Type</th><th>Questions</th><th>Timer</th><th>Attempts</th><th>Status</th><th></th></tr>
      ${S.tests.map(t => { const plan = X.planOf(t); return `<tr><td><b>${esc(t.title)}</b><div class="small muted">${fmtDate(t.createdAt)}${t.verifiedOnly ? " · verified only" : ""}</div></td><td>${t.mode === "fixed" ? "Fixed" : "Random"}</td><td>${t.total}</td><td>${plan.type === "none" ? "–" : (plan.type === "section" ? "Sections " : "") + X.fmtMin(plan.durationSec)}</td><td>${t.maxAttempts || "∞"}</td>
        <td>${t.published ? `<span class="badge ok">Published</span>` : `<span class="badge low">Draft</span>`}</td>
        <td><div class="row"><button class="btn sm" data-t="pubtoggle:${t.id}">${t.published ? "Unpublish" : "Publish"}</button><button class="btn sm ghost danger" data-t="deltest:${t.id}">Delete</button></div></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">No tests yet.</td></tr>`}
      </table></div></section>`;
  };
  A.addRow = () => { st.draft.rows.push({ subject: "quant", topic: "", diff: "", count: 5 }); X.rerender(); };
  A.delRow = i => { if (st.draft.rows.length > 1) st.draft.rows.splice(Number(i), 1); X.rerender(); };
  A.preset = k => {
    st.draft.rows = k === "mini" ? [["quant", 8], ["reasoning", 7], ["english", 5], ["ga", 5]].map(([subject, count]) => ({ subject, topic: "", diff: "", count }))
      : ["reasoning", "ga", "quant", "english"].map(subject => ({ subject, topic: "", diff: "", count: 25 }));
    if (k === "tier1") { st.draft.timerType = "section"; }
    X.rerender();
  };
  A.createTest = async () => {
    const d = st.draft;
    if (!d.title.trim()) return toast("Give the test a title.");
    if (!(Number(d.pos) > 0)) return toast("Marks per correct answer must be greater than 0.");
    const from = fromLocalInput(d.availableFrom), until = fromLocalInput(d.availableUntil);
    if (from && until && until <= from) return toast("The closing time must be after the opening time.");
    const rows = d.rows.map(r => ({ subject: r.subject, topic: r.topic || "", diff: r.diff || "", count: Math.max(1, Math.round(Number(r.count) || 0)) })), total = rows.reduce((s, r) => s + r.count, 0);
    const data = { title: d.title.trim(), desc: d.desc.trim(), mode: d.mode, verifiedOnly: !!d.verifiedOnly, blueprint: rows, total, timerType: d.timerType, paperMode: d.paperMode, secPerQ: Number(d.secPerQ) || 45, manualMin: Number(d.manualMin) || 0,
      secBySub: d.secBySub, minBySub: d.minBySub, pos: Number(d.pos), neg: Number(d.neg) || 0, maxAttempts: Math.max(0, Math.round(Number(d.maxAttempts) || 0)), shuffleQ: !!d.shuffleQ, shuffleOpt: !!d.shuffleOpt,
      published: !!d.published, availableFrom: from, availableUntil: until, solutionsAfter: d.solutionsAfter, uid: S.me.uid };
    if (d.mode === "fixed") {
      const r = X.pickBlueprint(rows, { preferUnseen: false, verifiedOnly: !!d.verifiedOnly });
      if (r.short.length) return toast("Not enough questions: " + r.short.join("; "));
      data.questionIds = r.picked.map(q => q.id); data.qmeta = Object.fromEntries(r.picked.map(q => [q.id, `${q.s}|${q.t}`])); data.total = r.picked.length;
    } else if (X.pickBlueprint(rows, { verifiedOnly: !!d.verifiedOnly }).short.length) toast("Heads-up: the bank has fewer questions than planned in some rows.");
    try { await db.add("tests", data); X.logActivity(`created test “${data.title}”`); st.draft = X.newDraft(); toast("Test created ✔"); X.rerender(); }
    catch (e) { toast("Could not create test: " + (e.code || e.message)); }
  };
  A.pubtoggle = async id => { const t = S.tests.find(x => x.id === id); await db.update("tests", id, { published: !t.published }); };
  A.deltest = async id => { if (confirm("Delete this test? Past attempts keep their results.")) await db.remove("tests", id); };

  // ================= REPORTS =================
  X.viewReports = () => `
    <section class="card"><h2>🚩 Reported questions (${S.reports.filter(r => r.status !== "done").length} open)</h2>
      <p class="small muted">While a question is reported it is held back from random tests and practice. Fix it, then press <b>Resolve</b> to release it.</p>
      ${[...S.reports].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(r => {
        const m = X.metaOf(r.qid);
        return `<div class="nb-row"><div class="nb-h"><div class="grow"><b>${esc(r.reason)}</b> ${r.status === "done" ? `<span class="badge ok">resolved</span>` : `<span class="badge warn">open</span>`}
          <div class="small">${esc(r.text || "")}</div><div class="small muted">by ${esc(X.nameOf(r.uid))} · ${fmtDate(r.createdAt)} · ${esc(TOPIC_MAP[m?.t]?.name || r.qid)}</div></div>
          <button class="btn sm" data-t="editq:${r.qid}">Open &amp; edit</button><button class="btn sm primary" data-t="repdone:${r.id}">${r.status === "done" ? "Reopen" : "Resolve"}</button><button class="x" data-t="repdel:${r.id}">✕</button></div></div>`;
      }).join("") || `<p class="empty">No reports. 🎉</p>`}
    </section>`;
  A.repdone = async id => {
    const r = S.reports.find(x => x.id === id), done = r.status !== "done";
    await db.update("reports", id, { status: done ? "done" : "open" });
    if (done && !S.reports.some(x => x.id !== id && x.qid === r.qid && x.status !== "done")) await db.remove("flags", r.qid).catch(() => {});
    else if (!done) await db.set("flags", r.qid, { uid: r.uid, at: Date.now() }).catch(() => {});
  };
  A.repdel = async id => { const r = S.reports.find(x => x.id === id); await db.remove("reports", id); if (r && !S.reports.some(x => x.id !== id && x.qid === r.qid && x.status !== "done")) await db.remove("flags", r.qid).catch(() => {}); };

  // ================= BACKUP & EXPORT =================
  X.viewBackup = () => `
    <section class="card"><h2>💾 Backup &amp; export</h2>
      <p class="muted small">Keep a copy of your work. Files download to your computer. Reading the whole question bank uses about 2 database reads per question (the free limit is 50,000 per day).</p>
      <div class="grid cards">
        <div class="card"><h3>📚 Question bank (CSV)</h3><p class="small muted">Every question with answer, explanation, paper details and Hindi text – re-importable through this same page.</p><button class="btn primary" data-t="expQ">Download CSV</button></div>
        <div class="card"><h3>📊 Attempt summaries (CSV)</h3><p class="small muted">Everyone's attempts: score, accuracy, time, mode, date.</p><button class="btn primary" data-t="expAtt">Download CSV</button></div>
        <div class="card"><h3>🗄 Complete backup (JSON)</h3><p class="small muted">All collections: members, questions, answer keys, papers, tests, attempts, mistakes, notes, vault, etc. Passwords are never included – they are not stored in the database.</p><button class="btn primary" data-t="expJSON">Download JSON</button></div>
      </div><p class="small muted">Personal exports (mistakes, saved questions) are in each student's <b>Notebook</b>.</p></section>`;
  A.expQ = async () => {
    toast("Reading the question bank…");
    const [qs, ks] = await Promise.all([db.all("questions"), db.all("answerKeys")]), km = Object.fromEntries(ks.map(k => [k.id, k]));
    const rows = qs.map(q => { const k = km[q.id] || {}; return {
      questionId: q.id, paperName: q.paperName || "", examDate: q.examDate || "", year: q.year || "", shift: q.shift || "", qno: q.qno || "", subject: NM[q.subject] || q.subject, topic: TOPIC_MAP[q.topicId]?.name || q.topicId, subtopic: q.subtopic || "",
      difficulty: q.difficulty ? q.difficulty[0].toUpperCase() + q.difficulty.slice(1) : "", question: q.question, optionA: q.options?.[0], optionB: q.options?.[1], optionC: q.options?.[2], optionD: q.options?.[3], correctOption: L[k.correct] || "",
      explanation: k.explanation || "", videoLink: k.videoUrl || "", notesLink: k.notesUrl || "", imageUrl: q.imageUrl || "", source: q.source || "",
      questionHi: q.qHi || "", optionAHi: q.optionsHi?.[0] || "", optionBHi: q.optionsHi?.[1] || "", optionCHi: q.optionsHi?.[2] || "", optionDHi: q.optionsHi?.[3] || "", explanationHi: k.explanationHi || "" }; });
    download(`question_bank_${dayKey()}.csv`, toCSV(rows, [...CSV_HEADERS, ...CSV_HEADERS_HI])); toast(`Exported ${rows.length} questions ✔`);
  };
  A.expAtt = async () => {
    toast("Reading attempts…"); const at = await db.all("attempts");
    const rows = at.map(a => ({ student: X.S.members.find(m => m.uid === a.uid)?.name || a.uid, title: a.title, type: a.kind, mode: a.mode || "exam", status: a.status, date: a.submittedAt ? dayKey(a.submittedAt) : dayKey(a.startedAt), score: a.result?.score ?? "", max: a.result?.max ?? "", percent: a.result?.percent ?? "", accuracy: a.result?.accuracy ?? "", timeSec: a.result?.timeUsed ?? "", paperId: a.paperId || "", timer: a.timerType || "" }));
    download(`attempts_${dayKey()}.csv`, toCSV(rows, ["student", "title", "type", "mode", "status", "date", "score", "max", "percent", "accuracy", "timeSec", "paperId", "timer"])); toast(`Exported ${rows.length} attempts ✔`);
  };
  A.expJSON = async () => {
    const cols = ["members", "progress", "questions", "answerKeys", "qindex", "papers", "tests", "attempts", "mistakes", "bookmarks", "qnotes", "scores", "flags", "reports", "resources", "drives", "notices", "targets", "vault", "cavault", "votes", "logs", "mocks", "comments", "activity"], out = { exportedAt: new Date().toISOString(), app: "CGL Study Hub v4" };
    for (const c of cols) { toast(`Backing up ${c}…`); try { out[c] = await db.all(c); } catch (e) { out[c] = { error: e.code || e.message }; } }
    download(`cgl_hub_backup_${dayKey()}.json`, JSON.stringify(out), "application/json"); toast("Backup downloaded ✔");
  };
}
