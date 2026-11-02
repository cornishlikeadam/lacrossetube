#!/usr/bin/env python3
"""Build the pre-harvest LacrosseTube shelf from live YouTube search.

Every video id is checked with YouTube oEmbed before it is written. Search
snippets that fail that check are dropped. Nothing in this file invents an id.
"""
from __future__ import annotations

import json
import re
import subprocess
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TODAY = "2026-11-02"
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# shelf, subTag, query, how many search hits to ask for
SEARCHES = [
    ("games", "College & Pro Film", "NCAA men's lacrosse highlights 2026", 30),
    ("games", "College & Pro Film", "NCAA men's lacrosse highlights 2025", 30),
    ("games", "College & Pro Film", "NCAA women's lacrosse highlights 2025", 24),
    ("games", "College & Pro Film", "NCAA women's lacrosse highlights 2026", 20),
    ("games", "College & Pro Film", "NCAA lacrosse championship highlights", 24),
    ("games", "College & Pro Film", "college lacrosse highlights", 30),
    ("games", "College & Pro Film", "Premier Lacrosse League highlights 2025", 24),
    ("games", "College & Pro Film", "Premier Lacrosse League highlights 2026", 24),
    ("games", "College & Pro Film", "PLL championship highlights lacrosse", 18),
    ("games", "College & Pro Film", "NLL lacrosse highlights", 24),
    ("games", "College & Pro Film", "world lacrosse championship highlights", 16),
    ("tips", "Tips & Tricks", "lacrosse shooting tips", 24),
    ("tips", "Tips & Tricks", "lacrosse dodging tutorial", 20),
    ("tips", "Tips & Tricks", "lacrosse faceoff tips", 18),
    ("tips", "Tips & Tricks", "lacrosse ground ball drill", 18),
    ("tips", "Wall-Ball Routines", "lacrosse wall ball routine", 18),
    ("tips", "Tips & Tricks", "lacrosse passing drills", 16),
    ("tips", "Tips & Tricks", "women's lacrosse skills tutorial", 18),
    ("defense", "Defensive IQ & Slides", "lacrosse defense slide tutorial", 22),
    ("defense", "Rides & Clears", "lacrosse clearing ride tutorial", 16),
    ("defense", "Goalie Positioning", "lacrosse goalie drills", 20),
    ("defense", "Defensive IQ & Slides", "lacrosse defensive footwork", 16),
    ("pockets", "Pocket & Mesh Channeling", "how to string a lacrosse head", 22),
    ("pockets", "Sidewall Knots", "lacrosse sidewall stringing tutorial", 16),
    ("pockets", "Traditional Leather", "traditional lacrosse pocket stringing", 14),
    ("pockets", "Pocket & Mesh Channeling", "ECD lacrosse stringing tutorial", 14),
    ("box", "Box & Two-Man Game", "box lacrosse tips", 20),
    ("box", "Dodging & Interior Finishing", "lacrosse dodge finish tutorial", 16),
    ("interviews", "Player Interviews", "lacrosse player interview", 28),
    ("interviews", "Player Interviews", "PLL lacrosse player interview", 22),
    ("interviews", "Player Interviews", "college lacrosse player interview", 22),
    ("interviews", "Player Interviews", "NLL lacrosse player interview", 16),
    ("interviews", "Player Interviews", "lacrosse coach interview", 16),
    ("business", "The Business", "lacrosse NIL", 16),
    ("business", "The Business", "lacrosse business sponsorship", 16),
    ("business", "The Business", "lacrosse company founder", 14),
    ("business", "The Business", "Premier Lacrosse League business", 14),
]

