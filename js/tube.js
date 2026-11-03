const CATALOG = window.LACROSSETUBE_LIVE_CATALOG || [];
const BLOGS = window.LACROSSETUBE_LIVE_BLOGS || [];
const TRENDS = window.LACROSSETUBE_LIVE_TRENDS || {};

let currentCategory = 'dispatch';
let currentPosition = 'all';
let currentSort = 'default';
let currentSubTag = 'all';
let searchQuery = '';
let savedOnly = false;
let DISPATCH = null;
let dispatchReady = false;
let previewMarks = null;
let previewPractice = null;
let currentModalItemId = null;
let clockT = 0;
let clockTimer = 0;
let playerPlaying = false;
let markAt = null;
let pendingSkill = '';
let userProfile = window.LT?.loadProfile ? window.LT.loadProfile() : null;
let lastAiPicks = [];

let savedIds = [];
try {
  const raw = JSON.parse(localStorage.getItem('lacrossetube_vault') || '[]');
  if (Array.isArray(raw)) savedIds = raw.filter(id => typeof id === 'string');
} catch {
  savedIds = [];
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function safeUrl(value) {
  try {
    const url = new URL(value, location.origin);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* drop anything that is not a web URL */ }
  return '';
}

function ytId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test(value || '') ? value : '';
}

const META_LABEL = /still frame|still verified|halfway|hq2|karpathy|clickbait|50%\s*midpoint/i;

function badgeFor(item) {
  const badge = String(item.badge || '');
  if (badge && !META_LABEL.test(badge)) return badge;
  if (item.type === 'video') return '';
  if (item.type === 'archive') return 'Archive scan';
  const href = item.pdfUrl || item.url || '';
  if (item.type === 'playbook' && /\.pdf($|\?)/i.test(href)) return 'PDF';
  return 'Source page';
}

function shownTime(item) {
  const duration = String(item.duration || '');
  return META_LABEL.test(duration) ? '' : duration;
}

function noteFor(item) {
  return String(item.curatorNote || item.vouchQuote || '')
    .replace(/\s*The still is the halfway frame, not a cover thumbnail\.?/gi, '')
    .replace(/\bhalfway frames?\b[^.]*/gi, '')
    .replace(/\bhq2\.jpg\b/gi, '')
    .replace(/\b50%\s*(still frames?|midpoint[^.]*|still verified)\b/gi, '')
    .replace(/\bkarpathy\b[^.]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

// Phase 2.5: Computed short "Why it's here" line derived from existing item fields
function whyHereFor(item) {
  const t = String(item.title || '').toLowerCase();
  const sub = String(item.subTag || '');
  const cat = String(item.category || '');
  const author = String(item.author || 'Coach');
  const marks = window.LT ? LT.marksFor(item.id) : [];

  if (marks.length) {
    const m = marks[0];
    return `Why it's here: Marked at ${LT.fmt(m.t)} (${m.skill || 'note'}${m.by ? ' by ' + m.by : ''}) — "${m.text}"`;
  }
  if (cat === 'pockets') {
    if (/traditional|leather|pita/i.test(t + ' ' + sub)) {
      return `Why it's here: Shows traditional leather & crosslace diamond tensioning with ${author}.`;
    }
    if (/knot|sidewall|si|anchor|barrel/i.test(t + ' ' + sub)) {
      return `Why it's here: Close-up sidewall knot tie-offs & weatherproof channel lock from ${author}.`;
    }
    return `Why it's here: Full pocket pattern & mesh break-in reference by ${author}.`;
  }
  if (cat === 'defense') {
    if (/goalie|arc|save|pipe/i.test(t + ' ' + sub)) {
      return `Why it's here: Goalie 5-point arc geometry, hand speed & outlet reads (${author}).`;
    }
    if (/ride|clear|10-man|ten man/i.test(t + ' ' + sub)) {
      return `Why it's here: Full-field ride traps & clearing spacing diagrammed by ${author}.`;
    }
    return `Why it's here: Approach footwork, hip angle & early slide recovery with ${author}.`;
  }
  if (cat === 'box') {
    if (/two-man|2-man|pick|seal/i.test(t + ' ' + sub)) {
      return `Why it's here: Canadian two-man pick/seal timing & tight-space reads (${author}).`;
    }
    return `Why it's here: Interior stick protection, shoulder deception & crease finishing (${author}).`;
  }
  if (cat === 'tips') {
    if (/wall/i.test(t + ' ' + sub)) {
      return `Why it's here: Structured both-hands wall-ball rep progression from ${author}.`;
    }
    if (/faceoff|fogo|clamp/i.test(t)) {
      return `Why it's here: Whistle hand speed, clamp mechanics & wing exits (${author}).`;
    }
    return `Why it's here: Field-tested stickwork & footwork reps taught by ${author}.`;
  }
  if (cat === 'games') {
    return `Why it's here: Game-speed spacing, off-ball cuts & transition tempo (${author}).`;
  }
  if (cat === 'interviews') {
    return `Why it's here: Locker-room perspective & film IQ breakdown with ${author}.`;
  }
  if (cat === 'business') {
    return `Why it's here: Pro league growth, NIL & equipment craft context (${author}).`;
  }
  if (item.type === 'archive' || cat === 'shelf') {
    return `Why it's here: Primary source document & historical manual from ${author}.`;
  }
  return `Why it's here: Selected for ${sub || item.categoryLabel || 'the shelf'} (${author}).`;
}

// Phase 2.2: Trending / Rising score calculation using lightweight lacrosse niche trend signals + local marks/saves
const TREND_KEYWORDS = [
  { rx: /sidewall|knot|channel|mesh|top\s*string|ecd|stringking/i, boost: 28 },
  { rx: /box|two-man|2\s*man|seal|pick|nll|thompson/i, boost: 26 },
  { rx: /10\s*man|ride|clear|slide|coma|adjacent|powlax/i, boost: 25 },
  { rx: /sixes|world lacrosse|olympic|pll|championship|2026|2025/i, boost: 24 },
  { rx: /goalie|arc|save|outlet/i, boost: 22 },
  { rx: /wall\s*ball|500|routine|drill/i, boost: 21 }
];

function trendingScore(item) {
  const blob = `${item.title || ''} ${item.subTag || ''} ${item.author || ''} ${item.curatorNote || ''}`;
  let score = Number(item.vouchCount) || 50;
  for (const tk of TREND_KEYWORDS) {
    if (tk.rx.test(blob)) score += tk.boost;
  }
  if (savedIds.includes(item.id)) score += 35;
  const marksCount = window.LT ? LT.marksFor(item.id).length : 0;
  score += marksCount * 22;
  if ((DISPATCH?.items || []).some(d => d.id === item.id)) score += 30;
  if (userProfile && matchesProfile(item, userProfile)) score += 20;
  return score;
}

// Phase 2.3: Position-specific view matching & Clip-level / action search scoring
const POSITION_RULES = {
  attack: {
    cats: ['box', 'tips', 'games'],
    rx: /attack|dodg|shoot|finish|crease|question mark|rocker|split|two-man|2\s*man|x\s*attack|inside|wall\s*ball/i
  },
  midfield: {
    cats: ['tips', 'games', 'defense', 'box'],
    rx: /midfield|middie|alley|shoot on the run|transition|clear|ride|dodg|two-way|sixes|wall\s*ball/i
  },
  defense: {
    cats: ['defense', 'games'],
    rx: /defense|defensive|slide|adjacent|coma|approach|poke|check|lsm|pole|10\s*man|ride|clear|footwork|ground\s*ball/i
  },
  goalie: {
    cats: ['defense', 'tips'],
    rx: /goalie|goaltend|arc|save|pipe|outlet|clear|walk the line|bait/i
  },
  fogo: {
    cats: ['tips', 'games'],
    rx: /faceoff|face-off|fogo|clamp|plunger|wing|ground\s*ball|draw/i
  },
  box: {
    cats: ['box', 'games'],
    rx: /box|nll|indoor|two-man|2\s*man|seal|pick|canadian|twister|fake|short\s*stick/i
  },
  stick: {
    cats: ['pockets', 'shelf'],
    rx: /string|pocket|mesh|sidewall|knot|leather|traditional|pita|shooter|channel|head|ecd|stringking/i
  }
};

function matchesPosition(item, pos) {
  if (!pos || pos === 'all') return true;
  const rule = POSITION_RULES[pos];
  if (!rule) return true;
  const blob = `${item.title || ''} ${item.subTag || ''} ${item.categoryLabel || ''} ${item.curatorNote || ''} ${item.author || ''}`;
  if (rule.rx.test(blob)) return true;
  return rule.cats.includes(item.category);
}

// Clip-level / Action search expansion (handles natural phrases like "slide from the right" or "sidewall knot that holds in rain")
const STOP_WORDS = new Set(['from', 'the', 'that', 'with', 'into', 'for', 'and', 'how', 'to', 'in', 'on', 'a', 'an', 'of']);
const ACTION_SYNONYMS = {
  right: ['adjacent', 'slide', 'help', 'wing', 'alley', 'pipe'],
  left: ['adjacent', 'slide', 'off-hand', 'wing', 'alley'],
  rain: ['sidewall', 'knot', 'mesh', 'channel', 'tight', 'lock', 'leather', 'traditional', 'weather'],
  holds: ['knot', 'lock', 'channel', 'sidewall', 'hold', 'pocket'],
  hold: ['pocket', 'channel', 'knot', 'sidewall', 'deception'],
  slide: ['defense', 'adjacent', 'coma', 'recover', 'help', 'second'],
  knot: ['sidewall', 'stringing', 'anchor', 'interlock', 'barrel', 'topstring'],
  arc: ['goalie', 'positioning', 'save', 'pipe', 'step', 'footwork'],
  save: ['goalie', 'arc', 'low', 'high', 'bait', 'positioning'],
  seal: ['box', 'two-man', '2-man', 'pick', 'roll', 'slip', 'crease']
};

function actionSearchScore(item, rawQuery) {
  if (!rawQuery) return 1;
  const q = rawQuery.toLowerCase().trim();
  const marks = window.LT ? LT.marksFor(item.id) : [];
  const markText = marks.map(m => `${m.text} ${m.skill || ''} ${m.by || ''}`).join(' ').toLowerCase();
  const blob = [
    item.title,
    noteFor(item),
    whyHereFor(item),
    item.author,
    item.subTag,
    item.sourceHub,
    item.categoryLabel,
    markText
  ].join(' ').toLowerCase();

  // Direct substring match gets highest base score
  if (blob.includes(q)) return 100;

  // Token & synonym clip-level match
  const tokens = q.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !STOP_WORDS.has(t));
  if (!tokens.length) return 1;

  let score = 0;
  let matchedTokens = 0;
  for (const tok of tokens) {
    if (blob.includes(tok)) {
      score += 25;
      matchedTokens++;
      if ((item.title || '').toLowerCase().includes(tok)) score += 15;
      if ((item.subTag || '').toLowerCase().includes(tok)) score += 12;
      if (markText.includes(tok)) score += 20;
    } else if (ACTION_SYNONYMS[tok]) {
      const syns = ACTION_SYNONYMS[tok];
      if (syns.some(s => blob.includes(s))) {
        score += 14;
        matchedTokens += 0.7;
      }
    }
  }
  // Require at least half of meaningful tokens (or synonyms) to match
  return matchedTokens >= Math.max(1, tokens.length * 0.5) ? score : 0;
}

function matchesProfile(item, profile) {
  if (!profile) return false;
  if (profile.position && profile.position !== 'all' && matchesPosition(item, profile.position)) return true;
  const blob = `${item.title || ''} ${item.subTag || ''} ${item.category || ''}`.toLowerCase();
  if (profile.focus === 'stringing' && item.category === 'pockets') return true;
  if (profile.focus === 'slides' && item.category === 'defense') return true;
  if (profile.focus === 'dodging' && (item.category === 'box' || /dodg|shoot/i.test(blob))) return true;
  if (profile.focus === 'wallball' && (/wall|film/i.test(blob) || item.category === 'games')) return true;
  return false;
}

function thumbHtml(item) {
  const still = safeUrl(item.midpointStill);
  const fallback = safeUrl(item.fallbackStill);
  if (!still) {
    return `<div class="thumb-fallback">${esc(badgeFor(item))}</div>`;
  }
  const fb = fallback ? ` data-fallback="${esc(fallback)}"` : '';
  return `<img class="thumbnail-img" src="${esc(still)}"${fb} alt="${esc(item.title)}" loading="lazy">`;
}

function updateVaultCounter() {
  document.getElementById('vaultCount').innerText = savedIds.length;
}

function updateProfileBadge() {
  const badge = document.getElementById('activeProfileBadge');
  if (!badge) return;
  if (!userProfile) {
    badge.hidden = true;
    return;
  }
  const posLabels = {
    attack: '⚡ Attack/Mid',
    defense: '🛡️ Defense/LSM',
    goalie: '🧱 Goalie',
    box: '🇨🇦 Box',
    stick: '🧵 Stick Doctor'
  };
  badge.hidden = false;
  badge.textContent = `Setup: ${posLabels[userProfile.position] || userProfile.position} · ${userProfile.focus}`;
}

function toggleSave(id, event) {
  if (event) event.stopPropagation();
  if (typeof id !== 'string' || !id) return;
  if (savedIds.includes(id)) savedIds = savedIds.filter(i => i !== id);
  else savedIds.push(id);
  localStorage.setItem('lacrossetube_vault', JSON.stringify(savedIds));
  updateVaultCounter();
  renderView();
}

function toggleSavedFilter() {
  savedOnly = !savedOnly;
  const btn = document.getElementById('savedToggleBtn');
  btn.style.borderColor = savedOnly ? 'var(--accent)' : 'var(--border-color)';
  renderView();
}

function setCategory(cat) {
  currentCategory = cat;
  currentSubTag = 'all';
  savedOnly = false;
  document.querySelectorAll('.chip').forEach(el => {
    el.classList.toggle('active', el.dataset.category === cat);
  });
  document.querySelectorAll('.subtag-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.sub === 'all');
  });
  renderView();
}

