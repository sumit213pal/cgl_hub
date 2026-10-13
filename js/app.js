import db, { isDemo } from "./db.js";
import { ADMIN_EMAIL, GROUP_NAME, TARGET_DATE } from "./config.js";
import { SUBJECTS, ALL_TOPICS, TOPIC_MAP, SUBJECT_MAP, TIER_LABEL } from "./syllabus.js";
import { createTests } from "./tests.js";

// ---------------- helpers ----------------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400000;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const COLORS = ["#4f46e5", "#e11d48", "#059669", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#65a30d"];
const STATUS = {
  none: { label: "Not started", cls: "s-none" },
  learning: { label: "In progress", cls: "s-learning" },
  done: { label: "Completed", cls: "s-done" },
  revised: { label: "Revised", cls: "s-revised" }
};
const REVISE_AFTER = { done: 7, revised: 30 }; // days
const RTYPES = {
  youtube: { label: "YouTube video", icon: "▶️" },
  drive: { label: "Drive notes / PDF", icon: "📄" },
  practice: { label: "PYQ / Practice", icon: "📝" },
  link: { label: "Other link", icon: "🔗" }
};
const AUTH_ERR = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/weak-password": "Password is too weak – use at least 8 characters.",
  "auth/email-already-in-use": "This email already has an account.",
  "auth/network-request-failed": "Network error – check your internet.",
  "permission-denied": "You don't have permission for this."
};
const errMsg = e => AUTH_ERR[e?.code] || e?.message || "Something went wrong.";
const ago = t => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
};
const ytId = url => (String(url).match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || [])[1] || null;
function drivePreview(url) {
  const m = String(url).match(/\/file\/d\/([\w-]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  const d = String(url).match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  return d ? `https://docs.google.com/${d[1]}/d/${d[2]}/preview` : null;
}
const isUrl = u => /^https?:\/\/\S+$/i.test(u);
function genPw() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint32Array(10));
  return "Cgl@" + [...r].slice(0, 6).map(x => c[x % c.length]).join("");
}
function toast(msg) { if (!msg) return; const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); }
function screen(name) { ["loading", "login", "pwScreen", "app"].forEach(id => $("#" + id).classList.toggle("hidden", id !== name)); }

// ---------------- state ----------------
const S = {
  me: null, route: "dashboard", arg: "", subject: "quant", filter: "all", search: "", adminTab: "members",
  libType: "all", libSubject: "all", libSearch: "", openTopic: null,
  members: [], progress: {}, resources: [], drives: [], logs: [], mocks: [], comments: [], activity: [], notices: [],
  qindex: [], tests: [], papers: [], attempts: [], mistakes: [], bookmarks: [], reports: [], flags: [], scores: [], vault: [], cavault: [], votes: [], targets: [], qnotes: []
};
const unsub = [];

