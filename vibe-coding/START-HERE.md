# 🥍👑🌸 LacrosseTube — Project 4 `vibe-coding` Packet (`Model ST-100`)

Every file in this folder follows the exact `vibe-coding` structure from `/Users/kjcornish/Documents/Obsidian Vault/Blackasuarus/vibe-coding/`, tuned for **LacrosseTube: The Zero-Slop Lacrosse Mastery, Stick Doctoring & Playbook Archive**.

---

## 🗺️ Packet Map (What Every File Does)

| Class | File | What Lives Inside |
|---|---|---|
| **14** | [`plan.md`](./plan.md) | Five lines: Option, User, Build sentence, Boundary, and Rejected idea. |
| **14** | [`prd.md`](./prd.md) | Goal, User, 3 Core Features, What happens, Look and feel, Out of scope, and 3 "Done when" checks. |
| **14** | [`decisions/ADR-001-midpoint-thumbnails-and-human-vouch.md`](./decisions/ADR-001-midpoint-thumbnails-and-human-vouch.md) | Why we replace clickbait YouTube thumbnails with `hq2.jpg` 50% midpoint frames and require community vouches. |
| **14** | [`decisions/ADR-002-static-local-first-vault-and-6pm-cron.md`](./decisions/ADR-002-static-local-first-vault-and-6pm-cron.md) | Why saved drills live in `localStorage` ("Locker / Vault") and new items arrive via a 6:00 PM static Python harvest. |
| **14** | [`sources/source-index.md`](./sources/source-index.md) | Every reference, API (`r/lacrosse`, `r/stickdoctor`, YouTube `oEmbed`, Internet Archive), coaching channel, and permission. |
| **15** | [`build/index.html`](./build/index.html) | The complete self-contained YouTube-style LacrosseTube application. |
| **15** | [`README.md`](./README.md) | **Basquiat 👑 × Murakami 🌸 × ST-100 Hardware Manual 🎛️** — written so a 10-year-old player can learn it in 5 minutes and reteach a teammate in 60 seconds. |
| **16 & 18** | [`build-record/testing-and-failure-log.md`](./build-record/testing-and-failure-log.md) | Four core tests across Cycle 1 and Cycle 2 (including fixing the off-topic "Buick Lacrosse" false positive). |
| **13–20** | [`build-record/ai-use-log.md`](./build-record/ai-use-log.md) | Complete log of prompts, scraper runs, oEmbed verification, and human editorial calls. |
| **20** | [`disclosure.md`](./disclosure.md) | Plain split between what AI generated and what the human builder decided. |
| **20** | [`reflection.md`](./reflection.md) | Reflection on anti-slop curation, the Karpathy invariant, and what comes next. |

---

## ⚡ Quick Launch

1. Open [`README.md`](./README.md) for the **10-Year-Old Player & Coach ST-100 Manual**.
2. Double-click [`build/index.html`](./build/index.html) (or `../index.html` at the repo root) to launch **LacrosseTube** in any browser.
3. Run `python3 ../daily_6pm_curator.py` anytime to trigger the live 6:00 PM scraper & Top-10 Blog generator.
