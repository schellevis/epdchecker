#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const dns = require('node:dns').promises;
const fs = require('fs');
const path = require('path');

const hospitals = require('./hospitals.json');

const DIST_DIR = path.join(__dirname, 'dist');
const SCREENSHOTS_DIR = path.join(DIST_DIR, 'screenshots');
const CONCURRENCY = 5;
const HTTP_TIMEOUT = 12000;
const NAV_TIMEOUT = 20000;
const HIX365_IP = '20.86.217.65';

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
// Prevent GitHub Pages from running Jekyll
fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '');

async function checkHttp(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
    return { status: res.status, ok: res.status === 200 };
  } catch {
    return { status: 0, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function takeScreenshot(browser, url, filename) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    // Brief pause for visual rendering
    await page.waitForTimeout(1500);
  } catch {
    // Navigation failed – screenshot whatever is shown (browser error page etc.)
  }
  try {
    await page.screenshot({ path: filename, type: 'jpeg', quality: 75 });
    return true;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

async function resolveAddresses(hostname) {
  try {
    const records = await dns.lookup(hostname, { all: true });
    return [...new Set(records.map(record => record.address))];
  } catch {
    return [];
  }
}

async function runWithConcurrency(items, fn, limit) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const checkedAt = new Date();

  console.log(`Checking ${hospitals.length} hospitals with concurrency ${CONCURRENCY}...`);

  const results = await runWithConcurrency(hospitals, async (hospital) => {
    const url = `https://${hospital.domain}`;
    const slug = hospital.domain.replace(/[^a-z0-9]/gi, '_');
    const screenshotFile = path.join(SCREENSHOTS_DIR, `${slug}.jpg`);

    const [{ status, ok }, resolvedAddresses] = await Promise.all([
      checkHttp(url),
      resolveAddresses(hospital.domain),
    ]);
    const label = ok ? '✓' : '✗';
    console.log(`${label} [${String(status).padStart(3)}] ${hospital.domain}`);

    const hasScreenshot = await takeScreenshot(browser, url, screenshotFile);

    return {
      ...hospital,
      url,
      status,
      ok,
      resolvedAddresses,
      isHix365: resolvedAddresses.includes(HIX365_IP),
      screenshotPath: hasScreenshot ? `screenshots/${slug}.jpg` : null,
    };
  }, CONCURRENCY);

  await browser.close();

  // Sort: offline first, then alphabetically by name within each group
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.name.localeCompare(b.name, 'nl');
  });

  const html = generateHtml(results, checkedAt);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html, 'utf8');

  // Write a JSON summary for potential future use
  fs.writeFileSync(
    path.join(DIST_DIR, 'status.json'),
    JSON.stringify({ checkedAt: checkedAt.toISOString(), results }, null, 2),
    'utf8'
  );

  const onlineCount = results.filter(r => r.ok).length;
  const offlineCount = results.filter(r => !r.ok).length;
  console.log(`\nDone: ${onlineCount} online, ${offlineCount} offline`);
}

function statusLabel(status) {
  if (status === 200) return { text: 'Online', css: 'ok' };
  if (status === 503) return { text: '503 – Niet beschikbaar', css: 'err503' };
  if (status === 0)   return { text: 'Geen verbinding', css: 'err000' };
  return { text: `HTTP ${status}`, css: 'errOther' };
}