const allUsers = () => S.members.filter(m => m.uid).map(m => ({ id: m.uid, name: m.name || m.id, email: m.id, lastSeen: m.lastSeen, active: m.active !== false, role: m.role }));
const users = () => allUsers().filter(u => u.active).sort((a, b) => (b.role === "admin") - (a.role === "admin") || a.name.localeCompare(b.name));
const color = uid => COLORS[Math.max(0, users().findIndex(u => u.id === uid)) % COLORS.length];
const nameOf = uid => (allUsers().find(u => u.id === uid)?.name || "Someone").split(" ")[0];
const avatar = (uid, size = 28) => {
  const n = (allUsers().find(x => x.id === uid)?.name || "?").trim();
  return `<span class="av" style="width:${size}px;height:${size}px;background:${color(uid)}" title="${esc(n)}">${esc(n[0].toUpperCase())}</span>`;
};
const statusOf = (uid, tid) => S.progress[uid]?.topics?.[tid] || "none";
const statusAt = (uid, tid) => S.progress[uid]?.at?.[tid] || 0;
function pct(uid, subjectId) {
  const list = subjectId ? SUBJECT_MAP[subjectId].topics : ALL_TOPICS;
  return Math.round((list.filter(t => ["done", "revised"].includes(statusOf(uid, t.id))).length / list.length) * 100);
}
function streak(uid) {
  const days = new Set(S.logs.filter(l => l.uid === uid && Number(l.hours) > 0).map(l => l.date));
  const d = new Date(today()); let n = 0;
  if (!days.has(today())) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function weekHours(uid) {
  const from = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
  return Math.round(S.logs.filter(l => l.uid === uid && l.date >= from).reduce((a, l) => a + Number(l.hours || 0), 0) * 10) / 10;
}
function dueForRevision(uid) {
  return ALL_TOPICS.map(t => {
    const s = statusOf(uid, t.id), at = statusAt(uid, t.id), gap = REVISE_AFTER[s];
    if (!gap || !at) return null;
    const days = Math.floor((Date.now() - at) / DAY);
    return days >= gap ? { t, s, days } : null;
  }).filter(Boolean).sort((a, b) => b.days - a.days);
}
const logActivity = text => db.add("activity", { uid: S.me.uid, text }).catch(() => {});
const setStatus = (tid, v) => db.set("progress", S.me.uid, { topics: { [tid]: v }, at: { [tid]: Date.now() }, updatedAt: Date.now() });
function statusSelect(tid) {
  const cur = statusOf(S.me.uid, tid);
  return `<select class="status ${STATUS[cur].cls}" data-status="${tid}">
    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>`;
}

// ---------------- test system (PYQ papers, timed tests, analytics, vaults, group features) ----------------
const T = createTests({
  S, db, $, esc, toast, modal: html => modal(html), closeModal: () => closeModal(), avatar, nameOf, logActivity,
  rerender: () => render(), today, pct, dueCount: () => dueForRevision(S.me.uid).length,
  users, color, statusOf, statusSelect, STATUS, openTopicDrawer: id => openTopic(id)
});
T.X.act.heatUser = uid => { T.X.st.heatUser = uid; render(); };

// ---------------- auth flow ----------------
$("#loginTitle").textContent = GROUP_NAME;
$("#brandName").textContent = GROUP_NAME;
if (isDemo) { $("#demoBanner").classList.remove("hidden"); $("#demoHint").classList.remove("hidden"); }

const loginMsg = (t, ok) => { const m = $("#loginMsg"); m.textContent = t; m.classList.toggle("ok", !!ok); };
$("#loginForm").onsubmit = async e => {
  e.preventDefault(); loginMsg("");
  const btn = $("#btnLogin"); btn.disabled = true; btn.textContent = "Logging in…";
  try { await db.signIn($("#loginEmail").value.trim().toLowerCase(), $("#loginPw").value); }
  catch (err) { loginMsg(errMsg(err)); }
  finally { btn.disabled = false; btn.textContent = "Log in"; }
};
$("#forgot").onclick = async () => {
  const em = $("#loginEmail").value.trim().toLowerCase();
  if (!em) return loginMsg("Type your email above, then press Forgot password.");
  try { await db.resetPassword(em); loginMsg("If this email has access, a reset link has been sent. Check spam too.", true); }
  catch (err) { loginMsg(errMsg(err)); }
};
$("#pwLogout").onclick = () => db.signOut();

db.onAuth(async user => {
  unsub.splice(0).forEach(f => f && f());
  S.openTopic = null; $("#drawer").classList.add("hidden"); closeModal(); T.X.closeRunner?.();
  if (!user) { S.me = null; screen("login"); return; }
  try {
    let m = await db.get("members", user.email);
    const isAdminEmail = user.email === ADMIN_EMAIL.toLowerCase();
    if (!m && isAdminEmail) { // first admin login → create own member record
      await db.set("members", user.email, { name: "Admin", role: "admin", active: true, uid: user.uid, mustChangePassword: false, createdAt: Date.now() });
      m = await db.get("members", user.email);
    }
    if (!m || m.active === false) {
      await db.signOut();
      loginMsg(m ? "Your access has been disabled. Contact the admin." : "This account has no access. Ask the admin to add you.");
      return;
    }
    S.me = { uid: user.uid, email: user.email, name: m.name, isAdmin: m.role === "admin" || isAdminEmail };
    await db.set("members", user.email, { uid: user.uid, lastSeen: Date.now() });
    if (m.mustChangePassword) return showPwScreen();
    startApp();
  } catch (err) { console.error(err); await db.signOut(); loginMsg(errMsg(err)); }
});

function showPwScreen() {
  screen("pwScreen");
  $("#pwName").textContent = S.me.name;
  const msg = $("#pwMsg"); msg.textContent = "";
  $("#pwForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.p1.length < 8) return (msg.textContent = "Use at least 8 characters.");
    if (f.p1 !== f.p2) return (msg.textContent = "New passwords don't match.");
    if (f.p1 === f.cur) return (msg.textContent = "New password must be different from the temporary one.");
    try {
      await db.changePassword(f.p1, f.cur);
      await db.set("members", S.me.email, { mustChangePassword: false, pwChangedAt: Date.now() });
      e.target.reset(); toast("Password set ✔ Welcome!");
      startApp();
    } catch (err) { msg.textContent = errMsg(err); }
  };
}

function startApp() {
  screen("app");
  $("#navAdmin").classList.toggle("hidden", !S.me.isAdmin);
  const bind = (col, fn) => unsub.push(db.watch(col, fn));
  const mine = (col, fn) => unsub.push(db.watchWhere(col, "uid", S.me.uid, fn));
  const sorted = (col, d) => { S[col] = d.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); refresh(); };
  bind("members", d => {
    S.members = d;
    const me = d.find(m => m.id === S.me.email);
    if (me && me.active === false) { db.signOut(); loginMsg("Your access has been disabled. Contact the admin."); return; }
    if (me) S.me.name = me.name;
    refresh();
  });
  bind("progress", d => { S.progress = Object.fromEntries(d.map(x => [x.id, x])); refresh(); });
  ["resources", "drives", "logs", "mocks", "comments", "activity", "notices", "vault", "cavault", "tests", "papers", "targets"].forEach(c => bind(c, d => sorted(c, d)));
  ["flags", "scores", "votes", "qindex"].forEach(c => bind(c, d => { S[c] = d; refresh(); }));
  mine("attempts", d => { S.attempts = d.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); T.onAttempts(); refresh(); });
  mine("mistakes", d => { S.mistakes = d; refresh(); });
  mine("bookmarks", d => { S.bookmarks = d; refresh(); });
  mine("qnotes", d => { S.qnotes = d; refresh(); });
  if (S.me.isAdmin) bind("reports", d => { S.reports = d; refresh(); });
  route();
}

// ---------------- routing & render ----------------
window.addEventListener("hashchange", route);
function route() {
  const parts = (location.hash.slice(1) || "dashboard").split("/");
  S.route = parts[0]; S.arg = parts[1] || "";
  if (S.route === "admin" && !S.me?.isAdmin) S.route = "dashboard";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === (S.route === "result" ? "tests" : S.route)));
  window.scrollTo(0, 0);
  render();
}
let raf;
function refresh() {
  if (T.isRunning()) return; // don't redraw behind a running test
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { render(); if (S.openTopic) renderDrawerBody(); });
}

