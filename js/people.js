// Members + progress helpers.
import { ALL_TOPICS, SUBJECT_MAP } from "./syllabus.js";
import { S } from "./state.js";
import { esc, DAY } from "./util.js";
export const STATUS = { none: "Not started", learning: "In progress", done: "Done" };
export const COLORS = ["#4f46e5", "#e11d48", "#059669", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#65a30d"];
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const users = () => S.members.filter(m => m.uid && m.active !== false).map(m => ({ id: m.uid, name: m.name || m.id, email: m.id, role: m.role, lastSeen: m.lastSeen })).sort((a, b) => (b.role === "admin") - (a.role === "admin") || a.name.localeCompare(b.name));
export const nameOf = uid => (S.members.find(m => m.uid === uid)?.name || "Someone").split(" ")[0];
export const color = uid => COLORS[Math.max(0, users().findIndex(u => u.id === uid)) % COLORS.length];
export const avatar = (uid, size = 28) => { const n = (S.members.find(m => m.uid === uid)?.name || "?").trim(); return `<span class="av" style="width:${size}px;height:${size}px;background:${color(uid)}" title="${esc(n)}">${esc(n[0].toUpperCase())}</span>`; };
export const statusOf = (uid, tid) => S.progress[uid]?.topics?.[tid] || "none";
export function pct(uid, sid) { const list = sid ? SUBJECT_MAP[sid].topics : ALL_TOPICS; return Math.round(list.filter(t => statusOf(uid, t.id) === "done").length / list.length * 100); }
export function streak(uid) {
  const days = new Set(S.logs.filter(l => l.uid === uid && Number(l.hours) > 0).map(l => l.date)), d = new Date(today()); let n = 0;
  if (!days.has(today())) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); } return n;
}
export const weekHours = uid => { const from = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10); return Math.round(S.logs.filter(l => l.uid === uid && l.date >= from).reduce((a, l) => a + Number(l.hours || 0), 0) * 10) / 10; };
