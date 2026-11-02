const CATALOG = window.LACROSSETUBE_LIVE_CATALOG || [];
const BLOGS = window.LACROSSETUBE_LIVE_BLOGS || [];
const TRENDS = window.LACROSSETUBE_LIVE_TRENDS || {};

let currentCategory = 'all';
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

function badgeFor(item) {
  if (item.badge) return item.badge;
  if (item.type === 'video') return '50% Still Frame';
  if (item.type === 'archive') return 'Archive scan';
  const href = item.pdfUrl || item.url || '';
  if (item.type === 'playbook' && /\.pdf($|\?)/i.test(href)) return 'PDF';
  return 'Source page';
}

function noteFor(item) {
  return item.curatorNote || item.vouchQuote || '';
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
          <span style="font-size:0.7rem; background:#27272a; color:#fb923c; padding:2px 7px; border-radius:4px; font-weight:700;">${esc(badgeFor(item))}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">
          ${esc(item.author)} · ${esc(item.categoryLabel)} (${esc(item.subTag || '')})
        </div>
        <div style="font-size:0.82rem; color:#d4d4d8; font-style:italic; margin-top:6px;">"${esc(noteFor(item))}"</div>
      </div>
    </div>
  `).join('');

  grid.innerHTML = `
    <div class="blog-panel">
      <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--basquiat-gold); text-transform:uppercase;">
        [ST-100 DISPATCH]
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
        [ST-100 RADAR]
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

function renderView() {
  if (currentCategory === 'blog') return renderBlogView();
  if (currentCategory === 'trends') return renderTrendsView();

  const grid = document.getElementById('cardsGrid');
  const filtered = CATALOG.filter(item => {
    const matchesCat = (currentCategory === 'all') || (item.category === currentCategory);
    const matchesSub = (currentSubTag === 'all') || ((item.subTag || '').toLowerCase().includes(currentSubTag.toLowerCase()));
    const blob = [item.title, noteFor(item), item.author, item.subTag, item.sourceHub, item.categoryLabel].join(' ').toLowerCase();
    const matchesSearch = !searchQuery || blob.includes(searchQuery);
    const matchesSaved = !savedOnly || savedIds.includes(item.id);
    return matchesCat && matchesSub && matchesSearch && matchesSaved;
  });

  document.getElementById('statsLine').innerText = `Showing ${filtered.length} of ${CATALOG.length} · halfway frames on every video`;

  grid.innerHTML = filtered.map(item => {
    const isSaved = savedIds.includes(item.id);
    const badge = badgeFor(item);
    return `
      <div class="card" data-id="${esc(item.id)}">
        <div class="thumbnail-box">
          ${thumbHtml(item)}
          <div class="midpoint-indicator">${esc(badge)}</div>
          ${item.subTag ? `<div class="subtag-badge">${esc(item.subTag)}</div>` : ''}
          <div class="duration-badge ${item.type === 'video' ? '' : 'badge-playbook'}">${esc(item.duration || badge)}</div>
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
                <span>Curator note</span>
                <span>${esc(item.addedAt || '')}</span>
              </div>
              <div class="vouch-quote">${esc(noteFor(item))}</div>
            </div>
            <div style="margin-top:4px; display:flex; justify-content:flex-end;">
              <button type="button" data-save="${esc(item.id)}" style="background:transparent; border:none; color:${isSaved ? '#f97316' : '#71717a'}; cursor:pointer; font-size:0.75rem; font-weight:700;">
                ${isSaved ? '✓ Saved in Locker' : '+ Save to Locker'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openItemModal(id) {
  const item = CATALOG.find(i => i.id === id);
  if (!item) return;
  const wrap = document.getElementById('modalVideoWrap');
  const body = document.getElementById('modalBody');
  const video = ytId(item.youtubeId);
  const href = safeUrl(item.url);
  const saved = savedIds.includes(item.id);

  if (item.type === 'video' && video) {
    wrap.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${esc(item.title)}"></iframe>`;
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
  `;
  document.getElementById('playerModal').classList.add('active');
  history.replaceState(null, '', '/?watch=' + encodeURIComponent(item.id));
}

function closeModal() {
  document.getElementById('playerModal').classList.remove('active');
  document.getElementById('modalVideoWrap').innerHTML = '';
  if (location.search) history.replaceState(null, '', '/');
}

function closeModalOnOverlay(e) {
  if (e.target.id === 'playerModal') closeModal();
}

document.getElementById('cardsGrid').addEventListener('click', (event) => {
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSave(save.dataset.save, event);
    return;
  }
  const card = event.target.closest('[data-id]');
  if (card) openItemModal(card.dataset.id);
});

document.getElementById('modalBody').addEventListener('click', (event) => {
  const save = event.target.closest('[data-save]');
  if (save) toggleSave(save.dataset.save, event);
});

document.querySelector('.brand')?.addEventListener('click', (event) => { event.preventDefault(); setCategory('all'); });
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
renderView();

const watchId = new URLSearchParams(location.search).get('watch');
if (watchId) openItemModal(watchId);