function render() {
  if (!S.me || $("#app").classList.contains("hidden")) return;
  $("#me").innerHTML = `${avatar(S.me.uid)} <span class="grow">${esc(S.me.name.split(" ")[0])}</span>
    <button class="btn ghost sm" id="btnPw" title="Change password">🔑</button><button class="btn ghost sm" id="btnOut">Logout</button>`;
  $("#btnOut").onclick = () => db.signOut();
  $("#btnPw").onclick = ACTIONS.changePw;

  // keep typed text + focus across live re-renders
  const main = $("#main"), saved = {}, act = document.activeElement;
  main.querySelectorAll("form[id] [name]").forEach(el => (saved[el.form.id + "|" + el.name] = el.value));
  const inMain = act && main.contains(act);
  const focusKey = inMain && act.dataset?.bind && !["radio", "checkbox"].includes(act.type) ? "bind:" + act.dataset.bind
    : inMain && act.form?.id ? act.form.id + "|" + act.name : inMain && act.id ? "#" + act.id : null;
  const caret = inMain && act.selectionStart !== undefined ? act.selectionStart : null;

  const views = { dashboard: viewDashboard, syllabus: viewSyllabus, library: viewLibrary, tracker: viewTracker, drives: viewDrives, admin: viewAdmin, ...T.views };
  const y = window.scrollY;
  main.innerHTML = (views[S.route] || viewDashboard)();
  main.querySelectorAll("form[id] [name]").forEach(el => { const k = el.form.id + "|" + el.name; if (k in saved) el.value = saved[k]; });
  if (focusKey) {
    const el = focusKey.startsWith("bind:") ? main.querySelector(`[data-bind="${focusKey.slice(5)}"]`)
      : focusKey.startsWith("#") ? main.querySelector(focusKey) : main.querySelector(`#${focusKey.split("|")[0]} [name="${focusKey.split("|")[1]}"]`);
    if (el) { el.focus(); try { const p = caret ?? el.value.length; el.setSelectionRange(p, p); } catch { /* number/email/date inputs */ } }
  }
  wire();
  window.scrollTo(0, y);
}

// ---------------- views ----------------
function viewDashboard() {
  const days = Math.ceil((new Date(TARGET_DATE) - new Date(today())) / DAY);
  const us = users();
  const gaps = ALL_TOPICS.filter(t => us.every(u => statusOf(u.id, t.id) === "none")).slice(0, 10);
  const due = dueForRevision(S.me.uid);
  return `
  <header class="page-head">
    <div><h1>Hi ${esc(S.me.name.split(" ")[0])} 👋</h1><p class="muted">Let's finish today's target together.</p></div>
    <div class="row">
      <button class="btn sm ghost mobile-only" data-act="changePw">🔑</button>
      <button class="btn sm ghost mobile-only" data-act="logout">Logout</button>
      <div class="countdown"><b>${days > 0 ? days : 0}</b><span>days to target<br><small>${esc(TARGET_DATE)}</small></span></div>
    </div>
  </header>

  ${S.notices.slice(0, 3).map(n => `<div class="notice">📢 <span class="grow">${esc(n.text)}</span><small>${esc(nameOf(n.uid))} · ${ago(n.createdAt)}</small></div>`).join("")}

  ${T.coachCard()}
  ${T.targetsCard()}

  <section class="grid cards">
    ${us.map(u => `
      <div class="card friend" style="--c:${color(u.id)}">
        <div class="row">${avatar(u.id, 40)}<div class="grow"><b>${esc(u.name)}</b><div class="muted small">active ${ago(u.lastSeen)}</div></div>
          <div class="big-pct">${pct(u.id)}%</div></div>
        <div class="bar"><i style="width:${pct(u.id)}%;background:${color(u.id)}"></i></div>
        <div class="stats"><span>🔥 ${streak(u.id)}-day streak</span><span>⏱️ ${weekHours(u.id)}h this week</span></div>
      </div>`).join("")}
  </section>

  <section class="card">
    <h2>Subject-wise progress</h2>
    <div class="table-wrap"><table class="matrix">
      <tr><th>Subject</th>${us.map(u => `<th>${avatar(u.id, 24)}</th>`).join("")}</tr>
      ${SUBJECTS.map(s => `<tr><td><a href="#syllabus" data-subject="${s.id}">${s.icon} ${esc(s.name)}</a></td>
        ${us.map(u => `<td><div class="mini"><i style="width:${pct(u.id, s.id)}%;background:${color(u.id)}"></i></div><small>${pct(u.id, s.id)}%</small></td>`).join("")}</tr>`).join("")}
    </table></div>
  </section>

  <div class="grid two">
    <div>
      <section class="card">
        <h2>🔁 Due for revision <small class="muted">(${due.length})</small></h2>
        <p class="muted small">Completed 7+ days ago, or revised 30+ days ago. Revise before you forget.</p>
        ${due.slice(0, 8).map(x => `<div class="li"><span class="grow link-like" data-topic="${x.t.id}">${esc(x.t.name)}</span>
          <small class="muted">${x.s === "done" ? "done" : "revised"} ${x.days}d ago</small>
          <button class="btn sm" data-revise="${x.t.id}">✓ Revised</button></div>`).join("") || `<p class="empty">Nothing due. 👍</p>`}
        <h2 class="mt">🚧 Group gaps</h2>
        <p class="muted small">Nobody has started these yet.</p>
        ${gaps.map(t => `<div class="li" data-topic="${t.id}"><span class="grow">${esc(t.name)}</span><small class="muted">${SUBJECT_MAP[t.subject].icon}</small></div>`).join("") || `<p class="empty">No gaps – great!</p>`}
      </section>
      ${T.expertsCard()}
    </div>
    <div>
      ${T.pulseCard()}
      <section class="card">
        <h2>📰 Recent activity</h2>
        ${S.activity.slice(0, 20).map(a => `<div class="li">${avatar(a.uid, 22)}<span class="grow"><b>${esc(nameOf(a.uid))}</b> ${esc(a.text)}</span><small class="muted">${ago(a.createdAt)}</small></div>`).join("") || `<p class="empty">No activity yet.</p>`}
      </section>
    </div>
  </div>`;
}

