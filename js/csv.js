// CSV parsing + validation + import for the question bank.
import { SUBJECTS, SUBJECT_MAP } from "./syllabus.js";

export const CSV_HEADERS = ["questionId", "paperName", "year", "shift", "subject", "topic", "subtopic", "difficulty",
  "question", "optionA", "optionB", "optionC", "optionD", "correctOption", "explanation", "videoLink", "notesLink", "imageUrl", "source"];

const norm = s => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const STOP = new Set(["and", "the", "for", "with", "from", "test", "of"]);
const toks = s => String(s ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const stripParen = s => String(s ?? "").replace(/\([^)]*\)/g, "");

// header aliases → canonical normalised key
const KEYS = Object.fromEntries(CSV_HEADERS.map(h => [norm(h), norm(h)]));
const ALIAS = {
  id: "questionid", qid: "questionid", paper: "papername", exam: "papername", papertitle: "papername",
  subtopic: "subtopic", subtopics: "subtopic", level: "difficulty", diff: "difficulty",
  questiontext: "question", ques: "question", q: "question",
  a: "optiona", b: "optionb", c: "optionc", d: "optiond", opta: "optiona", optb: "optionb", optc: "optionc", optd: "optiond",
  option1: "optiona", option2: "optionb", option3: "optionc", option4: "optiond",
  answer: "correctoption", correct: "correctoption", correctanswer: "correctoption", ans: "correctoption", key: "correctoption", correctoptionletter: "correctoption",
  solution: "explanation", explain: "explanation",
  video: "videolink", videourl: "videolink", youtube: "videolink", youtubelink: "videolink",
  notes: "noteslink", notesurl: "noteslink", pdf: "noteslink", pdflink: "noteslink",
  image: "imageurl", img: "imageurl", imagelink: "imageurl", figure: "imageurl"
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

function hash(str) {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

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
  for (const t of sub.topics) {
    if (n === norm(t.name) || ns === norm(stripParen(t.name)) || n === norm(t.id)) return { topic: t, auto: false };
  }
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
  const s = String(v ?? "").trim();
  if (!s) return -1;
  let m = s.match(/^(?:option\s*)?\(?([A-Da-d])\)?[.)]?$/);
  if (m) return "ABCD".indexOf(m[1].toUpperCase());
  m = s.match(/^([1-4])$/);
  if (m) return Number(m[1]) - 1;
  const i = options.findIndex(o => norm(o) && norm(o) === norm(s));
  return i;
}

/** rows → {valid, errors, dupes, warnings, total}. existingIds: Set of ids already in the bank. */
export function validateRows(rows, existingIds = new Set(), { overwrite = false } = {}) {
  const valid = [], errors = [], dupes = [], warnings = [];
  const seen = new Set();
  for (const r of rows) {
    const bad = msg => errors.push({ row: r._row, msg, raw: r });
    const warn = msg => warnings.push({ row: r._row, msg });
    const question = (r.question || "").trim();
    const options = ["optiona", "optionb", "optionc", "optiond"].map(k => (r[k] || "").trim());
    if (!question) { bad("question is empty"); continue; }
    if (options.some(o => !o)) { bad("one or more options (A–D) are empty"); continue; }
    if (question.length > 2000) { bad("question is too long (max 2000 characters)"); continue; }
    const subject = mapSubject(r.subject);
    if (!subject) { bad(`unknown subject "${r.subject || ""}" (use Quant, Reasoning, English, GA, Computer or Stats)`); continue; }
    const tp = mapTopic(subject, r.topic);
    if (tp.error) { bad(tp.error); continue; }
    const correct = parseCorrect(r.correctoption, options);
    if (correct < 0) { bad(`correctOption "${r.correctoption || ""}" is missing/invalid (must be A, B, C or D)`); continue; }
    if (new Set(options.map(norm)).size < 4) warn("two options look identical");
    let difficulty = "";
    if (r.difficulty) { difficulty = DIFF[norm(r.difficulty)] || ""; if (!difficulty) warn(`difficulty "${r.difficulty}" ignored (use Easy/Medium/Hard)`); }
    let year = "";
    if (r.year) { const y = parseInt(r.year, 10); if (y >= 1990 && y <= 2100) year = y; else warn(`year "${r.year}" ignored`); }
    const link = (k, label) => { const u = (r[k] || "").trim(); if (!u) return ""; if (isHttp(u)) return u; warn(`${label} is not a valid http(s) link – ignored`); return ""; };
    if (tp.auto) warn(`topic "${r.topic}" auto-mapped to "${tp.topic.name}"`);
    let id = (r.questionid || "").trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
    if (!id) id = "q" + hash(norm(question) + options.map(norm).join("|"));
    const row = {
      id, subject, topicId: tp.topic.id, topicName: tp.topic.name, subtopic: (r.subtopic || "").slice(0, 80), difficulty, year,
      shift: (r.shift || "").slice(0, 30), paperName: (r.papername || "").slice(0, 100), source: (r.source || "").slice(0, 100),
      question, options, correct, explanation: (r.explanation || "").slice(0, 4000),
      videoUrl: link("videolink", "videoLink"), notesUrl: link("noteslink", "notesLink"), imageUrl: link("imageurl", "imageUrl"), _row: r._row
    };
    if (seen.has(id)) { dupes.push({ row: r._row, id, why: "duplicate inside this file" }); continue; }
    seen.add(id);
    if (existingIds.has(id) && !overwrite) { dupes.push({ row: r._row, id, why: "already in question bank" }); continue; }
    valid.push(row);
  }
  return { valid, errors, dupes, warnings, total: rows.length };
}

