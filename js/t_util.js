// Pure helpers + tiny chart renderers (no external chart library needed).
export const MIN_Q = 3;      // min attempted questions before a topic is judged Strong/Weak
export const STRONG = 75;    // accuracy % ≥ this → Strong
export const WEAK = 50;      // accuracy % < this → Weak
export const DAY = 86400000;
// suggested seconds per question for section timers (admin can override per test / paper)
export const DEFAULT_SEC = { quant: 50, reasoning: 35, english: 35, ga: 25, computer: 40, stats: 60 };
// spaced revision of wrong questions: first review after 1 day, then 3 days; "mastered" after 2 correct answers on separate days
export const SPACED = [1, 3, 7, 21];
export const MASTER_AFTER = 2;

export const REASONS = { concept: "Concept weak", calc: "Calculation mistake", silly: "Silly mistake", time: "Time pressure", guess: "Guess" };
export const KIND = { mock: "Mock", paper: "Paper", practice: "Practice", smart: "Revision", retest: "Retest", mistakes: "Mistakes", weak: "Weak topics", topic: "Topic", daily: "Daily drill" };
export const DIFFS = { easy: "Easy", medium: "Medium", hard: "Hard" };
export const REPORT_REASONS = ["Wrong answer key", "Incorrect option", "Question incomplete", "Explanation unclear", "Duplicate question", "Image missing", "Other"];
export const VAULT_KINDS = { formula: "📐 Formula", trick: "⚡ Trick", pattern: "🔍 PYQ pattern", mistake: "⚠️ Common mistake" };
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const r1 = n => Math.round(n * 10) / 10;
export const r2 = n => Math.round(n * 100) / 100;
export const rate = (c, w) => (c + w ? r1((c / (c + w)) * 100) : null);
export const p2 = n => String(n).padStart(2, "0");

export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const weekStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); };
export const fmtDur = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; if (!m) return `${r} sec`; return r ? `${m} min ${r} sec` : `${m} min`; };
export const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${p2(m)}:${p2(r)}` : `${p2(m)}:${p2(r)}`; };
export const fmtDate = t => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "");
export const fmtDay = iso => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
export const fmtDateTime = t => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
export const toLocalInput = ms => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
export const fromLocalInput = s => (s ? new Date(s).getTime() || 0 : 0);

export const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
export const setPath = (o, p, v) => { const ks = p.split("."); let x = o; ks.slice(0, -1).forEach(k => (x = x[k] ??= {})); x[ks.at(-1)] = v; };

// "2:540,1:300" → [{o:2,rem:540},{o:1,rem:300}]   (o = original option index, -1 = cleared; rem = seconds left on the active timer, -1 = untimed)
export const parseHist = s => String(s || "").split(",").filter(Boolean).map(x => { const [o, rem] = x.split(":"); return { o: Number(o), rem: Number(rem) }; });

export function topicState(v) {
  const att = v.c + v.w;
  if (att < MIN_Q) return { k: "low", label: "Few questions", cls: "low" };
  const acc = (v.c / att) * 100;
  if (acc >= STRONG) return { k: "strong", label: "Strong", cls: "ok" };
  if (acc >= WEAK) return { k: "mid", label: "Needs revision", cls: "warn" };
  return { k: "weak", label: "Weak", cls: "off" };
}

export function imgUrl(u) {
  const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : u;
}

export function download(name, text, mime = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([name.endsWith(".csv") ? "\uFEFF" + text : text], { type: mime + ";charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

/**
 * Timer plan for a test / paper.  cfg = { timerType:'none'|'paper'|'section', paperMode:'auto'|'manual', secPerQ, manualMin, secBySub:{}, minBySub:{} }
 * groups = [{sub, n}]  →  { type, total, durationSec, sections:[{sub,n,sec,manual}] }
 * Auto = questions × seconds/question.  Manual minutes (when > 0) override the automatic value.
 */
export function timerPlan(cfg, groups) {
  const total = groups.reduce((s, g) => s + g.n, 0), type = cfg?.timerType || "none";
  if (type === "none") return { type, total, durationSec: 0, sections: [] };
  if (type === "paper") {
    const sec = cfg.paperMode === "manual" && Number(cfg.manualMin) > 0 ? Math.round(cfg.manualMin * 60) : Math.round(total * (Number(cfg.secPerQ) || 45));
    return { type, total, durationSec: sec, sections: [] };
  }
  const sections = groups.map(g => {
    const mn = Number(cfg.minBySub?.[g.sub]) || 0, per = Number(cfg.secBySub?.[g.sub]) || DEFAULT_SEC[g.sub] || 45;
    return { sub: g.sub, n: g.n, sec: mn > 0 ? Math.round(mn * 60) : Math.round(g.n * per), manual: mn > 0 };
  });
  return { type, total, durationSec: sections.reduce((s, x) => s + x.sec, 0), sections };
}

// ---- charts ----
export function donut(c, w, u) {
  const t = c + w + u || 1, a = (c / t) * 100, b = a + (w / t) * 100;
  return `<div class="donut" style="background:conic-gradient(#10b981 0 ${a}%,#ef4444 ${a}% ${b}%,#d1d5db ${b}% 100%)"><span>${Math.round(a)}%</span><small>correct</small></div>`;
}
export function stack(c, w, u) {
  const t = c + w + u || 1;
  return `<div class="stack" title="${c} correct · ${w} wrong · ${u} skipped"><i style="width:${(c / t) * 100}%;background:#10b981"></i><i style="width:${(w / t) * 100}%;background:#ef4444"></i><i style="width:${(u / t) * 100}%;background:#d1d5db"></i></div>`;
}
export function ring(pct, label, color = "#4f46e5") {
  return `<div class="ring" style="background:conic-gradient(${color} 0 ${pct}%,#e5e7eb ${pct}% 100%)"><span>${Math.round(pct)}<small>/100</small></span></div><div class="ring-l">${label}</div>`;
}
export function trendSVG(series, xlabels) {
  const n = Math.max(...series.map(s => s.vals.length));
  if (n < 2) return `<p class="empty">Take at least 2 tests to see a trend.</p>`;
  const W = 320, H = 130, x = i => 14 + (i * (W - 28)) / (n - 1), y = v => 10 + (100 - Math.max(0, Math.min(100, v)));
  const grid = [0, 50, 100].map(g => `<line x1="14" x2="${W - 14}" y1="${y(g)}" y2="${y(g)}" stroke="#e5e7eb"/><text x="0" y="${y(g) + 3}" font-size="8" fill="#9ca3af">${g}</text>`).join("");
  const lines = series.map(s => {
    const pts = s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>` +
      s.vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${xlabels?.[i] ? xlabels[i] + " – " : ""}${s.name}: ${v}%</title></circle>`).join("");
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend">${grid}${lines}</svg><div class="legend">${series.map(s => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>`;
}
export const heatLevel = h => (h <= 0 ? 0 : h < 1 ? 1 : h < 2 ? 2 : h < 4 ? 3 : 4);