function setPosition(pos) {
  currentPosition = pos;
  if (currentCategory === 'blog' || currentCategory === 'trends' || currentCategory === 'dispatch') {
    if (pos !== 'all') {
      currentCategory = 'all';
      document.querySelectorAll('.chip').forEach(el => {
        el.classList.toggle('active', el.dataset.category === 'all');
      });
    }
  }
  document.querySelectorAll('.pos-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.pos === pos);
  });
  renderView();
}

function setSubTag(sub) {
  currentSubTag = sub;
  if (currentCategory === 'blog' || currentCategory === 'trends' || currentCategory === 'dispatch') {
    currentCategory = 'all';
    document.querySelectorAll('.chip').forEach(el => {
      el.classList.toggle('active', el.dataset.category === 'all');
    });
  }
  document.querySelectorAll('.subtag-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.sub === sub);
  });
  renderView();
}

function handleSearch() {
  searchQuery = document.getElementById('searchInput').value.toLowerCase().trim();
  renderView();
}

window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
  if (e.key === 'Escape') {
    closeModal();
    const aiDrawer = document.getElementById('aiDrawer');
    if (aiDrawer) aiDrawer.hidden = true;
  }
});

// Phase 2.4: Stick-Doctoring Layer (Side-by-side patterns, progressive 4-stage sequence, before/after stills)
function renderStickDoctorLayer() {
  const emptyToStrung = CATALOG.find(i => i.id === 'yt-oRYrLLYtfRs') || CATALOG.find(i => i.category === 'pockets');
  const topString9D = CATALOG.find(i => i.id === 'yt-QhNACCmrZzo') || CATALOG.find(i => i.subTag === 'Pocket & Mesh Channeling');
  const barrelKnot = CATALOG.find(i => i.id === 'yt-z6PvwML96is') || CATALOG.find(i => i.subTag === 'Sidewall Knots');
  const tradShooters = CATALOG.find(i => i.id === 'yt-1RPGBkWi6Ss') || CATALOG.find(i => i.subTag === 'Traditional Leather');

  return `
    <section class="stick-doctor-layer" aria-label="Stick-Doctoring Workbench">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
        <div>
          <div class="onboarding-kicker">🥍 Stick-Doctoring Layer · Patterns, Progressive Sequence & Channel Stills</div>
          <h2 style="font-size:1.25rem; font-weight:800; margin-top:3px;">Pocket Pattern Bench & 4-Stage Stringing Sequence</h2>
          <p class="hint">Click any stage card to open the film at that stringing step, or compare sidewall recipes side-by-side.</p>
        </div>
      </div>

      <h3 style="font-size:0.9rem; margin-top:14px; color:#fb923c;">1. Progressive 4-Stage Sequence (Empty Head → Strung & Tuned)</h3>
      <div class="stage-sequence-grid">
        <div class="stage-card" data-id="${esc(emptyToStrung?.id || '')}" style="cursor:pointer;">
          <div class="vouch-header"><span>Stage 01 · Prep & Throat</span><span>Empty Head</span></div>
          ${emptyToStrung ? `<img class="stage-thumb" src="${esc(safeUrl(emptyToStrung.midpointStill))}" alt="Stage 1 Empty head to strung" loading="lazy">` : ''}
          <div style="font-weight:700; font-size:0.84rem;">Pre-stretch 10D mesh & map sidewall holes</div>
          <p class="hint">Stretch mesh diamonds horizontally + vertically so pocket depth never bags in rain.</p>
        </div>
        <div class="stage-card" data-id="${esc(topString9D?.id || '')}" style="cursor:pointer;">
          <div class="vouch-header"><span>Stage 02 · 9D Topstring</span><span>Scoop Lock</span></div>
          ${topString9D ? `<img class="stage-thumb" src="${esc(safeUrl(topString9D.midpointStill))}" alt="Stage 2 9D Topstring" loading="lazy">` : ''}
          <div style="font-weight:700; font-size:0.84rem;">Symmetrical 9-Diamond Topstring Tension</div>
          <p class="hint">Center the middle diamond on the scoop bridge; lock outer loops equal on both sidewalls.</p>
        </div>
        <div class="stage-card" data-id="${esc(barrelKnot?.id || '')}" style="cursor:pointer;">
          <div class="vouch-header"><span>Stage 03 · Sidewall Channel</span><span>SI & Anchor Knots</span></div>
          ${barrelKnot ? `<img class="stage-thumb" src="${esc(safeUrl(barrelKnot.midpointStill))}" alt="Stage 3 Sidewall knots" loading="lazy">` : ''}
          <div style="font-weight:700; font-size:0.84rem;">Pull the Upper Channel, Stack the Sweet Spot</div>
          <p class="hint">Use 3 tight Special Interlocks (SI) up top, then a Stacked SI or 2-diamond skip at the pocket apex.</p>
        </div>
        <div class="stage-card" data-id="${esc(tradShooters?.id || '')}" style="cursor:pointer;">
          <div class="vouch-header"><span>Stage 04 · Pound & Shooters</span><span>Finished Channel</span></div>
          ${tradShooters ? `<img class="stage-thumb" src="${esc(safeUrl(tradShooters.midpointStill))}" alt="Stage 4 Shooters and finish" loading="lazy">` : ''}
          <div style="font-weight:700; font-size:0.84rem;">60-Second Bat Pound + Progressive Shooter Ramp</div>
          <p class="hint">Pound the pocket before tying shooters (tight top nylon → medium lace → loose bottom lace).</p>
        </div>
      </div>

      <h3 style="font-size:0.9rem; margin-top:16px; color:#34d399;">2. Side-by-Side Pocket Pattern Recipes & Before/After Channel Comparison</h3>
      <div class="pattern-compare-grid">
        <div class="pattern-card">
          <div class="vouch-header"><span>⚡ Mid-Low Shifted Channel</span><span>Attack / Two-Hand Dodger</span></div>
          <div class="knot-recipe">9D Top → Tie → 1 → SI → SI → SI → SSI → 1 → 1 → Tie</div>
          <p class="hint"><strong>Before vs. After:</strong> Unpulled top diamonds flare wide; 3 consecutive SIs narrow the upper chute for zero-whip quick releases.</p>
        </div>
        <div class="pattern-card">
          <div class="vouch-header"><span>🇨🇦 Mid-High Toe Hold</span><span>Box / Outside Shooter / Pole</span></div>
          <div class="knot-recipe">9D Top → Tie → SI → Stacked SI → 1 → 1 → 1 → SI → Tie</div>
          <p class="hint"><strong>Before vs. After:</strong> High stacked knot forms an immediate shelf under the scoop for one-handed fakes and toe-drag hold.</p>
        </div>
        <div class="pattern-card">
          <div class="vouch-header"><span>🦌 4-Leather Traditional Pita</span><span>All-Weather Heritage Track</span></div>
          <div class="knot-recipe">4 Leathers → Interlocked Center Pita Track → 6 Sidewall Diamonds</div>
          <p class="hint"><strong>Before vs. After:</strong> Pre-oiled deer/cowhide leathers + tight outer crosslace keep a legal 4-inch pocket in heavy rain.</p>
        </div>
      </div>
    </section>
  `;
}

