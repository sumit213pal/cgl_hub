// Admin pages: Question bank (CSV import + manager), Test builder, Reported questions.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { CSV_HEADERS, parseCSV, validateRows, importQuestions, removeFromIndex, toCSV, buildAIPrompt, indexString, pubFields, keyFields } from "./csv.js";
import { fmtDur, fmtDate, DIFFS } from "./t_util.js";

export function initAdmin(X) {
  const { S, st, db, $, esc, toast } = X;
  const A = X.act;
  const ui = X.ui;
  const L = "ABCD";

  // ================= QUESTION BANK =================
  X.viewQBank = () => {
    const imp = st.imp, idx = {};
    SUBJECTS.forEach(s => (idx[s.id] = X.scope({ subject: s.id })));
    const total = X.allPool().length;
    const br = st.browse;
    return `
    <section class="card"><h2>📥 Import questions (CSV)</h2>
      <p class="muted small">Convert your PYQ PDF to CSV with any AI tool using the prompt below, then upload the file here. Nothing is saved until you press Import.</p>
      <div class="row"><button class="btn" data-t="copyPrompt">📋 Copy AI prompt</button><a class="btn" href="sample/cgl_questions_sample.csv" download>⬇ Sample CSV</a><button class="btn" data-t="newq">+ Add one question manually</button></div>
      <div class="drop mt-s"><input type="file" id="csvFile" accept=".csv,.txt,.tsv" data-tfile="csv"><span class="small muted">…or paste CSV text:</span>
        <textarea class="input" rows="3" data-bind="paste" placeholder="Paste CSV text here, then press Check"></textarea>
        <button class="btn sm" data-t="checkPaste">Check pasted text</button></div>
      ${imp ? importPreview(imp) : ""}
    </section>

    <section class="card"><h2>📚 Question bank overview <small class="muted">(${total} active questions)</small></h2>
      ${total ? SUBJECTS.map(s => { const list = idx[s.id]; if (!list.length) return ""; const by = {}; list.forEach(q => (by[q.t] = (by[q.t] || 0) + 1));
        return `<details class="ov"><summary><b>${s.icon} ${esc(s.name)}</b> <span class="badge">${list.length}</span></summary>${s.topics.filter(t => by[t.id]).map(t => `<div class="li"><span class="grow">${esc(t.name)}</span><b>${by[t.id]}</b></div>`).join("")}</details>`; }).join("") : `<p class="empty">No questions yet.</p>`}
    </section>

    <section class="card"><h2>🔎 Browse &amp; edit questions</h2>
      <div class="toolbar">${ui.select("browse.subject", SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}${ui.select("browse.topic", X.topicOpts(br.subject), "data-rerender")}<button class="btn primary" data-t="browse">Load (max 50)</button></div>
      ${br.loading ? `<p class="muted">Loading…</p>` : br.list ? (br.list.map(q => `<div class="nb-row"><div class="nb-h"><div class="grow"><b>${esc(q.question.slice(0, 140))}${q.question.length > 140 ? "…" : ""}</b><div class="small muted">${esc(TOPIC_MAP[q.topicId]?.name || q.topicId)} ${q.year ? "· " + q.year : ""} ${q.difficulty ? "· " + q.difficulty : ""} ${q.active === false ? `<span class="badge off">inactive</span>` : ""}</div></div>
        <button class="btn sm" data-t="editq:${q.id}">Edit</button>${q.active === false ? `<button class="btn sm" data-t="actq:${q.id}">Activate</button>` : `<button class="btn sm" data-t="deactq:${q.id}">Deactivate</button>`}<button class="btn sm ghost danger" data-t="delq:${q.id}">Delete</button></div></div>`).join("") || `<p class="empty">No questions found.</p>`) : `<p class="muted small">Pick a subject/topic and press Load.</p>`}
    </section>`;
  };

  function importPreview(i) {
    return `<div class="imp">
      <h3>Check result – ${esc(i.name)}</h3>
      <div class="chips2"><span>${i.res.total}<small>Rows</small></span><span class="c-a">${i.res.valid.length}<small>Ready to import</small></span><span class="c-m">${i.res.dupes.length}<small>Duplicates</small></span><span class="c-n">${i.res.errors.length}<small>Rejected</small></span><span class="c-v">${i.res.warnings.length}<small>Warnings</small></span></div>
      ${i.res.errors.length ? `<details open><summary><b>Rejected rows (${i.res.errors.length})</b> – fix these in the CSV and re-upload</summary><div class="errs">${i.res.errors.slice(0, 40).map(e => `<div><b>Row ${e.row}</b> – ${esc(e.msg)}</div>`).join("")}${i.res.errors.length > 40 ? `<div class="muted">…and ${i.res.errors.length - 40} more (download the rejected file)</div>` : ""}</div><button class="btn sm" data-t="rejected">⬇ Download rejected rows</button></details>` : ""}
      ${i.res.dupes.length ? `<details><summary>Duplicates (${i.res.dupes.length})</summary><div class="errs">${i.res.dupes.slice(0, 20).map(d => `<div>Row ${d.row} – ${esc(d.why)}</div>`).join("")}</div></details>` : ""}
      ${i.res.warnings.length ? `<details><summary>Warnings (${i.res.warnings.length}) – still imported</summary><div class="errs">${i.res.warnings.slice(0, 30).map(w => `<div>Row ${w.row} – ${esc(w.msg)}</div>`).join("")}</div></details>` : ""}
      <label class="check mt-s"><input type="checkbox" data-t="overwrite" ${i.overwrite ? "checked" : ""}> Overwrite questions that already exist (same questionId / same text)</label>
      <div class="row mt-s"><button class="btn primary" data-t="doImport" ${i.res.valid.length ? "" : "disabled"}>Import ${i.res.valid.length} question${i.res.valid.length === 1 ? "" : "s"}</button><button class="btn ghost" data-t="cancelImport">Cancel</button></div></div>`;
  }

  async function runCheck(text, name) {
    const rows = parseCSV(text);
    if (!rows.length) { st.imp = null; X.rerender(); return toast("No rows found. Is the first line the header row?"); }
    const missing = ["question", "optiona", "optionb", "optionc", "optiond", "correctoption", "subject", "topic"].filter(k => !(k in rows[0]));
    if (missing.length) { st.imp = null; X.rerender(); return toast("Missing columns: " + missing.join(", ")); }
    const existing = new Set(X.allPool().map(q => q.id));
    const res = validateRows(rows, existing, { overwrite: false });
    st.imp = { name, rows, res, existing, overwrite: false };
    X.rerender();
  }
  const recheck = () => { const i = st.imp; i.res = validateRows(i.rows, i.existing, { overwrite: i.overwrite }); X.rerender(); };

  A.checkPaste = () => runCheck(st.paste, "pasted text");
  A.csv = async el => { const f = el.files[0]; if (!f) return; runCheck(await f.text(), f.name); el.value = ""; };
  A.overwrite = (_, el) => { st.imp.overwrite = el.checked; recheck(); };
  A.cancelImport = () => { st.imp = null; X.rerender(); };
  A.copyPrompt = () => navigator.clipboard.writeText(buildAIPrompt()).then(() => toast("AI prompt copied – paste it into Claude/ChatGPT with your PDF"), () => toast("Copy failed"));
  A.rejected = () => {
    const rows = st.imp.res.errors.map(e => ({ ...Object.fromEntries(CSV_HEADERS.map(h => [h, e.raw[h.toLowerCase()] ?? ""])), error: e.msg }));
    const blob = new Blob(["\uFEFF" + toCSV(rows, [...CSV_HEADERS, "error"])], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "rejected_rows.csv"; a.click();
  };
  A.doImport = async () => {
    const i = st.imp; if (!i?.res.valid.length) return;
    toast(`Importing ${i.res.valid.length} questions…`);
    try {
      const n = await importQuestions(db, i.res.valid);
      st.imp = null; X.logActivity(`imported ${n} questions into the bank`);
      toast(`✔ Imported ${n} questions`); X.rerender();
    } catch (e) { console.error(e); toast("Import failed: " + (e.code || e.message)); }
  };

  // ---- browse / edit ----
  A.browse = async () => {
    const br = st.browse; br.loading = true; X.rerender();
    try {
      const w = [["subject", br.subject]]; if (br.topic) w.push(["topicId", br.topic]);
      br.list = await db.query("questions", w, 50);
    } catch (e) { toast("Load failed: " + (e.code || e.message)); }
    br.loading = false; X.rerender();
  };
  const afterChange = async () => { if (st.browse.list) await A.browse(); else X.rerender(); };

  A.deactq = async id => { const q = X.cache.q[id] || (await X.loadQuestions([id]))[0]; await db.update("questions", id, { active: false }); if (q) await removeFromIndex(db, q.subject, id); delete X.cache.q[id]; toast("Deactivated – it won't appear in new tests"); afterChange(); };
  A.actq = async id => {
    const [q] = await db.getMany("questions", [id]); if (!q) return;
    await db.update("questions", id, { active: true });
    const cur = (await db.get("qindex", q.subject))?.items || [];
    await db.set("qindex", q.subject, { items: cur.filter(s => s.split("|")[0] !== id).concat(indexString({ id, topicId: q.topicId, difficulty: q.difficulty, year: q.year })), updatedAt: Date.now() });
    delete X.cache.q[id]; toast("Activated"); afterChange();
  };
  A.delq = async id => {
    if (!confirm("Delete this question permanently? Old attempts keep their scores.")) return;
    const m = X.metaOf(id); const [q] = m ? [] : await db.getMany("questions", [id]);
    await db.batchDelete([{ col: "questions", id }, { col: "answerKeys", id }]);
    const sub = m?.s || q?.subject; if (sub) await removeFromIndex(db, sub, id);
    delete X.cache.q[id]; delete X.cache.k[id]; toast("Deleted"); afterChange();
  };

  const qForm = (q, k) => {
    const sub = q?.subject || "quant";
    return `<h2>${q ? "Edit" : "Add"} question</h2><form id="qForm" class="form">
      <div class="form-grid"><label>Subject<select name="subject" class="input">${SUBJECTS.map(s => `<option value="${s.id}" ${s.id === sub ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
      <label>Topic<select name="topicId" class="input"></select></label>
      <label>Difficulty<select name="difficulty" class="input"><option value="">–</option>${Object.entries(DIFFS).map(([v, l]) => `<option value="${v}" ${q?.difficulty === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Year<input name="year" type="number" class="input" value="${esc(q?.year || "")}"></label>
      <label>Shift<input name="shift" class="input" value="${esc(q?.shift || "")}"></label>
      <label>Paper name<input name="paperName" class="input" value="${esc(q?.paperName || "")}"></label></div>
      <label>Question<textarea name="question" class="input" rows="3" required>${esc(q?.question || "")}</textarea></label>
      ${L.split("").map((l, j) => `<label>Option ${l}<input name="o${j}" class="input" required value="${esc(q?.options?.[j] || "")}"></label>`).join("")}
      <label>Correct option<select name="correct" class="input">${L.split("").map((l, j) => `<option value="${j}" ${k?.correct === j ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Explanation<textarea name="explanation" class="input" rows="3">${esc(k?.explanation || "")}</textarea></label>
      <div class="form-grid"><label>Video link<input name="videoUrl" class="input" value="${esc(k?.videoUrl || "")}"></label><label>Notes link<input name="notesUrl" class="input" value="${esc(k?.notesUrl || "")}"></label><label>Image link<input name="imageUrl" class="input" value="${esc(q?.imageUrl || "")}"></label></div>
      <div class="row"><button class="btn primary">Save question</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`;
  };
  async function openEditor(id) {
    let q = null, k = null;
    if (id) { [q] = await db.getMany("questions", [id]); [k] = await db.getMany("answerKeys", [id]); if (!q) return toast("Question not found"); }
    X.showModal(qForm(q, k));
    const f = $("#qForm");
    const fill = () => { f.topicId.innerHTML = SUBJECT_MAP[f.subject.value].topics.map(t => `<option value="${t.id}" ${q?.topicId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join(""); };
    fill(); f.subject.onchange = fill;
    f.onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      const opts = [0, 1, 2, 3].map(j => v["o" + j].trim());
      if (new Set(opts).size < 4) return toast("Options must be different from each other");
      const isUrl = u => !u || /^https?:\/\/\S+$/i.test(u);
      if (![v.videoUrl, v.notesUrl, v.imageUrl].every(u => isUrl(u.trim()))) return toast("Links must start with http:// or https://");
      const hashId = () => "q" + Math.abs([...(v.question + opts.join())].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)).toString(36) + Date.now().toString(36).slice(-4);
      const row = { id: q?.id || hashId(), subject: v.subject, topicId: v.topicId, topicName: TOPIC_MAP[v.topicId].name, subtopic: q?.subtopic || "", difficulty: v.difficulty, year: v.year ? Number(v.year) : "", shift: v.shift.trim(), paperName: v.paperName.trim(), source: q?.source || "", question: v.question.trim(), options: opts, imageUrl: v.imageUrl.trim(), correct: Number(v.correct), explanation: v.explanation.trim(), videoUrl: v.videoUrl.trim(), notesUrl: v.notesUrl.trim() };
      try {
        await importQuestions(db, [row]);
        if (q && q.subject !== row.subject) await removeFromIndex(db, q.subject, q.id);
        delete X.cache.q[row.id]; delete X.cache.k[row.id];
        X.closeModal(); toast("Question saved ✔"); afterChange();
      } catch (err) { toast("Save failed: " + (err.code || err.message)); }
    };
  }
  A.editq = id => openEditor(id);
  A.newq = () => openEditor(null);

  // ================= TEST BUILDER =================
  const draftTotal = () => st.draft.rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  X.newDraft = () => ({ title: "", desc: "", mode: "random", rows: [{ subject: "quant", topic: "", diff: "", count: 8 }, { subject: "reasoning", topic: "", diff: "", count: 7 }, { subject: "english", topic: "", diff: "", count: 5 }, { subject: "ga", topic: "", diff: "", count: 5 }],
    timerMode: "auto", secPerQ: 45, manualMin: 20, pos: 2, neg: 0.5, maxAttempts: 2, shuffleQ: true, shuffleOpt: false, published: true });

  X.viewAdminTests = () => {
    const d = st.draft, tot = draftTotal();
    const dur = d.timerMode === "none" ? "No timer" : fmtDur(X.calcDuration(tot, d.timerMode, d.secPerQ, d.manualMin));
    return `
    <section class="card"><h2>🧪 Create a test</h2>
      <div class="form-grid"><label>Title${ui.text("draft.title", 'placeholder="e.g. Mini Mock 01" maxlength="80"')}</label><label>Description (optional)${ui.text("draft.desc", 'maxlength="160"')}</label></div>
      <label class="mt-s">Question selection<div class="rg">${ui.radio("draft.mode", "random", "🎲 Random – every student gets a different paper each attempt")}${ui.radio("draft.mode", "fixed", "📄 Fixed – same questions for everyone (picked now)")}</div></label>
      <div class="row mt-s"><b class="grow">Paper pattern</b><button class="btn sm" data-t="preset:mini">Mini 25 (8/7/5/5)</button><button class="btn sm" data-t="preset:tier1">Tier-1 style 100</button><button class="btn sm" data-t="addRow">+ Add row</button></div>
      <div class="bp">${d.rows.map((r, i) => {
        const avail = X.scope({ subject: r.subject, topic: r.topic, diff: r.diff }).length, low = avail < (Number(r.count) || 0);
        return `<div class="bp-row"><label>Subject${ui.select(`draft.rows.${i}.subject`, SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}</label>
          <label>Topic${ui.select(`draft.rows.${i}.topic`, X.topicOpts(r.subject), "data-rerender")}</label>
          <label>Difficulty${ui.select(`draft.rows.${i}.diff`, [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], "data-rerender")}</label>
          <label>Questions${ui.num(`draft.rows.${i}.count`, 'min="1" max="100" data-rerender')}</label>
          <div class="avail ${low ? "low" : ""}">${avail} in bank${low ? " ⚠" : ""}</div><button class="x" data-t="delRow:${i}" ${d.rows.length < 2 ? "disabled" : ""}>✕</button></div>`;
      }).join("")}</div>
      <div class="form-grid mt-s">
        <label>Timer<div class="rg">${ui.radio("draft.timerMode", "auto", "Auto (per question)")}${ui.radio("draft.timerMode", "manual", "Manual")}${ui.radio("draft.timerMode", "none", "No timer")}</div></label>
        ${d.timerMode === "auto" ? `<label>Time per question${ui.select("draft.secPerQ", [[30, "30 sec"], [45, "45 sec"], [60, "60 sec"], [90, "90 sec"]], "data-rerender")}</label>` : ""}
        ${d.timerMode === "manual" ? `<label>Total minutes${ui.num("draft.manualMin", 'min="1" max="240" data-rerender')}</label>` : ""}
        <label>Marks: correct / wrong<div class="row">${ui.num("draft.pos", 'step="0.25" min="0"')}${ui.num("draft.neg", 'step="0.25" min="0"')}</div></label>
        <label>Attempts per student (0 = unlimited)${ui.num("draft.maxAttempts", 'min="0" max="50"')}</label>
        <label class="center">${ui.check("draft.shuffleQ", "Shuffle questions inside each subject")}${ui.check("draft.shuffleOpt", "Shuffle options")}${ui.check("draft.published", "Publish immediately")}</label>
      </div>
      <div class="gen-sum">Total <b>${tot}</b> questions · ${dur} · +${d.pos} / −${d.neg}</div>
      <button class="btn primary" data-t="createTest">Create test</button></section>

    <section class="card"><h2>Existing tests (${S.tests.length})</h2>
      <div class="table-wrap"><table class="list"><tr><th>Title</th><th>Type</th><th>Questions</th><th>Timer</th><th>Attempts</th><th>Status</th><th></th></tr>
      ${S.tests.map(t => `<tr><td><b>${esc(t.title)}</b><div class="small muted">${fmtDate(t.createdAt)}</div></td><td>${t.mode === "fixed" ? "Fixed" : "Random"}</td><td>${t.total}</td><td>${t.timerMode === "none" ? "–" : fmtDur(X.calcDuration(t.total, t.timerMode, t.secPerQ, t.manualMin))}</td><td>${t.maxAttempts || "∞"}</td>
        <td>${t.published ? `<span class="badge ok">Published</span>` : `<span class="badge low">Draft</span>`}</td>
        <td><div class="row"><button class="btn sm" data-t="pubtoggle:${t.id}">${t.published ? "Unpublish" : "Publish"}</button><button class="btn sm ghost danger" data-t="deltest:${t.id}">Delete</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No tests yet.</td></tr>`}
      </table></div></section>`;
  };

  A.addRow = () => { st.draft.rows.push({ subject: "quant", topic: "", diff: "", count: 5 }); X.rerender(); };
  A.delRow = i => { if (st.draft.rows.length > 1) st.draft.rows.splice(Number(i), 1); X.rerender(); };
  A.preset = k => {
    st.draft.rows = k === "mini"
      ? [["quant", 8], ["reasoning", 7], ["english", 5], ["ga", 5]].map(([subject, count]) => ({ subject, topic: "", diff: "", count }))
      : ["quant", "reasoning", "english", "ga"].map(subject => ({ subject, topic: "", diff: "", count: 25 }));
    if (k === "tier1") { st.draft.secPerQ = 36; st.draft.timerMode = "manual"; st.draft.manualMin = 60; }
    X.rerender();
  };
  A.createTest = async () => {
    const d = st.draft;
    if (!d.title.trim()) return toast("Give the test a title.");
    const rows = d.rows.map(r => ({ subject: r.subject, topic: r.topic || "", diff: r.diff || "", count: Math.max(1, Math.round(Number(r.count) || 0)) }));
    const total = rows.reduce((s, r) => s + r.count, 0);
    if (!(Number(d.pos) > 0)) return toast("Marks per correct answer must be greater than 0.");
    const data = { title: d.title.trim(), desc: d.desc.trim(), mode: d.mode, blueprint: rows, total, timerMode: d.timerMode, secPerQ: Number(d.secPerQ) || 45, manualMin: Number(d.manualMin) || 0,
      pos: Number(d.pos), neg: Number(d.neg) || 0, maxAttempts: Math.max(0, Math.round(Number(d.maxAttempts) || 0)), shuffleQ: !!d.shuffleQ, shuffleOpt: !!d.shuffleOpt, published: !!d.published, uid: S.me.uid };
    if (d.mode === "fixed") {
      const r = X.pickBlueprint(rows, { preferUnseen: false });
      if (r.short.length) return toast("Not enough questions: " + r.short.join("; "));
      data.questionIds = r.picked.map(q => q.id); data.qmeta = Object.fromEntries(r.picked.map(q => [q.id, `${q.s}|${q.t}`])); data.total = r.picked.length;
    } else if (X.pickBlueprint(rows).short.length) toast("Heads-up: the bank has fewer questions than planned in some rows.");
    try { await db.add("tests", data); X.logActivity(`created test “${data.title}”`); st.draft = X.newDraft(); toast("Test created ✔"); X.rerender(); }
    catch (e) { toast("Could not create test: " + (e.code || e.message)); }
  };
  A.pubtoggle = async id => { const t = S.tests.find(x => x.id === id); await db.update("tests", id, { published: !t.published }); };
  A.deltest = async id => { if (confirm("Delete this test? Past attempts keep their results.")) await db.remove("tests", id); };

  // ================= REPORTS =================
  X.viewReports = () => `
    <section class="card"><h2>🚩 Reported questions (${S.reports.filter(r => r.status !== "done").length} open)</h2>
      ${[...S.reports].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(r => {
        const m = X.metaOf(r.qid);
        return `<div class="nb-row"><div class="nb-h"><div class="grow"><b>${esc(r.reason)}</b> ${r.status === "done" ? `<span class="badge ok">resolved</span>` : `<span class="badge warn">open</span>`}
          <div class="small">${esc(r.text || "")}</div><div class="small muted">by ${esc(X.nameOf(r.uid))} · ${fmtDate(r.createdAt)} · ${esc(TOPIC_MAP[m?.t]?.name || r.qid)}</div></div>
          <button class="btn sm" data-t="editq:${r.qid}">Open &amp; edit</button><button class="btn sm" data-t="repdone:${r.id}">${r.status === "done" ? "Reopen" : "Mark resolved"}</button><button class="x" data-t="repdel:${r.id}">✕</button></div></div>`;
      }).join("") || `<p class="empty">No reports. 🎉</p>`}
    </section>`;
  A.repdone = async id => { const r = S.reports.find(x => x.id === id); await db.update("reports", id, { status: r.status === "done" ? "open" : "done" }); };
  A.repdel = async id => { await db.remove("reports", id); };
}