function viewSyllabus() {
  const sub = SUBJECT_MAP[S.subject];
  const us = users(), q = S.search.toLowerCase();
  const topics = sub.topics.filter(t => (S.filter === "all" || statusOf(S.me.uid, t.id) === S.filter) && t.name.toLowerCase().includes(q));
  return `
  <header class="page-head"><div><h1>Syllabus tracker</h1><p class="muted">Mark your status. Open a topic for notes, videos &amp; discussion.</p></div></header>
  <div class="tabs">${SUBJECTS.map(s => `<button class="tab ${s.id === S.subject ? "on" : ""}" data-subject="${s.id}">${s.icon} ${esc(s.name.split(" (")[0])} <small>${pct(S.me.uid, s.id)}%</small></button>`).join("")}</div>
  <div class="card">
    <div class="toolbar">
      <div class="chips">${sub.tiers.map(t => `<span class="chip">${TIER_LABEL[t]}</span>`).join("")}</div>
      <input id="search" class="input" placeholder="Search topic…" value="${esc(S.search)}">
      <select id="filter" class="input">
        <option value="all">All topics</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${S.filter === k ? "selected" : ""}>${v.label}</option>`).join("")}
      </select>
    </div>
    <div class="legend">${us.map(u => `<span>${avatar(u.id, 18)} ${esc(nameOf(u.id))}</span>`).join("")}
      <span class="sep"></span>${Object.entries(STATUS).map(([, v]) => `<span><i class="dot ${v.cls}"></i>${v.label}</span>`).join("")}</div>
    <div class="topics">
      ${topics.map(t => {
        const res = S.resources.filter(r => r.topicId === t.id);
        const vids = res.filter(r => r.type === "youtube").length, notes = res.length - vids;
        const cm = S.comments.filter(c => c.topicId === t.id).length, nq = T.X.scope({ topic: t.id }).length, nv = S.vault.filter(v => v.topicId === t.id).length;
        return `<div class="topic">
          <button class="tname" data-topic="${t.id}">${esc(t.name)}</button>
          <div class="counts">${nq ? `<span title="PYQ questions in bank">❓ ${nq}</span>` : ""}${vids ? `<span title="Videos">▶️ ${vids}</span>` : ""}${notes ? `<span title="Notes/links">📄 ${notes}</span>` : ""}${nv ? `<span title="Formulas & tricks">📐 ${nv}</span>` : ""}${cm ? `<span title="Comments">💬 ${cm}</span>` : ""}</div>
          <div class="friends">${us.filter(u => u.id !== S.me.uid).map(u => `<i class="dot ${STATUS[statusOf(u.id, t.id)].cls}" style="outline-color:${color(u.id)}" title="${esc(nameOf(u.id))}: ${STATUS[statusOf(u.id, t.id)].label}"></i>`).join("")}</div>
          ${statusSelect(t.id)}
        </div>`;
      }).join("") || `<p class="empty">No topics match.</p>`}
    </div>
  </div>`;
}

function viewLibrary() {
  const q = S.libSearch.toLowerCase();
  const list = S.resources.filter(r =>
    (S.libType === "all" || r.type === S.libType) &&
    (S.libSubject === "all" || TOPIC_MAP[r.topicId]?.subject === S.libSubject) &&
    `${r.title} ${TOPIC_MAP[r.topicId]?.name || ""}`.toLowerCase().includes(q)).sort((a, b) => T.X.votesOf(b.id) - T.X.votesOf(a.id) || (b.createdAt || 0) - (a.createdAt || 0));
  return `
  <header class="page-head"><div><h1>Library</h1><p class="muted">Every video, note and practice link shared by the group – the most helpful ones (👍) come first.</p></div>
    <button class="btn primary" data-act="addRes">+ Add resource</button></header>
  <div class="card">
    <div class="toolbar">
      <input id="libSearch" class="input" placeholder="Search…" value="${esc(S.libSearch)}">
      <select id="libType" class="input"><option value="all">All types</option>${Object.entries(RTYPES).map(([k, v]) => `<option value="${k}" ${S.libType === k ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}</select>
      <select id="libSubject" class="input"><option value="all">All subjects</option>${SUBJECTS.map(s => `<option value="${s.id}" ${S.libSubject === s.id ? "selected" : ""}>${s.icon} ${esc(s.name)}</option>`).join("")}</select>
    </div>
    <div class="res-grid">${list.map(resCard).join("") || `<p class="empty">No resources yet. Add the first one!</p>`}</div>
  </div>`;
}

function resCard(r) {
  const id = r.type === "youtube" ? ytId(r.url) : null;
  const t = TOPIC_MAP[r.topicId];
  const canDel = r.uid === S.me.uid || S.me.isAdmin;
  return `<div class="res">
    ${id ? `<button class="thumb" data-play="${id}" data-title="${esc(r.title)}"><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""><span>▶</span></button>`
         : `<div class="res-icon">${RTYPES[r.type]?.icon || "🔗"}</div>`}
    <div class="res-body">
      <b>${esc(r.title)}</b>
      ${t ? `<button class="link small" data-topic="${t.id}">${SUBJECT_MAP[t.subject].icon} ${esc(t.name)}</button>` : ""}
      <div class="row small muted">${avatar(r.uid, 18)} ${esc(nameOf(r.uid))} · ${ago(r.createdAt)}</div>
      <div class="row">
        ${T.voteBtn(r.id)}
        ${r.type === "drive" && drivePreview(r.url) ? `<button class="btn sm" data-preview="${esc(drivePreview(r.url))}" data-title="${esc(r.title)}">Preview</button>` : ""}
        <a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open ↗</a>
        ${canDel ? `<button class="btn sm ghost danger" data-del="resources:${r.id}">Delete</button>` : ""}
      </div>
    </div></div>`;
}

const hoursOn = (uid, d) => S.logs.filter(l => l.uid === uid && l.date === d).reduce((a, l) => a + Number(l.hours || 0), 0);
function viewTracker() {
  const us = users(), hu = T.X.st.heatUser || S.me.uid;
  const myLogs = S.logs.filter(l => l.uid === S.me.uid).slice(0, 20);
  const last14 = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10));
  const maxH = Math.max(4, ...us.flatMap(u => last14.map(d => hoursOn(u.id, d))));
  return `
  <header class="page-head"><div><h1>Study log &amp; mock tests</h1><p class="muted">Consistency beats intensity. Log every day.</p></div>
    <div class="row"><button class="btn primary" data-act="addLog">+ Log study</button><button class="btn" data-act="addMock">+ Add mock score</button></div></header>

  <section class="card"><div class="row"><h2 class="grow">🔥 Study heat-map</h2>${us.map(u => `<button class="tab ${u.id === hu ? "on" : ""}" data-t="heatUser:${u.id}">${esc(u.name.split(" ")[0])}</button>`).join("")}</div>${T.heatmap(hu)}</section>

  <section class="card"><h2>Last 14 days (hours)</h2>
    ${us.map(u => `<div class="spark-row">${avatar(u.id, 24)}<div class="spark">${last14.map(d => {
      const h = hoursOn(u.id, d);
      return `<i title="${d}: ${Math.round(h * 10) / 10}h" style="height:${Math.max(3, (h / maxH) * 48)}px;background:${h ? color(u.id) : "#e5e7eb"}"></i>`;
    }).join("")}</div><small>${weekHours(u.id)}h/wk</small></div>`).join("")}
  </section>

  <div class="grid two">
    <section class="card"><h2>📈 Mock tests (manual scores)</h2>
      <div class="grid mini-cards">${us.map(u => {
        const p = S.mocks.filter(x => x.uid === u.id).map(x => (x.score / x.max) * 100);
        return `<div class="mini-card" style="--c:${color(u.id)}">${avatar(u.id, 22)} <b>${esc(nameOf(u.id))}</b>
          <div class="small muted">${p.length} mocks · best ${p.length ? Math.max(...p).toFixed(0) : "–"}% · avg ${p.length ? (p.reduce((a, b) => a + b, 0) / p.length).toFixed(0) : "–"}%</div></div>`;
      }).join("")}</div>
      <div class="table-wrap"><table class="list"><tr><th>Who</th><th>Mock</th><th>Tier</th><th>Score</th><th>Date</th><th></th></tr>
      ${S.mocks.slice(0, 30).map(m => `<tr><td>${avatar(m.uid, 20)}</td><td>${esc(m.name)}</td><td>${TIER_LABEL[m.tier] || ""}</td>
        <td><b>${esc(m.score)}</b>/${esc(m.max)}</td><td>${esc(m.date)}</td>
        <td>${m.uid === S.me.uid ? `<button class="x" data-del="mocks:${m.id}">✕</button>` : ""}</td></tr>`).join("")}
      </table></div>
    </section>
    <section class="card"><h2>🗓️ My log</h2>
      ${myLogs.map(l => `<div class="li"><b>${esc(l.date)}</b><span class="grow">${esc(l.hours)}h · ${SUBJECT_MAP[l.subject]?.icon || ""} ${esc(SUBJECT_MAP[l.subject]?.name || "")}${l.note ? ` – <span class="muted">${esc(l.note)}</span>` : ""}</span><button class="x" data-del="logs:${l.id}">✕</button></div>`).join("") || `<p class="empty">No entries yet.</p>`}
    </section>
  </div>`;
}