// Phase 2.4: Traditional Leather / Heritage Track under Sources & Scans
function renderHeritageTrack() {
  const beersItem = CATALOG.find(i => i.id === 'ia-cihm_05682');
  const tradVideos = CATALOG.filter(i => i.subTag === 'Traditional Leather').slice(0, 3);
  return `
    <section class="heritage-track-banner" aria-label="Traditional Leather and Heritage Track">
      <div class="onboarding-kicker">🦌 Traditional Leather & Heritage Track · Sources, Wood Craft & Archival Scans</div>
      <h2 style="font-size:1.2rem; font-weight:800; margin-top:3px;">From Haudenosaunee Hickory & Rawhide to Modern 4-Leather Pita Pockets</h2>
      <p class="hint" style="margin-top:4px;">Primary historical scans and traditional leather stringing references preserved alongside the source shelf.</p>
      <div class="pattern-compare-grid">
        ${beersItem ? `
          <div class="pattern-card" data-id="${esc(beersItem.id)}" style="cursor:pointer;">
            <div class="vouch-header"><span>📜 1869 Archival Scan</span><span>Primary Text</span></div>
            <div style="font-weight:700; font-size:0.86rem;">${esc(beersItem.title)}</div>
            <p class="hint">${esc(noteFor(beersItem))}</p>
          </div>
        ` : ''}
        ${tradVideos.map(v => `
          <div class="pattern-card" data-id="${esc(v.id)}" style="cursor:pointer;">
            <div class="vouch-header"><span>🦌 Traditional Leather Film</span><span>${esc(v.author)}</span></div>
            <div style="font-weight:700; font-size:0.86rem;">${esc(v.title)}</div>
            <p class="hint">${esc(whyHereFor(v))}</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderBlogView() {
  document.getElementById('specialLayerMount').innerHTML = '';
  const grid = document.getElementById('cardsGrid');
  const blog = BLOGS[0];
  if (!blog) {
    grid.innerHTML = '<div class="blog-panel"><h3>No dispatch on the shelf yet.</h3></div>';
    return;
  }
  document.getElementById('statsLine').innerText = `Shelf dispatch · ${blog.timestamp || ''}`;
  const top10Html = (blog.top10 || []).map((item, idx) => `
    <div class="blog-rank-item" data-id="${esc(item.id)}" style="cursor:pointer;">
      <div class="rank-num">#${String(idx + 1).padStart(2, '0')}</div>
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-weight:700; font-size:0.98rem; color:#fff;">${esc(item.title)}</span>
          ${badgeFor(item) ? `<span style="font-size:0.7rem; background:#27272a; color:#fb923c; padding:2px 7px; border-radius:4px; font-weight:700;">${esc(badgeFor(item))}</span>` : ''}
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">
          ${esc(item.author)} · ${esc(item.categoryLabel)} (${esc(item.subTag || '')})
        </div>
        ${noteFor(item) ? `<div style="font-size:0.82rem; color:#d4d4d8; font-style:italic; margin-top:6px;">"${esc(noteFor(item))}"</div>` : ''}
      </div>
    </div>
  `).join('');

  grid.innerHTML = `
    <div class="blog-panel">
      <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--basquiat-gold); text-transform:uppercase;">
        Dispatch log
      </div>
      <h1 style="font-size:1.55rem; font-weight:800; margin-top:6px;">${esc(blog.title)}</h1>
      <p style="color:var(--text-muted); margin-top:8px; font-size:0.92rem;">${esc(blog.summary)}</p>
      <hr style="border:none; border-top:1px solid var(--border-color); margin:20px 0;">
      <h3 style="margin-bottom:14px; font-size:1.05rem;">Ten films from this shelf</h3>
      ${top10Html}
    </div>
  `;
}

function renderTrendsView() {
  document.getElementById('specialLayerMount').innerHTML = '';
  const grid = document.getElementById('cardsGrid');
  document.getElementById('statsLine').innerText = `Trend radar · ${TRENDS.lastResearchedAt || 'not refreshed yet'}`;

  const topicsHtml = (TRENDS.trendingTopics || []).map(t => `
    <div class="blog-rank-item">
      <div class="rank-num" style="color:#34d399; border-color:rgba(16,185,129,0.3); background:rgba(16,185,129,0.1);">${esc(t.momentum)}</div>
      <div>
        <div style="font-weight:700; color:#fff;">${esc(t.topic)}</div>
        <div style="font-size:0.8rem; color:var(--text-muted);">Detected via: ${esc(t.source)}</div>
      </div>
    </div>
  `).join('');

  const channelsHtml = (TRENDS.discoveredVideoChannels || []).map(ch => {
    const href = safeUrl(ch.channelUrl);
    const name = esc(ch.channelName);
    return `
      <div class="blog-rank-item">
        <div class="rank-num" style="color:#facc15;">${esc(ch.curatedVideosCount)}</div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="font-weight:700; color:#fff; text-decoration:none;">${name}</a>` : `<span style="font-weight:700; color:#fff;">${name}</span>`}
            <span style="font-family:'JetBrains Mono',monospace; font-size:0.7rem; color:#fb923c;">${esc(ch.category)}</span>
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">Sample: <em>"${esc(ch.sampleVideo)}"</em></div>
        </div>
      </div>
    `;
  }).join('');

  const sourcesHtml = (TRENDS.discoveredSources || []).map(s => {
    const href = safeUrl(s.url);
    const name = esc(s.name);
    return `
      <div class="blog-rank-item">
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="font-weight:700; color:#60a5fa; text-decoration:none;">${name}</a>` : `<span style="font-weight:700;">${name}</span>`}
            <span style="font-family:'JetBrains Mono',monospace; font-size:0.7rem; color:#facc15;">${esc(s.status)}</span>
          </div>
          <div style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">
            <strong>Category:</strong> ${esc(s.category)} · <strong>Signal:</strong> ${esc(s.signalType)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const newsHtml = (TRENDS.liveNewsSignals || []).map(n => {
    const href = safeUrl(n.link);
    const title = esc(n.title);
    return `
      <div style="padding:10px 0; border-bottom:1px solid #26262e; font-size:0.84rem;">
        <span style="color:#ec4899; font-weight:700; font-size:0.72rem; text-transform:uppercase;">[${esc(n.cluster)}]</span>
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:#e4e4e7; text-decoration:none; margin-left:6px;">${title}</a>` : `<span style="margin-left:6px;">${title}</span>`}
        <span style="color:var(--text-faint); font-size:0.75rem; margin-left:6px;">(${esc(n.sourceName)})</span>
      </div>
    `;
  }).join('');

  grid.innerHTML = `
    <div class="blog-panel">
      <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:#ec4899; text-transform:uppercase;">
        Trend radar
      </div>
      <h1 style="font-size:1.5rem; font-weight:800; margin-top:6px;">Lacrosse trend radar</h1>
      <p style="color:var(--text-muted); margin-top:6px; font-size:0.9rem;">
        Signals the daily job last wrote down. A film is on the shelf only after its YouTube id checks out.
      </p>
      <h3 style="margin:20px 0 12px 0; font-size:1.02rem;">Rising signals</h3>
      ${topicsHtml}
      <h3 style="margin:24px 0 12px 0; font-size:1.02rem;">Channels</h3>
      ${channelsHtml || '<p style="color:var(--text-faint);">No channels cached.</p>'}
      <h3 style="margin:24px 0 12px 0; font-size:1.02rem;">Forums and libraries</h3>
      ${sourcesHtml}
      <h3 style="margin:24px 0 10px 0; font-size:1.02rem;">News wire</h3>
      ${newsHtml || '<p style="color:var(--text-faint);">No live RSS items cached.</p>'}
    </div>
  `;
}

function onDispatch() {
  return currentCategory === 'dispatch' && !searchQuery && !savedOnly && currentSubTag === 'all' && currentPosition === 'all' && currentSort === 'default';
}

function cardHtml(item, why) {
  const isSaved = savedIds.includes(item.id);
  const badge = badgeFor(item);
  const marks = item.id === previewMarks?.itemId ? previewMarks.marks : LT.marksFor(item.id);
  const note = why || noteFor(item);
  const whyLine = whyHereFor(item);
  const isRising = currentSort === 'trending' && trendingScore(item) >= 95;
  const profileMatch = userProfile && matchesProfile(item, userProfile);

  return `
    <div class="card" data-id="${esc(item.id)}">
      <div class="thumbnail-box">
        ${thumbHtml(item)}
        ${badge ? `<div class="midpoint-indicator">${esc(badge)}</div>` : (isRising ? `<div class="midpoint-indicator" style="color:#facc15;">🔥 Rising</div>` : '')}
        ${item.subTag ? `<div class="subtag-badge">${esc(item.subTag)}</div>` : ''}
        ${(shownTime(item) || badge) ? `<div class="duration-badge ${item.type === 'video' ? '' : 'badge-playbook'}">${esc(shownTime(item) || badge)}</div>` : ''}
      </div>
      <div class="card-meta">
        <div class="channel-avatar">${esc(item.authorAvatar || '🥍')}</div>
        <div class="card-info">
          <div class="card-title">${esc(item.title)}</div>
          <div class="card-author-line">
            <span>${esc(item.author)}</span>
            <span>·</span>
            <span>${esc(item.sourceHub || item.categoryLabel || '')}</span>
          </div>
          <div class="vouch-container">
            <div class="vouch-header">
              <span>${why ? 'In the drop' : (profileMatch ? '🎯 Setup match' : 'Curator note')}</span>
              <span>${marks.length ? esc(marks.length + ' mark' + (marks.length === 1 ? '' : 's')) : esc(item.addedAt || '')}</span>
            </div>
            <div class="vouch-quote">${esc(note)}</div>
            <div class="why-here-line">${esc(whyLine)}</div>
          </div>
          <div style="margin-top:4px; display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" data-practice="${esc(item.id)}" style="background:transparent; border:none; color:#a1a1aa; cursor:pointer; font-size:0.75rem; font-weight:700;">+ Practice</button>
            <button type="button" data-save="${esc(item.id)}" style="background:transparent; border:none; color:${isSaved ? '#f97316' : '#71717a'}; cursor:pointer; font-size:0.75rem; font-weight:700;">
              ${isSaved ? '✓ Saved in Locker' : '+ Save to Locker'}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDispatch() {
  document.getElementById('specialLayerMount').innerHTML = '';
  const grid = document.getElementById('cardsGrid');
  if (!dispatchReady) {
    document.getElementById('statsLine').innerText = 'Shelf Dispatch';
    grid.innerHTML = '<div class="blog-panel dispatch-span"><h3>Loading the drop…</h3></div>';
    return;
  }
  let rows = (DISPATCH?.items || []).map(row => {
    const item = CATALOG.find(entry => entry.id === row.id);
    return item && row.why ? { item, why: String(row.why) } : null;
  }).filter(Boolean);

  // Phase 2.6: If user has an onboarding profile, bias matching Dispatch items to the front
  if (userProfile && rows.length) {
    rows = rows.slice().sort((a, b) => {
      const aMatch = matchesProfile(a.item, userProfile) ? 1 : 0;
      const bMatch = matchesProfile(b.item, userProfile) ? 1 : 0;
      return bMatch - aMatch;
    });
  }

  if (!rows.length) {
    document.getElementById('statsLine').innerText = 'The drop is missing. Showing the whole shelf.';
    currentCategory = 'all';
    document.querySelectorAll('.chip').forEach(el => el.classList.toggle('active', el.dataset.category === 'all'));
    return renderShelf('all');
  }
  document.getElementById('statsLine').innerText = `${rows.length} in the drop · ${CATALOG.length} on the shelf`;
  grid.innerHTML = `
    <div class="dispatch-intro dispatch-span">
      <div>
        <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--basquiat-gold); text-transform:uppercase;">Today's drop</div>
        <h1>${esc(DISPATCH.title || 'Shelf Dispatch')}</h1>
        <p style="color:var(--text-muted); margin-top:4px;">${esc(DISPATCH.caption || '')}</p>
      </div>
      <button class="nav-btn" type="button" data-whole-shelf="1">Whole shelf</button>
    </div>
    ${rows.map(row => cardHtml(row.item, row.why)).join('')}
  `;
}

function renderShelf(category) {
  const specialMount = document.getElementById('specialLayerMount');
  if (category === 'pockets' && !savedOnly) {
    specialMount.innerHTML = renderStickDoctorLayer();
  } else if (category === 'shelf' && !savedOnly) {
    specialMount.innerHTML = renderHeritageTrack();
  } else {
    specialMount.innerHTML = '';
  }

  const grid = document.getElementById('cardsGrid');
  let scored = [];
  for (const item of CATALOG) {
    const matchesCat = category === 'all' || category === 'dispatch' || item.category === category;
    const matchesSub = currentSubTag === 'all' || (item.subTag || '').toLowerCase().includes(currentSubTag.toLowerCase());
    const matchesPos = matchesPosition(item, currentPosition);
    const matchesSaved = !savedOnly || savedIds.includes(item.id);
    if (!matchesCat || !matchesSub || !matchesPos || !matchesSaved) continue;

    const qScore = actionSearchScore(item, searchQuery);
    if (searchQuery && qScore <= 0) continue;
    scored.push({ item, qScore, tScore: trendingScore(item) });
  }

  // Apply sorting (Trending/Rising, Most Marked/Saved, Action Clip Match, or Default + Profile bias)
  if (searchQuery || currentSort === 'action') {
    scored.sort((a, b) => b.qScore - a.qScore || b.tScore - a.tScore);
  } else if (currentSort === 'trending') {
    scored.sort((a, b) => b.tScore - a.tScore);
  } else if (currentSort === 'marked') {
    scored.sort((a, b) => {
      const aMarks = LT.marksFor(a.item.id).length * 10 + (savedIds.includes(a.item.id) ? 5 : 0);
      const bMarks = LT.marksFor(b.item.id).length * 10 + (savedIds.includes(b.item.id) ? 5 : 0);
      return bMarks - aMarks || b.tScore - a.tScore;
    });
  } else if (userProfile) {
    scored.sort((a, b) => {
      const aM = matchesProfile(a.item, userProfile) ? 1 : 0;
      const bM = matchesProfile(b.item, userProfile) ? 1 : 0;
      return bM - aM;
    });
  }

  const filtered = scored.map(s => s.item);

  if (savedOnly) {
    document.getElementById('statsLine').innerText = filtered.length ? `${filtered.length} in the Locker` : 'The Locker is empty';
    grid.innerHTML = filtered.length
      ? filtered.map(lockerRowHtml).join('')
      : '<div class="blog-panel dispatch-span"><h3>Nothing in the Locker yet.</h3><p>Save a film and it stays on this device.</p></div>';
    return;
  }
  const posSuffix = currentPosition !== 'all' ? ` · Position: ${currentPosition}` : '';
  const sortSuffix = currentSort === 'trending' ? ' · Sorted by Trending / Rising' : '';
  document.getElementById('statsLine').innerText = `Showing ${filtered.length} of ${CATALOG.length}${posSuffix}${sortSuffix}`;
  grid.innerHTML = filtered.map(item => cardHtml(item)).join('');
}

function lockerRowHtml(item) {
  const marks = item.id === previewMarks?.itemId ? previewMarks.marks : LT.marksFor(item.id);
  const first = marks[0];
  return `
    <div class="locker-row" data-id="${esc(item.id)}">
      <div class="locker-row-main">
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-author-line">
          ${esc(item.author)}
          ${first ? ' · ' + esc(LT.fmt(first.t)) : ''}
          ${marks.length ? ' · ' + marks.length + (marks.length === 1 ? ' mark' : ' marks') : ''}
        </div>
      </div>
      <button class="nav-btn" type="button" data-practice="${esc(item.id)}">Add to practice</button>
      <button class="nav-btn" type="button" data-save="${esc(item.id)}">Remove</button>
    </div>
  `;
}

function renderView() {
  updateProfileBadge();
  if (currentCategory === 'blog') return renderBlogView();
  if (currentCategory === 'trends') return renderTrendsView();
  if (onDispatch()) return renderDispatch();
  return renderShelf(currentCategory);
}

function downloadJson(obj, filename) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

async function sharePacked(obj, urlForToken, filename, noteEl) {
  try {
    const token = await LT.pack(obj);
    await navigator.clipboard.writeText(urlForToken(token));
    if (noteEl) noteEl.textContent = 'Link copied.';
  } catch (error) {
    if (/too long/i.test(error?.message || '')) {
      downloadJson(obj, filename);
      if (noteEl) noteEl.textContent = 'Too long for a link. A file downloaded instead. Open it with Open file.';
      return;
    }
    if (noteEl) noteEl.textContent = error?.message || 'Could not copy the link.';
  }
}

// ============================================================================
// MARKS & YOUTUBE POSTMESSAGE CLOCK (CSP-SAFE)
// ============================================================================
function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = 0;
  playerPlaying = false;
}

function playerMessage(iframe, payload) {
  iframe?.contentWindow?.postMessage(JSON.stringify({
    id: 'lt-player',
    channel: 'widget',
    ...payload
  }), '*');
}

function seekPlayerTo(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  clockT = s;
  const clock = document.getElementById('mark-clock');
  if (clock) clock.textContent = LT.fmt(clockT);
  const at = document.getElementById('mark-at');
  if (at && markAt == null) at.textContent = LT.fmt(clockT);
  const frame = document.getElementById('lt-player');
  if (frame) {
    playerMessage(frame, { event: 'command', func: 'seekTo', args: [s, true] });
    playerMessage(frame, { event: 'command', func: 'playVideo', args: [] });
  }
}

function watchPlayer(iframe) {
  const ping = () => {
    playerMessage(iframe, { event: 'listening' });
    playerMessage(iframe, { event: 'command', func: 'addEventListener', args: ['onStateChange'] });
    playerMessage(iframe, { event: 'command', func: 'playVideo', args: [] });
  };
  iframe.addEventListener('load', ping);
  stopClock();
  clockTimer = setInterval(() => {
    playerMessage(iframe, { event: 'listening' });
    playerMessage(iframe, { event: 'command', func: 'getCurrentTime', args: [] });
    if (playerPlaying) {
      clockT += 0.5;
      const clock = document.getElementById('mark-clock');
      if (clock) clock.textContent = LT.fmt(clockT);
      const at = document.getElementById('mark-at');
      if (at && markAt == null) at.textContent = LT.fmt(clockT);
    }
  }, 500);
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://www.youtube-nocookie.com' && event.origin !== 'https://www.youtube.com') return;
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return; }
  }
  if (typeof data?.info?.playerState === 'number') {
    playerPlaying = data.info.playerState === 1;
  }
  const time = Number(data?.info?.currentTime);
  if (!Number.isFinite(time)) return;
  clockT = time;
  const clock = document.getElementById('mark-clock');
  if (clock) clock.textContent = LT.fmt(clockT);
  const at = document.getElementById('mark-at');
  if (at && markAt == null) at.textContent = LT.fmt(clockT);
});

