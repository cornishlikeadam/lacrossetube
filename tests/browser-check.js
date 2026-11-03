async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  await page.unroute('**/*');
  await page.route('**/*', route => route.continue());
  const errors = [];
  let offlineTest = false;
  page.on('pageerror', error => {
    if (offlineTest && (error.message === 'A network error occurred.' || error.stack?.includes('youtube-nocookie.com'))) return;
    errors.push(error.message);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.catalog-page .card').first().waitFor();
  const catalogSize = await page.evaluate(() => window.LACROSSETUBE_LIVE_CATALOG.length);
  const four = await page.locator('.catalog-page').first().locator('.card').evaluateAll(cards => cards.map(card => { const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, w: r.width }; }));
  check(four.length === 4 && four[0].y === four[1].y && four[2].y === four[3].y && four[2].y > four[0].y, 'Swipe pages must contain two rows of two films');
  check(four[1].right <= 390 && four[1].x > four[0].x, 'Second film must fit without clipping');
  check(await page.locator('#filterDrawerBtn').isVisible(), 'Filter control must be visible');
  check((await page.locator('#filterDrawerBtn').boundingBox()).x < 390, 'Controls must fit on screen');
  await page.screenshot({ path: 'output/playwright/mobile-swipe.png' });
  await page.locator('#nextCatalogPage').click();
  await page.waitForFunction(() => document.getElementById('cardsGrid').scrollLeft > 100);
  await page.locator('#previousCatalogPage').click();
  await page.waitForFunction(() => document.getElementById('cardsGrid').scrollLeft < 5);
  // A real browser gesture, synthesized through Chrome's input protocol.
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('#cardsGrid').boundingBox();
  const y = Math.max(310, Math.min(600, box.y + 70));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y }] });
  for (let x = 320; x >= 40; x -= 20) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.getElementById('cardsGrid').scrollLeft > 100);
  await cdp.detach();
  await page.locator('#previousCatalogPage').click();
  await page.locator('#mobileLayoutBtn').click();
  check(await page.locator('#catalogPager').isHidden(), 'Grid mode must hide paging controls');
  await page.setViewportSize({ width: 320, height: 740 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px layout must not overflow the page');
  check((await page.locator('#filterDrawerBtn').boundingBox()).x < 320, '320px filters must stay reachable');
  check(await page.evaluate(() => document.querySelector('.brand').getBoundingClientRect().right <= document.querySelector('.nav-actions').getBoundingClientRect().left), '320px header controls must not overlap the brand');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/mobile-320.png' });
  await page.setViewportSize({ width: 390, height: 844 });

  // Film clock: reject another window, accept the current player, and freeze a mark.
  await page.locator('.card-open').first().click();
  await page.locator('#open-mark').waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.youtube-nocookie.com', source: window, data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 999 } }) }));
  });
  check(await page.locator('#mark-clock').textContent() !== '16:39', 'A different window must not control the clock');
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.youtube-nocookie.com', source: document.getElementById('lt-player').contentWindow, data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 83.3 } }) }));
  });
  check(await page.locator('#mark-clock').textContent() === '1:23', 'Clock must use reported YouTube time');
  await page.locator('#open-mark').click();
  await page.locator('#mark-text').fill('Recover inside <script>alert(1)</script>');
  await page.locator('#mark-by').fill('Alex');
  await page.locator('#mark-composer details summary').click();
  await page.locator('[data-skill="slide"]').click();
  await page.locator('#add-mark').click();
  const markInfo = await page.evaluate(() => { const id = new URLSearchParams(location.search).get('watch'); return { id, marks: LT.marksFor(id), locker: JSON.parse(localStorage.getItem('lacrossetube_vault') || '[]') }; });
  check(markInfo.marks[0].t === 83.3 && markInfo.marks[0].by === 'Alex' && markInfo.marks[0].skill === 'slide', 'Timestamp, by name, and skill must persist');
  check(markInfo.locker.length === 0, 'Marking must not change the ID-only Locker');
  check(await page.locator('#mark-list script').count() === 0, 'Shared/user text must be escaped');
  await page.locator('.manual-clock summary').click();
  await page.locator('#manualMarkTime').fill('2:34');
  await page.locator('#setMarkTime').click();
  await page.locator('#mark-text').fill('Manual timestamp');
  await page.locator('#add-mark').click();
  check(await page.evaluate(id => LT.marksFor(id)[1].t, markInfo.id) === 154, 'Manual clock fallback must set the saved timestamp');
  await page.screenshot({ path: 'output/playwright/marks-mobile.png' });
  // Sharing does not write anything on receipt; import merges with existing notes.
  const token = await page.evaluate(id => LT.pack({ v: 1, itemId: id, marks: [{ t: 12, text: 'Shared coach cue', by: 'Sam' }] }), markInfo.id);
  await page.goto(origin + '/?watch=' + markInfo.id + '#m=' + token);
  await page.locator('#save-shared-marks').waitFor();
  check(await page.evaluate(id => LT.marksFor(id).length, markInfo.id) === 2, 'Opening a share must not silently save or replace notes');
  await page.locator('#save-shared-marks').click();
  check(await page.evaluate(id => LT.marksFor(id).length, markInfo.id) === 3, 'Saving a share must merge all notes');
  check(await page.evaluate(id => JSON.parse(localStorage.getItem('lacrossetube_vault')).includes(id), markInfo.id), 'Saving a shared film must add its ID to Locker');
  await page.locator('[data-to-practice]').first().click();
  // Print remains usable with no network once the page has loaded.
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  offlineTest = true;
  await page.context().setOffline(true);
  await page.locator('#print-film-marks').click();
  check(await page.evaluate(() => window.__printed && document.getElementById('practiceSheet').textContent.includes('Shared coach cue')), 'Offline drill sheet must include coach notes');
  await page.emulateMedia({ media: 'print' });
  check(await page.locator('header').isHidden(), 'Print must remove site navigation');
  await page.pdf({ path: 'output/playwright/film-drill-sheet.pdf', format: 'Letter' });
  await page.emulateMedia({ media: 'screen' });
  await page.context().setOffline(false);
  await page.locator('.modal-close-btn').click();
  offlineTest = false;
  await page.locator('#practiceClear').click();

  // Knowledge answers affect the local profile and the practice, including on reload.
  await page.locator('#onboardingBtn').click();
  await page.locator('.quiz-options[data-quiz="position"] [data-val="goalie"]').click();
  await page.locator('.assessment-panel summary').click();
  await page.locator('input[name="recovery"][value="0"]').check();
  await page.locator('input[name="hands"][value="2"]').check();
  await page.locator('#checkAssessment').click();
  check((await page.locator('#assessmentResults').textContent()).includes('1 of 2'), 'Assessment must explain the score');
  await page.locator('#saveOnboardingBtn').click();
  check(await page.evaluate(() => LT.loadProfile().answers.recovery) === 0, 'Assessment answers must be saved locally');
  check(await page.evaluate(() => LT.loadPractice().steps.length) === 3, 'Setup must build a three-film practice');
  check(await page.evaluate(() => LT.loadPractice().steps.some(step => /slide|recover/i.test(LACROSSETUBE_LIVE_CATALOG.find(i => i.id === step.itemId).title))), 'Missed slide question must add slide review to starter practice');
  await page.reload();
  await page.locator('#onboardingBtn').click();
  check(await page.locator('input[name="recovery"][value="0"]').isChecked(), 'Setup must restore saved answers');
  await page.locator('#resetOnboardingBtn').click();
  check(await page.evaluate(() => LT.loadProfile()) === null, 'Reset must remove the local profile');
  await page.locator('#practiceClear').click();

  await page.locator('[data-category="all"]').click();
  check(await page.locator('.card').count() === catalogSize, 'Whole shelf must contain the same catalog');
  await page.locator('[data-pos="goalie"]').click();
  check((await page.locator('.card').count()) > 0 && (await page.locator('.card').count()) < catalogSize, 'Position views must filter the same catalog');
  await page.locator('[data-pos="all"]').click();
  await page.locator('#searchInput').fill('sidewall knot that holds in rain');
  check(await page.locator('.card').count() > 0, 'Action query must return relevant film');
  await page.locator('#searchInput').fill('');
  await page.locator('#sortSelect').selectOption('trending');
  check((await page.locator('#statsLine').textContent()).includes('your recent saves'), 'Rising must disclose its real local signal');
  await page.locator('#savedToggleBtn').click();
  check(await page.locator('.locker-row').count() === 1, 'Locker must retain ID-only saves after marks, reloads, and profile reset');
  await page.locator('#savedToggleBtn').click();
  await page.locator('[data-category="pockets"]').click();
  check(await page.locator('.pattern-record').count() === 3, 'Stick workbench must provide the reference tracks');
  await page.locator('.pattern-stages').first().locator('summary').click();
  check(await page.locator('.stage-card').count() >= 4, 'Progressive layer must expose four stages');
  check((await page.locator('.stick-doctor-layer').textContent()).includes('timestamp not verified'), 'Unsupplied timestamps must be identified');
  await page.locator('[data-category="shelf"]').click();
  check(await page.locator('.heritage-track-banner').isVisible(), 'Sources & Scans must expose the heritage track');
  await page.locator('#aiToggleBtn').click();
  await page.locator('#aiQuestionInput').fill('Show my marks');
  await page.locator('#aiForm button').click();
  await page.locator('.ai-pick-card').first().waitFor();
  check((await page.locator('#aiResponseArea').textContent()).includes('Local matching'), 'Local guide must disclose how it works');
  check((await page.locator('#aiResponseArea').textContent()).includes('Recover inside'), 'Guide must reference local marks');
  await page.locator('#closeAiDrawerBtn').click();
  await page.locator('[data-category="blog"]').click();
  check(await page.locator('.reading-desk .research-link').count() > 0, 'Journal must expose actual source-linked research');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-category="dispatch"]').click();
  check(await page.locator('.dispatch-intro h1').textContent() === 'Shelf Dispatch', 'Dispatch navigation must restore the front door after sorting and filtering');
  await page.screenshot({ path: 'output/playwright/desktop.png' });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Desktop must fit its viewport');
  check(errors.length === 0, 'Browser runtime errors: ' + errors.join('; '));
  console.log('PASS: mobile 390/320 + synthesized touch swipe, clock validation, timestamp marks, local storage isolation, share/merge, offline print, assessment persistence/recommendations, catalog filters/sorts, heritage, local guide, journal, desktop.');
}
