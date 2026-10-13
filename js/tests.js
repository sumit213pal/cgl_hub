// Test system entry point. app.js calls createTests(ctx) once and uses the returned API.
import { SUBJECTS, SUBJECT_MAP } from "./syllabus.js";
import { initEngine } from "./t_engine.js";
import { initRunner } from "./t_runner.js";
import { initViews } from "./t_views.js";
import { initNotebook } from "./t_notebook.js";
import { initAdmin } from "./t_admin.js";
import { initExtra } from "./t_extra.js";
import { getPath, setPath, DEFAULT_SEC, weekStart } from "./t_util.js";

export function createTests(ctx) {
  const X = { ...ctx };
  X.act = {};
  const { $, esc } = X;
  X.st = {
    testTab: "papers", pf: { year: "", shift: "", tier: "", status: "" }, hist: { kind: "", mode: "" }, histOpen: {},
    gen: { source: "random", subject: "", topic: "", diff: "", count: 20, timerMode: "auto", secPerQ: 45, manualMin: 20, pos: 2, neg: 0.5, shuffleOpt: false, learning: false },
    start: null, draft: null, imp: null, paste: "", browse: { subject: "quant", topic: "", status: "", list: null, loading: false }, pedit: null,
    review: {}, exp: {}, open: {}, noteOpen: {}, nbTab: "mistakes", nbStatus: "unresolved", anSubject: "", anTopic: "", anLearning: false,
    tgt: { week: weekStart(), title: "", subject: "quant", sel: {} }, vault: { subject: "", topic: "", kind: "", add: { subject: "quant", topic: "", kind: "formula", title: "", text: "", url: "" } },
    ca: { year: new Date().getFullYear(), add: { month: new Date().getMonth() + 1, title: "", url: "", note: "" } }, heatUser: ""
  };
  const { st } = X;

  // ---- language preference (English / Hindi / both) ----
  X.langGet = () => localStorage.getItem("cgl-lang") || "en";
  X.langSet = v => localStorage.setItem("cgl-lang", v);
  X.qHtml = q => { const lg = X.langGet(); if (lg === "hi" && q.qHi) return esc(q.qHi); if (lg === "both" && q.qHi) return `${esc(q.question)}<div class="hi">${esc(q.qHi)}</div>`; return esc(q.question); };
  X.oHtml = (q, j) => { const lg = X.langGet(), hi = q.optionsHi?.[j]; if (lg === "hi" && hi) return esc(hi); if (lg === "both" && hi) return `${esc(q.options[j])}<div class="hi">${esc(hi)}</div>`; return esc(q.options[j]); };

  // ---- form-field builders bound to the `st` state object ----
  const val = p => getPath(st, p);
  X.ui = {
    num: (p, extra = "") => `<input class="input" type="number" data-bind="${p}" value="${esc(val(p) ?? "")}" ${extra}>`,
    text: (p, extra = "") => `<input class="input" data-bind="${p}" value="${esc(val(p) ?? "")}" ${extra}>`,
    area: (p, extra = "") => `<textarea class="input" data-bind="${p}" ${extra}>${esc(val(p) ?? "")}</textarea>`,
    dt: (p, extra = "") => `<input class="input" type="datetime-local" data-bind="${p}" value="${esc(val(p) ?? "")}" ${extra}>`,
    select: (p, opts, extra = "") => `<select class="input" data-bind="${p}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val(p) ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`,
    radio: (p, v, label, extra = "data-rerender") => `<label class="radio"><input type="radio" name="${p}" data-bind="${p}" ${extra} value="${esc(v)}" ${val(p) === v ? "checked" : ""}> ${label}</label>`,
    check: (p, label, extra = "") => `<label class="check"><input type="checkbox" data-bind="${p}" ${val(p) ? "checked" : ""} ${extra}> ${label}</label>`
  };
  X.subjectOpts = (all = "All subjects") => [["", all], ...SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`])];
  X.topicOpts = (subject, all = "All topics") => !subject ? [["", all]] : [["", all], ...SUBJECT_MAP[subject].topics.map(t => [t.id, `${t.name} (${X.scope({ topic: t.id }).length})`])];
  X.showModal = html => { X.modal(html); X.wire($("#modalBox")); };

  /** timer configuration form (none / whole paper / per-section) bound to st[prefix]; subs = subject ids shown for section timers */
  X.timerForm = (prefix, groups, total) => {
    const ui = X.ui, c = st[prefix]; c._subs = groups.map(g => g.sub); const plan = X.planOfCfg(c, groups);
    return `<div class="timer-form">
      <label>Timer<div class="rg">${ui.radio(prefix + ".timerType", "none", "No timer")}${ui.radio(prefix + ".timerType", "paper", "Complete-paper timer")}${ui.radio(prefix + ".timerType", "section", "Section-wise timers")}</div></label>
      ${c.timerType === "paper" ? `<div class="form-grid"><label>Paper time<div class="rg">${ui.radio(prefix + ".paperMode", "auto", "Auto (per question)")}${ui.radio(prefix + ".paperMode", "manual", "Manual")}</div></label>
        ${c.paperMode === "manual" ? `<label>Total minutes${ui.num(prefix + ".manualMin", 'min="1" max="300" data-rerender')}</label>` : `<label>Seconds per question${ui.num(prefix + ".secPerQ", 'min="5" max="600" data-rerender')}</label>`}</div>` : ""}
      ${c.timerType === "section" ? `<div class="sec-grid"><div class="sg-h"><b>Section</b><b>Qs</b><b>Seconds / question</b><b>Manual minutes (overrides)</b><b>Final time</b></div>
        ${plan.sections.map(s => `<div class="sg-r"><span>${X.subjIcon(s.sub)} ${esc(X.subjName(s.sub))}</span><span>${s.n}</span>
          <span>${ui.num(`${prefix}.secBySub.${s.sub}`, 'min="5" max="600" data-rerender')}</span><span>${ui.num(`${prefix}.minBySub.${s.sub}`, 'min="0" max="300" step="0.5" placeholder="auto" data-rerender')}</span><b>${X.fmtMin(s.sec)}${s.manual ? " ✎" : ""}</b></div>`).join("")}</div>
        <div class="row mt-s"><button class="btn sm" type="button" data-t="tpreset:${prefix}:defaults">Per-subject defaults</button>
          <button class="btn sm" type="button" data-t="tpreset:${prefix}:equal">Equal split of</button>${ui.num(prefix + ".equalTotal", 'min="5" max="300" style="width:80px"')}<span class="small muted">min</span>
          <button class="btn sm" type="button" data-t="tpreset:${prefix}:load">Load my saved preset</button><button class="btn sm" type="button" data-t="tpreset:${prefix}:save">Save as my preset</button></div>` : ""}
      <div class="gen-sum">⏱ ${plan.type === "none" ? "No timer" : plan.type === "paper" ? `Whole paper: <b>${X.fmtMin(plan.durationSec)}</b>` : `Sections total <b>${X.fmtMin(plan.durationSec)}</b> – each section is locked when its time ends`}${total ? ` · ${total} questions` : ""}</div></div>`;
  };
  X.fmtMin = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m ${r}s` : `${m}m`; };
  X.act.tpreset = (arg) => {
    const [prefix, kind] = arg.split(":"), c = st[prefix], subs = c._subs || [];
    if (kind === "defaults") { c.secBySub = { ...DEFAULT_SEC }; c.minBySub = {}; }
    else if (kind === "equal") { const each = Math.round(((Number(c.equalTotal) || 60) / Math.max(1, subs.length)) * 2) / 2; c.minBySub = Object.fromEntries(subs.map(s => [s, each])); }
    else if (kind === "save") { X.db.set("progress", X.S.me.uid, { prefs: { timerPreset: { secBySub: c.secBySub || {}, minBySub: c.minBySub || {} } } }).then(() => X.toast("Preset saved ✔")); return; }
    else if (kind === "load") { const p = X.S.progress[X.S.me.uid]?.prefs?.timerPreset; if (!p) return X.toast("No saved preset yet."); c.secBySub = { ...DEFAULT_SEC, ...(p.secBySub || {}) }; c.minBySub = { ...(p.minBySub || {}) }; }
    X.rerender();
  };

  initEngine(X);
  initRunner(X);
  initViews(X);
  initNotebook(X);
  initAdmin(X);
  initExtra(X);
  st.draft = X.newDraft();

  const onBound = path => {
    let m;
    if (path === "gen.subject") st.gen.topic = "";
    else if (path === "browse.subject") st.browse.topic = "";
    else if (path === "vault.subject") st.vault.topic = "";
    else if (path === "vault.add.subject") st.vault.add.topic = "";
    else if (path === "tgt.subject") { /* keep selection across subjects */ }
    else if ((m = path.match(/^draft\.rows\.(\d+)\.subject$/))) st.draft.rows[Number(m[1])].topic = "";
  };

  // generic click / change / file wiring for [data-t], [data-tchange], [data-tfile], [data-bind]
  X.wire = root => {
    root.querySelectorAll("[data-bind]").forEach(el => {
      const path = el.dataset.bind, isChoice = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio";
      el[isChoice ? "onchange" : "oninput"] = () => {
        if (el.type === "radio" && !el.checked) return;
        const v = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
        setPath(st, path, v); onBound(path);
        if (el.hasAttribute("data-remodal")) X.reopen?.(); else if (el.hasAttribute("data-rerender")) X.rerender();
      };
    });
    root.querySelectorAll("[data-t]").forEach(el => {
      el.onclick = e => {
        if (el.disabled) return;
        const [act, ...rest] = el.dataset.t.split(":"), fn = X.act[act]; if (!fn) return;
        if (el.type !== "checkbox") e.preventDefault();
        Promise.resolve(fn(rest.join(":"), el)).catch(err => { console.error(err); X.toast("Something went wrong: " + (err.code || err.message)); });
      };
    });
    root.querySelectorAll("[data-tchange]").forEach(el => {
      el.onchange = () => { const [act, ...rest] = el.dataset.tchange.split(":"); Promise.resolve(X.act[act]?.(rest.join(":"), el)).catch(err => X.toast(err.message)); };
    });
    root.querySelectorAll("[data-tfile]").forEach(el => { el.onchange = () => X.act[el.dataset.tfile]?.(el); });
  };

  return {
    views: { tests: X.viewTests, result: X.viewResult, notebook: X.viewNotebook, analytics: X.viewAnalytics, vault: X.viewVault, ca: X.viewCA },
    admin: { qbank: X.viewQBank, papers: X.viewAdminPapers, tests: X.viewAdminTests, reports: X.viewReports, targets: X.viewTargets, backup: X.viewBackup },
    coachCard: X.coachCard, targetsCard: X.targetsCard, pulseCard: X.pulseCard, expertsCard: X.expertsCard, heatmap: X.heatmap, vaultForTopic: X.vaultForTopic, voteBtn: X.voteBtn,
    wire: X.wire, isRunning: X.isRunning, onAttempts: X.onAttempts, X
  };
}