function marksNow(itemId) {
  if (previewMarks?.itemId === itemId) return previewMarks.marks.slice();
  return LT.marksFor(itemId);
}

function keepMarks(itemId, marks) {
  const clean = marks.map(LT.cleanMark).filter(Boolean).slice(0, 40);
  if (previewMarks?.itemId === itemId) previewMarks.marks = clean;
  else LT.setMarks(itemId, clean);
  paintMarks(itemId);
  renderView();
  return clean;
}

function paintMarks(itemId) {
  const list = document.getElementById('mark-list');
  if (!list) return;
  const marks = marksNow(itemId);
  const guest = previewMarks?.itemId === itemId;
  list.innerHTML = marks.map((mark, index) => `
    <div class="mark-row">
      <button type="button" class="mark-clock mark-clock-btn" data-seek-mark="${esc(mark.t)}" title="Jump video to ${esc(LT.fmt(mark.t))}">▶ ${esc(LT.fmt(mark.t))}</button>
      ${mark.skill ? `<span class="subtag-badge" style="position:static;">${esc(mark.skill)}</span>` : ''}
      ${mark.by ? `<span class="coach-by-badge">Coach: ${esc(mark.by)}</span>` : ''}
      <span style="flex:1;">${esc(mark.text)}</span>
      <button class="nav-btn" type="button" data-to-practice="${index}">Add to practice</button>
      <button class="nav-btn" type="button" data-drop-mark="${index}">Remove</button>
    </div>
  `).join('') || '<p style="color:var(--text-muted); margin-top:8px;">No marks on this film yet. Click "Mark this moment" or type a note above.</p>';
  const save = document.getElementById('save-shared-marks');
  if (save) save.hidden = !guest;
}