CAPS = {
    "games": 170,
    "tips": 90,
    "interviews": 80,
    "business": 40,
    "pockets": 50,
    "defense": 45,
    "box": 35,
}
LABELS = {
    "games": "College & Pro Film",
    "tips": "Tips & Tricks",
    "interviews": "Player Interviews",
    "business": "The Business",
    "pockets": "Stick Doctoring & Pockets",
    "box": "Box Mechanics & Two-Man Game",
    "defense": "Defensive IQ, Footwork & Rides",
    "shelf": "Sources & Archive Scans",
}
AVATAR = {
    "games": "🎬",
    "tips": "🎯",
    "interviews": "🎙️",
    "business": "📈",
    "pockets": "🥍",
    "box": "⚡",
    "defense": "🛡️",
    "shelf": "📑",
}
NOTES = {
    "games": "Game film from {author}. The still is the halfway frame, not a cover thumbnail.",
    "tips": "Skill clip from {author}.",
    "interviews": "Conversation from {author}.",
    "business": "Business-of-the-game clip from {author}.",
    "pockets": "Stick-stringing clip from {author}.",
    "defense": "Defense clip from {author}.",
    "box": "Box lacrosse clip from {author}.",
}
HARD_BLOCK = (
    "buick", "fortnite", "minecraft", "valorant", "crypto", "bitcoin", "fmvss", "nhtsa",
    "motor vehicle", "car crash", "la crosse, wisconsin", "la crosse wisconsin",
    "city of la crosse", "la crosse wi", "weather forecast", "lawn tennis", "city directory",
)
LAX_TOKEN = (
    "lacrosse", "lax", "pll", "nll", "fogo", "faceoff", "face-off", "wall ball", "wallball",
    "stringking", "powlax", "stick doctor", "premier lacrosse", "world lacrosse",
)


def blocked(text: str) -> bool:
    t = text.lower()
    if any(b in t for b in HARD_BLOCK):
        return True
    # "La Crosse" the city, unless the same line is clearly the sport.
    if re.search(r"\bla crosse\b", t) and "lacrosse" not in t:
        return True
    return False


def laxish(*parts: str) -> bool:
    blob = " ".join(parts).lower()
    return any(tok in blob for tok in LAX_TOKEN)


