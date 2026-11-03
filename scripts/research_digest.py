#!/usr/bin/env python3
"""Publish a source-linked research reading list, with no AI service or API key.

Schedule is every other calendar day at 11am America/New_York. GitHub may delay
scheduled runs; --scheduled permits a late same-day run but never an early one.
No clinical summaries are generated from paper titles or news headlines.
"""
import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
EASTERN = ZoneInfo('America/New_York')
ANCHOR = date(2026, 11, 3)
PUBMED = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
SPORTS = '(lacrosse[Title/Abstract] OR athlete*[Title/Abstract] OR sport*[Title/Abstract])'
TOPICS = {
    'Sports medicine': (SPORTS + ' AND (injur*[Title] OR concussion[Title] OR rehabilitation[Title])', 'Research reference. Check the study population and limitations with a qualified clinician before applying health information.'),
    'Training': (SPORTS + ' AND ("skill acquisition"[Title/Abstract] OR "strength training"[Title/Abstract] OR "conditioning"[Title/Abstract])', 'Research reference. Read the methods and training population before adapting a program.'),
    'Sports technology': (SPORTS + ' AND (wearable[Title] OR wearables[Title] OR sensor[Title] OR sensors[Title] OR "motion capture"[Title])', 'Research reference. Check validation, measurement accuracy, and the population studied before choosing a tool.'),
    'Sports business': (SPORTS + ' AND ("sports economics"[Title/Abstract] OR sponsorship[Title/Abstract] OR "name image likeness"[Title/Abstract] OR "sports management"[Title/Abstract])', 'Research reference. Check the market, population, and policy setting before drawing business conclusions.'),
}

def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'LacrosseTube-ReadingDesk/1.0 (+https://lacrossetube.vercel.app)'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read(2_000_000)

def scheduled_day(now):
    local = now.astimezone(EASTERN)
    return local.date() >= ANCHOR and (local.date() - ANCHOR).days % 2 == 0 and local.hour >= 11

def pubmed_items(topic, query, note, now):
    params = urllib.parse.urlencode({'db': 'pubmed', 'term': query, 'retmode': 'json', 'retmax': 8, 'sort': 'pub date', 'datetype': 'pdat', 'mindate': (now.astimezone(EASTERN).date() - timedelta(days=60)).strftime('%Y/%m/%d'), 'maxdate': now.astimezone(EASTERN).date().strftime('%Y/%m/%d')})
    ids = json.loads(fetch(PUBMED + 'esearch.fcgi?' + params))['esearchresult']['idlist']
    if not ids:
        return []
    params = urllib.parse.urlencode({'db': 'pubmed', 'id': ','.join(ids), 'retmode': 'json'})
    records = json.loads(fetch(PUBMED + 'esummary.fcgi?' + params))['result']
    rows = [{'topic': topic, 'title': html.unescape(records[pid]['title']).strip(), 'url': 'https://pubmed.ncbi.nlm.nih.gov/' + pid + '/', 'source': records[pid].get('fulljournalname') or 'PubMed', 'published': records[pid].get('epubdate') or records[pid].get('pubdate', ''), 'note': note, 'kind': 'Research paper'} for pid in ids if pid in records]
    def recent_key(row):
        try:
            return datetime.strptime(row['published'], '%Y %b %d').date()
        except ValueError:
            return date.min
    return sorted(rows, key=recent_key, reverse=True)[:2]

def lacrosse_news(now):
    root = ET.fromstring(fetch('https://worldlacrosse.sport/feed/'))
    rows = []
    business = re.compile(r'partner|sponsor|commercial|revenue|investment|broadcast|rights|funding|business|media deal', re.I)
    cutoff = now.timestamp() - 60 * 86400
    for item in root.findall('.//item'):
        title = html.unescape(item.findtext('title', '')).strip()
        url = item.findtext('link', '').strip()
        published = item.findtext('pubDate', '')
        try:
            stamp = parsedate_to_datetime(published)
            if stamp.timestamp() < cutoff or stamp.timestamp() > now.timestamp():
                continue
        except (ValueError, TypeError):
            continue
        if not title or not url.startswith('https://worldlacrosse.sport/'):
            continue
        topic = 'Sports business' if business.search(title) else 'Lacrosse & sport'
        if sum(row['topic'] == topic for row in rows) >= 2:
            continue
        rows.append({'topic': topic, 'title': title, 'url': url, 'source': 'World Lacrosse', 'published': stamp.date().isoformat(), 'note': 'Governing-body announcement. Read the original for details and context.', 'kind': 'Official announcement'})
    return rows

def publish(now, output_root=ROOT):
    output_root = Path(output_root)
    target = output_root / 'data' / 'research_posts.json'
    existing = json.loads(target.read_text()) if target.exists() else []
    day = now.astimezone(EASTERN).date().isoformat()
    if any(post['id'] == 'research-' + day for post in existing):
        print('Already published for ' + day)
        return False
    rows, failures = [], []
    for topic, (query, note) in TOPICS.items():
        try:
            rows.extend(pubmed_items(topic, query, note, now))
        except Exception as error:
            failures.append(topic)
            print('Source unavailable: ' + topic + ' (' + type(error).__name__ + ')', file=sys.stderr)
    try:
        rows.extend(lacrosse_news(now))
    except Exception as error:
        failures.append('Lacrosse & sport / Sports business')
        print('Source unavailable: World Lacrosse (' + type(error).__name__ + ')', file=sys.stderr)
    # Empty output is an error; never replace a real post with invented news.
    if not rows:
        raise RuntimeError('No current source items were available; nothing was published.')
    seen = set()
    rows = [row for row in rows if not (row['url'] in seen or seen.add(row['url']))]
    missing = [topic for topic in [*TOPICS, 'Lacrosse & sport', 'Sports business'] if not any(row['topic'] == topic for row in rows)]
    post = {'id': 'research-' + day, 'date': day, 'publishedAt': now.isoformat(), 'title': 'The reading desk · ' + day, 'summary': 'Recent research and official lacrosse announcements to read in the original. A source-linked reading list; no AI-generated reporting or clinical advice.', 'items': rows, 'missingTopics': missing, 'sourceFailures': failures}
    posts = [post, *existing][:60]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(posts, indent=2, ensure_ascii=False) + '\n')
    (target.parent / 'research_bundle.js').write_text('window.LACROSSETUBE_RESEARCH = ' + json.dumps(posts, ensure_ascii=False).replace('<', '\\u003c') + ';\n')
    blog_dir = output_root / 'blog'
    blog_dir.mkdir(parents=True, exist_ok=True)
    markdown = ['# ' + post['title'], '', post['summary'], '']
    for row in rows:
        markdown.extend(['## ' + row['topic'], '', '[' + row['title'].replace('[', '').replace(']', '') + '](' + row['url'] + ')', '', row['source'] + ' · ' + row['published'], '', row['note'], ''])
    if missing:
        markdown.append('No new source item in this issue: ' + ', '.join(missing) + '.')
    (blog_dir / (day + '-reading-desk.md')).write_text('\n'.join(markdown) + '\n')
    print('Published ' + str(len(rows)) + ' source links for ' + day)
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scheduled', action='store_true')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    if args.scheduled and not scheduled_day(now):
        print('Not due for an 11am Eastern reading desk issue.')
        return
    publish(now)

if __name__ == '__main__':
    main()
