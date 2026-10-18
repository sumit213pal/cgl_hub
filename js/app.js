import db, { isDemo } from "./db.js";
import { ADMIN_EMAIL, GROUP_NAME } from "./config.js";
import { S, ui, bus, toast, A, setPath } from "./state.js";
import { esc, isUrl } from "./util.js";
import "./runner.js";
import * as E from "./engine.js";
import * as P from "./pages.js";
import { viewAdmin, addMember } from "./admin.js";
import { avatar, pct } from "./people.js";

const $ = s => document.querySelector(s);
const AUTH_ERR = { "auth/invalid-credential": "Wrong email or password.", "auth/wrong-password": "Wrong password.", "auth/user-not-found": "Wrong email or password.", "auth/invalid-email": "That email address doesn't look right.",
  "auth/too-many-requests": "Too many attempts – wait a few minutes.", "auth/weak-password": "Password too weak – use 8+ characters.", "auth/network-request-failed": "Network error – check your internet.", "permission-denied": "You don't have permission for this." };
const errMsg = e => AUTH_ERR[e?.code] || e?.message || "Something went wrong.";
const screen = n => ["loading", "login", "pwScreen", "app"].forEach(id => $("#" + id).classList.toggle("hidden", id !== n));
const unsub = [];

// ---------- shared UI hooks ----------
bus.toast = m => { if (!m) return; const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(bus.tt); bus.tt = setTimeout(() => t.classList.remove("show"), 2600); };
bus.modal = html => { $("#modalBox").innerHTML = html; $("#modal").classList.remove("hidden"); wire($("#modalBox")); };
bus.closeModal = () => { $("#modal").classList.add("hidden"); $("#modalBox").innerHTML = ""; };
bus.wireModal = () => wire($("#modalBox"));
bus.render = () => render();

// ---------- login ----------
$("#loginTitle").textContent = GROUP_NAME; $("#brandName").textContent = GROUP_NAME;
if (isDemo) { $("#demoBanner").classList.remove("hidden"); $("#demoHint").classList.remove("hidden"); }
const loginMsg = (t, ok) => { const m = $("#loginMsg"); m.textContent = t; m.classList.toggle("ok", !!ok); };
$("#loginForm").onsubmit = async e => { e.preventDefault(); loginMsg(""); const b = $("#btnLogin"); b.disabled = true; b.textContent = "Logging in…";
  try { await db.signIn($("#loginEmail").value.trim().toLowerCase(), $("#loginPw").value); } catch (err) { loginMsg(errMsg(err)); } finally { b.disabled = false; b.textContent = "Log in"; } };
$("#forgot").onclick = async () => { const em = $("#loginEmail").value.trim().toLowerCase(); if (!em) return loginMsg("Type your email above first.");
  try { await db.resetPassword(em); loginMsg("If this email has access, a reset link was sent (check spam).", true); } catch (err) { loginMsg(errMsg(err)); } };
$("#pwLogout").onclick = () => db.signOut();

