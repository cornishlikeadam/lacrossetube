import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('digest', Path(__file__).resolve().parents[1] / 'scripts' / 'research_digest.py')
digest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(digest)

class ResearchTests(unittest.TestCase):
    def test_online_publication_date_is_used_instead_of_future_print_issue(self):
        records = {'result': {'123': {'title': 'Wearable sensors for lacrosse', 'pubdate': '2027 Jan', 'epubdate': '2026 Nov 2', 'fulljournalname': 'Example Journal'}}}
        with patch.object(digest, 'fetch', side_effect=[json.dumps({'esearchresult': {'idlist': ['123']}}).encode(), json.dumps(records).encode()]):
            rows = digest.pubmed_items('Sports technology', 'lacrosse', 'Read the source.', datetime(2026, 11, 3, 16, tzinfo=timezone.utc))
            self.assertEqual(rows[0]['published'], '2026 Nov 2')
            self.assertEqual(rows[0]['url'], 'https://pubmed.ncbi.nlm.nih.gov/123/')

    def test_every_other_calendar_day_and_dst(self):
        # EST: 11am is 16 UTC. EDT: 11am is 15 UTC.
        self.assertFalse(digest.scheduled_day(datetime(2026, 11, 3, 15, tzinfo=timezone.utc)))
        self.assertTrue(digest.scheduled_day(datetime(2026, 11, 3, 16, tzinfo=timezone.utc)))
        self.assertFalse(digest.scheduled_day(datetime(2026, 11, 4, 16, tzinfo=timezone.utc)))
        self.assertTrue(digest.scheduled_day(datetime(2026, 11, 5, 16, tzinfo=timezone.utc)))
        summer = datetime(2027, 7, 1, 15, tzinfo=timezone.utc)
        if (summer.date() - digest.ANCHOR).days % 2:
            summer = summer.replace(day=2)
        self.assertTrue(digest.scheduled_day(summer))
        self.assertFalse(digest.scheduled_day(summer.replace(hour=14)))

    def test_empty_sources_never_publish(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(digest, 'pubmed_items', return_value=[]), patch.object(digest, 'lacrosse_news', return_value=[]):
            with self.assertRaises(RuntimeError):
                digest.publish(datetime(2026, 11, 3, 16, tzinfo=timezone.utc), folder)
            self.assertFalse((Path(folder) / 'data' / 'research_posts.json').exists())

    def test_deduplication_source_disclosures_and_idempotency(self):
        row = {'topic': 'Training', 'title': 'Example paper', 'url': 'https://pubmed.ncbi.nlm.nih.gov/1/', 'source': 'Journal', 'published': '2026 Nov', 'note': 'Read the source.', 'kind': 'Research paper'}
        now = datetime(2026, 11, 3, 16, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as folder, patch.object(digest, 'pubmed_items', return_value=[row]), patch.object(digest, 'lacrosse_news', side_effect=RuntimeError('offline')):
            self.assertTrue(digest.publish(now, folder))
            posts = json.loads((Path(folder) / 'data' / 'research_posts.json').read_text())
            self.assertEqual(len(posts[0]['items']), 1)
            self.assertIn('Sports medicine', posts[0]['missingTopics'])
            self.assertTrue(posts[0]['sourceFailures'])
            self.assertFalse(digest.publish(now, folder))

if __name__ == '__main__':
    unittest.main()