function markForm(item) {
  if (!(item.type === 'video' && ytId(item.youtubeId))) return '';
  const skills = LT.SKILLS.map(skill => `<button class="nav-btn" type="button" data-skill="${skill}" aria-pressed="false">${esc(skill)}</button>`).join('');
  return `
    <div class="marks-panel" style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border-color);">
      <div class="mark-row" style="justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span class="subtag-label" style="margin:0;">Film clock</span>
          <span class="mark-clock" id="mark-clock" aria-live="polite" aria-label="Film time">${esc(LT.fmt(clockT))}</span>
          <button class="btn-action" type="button" id="open-mark">Mark this moment</button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="nav-btn" type="button" id="copy-marks">Copy marks link</button>
          <button class="nav-btn" type="button" id="print-film-marks">Print drill sheet</button>
          <button class="btn-action" type="button" id="save-shared-marks" hidden>Keep these marks</button>
        </div>
      </div>
      <div id="mark-composer">
        <div class="mark-row">
          <span class="mark-clock" id="mark-at" title="Timestamp for new mark">${esc(LT.fmt(clockT))}</span>
          <input class="mark-text" id="mark-text" maxlength="160" placeholder="Short note (e.g. 'Hot slide arrives stick-down on the hip')" aria-label="Note at this moment">
          <input class="mark-by" id="mark-by" maxlength="40" placeholder="Coach / By (opt.)" aria-label="Coach or player name">
          <button class="btn-action" type="button" id="add-mark">Save mark</button>
        </div>
        <div class="skill-pills" aria-label="Skill">${skills}</div>
      </div>
      <div id="mark-list"></div>
      <div class="mark-row">
        <span id="mark-status" role="status" style="color:var(--text-muted); font-size:0.8rem;"></span>
      </div>
    </div>
  `;
}

function submitCurrentMark(itemId) {
  if (!itemId) return false;
  const textEl = document.getElementById('mark-text');
  const byEl = document.getElementById('mark-by');
  const text = textEl?.value || '';
  const by = byEl?.value || '';
  const status = document.getElementById('mark-status');
  const mark = LT.cleanMark({
    t: markAt == null ? clockT : markAt,
    text,
    skill: pendingSkill,
    by,
    at: Date.now()
  });
  if (!mark) {
    if (status) status.textContent = 'Timestamp locked at ' + LT.fmt(markAt == null ? clockT : markAt) + ' — write a short note and click Save mark.';
    textEl?.focus();
    return false;
  }
  keepMarks(itemId, marksNow(itemId).concat(mark));
  if (textEl) textEl.value = '';
  pendingSkill = '';
  document.querySelectorAll('[data-skill]').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
  markAt = null;
  if (status) {
    status.textContent = previewMarks
      ? `Mark added at ${LT.fmt(mark.t)}. Click "Keep these marks" to save them on this device.`
      : `Mark saved at ${LT.fmt(mark.t)} in local marks.`;
  }
  return true;
}