function viewDrives() {
  return `
  <header class="page-head"><div><h1>Google Drive storage</h1><p class="muted">Files live in Drive; this site keeps the links in one place.</p></div>
    <button class="btn primary" data-act="addDrive">+ Add Drive folder</button></header>
  <div class="card tip">
    <b>How to set this up (one time)</b>
    <ol>
      <li>In your Google Drive make a folder, e.g. <i>CGL – Quant</i>, with sub-folders per topic.</li>
      <li>Right-click → <b>Share</b> → add your friends' Gmail IDs as <b>Editor</b> (they can upload too).</li>
      <li>Copy the folder link and add it here. When one Drive (15 GB) is full, add a folder from another friend's Drive.</li>
      <li>For a specific PDF, open the topic in <b>Syllabus</b> and add it as “Drive notes” – it gets a Preview button.</li>
    </ol>
  </div>
  <div class="grid cards">${S.drives.map(d => `
    <div class="card friend" style="--c:${color(d.uid)}">
      <div class="row">${avatar(d.uid, 32)}<div class="grow"><b>${esc(d.label)}</b><div class="small muted">by ${esc(nameOf(d.uid))}</div></div></div>
      ${d.purpose ? `<p class="small">${esc(d.purpose)}</p>` : ""}
      <div class="row"><a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open folder ↗</a>
      ${d.uid === S.me.uid || S.me.isAdmin ? `<button class="btn sm ghost danger" data-del="drives:${d.id}">Delete</button>` : ""}</div>
    </div>`).join("") || `<p class="empty">No Drive folders added yet.</p>`}</div>`;
}

