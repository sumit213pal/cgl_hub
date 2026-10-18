// CSV → questions (+ full papers). Validation, duplicate detection, import.
import { SUBJECTS, SUBJECT_MAP } from "./syllabus.js";

export const HEADERS = ["questionId", "paperName", "examDate", "year", "shift", "qno", "subject", "topic", "difficulty", "question", "optionA", "optionB", "optionC", "optionD", "correctOption", "explanation", "videoLink", "imageUrl", "source"];
const norm = s => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const STOP = new Set(["and", "the", "for", "with", "from", "test", "of"]);
const toks = s => String(s ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const stripParen = s => String(s ?? "").replace(/\([^)]*\)/g, "");
export const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const KEYS = Object.fromEntries(HEADERS.map(h => [norm(h), norm(h)]));
const ALIAS = { id: "questionid", qid: "questionid", paper: "papername", exam: "papername", date: "examdate", paperdate: "examdate", testdate: "examdate", no: "qno", qn: "qno", qnum: "qno", questionno: "qno", questionnumber: "qno", sno: "qno",
  level: "difficulty", diff: "difficulty", questiontext: "question", ques: "question", q: "question", a: "optiona", b: "optionb", c: "optionc", d: "optiond", opta: "optiona", optb: "optionb", optc: "optionc", optd: "optiond",
  option1: "optiona", option2: "optionb", option3: "optionc", option4: "optiond", answer: "correctoption", correct: "correctoption", correctanswer: "correctoption", ans: "correctoption", key: "correctoption",
  solution: "explanation", explain: "explanation", video: "videolink", videourl: "videolink", youtube: "videolink", youtubelink: "videolink", image: "imageurl", img: "imageurl", imagelink: "imageurl", figure: "imageurl" };
const canon = h => { const n = norm(h); return KEYS[n] || ALIAS[n] || n; };

