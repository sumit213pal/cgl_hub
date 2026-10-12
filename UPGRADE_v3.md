# Upgrade to v3 – PYQ question bank + timed tests + analytics

## 1) Update Firestore rules FIRST (2 min)
Firebase Console → Firestore Database → **Rules** → replace everything with `firestore.rules` from this folder.
Change `your.email@gmail.com` (line 6) to your admin email (lowercase) → **Publish**.

## 2) Copy files into your VS Code folder
| Action | File |
|---|---|
| Replace | `index.html`, `css/style.css`, `js/app.js`, `js/db.js`, `js/syllabus.js` |
| **Add (new)** | `js/csv.js`, `js/tests.js`, `js/t_util.js`, `js/t_engine.js`, `js/t_runner.js`, `js/t_views.js`, `js/t_admin.js` |
| **Add (new)** | `sample/cgl_questions_sample.csv` |
| **DO NOT TOUCH** | `js/config.js` (your Firebase keys + admin email stay as they are) |

## 3) Push
```bash
git add .
git commit -m "Add PYQ question bank, timed tests, analytics"
git push
```
Wait 1–2 min for GitHub Pages, then hard-refresh (Ctrl + F5).

## 4) First use
1. Admin → **Question bank** → **Copy AI prompt** → paste it in Claude/ChatGPT together with your PYQ PDF.
2. Save the AI's output as `.csv` → upload it → read the check result → **Import**.
3. Admin → **Tests** → build a test (pattern, timer, marks, attempts) → Create.
4. Friends: **Tests** → start a test, or build their own / 1-click revision test.

## CSV columns
`questionId, paperName, year, shift, subject, topic, subtopic, difficulty, question, optionA, optionB, optionC, optionD, correctOption, explanation, videoLink, notesLink, imageUrl, source`
Required: subject, topic, question, optionA–D, correctOption. Topic names must match `js/syllabus.js` (close names are auto-matched; the AI prompt lists the exact names).

## Free-tier usage (Spark plan)
A 50-question test ≈ 50 reads at start + 50 reads at submit. Question text lives in `questions`, answers in `answerKeys`,
and a tiny `qindex` doc per subject is used to pick random questions without reading the whole bank.
Store only links for images/videos/PDFs (Google Drive / YouTube).

## Honest limits
- Scoring runs in the browser. Answer keys are readable one-by-one by logged-in members (they cannot list the collection),
  so a tech-savvy friend could peek via DevTools. Fine for a trusted study group; truly cheat-proof marking needs Cloud Functions (Blaze plan).
- Attempt limits are enforced by the app, not by database rules.
