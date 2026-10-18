// Admin: members + pinned notice, questions (CSV import, browse/edit, reports), papers, backup.
import db from "./db.js";
import { GROUP_NAME } from "./config.js";
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP } from "./syllabus.js";
import { S, ui, bus, toast, A, f } from "./state.js";
import { esc, ago, fmtDate, fmtDay, fmtDateTime, toLocalInput, fromLocalInput, download, genPw, dayKey, timerPlan } from "./util.js";
import { HEADERS, parseCSV, validateRows, groupPapers, importQuestions, removeFromIndex, toCSV, aiPrompt, fingerprint, indexString } from "./csv.js";
import * as E from "./engine.js";
import { pct } from "./people.js";

const $ = s => document.querySelector(s), L = "ABCD";
const fm = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return !m ? `${r}s` : r ? `${m}m ${r}s` : `${m}m`; };
const AUTH_ERR = { "auth/email-already-in-use": "This email already has an account.", "auth/invalid-email": "That email doesn't look right.", "auth/weak-password": "Password too weak (use 8+ characters)." };

export function viewAdmin() {
  const open = S.reports.filter(r => r.status !== "done").length;
  const tabs = [["members", "Members"], ["questions", `Questions${open ? ` (${open} reported)` : ""}`], ["papers", "Papers"], ["backup", "Backup"]];
  return `<header class="page-head"><div><h1>Admin</h1></div></header><div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${ui.adminTab === k ? "on" : ""}" data-a="atab:${k}">${l}</button>`).join("")}</div>
    ${{ members: membersTab, questions: questionsTab, papers: papersTab, backup: backupTab }[ui.adminTab]()}`;
}
A.atab = t => { ui.adminTab = t; bus.render(); };

// ---------- members + notice ----------
function membersTab() {
  const ms = [...S.members].sort((a, b) => (b.role === "admin") - (a.role === "admin") || (a.name || "").localeCompare(b.name || "")), notice = S.notices.find(n => n.id === "current");
  const badge = m => m.active === false ? `<span class="chip off">Disabled</span>` : m.mustChangePassword ? `<span class="chip warn">Waiting for first login</span>` : `<span class="chip ok">Active</span>`;
  return `<div class="grid two"><section class="card"><h2>Add a member</h2><form id="addMember" class="form"><label>Name<input name="name" class="input" required maxlength="40"></label><label>Email (their login)<input name="email" type="email" class="input" required></label>
      <label>Temporary password<div class="row"><input name="pw" class="input grow" required minlength="8" value="${genPw()}"><button type="button" class="btn sm" data-a="regen">↻</button></div></label><button class="btn primary">Create account</button>
      <p class="small muted">They must set their own password on first login. After that only they know it – you can never see it.</p></form></section>
    <section class="card"><h2>Pinned notice</h2><p class="small muted">One short message shown on everyone's Home page.</p><textarea class="input" rows="3" maxlength="300" data-bind="noticeText" placeholder="e.g. Sunday 10 AM – full paper for everyone">${esc(ui.noticeText || notice?.text || "")}</textarea>
      <div class="row mt-s"><button class="btn primary" data-a="postNotice">Save notice</button><button class="btn ghost" data-a="clearNotice">Remove</button></div></section></div>
    <section class="card"><h2>Members (${ms.length})</h2><div class="table-wrap"><table class="list"><tr><th>Name</th><th>Email</th><th>Status</th><th>Last seen</th><th>Syllabus</th><th></th></tr>
      ${ms.map(m => { const self = m.id === S.me.email; return `<tr><td><b>${esc(m.name)}</b>${m.role === "admin" ? ` <span class="chip">Admin</span>` : ""}</td><td>${esc(m.id)}</td><td>${badge(m)}</td><td>${ago(m.lastSeen)}</td><td>${m.uid ? pct(m.uid) + "%" : "–"}</td>
        <td>${self ? "" : `<div class="row"><button class="btn sm" data-a="resetPw:${esc(m.id)}">Reset password</button><button class="btn sm ${m.active === false ? "" : "danger"}" data-a="toggleMember:${esc(m.id)}">${m.active === false ? "Enable" : "Disable"}</button></div>`}</td></tr>`; }).join("")}</table></div>
      <p class="small muted">Disable blocks access immediately. To delete a login completely: Firebase Console → Authentication → Users.</p></section>`;
}
A.regen = () => { const i = $("#addMember [name=pw]"); if (i) i.value = genPw(); };
A.postNotice = async () => { const t = (ui.noticeText || "").trim(); if (!t) return toast("Write the notice first."); await db.set("notices", "current", { text: t, uid: S.me.uid }); ui.noticeText = ""; toast("Notice saved ✔"); };
A.clearNotice = async () => { await db.set("notices", "current", { text: "" }); ui.noticeText = ""; bus.render(); };
A.resetPw = async em => { if (!confirm(`Send a password reset email to ${em}?`)) return; try { await db.resetPassword(em); toast("Reset email sent"); } catch (e) { toast(e.message); } };
A.toggleMember = async em => { const m = S.members.find(x => x.id === em); if (!m) return; const en = m.active === false; if (!en && !confirm(`Disable ${m.name}? They will be logged out and blocked.`)) return; await db.set("members", em, { active: en }); };
export async function addMember(form) {
  const v = Object.fromEntries(new FormData(form)), email = v.email.trim().toLowerCase(), name = v.name.trim(); if (v.pw.length < 8) return toast("Temporary password needs 8+ characters.");
  const btn = form.querySelector("button.primary"); btn.disabled = true; btn.textContent = "Creating…";
  try {
    let uid = null, existed = false; try { uid = await db.createUser(email, v.pw); } catch (e) { if (e.code === "auth/email-already-in-use") existed = true; else throw e; }
    const old = S.members.find(m => m.id === email);
    await db.set("members", email, { name, role: old?.role || "member", active: true, mustChangePassword: !existed, ...(uid ? { uid } : {}), createdAt: old?.createdAt || Date.now(), addedBy: S.me.email });
    if (existed) bus.modal(`<h2>Access restored</h2><p>${esc(email)} already had a login, so access was re-enabled. Their old password still works – or press <b>Reset password</b>.</p><button class="btn" data-close="modal">OK</button>`);
    else {
      const msg = `Hi ${name}, you've been added to ${GROUP_NAME} 📚\n\nLink: ${location.origin + location.pathname}\nEmail: ${email}\nTemporary password: ${v.pw}\n\nYou'll set your own password on first login.`;
      bus.modal(`<h2>✅ Account created</h2><p class="muted small">Send this to ${esc(name)} privately. The temporary password is shown only now.</p><pre class="cred">${esc(msg)}</pre><div class="row"><button class="btn primary" id="copyCred">Copy</button><a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a><button class="btn ghost" data-close="modal">Done</button></div>`);
      $("#copyCred").onclick = () => navigator.clipboard.writeText(msg).then(() => toast("Copied ✔"));
    }
  } catch (e) { toast(AUTH_ERR[e.code] || e.message); } finally { const b = $("#addMember button.primary"); if (b) { b.disabled = false; b.textContent = "Create account"; } }
}

// ---------- questions ----------
function questionsTab() {
  const imp = ui.imp, raw = E.rawPool(), br = ui.browse, reports = S.reports.filter(r => r.status !== "done");
  return `<section class="card"><h2>Import questions (CSV)</h2><p class="muted small">Turn a PDF into CSV with any AI tool (copy the prompt below), then upload it. You'll see a check result first – nothing is saved until you press Import. Rows with the same <b>paperName + examDate + shift</b> become one full paper.</p>
      <div class="row"><button class="btn" data-a="copyPrompt">📋 Copy AI prompt</button><a class="btn" href="sample/cgl_questions_sample.csv" download>Sample CSV</a><button class="btn" data-a="newq">+ Add one question</button></div>
      <div class="drop mt-s"><input type="file" id="csvFile" accept=".csv,.txt,.tsv" data-file="csv"><span class="small muted">or paste CSV text:</span><textarea class="input" rows="3" data-bind="paste" placeholder="Paste CSV here"></textarea><button class="btn sm" data-a="checkPaste">Check pasted text</button></div>${imp ? preview(imp) : ""}</section>
    ${reports.length ? `<section class="card"><h2>Reported questions (${reports.length})</h2><p class="small muted">Held back from new tests until you resolve them.</p>${reports.map(r => `<div class="li"><span class="grow"><b>${esc(r.reason)}</b> <span class="muted small">${esc(r.text || "")}</span><div class="small muted">${esc(TOPIC_MAP[E.meta(r.qid)?.t]?.name || r.qid)}</div></span><button class="btn sm" data-a="editq:${r.qid}">Open</button><button class="btn sm primary" data-a="repdone:${r.id}">Resolve</button></div>`).join("")}</section>` : ""}
    <section class="card"><h2>Browse &amp; edit <small class="muted">(${raw.length} questions: ${SUBJECTS.map(s => `${s.short} ${raw.filter(q => q.s === s.id).length}`).filter(x => !x.endsWith(" 0")).join(" · ") || "none yet"})</small></h2>
      <div class="toolbar">${f.select("browse.subject", SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}${f.select("browse.topic", [["", "All topics"], ...SUBJECT_MAP[br.subject].topics.map(t => [t.id, t.name])], "data-rerender")}<button class="btn primary" data-a="browse">Load (max 100)</button></div>
      ${br.loading ? `<p class="muted">Loading…</p>` : br.list ? (br.list.map(q => `<div class="nb-row"><div class="nb-h"><div class="grow"><b>${esc(q.question.slice(0, 130))}${q.question.length > 130 ? "…" : ""}</b><div class="small muted">${esc(TOPIC_MAP[q.topicId]?.name || q.topicId)}${q.year ? " · " + q.year : ""}${q.active === false ? ` <span class="chip off">disabled</span>` : ""}</div></div>
        <button class="btn sm" data-a="editq:${q.id}">Edit</button>${q.active === false ? `<button class="btn sm" data-a="actq:${q.id}">Enable</button>` : `<button class="btn sm" data-a="deactq:${q.id}">Disable</button>`}<button class="btn sm ghost danger" data-a="delq:${q.id}">Delete</button></div></div>`).join("") || `<p class="empty">No questions found.</p>`) : `<p class="muted small">Pick a subject / topic and press Load.</p>`}</section>`;
}
function preview(i) {
  const r = i.res, skipN = Object.values(i.skip).filter(Boolean).length, ready = r.valid.filter(x => !i.skip[x._row]).length;
  const papers = i.papers.map(p => { const warn = []; if (p.tier === "Tier I" && (p.total !== 100 || Object.keys(p.bySubject).length !== 4 || Object.values(p.bySubject).some(c => c !== 25))) warn.push("Tier-I papers normally have 4 sections × 25 = 100 questions"); if (p.rejected) warn.push(`${p.rejected} rejected row(s) – the paper will be incomplete`); if (p.noExpl) warn.push(`${p.noExpl} without explanation`); if (p.noImg) warn.push(`${p.noImg} figure question(s) without an image link`);
    return `<label class="paper-det"><input type="checkbox" data-a="pcheck:${esc(p.key)}" ${i.createPapers[p.key] ? "checked" : ""}><div><b>${esc(p.paperName)}</b> · ${esc(fmtDay(p.examDate) || p.year || "")} · ${esc(p.shift || "")} <span class="chip ${warn.length ? "warn" : "ok"}">${warn.length ? "check" : "complete"}</span>
      <div class="small">${Object.entries(p.bySubject).map(([s, c]) => `${E.subjIcon(s)} ${esc(E.subjName(s))} <b>${c}</b>`).join(" · ")} = <b>${p.total}</b></div>${warn.map(w => `<div class="small warnline">⚠ ${esc(w)}</div>`).join("")}</div></label>`; }).join("");
  return `<div class="imp"><h3>Check result – ${esc(i.name)}</h3><div class="chips2"><span>${r.total}<small>Rows</small></span><span class="c-a">${ready}<small>Ready</small></span><span class="c-m">${r.dupes.length}<small>Duplicates</small></span><span class="c-n">${r.errors.length}<small>Rejected</small></span><span class="c-v">${r.similar.length}<small>Look similar</small></span></div>
    ${papers ? `<h3>Full papers found</h3>${papers}` : `<p class="small muted">No paper grouping (add paperName + examDate + shift on every row to build full papers).</p>`}
    ${r.errors.length ? `<details open><summary><b>Rejected rows (${r.errors.length})</b> – fix them in the CSV and re-upload</summary><div class="errs">${r.errors.slice(0, 40).map(e => `<div><b>Row ${e.row}</b> – ${esc(e.msg)}</div>`).join("")}</div><button class="btn sm" data-a="rejected">⬇ Download rejected rows</button></details>` : ""}
    ${r.similar.length ? `<details open><summary><b>Possible duplicates (${r.similar.length})</b> – tick to skip</summary><div class="errs sim">${r.similar.slice(0, 40).map(s => `<label class="check"><input type="checkbox" data-a="simskip:${s.row}" ${i.skip[s.row] ? "checked" : ""}><span><b>Row ${s.row}</b> – ${esc(s.question)}… <span class="muted">(${esc(s.why)})</span></span></label>`).join("")}</div><button class="btn sm" data-a="skipSim">Skip all of these</button></details>` : ""}
    ${r.dupes.length ? `<details><summary>Exact duplicates (${r.dupes.length}) – skipped automatically</summary><div class="errs">${r.dupes.slice(0, 20).map(d => `<div>Row ${d.row} – ${esc(d.why)}</div>`).join("")}</div></details>` : ""}
    ${r.warnings.length ? `<details><summary>Notes (${r.warnings.length})</summary><div class="errs">${r.warnings.slice(0, 30).map(w => `<div>Row ${w.row} – ${esc(w.msg)}</div>`).join("")}</div></details>` : ""}
    <label class="check mt-s"><input type="checkbox" data-a="overwrite" ${i.overwrite ? "checked" : ""}> Replace questions that already exist (use this to correct answers – past scores are recalculated)</label>
    <div class="row mt-s"><button class="btn primary" data-a="doImport" ${ready ? "" : "disabled"}>Import ${ready} question${ready === 1 ? "" : "s"}${skipN ? ` (skipping ${skipN})` : ""}</button><button class="btn ghost" data-a="cancelImport">Cancel</button></div></div>`;
}
function runCheck(text, name) {
  const rows = parseCSV(text); if (!rows.length) { ui.imp = null; bus.render(); return toast("No rows found – is the first line the header?"); }
  const missing = ["question", "optiona", "optionb", "optionc", "optiond", "correctoption", "subject", "topic"].filter(k => !(k in rows[0])); if (missing.length) { ui.imp = null; bus.render(); return toast("Missing columns: " + missing.join(", ")); }
  const bank = E.dupMaps(), res = validateRows(rows, bank), papers = groupPapers(res.valid, res.errors);
  ui.imp = { name, rows, bank, res, papers, overwrite: false, skip: {}, createPapers: Object.fromEntries(papers.map(p => [p.key, true])) }; bus.render();
}
A.checkPaste = () => runCheck(ui.paste, "pasted text");
A.csv = async el => { const file = el.files[0]; if (!file) return; runCheck(await file.text(), file.name); el.value = ""; };
A.overwrite = (_, el) => { const i = ui.imp; i.overwrite = el.checked; i.res = validateRows(i.rows, i.bank, { overwrite: i.overwrite }); i.papers = groupPapers(i.res.valid, i.res.errors); i.createPapers = Object.fromEntries(i.papers.map(p => [p.key, i.createPapers[p.key] ?? true])); bus.render(); };
A.pcheck = (k, el) => { ui.imp.createPapers[k] = el.checked; };
A.simskip = (row, el) => { ui.imp.skip[Number(row)] = el.checked; bus.render(); };
A.skipSim = () => { ui.imp.res.similar.forEach(s => (ui.imp.skip[s.row] = true)); bus.render(); };
A.cancelImport = () => { ui.imp = null; bus.render(); };
A.copyPrompt = () => navigator.clipboard.writeText(aiPrompt()).then(() => toast("Prompt copied – paste it into Claude / ChatGPT with your PDF"));
A.rejected = () => download("rejected_rows.csv", toCSV(ui.imp.res.errors.map(e => ({ ...Object.fromEntries(HEADERS.map(h => [h, e.raw[h.toLowerCase()] ?? ""])), error: e.msg })), [...HEADERS, "error"]));
A.doImport = async () => {
  const i = ui.imp; if (!i) return; const rows = i.res.valid.filter(r => !i.skip[r._row]); if (!rows.length) return; toast(`Importing ${rows.length} questions…`);
  try {
    const papers = i.papers.filter(p => i.createPapers[p.key]).map(p => ({ ...p, rows: p.rows.filter(r => !i.skip[r._row]) })).filter(p => p.rows.length), r = await importQuestions(db, rows, { papers });
    let rec = 0; for (const c of r.changed) rec += await E.recalcAttempts(c.id, c.correct);
    ui.imp = null; toast(`✔ Imported ${r.n} questions${r.papers ? ` · ${r.papers} paper(s) added` : ""}${rec ? ` · ${rec} past score(s) recalculated` : ""}`); bus.render();
  } catch (e) { console.error(e); toast("Import failed: " + (e.code || e.message)); }
};
A.browse = async () => {
  const br = ui.browse; br.loading = true; bus.render();
  try { const w = [["subject", br.subject]]; if (br.topic) w.push(["topicId", br.topic]); br.list = await db.query("questions", w, 100); } catch (e) { toast("Load failed: " + (e.code || e.message)); }
  br.loading = false; bus.render();
};
const refresh = () => (ui.browse.list ? A.browse() : bus.render());
A.deactq = async id => { const [q] = await db.getMany("questions", [id]); await db.update("questions", id, { active: false }); if (q) await removeFromIndex(db, q.subject, id); refresh(); };
A.actq = async id => { const [q] = await db.getMany("questions", [id]); if (!q) return; await db.update("questions", id, { active: true }); const fp = fingerprint(q.question, q.options), cur = (await db.get("qindex", q.subject))?.items || [];
  await db.set("qindex", q.subject, { items: cur.filter(s => s.split("|")[0] !== id).concat(indexString({ id, topicId: q.topicId, difficulty: q.difficulty, year: q.year, tk: fp.tk, ok: fp.ok })) }); refresh(); };
A.delq = async id => { if (!confirm("Delete this question permanently? Past attempts keep their scores.")) return; const m = E.meta(id), [q] = m ? [] : await db.getMany("questions", [id]); await db.batchDelete([{ col: "questions", id }, { col: "answerKeys", id }]); const sub = m?.s || q?.subject; if (sub) await removeFromIndex(db, sub, id); delete E.cache.q[id]; delete E.cache.k[id]; refresh(); };
A.repdone = async id => { await db.update("reports", id, { status: "done" }); };
async function editor(id) {
  let q = null, k = null; if (id) { [q] = await db.getMany("questions", [id]); [k] = await db.getMany("answerKeys", [id]); if (!q) return toast("Question not found."); }
  const sub = q?.subject || "quant";
  bus.modal(`<h2>${q ? "Edit" : "Add"} question</h2><form id="mForm" class="form"><div class="form-grid"><label>Subject<select name="subject" class="input">${SUBJECTS.map(s => `<option value="${s.id}" ${s.id === sub ? "selected" : ""}>${s.name}</option>`).join("")}</select></label><label>Topic<select name="topicId" class="input"></select></label>
    <label>Difficulty<select name="difficulty" class="input"><option value="">–</option>${["easy", "medium", "hard"].map(d => `<option value="${d}" ${q?.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}</select></label><label>Year<input name="year" type="number" class="input" value="${esc(q?.year || "")}"></label></div>
    <label>Question<textarea name="question" class="input" rows="3" required>${esc(q?.question || "")}</textarea></label>${[0, 1, 2, 3].map(j => `<label>Option ${L[j]}<input name="o${j}" class="input" required value="${esc(q?.options?.[j] || "")}"></label>`).join("")}
    <label>Correct option<select name="correct" class="input">${[0, 1, 2, 3].map(j => `<option value="${j}" ${k?.correct === j ? "selected" : ""}>${L[j]}</option>`).join("")}</select></label>
    ${q ? `<label class="check"><input type="checkbox" name="recalc" checked> If the correct option changes, recalculate past scores</label>` : ""}
    <label>Explanation<textarea name="explanation" class="input" rows="3">${esc(k?.explanation || "")}</textarea></label><div class="form-grid"><label>Video link<input name="videoUrl" class="input" value="${esc(k?.videoUrl || "")}"></label><label>Image link<input name="imageUrl" class="input" value="${esc(q?.imageUrl || "")}"></label></div>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
  const fo = $("#mForm"), fill = () => (fo.topicId.innerHTML = SUBJECT_MAP[fo.subject.value].topics.map(t => `<option value="${t.id}" ${q?.topicId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")); fill(); fo.subject.onchange = fill;
  fo.onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(fo)), opts = [0, 1, 2, 3].map(j => v["o" + j].trim()); if (new Set(opts).size < 4) return toast("Options must all be different.");
    const okU = u => !u || /^https?:\/\/\S+$/i.test(u); if (!okU(v.videoUrl.trim()) || !okU(v.imageUrl.trim())) return toast("Links must start with http(s)://");
    const fp = fingerprint(v.question.trim(), opts);
    const row = { id: q?.id || "q" + fp.tk + Date.now().toString(36).slice(-4), subject: v.subject, topicId: v.topicId, difficulty: v.difficulty, year: v.year ? Number(v.year) : "", shift: q?.shift || "", examDate: q?.examDate || "", paperName: q?.paperName || "", paperKey: "", qno: q?.qno || 0, source: q?.source || "",
      question: v.question.trim(), options: opts, imageUrl: v.imageUrl.trim(), correct: Number(v.correct), explanation: v.explanation.trim(), videoUrl: v.videoUrl.trim(), tk: fp.tk, ok: fp.ok };
    try { const r = await importQuestions(db, [row]); if (q && q.subject !== row.subject) await removeFromIndex(db, q.subject, q.id); delete E.cache.q[row.id]; delete E.cache.k[row.id];
      let msg = "Saved ✔"; if (r.changed.length && v.recalc) msg += ` · ${await E.recalcAttempts(row.id, row.correct)} past score(s) recalculated`; bus.closeModal(); toast(msg); refresh(); } catch (err) { toast("Save failed: " + (err.code || err.message)); }
  };
}
A.editq = id => editor(id); A.newq = () => editor(null);

// ---------- papers ----------
function papersTab() {
  const list = [...S.papers].sort((a, b) => (b.examDate || String(b.year)).localeCompare(a.examDate || String(a.year)) || String(a.shift).localeCompare(String(b.shift))), e = ui.pedit;
  const plan = e ? timerPlan(e, e.groups) : null;
  const editor = e ? `<section class="card editor"><h2>Edit paper</h2><div class="form-grid"><label>Title${f.text("pedit.title", 'maxlength="120"')}</label><label>Marks: correct / wrong<div class="row">${f.num("pedit.pos", 'step="0.25" min="0"')}${f.num("pedit.neg", 'step="0.25" min="0"')}</div></label><label>Exam attempts per student (0 = unlimited)${f.num("pedit.maxAttempts", 'min="0" max="50"')}</label></div>
      <div class="timer-form"><label>Timer<div class="rg">${f.radio("pedit.timerType", "none", "No timer")}${f.radio("pedit.timerType", "paper", "Whole paper")}${f.radio("pedit.timerType", "section", "Per section")}</div></label>
        ${e.timerType === "paper" ? `<div class="form-grid"><label>Paper time<div class="rg">${f.radio("pedit.paperMode", "auto", "Auto (per question)")}${f.radio("pedit.paperMode", "manual", "Manual")}</div></label>${e.paperMode === "manual" ? `<label>Total minutes${f.num("pedit.manualMin", 'min="1" max="300" data-rerender')}</label>` : `<label>Seconds per question${f.num("pedit.secPerQ", 'min="5" max="600" data-rerender')}</label>`}</div>` : ""}
        ${e.timerType === "section" ? `<table class="list"><tr><th>Section</th><th>Qs</th><th>Minutes <small class="muted">(blank = auto)</small></th><th>Final</th></tr>${plan.sections.map(s => `<tr><td>${E.subjIcon(s.sub)} ${esc(E.subjName(s.sub))}</td><td>${s.n}</td><td>${f.num("pedit.minBySub." + s.sub, `min="0" max="300" step="0.5" placeholder="${(s.sec / 60).toFixed(1)}" data-rerender`)}</td><td><b>${fm(s.sec)}</b>${s.manual ? " ✎" : ""}</td></tr>`).join("")}</table>` : ""}
        <div class="sum">⏱ ${plan.type === "none" ? "No timer" : plan.type === "paper" ? `Whole paper: <b>${fm(plan.durationSec)}</b>` : `Total <b>${fm(plan.durationSec)}</b> – a section locks when its time ends`}</div></div>
      <h3>Exam window <small class="muted">(optional – for a group test)</small></h3><div class="form-grid"><label>Opens${f.dt("pedit.availableFrom")}</label><label>Closes${f.dt("pedit.availableUntil")}</label></div>
      <div class="rg">${f.check("pedit.published", "Published (visible to students)")}</div><p class="small muted">Questions and their order are fixed so everyone gets the same paper. Re-import the CSV to change them.</p>
      <div class="row"><button class="btn primary" data-a="savePaper">Save</button><button class="btn ghost" data-a="cancelPaper">Cancel</button></div></section>` : "";
  return `${editor}<section class="card"><h2>Papers (${list.length})</h2><p class="small muted">Papers are created automatically when you import a CSV with paperName + examDate + shift.</p>
    <div class="table-wrap"><table class="list"><tr><th>Paper</th><th>Timer</th><th>Attempts</th><th>Window</th><th>Status</th><th></th></tr>${list.map(p => { const pl = E.planOf(p); return `<tr><td><b>${esc(p.title)}</b><div class="small muted">${p.total} questions</div></td><td class="small">${pl.type === "none" ? "none" : (pl.type === "section" ? "sections " : "") + fm(pl.durationSec)}</td><td>${p.maxAttempts || "∞"}</td><td class="small">${p.availableFrom || p.availableUntil ? `${p.availableFrom ? fmtDateTime(p.availableFrom) : "—"} → ${p.availableUntil ? fmtDateTime(p.availableUntil) : "—"}` : "always open"}</td>
      <td>${p.published ? `<span class="chip ok">Published</span>` : `<span class="chip low">Draft</span>`}</td><td><div class="row"><button class="btn sm" data-a="editPaper:${p.id}">Edit</button><button class="btn sm" data-a="pubPaper:${p.id}">${p.published ? "Unpublish" : "Publish"}</button><button class="btn sm ghost danger" data-a="delPaper:${p.id}">Delete</button></div></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">No papers yet – import a CSV first.</td></tr>`}</table></div></section>`;
}
A.editPaper = id => { const p = S.papers.find(x => x.id === id); if (!p) return; ui.pedit = { id, title: p.title, timerType: p.timerType || "section", paperMode: p.paperMode || "auto", secPerQ: p.secPerQ || 45, manualMin: p.manualMin || 60, minBySub: { ...(p.minBySub || {}) }, pos: p.pos ?? 2, neg: p.neg ?? 0.5, maxAttempts: p.maxAttempts || 0, published: p.published !== false, availableFrom: toLocalInput(p.availableFrom), availableUntil: toLocalInput(p.availableUntil), groups: E.groupsOf(p) }; bus.render(); window.scrollTo(0, 0); };
A.cancelPaper = () => { ui.pedit = null; bus.render(); };
A.savePaper = async () => {
  const e = ui.pedit; if (!e) return; if (!(Number(e.pos) > 0)) return toast("Marks per correct answer must be above 0."); const from = fromLocalInput(e.availableFrom), until = fromLocalInput(e.availableUntil); if (from && until && until <= from) return toast("Closing time must be after opening time.");
  const mins = Object.fromEntries(Object.entries(e.minBySub || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
  try { await db.update("papers", e.id, { title: (e.title || "").trim() || "Paper", timerType: e.timerType, paperMode: e.paperMode, secPerQ: Number(e.secPerQ) || 45, manualMin: Number(e.manualMin) || 0, minBySub: mins, pos: Number(e.pos), neg: Number(e.neg) || 0, maxAttempts: Math.max(0, Math.round(Number(e.maxAttempts) || 0)), published: !!e.published, availableFrom: from, availableUntil: until }); ui.pedit = null; toast("Saved ✔"); bus.render(); } catch (err) { toast("Save failed: " + (err.code || err.message)); }
};
A.pubPaper = async id => { const p = S.papers.find(x => x.id === id); await db.update("papers", id, { published: !p.published }); };
A.delPaper = async id => { if (confirm("Delete this paper? The questions stay in the bank; past attempts keep their results.")) await db.remove("papers", id); };

// ---------- backup ----------
function backupTab() {
  return `<section class="card"><h2>Backup &amp; export</h2><p class="muted small">Files download to your computer. Reading the whole bank costs about 2 reads per question (free limit: 50,000/day).</p><div class="grid cards">
    <div class="card"><h3>Question bank (CSV)</h3><p class="small muted">Every question with answer and explanation – you can re-import it here.</p><button class="btn primary" data-a="expQ">Download</button></div>
    <div class="card"><h3>Attempts (CSV)</h3><p class="small muted">Everyone's scores, accuracy, time, date.</p><button class="btn primary" data-a="expAtt">Download</button></div>
    <div class="card"><h3>Everything (JSON)</h3><p class="small muted">All data. Passwords are never included – they aren't stored in the database.</p><button class="btn primary" data-a="expAll">Download</button></div></div></section>`;
}
A.expQ = async () => {
  toast("Reading the question bank…"); const [qs, ks] = await Promise.all([db.all("questions"), db.all("answerKeys")]), km = Object.fromEntries(ks.map(k => [k.id, k]));
  const rows = qs.map(q => { const k = km[q.id] || {}; return { questionId: q.id, paperName: q.paperName || "", examDate: q.examDate || "", year: q.year || "", shift: q.shift || "", qno: q.qno || "", subject: SUBJECT_MAP[q.subject]?.short || q.subject, topic: TOPIC_MAP[q.topicId]?.name || q.topicId,
    difficulty: q.difficulty ? q.difficulty[0].toUpperCase() + q.difficulty.slice(1) : "", question: q.question, optionA: q.options?.[0], optionB: q.options?.[1], optionC: q.options?.[2], optionD: q.options?.[3], correctOption: L[k.correct] || "", explanation: k.explanation || "", videoLink: k.videoUrl || "", imageUrl: q.imageUrl || "", source: q.source || "" }; });
  download(`question_bank_${dayKey()}.csv`, toCSV(rows, HEADERS)); toast(`Exported ${rows.length} questions ✔`);
};
A.expAtt = async () => {
  const at = await db.all("attempts"); download(`attempts_${dayKey()}.csv`, toCSV(at.map(a => ({ student: S.members.find(m => m.uid === a.uid)?.name || a.uid, title: a.title, mode: a.mode, status: a.status, date: dayKey(a.submittedAt || a.startedAt), score: a.result?.score ?? "", max: a.result?.max ?? "", percent: a.result?.percent ?? "", accuracy: a.result?.accuracy ?? "", timeSec: a.result?.timeUsed ?? "" })), ["student", "title", "mode", "status", "date", "score", "max", "percent", "accuracy", "timeSec"])); toast("Exported ✔");
};
A.expAll = async () => {
  const out = { exportedAt: new Date().toISOString() }; for (const c of ["members", "progress", "questions", "answerKeys", "qindex", "papers", "attempts", "mistakes", "bookmarks", "reports", "resources", "drives", "logs", "notices"]) { toast(`Backing up ${c}…`); try { out[c] = await db.all(c); } catch (e) { out[c] = { error: e.code || e.message }; } }
  download(`cgl_hub_backup_${dayKey()}.json`, JSON.stringify(out), "application/json"); toast("Backup downloaded ✔");
};
