# ADR-001: 50% Midpoint Thumbnails (`hq2.jpg`), `oEmbed` Liveness & Strict Lacrosse Topic Guardrail

**Status:** accepted (Class 14, updated in Class 17 after Cycle 1 homonym test)

**Context:** Mainstream lacrosse YouTube is saturated with custom clickbait thumbnails (`maxresdefault.jpg`) showing exaggerated faces, mystery gear unboxings, and non-instructional hype. Furthermore, in Cycle 1 testing of our automated scraper against open archives for the keyword `"lacrosse"`, homonym collisions surfaced a 2005 *Buick LaCrosse* NHTSA automobile crash-test report and *La Crosse, Wisconsin* municipal records.

**Decision:** Every YouTube video card in LacrosseTube must bypass custom uploader thumbnails and render YouTube's automatic 50% midpoint still frame (`https://i.ytimg.com/vi/<VIDEO_ID>/hq2.jpg`) after passing a live YouTube `oEmbed` check (`HTTP 200`). In addition, `daily_6pm_curator.py` enforces a strict lacrosse-sport guardrail (`is_on_topic`) that requires verified lacrosse terminology and explicitly blocklists homonyms (`buick`, `motor vehicle`, `fmvss`, `wisconsin`, `la crosse`, `wright & ditson`).

**Consequence:** Players and coaches immediately see the actual pocket channel, sidewall knot, whiteboard slide diagram, or crease footwork on every card before clicking, and 100% of dead videos or non-sport "LaCrosse" homonyms are eliminated. As a tradeoff, `hq2.jpg` frames occasionally display natural motion blur during high-speed dodging clips rather than studio-posed text overlays.
