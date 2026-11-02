# LacrosseTube — Product Requirements (`prd.md`)

**Goal:** Build a calm, zero-dopamine, YouTube-style archive of human-vouched lacrosse mastery—combining 50% midpoint video thumbnails (`hq2.jpg`), printable coaching & wall-ball PDF playbooks, and a daily 6:00 PM autonomous scraper (`25+ items/day`).

**User:** A lacrosse player (from age 10 to college/mens-league), stick doctor, or coach who wants instant access to verified sidewall knot tutorials, box two-man game breakdowns, 10-man ride/slide packages, and printable practice sheets.

**Features:**
1. **Four-Pillar YouTube-Style Library with 50% Midpoint Frames:** Instant filtering across **🥍 1. Stick Doctoring & Pockets**, **⚡ 2. Box Mechanics & Two-Man Game**, **🛡️ 3. Defensive IQ, Footwork & Rides**, and **📑 4. Playbook PDFs, Wall-Ball & Film Study**, plus 10 granular drill sub-tags and `/` keyboard search. Every video renders `https://i.ytimg.com/vi/<ID>/hq2.jpg` so you see the actual pocket channel or field diagram before clicking.
2. **Daily 6:00 PM Autonomous Curator, Top-10 Blog & Trend Radar:** `daily_6pm_curator.py` harvests `r/lacrosse`, `r/stickdoctor`, YouTube `oEmbed`, Internet Archive (`mediatype:texts`), and Google News/Trends RSS every day at 6:00 PM to maintain 25+ verified items/day, publish a ranked Top-10 Dispatch blog, and map rising coaching channels and forums.
3. **Zero-Account Local Locker (`localStorage`) & Distraction-Free Player Modal:** Players and coaches can watch videos in a `youtube-nocookie.com` modal, download printable PDF drill cards, and save their favorite routines to their private browser Locker (`lacrossetube_vault`) with one click.

**What happens:**
- When a visitor opens LacrosseTube, `data/live_bundle.js` loads the verified catalog (34+ live items), Daily 6PM Top-10 Blog, and Trend/Forum Radar immediately.
- When a user clicks any card, a clean modal opens either the privacy-enhanced video player or the printable PDF playbook action card along with the community vouch quote and source link.
- When a user clicks `+ Save to Locker`, the item ID persists in `localStorage` (`lacrossetube_vault`) and updates the top header counter.

**Look and feel:** Dark-mode YouTube studio aesthetic (`#0f0f11` turf-night slate, `#f97316` lacrosse ball orange, `#10b981` field green, `#facc15` Basquiat gold) with `Plus Jakarta Sans` UI typography and `JetBrains Mono` ST-100 hardware telemetry badges.

**Out of scope / non-negotiables:**
- Do not require accounts, passwords, cookies, or cloud databases to use the Locker.
- Do not show custom clickbait YouTube thumbnails (`maxresdefault.jpg`); strictly enforce `hq2.jpg` 50% midpoint frames.
- Do not include off-topic matches for the word "Lacrosse" (e.g., Buick LaCrosse automobiles or La Crosse, Wisconsin municipal records).
- Do not show algorithmic infinite-scroll recommendations or autoplay sidebars inside the player modal.

**Done when:**
1. A visitor can filter all 4 lacrosse pillars, click any of the 10 sub-topic pills, press `/` to search by keyword (e.g. `"knot"`, `"10 man ride"`, `"wall ball"`), and see only verified lacrosse videos (`hq2.jpg` frames) and printable PDFs.
2. Clicking any video or PDF opens the distraction-free modal and clicking `+ Save to Locker` persists selections across page reloads via `localStorage`.
3. Running `python3 daily_6pm_curator.py` verifies 25+ live lacrosse items via YouTube `oEmbed` and Internet Archive, updates `data/catalog.json` and `data/live_bundle.js`, and renders the **👑📰 Daily 6PM Top-10 Blog** and **📡 Trend, Channel & Forum Radar** tabs.
