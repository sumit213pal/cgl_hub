// Data layer: Firebase (Auth + Firestore) when configured, otherwise a localStorage DEMO.
// Passwords are handled ONLY by Firebase Authentication (stored hashed by Google).
// They are never written to Firestore, so nobody – not even the admin – can read them.
import { firebaseConfig } from "./config.js";
import { ALL_TOPICS } from "./syllabus.js";

export const isDemo = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PASTE");

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

  api = {
    onAuth(cb) {
      authMod.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: (u.email || "").toLowerCase() } : null));
    },
    signIn: (email, pw) => authMod.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authMod.signOut(auth),
    async changePassword(newPw, currentPw) {
      const u = auth.currentUser;
      await authMod.reauthenticateWithCredential(u, authMod.EmailAuthProvider.credential(u.email, currentPw));
      await authMod.updatePassword(u, newPw);
    },
    resetPassword: email => authMod.sendPasswordResetEmail(auth, email),
    async createUser(email, pw) {
      try {
        const c = await authMod.createUserWithEmailAndPassword(helperAuth, email, pw);
        return c.user.uid;
      } finally {
        await authMod.signOut(helperAuth).catch(() => {});
      }
    },
    async get(col, id) {
      const s = await fs.getDoc(fs.doc(db, col, id));
      return s.exists() ? { id: s.id, ...s.data() } : null;
    },
    watch(col, cb) {
      return fs.onSnapshot(fs.collection(db, col),
        snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => console.warn(col, err.code));
    },
    add: (col, data) => fs.addDoc(fs.collection(db, col), { ...data, createdAt: Date.now() }),
    set: (col, id, data) => fs.setDoc(fs.doc(db, col, id), data, { merge: true }),
    remove: (col, id) => fs.deleteDoc(fs.doc(db, col, id))
  };
} else {
  // ---------------- DEMO MODE (no setup needed) ----------------
  // Demo keeps fake passwords in localStorage only to simulate login. Real mode never does this.
  const KEY = "cgl-hub-demo-v2", PWKEY = "cgl-hub-demo-v2-auth", SESSION = "cgl-hub-demo-session";
  const listeners = {};
  const fail = code => { const e = new Error(code); e.code = code; throw e; };
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null");
  const save = s => localStorage.setItem(KEY, JSON.stringify(s));
  const pwStore = () => JSON.parse(localStorage.getItem(PWKEY) || "{}");
  const pwSave = p => localStorage.setItem(PWKEY, JSON.stringify(p));
  const store = () => load() || seed();
  const list = col => Object.entries(store()[col] || {}).map(([id, v]) => ({ id, ...v }));
  const emit = col => (listeners[col] || []).forEach(cb => cb(list(col)));
  const merge = (a, b) => {
    const out = { ...(a || {}) };
    for (const k in b) out[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(out[k], b[k]) : b[k];
    return out;
  };
  const rid = () => Math.random().toString(36).slice(2, 10);

  function seed() {
    const now = Date.now(), day = 86400000;
    const s = { members: {}, progress: {}, resources: {}, drives: {}, logs: {}, mocks: {}, comments: {}, activity: {}, notices: {} };
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
      for (let d = 0; d < 6; d++) s.logs[rid()] = { uid, date: new Date(now - d * day).toISOString().slice(0, 10), hours: 2 + ((d + i) % 4), subject: "quant", note: "", createdAt: now - d * day };
      [140, 152, 161].forEach((sc, k) => s.mocks[rid()] = { uid, name: `Mock ${k + 1}`, tier: "T1", score: sc - i * 6 + k * 3, max: 200, date: new Date(now - (10 - k * 4) * day).toISOString().slice(0, 10), createdAt: now - (10 - k) * day });
    });
    s.drives[rid()] = { uid: "f1", label: "Rahul's Drive – Quant Notes", url: "https://drive.google.com/", purpose: "Quant + Reasoning handwritten notes", createdAt: now };
    s.resources[rid()] = { uid: "f2", topicId: "quant__percentage", type: "link", title: "Percentage – practice sheet (demo)", url: "https://example.com", createdAt: now - day };
    s.activity[rid()] = { uid: "f1", text: "marked Percentage as completed", createdAt: now - 7200000 };
    s.notices[rid()] = { uid: "demo", text: "Sunday 10 AM – full Tier 1 mock for everyone. Post scores in Study & Mocks!", createdAt: now - 3 * 3600000 };
    save(s); pwSave(pw);
    return s;
  }

  let user = JSON.parse(sessionStorage.getItem(SESSION) || "null");
  let authCb = () => {};
  const setUser = u => { user = u; u ? sessionStorage.setItem(SESSION, JSON.stringify(u)) : sessionStorage.removeItem(SESSION); authCb(u); };
  store();

  api = {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); },
    async signIn(email, pw) {
      const a = pwStore()[email];
      if (!a || a.pw !== pw) fail("auth/invalid-credential");
      setUser({ uid: a.uid, email });
    },
    async signOut() { setUser(null); },
    async changePassword(newPw, currentPw) {
      const p = pwStore();
      if (p[user.email].pw !== currentPw) fail("auth/invalid-credential");
      if (newPw.length < 6) fail("auth/weak-password");
      p[user.email].pw = newPw; pwSave(p);
    },
    async resetPassword() { /* demo: pretend email was sent */ },
    async createUser(email, pw) {
      const p = pwStore();
      if (p[email]) fail("auth/email-already-in-use");
      const uid = rid(); p[email] = { uid, pw }; pwSave(p); return uid;
    },
    async get(col, id) { const v = (store()[col] || {})[id]; return v ? { id, ...v } : null; },
    watch(col, cb) {
      (listeners[col] ||= []).push(cb);
      setTimeout(() => cb(list(col)), 0);
      return () => (listeners[col] = listeners[col].filter(x => x !== cb));
    },
    async add(col, data) { const s = store(); (s[col] ||= {})[rid()] = { ...data, createdAt: Date.now() }; save(s); emit(col); },
    async set(col, id, data) { const s = store(); (s[col] ||= {})[id] = merge(s[col][id], data); save(s); emit(col); },
    async remove(col, id) { const s = store(); delete (s[col] || {})[id]; save(s); emit(col); }
  };
}

export default api;
