// Pure helpers + tiny chart renderers (no external chart library needed).
export const MIN_Q = 3;      // min attempted questions before a topic is judged Strong/Weak
export const STRONG = 75;    // accuracy % ≥ this → Strong
export const WEAK = 50;      // accuracy % < this → Weak

export const REASONS = { concept: "Concept weak", calc: "Calculation mistake", silly: "Silly mistake", time: "Time pressure", guess: "Guess" };
export const KIND = { mock: "Mock", practice: "Practice", smart: "Revision", retest: "Retest", mistakes: "Mistakes", weak: "Weak topics", topic: "Topic" };
export const DIFFS = { easy: "Easy", medium: "Medium", hard: "Hard" };
export const REPORT_REASONS = ["Wrong answer key", "Incorrect option", "Question incomplete", "Explanation unclear", "Duplicate question", "Image missing", "Other"];

export const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const r1 = n => Math.round(n * 10) / 10;
export const r2 = n => Math.round(n * 100) / 100;
export const rate = (c, w) => (c + w ? r1((c / (c + w)) * 100) : null);

export const fmtDur = s => { s = Math.round(s); const m = Math.floor(s / 60), r = s % 60; if (!m) return `${r} sec`; return r ? `${m} min ${r} sec` : `${m} min`; };
export const clock = s => {
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = n => String(n).padStart(2, "0"); return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
};
export const fmtDate = t => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "");

export const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
export const setPath = (o, p, v) => { const ks = p.split("."); let x = o; ks.slice(0, -1).forEach(k => (x = x[k])); x[ks.at(-1)] = v; };

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
export function trendSVG(series) {
  const n = Math.max(...series.map(s => s.vals.length));
  if (n < 2) return `<p class="empty">Take at least 2 tests to see a trend.</p>`;
  const W = 320, H = 130, x = i => 14 + (i * (W - 28)) / (n - 1), y = v => 10 + (100 - Math.max(0, Math.min(100, v)));
  const grid = [0, 50, 100].map(g => `<line x1="14" x2="${W - 14}" y1="${y(g)}" y2="${y(g)}" stroke="#e5e7eb"/><text x="0" y="${y(g) + 3}" font-size="8" fill="#9ca3af">${g}</text>`).join("");
  const lines = series.map(s => {
    const pts = s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>` +
      s.vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${s.name}: ${v}%</title></circle>`).join("");
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend">${grid}${lines}</svg><div class="legend">${series.map(s => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>`;
}
