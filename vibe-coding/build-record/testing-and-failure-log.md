# testing-and-failure-log.md

## Success criteria

1. A visitor can filter all 4 lacrosse pillars, click any of the 10 sub-topic pills, press `/` to search by keyword (e.g. `"knot"`, `"10 man ride"`, `"wall ball"`), and see only verified lacrosse videos (`hq2.jpg` frames) and printable PDFs.
2. Clicking any video or PDF opens the distraction-free modal and clicking `+ Save to Locker` persists selections across page reloads via `localStorage`.
3. Running `python3 daily_6pm_curator.py` verifies 25+ live lacrosse items via YouTube `oEmbed` and Internet Archive, updates `data/catalog.json` and `data/live_bundle.js`, and renders the **👑📰 Daily 6PM Top-10 Blog** and **📡 Trend, Channel & Forum Radar** tabs.

## Cycle 1 (Class 16, initial live scraper & UI run)

| Test | What I did | Expected | Actual | Evidence | Likely cause |
|---|---|---|---|---|---|
| **Main path** | Opened `index.html`, clicked through all 4 Lacrosse pillars (`Stick Doctoring`, `Box Mechanics`, `Defensive IQ`, `Playbook PDFs`), opened a video modal, and clicked `+ Save to Locker`. | 25+ verified items load with `hq2.jpg` thumbnails; modal plays video via `youtube-nocookie.com`; Locker counter increments and persists on refresh. | 29 items loaded, modal and `localStorage` Locker worked, **but** only 17 of the 29 items were videos because the category cap broke out of the loop early. | `data/catalog.json` Cycle 1 run log (`17 videos, 12 PDFs`) | Early `break` statement in `get_foundational_lacrosse_curations` stopped after 5 total items per category instead of 2 per coaching query. |
| **Edge case** | Ran `python3 daily_6pm_curator.py` against Internet Archive `mediatype:texts` for `"lacrosse"` to test homonym collisions. | Only lacrosse sport manuals, NCAA programs, and rulebooks should be admitted. | **Failed edge case:** Item `#28` in `catalog.json` was `"Safety Compliance Testing for FMVSS 110: 2005 Buick Lacrosse"` (a car crash test!) and `"Climate Crock"`. | `data/catalog.json` lines 527–564 in Cycle 1 | Keyword `"lacrosse"` matched the *Buick LaCrosse* sedan on Archive.org and broad keyword matching in `is_on_topic` was too permissive. |
| **Unexpected input** | Pressed `/` to focus search and typed `xyz999nonexistent` and special characters `"'<>`. | Grid cleanly shows `Showing 0 of N human-vouched items` without console errors or broken DOM. | Passed: Grid rendered 0 cards cleanly and recovered immediately when input was cleared. | Live DOM inspection & search handler test | Client-side string `.toLowerCase().includes()` safely handles arbitrary strings. |
| **Out-of-scope request** | Attempted to view custom clickbait thumbnails (`maxresdefault.jpg`) or create a cloud user account. | System refuses accounts and strictly renders `hq2.jpg` 50% midpoint frames. | Passed: Zero login prompts exist and all video `<img>` tags point to `https://i.ytimg.com/vi/<ID>/hq2.jpg`. | `index.html` card template inspection | Enforced by static template and `ADR-001` / `ADR-002`. |

## Cycle 2 (Class 18, same tests after `ADR-001` guardrail & loop fix)

| Test | Cycle 1 | Cycle 2 | Mark | Evidence and ADR |
|---|---|---|---|---|
| **Main path** | 29 items (17 videos, 12 PDFs); category loop exited early. | **34 verified lacrosse items** (22 live `oEmbed`-verified YouTube videos + 12 printable Playbook PDFs & NCAA/UMD/Canadian manuals); all 4 pillars and 10 sub-tags richly populated. | **Improved** | Updated `daily_6pm_curator.py` per-query harvest (`22 videos + 12 PDFs = 34 items`); see `data/catalog.json`. |
| **Edge case** | Admitted `"2005 Buick Lacrosse"` car manual and `"Climate Crock"` video. | **0 false positives:** Strict lacrosse-sport guardrail (`is_on_topic`) + `BLOCKLIST_KEYWORDS` (`buick`, `fmvss`, `motor vehicle`, `wright & ditson`, `climate crock`) completely eliminated non-sport homonyms. | **Improved** | Documented in [`ADR-001-midpoint-thumbnails-and-human-vouch.md`](../decisions/ADR-001-midpoint-thumbnails-and-human-vouch.md). |
| **Unexpected input** | Clean zero-state handling on `/` search for `xyz999nonexistent`. | Clean zero-state handling across `/` search, sub-tag pills, and Locker filter toggle. | **Unchanged (Pass)** | Verified in both `index.html` and `vibe-coding/build/index.html`. |
| **Out-of-scope request** | Strictly enforced `hq2.jpg` midpoint frames and zero-account `localStorage`. | Strictly enforced `hq2.jpg` midpoint frames, `youtube-nocookie.com` embeds, and local-only `lacrossetube_vault`. | **Unchanged (Pass)** | Documented in [`ADR-002-static-local-first-vault-and-6pm-cron.md`](../decisions/ADR-002-static-local-first-vault-and-6pm-cron.md). |

## What the two cycles proved

Testing against live external APIs (YouTube `oEmbed` and Internet Archive `mediatype:texts`) in Cycle 1 immediately exposed a classic domain-homonym bug: the word `"Lacrosse"` matches both the Indigenous/NCAA creator sport and the *Buick LaCrosse* automobile. Adding a strict sport-context filter and automobile/city blocklist in Cycle 2 (`ADR-001`) while expanding per-query `oEmbed` verification raised the live catalog to **34 pure, human-vouched lacrosse items** with zero off-topic noise.
