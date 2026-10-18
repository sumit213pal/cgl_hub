// Small pure helpers.
export const DAY = 86400000;
export const MIN_Q = 3, STRONG = 75, WEAK = 50;                       // topic is judged only after MIN_Q attempted questions
export const DEFAULT_SEC = { quant: 50, reasoning: 35, english: 35, ga: 25, computer: 40, stats: 60 };   // auto seconds per question, per section
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const r1 = n => Math.round(n * 10) / 10;
export const r2 = n => Math.round(n * 100) / 100;
export const rate = (c, w) => (c + w ? r1((c / (c + w)) * 100) : null);
const p2 = n => String(n).padStart(2, "0");
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const fmtDur = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; if (!m) return `${r}s`; return r ? `${m}m ${r}s` : `${m}m`; };
export const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${p2(m)}:${p2(r)}` : `${p2(m)}:${p2(r)}`; };
export const fmtDate = t => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "");
export const fmtDay = iso => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
export const fmtDateTime = t => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
export const toLocalInput = ms => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
export const fromLocalInput = s => (s ? new Date(s).getTime() || 0 : 0);
export const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.round(m / 60); return h < 24 ? h + "h ago" : Math.round(h / 24) + "d ago"; };
export const isUrl = u => /^https?:\/\/\S+$/i.test(u);
export const ytId = url => (String(url).match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/) || [])[1] || null;
export function drivePreview(url) {
  const m = String(url).match(/\/file\/d\/([\w-]+)/); if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  const d = String(url).match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/); return d ? `https://docs.google.com/${d[1]}/d/${d[2]}/preview` : null;
}
export const imgUrl = u => { const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/); return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : u; };
export function genPw() { const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint32Array(10)); return "Cgl@" + [...r].slice(0, 6).map(x => c[x % c.length]).join(""); }
export function download(name, text, mime = "text/csv") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([name.endsWith(".csv") ? "\uFEFF" + text : text], { type: mime + ";charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
export function topicState(v) {
  const att = v.c + v.w; if (att < MIN_Q) return { k: "low", label: "Too few questions", cls: "low" };
  const acc = (v.c / att) * 100;
  return acc >= STRONG ? { k: "strong", label: "Strong", cls: "ok" } : acc >= WEAK ? { k: "mid", label: "Needs revision", cls: "warn" } : { k: "weak", label: "Weak", cls: "off" };
}
/** Timer plan.  cfg = {timerType:'none'|'paper'|'section', paperMode:'auto'|'manual', secPerQ, manualMin, minBySub:{sub:minutes}}  groups = [{sub,n}]
 *  Auto = questions × seconds per question.  A manual minutes value (> 0) always overrides the automatic one. */
export function timerPlan(cfg, groups) {
  const total = groups.reduce((s, g) => s + g.n, 0), type = cfg?.timerType || "none";
  if (type === "none") return { type, total, durationSec: 0, sections: [] };
  if (type === "paper") return { type, total, sections: [], durationSec: cfg.paperMode === "manual" && Number(cfg.manualMin) > 0 ? Math.round(cfg.manualMin * 60) : Math.round(total * (Number(cfg.secPerQ) || 45)) };
  const sections = groups.map(g => { const mn = Number(cfg.minBySub?.[g.sub]) || 0; return { sub: g.sub, n: g.n, sec: mn > 0 ? Math.round(mn * 60) : Math.round(g.n * (DEFAULT_SEC[g.sub] || 45)), manual: mn > 0 }; });
  return { type, total, sections, durationSec: sections.reduce((s, x) => s + x.sec, 0) };
}
export const stack = (c, w, u) => { const t = c + w + u || 1; return `<div class="stack" title="${c} correct · ${w} wrong · ${u} skipped"><i style="width:${c / t * 100}%;background:#10b981"></i><i style="width:${w / t * 100}%;background:#ef4444"></i><i style="width:${u / t * 100}%;background:#d1d5db"></i></div>`; };
export function trendSVG(vals, labels) {
  if (vals.length < 2) return `<p class="empty">Take at least 2 tests to see a trend.</p>`;
  const W = 320, H = 120, n = vals.length, x = i => 16 + (i * (W - 32)) / (n - 1), y = v => 8 + (100 - Math.max(0, Math.min(100, v)));
  const grid = [0, 50, 100].map(g => `<line x1="16" x2="${W - 16}" y1="${y(g)}" y2="${y(g)}" stroke="#e5e7eb"/><text x="0" y="${y(g) + 3}" font-size="8" fill="#9ca3af">${g}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend">${grid}<polyline fill="none" stroke="#4f46e5" stroke-width="2" points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#4f46e5"><title>${labels?.[i] || ""} ${v}%</title></circle>`).join("")}</svg>`;
}
