// Data layer: Firebase (Auth + Firestore) when configured, otherwise a localStorage DEMO.
// Passwords live ONLY in Firebase Authentication (hashed by Google) – never in the database, so nobody (not even the admin) can read them.
import { firebaseConfig } from "./config.js";
import { ALL_TOPICS } from "./syllabus.js";
import { parseCSV, validateRows, importQuestions, groupPapers, emptyBank } from "./csv.js";

export const isDemo = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE");
const clean = o => JSON.parse(JSON.stringify(o));      // drops undefined / NaN so Firestore never rejects a write
let api;

if (!isDemo) {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [appMod, authMod, fs] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")]);
  const app = appMod.initializeApp(firebaseConfig), auth = authMod.getAuth(app), db = fs.getFirestore(app);
  const helperAuth = authMod.getAuth(appMod.initializeApp(firebaseConfig, "admin-helper"));   // lets the admin create accounts without being logged out
  const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const chunk = (a, n = 400) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  api = {
    onAuth: cb => authMod.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: (u.email || "").toLowerCase() } : null)),
    signIn: (e, p) => authMod.signInWithEmailAndPassword(auth, e, p),
    signOut: () => authMod.signOut(auth),
    async changePassword(np, cp) { const u = auth.currentUser; await authMod.reauthenticateWithCredential(u, authMod.EmailAuthProvider.credential(u.email, cp)); await authMod.updatePassword(u, np); },
    resetPassword: e => authMod.sendPasswordResetEmail(auth, e),
    async createUser(e, p) { try { return (await authMod.createUserWithEmailAndPassword(helperAuth, e, p)).user.uid; } finally { await authMod.signOut(helperAuth).catch(() => {}); } },
    async get(col, id) { const s = await fs.getDoc(fs.doc(db, col, id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async getMany(col, ids) { const r = await Promise.all(ids.map(id => fs.getDoc(fs.doc(db, col, id)).catch(e => { console.warn(col, id, e.code); return null; }))); return r.filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() })); },
    watch: (col, cb) => fs.onSnapshot(fs.collection(db, col), s => cb(docs(s)), e => console.warn(col, e.code)),
    watchWhere: (col, fld, v, cb) => fs.onSnapshot(fs.query(fs.collection(db, col), fs.where(fld, "==", v)), s => cb(docs(s)), e => console.warn(col, e.code)),
    async query(col, wheres = [], lim = 50) { return docs(await fs.getDocs(fs.query(fs.collection(db, col), ...wheres.map(([f, v, op]) => fs.where(f, op || "==", v)), fs.limit(lim)))); },
    async all(col) { return docs(await fs.getDocs(fs.collection(db, col))); },
    async add(col, d) { return (await fs.addDoc(fs.collection(db, col), { ...clean(d), createdAt: Date.now() })).id; },
    set: (col, id, d) => fs.setDoc(fs.doc(db, col, id), clean(d), { merge: true }),
    update: (col, id, d) => fs.updateDoc(fs.doc(db, col, id), clean(d)),
    remove: (col, id) => fs.deleteDoc(fs.doc(db, col, id)),
    async batchSet(items) { for (const p of chunk(items)) { const b = fs.writeBatch(db); p.forEach(i => b.set(fs.doc(db, i.col, i.id), clean(i.data))); await b.commit(); } },
    async batchDelete(items) { for (const p of chunk(items)) { const b = fs.writeBatch(db); p.forEach(i => b.delete(fs.doc(db, i.col, i.id))); await b.commit(); } }
  };
} else {
  // ---------------- DEMO MODE (no setup needed – data stays in this browser) ----------------
  const KEY = "cgl-hub-demo-v5", PW = KEY + "-auth", SES = KEY + "-session", listeners = {};
  const fail = code => { const e = new Error(code); e.code = code; throw e; };
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null"), save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const pwGet = () => JSON.parse(localStorage.getItem(PW) || "{}"), pwSet = p => localStorage.setItem(PW, JSON.stringify(p));
  const store = () => load() || seed();
  const list = col => Object.entries(store()[col] || {}).map(([id, v]) => ({ id, ...v }));
  const emit = col => (listeners[col] || []).forEach(l => l.cb(l.f ? list(col).filter(d => d[l.f[0]] === l.f[1]) : list(col)));
  const clone = o => JSON.parse(JSON.stringify(o));
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const COLS = ["members", "progress", "resources", "drives", "logs", "notices", "questions", "answerKeys", "qindex", "papers", "attempts", "mistakes", "bookmarks", "reports"];
  function seed() {
    const now = Date.now(), day = DAY(), s = Object.fromEntries(COLS.map(c => [c, {}])), pw = {};
    [["demo", "demo@demo", "Sumit (Admin)", "admin"], ["f1", "rahul@demo", "Rahul", "member"], ["f2", "priya@demo", "Priya", "member"]].forEach(([uid, email, name, role], i) => {
      s.members[email] = { name, role, uid, active: true, mustChangePassword: false, lastSeen: now - i * 3600000, createdAt: now - 30 * day }; pw[email] = { uid, pw: "demo123" };
      const topics = {}; ALL_TOPICS.forEach((t, j) => { if ((j * (i + 3)) % 5 < 2 + i) topics[t.id] = ["learning", "done", "done"][(j + i) % 3]; });
      s.progress[uid] = { topics, updatedAt: now };
      for (let d = 0; d < 60; d++) if ((d * 7 + i * 5) % 9 < 6) s.logs[rid()] = { uid, date: new Date(now - d * day).toISOString().slice(0, 10), hours: 1 + ((d * 3 + i) % 4), subject: "quant", note: "", createdAt: now - d * day };
    });
    s.notices.current = { text: "Sunday 10 AM – everyone takes the Demo Mock Paper A (exam mode).", uid: "demo", createdAt: now };
    s.resources[rid()] = { uid: "f1", topicId: "quant__percentage", type: "note", title: "Percentage ↔ fraction table", text: "1/2=50%, 1/3=33.33%, 1/4=25%, 1/5=20%, 1/6=16.67%, 1/7=14.28%, 1/8=12.5%", url: "", createdAt: now - day };
    s.resources[rid()] = { uid: "f2", topicId: "quant__percentage", type: "link", title: "Percentage practice sheet (demo link)", url: "https://example.com", text: "", createdAt: now - 2 * day };
    s.drives[rid()] = { uid: "f1", label: "Rahul – Quant notes", url: "https://drive.google.com/", purpose: "Handwritten notes", createdAt: now };
    save(s); pwSet(pw); return s;
  }
  function DAY() { return 86400000; }
  let user = JSON.parse(sessionStorage.getItem(SES) || "null"), authCb = () => {};
  const setUser = u => { user = u; u ? sessionStorage.setItem(SES, JSON.stringify(u)) : sessionStorage.removeItem(SES); authCb(u); };
  store();
  api = {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); },
    async signIn(e, p) { const a = pwGet()[e]; if (!a || a.pw !== p) fail("auth/invalid-credential"); setUser({ uid: a.uid, email: e }); },
    async signOut() { setUser(null); },
    async changePassword(np, cp) { const p = pwGet(); if (p[user.email].pw !== cp) fail("auth/invalid-credential"); if (np.length < 6) fail("auth/weak-password"); p[user.email].pw = np; pwSet(p); },
    async resetPassword() {},
    async createUser(e, p) { const all = pwGet(); if (all[e]) fail("auth/email-already-in-use"); const uid = rid(); all[e] = { uid, pw: p }; pwSet(all); return uid; },
    async get(col, id) { const v = (store()[col] || {})[id]; return v ? { id, ...clone(v) } : null; },
    async getMany(col, ids) { const c = store()[col] || {}; return ids.filter(id => c[id]).map(id => ({ id, ...clone(c[id]) })); },
    watch(col, cb) { const l = { cb, f: null }; (listeners[col] ||= []).push(l); setTimeout(() => cb(list(col)), 0); return () => (listeners[col] = listeners[col].filter(x => x !== l)); },
    watchWhere(col, fld, v, cb) { const l = { cb, f: [fld, v] }; (listeners[col] ||= []).push(l); setTimeout(() => cb(list(col).filter(d => d[fld] === v)), 0); return () => (listeners[col] = listeners[col].filter(x => x !== l)); },
    async query(col, wheres = [], lim = 50) { return list(col).filter(d => wheres.every(([f, v, op]) => (op === "array-contains" ? Array.isArray(d[f]) && d[f].includes(v) : d[f] === v))).slice(0, lim).map(clone); },
    async all(col) { return list(col).map(clone); },
    async add(col, d) { const id = rid(), s = store(); (s[col] ||= {})[id] = { ...clone(d), createdAt: Date.now() }; save(s); emit(col); return id; },
    async set(col, id, d) { const s = store(); (s[col] ||= {})[id] = merge(s[col][id], clone(d)); save(s); emit(col); },
    async update(col, id, d) { const s = store(); if (!(s[col] || {})[id]) fail("not-found"); Object.assign(s[col][id], clone(d)); save(s); emit(col); },
    async remove(col, id) { const s = store(); delete (s[col] || {})[id]; save(s); emit(col); },
    async batchSet(items) { const s = store(), cols = new Set(); items.forEach(i => { (s[i.col] ||= {})[i.id] = clone(i.data); cols.add(i.col); }); save(s); cols.forEach(emit); },
    async batchDelete(items) { const s = store(), cols = new Set(); items.forEach(i => { delete (s[i.col] || {})[i.id]; cols.add(i.col); }); save(s); cols.forEach(emit); }
  };
  try {   // demo question bank: two sample papers + a few extra practice questions
    if (!Object.keys(store().questions || {}).length) {
      const { valid, errors } = validateRows(parseCSV(await (await fetch("sample/cgl_questions_sample.csv")).text()), emptyBank());
      await importQuestions(api, valid, { papers: groupPapers(valid, errors) });
    }
  } catch (e) { console.warn("demo seed failed", e); }
}
export default api;
