// CSV parsing + validation + import for the question bank and full-paper (year/date/shift) library.
import { SUBJECTS, SUBJECT_MAP } from "./syllabus.js";
import { DEFAULT_SEC } from "./t_util.js";

export const CSV_HEADERS = ["questionId", "paperName", "examDate", "year", "shift", "qno", "subject", "topic", "subtopic", "difficulty",
  "question", "optionA", "optionB", "optionC", "optionD", "correctOption", "explanation", "videoLink", "notesLink", "imageUrl", "source"];
export const CSV_HEADERS_HI = ["questionHi", "optionAHi", "optionBHi", "optionCHi", "optionDHi", "explanationHi"];

const norm = s => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const STOP = new Set(["and", "the", "for", "with", "from", "test", "of"]);
const toks = s => String(s ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const stripParen = s => String(s ?? "").replace(/\([^)]*\)/g, "");
export const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const KEYS = Object.fromEntries([...CSV_HEADERS, ...CSV_HEADERS_HI].map(h => [norm(h), norm(h)]));
const ALIAS = {
  id: "questionid", qid: "questionid", paper: "papername", exam: "papername", papertitle: "papername",
  date: "examdate", paperdate: "examdate", testdate: "examdate", examdt: "examdate",
  no: "qno", qn: "qno", qnum: "qno", questionno: "qno", questionnumber: "qno", sno: "qno", srno: "qno",
  subtopics: "subtopic", level: "difficulty", diff: "difficulty",
  questiontext: "question", ques: "question", q: "question",
  a: "optiona", b: "optionb", c: "optionc", d: "optiond", opta: "optiona", optb: "optionb", optc: "optionc", optd: "optiond",
  option1: "optiona", option2: "optionb", option3: "optionc", option4: "optiond",
  answer: "correctoption", correct: "correctoption", correctanswer: "correctoption", ans: "correctoption", key: "correctoption", correctoptionletter: "correctoption",
  solution: "explanation", explain: "explanation",
  video: "videolink", videourl: "videolink", youtube: "videolink", youtubelink: "videolink",
  notes: "noteslink", notesurl: "noteslink", pdf: "noteslink", pdflink: "noteslink",
  image: "imageurl", img: "imageurl", imagelink: "imageurl", figure: "imageurl",
  hindi: "questionhi", questionhindi: "questionhi", explanationhindi: "explanationhi"
};
const canon = h => { const n = norm(h); return KEYS[n] || ALIAS[n] || n; };

export function parseCSV(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [",", "\t", ";"].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(x => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(canon);
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { if (h) o[h] = (r[j] ?? "").trim(); });
    return o;
  });
}

export function toCSV(rows, headers) {
  const q = v => { v = String(v ?? ""); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [headers.join(","), ...rows.map(r => headers.map(h => q(r[h])).join(","))].join("\r\n");
}

export function hash(str) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
const normTxt = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, "");
/** fingerprints used to spot duplicates: tk = same question text, ok = same set of four options */
export const fingerprint = (question, options) => ({ tk: hash(normTxt(question)).slice(0, 8), ok: hash(options.map(normTxt).sort().join("|")).slice(0, 8) });