function viewAdmin() {
  const open = S.reports.filter(r => r.status !== "done").length;
  const tabs = [["members", "👥 Members"], ["qbank", "📚 Question bank"], ["papers", "🗃 Papers"], ["tests", "🧪 Tests"], ["reports", `🚩 Reports${open ? ` (${open})` : ""}`], ["targets", "🎯 Weekly targets"], ["backup", "💾 Backup"]];
  const body = S.adminTab === "members" || !T.admin[S.adminTab] ? viewAdminMembers() : T.admin[S.adminTab]();
  return `
  <header class="page-head"><div><h1>🛡️ Admin panel</h1><p class="muted">Manage members, the PYQ question bank, papers, tests, reports and backups.</p></div></header>
  <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${S.adminTab === k ? "on" : ""}" data-admintab="${k}">${l}</button>`).join("")}</div>
  ${body}`;
}

function viewAdminMembers() {
  const ms = [...S.members].sort((a, b) => (b.role === "admin") - (a.role === "admin") || (a.name || "").localeCompare(b.name || ""));
  const badge = m => m.active === false ? `<span class="badge off">Disabled</span>`
    : m.mustChangePassword ? `<span class="badge warn">Waiting for first login</span>` : `<span class="badge ok">Active</span>`;
  return `
  <p class="muted">Passwords are never visible – Firebase stores them encrypted.</p>
  <div class="grid two">
    <section class="card"><h2>➕ Add member</h2>
      <form id="addMember" class="form">
        <label>Name<input name="name" class="input" required maxlength="40" placeholder="e.g. Rahul Sharma"></label>
        <label>Email (their login ID)<input name="email" type="email" class="input" required placeholder="friend@gmail.com"></label>
        <label>Temporary password
          <div class="row"><input name="pw" class="input grow" required minlength="8" value="${genPw()}"><button type="button" class="btn sm" data-act="regen" title="New random password">↻</button></div></label>
        <button class="btn primary">Create account</button>
        <p class="small muted">They must set their own password on first login. After that, only they know it.</p>
      </form>
    </section>
    <section class="card"><h2>📢 Notice board</h2>
      <form id="addNotice" class="form">
        <textarea name="text" rows="3" class="input" required maxlength="500" placeholder="e.g. Sunday 10 AM – full mock for everyone!"></textarea>
        <button class="btn primary">Post notice</button>
      </form>
      <div class="mt-s">${S.notices.map(n => `<div class="li"><span class="grow">${esc(n.text)}</span><small class="muted">${ago(n.createdAt)}</small><button class="x" data-del="notices:${n.id}">✕</button></div>`).join("") || `<p class="empty">No notices.</p>`}</div>
    </section>
  </div>
  <section class="card"><h2>👥 Members (${ms.length})</h2>
    <div class="table-wrap"><table class="list">
      <tr><th>Name</th><th>Email</th><th>Status</th><th>Last seen</th><th>Progress</th><th>Actions</th></tr>
      ${ms.map(m => {
        const self = m.id === S.me.email;
        return `<tr><td><b>${esc(m.name)}</b> ${m.role === "admin" ? `<span class="badge">Admin</span>` : ""}</td>
          <td>${esc(m.id)}</td><td>${badge(m)}</td><td>${ago(m.lastSeen)}</td><td>${m.uid ? pct(m.uid) + "%" : "–"}</td>
          <td><div class="row">${self ? `<small class="muted">you</small>` : `
            <button class="btn sm" data-reset="${esc(m.id)}">Send reset email</button>
            <button class="btn sm ${m.active === false ? "" : "danger"}" data-toggle="${esc(m.id)}">${m.active === false ? "Enable" : "Disable"}</button>`}</div></td></tr>`;
      }).join("")}
    </table></div>
    <p class="small muted">“Disable” blocks access immediately. To delete a login completely: Firebase Console → Authentication → Users.</p>
  </section>`;
}

// ---------------- topic drawer ----------------
function openTopic(tid) {
  S.openTopic = tid;
  const t = TOPIC_MAP[tid];
  const nq = T.X.scope({ topic: tid }).length;
  $("#drawerPanel").innerHTML = `
    <div class="drawer-head"><div><small class="muted">${SUBJECT_MAP[t.subject].icon} ${esc(SUBJECT_MAP[t.subject].name)}</small><h2>${esc(t.name)}</h2></div>
      <button class="x big" data-close="drawer">✕</button></div>
    ${nq ? `<div class="notice">❓ <span class="grow">${nq} PYQ question${nq > 1 ? "s" : ""} in the bank for this topic.</span><button class="btn sm primary" data-practice="${tid}">Practise 10 Qs</button></div>` : ""}
    <div id="drawerBody"></div>
    <form id="resForm" class="card form">
      <b>Add a resource</b>
      <select name="type" class="input">${Object.entries(RTYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join("")}</select>
      <input name="title" class="input" placeholder="Title (e.g. Percentage one-shot by …)" required maxlength="120">
      <input name="url" class="input" placeholder="Paste YouTube / Google Drive / any link" required>
      <button class="btn primary">Add</button>
    </form>
    <form id="cmForm" class="card form">
      <b>💬 Discussion / doubts</b>
      <textarea name="text" class="input" rows="2" placeholder="Ask a doubt, share a trick or a shortcut…" required maxlength="1000"></textarea>
      <button class="btn">Post</button>
    </form>`;
  $("#drawer").classList.remove("hidden");
  renderDrawerBody();
  $("#drawerPanel").querySelector("[data-practice]")?.addEventListener("click", () => { $("#drawer").classList.add("hidden"); S.openTopic = null; T.X.startTopic(tid); });
  $("#resForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!isUrl(f.url.trim())) return toast("Please paste a valid link (https://…)");
    if (f.type === "youtube" && !ytId(f.url)) toast("Couldn't read the video id – saved as a link");
    await db.add("resources", { uid: S.me.uid, topicId: tid, type: f.type, title: f.title.trim(), url: f.url.trim() });
    logActivity(`added ${RTYPES[f.type].label.toLowerCase()} to ${t.name}`);
    e.target.reset(); toast("Added ✔");
  };
  $("#cmForm").onsubmit = async e => {
    e.preventDefault();
    const text = new FormData(e.target).get("text").trim(); if (!text) return;
    await db.add("comments", { uid: S.me.uid, topicId: tid, text });
    logActivity(`commented on ${t.name}`);
    e.target.reset();
  };
}
function renderDrawerBody() {
  const tid = S.openTopic, el = $("#drawerBody"); if (!el) return;
  const byVotes = (a, b) => T.X.votesOf(b.id) - T.X.votesOf(a.id) || (b.createdAt || 0) - (a.createdAt || 0);
  const res = S.resources.filter(r => r.topicId === tid).sort(byVotes);
  const vids = res.filter(r => r.type === "youtube"), others = res.filter(r => r.type !== "youtube");
  const cms = S.comments.filter(c => c.topicId === tid).slice().sort((a, b) => T.X.votesOf(b.id) - T.X.votesOf(a.id) || (a.createdAt || 0) - (b.createdAt || 0));
  el.innerHTML = `
    <div class="who">${users().map(u => `<span class="pill ${STATUS[statusOf(u.id, tid)].cls}">${avatar(u.id, 18)} ${esc(nameOf(u.id))}: ${STATUS[statusOf(u.id, tid)].label}</span>`).join("")}</div>
    <div class="row mt-s"><b>My status:</b> ${statusSelect(tid)}</div>
    <h3>▶️ Videos (${vids.length})</h3><div class="res-grid">${vids.map(resCard).join("") || `<p class="empty">No videos yet.</p>`}</div>
    <h3>📄 Notes, PYQs &amp; links (${others.length})</h3><div class="res-grid">${others.map(resCard).join("") || `<p class="empty">Nothing yet.</p>`}</div>
    ${T.vaultForTopic(tid)}
    <h3>💬 Doubts &amp; discussion (${cms.length}) <small class="muted">most helpful first</small></h3>
    ${cms.map(c => `<div class="comment">${avatar(c.uid, 24)}<div class="grow"><b>${esc(nameOf(c.uid))}</b> <small class="muted">${ago(c.createdAt)}</small><p>${esc(c.text)}</p></div>${T.voteBtn(c.id)}${c.uid === S.me.uid || S.me.isAdmin ? `<button class="x" data-del="comments:${c.id}">✕</button>` : ""}</div>`).join("") || `<p class="empty">No messages yet.</p>`}`;
  wire(el);
}

// ---------------- modals ----------------
function modal(html) { $("#modalBox").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#modalBox").innerHTML = ""; }
const subjectOptions = (sel = "quant") => SUBJECTS.map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${s.icon} ${esc(s.name)}</option>`).join("");

