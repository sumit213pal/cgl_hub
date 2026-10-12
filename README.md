# CGL Study Hub – setup guide (100% free)

Plain HTML + CSS + JavaScript. No build step, no npm, no server.

| Layer | Free service |
|---|---|
| Hosting | GitHub Pages |
| Login | Firebase Authentication – Email/Password (admin-created accounts only) |
| Database | Cloud Firestore (Spark free plan) |
| Files / notes | Your Google Drives (site stores only links) |
| Videos | YouTube links (play inside the site) |

## How access works
- **You are the admin.** Only you can add people (Admin panel → Add member).
- You set a **temporary password**. The site shows a ready message (Copy / WhatsApp) to send them.
- On first login they **must** set their own password. After that only they know it.
- Passwords are stored by Firebase Authentication (hashed by Google), **never** in the database. You cannot see them.
- **Disable** a member any time → they are blocked immediately. **Send reset email** if someone forgets.
- The `members` collection in Firestore is your master list (name, email, status, last seen).

## 0. Try the demo
Open the folder in VS Code → right-click `index.html` → **Open with Live Server**
(or run `python -m http.server` and open http://localhost:8000).
Login: `demo@demo` / `demo123` (admin). Double-clicking `index.html` won't work.

## 1. Firebase project
1. https://console.firebase.google.com → **Add project** (`cgl-hub`).
2. **Authentication → Get started → Sign-in method → Email/Password → Enable** (leave "Email link" OFF) → Save.
3. **Authentication → Users → Add user** → your own email + a password. (This is the admin account.)
4. **Firestore Database → Create database** → location **asia-south1 (Mumbai)** → production mode.
5. Firestore → **Rules** → paste `firestore.rules`, change `your.email@gmail.com` to your email → **Publish**.
6. **Project settings ⚙️ → Your apps → Web (</>)** → register → copy `firebaseConfig`.

## 2. Edit `js/config.js`
Paste `firebaseConfig`, set `ADMIN_EMAIL` (same as in rules, lowercase), `GROUP_NAME`, `TARGET_DATE`.

## 3. Host on GitHub Pages
1. New GitHub repo → upload all files (keep `css/` and `js/` folders).
2. **Settings → Pages → Deploy from branch → main / root**.
3. Site: `https://<username>.github.io/<repo>/`
4. Firebase → **Authentication → Settings → Authorized domains → Add** `<username>.github.io`.
5. Open the site, log in with your admin account → **Admin** tab → add friends.

## Notes
- Someone could technically create a Firebase login with your public config, but without a `members` record from you the rules block all data. So only people you add can use the site.
- To delete a login completely: Firebase Console → Authentication → Users → delete, then Disable them in the Admin panel.
- Reset emails come from Firebase; tell friends to check spam the first time.
- Edit topics in `js/syllabus.js`. Renaming a topic resets its saved status.