def fmt_dur(raw) -> str:
    try:
        seconds = int(float(raw))
    except (TypeError, ValueError):
        return "Film"
    if seconds < 15:
        return ""
    if seconds > 4 * 3600:
        return ""
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def search(query: str, n: int) -> list[tuple[str, str, str, str]]:
    cmd = [
        "yt-dlp", "--flat-playlist", "--no-warnings", "--ignore-errors",
        "--print", "%(id)s\t%(title)s\t%(channel)s\t%(duration)s",
        f"ytsearch{n}:{query}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    rows = []
    for line in proc.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        vid, title, channel = parts[0].strip(), parts[1].strip(), parts[2].strip()
        dur = parts[3].strip() if len(parts) > 3 else ""
        if not YT_ID.fullmatch(vid):
            continue
        if blocked(f"{title} {channel}"):
            continue
        if not laxish(title, channel):
            continue
        label = fmt_dur(dur)
        if dur and not label:
            continue
        rows.append((vid, title, channel, label or "Film"))
    return rows


def oembed(vid: str) -> dict | None:
    url = "https://www.youtube.com/oembed?url=" + urllib.parse.quote(
        f"https://www.youtube.com/watch?v={vid}", safe=""
    ) + "&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "LacrosseTubeCatalog/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception:
        return None
    title = (data.get("title") or "").strip()
    author = (data.get("author_name") or "").strip()
    if not title or blocked(f"{title} {author}") or not laxish(title, author):
        return None
    return {"title": title, "author": author or "Lacrosse channel"}


def shelf_items() -> list[dict]:
    """Pages and scans that are really there. None of these are drill PDFs we host."""
    pages = [
        ("src-usalacrosse-coaching", "USA Lacrosse coaching resources", "USA Lacrosse",
         "https://www.usalacrosse.com/coaching-resources", "Source page",
         "USA Lacrosse's coaching resources page. This is a website, not a printable drill card."),
        ("src-powlax", "POWLAX coaching site", "POWLAX",
         "https://powlax.com/", "Source page",
         "POWLAX's own site. Open it for their drills. LacrosseTube does not host their PDF."),
        ("src-ustring", "uString stringing guides", "uString",
         "https://ustring.com/", "Source page",
         "uString's stringing site. This card opens their site, not a downloaded knot sheet."),
        ("arc-md-1989-program", "NCAA Division 1 Men’s Lacrosse Championship Program", "Internet Archive",
         "https://archive.org/details/universityofmar1989univ_0", "Archive scan",
         "A scanned championship program on the Internet Archive, not a practice PDF."),
        ("arc-md-mens-guides", "University of Maryland men's lacrosse media guides", "Internet Archive",
         "https://archive.org/details/mdu-univarch-027512", "Archive scan",
         "Scanned Maryland men's lacrosse media guides on the Internet Archive."),
        ("arc-md-womens-guides", "University of Maryland women's lacrosse media guides", "Internet Archive",
         "https://archive.org/details/universityofmar001univ_10", "Archive scan",
         "Scanned Maryland women's lacrosse media guides on the Internet Archive."),
        ("arc-canada-1869", "Lacrosse: the national game of Canada (historical scan)", "Internet Archive",
         "https://archive.org/details/cihm_05682", "Archive scan",
         "A historical book scan. It is an archive record, not a modern drill sheet."),
        ("arc-md-1992", "University of Maryland men's lacrosse media guides (1992)", "Internet Archive",
         "https://archive.org/details/universityofmar1992univ_0", "Archive scan",
         "Another scanned Maryland men's lacrosse media guide on the Internet Archive."),
        ("arc-md-1983", "University of Maryland men's lacrosse media guides (1983)", "Internet Archive",
         "https://archive.org/details/universityofmar1983univ_1", "Archive scan",
         "Another scanned Maryland men's lacrosse media guide on the Internet Archive."),
        ("arc-md-1990", "University of Maryland men's lacrosse media guides (1990)", "Internet Archive",
         "https://archive.org/details/universityofmar1990univ_1", "Archive scan",
         "Another scanned Maryland men's lacrosse media guide on the Internet Archive."),
        ("arc-md-1980", "University of Maryland men's lacrosse media guides (1980)", "Internet Archive",
         "https://archive.org/details/universityofmar1980univ_1", "Archive scan",
         "Another scanned Maryland men's lacrosse media guide on the Internet Archive."),
    ]
    items = []
    for sid, title, author, url, badge, note in pages:
        kind = "archive" if badge == "Archive scan" else "source"
        items.append({
            "id": sid,
            "type": kind,
            "category": "shelf",
            "categoryLabel": LABELS["shelf"],
            "subTag": badge,
            "duration": badge,
            "badge": badge,
            "midpointStill": "",
            "fallbackStill": "",
            "title": title,
            "author": author,
            "authorAvatar": AVATAR["shelf"],
            "sourceHub": author,
            "curatorNote": note,
            "vouchQuote": note,
            "url": url,
            "addedAt": TODAY,
        })
    return items


def main() -> None:
    found: dict[str, dict] = {}
    print(f"searching {len(SEARCHES)} queries", flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(search, q, n): (shelf, sub, q) for shelf, sub, q, n in SEARCHES}
        for fut in as_completed(futures):
            shelf, sub, query = futures[fut]
            try:
                rows = fut.result()
            except Exception as exc:
                print(f"  FAIL {query}: {exc}", flush=True)
                continue
            print(f"  {len(rows):3d}  {query}", flush=True)
            for vid, title, channel, dur in rows:
                slot = found.setdefault(vid, {"shelf": shelf, "sub": sub, "title": title, "channel": channel, "dur": dur, "hits": 0})
                slot["hits"] += 1
                # Prefer a more specific shelf if the same film shows up twice.
                if shelf in ("interviews", "business", "pockets", "defense") and slot["shelf"] == "games":
                    slot["shelf"] = shelf
                    slot["sub"] = sub

    print(f"unique search hits {len(found)}. checking oEmbed…", flush=True)
    verified: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(oembed, vid): vid for vid in found}
        done = 0
        for fut in as_completed(futs):
            vid = futs[fut]
            done += 1
            meta = fut.result()
            if meta:
                verified[vid] = meta
            if done % 100 == 0:
                print(f"  oEmbed {done}/{len(found)} kept {len(verified)}", flush=True)
    print(f"oEmbed kept {len(verified)} of {len(found)}", flush=True)

    buckets: dict[str, list] = defaultdict(list)
    for vid, meta in verified.items():
        slot = found[vid]
        buckets[slot["shelf"]].append((slot["hits"], vid, meta, slot))
    for shelf in buckets:
        buckets[shelf].sort(key=lambda row: (-row[0], row[2]["title"].lower()))

    chosen: list[dict] = []
    overflow: list[tuple] = []
    for shelf, cap in CAPS.items():
        rows = buckets.get(shelf, [])
        for row in rows[:cap]:
            chosen.append(row)
        overflow.extend(rows[cap:])
    if len(chosen) < 500:
        overflow.sort(key=lambda row: (-row[0], row[2]["title"].lower()))
        for row in overflow:
            if len(chosen) >= 500:
                break
            chosen.append(row)
    chosen = chosen[:500]
    if len(chosen) < 500:
        raise SystemExit(f"Only {len(chosen)} verified films. Refusing to pad the shelf with invented ids.")

    videos = []
    for hits, vid, meta, slot in chosen:
        shelf = slot["shelf"]
        note = NOTES[shelf].format(author=meta["author"])
        videos.append({
            "id": f"yt-{vid}",
            "type": "video",
            "youtubeId": vid,
            "category": shelf,
            "categoryLabel": LABELS[shelf],
            "subTag": slot["sub"],
            "duration": slot["dur"],
            "badge": "50% Still Frame",
            "midpointStill": f"https://i.ytimg.com/vi/{vid}/hq2.jpg",
            "fallbackStill": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "title": meta["title"],
            "author": meta["author"],
            "authorAvatar": AVATAR[shelf],
            "sourceHub": meta["author"],
            "curatorNote": note,
            "vouchQuote": note,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "addedAt": TODAY,
        })

    order = list(CAPS)
    videos.sort(key=lambda item: (order.index(item["category"]), item["title"].lower()))
    catalog = videos + shelf_items()

    links = link_map(videos)
    blog = blog_entry(videos)
    trends_path = DATA / "trends_and_sources.json"
    trends = json.loads(trends_path.read_text()) if trends_path.exists() else {}

    DATA.mkdir(exist_ok=True)
    (DATA / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    (DATA / "links.json").write_text(json.dumps(links, indent=2) + "\n")
    (DATA / "blog_posts.json").write_text(json.dumps([blog], indent=2) + "\n")
    bundle = (
        "// Auto-generated by scripts/seed_catalog.py. Every youtubeId passed oEmbed.\n"
        f"window.LACROSSETUBE_LIVE_CATALOG = {json.dumps(catalog)};\n"
        f"window.LACROSSETUBE_LIVE_BLOGS = {json.dumps([blog])};\n"
        f"window.LACROSSETUBE_LIVE_TRENDS = {json.dumps(trends)};\n"
    )
    (DATA / "live_bundle.js").write_text(bundle)
    counts: dict[str, int] = defaultdict(int)
    for item in catalog:
        counts[item["category"]] += 1
    print("WROTE", len(catalog), "items", dict(counts), flush=True)
    print("links", links, flush=True)


def link_map(videos: list[dict]) -> dict[str, str]:
    """Point each coach concept at one real catalog id."""
    rules = [
        ("help", ("help", "backside", "slide package", "defensive")),
        ("slide", ("slide", "adjacent", "coma", "recovery")),
        ("talk", ("communication", "talk", "call")),
        ("angle", ("approach", "angle", "footwork", "breakdown")),
        ("pick", ("pick", "two-man", "two man", "screen")),
        ("danger", ("crease", "finish", "shoot")),
        ("double", ("double", "trap", "ride")),
        ("loose", ("ground ball", "wall ball", "wallball")),
        ("hold", ("goalie", "pipe", "save")),
        ("disguise", ("short stick", "lsm", "matchup", "dodge")),
        ("hustle", ("ride", "ground ball", "clear", "hustle")),
    ]
    used = set()
    out = {}
    for concept, keys in rules:
        best = None
        for item in videos:
            if item["id"] in used:
                continue
            blob = f"{item['title']} {item['subTag']} {item['category']}".lower()
            score = sum(3 if k in blob else 0 for k in keys)
            if item["category"] == "defense":
                score += 1
            if score > (best[0] if best else 0):
                best = (score, item["id"])
        if best and best[0] > 0:
            out[concept] = best[1]
            used.add(best[1])
        else:
            fallback = next(item["id"] for item in videos if item["id"] not in used)
            out[concept] = fallback
            used.add(fallback)
    return out


def blog_entry(videos: list[dict]) -> dict:
    picks = []
    seen = set()
    for shelf in ("games", "interviews", "tips", "business", "defense", "box", "pockets"):
        for item in videos:
            if item["category"] == shelf and item["id"] not in seen:
                picks.append(item)
                seen.add(item["id"])
                break
    while len(picks) < 10:
        for item in videos:
            if item["id"] not in seen:
                picks.append(item)
                seen.add(item["id"])
                break
        else:
            break
    return {
        "id": "blog-2026-11-02-seed",
        "date": "November 02, 2026",
        "timestamp": "2026-11-02 seed shelf",
        "title": "Seed shelf: 500 verified lacrosse films, before the first auto-harvest",
        "summary": "This shelf was built from YouTube search and checked with oEmbed. Counts are films on the shelf, not human vouch totals. A card that is not a video says Source page or Archive scan.",
        "markdownPath": "blog/2026-11-02-seed-shelf.md",
        "top10": picks[:10],
    }


if __name__ == "__main__":
    main()