// ============================================================================
// PRACTICE CARD & OFFLINE / PRINT-FRIENDLY DRILL SHEETS
// ============================================================================
function activePractice() {
  return previewPractice || LT.loadPractice();
}

function renderPractice() {
  const practice = activePractice();
  const bar = document.getElementById('practiceBar');
  const steps = document.getElementById('practiceSteps');
  const guest = Boolean(previewPractice);
  bar.hidden = practice.steps.length === 0 && !guest;
  document.body.classList.toggle('has-practice', !bar.hidden);
  document.getElementById('practiceTitle').value = practice.title;
  document.getElementById('practiceCount').textContent = practice.steps.length + '/' + LT.MAX_STEPS;
  document.getElementById('practiceSave').hidden = !guest;
  steps.innerHTML = practice.steps.map((step, index) => {
    const item = CATALOG.find(entry => entry.id === step.itemId);
    return `
      <div class="practice-step">
        <span class="mark-clock">${esc(LT.fmt(step.t))}</span>
        <span style="min-width:140px; font-weight:700;">${esc(item?.title || step.itemId)}</span>
        <input class="practice-why" data-why="${index}" maxlength="160" value="${esc(step.why)}" aria-label="Why this step" placeholder="One line on why this is in the practice">
        <button class="nav-btn" type="button" data-move="up" data-step="${index}">Up</button>
        <button class="nav-btn" type="button" data-move="down" data-step="${index}">Down</button>
        <button class="nav-btn" type="button" data-drop-step="${index}">Remove</button>
      </div>
    `;
  }).join('');
}

function writePractice(practice) {
  const clean = LT.cleanPractice(practice);
  if (!clean) return;
  if (previewPractice) previewPractice = clean;
  else LT.savePractice(clean);
  renderPractice();
}

function addPracticeStep(itemId, t, why) {
  const practice = activePractice();
  if (practice.steps.length >= LT.MAX_STEPS) {
    document.getElementById('practiceNote').textContent = 'Five steps is the whole card.';
    renderPractice();
    return;
  }
  const item = CATALOG.find(e => e.id === itemId);
  const defaultWhy = why || (item ? whyHereFor(item).replace(/^Why it's here:\s*/i, '') : '');
  practice.steps.push({ itemId, t: Number(t) || 0, why: defaultWhy });
  document.getElementById('practiceNote').textContent = '';
  writePractice(practice);
}

function fillPracticeSheet() {
  const practice = activePractice();
  const sheet = document.getElementById('practiceSheet');
  const steps = practice.steps.map(step => {
    const item = CATALOG.find(entry => entry.id === step.itemId);
    const seconds = Math.floor(step.t || 0);
    const href = item ? `${location.origin}/?watch=${encodeURIComponent(item.id)}&t=${seconds}` : '';
    const marks = item ? LT.marksFor(item.id) : [];
    const marksLine = marks.length
      ? `<br><em>Coach Marks:</em> ` + marks.map(m => `[${esc(LT.fmt(m.t))}${m.skill ? ' ' + esc(m.skill) : ''}${m.by ? ' · ' + esc(m.by) : ''}] ${esc(m.text)}`).join(' | ')
      : '';
    return `<li>☐ <b>[${esc(LT.fmt(step.t))}]</b> ${esc(step.why || item?.title || '')}<br><strong>Film:</strong> ${esc(item?.title || '')}${item?.author ? ' · ' + esc(item.author) : ''} (${esc(item?.subTag || item?.categoryLabel || '')})${marksLine}${href ? `<br><a href="${esc(href)}">${esc(href)}</a>` : ''}</li>`;
  }).join('');
  sheet.innerHTML = `
    <h1>🥍 ${esc(practice.title)} — Offline Clipboard Drill Sheet</h1>
    <div class="sheet-meta">LacrosseTube Practice Plan · ${practice.steps.length} Drills · Print &amp; check off on the field</div>
    <ol>${steps}</ol>
    <p style="margin-top:16pt; font-size:9.5pt;">Generated locally on LacrosseTube (zero-account browser Locker).</p>
  `;
}

function printFilmSheet(item) {
  const sheet = document.getElementById('practiceSheet');
  const marks = marksNow(item.id);
  const href = `${location.origin}/?watch=${encodeURIComponent(item.id)}`;
  const rows = marks.length
    ? marks.map(m => `<li>☐ <b>[${esc(LT.fmt(m.t))}]</b> ${m.skill ? `<strong>(${esc(m.skill.toUpperCase())})</strong> ` : ''}${esc(m.text)} ${m.by ? `<em>— Coach ${esc(m.by)}</em>` : ''}</li>`).join('')
    : `<li>☐ <b>[0:00]</b> ${esc(noteFor(item))}</li>`;
  sheet.innerHTML = `
    <h1>🥍 ${esc(item.title)} — Coach Film &amp; Drill Sheet</h1>
    <div class="sheet-meta">${esc(item.author)} · ${esc(item.categoryLabel)} (${esc(item.subTag || '')}) · ${esc(whyHereFor(item))}</div>
    <ol>${rows}</ol>
    <p style="margin-top:14pt; font-size:9.5pt;">Direct Film Link: ${esc(href)}</p>
  `;
  window.print();
}

function openItemModal(id, startSeconds) {
  const item = CATALOG.find(i => i.id === id);
  if (!item) return;
  currentModalItemId = item.id;
  const wrap = document.getElementById('modalVideoWrap');
  const body = document.getElementById('modalBody');
  const video = ytId(item.youtubeId);
  const href = safeUrl(item.url);
  const saved = savedIds.includes(item.id);
  const start = Number.isFinite(Number(startSeconds)) ? Math.max(0, Math.floor(Number(startSeconds))) : 0;
  clockT = start;
  markAt = null;
  pendingSkill = '';
  stopClock();

  if (item.type === 'video' && video) {
    const src = `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${start ? '&start=' + start : ''}`;
    wrap.innerHTML = `<iframe id="lt-player" src="${src}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${esc(item.title)}"></iframe>`;
    const frame = document.getElementById('lt-player');
    if (frame) watchPlayer(frame);
  } else {
    const label = /\.pdf($|\?)/i.test(href) ? 'Open PDF' : `Open ${badgeFor(item)}`;
    wrap.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background:#121217; color:#e4e4e7; gap:12px; padding:24px; text-align:center;">
        <div style="font-size:3.2rem;">${esc(item.authorAvatar || '📑')}</div>
        <div style="font-size:1.15rem; font-weight:800;">${esc(item.title)}</div>
        <div style="font-size:0.86rem; color:#a1a1aa; max-width:480px;">${esc(noteFor(item))}</div>
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="btn-action" style="margin-top:8px;">${esc(label)}</a>` : ''}
      </div>
    `;
  }

  body.innerHTML = `
    <h2 style="font-size:1.2rem; font-weight:800;">${esc(item.title)}</h2>
    <div style="color:var(--text-muted); font-size:0.84rem; margin-top:4px;">
      ${esc(item.author)} · ${esc(item.categoryLabel)} · ${esc(item.subTag || '')}
    </div>
    <div style="margin-top:12px; background:#222227; border-left:3px solid var(--accent); padding:10px 14px; border-radius:4px;">
      <div style="font-size:0.7rem; text-transform:uppercase; color:var(--accent); font-weight:700;">Curator note</div>
      <p style="margin-top:3px; font-size:0.88rem;">${esc(noteFor(item))}</p>
      <p style="margin-top:4px; font-size:0.8rem; color:#34d399; font-weight:600;">${esc(whyHereFor(item))}</p>
    </div>
    <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;">
      <button class="btn-action" type="button" data-save="${esc(item.id)}">
        ${saved ? '✓ Saved in Local Locker' : '+ Save to Local Locker'}
      </button>
      <button class="nav-btn" type="button" data-modal-practice="${esc(item.id)}">+ Add to Practice Card</button>
      ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="btn-action btn-secondary">Open original</a>` : ''}
    </div>
    ${markForm(item)}
  `;
  paintMarks(item.id);
  document.getElementById('playerModal').classList.add('active');
  const hash = location.hash.startsWith('#p=') || location.hash.startsWith('#m=') ? location.hash : '';
  history.replaceState(null, '', '/?watch=' + encodeURIComponent(item.id) + (start ? '&t=' + start : '') + hash);
}

function closeModal() {
  stopClock();
  previewMarks = null;
  currentModalItemId = null;
  document.getElementById('playerModal').classList.remove('active');
  document.getElementById('modalVideoWrap').innerHTML = '';
  const hash = location.hash.startsWith('#p=') ? location.hash : '';
  if (location.search || location.hash.startsWith('#m=')) history.replaceState(null, '', '/' + hash);
}

function closeModalOnOverlay(e) {
  if (e.target.id === 'playerModal') closeModal();
}

// ============================================================================
// EVENT LISTENERS (GRID, SPECIAL LAYERS, MODAL, PRACTICE, ONBOARDING, AI)
// ============================================================================
function handleCardContainerClick(event) {
  if (event.target.closest('[data-whole-shelf]')) {
    setCategory('all');
    return;
  }
  const practice = event.target.closest('[data-practice]');
  if (practice) {
    event.stopPropagation();
    const first = LT.marksFor(practice.dataset.practice)[0];
    addPracticeStep(practice.dataset.practice, first?.t || 0, first?.text || '');
    return;
  }
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSave(save.dataset.save, event);
    return;
  }
  const card = event.target.closest('[data-id]');
  if (card && card.dataset.id) openItemModal(card.dataset.id);
}

document.getElementById('cardsGrid').addEventListener('click', handleCardContainerClick);
document.getElementById('specialLayerMount').addEventListener('click', handleCardContainerClick);

document.getElementById('modalBody').addEventListener('click', async (event) => {
  const itemId = currentModalItemId || new URLSearchParams(location.search).get('watch');
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSave(save.dataset.save, event);
    const btn = event.target.closest('[data-save]');
    if (btn) btn.textContent = savedIds.includes(save.dataset.save) ? '✓ Saved in Local Locker' : '+ Save to Local Locker';
    return;
  }
  const modalPrac = event.target.closest('[data-modal-practice]');
  if (modalPrac) {
    const first = marksNow(itemId)[0];
    addPracticeStep(itemId, first?.t || clockT || 0, first?.text || '');
    const status = document.getElementById('mark-status');
    if (status) status.textContent = 'Added film to your Practice Card.';
    return;
  }
  const seekBtn = event.target.closest('[data-seek-mark]');
  if (seekBtn) {
    seekPlayerTo(Number(seekBtn.dataset.seekMark) || 0);
    return;
  }
  const skill = event.target.closest('[data-skill]');
  if (skill) {
    pendingSkill = pendingSkill === skill.dataset.skill ? '' : skill.dataset.skill;
    document.querySelectorAll('[data-skill]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.skill === pendingSkill)));
    return;
  }
  if (event.target.id === 'open-mark') {
    markAt = clockT;
    const composer = document.getElementById('mark-composer');
    const at = document.getElementById('mark-at');
    if (at) at.textContent = LT.fmt(markAt);
    if (composer) composer.hidden = false;
    const textVal = (document.getElementById('mark-text')?.value || '').trim();
    if (textVal) {
      submitCurrentMark(itemId);
    } else {
      const status = document.getElementById('mark-status');
      if (status) status.textContent = `Timestamp captured at ${LT.fmt(markAt)} — type a short note and click Save mark.`;
      document.getElementById('mark-text')?.focus();
    }
    return;
  }
  if (event.target.id === 'add-mark') {
    submitCurrentMark(itemId);
    return;
  }
  if (event.target.id === 'print-film-marks') {
    const item = CATALOG.find(i => i.id === itemId);
    if (item) printFilmSheet(item);
    return;
  }
  const drop = event.target.closest('[data-drop-mark]');
  if (drop) {
    const marks = marksNow(itemId);
    marks.splice(Number(drop.dataset.dropMark), 1);
    keepMarks(itemId, marks);
    return;
  }
  const toPractice = event.target.closest('[data-to-practice]');
  if (toPractice) {
    const mark = marksNow(itemId)[Number(toPractice.dataset.toPractice)];
    if (mark) {
      addPracticeStep(itemId, mark.t, mark.text);
      const status = document.getElementById('mark-status');
      const note = document.getElementById('practiceNote').textContent;
      if (status) status.textContent = note || 'Added to the practice card.';
    }
    return;
  }
  if (event.target.id === 'copy-marks') {
    const status = document.getElementById('mark-status');
    const marks = marksNow(itemId);
    if (!marks.length) {
      if (status) status.textContent = 'Add a mark before copying a link.';
      return;
    }
    await sharePacked(
      { v: 1, itemId, marks },
      token => `${location.origin}/?watch=${encodeURIComponent(itemId)}#m=${token}`,
      'lacrossetube-marks.json',
      status
    );
    if (status && status.textContent === 'Link copied.') status.textContent = 'Marks link copied.';
    return;
  }
  if (event.target.id === 'save-shared-marks' && previewMarks?.itemId === itemId) {
    LT.setMarks(itemId, previewMarks.marks);
    previewMarks = null;
    paintMarks(itemId);
    renderView();
    const status = document.getElementById('mark-status');
    if (status) status.textContent = 'Marks saved on this device.';
  }
});