export const indexString = r => `${r.id}|${r.topicId}|${(r.difficulty || "")[0] || ""}|${r.year || ""}`;
export const pubFields = r => ({
  subject: r.subject, topicId: r.topicId, subtopic: r.subtopic || "", difficulty: r.difficulty || "", year: r.year || "", shift: r.shift || "",
  paperName: r.paperName || "", source: r.source || "", question: r.question, options: r.options, imageUrl: r.imageUrl || "", active: true, updatedAt: Date.now()
});
export const keyFields = r => ({ correct: r.correct, explanation: r.explanation || "", videoUrl: r.videoUrl || "", notesUrl: r.notesUrl || "" });

/** Write questions + answer keys + per-subject search index. */
export async function importQuestions(db, rows) {
  if (!rows.length) return 0;
  const items = rows.flatMap(r => [
    { col: "questions", id: r.id, data: { ...pubFields(r), createdAt: Date.now() } },
    { col: "answerKeys", id: r.id, data: keyFields(r) }
  ]);
  await db.batchSet(items);
  const by = {};
  rows.forEach(r => (by[r.subject] ||= []).push(r));
  for (const [sub, list] of Object.entries(by)) {
    const cur = (await db.get("qindex", sub))?.items || [];
    const ids = new Set(list.map(r => r.id));
    const next = cur.filter(s => !ids.has(s.split("|")[0])).concat(list.map(indexString));
    await db.set("qindex", sub, { items: next, updatedAt: Date.now() });
  }
  return rows.length;
}

export async function removeFromIndex(db, subject, id) {
  const cur = (await db.get("qindex", subject))?.items || [];
  await db.set("qindex", subject, { items: cur.filter(s => s.split("|")[0] !== id), updatedAt: Date.now() });
}

export function buildAIPrompt() {
  const topics = SUBJECTS.map(s => `${s.id === "quant" ? "Quant" : s.id === "reasoning" ? "Reasoning" : s.id === "english" ? "English" : s.id === "ga" ? "GA" : s.id === "computer" ? "Computer" : "Stats"}:\n  ${s.topics.map(t => t.name).join(" | ")}`).join("\n\n");
  return `Convert the attached SSC CGL question paper (PDF) into a CSV file for my study website.

OUTPUT: only the CSV text – no explanation, no markdown code fence. First line must be exactly this header:
${CSV_HEADERS.join(",")}

RULES
1. One row per question. Put every field in double quotes. A double quote inside a field is written as "".
2. subject must be one of: Quant, Reasoning, English, GA, Computer, Stats
3. topic must be EXACTLY one of the topic names listed below for that subject (copy the spelling). Pick the closest one.
4. difficulty: Easy, Medium or Hard (or leave empty).
5. correctOption: a single letter A, B, C or D. Use the answer key in the PDF; if there is none, solve the question carefully. If you are not sure, leave correctOption EMPTY – never guess.
6. explanation: short step-by-step solution in plain text (2-5 lines).
7. Write maths in plain Unicode (√ ² ³ π × ÷ ≤ ≥ ½ °). Fractions as a/b. No LaTeX.
8. If a question depends on a figure/table/image, still add the row, and put "(figure)" in the question; leave imageUrl empty.
9. paperName / year / shift: copy from the PDF (example: "CGL Tier 1", 2023, "Shift 2"). source: where the question comes from.
10. Leave questionId, videoLink, notesLink empty.
11. Do not skip or merge questions. Keep the original question text.

TOPIC NAMES
${topics}`;
}