export function parseCSV(text) {
  text = String(text || "").replace(/^\uFEFF/, ""); if (!text.trim()) return [];
  const first = text.split(/\r?\n/, 1)[0], delim = [",", "\t", ";"].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x.trim() !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(canon);
  return rows.slice(1).map((r, i) => { const o = { _row: i + 2 }; head.forEach((h, j) => { if (h) o[h] = (r[j] ?? "").trim(); }); return o; });
}
export function toCSV(rows, headers) {
  const q = v => { v = String(v ?? ""); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [headers.join(","), ...rows.map(r => headers.map(h => q(r[h])).join(","))].join("\r\n");
}
export function hash(str) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
  return h1.toString(36) + h2.toString(36);
}
const nt = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const fingerprint = (q, opts) => ({ tk: hash(nt(q)).slice(0, 8), ok: hash(opts.map(nt).sort().join("|")).slice(0, 8) });
export function normDate(v) {
  v = String(v || "").trim(); if (!v) return ""; const p = n => String(n).padStart(2, "0"); let m;
  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  if ((m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return `${m[3]}-${p(m[2])}-${p(m[1])}`;
  const t = Date.parse(v); if (!isNaN(t)) { const d = new Date(t); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; } return "";
}
const paperKey = ({ paperName, examDate, year, shift }) => (paperName ? `${slug(paperName)}_${examDate || year || "x"}_${slug(shift) || "x"}` : "");
const tierOf = n => (/tier[\s-]*(ii|2)\b/i.test(n || "") ? "Tier II" : "Tier I");
const SUBJ = { quant: ["quant", "quantitative", "quantitativeaptitude", "maths", "math", "mathematics", "aptitude"], reasoning: ["reasoning", "generalintelligencereasoning", "generalintelligenceandreasoning", "generalintelligence", "gi", "logicalreasoning"],
  english: ["english", "englishcomprehension", "englishlanguage"], ga: ["ga", "gk", "gkga", "generalawareness", "generalknowledge", "gs", "generalstudies"], computer: ["computer", "computers", "computerknowledge"], stats: ["stats", "statistics", "statisticsjso"] };
const mapSubject = v => { const n = norm(v); for (const s of SUBJECTS) if (n === norm(s.id) || n === norm(s.name) || SUBJ[s.id]?.includes(n)) return s.id; return null; };
function mapTopic(sid, v) {
  const sub = SUBJECT_MAP[sid], n = norm(v), ns = norm(stripParen(v)); if (!n) return { error: "topic is empty" };
  for (const t of sub.topics) if (n === norm(t.name) || ns === norm(stripParen(t.name)) || n === norm(t.id)) return { topic: t, auto: false };
  const vt = new Set(toks(v));
  if (vt.size) {
    const sc = sub.topics.map(t => { const tt = new Set(toks(t.name)), i = [...vt].filter(x => tt.has(x)).length, u = new Set([...vt, ...tt]).size; return { t, s: u ? i / u : 0 }; }).sort((a, b) => b.s - a.s);
    if (sc[0].s >= 0.5 && (sc[1]?.s ?? 0) < sc[0].s) return { topic: sc[0].t, auto: true };
    const sug = sc.filter(x => x.s > 0).slice(0, 3).map(x => x.t.name);
    return { error: `unknown topic "${v}" for ${sub.short}` + (sug.length ? ` – did you mean: ${sug.join(" | ")}?` : "") };
  }
  return { error: `unknown topic "${v}" for ${sub.short}` };
}
const DIFF = { e: "easy", easy: "easy", simple: "easy", m: "medium", medium: "medium", moderate: "medium", h: "hard", hard: "hard", difficult: "hard" };
function parseCorrect(v, opts) {
  const s = String(v ?? "").trim(); if (!s) return -1; let m;
  if ((m = s.match(/^(?:option\s*)?\(?([A-Da-d])\)?[.)]?$/))) return "ABCD".indexOf(m[1].toUpperCase());
  if ((m = s.match(/^([1-4])$/))) return Number(m[1]) - 1;
  return opts.findIndex(o => norm(o) && norm(o) === norm(s));
}
export const emptyBank = () => ({ ids: new Set(), tk: new Map(), ok: new Map() });

/** rows → { valid, errors, dupes, warnings, similar, total }.  bank = what is already stored (see engine.dupMaps). */
export function validateRows(rows, bank = emptyBank(), { overwrite = false } = {}) {
  const valid = [], errors = [], dupes = [], warnings = [], similar = [], seen = new Set(), seenTk = new Map();
  rows.forEach((r, ord) => {
    const bad = msg => errors.push({ row: r._row, msg, raw: r }), warn = msg => warnings.push({ row: r._row, msg });
    const question = (r.question || "").trim(), options = ["optiona", "optionb", "optionc", "optiond"].map(k => (r[k] || "").trim());
    if (!question) return bad("question is empty");
    if (options.some(o => !o)) return bad("one or more options (A–D) are empty");
    if (question.length > 2000) return bad("question is too long (max 2000 characters)");
    const subject = mapSubject(r.subject); if (!subject) return bad(`unknown subject "${r.subject || ""}" (use Quant, Reasoning, English, GA, Computer or Stats)`);
    const tp = mapTopic(subject, r.topic); if (tp.error) return bad(tp.error);
    const correct = parseCorrect(r.correctoption, options); if (correct < 0) return bad(`correctOption "${r.correctoption || ""}" is missing/invalid (must be A, B, C or D)`);
    if (new Set(options.map(norm)).size < 4) warn("two options look identical");
    let difficulty = ""; if (r.difficulty) { difficulty = DIFF[norm(r.difficulty)] || ""; if (!difficulty) warn(`difficulty "${r.difficulty}" ignored`); }
    const examDate = normDate(r.examdate); if (r.examdate && !examDate) warn(`examDate "${r.examdate}" not understood – use YYYY-MM-DD`);
    let year = ""; if (r.year) { const y = parseInt(r.year, 10); if (y >= 1990 && y <= 2100) year = y; else warn(`year "${r.year}" ignored`); } if (!year && examDate) year = Number(examDate.slice(0, 4));
    const link = (k, label) => { const u = (r[k] || "").trim(); if (!u) return ""; if (/^https?:\/\/\S+$/i.test(u)) return u; warn(`${label} is not a valid link – ignored`); return ""; };
    if (tp.auto) warn(`topic "${r.topic}" → "${tp.topic.name}"`);
    const paperName = (r.papername || "").trim().slice(0, 100), shift = (r.shift || "").trim().slice(0, 30), qno = parseInt(r.qno, 10);
    let id = (r.questionid || "").trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60); if (!id) id = "q" + hash(norm(question) + options.map(norm).join("|"));
    const fp = fingerprint(question, options);
    const row = { id, subject, topicId: tp.topic.id, difficulty, year, shift, examDate, qno: isNaN(qno) ? 0 : qno, ord, paperName, paperKey: paperKey({ paperName, examDate, year, shift }), source: (r.source || "").slice(0, 100),
      question, options, correct, explanation: (r.explanation || "").slice(0, 4000), videoUrl: link("videolink", "videoLink"), imageUrl: link("imageurl", "imageUrl"), tk: fp.tk, ok: fp.ok, _row: r._row };
    if (seen.has(id)) return dupes.push({ row: r._row, why: "duplicate inside this file" }); seen.add(id);
    if (bank.ids.has(id) && !overwrite) return dupes.push({ row: r._row, why: "already in the question bank" });
    let sim = null; const bt = bank.tk.get(fp.tk);
    if (bt && bt !== id) sim = "same question text as a question already in the bank";
    else if (options.join("").length >= 12 && bank.ok.get(fp.ok + "|" + row.topicId) && bank.ok.get(fp.ok + "|" + row.topicId) !== id) sim = "same four options in the same topic as a question in the bank";
    else if (seenTk.has(fp.tk)) sim = "same question text as row " + seenTk.get(fp.tk);
    if (sim) similar.push({ row: r._row, question: question.slice(0, 90), why: sim });
    seenTk.set(fp.tk, r._row); valid.push(row);
  });
  return { valid, errors, dupes, warnings, similar, total: rows.length };
}

