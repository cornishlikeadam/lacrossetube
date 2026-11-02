# reflection.md

## What AI did

The agent translated our DeepGather / Karpathy HackerTube architecture into a dedicated lacrosse film room and stick-doctoring archive (`LacrosseTube`). Specifically, it wrote `daily_6pm_curator.py` to query live lacrosse communities (`r/lacrosse`, `r/stickdoctor`), verify every candidate video via YouTube's `oEmbed` endpoint, extract `hq2.jpg` 50% midpoint thumbnails, pull printable historical/NCAA lacrosse PDFs from the Internet Archive Open API, and compile everything into a zero-latency static bundle (`data/live_bundle.js`) rendered by `index.html` and `vibe-coding/build/index.html`.

## What stayed mine

The core product thesis, domain taxonomy, and quality bar stayed mine. Anyone who has coached youth or high school lacrosse—or tried to learn how to tie a Stacked SI knot or run a 10-man ride on YouTube—knows that mainstream sports YouTube optimizes for gear-haul clickbait rather than actual footwork or pocket craft. Choosing the 4 pillars (Stick Doctoring, Box Mechanics, Defensive IQ/Rides, and Printable Playbooks/Wall-Ball) and inspecting `data/catalog.json` after Cycle 1 to purge the *2005 Buick LaCrosse* NHTSA car crash-test PDF were human editorial judgments.

## What this agent still gets wrong

Left unguarded on open-web search APIs, an automated scraper treats every string match for `"lacrosse"` as equal—happily indexing a General Motors sedan manual or a La Crosse, Wisconsin city directory alongside a POWLAX 10-man ride breakdown. Furthermore, because `hq2.jpg` grabs the exact 50% timestamp of a video without computer-vision frame selection, fast transition clips occasionally show motion blur. I kept `hq2.jpg` intentionally because an unedited midpoint frame is still 100x more honest than a clickbait thumbnail.

## What I carry forward

The combination of **Karpathy's 50% midpoint thumbnail rule (`hq2.jpg`) + live `oEmbed` verification + a daily 6:00 PM static JSON/JS compiler + an ST-100 manual a 10-year-old can reteach in 60 seconds** is a reusable blueprint for reclaiming any high-skill craft (lacrosse, woodworking, homesteading, brass instruments) from algorithmic slop.

## What I would change with one more week

With one more week, I would add an interactive **Sideline Pocket Pattern Builder** inside Tab 1 (`Stick Doctoring & Pockets`) that pairs each `hq2.jpg` stringing tutorial with a printable hole-by-hole sidewall stringing table (`9D Topstring -> Tie-off -> 1 -> SI -> SI -> Stacked SI -> 1 -> Tie-off`) so players can print the exact recipe for their head alongside the video.