db.onAuth(async user => {
  unsub.splice(0).forEach(f => f && f()); ui.openTopic = null; $("#drawer").classList.add("hidden"); bus.closeModal(); bus.closeRunner();
  if (!user) { S.me = null; screen("login"); return; }
  try {
    let m = await db.get("members", user.email); const isAdminEmail = user.email === ADMIN_EMAIL.toLowerCase();
    if (!m && isAdminEmail) { await db.set("members", user.email, { name: "Admin", role: "admin", active: true, uid: user.uid, mustChangePassword: false, createdAt: Date.now() }); m = await db.get("members", user.email); }
    if (!m || m.active === false) { await db.signOut(); loginMsg(m ? "Your access has been disabled. Contact the admin." : "This account has no access. Ask the admin to add you."); return; }
    S.me = { uid: user.uid, email: user.email, name: m.name, isAdmin: m.role === "admin" || isAdminEmail };
    await db.set("members", user.email, { uid: user.uid, lastSeen: Date.now() });
    if (m.mustChangePassword) return showPwScreen(); startApp();
  } catch (err) { console.error(err); await db.signOut(); loginMsg(errMsg(err)); }
});
function showPwScreen() {
  screen("pwScreen"); $("#pwName").textContent = S.me.name; const msg = $("#pwMsg"); msg.textContent = "";
  $("#pwForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    if (v.p1.length < 8) return (msg.textContent = "Use at least 8 characters."); if (v.p1 !== v.p2) return (msg.textContent = "The new passwords don't match."); if (v.p1 === v.cur) return (msg.textContent = "Choose a different password from the temporary one.");
    try { await db.changePassword(v.p1, v.cur); await db.set("members", S.me.email, { mustChangePassword: false }); e.target.reset(); startApp(); } catch (err) { msg.textContent = errMsg(err); } };
}
function startApp() {
  screen("app"); $("#navAdmin").classList.toggle("hidden", !S.me.isAdmin);
  const bind = (col, fn) => unsub.push(db.watch(col, fn)), mine = (col, fn) => unsub.push(db.watchWhere(col, "uid", S.me.uid, fn)), byNew = d => d.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  bind("members", d => { S.members = d; const me = d.find(m => m.id === S.me.email); if (me && me.active === false) { db.signOut(); loginMsg("Your access has been disabled. Contact the admin."); return; } if (me) S.me.name = me.name; refresh(); });
  bind("progress", d => { S.progress = Object.fromEntries(d.map(x => [x.id, x])); refresh(); });
  ["resources", "drives", "logs", "papers"].forEach(c => bind(c, d => { S[c] = byNew(d); refresh(); }));
  ["notices", "qindex", "reports"].forEach(c => bind(c, d => { S[c] = d; refresh(); }));
  mine("attempts", d => { S.attempts = byNew(d); E.onAttempts(); refresh(); }); mine("mistakes", d => { S.mistakes = d; refresh(); }); mine("bookmarks", d => { S.bookmarks = d; refresh(); });
  route();
}

// ---------- routing + render ----------
window.addEventListener("hashchange", route);
function route() { const p = (location.hash.slice(1) || "home").split("/"); S.route = p[0]; S.arg = p[1] || ""; if (S.route === "admin" && !S.me?.isAdmin) S.route = "home";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === (S.route === "result" ? "tests" : S.route))); window.scrollTo(0, 0); render(); }
let raf; function refresh() { if (bus.isRunning()) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); if (ui.openTopic) { P.drawerBody(); wire($("#drawerBody")); } }); }
const VIEWS = { home: P.viewHome, tests: P.viewTests, result: P.viewResult, mistakes: P.viewMistakes, progress: P.viewProgress, syllabus: P.viewSyllabus, library: P.viewLibrary, admin: viewAdmin };
function render() {
  if (!S.me || $("#app").classList.contains("hidden")) return;
  $("#me").innerHTML = `${avatar(S.me.uid)} <span class="grow">${esc(S.me.name.split(" ")[0])}</span><button class="btn ghost sm" data-a="changePw" title="Change password">🔑</button><button class="btn ghost sm" data-a="logout">Log out</button>`; wire($("#me"));
  const main = $("#main"), saved = {}, act = document.activeElement; main.querySelectorAll("form[id] [name]").forEach(el => (saved[el.form.id + "|" + el.name] = el.value));
  const inMain = act && main.contains(act), key = inMain && act.dataset?.bind && !["radio", "checkbox"].includes(act.type) ? "bind:" + act.dataset.bind : inMain && act.form?.id ? act.form.id + "|" + act.name : inMain && act.id ? "#" + act.id : null, caret = inMain && act.selectionStart !== undefined ? act.selectionStart : null, y = window.scrollY;
  main.innerHTML = (VIEWS[S.route] || P.viewHome)();
  main.querySelectorAll("form[id] [name]").forEach(el => { const k = el.form.id + "|" + el.name; if (k in saved) el.value = saved[k]; });
  if (key) { const el = key.startsWith("bind:") ? main.querySelector(`[data-bind="${key.slice(5)}"]`) : key.startsWith("#") ? main.querySelector(key) : main.querySelector(`#${key.split("|")[0]} [name="${key.split("|")[1]}"]`); if (el) { el.focus(); try { const p = caret ?? el.value.length; el.setSelectionRange(p, p); } catch { /* number/date inputs */ } } }
  wire(main); window.scrollTo(0, y);
}

