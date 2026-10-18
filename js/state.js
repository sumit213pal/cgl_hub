// Shared state + tiny form helpers. Modules import from here instead of passing context around.
import { esc } from "./util.js";
export const S = { me: null, route: "home", arg: "", members: [], progress: {}, resources: [], drives: [], logs: [], notices: [], qindex: [], papers: [], attempts: [], mistakes: [], bookmarks: [], reports: [] };
export const ui = {
  testTab: "papers", pf: { year: "", shift: "" }, hist: "",
  gen: { source: "random", subject: "", topic: "", diff: "", count: 15, timer: "auto", sec: 45, min: 15, learn: false },
  mini: { quant: 8, reasoning: 7, english: 5, ga: 5 },
  start: null, imp: null, paste: "", browse: { subject: "quant", topic: "", list: null, loading: false }, pedit: null,
  review: {}, exp: {}, open: {}, nbTab: "mistakes", nbShow: "open", progSubject: "",
  subject: "quant", filter: "all", search: "", lib: { type: "", subject: "", q: "" }, openTopic: null, adminTab: "members", noticeText: ""
};
export const bus = { render() {}, toast() {}, modal() {}, closeModal() {}, openRunner() {}, closeRunner() {}, runnerState() { return null; }, isRunning() { return false; }, wireModal() {} };
export const toast = m => bus.toast(m);
export const A = {};                       // actions: <button data-a="name:arg"> → A.name(arg, element)
export const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
export const setPath = (o, p, v) => { const ks = p.split("."); let x = o; ks.slice(0, -1).forEach(k => (x = x[k] ??= {})); x[ks.at(-1)] = v; };
const val = p => getPath(ui, p);
export const f = {
  num: (p, x = "") => `<input class="input" type="number" data-bind="${p}" value="${esc(val(p) ?? "")}" ${x}>`,
  text: (p, x = "") => `<input class="input" data-bind="${p}" value="${esc(val(p) ?? "")}" ${x}>`,
  area: (p, x = "") => `<textarea class="input" data-bind="${p}" ${x}>${esc(val(p) ?? "")}</textarea>`,
  dt: (p, x = "") => `<input class="input" type="datetime-local" data-bind="${p}" value="${esc(val(p) ?? "")}" ${x}>`,
  select: (p, opts, x = "") => `<select class="input" data-bind="${p}" ${x}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val(p) ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`,
  radio: (p, v, label, x = "data-rerender") => `<label class="radio"><input type="radio" name="${p}" data-bind="${p}" ${x} value="${esc(v)}" ${val(p) === v ? "checked" : ""}> ${label}</label>`,
  check: (p, label, x = "") => `<label class="check"><input type="checkbox" data-bind="${p}" ${val(p) ? "checked" : ""} ${x}> ${label}</label>`
};
