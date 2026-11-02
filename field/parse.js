// Turns any transcript a meeting tool can export into [{speaker, text}] lines.
// Common: Zoom/Teams WebVTT, SRT, plain "Name: text". Less common: YouTube SBV, Zoom saved
// captions ("[Name] 18:01:22"), Otter ("Name  0:03"), Whisper / AWS Transcribe / generic JSON.
const TS = /^\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?\s*(-->|,)\s*\d{1,2}:\d{2}(:\d{2})?([.,]\d{1,3})?/;

function speakerSplit(text) {
  const teams = text.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/);
  if (teams) return { speaker: teams[1].trim(), text: teams[2].trim() };
  const m = text.match(/^([A-Z][\w .'’-]{0,28}):\s+(.+)$/);
  if (m && !/^(start|stop|continue|keep|note)$/i.test(m[1])) return { speaker: m[1].trim(), text: m[2].trim() };
  return { speaker: '', text: text.trim() };
}

function fromJSON(raw) {
  let j; try { j = JSON.parse(raw); } catch { return null; }
  const out = [];
  const push = (speaker, text) => { if (text && String(text).trim()) out.push({ speaker: speaker || '', text: String(text).trim() }); };
  if (Array.isArray(j)) j.forEach(x => typeof x === 'string' ? push('', x) : push(x.speaker || x.name || x.speaker_label, x.text || x.transcript || x.content));
  else if (j.segments) j.segments.forEach(s => push(s.speaker, s.text));
  else if (j.results?.transcripts) j.results.transcripts.forEach(s => push('', s.transcript));
  else if (j.utterances) j.utterances.forEach(s => push(s.speaker, s.text));
  else if (j.transcript) push('', j.transcript);
  else if (j.text) push('', j.text);
  return out.length ? out : null;
}

export function parseTranscript(raw) {
  raw = raw.replace(/\r/g, '').replace(/^\uFEFF/, '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) { const j = fromJSON(trimmed); if (j) return { format: 'JSON', lines: j }; }
  const rows = raw.split('\n');
  let format = 'plain text';
  if (/^WEBVTT/.test(trimmed)) format = 'WebVTT (Zoom / Teams)';
  else if (rows.some(r => /-->/.test(r) && /,\d{3}/.test(r))) format = 'SRT';
  else if (rows.some(r => /^\d:\d{2}:\d{2}\.\d{3},\d:\d{2}:\d{2}\.\d{3}$/.test(r.trim()))) format = 'SBV (YouTube)';
  else if (rows.some(r => /^\[[^\]]+\]\s+\d{1,2}:\d{2}(:\d{2})?\s*$/.test(r.trim()))) format = 'Zoom saved captions';
  else if (rows.some(r => /^[A-Z][\w .'’-]{0,28}\s{2,}\d{1,2}:\d{2}(:\d{2})?\s*$/.test(r.trim()))) format = 'Otter';
  else if (rows.filter(r => /^[A-Z][\w .'’-]{0,28}:\s/.test(r.trim())).length > rows.length * .3) format = 'speaker-labelled text';

  const lines = []; let pendingSpeaker = '';
  for (let r of rows) {
    r = r.trim();
    if (!r || r === 'WEBVTT' || /^NOTE\b/.test(r) || /^\d+$/.test(r) || TS.test(r) || /^(Kind|Language):/.test(r)) continue;
    const zoomCap = r.match(/^\[([^\]]+)\]\s+\d{1,2}:\d{2}(:\d{2})?\s*$/);
    if (zoomCap) { pendingSpeaker = zoomCap[1]; continue; }
    const otter = r.match(/^([A-Z][\w .'’-]{0,28})\s{2,}\d{1,2}:\d{2}(:\d{2})?\s*$/);
    if (otter) { pendingSpeaker = otter[1]; continue; }
    const s = speakerSplit(r.replace(/<\/?c[^>]*>/g, ''));
    lines.push({ speaker: s.speaker || pendingSpeaker, text: s.text });
  }
  return { format, lines };
}

// Auto-captions repeat themselves. Drop sentences we've already heard (same words, any order).
export function sentences(lines) {
  const seen = []; const out = [];
  const key = s => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  for (const { speaker, text } of lines) {
    const parts = text.replace(/([.!?])\s+/g, '$1\n').split('\n').map(s => s.trim()).filter(s => s.length > 3);
    for (const p of parts) {
      const k = new Set(key(p)); if (k.size < 2 && p.length < 18) continue;
      const dup = seen.some(o => { let inter = 0; k.forEach(w => { if (o.has(w)) inter++; }); return inter / Math.max(k.size, o.size, 1) > .8; });
      if (dup) continue;
      seen.push(k); if (seen.length > 400) seen.shift();
      out.push({ speaker, text: p });
    }
  }
  return out;
}
