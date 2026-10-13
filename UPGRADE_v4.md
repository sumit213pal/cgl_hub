# CGL Study Hub v4 – upgrade guide

v4 adds the full-paper library (year / date / shift), section timers, exam & learning modes, spaced revision, answer-change and
time-pressure analysis, verification workflow, duplicate detection, answer-key versioning, bilingual questions, backups,
and the group features (vault, current affairs, weekly targets, heat-map, group pulse, expert finder, votes).

## 1) Update Firestore rules FIRST (2 min)
Firebase Console → Firestore Database → **Rules** → replace everything with `firestore.rules` from this folder.
Change `your.email@gmail.com` (line 6) to your admin email (lowercase) → **Publish**.
(New collections: `papers`, `flags`, `scores`, `votes`, `qnotes`, `vault`, `cavault`, `targets`.)

## 2) Copy the files into your VS Code folder
| Action | Files |
|---|---|
| **Replace** | `index.html`, `css/style.css`, `js/app.js`, `js/db.js`, `js/csv.js`, `js/tests.js`, `js/t_util.js`, `js/t_engine.js`, `js/t_runner.js`, `js/t_views.js`, `js/t_admin.js`, `js/syllabus.js` |
| **Add (new)** | `js/t_notebook.js`, `js/t_extra.js` |
| **Replace** | `sample/cgl_questions_sample.csv` (new header + 2 demo papers) |
| **DO NOT TOUCH** | `js/config.js` – your Firebase keys and admin email stay as they are |

```bash
git add .
git commit -m "v4: paper library, section timers, spaced revision, vault, backups"
git push
```
Wait 1–2 minutes for GitHub Pages, then hard-refresh (Ctrl + F5).

## 3) What happens to data you already have
* **Questions imported with v3** keep working. They show as *Needs review* – open **Admin → Question bank → Browse**, load a subject and press **Verify all shown** once you are happy with them.
* **Mock tests from v3** keep their timers (old `timerMode` is understood). New tests use the new timer options.
* **Old mistakes** are treated as *due for review* once, then follow the 1 → 3 day schedule.
* Old attempts, notes, resources, Drive links and users are untouched.

## 4) New CSV header (old CSVs still import)
```
questionId,paperName,examDate,year,shift,qno,subject,topic,subtopic,difficulty,question,optionA,optionB,optionC,optionD,correctOption,explanation,videoLink,notesLink,imageUrl,source
```
Optional Hindi columns: `questionHi,optionAHi,optionBHi,optionCHi,optionDHi,explanationHi` (all four options + the question together, or leave empty).
Admin → Question bank → **Copy AI prompt** gives the AI the exact header and your topic names.

**Full papers:** every row of one paper must carry the *same* `paperName`, `examDate` (YYYY-MM-DD, or 12/09/2025), `year`, `shift`.
The importer groups them, checks completeness (Tier-I: 4 sections × 25 questions) and creates the paper in the Paper library automatically.
`qno` keeps the original question order. Section order = order of first appearance.

Only reuse papers you are allowed to reuse (for example official papers published by SSC with the source acknowledged in the `source` column).

## 5) First use
1. Admin → **Question bank** → import CSV → read the check result (papers detected, rejected rows, possible duplicates) → **Import**.
2. Admin → **Papers** → set section timers / attempts / exam window → **Verify all** (after you've checked the answers).
3. Students: **Tests → Paper library → Start** → choose **Exam mode** or **Learning mode**.
4. Optional: **Admin → Weekly targets**, **Tests** (random / fixed mini-mocks), post a notice, share vault items.

## 6) Timers
* **None**, **whole paper** (auto = questions × seconds/question, or manual minutes) or **per-section**.
* Section timer = auto (questions × seconds/question for that subject) unless you type **manual minutes** for that section.
* Presets: per-subject defaults, equal split of N minutes, your saved preset.
* In exam mode a finished section is **locked**; the next section's clock starts only when the student presses *Start*.
* If time runs out while the student is away, the section is closed automatically the next time the site opens.

## 7) Free-tier notes (Spark plan: 50,000 reads / 20,000 writes per day)
* A 100-question paper ≈ 100 reads at start + 100 reads at submit (answer keys) + ~15 writes. Four friends are far below the limits.
* The question index (`qindex`) is one small document per subject; it grows ~60 bytes per question. Keep each subject under ~10,000 questions (the 1 MB document limit).
* Keep images / PDFs / videos as links (Google Drive, YouTube).

## 8) Honest limits
* Scoring runs in the browser. Answer keys can be read one at a time by logged-in members, so a tech-savvy friend could look answers up with browser developer tools. Fine for a trusted group; truly cheat-proof marking needs Cloud Functions (paid plan).
* Attempt limits, exam windows and "solutions after close" are enforced by the app, not by the database rules.
* "Explain with AI" copies a ready-made prompt – paste it into ChatGPT / Claude / Gemini. The site itself does not call any AI service.
* Spaced revision: wrong answer → review due after **1 day**; a correct answer on a different day moves the next review to **3 days**; two correct answers on separate days = **mastered**.
* Group pulse / improvement board use public per-test score summaries (no answers). Learning-mode attempts are never included.
