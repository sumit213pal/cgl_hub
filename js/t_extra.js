// Group features: votes, formula/trick vault, current-affairs vault, weekly targets, study heat-map, group pulse, improvement board, expert finder.
import { SUBJECTS, SUBJECT_MAP, TOPIC_MAP, ALL_TOPICS } from "./syllabus.js";
import { VAULT_KINDS, MONTHS, MIN_Q, DAY, weekStart, dayKey, fmtDay, fmtDate, heatLevel, rate } from "./t_util.js";

export function initExtra(X) {
  const { S, st, db, $, esc, toast, avatar, nameOf, users, color, statusOf, STATUS } = X, A = X.act, ui = X.ui;

  // ---------- votes (resources, doubts/comments, vault items) ----------
  X.votesOf = tid => S.votes.filter(v => v.tid === tid).length;
  X.voteBtn = tid => `<button class="btn sm ${S.votes.some(v => v.tid === tid && v.uid === S.me.uid) ? "primary" : ""}" data-t="vote:${tid}" title="Mark as helpful">👍 ${X.votesOf(tid)}</button>`;
  A.vote = async tid => { const id = `${S.me.uid}_${tid}`; if (S.votes.some(v => v.id === id)) await db.remove("votes", id); else await db.set("votes", id, { uid: S.me.uid, tid }); };

  // ---------- Formula & shortcut vault ----------
  const vaultItem = x => `<div class="vitem"><div class="row"><span class="chip">${VAULT_KINDS[x.kind] || x.kind}</span><b class="grow">${esc(x.title)}</b>${X.voteBtn(x.id)}${x.uid === S.me.uid || S.me.isAdmin ? `<button class="x" data-del="vault:${x.id}">✕</button>` : ""}</div>
    ${x.text ? `<p class="vtext">${esc(x.text)}</p>` : ""}${x.url ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(x.url)}">Open ↗</a>` : ""}<div class="small muted">${avatar(x.uid, 16)} ${esc(nameOf(x.uid))} · ${fmtDate(x.createdAt)}</div></div>`;
  X.vaultForTopic = tid => {
    const items = S.vault.filter(x => x.topicId === tid).sort((a, b) => X.votesOf(b.id) - X.votesOf(a.id) || (b.createdAt || 0) - (a.createdAt || 0));
    return `<h3>📐 Formulas, tricks &amp; patterns (${items.length})</h3>${items.map(vaultItem).join("") || `<p class="empty">Nothing yet – add one in the <a href="#vault">Vault</a>.</p>`}`;
  };
  X.viewVault = () => {
    const v = st.vault, add = v.add;
    const items = S.vault.filter(x => (!v.subject || x.subject === v.subject) && (!v.topic || x.topicId === v.topic) && (!v.kind || x.kind === v.kind))
      .sort((a, b) => X.votesOf(b.id) - X.votesOf(a.id) || (b.createdAt || 0) - (a.createdAt || 0));
    const by = {}; items.forEach(x => (by[x.topicId] ||= []).push(x));
    return `
    <header class="page-head"><div><h1>📐 Formula &amp; Shortcut Vault</h1><p class="muted">Formula sheets, short tricks, PYQ patterns and common mistakes – per topic, shared by everyone.</p></div></header>
    <section class="card"><div class="toolbar">${ui.select("vault.subject", X.subjectOpts(), "data-rerender")}${ui.select("vault.topic", X.topicOpts(v.subject, "All topics").map(([id, l]) => [id, l.replace(/ \(\d+\)$/, "")]), "data-rerender")}
      ${ui.select("vault.kind", [["", "All kinds"], ...Object.entries(VAULT_KINDS)], "data-rerender")}</div>
      ${Object.entries(by).map(([t, list]) => `<h3>${SUBJECT_MAP[TOPIC_MAP[t]?.subject]?.icon || ""} ${esc(TOPIC_MAP[t]?.name || t)}</h3>${list.map(vaultItem).join("")}`).join("") || `<p class="empty">Nothing here yet – add the first one below.</p>`}</section>
    <section class="card"><h2>+ Add to the vault</h2><div class="form">
      <div class="form-grid"><label>Subject${ui.select("vault.add.subject", SUBJECTS.map(s => [s.id, `${s.icon} ${s.name}`]), "data-rerender")}</label>
        <label>Topic${ui.select("vault.add.topic", [["", "Choose a topic…"], ...SUBJECT_MAP[add.subject].topics.map(t => [t.id, t.name])])}</label>
        <label>Kind${ui.select("vault.add.kind", Object.entries(VAULT_KINDS))}</label><label>Title${ui.text("vault.add.title", 'maxlength="100" placeholder="e.g. Successive percentage change"')}</label></div>
      <label>Content${ui.area("vault.add.text", 'rows="4" maxlength="2000" placeholder="Write the formula / trick / mistake…"')}</label>
      <label>Link (Drive PDF / YouTube – optional)${ui.text("vault.add.url", 'placeholder="https://…"')}</label>
      <div class="row"><button class="btn primary" data-t="addVault">Add</button></div></div></section>`;
  };
  A.addVault = async () => {
    const a = st.vault.add;
    if (!a.topic) return toast("Choose a topic."); if (!a.title.trim()) return toast("Give it a title."); if (!a.text.trim() && !a.url.trim()) return toast("Add some content or a link.");
    if (a.url.trim() && !/^https?:\/\/\S+$/i.test(a.url.trim())) return toast("The link must start with http:// or https://");
    await db.add("vault", { uid: S.me.uid, subject: a.subject, topicId: a.topic, kind: a.kind, title: a.title.trim(), text: a.text.trim(), url: a.url.trim() });
    X.logActivity(`added a ${VAULT_KINDS[a.kind].replace(/^\S+ /, "").toLowerCase()} to ${TOPIC_MAP[a.topic].name}`);
    Object.assign(a, { title: "", text: "", url: "" }); toast("Added to the vault ✔"); X.rerender();
  };

  // ---------- Current affairs vault ----------
  X.viewCA = () => {
    const c = st.ca, years = [...new Set([new Date().getFullYear(), ...S.cavault.map(x => x.year)])].sort().reverse();
    const items = S.cavault.filter(x => Number(x.year) === Number(c.year)), by = {}; items.forEach(x => (by[x.month] ||= []).push(x));
    return `
    <header class="page-head"><div><h1>📰 Current Affairs Vault</h1><p class="muted">Monthly current-affairs PDFs and notes (links to Google Drive) in one place.</p></div></header>
    <section class="card"><div class="toolbar">${ui.select("ca.year", years.map(y => [y, y]), "data-rerender")}</div>
      ${Object.keys(by).sort((a, b) => b - a).map(m => `<h3>${MONTHS[m - 1]} ${c.year}</h3>${by[m].map(x => `<div class="vitem"><div class="row"><b class="grow">${esc(x.title)}</b>${X.voteBtn(x.id)}<a class="btn sm" target="_blank" rel="noopener" href="${esc(x.url)}">Open ↗</a>${x.uid === S.me.uid || S.me.isAdmin ? `<button class="x" data-del="cavault:${x.id}">✕</button>` : ""}</div>${x.note ? `<p class="vtext">${esc(x.note)}</p>` : ""}<div class="small muted">${avatar(x.uid, 16)} ${esc(nameOf(x.uid))}</div></div>`).join("")}`).join("") || `<p class="empty">Nothing for ${c.year} yet.</p>`}</section>
    <section class="card"><h2>+ Add a monthly PDF / link</h2><div class="form">
      <div class="form-grid"><label>Month${ui.select("ca.add.month", MONTHS.map((m, i) => [i + 1, m]))}</label><label>Title${ui.text("ca.add.title", 'maxlength="100" placeholder="e.g. October 2026 – monthly capsule"')}</label></div>
      <label>Link (Google Drive / website)${ui.text("ca.add.url", 'placeholder="https://drive.google.com/…"')}</label><label>Note (optional)${ui.text("ca.add.note", 'maxlength="200"')}</label>
      <div class="row"><button class="btn primary" data-t="addCA">Add</button></div></div></section>`;
  };
  A.addCA = async () => {
    const a = st.ca.add; if (!a.title.trim()) return toast("Give it a title."); if (!/^https?:\/\/\S+$/i.test(a.url.trim())) return toast("Paste a valid link (https://…)");
    await db.add("cavault", { uid: S.me.uid, year: Number(st.ca.year), month: Number(a.month), title: a.title.trim(), url: a.url.trim(), note: a.note.trim() });
    X.logActivity(`added current affairs: ${a.title.trim()}`); Object.assign(a, { title: "", url: "", note: "" }); toast("Added ✔"); X.rerender();
  };

  // ---------- weekly targets ----------
  const thisTarget = () => S.targets.find(t => t.id === weekStart());
  X.targetsCard = () => {
    const t = thisTarget(); if (!t) return "";
    const us = users(), topics = (t.topics || []).filter(id => TOPIC_MAP[id]), done = uid => topics.filter(id => ["done", "revised"].includes(statusOf(uid, id))).length;
    return `<section class="card"><h2>🎯 ${esc(t.title || "This week's targets")} <small class="muted">week of ${fmtDay(t.id)}</small></h2>
      <div class="grid two"><div>${topics.map(id => `<div class="li"><span class="grow link-like" data-topic="${id}">${esc(TOPIC_MAP[id].name)}</span>${X.statusSelect(id)}</div>`).join("")}</div>
        <div><small class="muted">Group progress (accountability, not ranking)</small>${us.map(u => `<div class="prog-row">${avatar(u.id, 22)}<span class="grow">${esc(u.name.split(" ")[0])}</span><div class="bar sm" style="width:40%"><i style="width:${topics.length ? (done(u.id) / topics.length) * 100 : 0}%;background:${color(u.id)}"></i></div><b>${done(u.id)}/${topics.length}</b></div>`).join("")}</div></div></section>`;
  };
  X.viewTargets = () => {
    const g = st.tgt, sub = SUBJECT_MAP[g.subject], n = Object.values(g.sel).filter(Boolean).length;
    return `<section class="card"><h2>🎯 Weekly target</h2><p class="small muted">Pick the topics everyone should complete this week. Students mark them as Completed in the Syllabus; the dashboard shows each person's progress.</p>
      <div class="form-grid"><label>Any date in the week${ui.text("tgt.week", 'type="date"')}</label><label>Title${ui.text("tgt.title", 'placeholder="e.g. Week 12 – Arithmetic" maxlength="80"')}</label></div>
      <div class="tabs">${SUBJECTS.map(s => `<button class="tab ${g.subject === s.id ? "on" : ""}" data-t="tgtSubject:${s.id}">${s.icon}</button>`).join("")}</div>
      <div class="topic-pick">${sub.topics.map(t => `<label class="check"><input type="checkbox" data-bind="tgt.sel.${t.id}" ${g.sel[t.id] ? "checked" : ""}> ${esc(t.name)}</label>`).join("")}</div>
      <div class="row mt-s"><button class="btn primary" data-t="saveTarget">Save target (${n} topic${n === 1 ? "" : "s"})</button><button class="btn ghost" data-t="clearTarget">Clear</button></div></section>
    <section class="card"><h2>Weeks</h2>${[...S.targets].sort((a, b) => b.id.localeCompare(a.id)).map(t => `<div class="li"><b>${fmtDay(t.id)}</b><span class="grow">${esc(t.title || "")} <span class="muted">· ${(t.topics || []).length} topics</span></span><button class="btn sm" data-t="editTarget:${t.id}">Edit</button><button class="x" data-t="delTarget:${t.id}">✕</button></div>`).join("") || `<p class="empty">No targets yet.</p>`}</section>`;
  };
  A.tgtSubject = s => { st.tgt.subject = s; X.rerender(); };
  A.clearTarget = () => { st.tgt.sel = {}; st.tgt.title = ""; X.rerender(); };
  A.saveTarget = async () => {
    const g = st.tgt, ids = Object.keys(g.sel).filter(k => g.sel[k]); if (!ids.length) return toast("Pick at least one topic.");
    const wk = weekStart(new Date(g.week + "T12:00:00").getTime());
    await db.set("targets", wk, { title: g.title.trim() || "This week's targets", topics: ids, uid: S.me.uid }); toast("Target saved ✔"); X.rerender();
  };
  A.editTarget = id => { const t = S.targets.find(x => x.id === id); st.tgt.week = id; st.tgt.title = t.title || ""; st.tgt.sel = Object.fromEntries((t.topics || []).map(x => [x, true])); X.rerender(); window.scrollTo(0, 0); };
  A.delTarget = async id => { if (confirm("Delete this weekly target?")) await db.remove("targets", id); };

  // ---------- study heat-map ----------
  X.heatmap = uid => {
    const weeks = 20, hours = {}; S.logs.filter(l => l.uid === uid).forEach(l => (hours[l.date] = (hours[l.date] || 0) + Number(l.hours || 0)));
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
    let months = "", cols = "", last = -1, total = 0, active = 0;
    for (let w = 0; w < weeks; w++) {
      let cells = "";
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
        const k = dayKey(dt.getTime());
        if (dt > today) { cells += `<i class="hc fut"></i>`; continue; }
        const h = hours[k] || 0; total += h; if (h > 0) active++;
        cells += `<i class="hc l${heatLevel(h)}" title="${k}: ${Math.round(h * 10) / 10}h"></i>`;
      }
      const m = new Date(start.getTime() + w * 7 * DAY).getMonth(); months += `<span>${m !== last ? MONTHS[m].slice(0, 3) : ""}</span>`; last = m;
      cols += `<div class="hcol">${cells}</div>`;
    }
    return `<div class="heat-wrap"><div class="heat-m">${months}</div><div class="heat">${cols}</div><div class="small muted">${active} active days · ${Math.round(total)} hours in the last ${weeks} weeks <span class="heat-leg"><i class="hc l0"></i>less<i class="hc l1"></i><i class="hc l2"></i><i class="hc l3"></i><i class="hc l4"></i>more</span></div></div>`;
  };

  // ---------- group pulse + improvement board ----------
  const groupStats = () => {
    const t = {}, s = {}; users().forEach(u => Object.entries(S.progress[u.id]?.tstats || {}).forEach(([k, v]) => {
      if (!TOPIC_MAP[k]) return; const o = (t[k] ||= { c: 0, w: 0 }); o.c += v.c || 0; o.w += v.w || 0; const sub = TOPIC_MAP[k].subject, p = (s[sub] ||= { c: 0, w: 0 }); p.c += v.c || 0; p.w += v.w || 0;
    }));
    return { t, s };
  };
  X.pulseCard = () => {
    const us = users(), wk = weekStart(), tgt = thisTarget(), g = groupStats(), since = new Date(wk + "T00:00:00").getTime();
    const week = S.scores.filter(x => x.mode !== "learning" && (x.at || x.createdAt || 0) >= since && us.some(u => u.id === x.uid));
    const avg = week.length ? Math.round((week.reduce((s, x) => s + x.percent, 0) / week.length) * 10) / 10 : null;
    const weakSub = Object.entries(g.s).filter(([, v]) => v.c + v.w >= 10).map(([k, v]) => ({ k, acc: v.c / (v.c + v.w) * 100 })).sort((a, b) => a.acc - b.acc)[0];
    const focus = Object.entries(g.t).filter(([, v]) => v.c + v.w >= 6).map(([k, v]) => ({ k, acc: v.c / (v.c + v.w) * 100 })).filter(x => x.acc < 75).sort((a, b) => a.acc - b.acc).slice(0, 3);
    const finished = tgt ? us.filter(u => (tgt.topics || []).length && (tgt.topics || []).every(id => ["done", "revised"].includes(statusOf(u.id, id)))).length : null;
    const board = us.map(u => { const sc = S.scores.filter(x => x.uid === u.id && x.mode !== "learning").sort((a, b) => (a.at || 0) - (b.at || 0)); if (sc.length < 2) return null; const first = sc[0].percent, tail = sc.slice(-2), now = tail.reduce((s, x) => s + x.percent, 0) / tail.length; return { u, d: Math.round((now - first) * 10) / 10, n: sc.length }; }).filter(Boolean).sort((a, b) => b.d - a.d);
    return `<section class="card"><h2>🤝 Group pulse <small class="muted">this week</small></h2>
      <div class="pulse">
        ${finished !== null ? `<div><b>${finished}/${us.length}</b><small>finished this week's targets</small></div>` : ""}
        <div><b>${week.length}</b><small>exam-mode tests taken</small></div>
        <div><b>${avg === null ? "–" : avg + "%"}</b><small>average score</small></div>
        <div><b>${weakSub ? esc(X.subjName(weakSub.k)) : "–"}</b><small>group weak area${weakSub ? ` (${Math.round(weakSub.acc)}%)` : ""}</small></div></div>
      ${focus.length ? `<p class="small"><b>Next focus for the group:</b> ${focus.map(x => `${esc(TOPIC_MAP[x.k].name)} <span class="badge off">${Math.round(x.acc)}%</span>`).join(" · ")}</p>` : `<p class="small muted">Group focus appears after a few tests.</p>`}
      ${board.length ? `<h3>📈 Improvement board <small class="muted">latest vs first test – progress, not rank</small></h3>${board.map(b => `<div class="prog-row">${avatar(b.u.id, 22)}<span class="grow">${esc(b.u.name.split(" ")[0])} <small class="muted">${b.n} tests</small></span><b class="${b.d >= 0 ? "up" : "down"}">${b.d >= 0 ? "▲ +" : "▼ "}${b.d}</b></div>`).join("")}` : ""}</section>`;
  };

  // ---------- expert finder ----------
  X.expertsCard = () => {
    const me = S.me.uid, mine = X.stats().byTopic, myWeak = new Set(Object.entries(mine).filter(([, v]) => v.c + v.w >= MIN_Q && v.c / (v.c + v.w) < 0.75).map(([k]) => k));
    const rows = users().filter(u => u.id !== me).map(u => {
      const strong = Object.entries(S.progress[u.id]?.tstats || {}).filter(([k, v]) => TOPIC_MAP[k] && v.c + v.w >= 5 && v.c / (v.c + v.w) >= 0.75).map(([k, v]) => ({ k, n: v.c + v.w, help: myWeak.has(k) || !["done", "revised"].includes(statusOf(me, k)) })).sort((a, b) => b.help - a.help || b.n - a.n).slice(0, 4);
      return { u, strong };
    }).filter(r => r.strong.length);
    return `<section class="card"><h2>🧑‍🏫 Who can help me?</h2><p class="small muted">Friends with ≥ 75% accuracy (5+ questions) – ⭐ marks topics you haven't mastered yet.</p>
      ${rows.map(r => `<div class="li">${avatar(r.u.id, 24)}<span class="grow"><b>Ask ${esc(r.u.name.split(" ")[0])} about:</b> ${r.strong.map(x => `<span class="chip" data-topic="${x.k}">${x.help ? "⭐ " : "✅ "}${esc(TOPIC_MAP[x.k].name)}</span>`).join(" ")}</span></div>`).join("") || `<p class="empty">Appears once friends have taken a few tests.</p>`}</section>`;
  };
}