function formatTimestamp(date) {
  return date.toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function card(h, cacheKey) {
  const { text, css } = statusLabel(h.status);
  const extraBadges = h.isHix365
    ? `<span class="badge badge-tag">hix365</span>`
    : '';
  const imgHtml = h.screenshotPath
    ? `<img src="${h.screenshotPath}?v=${cacheKey}" alt="Screenshot ${h.name}" loading="lazy"
            onclick="openLightbox(this.src,'${h.name.replace(/'/g, "\\'")}')">`
    : `<div class="no-screenshot">Geen screenshot beschikbaar</div>`;

  return `
    <div class="card ${h.ok ? 'online' : 'offline'}">
      <div class="thumb">${imgHtml}</div>
      <div class="card-body">
        <div class="hospital-name">${h.name}</div>
        <div class="hospital-url">
          <a href="${h.url}" target="_blank" rel="noopener">${h.domain}</a>
        </div>
        <div class="badge-row">
          <span class="badge badge-${css}">${text}</span>
          ${extraBadges}
        </div>
      </div>
    </div>`;
}

function generateHtml(results, checkedAt) {
  const offline = results.filter(r => !r.ok);
  const online  = results.filter(r =>  r.ok);
  const hix365Offline = offline.filter(r => r.isHix365);
  const hix365Online = online.filter(r => r.isHix365);
  const cacheKey = checkedAt.getTime();

  const offlineCards = offline.map(h => card(h, cacheKey)).join('');
  const onlineCards  = online.map(h => card(h, cacheKey)).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="600">
  <title>EPD Status Monitor</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* --- Design tokens: dark mode (default) --- */
    :root {
      --bg:           #0f172a;
      --surface:      #1e293b;
      --border:       #334155;
      --border-hr:    #1e293b;
      --text:         #e2e8f0;
      --text-muted:   #94a3b8;
      --text-label:   #cbd5e1;
      --accent:       #38bdf8;
      --thumb-bg:     #0f172a;
      --no-shot:      #475569;
      --url-color:    #64748b;
      --url-hover:    #94a3b8;
      --hover-shadow: rgba(0,0,0,0.4);
      --badge-ok-bg:      rgba(34,197,94,0.12);
      --badge-ok-color:   #4ade80;
      --badge-503-bg:     rgba(239,68,68,0.12);
      --badge-503-color:  #f87171;
      --badge-000-bg:     rgba(148,163,184,0.10);
      --badge-000-color:  #94a3b8;
      --badge-oth-bg:     rgba(251,191,36,0.12);
      --badge-oth-color:  #fbbf24;
      --pill-off-bg:      rgba(239,68,68,0.15);
      --pill-off-color:   #f87171;
      --pill-off-border:  rgba(239,68,68,0.3);
      --pill-on-bg:       rgba(34,197,94,0.12);
      --pill-on-color:    #4ade80;
      --pill-on-border:   rgba(34,197,94,0.25);
      --sec-off-color:    #f87171;
      --sec-on-color:     #4ade80;
      --card-off-border:  rgba(239,68,68,0.4);
      --card-on-border:   rgba(34,197,94,0.25);
      --lightbox-bg:      rgba(0,0,0,0.88);
      --lightbox-caption: #cbd5e1;
      --lightbox-close:   #94a3b8;
      --lightbox-close-hover: #ffffff;
    }

    /* --- Light mode overrides --- */
    @media (prefers-color-scheme: light) {
      :root {
        --bg:           #f1f5f9;
        --surface:      #ffffff;
        --border:       #e2e8f0;
        --border-hr:    #e2e8f0;
        --text:         #0f172a;
        --text-muted:   #64748b;
        --text-label:   #334155;
        --accent:       #0284c7;
        --thumb-bg:     #f8fafc;
        --no-shot:      #94a3b8;
        --url-color:    #94a3b8;
        --url-hover:    #64748b;
        --hover-shadow: rgba(0,0,0,0.12);
        --badge-ok-bg:      rgba(22,163,74,0.10);
        --badge-ok-color:   #15803d;
        --badge-503-bg:     rgba(220,38,38,0.10);
        --badge-503-color:  #b91c1c;
        --badge-000-bg:     rgba(100,116,139,0.10);
        --badge-000-color:  #475569;
        --badge-oth-bg:     rgba(217,119,6,0.10);
        --badge-oth-color:  #b45309;
        --pill-off-bg:      rgba(220,38,38,0.08);
        --pill-off-color:   #b91c1c;
        --pill-off-border:  rgba(220,38,38,0.25);
        --pill-on-bg:       rgba(22,163,74,0.08);
        --pill-on-color:    #15803d;
        --pill-on-border:   rgba(22,163,74,0.25);
        --sec-off-color:    #b91c1c;
        --sec-on-color:     #15803d;
        --card-off-border:  rgba(220,38,38,0.35);
        --card-on-border:   rgba(22,163,74,0.25);
        --lightbox-bg:      rgba(0,0,0,0.75);
        --lightbox-caption: #1e293b;
        --lightbox-close:   #475569;
        --lightbox-close-hover: #0f172a;
      }
    }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 20px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
    header h1 span { color: var(--accent); }
    .meta { color: var(--text-muted); font-size: 0.8rem; line-height: 1.6; }
    .meta strong { color: var(--text-label); }

    .summary-bar {
      display: flex;
      gap: 12px;
      padding: 16px 32px;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      align-items: center;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 14px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .pill-offline { background: var(--pill-off-bg); color: var(--pill-off-color); border: 1px solid var(--pill-off-border); }
    .pill-online  { background: var(--pill-on-bg);  color: var(--pill-on-color);  border: 1px solid var(--pill-on-border); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

    main { padding: 28px 32px; max-width: 1600px; margin: 0 auto; }

    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .section-header h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .section-header.offline h2 { color: var(--sec-off-color); }
    .section-header.online  h2 { color: var(--sec-on-color); }
    .section-header hr { flex: 1; border: none; border-top: 1px solid var(--border-hr); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
      margin-bottom: 40px;
    }

    .card {
      background: var(--surface);
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--border);
      transition: box-shadow 0.2s, transform 0.2s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--hover-shadow); }
    .card.offline { border-color: var(--card-off-border); }
    .card.online  { border-color: var(--card-on-border); }

    .thumb {
      position: relative;
      aspect-ratio: 16 / 10;
      background: var(--thumb-bg);
      overflow: hidden;
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top left;
      cursor: zoom-in;
      display: block;
      transition: transform 0.3s;
    }
    .thumb img:hover { transform: scale(1.03); }
    .no-screenshot {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--no-shot);
      font-size: 0.8rem;
    }

    .card-body { padding: 12px 14px 14px; }
    .hospital-name { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
    .hospital-url { margin-top: 3px; }
    .hospital-url a {
      color: var(--url-color);
      font-size: 0.72rem;
      text-decoration: none;
      word-break: break-all;
    }
    .hospital-url a:hover { color: var(--url-hover); }

    .badge {
      display: inline-block;
      margin-top: 8px;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 8px;
    }
    .badge-row .badge { margin-top: 0; }
    .badge-ok       { background: var(--badge-ok-bg);  color: var(--badge-ok-color); }
    .badge-err503   { background: var(--badge-503-bg); color: var(--badge-503-color); }
    .badge-err000   { background: var(--badge-000-bg); color: var(--badge-000-color); }
    .badge-errOther { background: var(--badge-oth-bg); color: var(--badge-oth-color); }
    .badge-tag      { background: rgba(2,132,199,0.12); color: var(--accent); }

    /* Lightbox */
    #lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: var(--lightbox-bg);
      z-index: 999;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      cursor: zoom-out;
    }
    #lightbox.active { display: flex; }
    #lightbox img {
      max-width: 92vw;
      max-height: 85vh;
      border-radius: 8px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      cursor: default;
    }
    #lightbox-caption {
      color: var(--lightbox-caption);
      font-size: 0.9rem;
      font-weight: 600;
    }
    #lightbox-close {
      position: absolute;
      top: 16px; right: 20px;
      font-size: 1.8rem;
      color: var(--lightbox-close);
      cursor: pointer;
      line-height: 1;
      background: none; border: none;
    }
    #lightbox-close:hover { color: var(--lightbox-close-hover); }

    @media (max-width: 600px) {
      header, main, .summary-bar { padding-left: 16px; padding-right: 16px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<header>
  <h1>EPD Status <span>Monitor</span></h1>
  <div class="meta">
    <strong>Laatste check:</strong> ${formatTimestamp(checkedAt)}
  </div>
</header>

<div class="summary-bar">
  <span class="pill pill-offline"><span class="dot"></span>${offline.length} offline</span>
  <span class="pill pill-online"><span class="dot"></span>${online.length} online</span>
  <span class="pill pill-offline"><span class="dot"></span>${hix365Offline.length} hix365 offline</span>
  <span class="pill pill-online"><span class="dot"></span>${hix365Online.length} hix365 online</span>
  <span style="color:#475569;font-size:0.8rem">van ${results.length} EPD-portalen</span>
</div>

<main>
  ${offline.length > 0 ? `
  <div class="section-header offline">
    <h2>Offline / niet bereikbaar</h2>
    <hr>
  </div>
  <div class="grid">${offlineCards}</div>
  ` : ''}

  <div class="section-header online">
    <h2>Online</h2>
    <hr>
  </div>
  <div class="grid">${onlineCards}</div>
</main>

<div id="lightbox" onclick="closeLightbox()">
  <button id="lightbox-close" onclick="closeLightbox()">✕</button>
  <img id="lightbox-img" src="" alt="">
  <div id="lightbox-caption"></div>
</div>

<script>
  function openLightbox(src, caption) {
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox-caption').textContent = caption;
    document.getElementById('lightbox').classList.add('active');
  }
  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('active');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
</script>
</body>
</html>`;
}

main().catch(err => { console.error(err); process.exit(1); });