document.getElementById('modalBody').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.target.id === 'mark-text' || event.target.id === 'mark-by')) {
    event.preventDefault();
    const itemId = currentModalItemId || new URLSearchParams(location.search).get('watch');
    submitCurrentMark(itemId);
  }
});

document.getElementById('practiceTitle').addEventListener('input', (event) => {
  const practice = activePractice();
  practice.title = event.target.value;
  const clean = LT.cleanPractice(practice);
  if (!clean) return;
  if (previewPractice) previewPractice = clean;
  else LT.savePractice(clean);
});

document.getElementById('practiceSteps').addEventListener('input', (event) => {
  const why = event.target.closest('[data-why]');
  if (!why) return;
  const practice = activePractice();
  if (!practice.steps[why.dataset.why]) return;
  practice.steps[why.dataset.why].why = why.value;
  if (previewPractice) previewPractice = LT.cleanPractice(practice);
  else LT.savePractice(practice);
});

document.getElementById('practiceSteps').addEventListener('click', (event) => {
  const practice = activePractice();
  const drop = event.target.closest('[data-drop-step]');
  if (drop) {
    practice.steps.splice(Number(drop.dataset.dropStep), 1);
    document.getElementById('practiceNote').textContent = '';
    writePractice(practice);
    return;
  }
  const move = event.target.closest('[data-move]');
  if (!move) return;
  const index = Number(move.dataset.step);
  const next = move.dataset.move === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= practice.steps.length) return;
  const [step] = practice.steps.splice(index, 1);
  practice.steps.splice(next, 0, step);
  writePractice(practice);
});

document.getElementById('practicePrint').addEventListener('click', () => {
  fillPracticeSheet();
  window.print();
});

document.getElementById('practiceCopy').addEventListener('click', async () => {
  const note = document.getElementById('practiceNote');
  const practice = activePractice();
  if (!practice.steps.length) {
    note.textContent = 'Add a step before copying a link.';
    return;
  }
  await sharePacked(
    practice,
    token => `${location.origin}/#p=${token}`,
    'lacrossetube-practice.json',
    note
  );
  if (note.textContent === 'Link copied.') note.textContent = 'Practice link copied.';
});

document.getElementById('sharedFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  const note = document.getElementById('practiceNote');
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch {
    note.textContent = 'That file is not a marks list or a practice card.';
    document.getElementById('practiceBar').hidden = false;
    return;
  }
  const marks = LT.cleanSharedMarks(data);
  if (marks && marks.marks.length) {
    previewMarks = marks;
    openItemModal(marks.itemId, marks.marks[0].t || 0);
    return;
  }
  const practice = LT.cleanPractice(data);
  if (practice && practice.steps.length) {
    previewPractice = practice;
    renderPractice();
    note.textContent = 'Practice loaded. Save into Locker to keep it on this device.';
    return;
  }
  note.textContent = 'That file is not a marks list or a practice card.';
  document.getElementById('practiceBar').hidden = false;
});

document.getElementById('practiceSave').addEventListener('click', () => {
  if (!previewPractice) return;
  LT.savePractice(previewPractice);
  previewPractice = null;
  history.replaceState(null, '', location.pathname + location.search);
  renderPractice();
  document.getElementById('practiceNote').textContent = 'Practice saved on this device.';
});

document.getElementById('practiceClear').addEventListener('click', () => {
  previewPractice = null;
  LT.savePractice({ v: 1, title: 'Practice', steps: [] });
  document.getElementById('practiceNote').textContent = '';
  renderPractice();
});

// Phase 2.1: Multi-Variation Filter Drawer, Position Pills, Sort Select & Mobile 2x2/Swipe Toggle
document.getElementById('filterDrawerBtn')?.addEventListener('click', () => {
  const drawer = document.getElementById('filterDrawer');
  const btn = document.getElementById('filterDrawerBtn');
  if (!drawer) return;
  drawer.hidden = !drawer.hidden;
  btn?.setAttribute('aria-expanded', String(!drawer.hidden));
});

document.querySelectorAll('.pos-pill').forEach(el => {
  el.addEventListener('click', () => setPosition(el.dataset.pos));
});

