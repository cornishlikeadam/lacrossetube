// Catalog-aware, Locker/Marks-aware, and Dispatch-aware Lacrosse Assistant.
// Runs 100% locally/edge in the browser with zero required API keys (and optional window.ai / localStorage key support).
(function () {
  const ACTION_INDEX = [
    {
      keys: ['slide', 'right', 'left', 'adjacent', 'coma', 'help', 'recover', 'hot', 'second slide', 'defense', 'crease'],
      label: 'Defensive Slides & Approach Angles',
      summary: 'Call "I\'m hot" before the dodger beats the top foot, arrive stick-down on the hip, and send the second slide from the crease/X while the beaten defender recovers inside.',
      cats: ['defense'],
      subTags: ['Defensive IQ & Slides']
    },
    {
      keys: ['knot', 'rain', 'weather', 'sidewall', 'hold', 'channel', 'mesh', 'string', 'pocket', 'hook', 'whip', 'si', 'anchor', 'barrel', 'topstring'],
      label: 'All-Weather Sidewall Knots & Channel Lock',
      summary: 'To keep a pocket from bagging out in rain: lock the top 3 mesh diamonds with a 9D topstring and tight Anchor/SI knots, stack an SI at the sweet spot, and pound the pocket before tuning shooters.',
      cats: ['pockets'],
      subTags: ['Sidewall Knots', 'Pocket & Mesh Channeling']
    },
    {
      keys: ['leather', 'traditional', 'pita', 'wood', 'heritage', 'crosslace'],
      label: 'Traditional Leather & Heritage Stringing',
      summary: 'Pre-stretch the 4 leathers, interlock the center track (Pita runner) for a natural ball track, and tension outside crosslace diamonds slightly tighter than the center channel.',
      cats: ['pockets', 'shelf'],
      subTags: ['Traditional Leather', 'Archive scan']
    },
    {
      keys: ['goalie', 'arc', 'save', 'pipe', 'outlet', 'clear', 'low', 'bounce', 'thumb'],
      label: 'Goalie 5-Point Arc & Save Mechanics',
      summary: 'Hold the 5-point arc on the bisecting line, drive the top-hand thumb toward the ball on a 45-degree step, and look immediately to the wing outlet on the clear.',
      cats: ['defense'],
      subTags: ['Goalie Positioning', 'Rides & Clears']
    },
    {
      keys: ['box', 'two-man', '2-man', 'pick', 'seal', 'slip', 'canadian', 'inside', 'twister', 'fake', 'deception'],
      label: 'Canadian Box Two-Man Game & Interior Finishing',
      summary: 'Set the seal on the defender\'s upfield hip, read the switch vs. stay within two steps, and use shoulder/stick-head deception before releasing inside.',
      cats: ['box'],
      subTags: ['Box & Two-Man Game', 'Dodging & Interior Finishing']
    },
    {
      keys: ['ride', '10-man', 'ten man', 'clear', 'transition', 'midline', 'over and back'],
      label: '10-Man Ride & Clearing Ladder',
      summary: 'Leave the crease goalie covered by the attackman, jump adjacent outlet passes on the whistle, and trap the ball carrier against the sideline and midline.',
      cats: ['defense'],
      subTags: ['Rides & Clears']
    },
    {
      keys: ['wall', 'wallball', 'routine', 'off-hand', 'left hand', 'quick stick', 'practice'],
      label: '20-Minute Wall-Ball & Stickwork Progression',
      summary: 'Run 50 quick-sticks right, 50 left, 50 one-hand snaps, 50 split-dodge-to-throw, and 50 Canadian cross-face catches without extra cradles.',
      cats: ['tips'],
      subTags: ['Wall-Ball Routines', 'Tips & Tricks']
    }
  ];

  function scoreItemForQuery(item, qTokens, dispatchIds, savedIds, markMap) {
    const title = String(item.title || '').toLowerCase();
    const note = String(item.curatorNote || item.vouchQuote || '').toLowerCase();
    const sub = String(item.subTag || '').toLowerCase();
    const cat = String(item.categoryLabel || item.category || '').toLowerCase();
    const author = String(item.author || '').toLowerCase();
    const marks = markMap[item.id] || [];
    const markBlob = marks.map(m => `${m.text} ${m.skill || ''} ${m.by || ''}`).join(' ').toLowerCase();
    const full = `${title} ${note} ${sub} ${cat} ${author} ${markBlob}`;

    let score = 0;
    for (const tok of qTokens) {
      if (tok.length < 2) continue;
      if (title.includes(tok)) score += 18;
      if (sub.includes(tok)) score += 14;
      if (markBlob.includes(tok)) score += 22;
      if (note.includes(tok)) score += 10;
      if (author.includes(tok)) score += 8;
      if (full.includes(tok)) score += 4;
    }

    // Synonym / tactical cluster expansion
    for (const cluster of ACTION_INDEX) {
      if (qTokens.some(t => cluster.keys.includes(t))) {
        if (cluster.cats.includes(item.category)) score += 12;
        if (cluster.subTags.includes(item.subTag)) score += 15;
      }
    }

    if (dispatchIds.has(item.id)) score += 6;
    if (savedIds.includes(item.id)) score += 5;
    if (marks.length > 0) score += marks.length * 4;
    return score;
  }

  async function askShelf(question, context) {
    const q = String(question || '').trim();
    if (!q) return null;
    const lower = q.toLowerCase();
    const tokens = lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);

    const catalog = context.catalog || [];
    const dispatch = context.dispatch || { items: [] };
    const savedIds = context.savedIds || [];
    const markMap = context.markMap || {};
    const profile = context.profile || null;
    const dispatchIds = new Set((dispatch.items || []).map(i => i.id));

    // Check if the user is asking specifically about their Locker or Marks
    const askingLocker = /\b(my locker|saved|my marks|marked|practice card)\b/i.test(lower);
    let pool = askingLocker && savedIds.length
      ? catalog.filter(item => savedIds.includes(item.id) || (markMap[item.id] && markMap[item.id].length))
      : catalog;
    if (!pool.length) pool = catalog;

    // Score all items
    const ranked = pool
      .map(item => ({ item, score: scoreItemForQuery(item, tokens, dispatchIds, savedIds, markMap) }))
      .sort((a, b) => b.score - a.score || (b.item.vouchCount || 0) - (a.item.vouchCount || 0));

    const picks = ranked.slice(0, 4).map(r => r.item);

    // Find matching tactical coaching cue
    let matchedCluster = ACTION_INDEX.find(c => tokens.some(t => c.keys.includes(t)));
    if (!matchedCluster && profile) {
      matchedCluster = ACTION_INDEX.find(c => c.keys.includes((profile.focus || '').toLowerCase())) || ACTION_INDEX[0];
    }

    // Build response text
    let coachingLine = matchedCluster
      ? `**${matchedCluster.label}:** ${matchedCluster.summary}`
      : `Searched **${catalog.length} shelf items**, **${(dispatch.items || []).length} Dispatch drops**, and **${savedIds.length} Locker saves** for *"${q}"*.`;

    // Check if any picked item is in today's Dispatch or has user marks
    const dispatchHits = picks.filter(p => dispatchIds.has(p.id));
    const markedHits = picks.filter(p => (markMap[p.id] || []).length > 0);

    const contextNotes = [];
    if (dispatchHits.length) {
      const dItem = dispatch.items.find(d => d.id === dispatchHits[0].id);
      contextNotes.push(`👑 **In Today's Dispatch:** *${dispatchHits[0].title}* — ${dItem?.why || ''}`);
    }
    if (markedHits.length) {
      const m = markMap[markedHits[0].id][0];
      contextNotes.push(`📌 **Your Local Mark (${window.LT ? window.LT.fmt(m.t) : m.t + 's'}):** "${m.text}"${m.by ? ` — *${m.by}*` : ''}`);
    }

    // Optional Chrome built-in Prompt API (window.ai) enhancement if available locally
    if (window.ai && typeof window.ai.createTextSession === 'function') {
      try {
        const session = await window.ai.createTextSession();
        const prompt = `You are a concise lacrosse coach assistant for LacrosseTube. Question: "${q}". Top matching shelf films: ${picks.map(p => p.title + ' by ' + p.author).join('; ')}. Give a 2-sentence technical lacrosse answer.`;
        const aiText = await session.prompt(prompt);
        if (aiText && aiText.trim()) {
          coachingLine = aiText.trim();
        }
      } catch {
        // Fallback to deterministic local coaching synthesis
      }
    }

    return {
      question: q,
      coachingLine,
      contextNotes,
      picks
    };
  }

  globalThis.LT_AI = {
    askShelf,
    ACTION_INDEX
  };
})();
