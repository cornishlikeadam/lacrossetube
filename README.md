# 🥍👑🌸 LACROSSETUBE // MODEL ST-100 OPERATOR'S MANUAL
### *The Zero-Slop Lacrosse Mastery, Stick Doctoring & Printable Playbook Archive*
**EDITION:** `BASQUIAT 👑 × MURAKAMI 🌸 // ST-100 HARDWARE MANUAL v1.0 🎛️`  
**AGE RATING:** `AGES 10 TO 100 — LEARN IT IN 5 MINUTES, RETEACH A TEAMMATE IN 60 SECONDS`  
**DAILY HEARTBEAT:** `23:00 UTC CURATOR (6:00 PM EST / 7:00 PM EDT) · SEED SHELF IS VERIFIED FILM, NOT A VOUCH COUNT`  
**LIVE VERCEL DEPLOYMENT:** **[https://lacrossetube.vercel.app](https://lacrossetube.vercel.app)**

---

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  👑 SAMO©TRUTH:  ~~CLICKBAIT GEAR VLOGS~~  ~~SHOCKED FACES~~  ~~FAKE HYPE~~  ║
║  🌸 SUPERFLAT JOY: TIGHT CHANNELS · CANADIAN SEALS · 10-MAN RIDES · PDFS    ║
║  🎛️ ST-100 SPEC:   4 PILLARS + 6PM CRON + 50% STILL FRAME + LOCAL LOCKER    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 🎈 `[00]` THE 10-YEAR-OLD STORY: Why Did We Build LacrosseTube?

Imagine you have a big lacrosse game tomorrow morning. Your pocket is bagging out, or your coach just told you that you're running the **10-Man Ride** and **Canadian Box Two-Man Game**.

So you open regular YouTube to learn how to tie a **Stacked SI Knot** or run a **Coma Slide**.  
Instead of teaching you, a guy with his mouth wide open screams:  
> *"I BOUGHT $2,000 OF MYSTERY LACROSSE GEAR!! (GONE WRONG!!)"* 🤡

That is what regular YouTube's computer brain (**The Algorithm**) does. It wants you watching 20-minute commercials instead of hitting the wall!

Inspired by **Andrej Karpathy's HackerTube**, we built **LacrosseTube (`Model ST-100`)** around one unbreakable rule:
> **"No Algorithm. No Clickbait Thumbnails. Only lacrosse videos and printable PDF playbooks that real coaches, players, and stick doctors vouched for!"**

### 🗣️ The 60-Second Reteach Script (Say This to Your Teammate at Practice!)
> *"Regular YouTube tries to trick you with loud gear unboxings and fake cover photos. LacrosseTube is our quiet team film room: it scrapes `r/lacrosse`, `r/stickdoctor`, POWLAX, ECD, StringKing, and JM3 every day at 6:00 PM, replaces every cover photo with the 50% halfway frame (`hq2.jpg`) so you see the real knot or play diagram right away, and lets you save drills to your own Locker with zero login!"*

---

## 🎛️ `[01]` ST-100 FRONT PANEL: The 4 Main Skill Switches (+ 2 Radar Dials)

When you open [`index.html`](./index.html), it looks just like YouTube so your fingers already know what to do—but every button is tuned for **lacrosse mastery**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🥍 LacrosseTube [ST-100]     [ 🔍 Search "/" ]         [🟢 6PM ON] [Locker] │
├──────────────────────────────────────────────────────────────────────────────┤
│  [🌸 All] [🥍 1. Stick Doctoring] [⚡ 2. Box & Two-Man] [🛡️ 3. Defense & IQ] │
│  [📑 4. Playbook PDFs & Wall-Ball] [👑📰 Daily 6PM Blog] [📡 Trend Radar]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Switch | Label | What Lives Inside (For a 10-Year-Old Player) |
| :--- | :--- | :--- |
| **`[SW-01]`** | **🥍 1. Stick Doctoring & Pockets** | How to lock down a 9-diamond topstring, tie Anchor/SI/Barrel knots, string traditional leather pita pockets, and pound mesh so your stick throws darts. |
| **`[SW-02]`** | **⚡ 2. Box Mechanics & Two-Man Game** | How Canadian box players set seals, slip picks, protect their stick in a phone booth, and finish with twisters and fake-flips. |
| **`[SW-03]`** | **🛡️ 3. Defensive IQ, Footwork & Rides** | How to break down on approach without getting ankles broken, run Adjacent vs. Coma slides, trap teams in a 10-Man Ride, and walk the 5-point goalie arc. |
| **`[SW-04]`** | **📑 4. Playbook PDFs, Wall-Ball & Film Study** | Printable 20-minute 500-rep wall-ball checklists, D1 film breakdowns, and coaching PDFs you can print on paper and tape inside your locker! |
| **`[DIAL-A]`** | **👑📰 Daily 6PM Top-10 Blog** | Every evening at 6:00 PM after practice, our robot scout writes a dispatch ranking the **Top 10 best lacrosse videos and PDFs** verified that day. |
| **`[DIAL-B]`** | **📡 Trend, Channel & Forum Radar** | Scans Google News/Trends RSS (`PLL`, `NCAA lacrosse`, `box lacrosse`, `stringing`), indexes top coaching channels, and tracks active lacrosse forums. |

---

## 🔧 `[02]` HOW THE ENGINE WORKS (3 Secret Tricks Anyone Can Teach)

```
   [ REAL LACROSSE FORUMS ]       [ THE 3-STEP FILTER ]           [ TEAM FILM ROOM ]
  • r/lacrosse & r/stickdoctor ──► 1. 👑 Coach & Player Vouch ──► • Videos + Playbook PDFs
  • POWLAX / ECD / StringKing      2. 🌸 50% Midpoint Camera      • 6:00 PM Top-10 Blog
  • JM3 / Archive.org Texts        3. 🎛️ Anti-Buick Guardrail     • Local Browser Locker
```

### Trick 1: 🌸 The 50% Halfway Camera Trick (`hq2.jpg`)
YouTubers put shocked faces and neon arrows on their cover photo to trick you into clicking.
* **How we defeat it:** Every YouTube video automatically stores a frame from **exactly halfway through the video** at `https://i.ytimg.com/vi/<VIDEO_ID>/hq2.jpg`.
* Halfway through a real lacrosse video is where the coach is drawing on the whiteboard or zooming in on the sidewall knot!

### Trick 2: 👑 Live `oEmbed` + Topic Guardrail (No Dead Links, No "Buick LaCrosse" Cars!)
In Cycle 1 testing, searching open archives for `"Lacrosse"` accidentally pulled in a **2005 Buick LaCrosse car crash-test PDF** and a **La Crosse, Wisconsin directory**!
* **How we fixed it:** `daily_6pm_curator.py` runs an explicit domain guardrail (`is_on_topic`) that blocks automobiles (`buick`, `fmvss`), cities (`wisconsin`), and gaming slop, while checking every single video against YouTube's live `oEmbed` server.

### Trick 3: ⏰ The 6:00 PM Clockwork Scout (`daily_6pm_curator.py`)
Every day at **6:00 PM (18:00)**:
1. Our macOS LaunchAgent (`com.lacrossetube.daily6pm.plist`) or GitHub Action wakes up.
2. It scrapes `r/lacrosse`, `r/stickdoctor`, Internet Archive `mediatype:texts`, and Google News/Trends RSS.
3. It verifies **25+ items** and saves them to `data/catalog.json`, `data/live_bundle.js`, and `blog/YYYY-MM-DD-top-10-dispatch.md`.

---

## 🗂️ `[03]` PARTS INVENTORY (What Every File in This Box Does)

| Part Number | File Path | Job Description |
| :--- | :--- | :--- |
| **`[PART-01]`** | [`index.html`](./index.html) & [`vibe-coding/build/index.html`](./vibe-coding/build/index.html) | **The Film Room Screen.** Open in any browser to use LacrosseTube immediately. |
| **`[PART-02]`** | [`daily_6pm_curator.py`](./daily_6pm_curator.py) | **The 6:00 PM Robot Scout.** Scrapes live lacrosse data, checks `oEmbed`, and writes the Top-10 blog. |
| **`[PART-03]`** | [`data/catalog.json`](./data/catalog.json) | **The Locker Chest.** 34+ live-verified videos (`hq2.jpg` frames) and printable Playbook PDFs. |
| **`[PART-04]`** | [`data/trends_and_sources.json`](./data/trends_and_sources.json) | **The Radar Map.** Live Google News/Trends signals + indexed lacrosse coaching channels & forums. |
| **`[PART-05]`** | [`blog/2026-11-02-top-10-dispatch.md`](./blog/2026-11-02-top-10-dispatch.md) | **Today's 6PM Dispatch.** The Top 10 added lacrosse videos & playbooks with summaries. |
| **`[PART-06]`** | [`scripts/install_mac_6pm_agent.sh`](./scripts/install_mac_6pm_agent.sh) | **The Mac 6PM Timer.** Installs the macOS `launchd` agent so your Mac harvests daily at 18:00. |
| **`[PART-07]`** | [`vibe-coding/`](./vibe-coding/) | **The Complete Obsidian `vibe-coding` Packet.** Synced to `/Users/kjcornish/Documents/Obsidian Vault/LacrosseTube/vibe-coding/`. |

---

## 🚀 `[04]` QUICK-START OPERATIONS (3 Commands)

```bash
# 1. Run a live harvest + generate today's Top-10 Lacrosse Dispatch manually
python3 daily_6pm_curator.py

# 2. Install/verify the macOS 6:00 PM LaunchAgent
bash scripts/install_mac_6pm_agent.sh

# 3. Serve locally on port 8090
python3 -m http.server 8090
```
