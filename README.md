# LacrosseTube

[LacrosseTube](https://lacrossetube.vercel.app/) is a static lacrosse film shelf, practice planner, and reference library. No database, accounts, or application server are required. The existing Vercel project remains the production host.

## Local development

```sh
python3 -m http.server 8090
```

Open http://localhost:8090. The shelf is bundled in `data/live_bundle.js`; Dispatch selections come from `data/dispatch.json`.

## Film notes and team sharing

Open a film to see the clock and **Mark this moment**. Add a short note, optional skill tag, and optional by name. The clock accepts time messages only from the current YouTube privacy-enhanced embed. It never estimates elapsed time while buffering. If the player cannot report time, use **Set timestamp manually**.

**Copy marks link** packs the film and notes into the URL hash. Opening a link previews notes without saving them. **Save marks into Locker** merges notes with existing local notes and adds the film ID to Locker. Duplicate notes are skipped. Each film supports up to 40 marks. Large shares download as JSON, opened through **Tools → Open shared file**. Links contain the notes, so share them only with intended readers.

Locker stays an array of IDs under `lacrossetube_vault`. Notes live separately under `lacrossetube_marks`. Practice cards use `lacrossetube_practice`, player setup uses `lacrossetube_profile`, and save timestamps use `lacrossetube_save_activity`. Everything is local to the browser. Team access is through sharing links/files; there is no synchronized team roster or cloud Locker.

## Mobile catalog

The default phone view uses swipe pages of four films in two columns and two rows. Previous/Next buttons provide an alternative to swiping. **Swipe pages / 2×2 grid** switches to vertical browsing and remembers the choice. Filters and sort stay above the bounded film widget. Tools groups secondary functions in one menu.

The optional setup includes position, focus, format, and four film-study questions. Missed questions boost review topics in Dispatch, shelf ordering, and starter practice. Correct or skipped questions add no weaknesses. **Apply my setup** builds a three-film practice; the other apply option preserves the current practice. Reset removes the profile while preserving Locker and notes.

**Trending / Rising** uses recent local saves and marks, with activity decaying over 14 days, plus Dispatch/editor weight. It is not a global popularity chart. Position and action filters operate on the same catalog.

## Stick-doctoring references

`data/stick-patterns.js` records mesh, traditional leather, and Pita references. Each record has source film IDs, head, mesh, recipe, comparison images, and a stage list. Stage images and timestamps remain `null` until supplied or verified; the UI labels these gaps. Do not substitute unrelated thumbnails or guessed timestamps for stage evidence. The heritage records also appear under **Sources & Scans**.

Images use `{ src, alt, credit, sourceUrl }`; stage times are seconds. Preserve maker attribution and check that the image domain is allowed by the content security policy in `vercel.json`.

## Ask Shelf and AI status

Ask Shelf is available to everyone without a key. It uses local matching and written coaching cues, with references to the catalog, Dispatch, saved film IDs, notes, and player setup. It is labeled as a local guide; no hosted language model is connected. It does not provide clinical diagnosis or personalized rehabilitation advice.

Free hosted access to open models is possible, but requires a provider account/key and has quotas. Options checked November 3, 2026:

- [Groq](https://console.groq.com/docs/rate-limits): free-plan limits vary by model and are shared across the organization.
- [OpenRouter](https://openrouter.ai/collections/free-models): free variants currently allow 50 requests/day without buying credits, with availability/rate limits.

No paid AI, provider credentials, public browser key, or paid fallback was added. A shared hosted trainer would need a secure key-holding service, abuse controls, and an explicit provider choice; a static browser bundle must never contain the site's provider key.

## Every-other-day reading desk

**Journal** contains a source-linked reading list covering sports medicine, training, sports technology, sports business, and lacrosse news. This is a reading desk, not AI-written reporting. It cites actual research records and official announcements without inventing clinical conclusions. Missing topics and source failures are disclosed.

`scripts/research_digest.py` queries PubMed and World Lacrosse using Python's standard library. No API key is required. Online publication dates are preferred over future print issue dates. It writes `data/research_posts.json`, `data/research_bundle.js`, and a Markdown issue in `blog/`. The separate bundle is preserved when the legacy shelf curator runs.

`.github/workflows/reading-desk.yml` schedules checks for both Eastern UTC offsets and retries. The script gates publication to **11am America/New_York or later, every other calendar day starting November 3, 2026**, including daylight-saving changes. It refuses duplicate same-day issues. GitHub schedules can be delayed; exact-minute delivery is not guaranteed. The workflow must be on the repository's default branch with Actions enabled. GitHub/Vercel account quotas still apply.

```sh
python3 scripts/research_digest.py              # Publish an issue now, once per date
python3 scripts/research_digest.py --scheduled  # Respect cadence and local time
```

The legacy `daily_6pm_curator.py` and its installer remain available. `scripts/daily_6pm_curation.yml` is a reference workflow, not an active GitHub schedule in that location.

## Validation

```sh
node --test tests/local-features.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

`tests/browser-check.js` is a Playwright CLI scenario. With the server running, open the local site in the CLI, then run:

```sh
playwright-cli run-code --filename=tests/browser-check.js
```

The scenario uses an isolated test origin's storage; do not run it against a browser profile containing Locker data you want to keep. It clears site storage. It verifies 390px/320px layout, synthesized Chromium touch swipes, clock message validation, notes, hash preview/import, local storage isolation, offline print, assessment persistence/recommendations, catalog filters/sorts, the workbench, the local guide, the Journal, and desktop layout. Screenshots and a print PDF are written under ignored `output/playwright/`.

Physical iPhone/Android gesture behavior and live YouTube timing under each viewer's playback restrictions require device checks. The manual timestamp path remains available when embeds are blocked.