document.getElementById('sortSelect')?.addEventListener('change', (e) => {
  currentSort = e.target.value;
  if (currentCategory === 'dispatch' && currentSort !== 'default') {
    currentCategory = 'all';
    document.querySelectorAll('.chip').forEach(el => el.classList.toggle('active', el.dataset.category === 'all'));
  }
  renderView();
});

document.getElementById('mobileLayoutBtn')?.addEventListener('click', () => {
  const isSwipe = document.body.classList.toggle('mobile-swipe');
  const btn = document.getElementById('mobileLayoutBtn');
  if (btn) btn.textContent = isSwipe ? '↔ Swipe' : '⊞ 2×2';
});

document.querySelectorAll('[data-action-q]').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.actionQ || '';
    const input = document.getElementById('searchInput');
    if (input) input.value = q;
    searchQuery = q.toLowerCase();
    if (currentCategory === 'dispatch' || currentCategory === 'blog' || currentCategory === 'trends') {
      currentCategory = 'all';
      document.querySelectorAll('.chip').forEach(el => el.classList.toggle('active', el.dataset.category === 'all'));
    }
    renderView();
  });
});

// Phase 2.6: Lightweight Skippable Onboarding Lacrosse Quiz
function readQuizSelections() {
  const getVal = (group) => document.querySelector(`.quiz-options[data-quiz="${group}"] .quiz-opt.active`)?.dataset.val || 'all';
  return {
    position: getVal('position'),
    focus: getVal('focus'),
    format: getVal('format')
  };
}

document.querySelectorAll('.quiz-options').forEach(group => {
  group.addEventListener('click', (e) => {
    const opt = e.target.closest('.quiz-opt');
    if (!opt) return;
    group.querySelectorAll('.quiz-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
  });
});

document.getElementById('onboardingBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('onboardingPanel');
  if (panel) panel.hidden = !panel.hidden;
});

document.getElementById('skipOnboardingBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('onboardingPanel');
  if (panel) panel.hidden = true;
  localStorage.setItem('lacrossetube_quiz_skipped', '1');
});

function applyProfileSetup(buildStarterPractice) {
  const sel = readQuizSelections();
  userProfile = LT.saveProfile(sel);
  const panel = document.getElementById('onboardingPanel');
  if (panel) panel.hidden = true;

  if (buildStarterPractice) {
    const matching = CATALOG.filter(item => item.type === 'video' && matchesProfile(item, userProfile)).slice(0, 3);
    if (matching.length) {
      const steps = matching.map(item => ({
        itemId: item.id,
        t: 0,
        why: whyHereFor(item).replace(/^Why it's here:\s*/i, '')
      }));
      writePractice({
        v: 1,
        title: `${sel.position.toUpperCase()} · ${sel.focus.toUpperCase()} Starter`,
        steps
      });
    }
  }
  renderView();
}

document.getElementById('saveOnboardingBtn')?.addEventListener('click', () => applyProfileSetup(true));
document.getElementById('applyOnboardingOnlyBtn')?.addEventListener('click', () => applyProfileSetup(false));
document.getElementById('resetOnboardingBtn')?.addEventListener('click', () => {
  userProfile = LT.saveProfile(null);
  localStorage.removeItem('lacrossetube_quiz_skipped');
  currentPosition = 'all';
  document.querySelectorAll('.pos-pill').forEach(el => el.classList.toggle('active', el.dataset.pos === 'all'));
  const panel = document.getElementById('onboardingPanel');
  if (panel) panel.hidden = true;
  renderView();
});

// Phase 2.7: Catalog-Aware Lacrosse AI Chat Drawer
async function runShelfAssistant(questionText) {
  const area = document.getElementById('aiResponseArea');
  if (!area || !window.LT_AI) return;
  area.innerHTML = '<p class="hint">Scanning 511 shelf items, Dispatch &amp; your Locker…</p>';
  const res = await window.LT_AI.askShelf(questionText, {
    catalog: CATALOG,
    dispatch: DISPATCH,
    savedIds,
    markMap: LT.loadMarkMap(),
    profile: userProfile
  });
  if (!res) {
    area.innerHTML = '<p class="hint">Type a lacrosse question above.</p>';
    return;
  }
  lastAiPicks = res.picks || [];
  const notesHtml = (res.contextNotes || []).map(n => `<div style="font-size:0.78rem; color:#34d399; margin-top:4px;">${esc(n).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}</div>`).join('');
  const picksHtml = lastAiPicks.map(item => `
    <div class="ai-pick-card" data-ai-open="${esc(item.id)}">
      <div style="display:flex; justify-content:space-between; gap:6px;">
        <strong style="font-size:0.82rem; color:#fff;">${esc(item.title)}</strong>
        <span style="font-size:0.68rem; color:#fb923c; white-space:nowrap;">${esc(item.subTag || item.categoryLabel)}</span>
      </div>
      <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(item.author)} · ${esc(whyHereFor(item))}</div>
    </div>
  `).join('');

  area.innerHTML = `
    <div style="background:#18181f; border-left:3px solid var(--accent); padding:10px 12px; border-radius:6px;">
      <div style="font-size:0.83rem; line-height:1.45;">${esc(res.coachingLine).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}</div>
      ${notesHtml}
    </div>
    <div style="font-size:0.74rem; font-weight:700; color:var(--basquiat-gold); text-transform:uppercase; margin-top:4px;">Recommended Shelf Films (${lastAiPicks.length})</div>
    ${picksHtml}
    ${lastAiPicks.length ? `<button type="button" class="btn-action" id="aiAddToPracticeBtn" style="justify-content:center;">+ Load top 3 picks into Practice Card</button>` : ''}
  `;
}

document.getElementById('aiToggleBtn')?.addEventListener('click', () => {
  const drawer = document.getElementById('aiDrawer');
  if (!drawer) return;
  drawer.hidden = !drawer.hidden;
  if (!drawer.hidden) {
    document.getElementById('aiQuestionInput')?.focus();
    if (!document.getElementById('aiResponseArea')?.innerHTML.trim()) {
      runShelfAssistant('Which films in today\'s Dispatch and shelf should I start with?');
    }
  }
});

document.getElementById('closeAiDrawerBtn')?.addEventListener('click', () => {
  const drawer = document.getElementById('aiDrawer');
  if (drawer) drawer.hidden = true;
});

document.getElementById('aiForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('aiQuestionInput')?.value || '';
  if (q.trim()) runShelfAssistant(q);
});

document.querySelectorAll('[data-ai-q]').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.aiQ || '';
    const input = document.getElementById('aiQuestionInput');
    if (input) input.value = q;
    runShelfAssistant(q);
  });
});

document.getElementById('aiResponseArea')?.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-ai-open]');
  if (pick) {
    openItemModal(pick.dataset.aiOpen);
    return;
  }
  if (e.target.id === 'aiAddToPracticeBtn' && lastAiPicks.length) {
    for (const item of lastAiPicks.slice(0, 3)) {
      addPracticeStep(item.id, 0, whyHereFor(item).replace(/^Why it's here:\s*/i, ''));
    }
  }
});

document.querySelector('.brand')?.addEventListener('click', (event) => { event.preventDefault(); setCategory('dispatch'); });
document.getElementById('searchInput').addEventListener('input', handleSearch);
document.querySelectorAll('.chip').forEach(el => el.addEventListener('click', () => setCategory(el.dataset.category)));
document.querySelectorAll('.subtag-pill').forEach(el => el.addEventListener('click', () => setSubTag(el.dataset.sub)));
document.getElementById('savedToggleBtn').addEventListener('click', toggleSavedFilter);
document.getElementById('playerModal').addEventListener('click', closeModalOnOverlay);
document.querySelector('.modal-close-btn').addEventListener('click', closeModal);
document.getElementById('cardsGrid').addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fallback = img.dataset.fallback;
  if (fallback && img.src !== fallback) img.src = fallback;
}, true);

updateVaultCounter();
renderPractice();
renderView();

fetch('/data/dispatch.json').then(response => response.ok ? response.json() : null).then(data => {
  DISPATCH = data;
  dispatchReady = true;
  if (onDispatch()) renderView();
}).catch(() => {
  dispatchReady = true;
  if (onDispatch()) renderView();
});

function handleSharedHashAndUrl() {
  LT.readHash(location.hash).then(shared => {
    const params = new URLSearchParams(location.search);
    if (shared?.kind === 'p') {
      previewPractice = shared.data;
      renderPractice();
    }
    if (shared?.kind === 'm') {
      previewMarks = shared.data;
      openItemModal(shared.data.itemId, Number(params.get('t')) || shared.data.marks[0]?.t || 0);
      return;
    }
    const watchId = params.get('watch');
    if (watchId) openItemModal(watchId, Number(params.get('t')) || 0);
  });
}

window.addEventListener('hashchange', handleSharedHashAndUrl);
handleSharedHashAndUrl();
