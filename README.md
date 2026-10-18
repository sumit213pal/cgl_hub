# CGL Study Hub – lean version

Plain HTML + CSS + JavaScript · GitHub Pages + Firebase Auth + Firestore (free plans) · files stay in Google Drive / YouTube as links.

## Pages
Home · Tests (Papers / Practice / History) · Syllabus · Mistakes · Progress · Library · Admin (admin only)

## Update an existing site (fresh start – old data is not used)
1. Firebase → Firestore → Rules → paste `firestore.rules`, put your admin email on line 6 → Publish.
2. In your project folder delete the old `js/` and `css/` files, copy this zip's `index.html`, `css/`, `js/`, `sample/`, `firestore.rules` over them.
   **Keep your own `js/config.js`** (Firebase keys + admin email). Do not overwrite it with `config.example.js`.
3. `git add . && git commit -m "lean version" && git push` → wait 1–2 min → Ctrl+F5.

Your login accounts and member list are kept (same `members` collection). Everything else starts empty: import your CSV again in **Admin → Questions**.
Old collections (tests, scores, flags, votes, vault…) are simply ignored – you can delete them in the Firebase console whenever you like.

## First use
Admin → Questions → *Copy AI prompt* → give it + your PDF to Claude/ChatGPT → upload the CSV → check result → Import.
Rows sharing paperName + examDate + shift become one paper (Admin → Papers: set timers, attempts, exam window).

## Try it without Firebase
`python -m http.server` in this folder → open http://localhost:8000 → demo login `demo@demo / demo123`.