function showCredentials(name, email, pw) {
  const url = location.origin + location.pathname;
  const msg = `Hi ${name}, you've been added to ${GROUP_NAME} 📚\n\nLink: ${url}\nEmail: ${email}\nTemporary password: ${pw}\n\nYou'll be asked to set your own password on first login.`;
  modal(`<h2>✅ Account created</h2>
    <p class="muted small">Send these details to ${esc(name)} privately. This temporary password is shown only now – it is not saved anywhere.</p>
    <pre class="cred">${esc(msg)}</pre>
    <div class="row"><button class="btn primary" id="copyCred">📋 Copy</button>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Share on WhatsApp</a>
    <button class="btn ghost" data-close="modal">Done</button></div>`);
  $("#copyCred").onclick = () => navigator.clipboard.writeText(msg).then(() => toast("Copied ✔"), () => toast("Copy failed – select the text manually"));
}

const ACTIONS = {
  logout: () => db.signOut(),
  regen() { const i = $("#addMember [name=pw]"); if (i) i.value = genPw(); },
  changePw() {
    modal(`<h2>🔑 Change password</h2><form id="f" class="form">
      <label>Current password<input type="password" name="cur" class="input" required autocomplete="current-password"></label>
      <label>New password<input type="password" name="p1" class="input" required minlength="8" autocomplete="new-password"></label>
      <label>Confirm new password<input type="password" name="p2" class="input" required minlength="8" autocomplete="new-password"></label>
      <p id="fmsg" class="small msg"></p>
      <div class="row"><button class="btn primary">Update</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      if (f.p1 !== f.p2) return ($("#fmsg").textContent = "New passwords don't match.");
      try { await db.changePassword(f.p1, f.cur); await db.set("members", S.me.email, { pwChangedAt: Date.now() }); closeModal(); toast("Password updated ✔"); }
      catch (err) { $("#fmsg").textContent = errMsg(err); }
    };
  },
  addLog() {
    modal(`<h2>Log study time</h2><form id="f" class="form">
      <label>Date<input type="date" name="date" class="input" value="${today()}" required></label>
      <label>Hours<input type="number" name="hours" class="input" min="0.25" max="18" step="0.25" value="2" required></label>
      <label>Subject<select name="subject" class="input">${subjectOptions()}</select></label>
      <label>What did you do?<input name="note" class="input" maxlength="200" placeholder="e.g. 50 Qs of Geometry"></label>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await db.add("logs", { uid: S.me.uid, date: f.date, hours: Number(f.hours), subject: f.subject, note: f.note.trim() });
      logActivity(`studied ${f.hours}h of ${SUBJECT_MAP[f.subject].name}`); closeModal(); toast("Logged ✔");
    };
  },
  addMock() {
    modal(`<h2>Add mock test score</h2><form id="f" class="form">
      <label>Mock name / source<input name="name" class="input" required maxlength="80" placeholder="e.g. Full mock 12 (external)"></label>
      <label>Type<select name="tier" class="input"><option value="T1">Tier 1 (max 200)</option><option value="T2">Tier 2 Paper 1 (max 450)</option><option value="P2">Paper 2 Statistics (max 200)</option></select></label>
      <div class="row"><label class="grow">Score<input type="number" step="0.25" name="score" class="input" required></label>
      <label class="grow">Max<input type="number" name="max" class="input" value="200" required></label></div>
      <label>Date<input type="date" name="date" class="input" value="${today()}" required></label>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#f [name=tier]").onchange = e => ($("#f [name=max]").value = e.target.value === "T2" ? 450 : 200);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      await db.add("mocks", { uid: S.me.uid, name: f.name.trim(), tier: f.tier, score: Number(f.score), max: Number(f.max), date: f.date });
      logActivity(`scored ${f.score}/${f.max} in ${f.name}`); closeModal(); toast("Saved ✔");
    };
  },
  addDrive() {
    modal(`<h2>Add Google Drive folder</h2><form id="f" class="form">
      <label>Label<input name="label" class="input" required maxlength="80" placeholder="e.g. Sumit Drive – GA notes"></label>
      <label>Folder link<input name="url" class="input" required placeholder="https://drive.google.com/drive/folders/…"></label>
      <label>What's inside?<input name="purpose" class="input" maxlength="150" placeholder="e.g. GA PDFs + monthly current affairs"></label>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    $("#f").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      if (!isUrl(f.url.trim())) return toast("Please paste a valid link");
      await db.add("drives", { uid: S.me.uid, label: f.label.trim(), url: f.url.trim(), purpose: f.purpose.trim() });
      logActivity(`added Drive folder “${f.label.trim()}”`); closeModal(); toast("Added ✔");
    };
  },
  addRes() {
    modal(`<h2>Add resource</h2><form id="f" class="form">
      <label>Subject<select name="subject" class="input">${subjectOptions(S.libSubject !== "all" ? S.libSubject : "quant")}</select></label>
      <label>Topic<select name="topicId" class="input"></select></label>
      <label>Type<select name="type" class="input">${Object.entries(RTYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join("")}</select></label>
      <label>Title<input name="title" class="input" required maxlength="120"></label>
      <label>Link<input name="url" class="input" required placeholder="https://…"></label>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-close="modal">Cancel</button></div></form>`);
    const fill = () => ($("#f [name=topicId]").innerHTML = SUBJECT_MAP[$("#f [name=subject]").value].topics.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join(""));
    fill(); $("#f [name=subject]").onchange = fill;
    $("#f").onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      if (!isUrl(f.url.trim())) return toast("Please paste a valid link");
      await db.add("resources", { uid: S.me.uid, topicId: f.topicId, type: f.type, title: f.title.trim(), url: f.url.trim() });
      logActivity(`added ${RTYPES[f.type].label.toLowerCase()} to ${TOPIC_MAP[f.topicId].name}`); closeModal(); toast("Added ✔");
    };
  }
};