/** Group valid rows into full papers (same paperName + examDate/year + shift). */
export function groupPapers(valid, errors = []) {
  const g = {};
  valid.forEach(r => { if (!r.paperKey) return; const p = (g[r.paperKey] ||= { key: r.paperKey, paperName: r.paperName, examDate: r.examDate, year: r.year, shift: r.shift, tier: tierOf(r.paperName), rows: [], bySubject: {}, rejected: 0, noExpl: 0, noImg: 0 });
    p.rows.push(r); p.bySubject[r.subject] = (p.bySubject[r.subject] || 0) + 1; if (!r.explanation) p.noExpl++; if (/\(figure\)/i.test(r.question) && !r.imageUrl) p.noImg++; });
  errors.forEach(e => { const k = paperKey({ paperName: (e.raw.papername || "").trim().slice(0, 100), examDate: normDate(e.raw.examdate), year: parseInt(e.raw.year, 10) || "", shift: (e.raw.shift || "").trim().slice(0, 30) }); if (k && g[k]) g[k].rejected++; });
  return Object.values(g).map(p => ({ ...p, total: p.rows.length }));
}
const fmtD = iso => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
export function paperDoc(p) {
  const rows = [...p.rows].sort((a, b) => (a.qno || 1e9) - (b.qno || 1e9) || a.ord - b.ord), order = [];
  rows.forEach(r => { if (!order.includes(r.subject)) order.push(r.subject); });
  const ordered = order.flatMap(s => rows.filter(r => r.subject === s));
  return { title: [p.paperName, fmtD(p.examDate), p.shift].filter(Boolean).join(" · "), paperName: p.paperName, examDate: p.examDate || "", year: p.year || "", shift: p.shift || "", tier: p.tier || tierOf(p.paperName),
    qids: ordered.map(r => r.id), qmeta: Object.fromEntries(ordered.map(r => [r.id, r.subject + "|" + r.topicId])), sections: order.map(s => ({ subject: s, count: ordered.filter(r => r.subject === s).length })), total: ordered.length };
}
export const paperDefaults = () => ({ timerType: "section", paperMode: "auto", secPerQ: 45, manualMin: 0, minBySub: {}, pos: 2, neg: 0.5, maxAttempts: 0, published: true, availableFrom: 0, availableUntil: 0 });
export const indexString = r => `${r.id}|${r.topicId}|${(r.difficulty || "")[0] || ""}|${r.year || ""}|${r.tk || ""}|${r.ok || ""}`;
const pubFields = r => ({ subject: r.subject, topicId: r.topicId, difficulty: r.difficulty || "", year: r.year || "", shift: r.shift || "", examDate: r.examDate || "", paperName: r.paperName || "", qno: r.qno || 0, source: r.source || "", question: r.question, options: r.options, imageUrl: r.imageUrl || "", active: true });
const keyFields = r => ({ correct: r.correct, explanation: r.explanation || "", videoUrl: r.videoUrl || "" });

