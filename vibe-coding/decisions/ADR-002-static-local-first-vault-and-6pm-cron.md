# ADR-002: Static Local-First Locker (`localStorage`) & Daily 6:00 PM Pre-Compiled Bundle

**Status:** accepted (Class 14)

**Context:** Players and coaches want to open LacrosseTube on the sideline, in the locker room, or before a wall-ball session without creating an account, waiting for slow database queries, or hitting live Reddit/YouTube API rate limits in the browser.

**Decision:** We architected LacrosseTube as a zero-backend, local-first static application where user-saved drills and PDF playbooks persist in browser `localStorage` (`lacrossetube_vault`), while live community scraping happens asynchronously once a day at 6:00 PM via `daily_6pm_curator.py` (triggered by macOS `launchd` and GitHub Actions) into `data/catalog.json` and `data/live_bundle.js`.

**Consequence:** The web UI loads instantaneously (`0ms` database latency), works offline from the filesystem (`file://`) or on Vercel, and requires zero authentication or user tracking. The known limitation is that `localStorage` is scoped to the user's current browser and device.
