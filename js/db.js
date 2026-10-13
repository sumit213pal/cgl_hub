// Data layer: Firebase (Auth + Firestore) when configured, otherwise a localStorage DEMO.
// Passwords are handled ONLY by Firebase Authentication (stored hashed by Google).
// They are never written to Firestore, so nobody – not even the admin – can read them.
import { firebaseConfig } from "./config.js";
import { ALL_TOPICS } from "./syllabus.js";
import { parseCSV, validateRows, importQuestions, groupPapers, emptyBank } from "./csv.js";
import { weekStart } from "./t_util.js";

export const isDemo = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE");
const clean = o => JSON.parse(JSON.stringify(o)); // drops undefined / NaN so Firestore never rejects a write

let api;

if (!isDemo) {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [appMod, authMod, fs] = await Promise.all([
    import(base + "firebase-app.js"),
    import(base + "firebase-auth.js"),
    import(base + "firebase-firestore.js")
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);
  // Second app instance lets the admin create accounts WITHOUT being logged out.
  const helper = appMod.initializeApp(firebaseConfig, "admin-helper");
  const helperAuth = authMod.getAuth(helper);
  const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const chunk = (a, n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

  api = {
    onAuth(cb) { authMod.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: (u.email || "").toLowerCase() } : null)); },
    signIn: (email, pw) => authMod.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authMod.signOut(auth),
    async changePassword(newPw, currentPw) {
      const u = auth.currentUser;
      await authMod.reauthenticateWithCredential(u, authMod.EmailAuthProvider.credential(u.email, currentPw));
      await authMod.updatePassword(u, newPw);
    },
    resetPassword: email => authMod.sendPasswordResetEmail(auth, email),
    async createUser(email, pw) {
      try { const c = await authMod.createUserWithEmailAndPassword(helperAuth, email, pw); return c.user.uid; }
      finally { await authMod.signOut(helperAuth).catch(() => {}); }
    },
    async get(col, id) { const s = await fs.getDoc(fs.doc(db, col, id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async getMany(col, ids) {
      const r = await Promise.all(ids.map(id => fs.getDoc(fs.doc(db, col, id)).catch(e => { console.warn(col, id, e.code); return null; })));
      return r.filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() }));
    },
    watch(col, cb) { return fs.onSnapshot(fs.collection(db, col), snap => cb(docs(snap)), err => console.warn(col, err.code)); },
    watchWhere(col, field, val, cb) { return fs.onSnapshot(fs.query(fs.collection(db, col), fs.where(field, "==", val)), snap => cb(docs(snap)), err => console.warn(col, err.code)); },
    // wheres: [[field, value]] or [[field, value, "array-contains"]]
    async query(col, wheres = [], lim = 50) {
      return docs(await fs.getDocs(fs.query(fs.collection(db, col), ...wheres.map(([f, v, op]) => fs.where(f, op || "==", v)), fs.limit(lim))));
    },
    async all(col) { return docs(await fs.getDocs(fs.collection(db, col))); },
    async add(col, data) { const r = await fs.addDoc(fs.collection(db, col), { ...clean(data), createdAt: Date.now() }); return r.id; },
    set: (col, id, data) => fs.setDoc(fs.doc(db, col, id), clean(data), { merge: true }),
    update: (col, id, data) => fs.updateDoc(fs.doc(db, col, id), clean(data)),   // replaces whole top-level fields
    remove: (col, id) => fs.deleteDoc(fs.doc(db, col, id)),
    async batchSet(items) { for (const part of chunk(items)) { const b = fs.writeBatch(db); part.forEach(it => b.set(fs.doc(db, it.col, it.id), clean(it.data))); await b.commit(); } },
    async batchUpdate(items) { for (const part of chunk(items)) { const b = fs.writeBatch(db); part.forEach(it => b.update(fs.doc(db, it.col, it.id), clean(it.data))); await b.commit(); } },
    async batchDelete(items) { for (const part of chunk(items)) { const b = fs.writeBatch(db); part.forEach(it => b.delete(fs.doc(db, it.col, it.id))); await b.commit(); } }
  };
} else {
  // ---------------- DEMO MODE (no setup needed) ----------------
  // Demo keeps fake passwords in localStorage only to simulate login. Real mode never does this.
  const KEY = "cgl-hub-demo-v4", PWKEY = "cgl-hub-demo-v4-auth", SESSION = "cgl-hub-demo-v4-session";
  const listeners = {};
  const fail = code => { const e = new Error(code); e.code = code; throw e; };
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null");
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const pwStore = () => JSON.parse(localStorage.getItem(PWKEY) || "{}");
  const pwSave = p => localStorage.setItem(PWKEY, JSON.stringify(p));
  const store = () => load() || seed();
  const list = col => Object.entries(store()[col] || {}).map(([id, v]) => ({ id, ...v }));
  const emit = col => (listeners[col] || []).forEach(l => l.cb(l.f ? list(col).filter(d => d[l.f[0]] === l.f[1]) : list(col)));
  const clone = o => JSON.parse(JSON.stringify(o));
  const merge = (a, b) => {
    const out = { ...(a || {}) };
    for (const k in b) out[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(out[k], b[k]) : b[k];
    return out;
  };
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const COLS = ["members", "progress", "resources", "drives", "logs", "mocks", "comments", "activity", "notices", "questions", "answerKeys", "qindex", "tests", "papers", "attempts",
    "mistakes", "bookmarks", "reports", "flags", "scores", "vault", "cavault", "votes", "targets", "qnotes"];

  function seed() {
    const now = Date.now(), day = 86400000;
    const s = Object.fromEntries(COLS.map(c => [c, {}]));
    const people = [["demo", "demo@demo", "Sumit (Admin)", "admin"], ["f1", "rahul@demo", "Rahul", "member"], ["f2", "priya@demo", "Priya", "member"]];
    const statuses = ["learning", "done", "done", "revised"];
    const pw = {};
    people.forEach(([uid, email, name, role], i) => {
      s.members[email] = { name, role, uid, active: true, mustChangePassword: false, lastSeen: now - i * 3600000, createdAt: now - 30 * day };
      pw[email] = { uid, pw: "demo123" };
      const topics = {}, at = {};
      ALL_TOPICS.forEach((t, j) => {
        if ((j * (i + 3)) % 5 < 2 + i) { topics[t.id] = statuses[(j + i) % 4]; at[t.id] = now - ((j * 7 + i * 3) % 40) * day; }
      });
      s.progress[uid] = { topics, at, updatedAt: now };
      // ~100 days of study history for the heat-map
      for (let d = 0; d < 100; d++) if ((d * 7 + i * 5) % 9 < 6) s.logs[rid()] = { uid, date: new Date(now - d * day - new Date().getTimezoneOffset() * 60000 * 0).toISOString().slice(0, 10), hours: 0.5 + ((d * 3 + i) % 6) * 0.8, subject: "quant", note: "", createdAt: now - d * day };
      [140, 152, 161].forEach((sc, k) => s.mocks[rid()] = { uid, name: `Mock ${k + 1}`, tier: "T1", score: sc - i * 6 + k * 3, max: 200, date: new Date(now - (10 - k * 4) * day).toISOString().slice(0, 10), createdAt: now - (10 - k) * day });
    });
    // friends' topic statistics + test scores (used by Expert finder / Group pulse / Improvement board)
    s.progress.f1.tstats = { quant__percentage: { c: 18, w: 2 }, "quant__ratio-proportion": { c: 14, w: 3 }, quant__average: { c: 9, w: 6 }, "ga__physics": { c: 5, w: 5 } };
    s.progress.f2.tstats = { "ga__indian-polity-constitution": { c: 16, w: 3 }, ga__biology: { c: 12, w: 2 }, quant__percentage: { c: 6, w: 8 }, "english__synonyms": { c: 10, w: 1 } };
    [["f1", [52, 58, 63, 71]], ["f2", [60, 62, 61, 66]]].forEach(([uid, arr]) => arr.forEach((p, k) =>
      s.scores[rid()] = { uid, at: now - (arr.length - k) * 2 * day, title: `Demo test ${k + 1}`, kind: "mock", mode: "exam", percent: p, accuracy: p + 12, createdAt: now - (arr.length - k) * 2 * day }));
    s.drives[rid()] = { uid: "f1", label: "Rahul's Drive – Quant Notes", url: "https://drive.google.com/", purpose: "Quant + Reasoning handwritten notes", createdAt: now };
    s.resources[rid()] = { uid: "f2", topicId: "quant__percentage", type: "link", title: "Percentage – practice sheet (demo)", url: "https://example.com", createdAt: now - day };
    s.activity[rid()] = { uid: "f1", text: "marked Percentage as completed", createdAt: now - 7200000 };
    s.notices[rid()] = { uid: "demo", text: "Sunday 10 AM – full Tier 1 mock for everyone. Post scores in Study & Mocks!", createdAt: now - 3 * 3600000 };
    s.targets[weekStart()] = { title: "This week's targets", topics: ["quant__percentage", "quant__ratio-proportion", "quant__average", "reasoning__number-series", "english__synonyms"], uid: "demo", createdAt: now };
    s.vault[rid()] = { uid: "f1", subject: "quant", topicId: "quant__percentage", kind: "formula", title: "Percentage ↔ fraction table", text: "1/2 = 50%, 1/3 = 33.33%, 1/4 = 25%, 1/5 = 20%, 1/6 = 16.67%, 1/7 = 14.28%, 1/8 = 12.5%, 1/9 = 11.11%", url: "", createdAt: now - day };
    s.vault[rid()] = { uid: "f2", subject: "quant", topicId: "quant__percentage", kind: "trick", title: "Successive change", text: "Net % = a + b + ab/100. A 20% rise then 20% fall → 20 − 20 − 4 = −4%.", url: "", createdAt: now - 2 * day };
    s.cavault[rid()] = { uid: "demo", year: new Date().getFullYear(), month: new Date().getMonth() + 1, title: "Monthly current affairs (demo link)", url: "https://drive.google.com/", note: "Replace with your Drive PDF", createdAt: now };
    save(s); pwSave(pw);
    return s;
  }

  let user = JSON.parse(sessionStorage.getItem(SESSION) || "null");
  let authCb = () => {};
  const setUser = u => { user = u; u ? sessionStorage.setItem(SESSION, JSON.stringify(u)) : sessionStorage.removeItem(SESSION); authCb(u); };
  store();

  api = {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); },
    async signIn(email, pw) { const a = pwStore()[email]; if (!a || a.pw !== pw) fail("auth/invalid-credential"); setUser({ uid: a.uid, email }); },
    async signOut() { setUser(null); },
    async changePassword(newPw, currentPw) {
      const p = pwStore();
      if (p[user.email].pw !== currentPw) fail("auth/invalid-credential");
      if (newPw.length < 6) fail("auth/weak-password");
      p[user.email].pw = newPw; pwSave(p);
    },
    async resetPassword() {},
    async createUser(email, pw) { const p = pwStore(); if (p[email]) fail("auth/email-already-in-use"); const uid = rid(); p[email] = { uid, pw }; pwSave(p); return uid; },
    async get(col, id) { const v = (store()[col] || {})[id]; return v ? { id, ...clone(v) } : null; },
    async getMany(col, ids) { const c = store()[col] || {}; return ids.filter(id => c[id]).map(id => ({ id, ...clone(c[id]) })); },
    watch(col, cb) { const l = { cb, f: null }; (listeners[col] ||= []).push(l); setTimeout(() => cb(list(col)), 0); return () => (listeners[col] = listeners[col].filter(x => x !== l)); },
    watchWhere(col, field, val, cb) { const l = { cb, f: [field, val] }; (listeners[col] ||= []).push(l); setTimeout(() => cb(list(col).filter(d => d[field] === val)), 0); return () => (listeners[col] = listeners[col].filter(x => x !== l)); },
    async query(col, wheres = [], lim = 50) {
      return list(col).filter(d => wheres.every(([f, v, op]) => (op === "array-contains" ? Array.isArray(d[f]) && d[f].includes(v) : d[f] === v))).slice(0, lim).map(clone);
    },
    async all(col) { return list(col).map(clone); },
    async add(col, data) { const id = rid(); const s = store(); (s[col] ||= {})[id] = { ...clone(data), createdAt: Date.now() }; save(s); emit(col); return id; },
    async set(col, id, data) { const s = store(); (s[col] ||= {})[id] = merge(s[col][id], clone(data)); save(s); emit(col); },
    async update(col, id, data) { const s = store(); if (!(s[col] || {})[id]) fail("not-found"); Object.assign(s[col][id], clone(data)); save(s); emit(col); },
    async remove(col, id) { const s = store(); delete (s[col] || {})[id]; save(s); emit(col); },
    async batchSet(items) { const s = store(); const cols = new Set(); items.forEach(it => { (s[it.col] ||= {})[it.id] = clone(it.data); cols.add(it.col); }); save(s); cols.forEach(emit); },
    async batchUpdate(items) { const s = store(); const cols = new Set(); items.forEach(it => { if (s[it.col]?.[it.id]) Object.assign(s[it.col][it.id], clone(it.data)); cols.add(it.col); }); save(s); cols.forEach(emit); },
    async batchDelete(items) { const s = store(); const cols = new Set(); items.forEach(it => { delete (s[it.col] || {})[it.id]; cols.add(it.col); }); save(s); cols.forEach(emit); }
  };

  // Load the sample question bank (two demo papers + extra practice questions) once.
  try {
    if (!Object.keys(store().questions || {}).length) {
      const text = await (await fetch("sample/cgl_questions_sample.csv")).text();
      const { valid, errors } = validateRows(parseCSV(text), emptyBank());
      await importQuestions(api, valid, { status: "verified", papers: groupPapers(valid, errors) });
    }
  } catch (e) { console.warn("demo question seed failed", e); }
}

export default api;