/** Writes questions + answer keys + per-subject index (+ papers). Returns which answers changed (so past scores can be recalculated). */
export async function importQuestions(db, rows, { papers = [] } = {}) {
  if (!rows.length) return { n: 0, papers: 0, changed: [] };
  const olds = Object.fromEntries((await db.getMany("answerKeys", rows.map(r => r.id))).map(k => [k.id, k]));
  const changed = rows.filter(r => olds[r.id] && olds[r.id].correct !== r.correct).map(r => ({ id: r.id, correct: r.correct }));
  await db.batchSet(rows.flatMap(r => [{ col: "questions", id: r.id, data: { ...pubFields(r), createdAt: Date.now() } }, { col: "answerKeys", id: r.id, data: keyFields(r) }]));
  const by = {}; rows.forEach(r => (by[r.subject] ||= []).push(r));
  for (const [sub, list] of Object.entries(by)) {
    const cur = (await db.get("qindex", sub))?.items || [], ids = new Set(list.map(r => r.id));
    await db.set("qindex", sub, { items: cur.filter(s => !ids.has(s.split("|")[0])).concat(list.map(indexString)) });
  }
  for (const p of papers) { const d = paperDoc(p), old = await db.get("papers", p.key); await db.set("papers", p.key, old ? d : { ...d, ...paperDefaults(), createdAt: Date.now() }); }
  return { n: rows.length, papers: papers.length, changed };
}
export async function removeFromIndex(db, subject, id) { const cur = (await db.get("qindex", subject))?.items || []; await db.set("qindex", subject, { items: cur.filter(s => s.split("|")[0] !== id) }); }

export function aiPrompt() {
  const topics = SUBJECTS.map(s => `${s.short}:\n  ${s.topics.map(t => t.name).join(" | ")}`).join("\n\n");
  return `Convert the attached SSC CGL question paper (PDF) into a CSV file for my study website.
(Use only papers I am allowed to reuse – for example official papers published by SSC, with the source acknowledged.)

OUTPUT: only the CSV text – no explanation, no markdown code fence. First line must be exactly this header:
${HEADERS.join(",")}

RULES
1. One row per question. Put every field in double quotes. A double quote inside a field is written as "".
2. subject must be one of: Quant, Reasoning, English, GA, Computer, Stats
3. topic must be EXACTLY one of the topic names listed below for that subject (copy the spelling). Pick the closest one.
4. difficulty: Easy, Medium or Hard (or leave empty).
5. correctOption: a single letter A, B, C or D. Use the answer key in the PDF; if there is none, solve the question carefully. If you are not sure, leave it EMPTY – never guess.
6. explanation: short step-by-step solution in plain text (2-5 lines).
7. Write maths in plain Unicode (√ ² ³ π × ÷ ≤ ≥ ½ °). Fractions as a/b. No LaTeX.
8. If a question depends on a figure/table/image, still add the row and put "(figure)" in the question; leave imageUrl empty.
9. paperName e.g. "SSC CGL Tier-I"; examDate as YYYY-MM-DD (e.g. 2025-09-12); year as 4 digits; shift e.g. "Shift 1".
   Use EXACTLY the same paperName, examDate, year and shift on every row of one paper – the website groups rows by these into one full mock paper.
10. qno = the question number printed in the PDF. Keep the paper's original order. source = where the paper comes from (e.g. "SSC official paper").
11. Leave questionId and videoLink empty.
12. Do not skip or merge questions. Keep the original question text.

TOPIC NAMES
${topics}`;
}