async function addMember(form) {
  const f = Object.fromEntries(new FormData(form));
  const email = f.email.trim().toLowerCase(), name = f.name.trim();
  if (f.pw.length < 8) return toast("Temporary password must be at least 8 characters");
  const btn = form.querySelector("button.primary"); btn.disabled = true; btn.textContent = "Creating…";
  try {
    let uid = null, existed = false;
    try { uid = await db.createUser(email, f.pw); }
    catch (err) { if (err.code === "auth/email-already-in-use") existed = true; else throw err; }
    const old = S.members.find(m => m.id === email);
    await db.set("members", email, {
      name, role: old?.role || "member", active: true, mustChangePassword: !existed,
      ...(uid ? { uid } : {}), createdAt: old?.createdAt || Date.now(), addedBy: S.me.email
    });
    logActivity(`added ${name} to the group`);
    const fresh = $("#addMember"); if (fresh) { fresh.reset(); fresh.querySelector("[name=pw]").value = genPw(); }
    if (existed) modal(`<h2>Access restored</h2><p>${esc(email)} already had a login, so access has been re-enabled. Their old password still works – or click <b>Send reset email</b> in the members list.</p><button class="btn" data-close="modal">OK</button>`);
    else showCredentials(name, email, f.pw);
  } catch (err) { toast(errMsg(err)); }
  finally { const b = $("#addMember button.primary"); if (b) { b.disabled = false; b.textContent = "Create account"; } }
}

// ---------------- event wiring ----------------
function wire(root = $("#main")) {
  root.querySelectorAll("[data-subject]").forEach(b => b.onclick = e => { S.subject = b.dataset.subject; if (S.route !== "syllabus") { e.preventDefault(); location.hash = "syllabus"; } else render(); });
  root.querySelectorAll("[data-admintab]").forEach(b => b.onclick = e => { S.adminTab = b.dataset.admintab; if (S.route !== "admin") { e.preventDefault(); location.hash = "admin"; } else render(); });
  root.querySelectorAll("[data-topic]").forEach(b => b.onclick = () => openTopic(b.dataset.topic));
  root.querySelectorAll("[data-status]").forEach(sel => sel.onchange = async () => {
    const tid = sel.dataset.status, v = sel.value;
    await setStatus(tid, v);
    if (v === "done" || v === "revised") logActivity(`marked ${TOPIC_MAP[tid].name} as ${STATUS[v].label.toLowerCase()}`);
  });
  root.querySelectorAll("[data-revise]").forEach(b => b.onclick = async () => {
    const tid = b.dataset.revise; await setStatus(tid, "revised");
    logActivity(`revised ${TOPIC_MAP[tid].name}`); toast("Nice! Next revision in 30 days");
  });
  root.querySelectorAll("[data-act]").forEach(b => b.onclick = () => ACTIONS[b.dataset.act]());
  root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this?")) return;
    const [col, id] = b.dataset.del.split(":");
    try { await db.remove(col, id); } catch (err) { toast(errMsg(err)); }
  });
  root.querySelectorAll("[data-reset]").forEach(b => b.onclick = async () => {
    const em = b.dataset.reset;
    if (!confirm(`Send a password reset email to ${em}?`)) return;
    try { await db.resetPassword(em); toast(isDemo ? "Demo: reset email would be sent" : `Reset email sent to ${em}`); } catch (err) { toast(errMsg(err)); }
  });
  root.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => {
    const m = S.members.find(x => x.id === b.dataset.toggle); if (!m) return;
    const enable = m.active === false;
    if (!enable && !confirm(`Disable ${m.name}? They will be logged out and blocked.`)) return;
    try { await db.set("members", m.id, { active: enable }); toast(enable ? "Enabled ✔" : "Disabled"); } catch (err) { toast(errMsg(err)); }
  });
  const am = root.querySelector("#addMember"); if (am) am.onsubmit = e => { e.preventDefault(); addMember(am); };
  const an = root.querySelector("#addNotice"); if (an) an.onsubmit = async e => {
    e.preventDefault(); const text = new FormData(an).get("text").trim(); if (!text) return;
    try { await db.add("notices", { uid: S.me.uid, text }); $("#addNotice")?.reset(); toast("Notice posted ✔"); } catch (err) { toast(errMsg(err)); }
  };
  root.querySelectorAll("[data-play]").forEach(b => b.onclick = () => modal(`<div class="row"><b class="grow">${esc(b.dataset.title)}</b><button class="x big" data-close="modal">✕</button></div>
    <div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${b.dataset.play}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`));
  root.querySelectorAll("[data-preview]").forEach(b => b.onclick = () => modal(`<div class="row"><b class="grow">${esc(b.dataset.title)}</b><button class="x big" data-close="modal">✕</button></div>
    <div class="video doc"><iframe src="${esc(b.dataset.preview)}" allow="autoplay"></iframe></div>`));
  const bindInput = (id, key, debounce) => {
    const el = root.querySelector("#" + id); if (!el) return; let tm;
    el[debounce ? "oninput" : "onchange"] = () => { clearTimeout(tm); tm = setTimeout(() => { S[key] = el.value; render(); }, debounce ? 250 : 0); };
  };
  bindInput("search", "search", true); bindInput("filter", "filter");
  bindInput("libSearch", "libSearch", true); bindInput("libType", "libType"); bindInput("libSubject", "libSubject");
  T.wire(root);
}

document.addEventListener("click", e => {
  const c = e.target.closest("[data-close]"); if (!c) return;
  if (c.dataset.close === "modal") closeModal();
  if (c.dataset.close === "drawer") { $("#drawer").classList.add("hidden"); S.openTopic = null; }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || T.isRunning()) return;
  if (!$("#modal").classList.contains("hidden")) closeModal();
  else { $("#drawer").classList.add("hidden"); S.openTopic = null; }
});