export function normDate(v) {
  v = String(v || "").trim(); if (!v) return "";
  const p = n => String(n).padStart(2, "0"); let m;
  if ((m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  if ((m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return `${m[3]}-${p(m[2])}-${p(m[1])}`;
  const t = Date.parse(v); if (!isNaN(t)) { const d = new Date(t); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  return "";
}
export const paperKeyOf = ({ paperName, examDate, year, shift }) => (paperName ? `${slug(paperName)}_${examDate || year || "x"}_${slug(shift) || "x"}` : "");
export const tierOf = name => (/tier[\s-]*(ii|2)\b/i.test(name || "") ? "Tier II" : "Tier I");

const SUBJECT_ALIASES = {
  quant: ["quant", "quantitative", "quantitativeaptitude", "maths", "math", "mathematics", "aptitude", "mathematicalabilities", "mathematicalability"],
  reasoning: ["reasoning", "generalintelligencereasoning", "generalintelligenceandreasoning", "generalintelligence", "gi", "intelligence", "logicalreasoning", "reasoningability", "reasoningandgeneralintelligence"],
  english: ["english", "englishcomprehension", "englishlanguage", "englishlanguageandcomprehension", "englishlanguagecomprehension"],
  ga: ["ga", "gk", "gkga", "generalawareness", "generalknowledge", "gs", "generalstudies"],
  computer: ["computer", "computers", "computerknowledge", "computerknowledgetest"],
  stats: ["stats", "statistics", "statisticsjso", "statisticsjsooptional"]
};
function mapSubject(v) {
  const n = norm(v);
  for (const s of SUBJECTS) if (n === norm(s.id) || n === norm(s.name) || SUBJECT_ALIASES[s.id]?.includes(n)) return s.id;
  return null;
}
function mapTopic(subjectId, v) {
  const sub = SUBJECT_MAP[subjectId], n = norm(v), ns = norm(stripParen(v));
  if (!n) return { error: "topic is empty" };
  for (const t of sub.topics) if (n === norm(t.name) || ns === norm(stripParen(t.name)) || n === norm(t.id)) return { topic: t, auto: false };
  const vt = new Set(toks(v));
  if (vt.size) {
    const scored = sub.topics.map(t => {
      const tt = new Set(toks(t.name));
      const inter = [...vt].filter(x => tt.has(x)).length, uni = new Set([...vt, ...tt]).size;
      return { t, s: uni ? inter / uni : 0 };
    }).sort((a, b) => b.s - a.s);
    if (scored[0].s >= 0.5 && (scored[1]?.s ?? 0) < scored[0].s) return { topic: scored[0].t, auto: true };
    const sug = scored.filter(x => x.s > 0).slice(0, 3).map(x => x.t.name);
    return { error: `unknown topic "${v}" for ${sub.name}` + (sug.length ? ` – did you mean: ${sug.join(" | ")}?` : "") };
  }
  return { error: `unknown topic "${v}" for ${sub.name}` };
}

const DIFF = { e: "easy", easy: "easy", simple: "easy", m: "medium", medium: "medium", moderate: "medium", mod: "medium", h: "hard", hard: "hard", difficult: "hard" };
const isHttp = u => /^https?:\/\/\S+$/i.test(u);
function parseCorrect(v, options) {
  const s = String(v ?? "").trim(); if (!s) return -1;
  let m = s.match(/^(?:option\s*)?\(?([A-Da-d])\)?[.)]?$/); if (m) return "ABCD".indexOf(m[1].toUpperCase());
  m = s.match(/^([1-4])$/); if (m) return Number(m[1]) - 1;
  return options.findIndex(o => norm(o) && norm(o) === norm(s));
}
const jaccard = (a, b) => { let i = 0; a.forEach(x => b.has(x) && i++); const u = a.size + b.size - i; return u ? i / u : 0; };

export const emptyBank = () => ({ ids: new Set(), tk: new Map(), ok: new Map() });

/** rows → {valid, errors, dupes, warnings, similar, total}.  bank = {ids:Set, tk:Map, ok:Map(key = ok|topicId)} of what is already stored. */
export function validateRows(rows, bank = emptyBank(), { overwrite = false } = {}) {
  const valid = [], errors = [], dupes = [], warnings = [], similar = [];
  const seen = new Set(), byTopic = {};
  rows.forEach((r, ord) => {
    const bad = msg => errors.push({ row: r._row, msg, raw: r });
    const warn = msg => warnings.push({ row: r._row, msg });
    const question = (r.question || "").trim();
    const options = ["optiona", "optionb", "optionc", "optiond"].map(k => (r[k] || "").trim());
    if (!question) return bad("question is empty");
    if (options.some(o => !o)) return bad("one or more options (A–D) are empty");
    if (question.length > 2000) return bad("question is too long (max 2000 characters)");
    const subject = mapSubject(r.subject);
    if (!subject) return bad(`unknown subject "${r.subject || ""}" (use Quant, Reasoning, English, GA, Computer or Stats)`);
    const tp = mapTopic(subject, r.topic);
    if (tp.error) return bad(tp.error);
    const correct = parseCorrect(r.correctoption, options);
    if (correct < 0) return bad(`correctOption "${r.correctoption || ""}" is missing/invalid (must be A, B, C or D)`);
    if (new Set(options.map(norm)).size < 4) warn("two options look identical");
    let difficulty = "";
    if (r.difficulty) { difficulty = DIFF[norm(r.difficulty)] || ""; if (!difficulty) warn(`difficulty "${r.difficulty}" ignored (use Easy/Medium/Hard)`); }
    const examDate = normDate(r.examdate); if (r.examdate && !examDate) warn(`examDate "${r.examdate}" not understood – use YYYY-MM-DD`);
    let year = ""; if (r.year) { const y = parseInt(r.year, 10); if (y >= 1990 && y <= 2100) year = y; else warn(`year "${r.year}" ignored`); }
    if (!year && examDate) year = Number(examDate.slice(0, 4));
    const link = (k, label) => { const u = (r[k] || "").trim(); if (!u) return ""; if (isHttp(u)) return u; warn(`${label} is not a valid http(s) link – ignored`); return ""; };
    if (tp.auto) warn(`topic "${r.topic}" auto-mapped to "${tp.topic.name}"`);
    const paperName = (r.papername || "").trim().slice(0, 100), shift = (r.shift || "").trim().slice(0, 30);
    const key = paperKeyOf({ paperName, examDate, year, shift });
    if (paperName && !key.includes("_")) warn("paper could not be grouped");
    const qno = parseInt(r.qno, 10);
    // optional Hindi
    let qHi = "", optionsHi = [];
    const hiOpts = ["optionahi", "optionbhi", "optionchi", "optionDhi".toLowerCase()].map(k => (r[k] || "").trim());
    if ((r.questionhi || "").trim() || hiOpts.some(Boolean)) {
      if ((r.questionhi || "").trim() && hiOpts.every(Boolean)) { qHi = r.questionhi.trim(); optionsHi = hiOpts; }
      else warn("Hindi text needs the question and all four options – Hindi ignored");
    }
    let id = (r.questionid || "").trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
    if (!id) id = "q" + hash(norm(question) + options.map(norm).join("|"));
    const fp = fingerprint(question, options);
    const row = {
      id, subject, topicId: tp.topic.id, topicName: tp.topic.name, subtopic: (r.subtopic || "").slice(0, 80), difficulty, year, shift, examDate,
      qno: isNaN(qno) ? 0 : qno, ord, paperName, paperKey: key, source: (r.source || "").slice(0, 100),
      question, options, correct, explanation: (r.explanation || "").slice(0, 4000),
      videoUrl: link("videolink", "videoLink"), notesUrl: link("noteslink", "notesLink"), imageUrl: link("imageurl", "imageUrl"),
      qHi, optionsHi, explanationHi: (r.explanationhi || "").slice(0, 4000), tk: fp.tk, ok: fp.ok, _row: r._row, exists: false
    };
    if (seen.has(id)) return dupes.push({ row: r._row, id, why: "duplicate inside this file" });
    seen.add(id);
    if (bank.ids.has(id)) { if (!overwrite) return dupes.push({ row: r._row, id, why: "already in question bank" }); row.exists = true; }
    // near-duplicates (kept in the import unless the admin chooses to skip them)
    let sim = null;
    const bt = bank.tk.get(fp.tk); if (bt && bt !== id) sim = { other: "bank question " + bt, why: "same question text, different options" };
    const optLen = options.join("").length;
    if (!sim && optLen >= 12) { const bo = bank.ok.get(fp.ok + "|" + row.topicId); if (bo && bo !== id) sim = { other: "bank question " + bo, why: "same four options in the same topic" }; }
    const tokSet = new Set(toks(question)); row._tok = tokSet;
    if (!sim) for (const p of byTopic[row.topicId] || []) {
      if (p.tk === fp.tk) { sim = { other: "row " + p._row, why: "same question text" }; break; }
      if (tokSet.size >= 4 && jaccard(tokSet, p._tok) >= 0.8) { sim = { other: "row " + p._row, why: "very similar wording" }; break; }
      if (optLen >= 12 && p.ok === fp.ok) { sim = { other: "row " + p._row, why: "same four options" }; break; }
    }
    if (sim) similar.push({ row: r._row, id, question: question.slice(0, 90), ...sim });
    (byTopic[row.topicId] ||= []).push(row);
    valid.push(row);
  });
  return { valid, errors, dupes, warnings, similar, total: rows.length };
}

/** group valid rows into full papers (same paperName + examDate/year + shift) with completeness checks */
export function groupPapers(valid, errors = []) {
  const g = {};
  valid.forEach(r => {
    if (!r.paperKey) return;
    const p = (g[r.paperKey] ||= { key: r.paperKey, paperName: r.paperName, examDate: r.examDate, year: r.year, shift: r.shift, tier: tierOf(r.paperName), rows: [], bySubject: {}, rejected: 0, noExpl: 0, noImg: 0 });
    p.rows.push(r); p.bySubject[r.subject] = (p.bySubject[r.subject] || 0) + 1;
    if (!r.explanation) p.noExpl++;
    if (/\(figure\)/i.test(r.question) && !r.imageUrl) p.noImg++;
  });
  errors.forEach(e => {
    const k = paperKeyOf({ paperName: (e.raw.papername || "").trim().slice(0, 100), examDate: normDate(e.raw.examdate), year: parseInt(e.raw.year, 10) || "", shift: (e.raw.shift || "").trim().slice(0, 30) });
    if (k && g[k]) g[k].rejected++;
  });
  return Object.values(g).map(p => ({ ...p, total: p.rows.length }));
}

const fmtD = iso => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
/** build the paper document (questions ordered by qno; sections in order of first appearance) */
export function paperDoc(p) {
  const rows = [...p.rows].sort((a, b) => (a.qno || 1e9) - (b.qno || 1e9) || a.ord - b.ord);
  const order = []; rows.forEach(r => { if (!order.includes(r.subject)) order.push(r.subject); });
  const ordered = order.flatMap(s => rows.filter(r => r.subject === s));
  return {
    title: [p.paperName, fmtD(p.examDate), p.shift].filter(Boolean).join(" · "),
    paperName: p.paperName, examDate: p.examDate || "", year: p.year || "", shift: p.shift || "", tier: p.tier || tierOf(p.paperName),
    qids: ordered.map(r => r.id), qmeta: Object.fromEntries(ordered.map(r => [r.id, r.subject + "|" + r.topicId])),
    sections: order.map(s => ({ subject: s, count: ordered.filter(r => r.subject === s).length })), total: ordered.length
  };
}
export const paperDefaults = () => ({
  timerType: "section", paperMode: "auto", secPerQ: 45, manualMin: 0, secBySub: { ...DEFAULT_SEC }, minBySub: {},
  pos: 2, neg: 0.5, maxAttempts: 0, published: true, requireVerified: false, shuffleOpt: false, availableFrom: 0, availableUntil: 0, solutionsAfter: "now"
});

const dl = r => (r.difficulty || "")[0] || "";
export const indexString = (r, status = "review") => `${r.id}|${r.topicId}|${dl(r)}|${r.year || ""}|${status === "verified" ? "v" : "r"}|${r.tk || ""}|${r.ok || ""}`;
export const pubFields = r => ({
  subject: r.subject, topicId: r.topicId, subtopic: r.subtopic || "", difficulty: r.difficulty || "", year: r.year || "", shift: r.shift || "", examDate: r.examDate || "",
  paperName: r.paperName || "", paperKey: r.paperKey || "", qno: r.qno || 0, source: r.source || "", question: r.question, options: r.options, imageUrl: r.imageUrl || "",
  qHi: r.qHi || "", optionsHi: r.optionsHi || [], active: true, updatedAt: Date.now()
});
export const keyFields = r => ({ correct: r.correct, explanation: r.explanation || "", explanationHi: r.explanationHi || "", videoUrl: r.videoUrl || "", notesUrl: r.notesUrl || "" });

/** Write questions + answer keys (with version log) + per-subject search index + full-paper documents. */
export async function importQuestions(db, rows, opts = {}) {
  if (!rows.length) return { n: 0, papers: 0 };
  const status = opts.status === "verified" ? "verified" : "review", now = Date.now();
  const over = rows.filter(r => r.exists || opts.existing?.has(r.id)), oldKeys = {};
  if (over.length) (await db.getMany("answerKeys", over.map(r => r.id))).forEach(k => (oldKeys[k.id] = k));
  const items = rows.flatMap(r => {
    const old = oldKeys[r.id], key = keyFields(r);
    if (old) {
      const changed = old.correct !== r.correct;
      key.ver = (old.ver || 1) + (changed ? 1 : 0);
      key.log = [...(old.log || []), ...(changed ? [{ from: old.correct, to: r.correct, at: now, reason: opts.reason || "CSV re-import" }] : [])];
    } else { key.ver = 1; key.log = []; }
    return [{ col: "questions", id: r.id, data: { ...pubFields(r), status, createdAt: now } }, { col: "answerKeys", id: r.id, data: key }];
  });
  await db.batchSet(items);
  const by = {}; rows.forEach(r => (by[r.subject] ||= []).push(r));
  for (const [sub, list] of Object.entries(by)) {
    const cur = (await db.get("qindex", sub))?.items || [], ids = new Set(list.map(r => r.id));
    await db.set("qindex", sub, { items: cur.filter(s => !ids.has(s.split("|")[0])).concat(list.map(r => indexString(r, status))), updatedAt: now });
  }
  let np = 0;
  for (const p of opts.papers || []) {
    const d = paperDoc(p), old = await db.get("papers", p.key);
    await db.set("papers", p.key, old ? { ...d, updatedAt: now } : { ...d, ...paperDefaults(), createdAt: now });
    np++;
  }
  return { n: rows.length, papers: np };
}

export async function removeFromIndex(db, subject, id) {
  const cur = (await db.get("qindex", subject))?.items || [];
  await db.set("qindex", subject, { items: cur.filter(s => s.split("|")[0] !== id), updatedAt: Date.now() });
}

export function buildAIPrompt(bilingual = false) {
  const head = [...CSV_HEADERS, ...(bilingual ? CSV_HEADERS_HI : [])].join(",");
  const nm = { quant: "Quant", reasoning: "Reasoning", english: "English", ga: "GA", computer: "Computer", stats: "Stats" };
  const topics = SUBJECTS.map(s => `${nm[s.id]}:\n  ${s.topics.map(t => t.name).join(" | ")}`).join("\n\n");
  return `Convert the attached SSC CGL question paper (PDF) into a CSV file for my study website.
(Use only papers I am allowed to reuse – for example official papers published by SSC with the source acknowledged.)

OUTPUT: only the CSV text – no explanation, no markdown code fence. First line must be exactly this header:
${head}

RULES
1. One row per question. Put every field in double quotes. A double quote inside a field is written as "".
2. subject must be one of: Quant, Reasoning, English, GA, Computer, Stats
3. topic must be EXACTLY one of the topic names listed below for that subject (copy the spelling). Pick the closest one.
4. difficulty: Easy, Medium or Hard (or leave empty).
5. correctOption: a single letter A, B, C or D. Use the answer key in the PDF; if there is none, solve the question carefully. If you are not sure, leave correctOption EMPTY – never guess.
6. explanation: short step-by-step solution in plain text (2-5 lines).
7. Write maths in plain Unicode (√ ² ³ π × ÷ ≤ ≥ ½ °). Fractions as a/b. No LaTeX.
8. If a question depends on a figure/table/image, still add the row, and put "(figure)" in the question; leave imageUrl empty.
9. paperName: exam + tier, e.g. "SSC CGL Tier-I". examDate: the exam date as YYYY-MM-DD (e.g. 2025-09-12). year: 4-digit year. shift: e.g. "Shift 1".
   Use EXACTLY the same paperName, examDate, year and shift on every row of one paper – the website groups rows by these four values into one full mock paper.
10. qno: the question number printed in the PDF (1, 2, 3 …). Keep the paper's original order. source: where the question comes from (e.g. "SSC official paper").
11. Leave questionId, videoLink, notesLink empty.
12. Do not skip or merge questions. Keep the original question text.${bilingual ? `
13. If the PDF also has Hindi text, put it in questionHi, optionAHi, optionBHi, optionCHi, optionDHi and explanationHi. Fill the Hindi question AND all four Hindi options together, or leave all Hindi columns empty.` : ""}

TOPIC NAMES
${topics}`;
}
