// YouTube's embedded player publishes infoDelivery messages after listening.
// Keep the reported time; never manufacture elapsed seconds while buffering.
(function () {
  function readMessage(event, iframe) {
    if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return null;
    let origin;
    try { origin = new URL(iframe.src).origin; } catch { return null; }
    if (origin !== 'https://www.youtube-nocookie.com' || event.origin !== origin) return null;
    let data = event.data;
    if (typeof data === 'string') {
      if (data.length > 50000) return null;
      try { data = JSON.parse(data); } catch { return null; }
    }
    if (!data || !['infoDelivery', 'initialDelivery', 'onReady', 'onStateChange'].includes(data.event)) return null;
    const time = data.info?.currentTime;
    return { ready: data.event === 'onReady', time: typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= 28800 ? time : null };
  }
  globalThis.LT_CLOCK = { readMessage };
})();