// ---------- event wiring ----------
const onBound = path => { if (path === "gen.subject") ui.gen.topic = ""; else if (path === "browse.subject") ui.browse.topic = ""; };
function wire(root) {
  root.querySelectorAll("[data-bind]").forEach(el => { const path = el.dataset.bind, choice = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio";
    el[choice ? "onchange" : "oninput"] = () => { if (el.type === "radio" && !el.checked) return; setPath(ui, path, el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value); onBound(path);
      if (el.hasAttribute("data-remodal")) A.reopen?.(); else if (el.hasAttribute("data-rerender")) render(); }; });
  root.querySelectorAll("[data-a]").forEach(el => { const run = e => { if (el.disabled) return; if (el.type !== "checkbox") e.preventDefault(); const i = el.dataset.a.indexOf(":"), name = i < 0 ? el.dataset.a : el.dataset.a.slice(0, i), arg = i < 0 ? "" : el.dataset.a.slice(i + 1);
      Promise.resolve(A[name]?.(arg, el)).catch(err => { console.error(err); toast("Something went wrong: " + (err.code || err.message)); }); };
    if (el.type === "checkbox") el.onchange = run; else el.onclick = run; });
  root.querySelectorAll("[data-file]").forEach(el => (el.onchange = () => A[el.dataset.file]?.(el)));
  root.querySelectorAll("[data-subject]").forEach(b => (b.onclick = e => { ui.subject = b.dataset.subject; render(); }));
  root.querySelectorAll("[data-topic]").forEach(b => (b.onclick = () => P.openTopic(b.dataset.topic)));
  root.querySelectorAll("[data-status]").forEach(s => (s.onchange = () => db.set("progress", S.me.uid, { topics: { [s.dataset.status]: s.value }, updatedAt: Date.now() })));
  root.querySelectorAll("[data-del]").forEach(b => (b.onclick = async () => { if (!confirm("Delete this?")) return; const [col, id] = b.dataset.del.split(":"); try { await db.remove(col, id); } catch (err) { toast(errMsg(err)); } }));
  root.querySelectorAll("[data-play]").forEach(b => (b.onclick = () => bus.modal(`<div class="row"><b class="grow">${esc(b.dataset.title)}</b><button class="x big" data-close="modal">✕</button></div><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${b.dataset.play}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`)));
  root.querySelectorAll("[data-preview]").forEach(b => (b.onclick = () => bus.modal(`<div class="row"><b class="grow">${esc(b.dataset.title)}</b><button class="x big" data-close="modal">✕</button></div><div class="video doc"><iframe src="${esc(b.dataset.preview)}" allow="autoplay"></iframe></div>`)));
  const inp = (id, fn, deb) => { const el = root.querySelector("#" + id); if (!el) return; let tm; el[deb ? "oninput" : "onchange"] = () => { clearTimeout(tm); tm = setTimeout(() => { fn(el.value); render(); }, deb ? 250 : 0); }; };
  inp("search", v => (ui.search = v), true); inp("filter", v => (ui.filter = v)); inp("libq", v => (ui.lib.q = v), true);
  const am = root.querySelector("#addMember"); if (am) am.onsubmit = e => { e.preventDefault(); addMember(am); };
}
document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (!c) return; if (c.dataset.close === "modal") bus.closeModal(); if (c.dataset.close === "drawer") { $("#drawer").classList.add("hidden"); ui.openTopic = null; } });
document.addEventListener("keydown", e => { if (e.key !== "Escape" || bus.isRunning()) return; if (!$("#modal").classList.contains("hidden")) bus.closeModal(); else { $("#drawer").classList.add("hidden"); ui.openTopic = null; } });

// ---------- account actions ----------
A.logout = () => db.signOut();
A.changePw = () => {
  bus.modal(`<h2>Change password</h2><form id="mForm" class="form"><label>Current password<input type="password" name="cur" class="input" required autocomplete="current-password"></label><label>New password<input type="password" name="p1" class="input" required minlength="8" autocomplete="new-password"></label>
    <label>Confirm new password<input type="password" name="p2" class="input" required minlength="8" autocomplete="new-password"></label><p id="fmsg" class="small msg"></p><div class="row"><button class="btn primary">Update</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
  $("#mForm").onsubmit = async e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (v.p1 !== v.p2) return ($("#fmsg").textContent = "The new passwords don't match.");
    try { await db.changePassword(v.p1, v.cur); bus.closeModal(); toast("Password updated ✔"); } catch (err) { $("#fmsg").textContent = errMsg(err); } };
};
