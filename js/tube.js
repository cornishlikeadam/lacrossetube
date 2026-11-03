const CATALOG = window.LACROSSETUBE_LIVE_CATALOG || [];
const BLOGS = window.LACROSSETUBE_LIVE_BLOGS || [];
const TRENDS = window.LACROSSETUBE_LIVE_TRENDS || {};

let currentCategory = 'dispatch';
let DISPATCH = null;
let dispatchReady = false;
let previewMarks = null;
let previewPractice = null;
let clockT = 0;
let clockTimer = 0;
let pendingSkill = '';
let currentSubTag = 'all';
let searchQuery = '';
let savedOnly = false;
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

function setSubTag(sub) {
  currentSubTag = sub;
  if (currentCategory === 'blog' || currentCategory === 'trends') {
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
  if (e.key === 'Escape') closeModal();
});

function renderBlogView() {
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
  return currentCategory === 'dispatch' && !searchQuery && !savedOnly && currentSubTag === 'all';
}

function cardHtml(item, why) {
  const isSaved = savedIds.includes(item.id);
  const badge = badgeFor(item);
  const marks = item.id === previewMarks?.itemId ? previewMarks.marks : LT.marksFor(item.id);
  const note = why || noteFor(item);
  return `
    <div class="card" data-id="${esc(item.id)}">
      <div class="thumbnail-box">
        ${thumbHtml(item)}
        ${badge ? `<div class="midpoint-indicator">${esc(badge)}</div>` : ''}
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
              <span>${why ? 'In the drop' : 'Curator note'}</span>
              <span>${marks.length ? esc(marks.length + ' mark' + (marks.length === 1 ? '' : 's')) : esc(item.addedAt || '')}</span>
            </div>
            <div class="vouch-quote">${esc(note)}</div>
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
  const grid = document.getElementById('cardsGrid');
  if (!dispatchReady) {
    document.getElementById('statsLine').innerText = 'Shelf Dispatch';
    grid.innerHTML = '<div class="blog-panel dispatch-span"><h3>Loading the drop…</h3></div>';
    return;
  }
  const rows = (DISPATCH?.items || []).map(row => {
    const item = CATALOG.find(entry => entry.id === row.id);
    return item && row.why ? { item, why: String(row.why) } : null;
  }).filter(Boolean);
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
  const grid = document.getElementById('cardsGrid');
  const filtered = CATALOG.filter(item => {
    const matchesCat = category === 'all' || category === 'dispatch' || item.category === category;
    const matchesSub = currentSubTag === 'all' || (item.subTag || '').toLowerCase().includes(currentSubTag.toLowerCase());
    const blob = [item.title, noteFor(item), item.author, item.subTag, item.sourceHub, item.categoryLabel].join(' ').toLowerCase();
    const matchesSearch = !searchQuery || blob.includes(searchQuery);
    const matchesSaved = !savedOnly || savedIds.includes(item.id);
    return matchesCat && matchesSub && matchesSearch && matchesSaved;
  });
  if (savedOnly) {
    document.getElementById('statsLine').innerText = filtered.length ? `${filtered.length} in the Locker` : 'The Locker is empty';
    grid.innerHTML = filtered.length
      ? filtered.map(lockerRowHtml).join('')
      : '<div class="blog-panel dispatch-span"><h3>Nothing in the Locker yet.</h3><p>Save a film and it stays on this device.</p></div>';
    return;
  }
  document.getElementById('statsLine').innerText = `Showing ${filtered.length} of ${CATALOG.length}`;
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

function ensureSaved(id) {
  if (!id || savedIds.includes(id)) return;
  savedIds.push(id);
  localStorage.setItem('lacrossetube_vault', JSON.stringify(savedIds));
  updateVaultCounter();
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = 0;
}

function playerMessage(iframe, payload) {
  iframe.contentWindow?.postMessage(JSON.stringify({
    id: 'lt-player',
    channel: 'widget',
    ...payload
  }), '*');
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
  }, 500);
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'https://www.youtube-nocookie.com' && event.origin !== 'https://www.youtube.com') return;
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return; }
  }
  const time = Number(data?.info?.currentTime);
  if (!Number.isFinite(time)) return;
  clockT = time;
  const clock = document.getElementById('mark-clock');
  if (clock) clock.textContent = LT.fmt(clockT);
});

function marksNow(itemId) {
  if (previewMarks?.itemId === itemId) return previewMarks.marks.slice();
  return LT.marksFor(itemId);
}

function keepMarks(itemId, marks) {
  const clean = marks.map(LT.cleanMark).filter(Boolean).slice(0, 40);
  if (previewMarks?.itemId === itemId) previewMarks.marks = clean;
  else {
    LT.setMarks(itemId, clean);
    if (clean.length) ensureSaved(itemId);
  }
  paintMarks(itemId);
  return clean;
}

function paintMarks(itemId) {
  const list = document.getElementById('mark-list');
  if (!list) return;
  const marks = marksNow(itemId);
  const guest = previewMarks?.itemId === itemId;
  list.innerHTML = marks.map((mark, index) => `
    <div class="mark-row">
      <span class="mark-clock">${esc(LT.fmt(mark.t))}</span>
      ${mark.skill ? `<span class="subtag-badge" style="position:static;">${esc(mark.skill)}</span>` : ''}
      <span style="flex:1;">${esc(mark.text)}</span>
      <button class="nav-btn" type="button" data-to-practice="${index}">Add to practice</button>
      <button class="nav-btn" type="button" data-drop-mark="${index}">Remove</button>
    </div>
  `).join('') || '<p style="color:var(--text-muted); margin-top:8px;">No marks on this film yet.</p>';
  const save = document.getElementById('save-shared-marks');
  if (save) save.hidden = !guest;
}

function markForm(item) {
  if (!(item.type === 'video' && ytId(item.youtubeId))) return '';
  const skills = LT.SKILLS.map(skill => `<button class="nav-btn" type="button" data-skill="${skill}" aria-pressed="${pendingSkill === skill}">${esc(skill)}</button>`).join('');
  return `
    <div style="margin-top:16px;">
      <div style="font-size:0.7rem; text-transform:uppercase; color:var(--accent); font-weight:700;">Mark this moment</div>
      <div class="mark-row">
        <span class="mark-clock" id="mark-clock" aria-live="polite" aria-label="Film time">${esc(LT.fmt(clockT))}</span>
        <input class="mark-text" id="mark-text" maxlength="160" placeholder="Short note for this moment" aria-label="Note at this moment">
        <button class="btn-action" type="button" id="add-mark">Mark this moment</button>
      </div>
      <div class="skill-pills" aria-label="Skill">${skills}</div>
      <div id="mark-list"></div>
      <div class="mark-row">
        <button class="nav-btn" type="button" id="copy-marks">Copy marks link</button>
        <button class="btn-action" type="button" id="save-shared-marks" hidden>Save marks into Locker</button>
        <span id="mark-status" role="status" style="color:var(--text-muted); font-size:0.8rem;"></span>
      </div>
    </div>
  `;
}

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
  practice.steps.push({ itemId, t: Number(t) || 0, why: why || '' });
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
    return `<li><b>${esc(LT.fmt(step.t))}</b> ${esc(step.why || item?.title || '')}<br>${esc(item?.title || '')}${item?.author ? ' · ' + esc(item.author) : ''}${href ? `<br><a href="${esc(href)}">${esc(href)}</a>` : ''}</li>`;
  }).join('');
  sheet.innerHTML = `<h1>${esc(practice.title)}</h1><ol>${steps}</ol><p>LacrosseTube practice card.</p>`;
}

function openItemModal(id, startSeconds) {
  const item = CATALOG.find(i => i.id === id);
  if (!item) return;
  const wrap = document.getElementById('modalVideoWrap');
  const body = document.getElementById('modalBody');
  const video = ytId(item.youtubeId);
  const href = safeUrl(item.url);
  const saved = savedIds.includes(item.id);
  const start = Number.isFinite(Number(startSeconds)) ? Math.max(0, Math.floor(Number(startSeconds))) : 0;
  clockT = start;
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
    <div style="margin-top:14px; background:#222227; border-left:3px solid var(--accent); padding:12px 16px; border-radius:4px;">
      <div style="font-size:0.7rem; text-transform:uppercase; color:var(--accent); font-weight:700;">Curator note</div>
      <p style="margin-top:4px; font-size:0.9rem;">${esc(noteFor(item))}</p>
    </div>
    <div style="display:flex; gap:12px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn-action" type="button" data-save="${esc(item.id)}">
        ${saved ? '✓ Saved in Local Locker' : '+ Save to Local Locker'}
      </button>
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
  document.getElementById('playerModal').classList.remove('active');
  document.getElementById('modalVideoWrap').innerHTML = '';
  const hash = location.hash.startsWith('#p=') ? location.hash : '';
  if (location.search || location.hash.startsWith('#m=')) history.replaceState(null, '', '/' + hash);
}

function closeModalOnOverlay(e) {
  if (e.target.id === 'playerModal') closeModal();
}

document.getElementById('cardsGrid').addEventListener('click', (event) => {
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
  if (card) openItemModal(card.dataset.id);
});

document.getElementById('modalBody').addEventListener('click', async (event) => {
  const itemId = new URLSearchParams(location.search).get('watch');
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSave(save.dataset.save, event);
    return;
  }
  const skill = event.target.closest('[data-skill]');
  if (skill) {
    pendingSkill = pendingSkill === skill.dataset.skill ? '' : skill.dataset.skill;
    document.querySelectorAll('[data-skill]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.skill === pendingSkill)));
    return;
  }
  if (event.target.id === 'add-mark') {
    const text = document.getElementById('mark-text')?.value || '';
    const mark = LT.cleanMark({ t: clockT, text, skill: pendingSkill, at: Date.now() });
    const status = document.getElementById('mark-status');
    if (!mark) {
      if (status) status.textContent = 'Write the note first.';
      return;
    }
    keepMarks(itemId, marksNow(itemId).concat(mark));
    document.getElementById('mark-text').value = '';
    if (status) status.textContent = previewMarks ? 'Mark added. Save into Locker when you want to keep it on this device.' : 'Saved in the Locker.';
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
    ensureSaved(itemId);
    previewMarks = null;
    paintMarks(itemId);
    const status = document.getElementById('mark-status');
    if (status) status.textContent = 'Saved in the Locker.';
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
