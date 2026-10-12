// Test system entry point. app.js calls createTests(ctx) once and uses the returned API.
import { initEngine } from "./t_engine.js";
import { initRunner } from "./t_runner.js";
import { initViews } from "./t_views.js";
import { initAdmin } from "./t_admin.js";
import { getPath, setPath } from "./t_util.js";

export function createTests(ctx) {
  const X = { ...ctx };
  X.st = {
    gen: { source: "random", subject: "", topic: "", diff: "", count: 20, timerMode: "auto", secPerQ: 45, manualMin: 20, pos: 2, neg: 0.5, shuffleOpt: false },
    draft: null, imp: null, paste: "", browse: { subject: "quant", topic: "", list: null, loading: false },
    review: {}, exp: {}, open: {}, nbTab: "mistakes", nbStatus: "unresolved", anSubject: ""
  };
  X.showModal = html => { X.modal(html); X.wire($("#modalBox")); };
  const { st, $ } = X;

  initEngine(X);
  initRunner(X);
  initViews(X);
  initAdmin(X);
  st.draft = X.newDraft();

  // when a bound value changes, keep dependent fields valid
  const onBound = path => {
    let m;
    if (path === "gen.subject") st.gen.topic = "";
    else if (path === "browse.subject") st.browse.topic = "";
    else if ((m = path.match(/^draft\.rows\.(\d+)\.subject$/))) st.draft.rows[Number(m[1])].topic = "";
  };

  // generic click / change / file wiring for [data-t], [data-tchange], [data-tfile], [data-bind]
  X.wire = root => {
    root.querySelectorAll("[data-bind]").forEach(el => {
      const path = el.dataset.bind;
      const isChoice = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio";
      el[isChoice ? "onchange" : "oninput"] = () => {
        let v = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
        if (el.type === "radio" && !el.checked) return;
        setPath(st, path, v); onBound(path);
        if (el.hasAttribute("data-rerender")) X.rerender();
      };
    });
    root.querySelectorAll("[data-t]").forEach(el => {
      el.onclick = e => {
        if (el.disabled) return;
        const [act, ...rest] = el.dataset.t.split(":");
        const fn = X.act[act]; if (!fn) return;
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
    views: { tests: X.viewTests, result: X.viewResult, notebook: X.viewNotebook, analytics: X.viewAnalytics },
    viewQBank: X.viewQBank, viewAdminTests: X.viewAdminTests, viewReports: X.viewReports,
    coachCard: X.coachCard, wire: X.wire, isRunning: X.isRunning, onAttempts: X.onAttempts, X
  };
}
