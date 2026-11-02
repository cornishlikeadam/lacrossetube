# Submission & Quality Checklist — LacrosseTube (`vibe-coding`)

Keep this open while reviewing the packet. Every item is verified complete.

## The idea and the plan
- [x] `plan.md` names one real user (a lacrosse player or youth/high-school coach), one rejected idea and why, and the hard boundary.
- [x] The build sentence names a user, an action, and a response.

## The PRD and decisions
- [x] `prd.md` fits on one screen and ends with three testable "Done when" checks.
- [x] `decisions/` holds two ADRs (`ADR-001-midpoint-thumbnails-and-human-vouch.md` and `ADR-002-static-local-first-vault-and-6pm-cron.md`).
- [x] Cycle 2 testing improvements (blocking "Buick Lacrosse" and non-sport matches) are documented in `build-record/testing-and-failure-log.md` and `ADR-001`.

## The build
- [x] `build/index.html` (and root `index.html`) opens and runs in any modern browser with zero login required.
- [x] `README.md` is written in **Basquiat 👑 × Murakami 🌸 × ST-100 Hardware Manual 🎛️** style (10-year-old learn & reteach edition) and states how to open it, what it will not do, and its known limits.
- [x] `sources/source-index.md` lists every live community source (`r/lacrosse`, `r/stickdoctor`, YouTube `oEmbed`, Internet Archive, POWLAX, ECD, StringKing, JM3, USA Lacrosse) with permission.

## The record
- [x] `build-record/testing-and-failure-log.md` shows the same four tests across Cycle 1 and Cycle 2, marked.
- [x] `build-record/ai-use-log.md` logs every consequential prompt, scraper pass, and editorial decision.
- [x] `disclosure.md` states what AI contributed and what the human builder decided.
- [x] `reflection.md` captures the builder's reflection on Karpathy's HackerTube architecture applied to lacrosse mastery.

## Before you push
- [x] No passwords, secret API keys, personal data, or unlicensed files are in the folder.
- [x] Synced to both `/Users/kjcornish/.gemini/antigravity/scratch/lacrossetube/vibe-coding/` and `/Users/kjcornish/Documents/Obsidian Vault/LacrosseTube/vibe-coding/`.
- [x] Pushed to private GitHub repo `cornishlikeadam/lacrossetube` and deployed live to Vercel.
