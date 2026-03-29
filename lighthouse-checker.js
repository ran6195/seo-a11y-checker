const { chromium } = require('playwright');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const path = require('path');

function _buildTimestamp(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

function _extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch (e) {
    return 'sito';
  }
}

function _docsPath(filename) {
  const docsDir = path.join(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  return path.join(docsDir, filename);
}

class LighthouseChecker {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.results = [];
    this.visitedPages = new Set();
    this.pendingPages = new Set();
    this.startTime = new Date();
    this.baseDomain = null;
    this.initOptions = {};
  }

  async init(options = {}) {
    this.initOptions = options;
    const launchOpts = { headless: true, slowMo: 0 };

    if (options.userDataDir) {
      this.context = await chromium.launchPersistentContext(options.userDataDir, {
        ...launchOpts,
        channel: 'chrome',
        args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
      });
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else {
      this.browser = await chromium.launch(launchOpts);
      this.page = await this.browser.newPage();
    }
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
    if (this.context) { await this.context.close(); this.context = null; }
    this.page = null;
  }

  // ─── Crawling ────────────────────────────────────────────────────────────────

  async crawlSite(baseUrl, maxPages = null) {
    console.log(`\n🕷️  Inizio crawling Lighthouse di: ${baseUrl}`);
    const urls = await this._collectUrls(baseUrl, maxPages);
    await this.close(); // libera il browser Playwright prima di avviare Lighthouse
    await this._runLighthouseOnUrls(urls);
  }

  async navigateAndCheck(baseUrl, maxPages = 5) {
    console.log(`\n🔍 Controllo Lighthouse di: ${baseUrl} (max ${maxPages} pagine)`);
    const urls = await this._collectUrls(baseUrl, maxPages);
    await this.close();
    await this._runLighthouseOnUrls(urls);
  }

  async _collectUrls(baseUrl, maxPages) {
    this.baseDomain = new URL(baseUrl).hostname;
    const normalizedBase = this.normalizeUrl(baseUrl);
    this.pendingPages.add(normalizedBase);

    const urls = [];

    while (this.pendingPages.size > 0 && (maxPages === null || urls.length < maxPages)) {
      const current = [...this.pendingPages][0];
      this.pendingPages.delete(current);

      if (this.visitedPages.has(current)) continue;
      this.visitedPages.add(current);
      urls.push(current);

      try {
        await this.page.goto(current, { waitUntil: 'networkidle', timeout: 30000 });
        const links = await this.discoverLinksOnPage();
        links.forEach(link => {
          if (!this.visitedPages.has(link) && !this.pendingPages.has(link)) {
            this.pendingPages.add(link);
          }
        });
        console.log(`  [${urls.length}${maxPages ? `/${maxPages}` : ''}] Trovata: ${current} (${this.pendingPages.size} in coda)`);
      } catch (e) {
        console.warn(`  ⚠️  Errore su ${current}: ${e.message}`);
      }
    }

    if (maxPages && this.pendingPages.size > 0) {
      console.log(`\n🛑 Limite raggiunto (${maxPages} pagine). ${this.pendingPages.size} URL non analizzate.`);
    }

    console.log(`\n✅ ${urls.length} pagine scoperte. Avvio analisi Lighthouse...\n`);
    return urls;
  }

  async _runLighthouseOnUrls(urls) {
    for (const url of urls) {
      await this.checkUrl(url, this.initOptions);
    }
  }

  async discoverLinksOnPage() {
    try {
      const links = await this.page.$$eval('a[href]',
        els => els.map(el => el.href).filter(h => h && h.trim().length > 0)
      );
      return [...new Set(
        links
          .filter(link => this.isValidUrl(link))
          .map(link => this.normalizeUrl(link))
      )];
    } catch (e) {
      return [];
    }
  }

  isValidUrl(url) {
    try {
      const u = new URL(url);

      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (u.hostname.replace(/^www\./, '') !== this.baseDomain.replace(/^www\./, '')) return false;
      if (url.includes('#')) return false;

      const excludedExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.rar', '.tar', '.gz',
        '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
        '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav',
        '.css', '.js', '.xml', '.json', '.txt',
      ];

      const pathname = u.pathname.toLowerCase();
      if (excludedExtensions.some(ext => pathname.endsWith(ext))) return false;

      return true;
    } catch {
      return false;
    }
  }

  normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hostname = u.hostname.replace(/^www\./, '');
      if (u.pathname !== '/' && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
      u.hash = '';
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(p => {
        u.searchParams.delete(p);
      });
      return u.toString();
    } catch {
      return url;
    }
  }

  // ─── Analisi singola URL ──────────────────────────────────────────────────────

  async checkUrl(url, options = {}) {
    const { default: lighthouse } = await import('lighthouse');

    const chromeFlags = ['--headless=new', '--disable-gpu'];
    if (options.userDataDir) {
      chromeFlags.push(`--user-data-dir=${options.userDataDir}`);
    }

    console.log(`\n🔍 Analisi Lighthouse: ${url}`);
    const chrome = await chromeLauncher.launch({ chromeFlags });

    try {
      const lhOptions = {
        port: chrome.port,
        output: 'json',
        onlyCategories: ['performance', 'accessibility', 'seo', 'best-practices'],
        logLevel: 'error',
        locale: 'it',
      };

      const runnerResult = await lighthouse(url, lhOptions);
      const lhr = runnerResult.lhr;

      const result = {
        url,
        fetchTime: lhr.fetchTime,
        scores: {
          performance:    Math.round((lhr.categories.performance?.score    ?? 0) * 100),
          accessibility:  Math.round((lhr.categories.accessibility?.score  ?? 0) * 100),
          seo:            Math.round((lhr.categories.seo?.score            ?? 0) * 100),
          bestPractices:  Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
        },
        metrics: {
          lcp:        lhr.audits['largest-contentful-paint']?.displayValue ?? 'N/A',
          fcp:        lhr.audits['first-contentful-paint']?.displayValue   ?? 'N/A',
          tbt:        lhr.audits['total-blocking-time']?.displayValue      ?? 'N/A',
          cls:        lhr.audits['cumulative-layout-shift']?.displayValue  ?? 'N/A',
          tti:        lhr.audits['interactive']?.displayValue              ?? 'N/A',
          speedIndex: lhr.audits['speed-index']?.displayValue             ?? 'N/A',
        },
        failedAudits: this._extractFailedAudits(lhr),
      };

      this._printSummary(result);
      this.results.push(result);
      return result;

    } finally {
      await chrome.kill();
    }
  }

  _getAuditCategory(id) {
    const map = {
      // Server / Infrastruttura
      'server-response-time': 'server',
      'uses-text-compression': 'server',
      'uses-long-cache-ttl': 'server',
      'uses-http2': 'server',
      'redirects': 'server',
      'total-byte-weight': 'server',
      'network-rtt': 'server',
      'network-server-latency': 'server',
      // Immagini
      'uses-optimized-images': 'immagini',
      'uses-responsive-images': 'immagini',
      'offscreen-images': 'immagini',
      'uses-webp-images': 'immagini',
      'modern-image-formats': 'immagini',
      'image-size-responsive': 'immagini',
      'image-aspect-ratio': 'immagini',
      'unsized-images': 'immagini',
      'efficient-animated-content': 'immagini',
      // JavaScript / CSS
      'unused-javascript': 'js-css',
      'unused-css-rules': 'js-css',
      'render-blocking-resources': 'js-css',
      'bootup-time': 'js-css',
      'mainthread-work-breakdown': 'js-css',
      'third-party-summary': 'js-css',
      'third-party-facades': 'js-css',
      'no-document-write': 'js-css',
      'uses-passive-event-listeners': 'js-css',
      'dom-size': 'js-css',
      'unminified-javascript': 'js-css',
      'unminified-css': 'js-css',
      'duplicated-javascript': 'js-css',
      'legacy-javascript': 'js-css',
      'long-tasks': 'js-css',
      // HTML / Font
      'font-display': 'html',
      'bf-cache': 'html',
      'uses-rel-preconnect': 'html',
      'preload-lcp-image': 'html',
      'errors-in-console': 'html',
      'valid-source-maps': 'html',
      'meta-description': 'html',
      'document-title': 'html',
      'html-has-lang': 'html',
    };
    return map[id] || 'altro';
  }

  _getAuditOwner(category) {
    return {
      server:    'DevOps / Hosting',
      immagini:  'Frontend / CMS',
      'js-css':  'Frontend',
      html:      'Frontend / CMS',
      altro:     '—',
    }[category] || '—';
  }

  _extractFailedAudits(lhr) {
    return Object.values(lhr.audits)
      .filter(a =>
        a.score !== null &&
        a.score < 0.9 &&
        a.scoreDisplayMode !== 'informative' &&
        a.scoreDisplayMode !== 'manual' &&
        a.scoreDisplayMode !== 'notApplicable'
      )
      .map(a => ({
        id: a.id,
        title: a.title,
        description: a.description ? a.description.split('\n')[0].replace(/\[.*?\]\(.*?\)/g, '').trim() : '',
        score: Math.round((a.score ?? 0) * 100),
        displayValue: a.displayValue ?? '',
        savingsBytes: a.details?.overallSavingsBytes ?? null,
        savingsMs:    a.details?.overallSavingsMs    ?? null,
        category:     this._getAuditCategory(a.id),
      }))
      .sort((a, b) => a.score - b.score);
  }

  _printSummary(result) {
    const s = result.scores;
    const m = result.metrics;
    console.log(`  Performance:    ${this._scoreEmoji(s.performance)}  ${s.performance}`);
    console.log(`  Accessibility:  ${this._scoreEmoji(s.accessibility)}  ${s.accessibility}`);
    console.log(`  SEO:            ${this._scoreEmoji(s.seo)}  ${s.seo}`);
    console.log(`  Best Practices: ${this._scoreEmoji(s.bestPractices)}  ${s.bestPractices}`);
    console.log(`  LCP: ${m.lcp}  |  CLS: ${m.cls}  |  TBT: ${m.tbt}`);
  }

  _scoreEmoji(score) {
    if (score >= 90) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
  }

  _scoreClass(score) {
    if (score >= 90) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  generateHTMLReport(filename = null) {
    const endTime = new Date();
    if (!filename) {
      const domain = this.results.length > 0 ? _extractDomain(this.results[0].url) : 'sito';
      filename = `${_buildTimestamp(endTime)}_${domain}_lighthouse.html`;
    }
    const html = this._buildHTML(endTime);
    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`\n📄 Report HTML salvato: ${filepath}`);
    return filepath;
  }

  generateJSONReport(filename = null) {
    const endTime = new Date();
    if (!filename) {
      const domain = this.results.length > 0 ? _extractDomain(this.results[0].url) : 'sito';
      filename = `${_buildTimestamp(endTime)}_${domain}_lighthouse.json`;
    }
    const json = {
      generatedAt: endTime.toISOString(),
      duration: Math.round((endTime - this.startTime) / 1000),
      results: this.results.map(({ url, fetchTime, scores, metrics, failedAudits }) => ({
        url,
        fetchTime,
        scores,
        metrics,
        failedAuditsCount: failedAudits.length,
        failedAudits,
      })),
    };
    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, JSON.stringify(json, null, 2), 'utf8');
    console.log(`📄 Report JSON salvato: ${filepath}`);
    return filepath;
  }

  _buildHTML(endTime) {
    const duration = Math.round((endTime - this.startTime) / 1000);
    const n = this.results.length;

    const avg = (key) =>
      n > 0 ? Math.round(this.results.reduce((s, r) => s + r.scores[key], 0) / n) : 0;

    const avgScores = {
      performance:   avg('performance'),
      accessibility: avg('accessibility'),
      seo:           avg('seo'),
      bestPractices: avg('bestPractices'),
    };

    const firstMetrics = n > 0 ? this.results[0].metrics : {};
    const domain = n > 0 ? new URL(this.results[0].url).hostname.replace(/^www\./, '') : '';

    const scoreRing = (score, label) => `
      <div class="score-card">
        <div class="score-ring ${this._scoreClass(score)}">${score}</div>
        <div class="score-label">${label}</div>
      </div>`;

    const metricCard = (value, label, desc) => `
      <div class="metric-card">
        <div class="metric-value">${value}</div>
        <div class="metric-label">${label}</div>
        <div class="metric-desc">${desc}</div>
      </div>`;

    const pagesTable = n > 1 ? `
      <div class="section">
        <h2 class="section-title">Dettaglio pagine</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Performance</th>
                <th>Accessibility</th>
                <th>SEO</th>
                <th>Best Practices</th>
              </tr>
            </thead>
            <tbody>
              ${this.results.map(r => `
              <tr>
                <td class="url-cell">${r.url}</td>
                <td><span class="badge ${this._scoreClass(r.scores.performance)}">${r.scores.performance}</span></td>
                <td><span class="badge ${this._scoreClass(r.scores.accessibility)}">${r.scores.accessibility}</span></td>
                <td><span class="badge ${this._scoreClass(r.scores.seo)}">${r.scores.seo}</span></td>
                <td><span class="badge ${this._scoreClass(r.scores.bestPractices)}">${r.scores.bestPractices}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // ── Piano d'azione ───────────────────────────────────────────────────────────
    // Raccoglie tutti gli audit unici da tutte le pagine, ordinati per impatto
    const allAuditsMap = new Map();
    this.results.forEach(r => {
      r.failedAudits.forEach(a => {
        if (!allAuditsMap.has(a.id) || a.score < allAuditsMap.get(a.id).score) {
          allAuditsMap.set(a.id, a);
        }
      });
    });

    const actionAudits = [...allAuditsMap.values()].sort((a, b) => {
      // Prima per risparmio bytes (desc), poi ms (desc), poi score (asc)
      const bytesA = a.savingsBytes ?? -1;
      const bytesB = b.savingsBytes ?? -1;
      if (bytesB !== bytesA) return bytesB - bytesA;
      const msA = a.savingsMs ?? -1;
      const msB = b.savingsMs ?? -1;
      if (msB !== msA) return msB - msA;
      return a.score - b.score;
    });

    const impactLabel = (a) => {
      if (a.savingsBytes && a.savingsBytes > 0) {
        const kb = Math.round(a.savingsBytes / 1024);
        return `<span class="impact-bytes">−${kb} KiB</span>`;
      }
      if (a.savingsMs && a.savingsMs > 0) {
        return `<span class="impact-ms">−${Math.round(a.savingsMs)} ms</span>`;
      }
      return `<span class="impact-none">${a.displayValue || '—'}</span>`;
    };

    const catMeta = {
      server:   { label: 'Server / Infrastruttura', icon: '🖥️' },
      immagini: { label: 'Immagini',                icon: '🖼️' },
      'js-css': { label: 'JavaScript / CSS',        icon: '⚙️' },
      html:     { label: 'HTML / Font',             icon: '📄' },
      altro:    { label: 'Altro',                   icon: '📋' },
    };

    const actionPlanSection = actionAudits.length > 0 ? `
      <div class="section">
        <div class="section-title">Piano d'azione</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Problema</th>
                <th>Area</th>
                <th>Responsabile</th>
                <th>Risparmio stimato</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              ${actionAudits.map((a, i) => `
              <tr>
                <td class="priority-num">${i + 1}</td>
                <td class="audit-title-cell">${a.title}</td>
                <td><span class="cat-pill cat-${a.category}">${catMeta[a.category]?.icon ?? ''} ${catMeta[a.category]?.label ?? a.category}</span></td>
                <td class="owner-cell">${this._getAuditOwner(a.category)}</td>
                <td>${impactLabel(a)}</td>
                <td><span class="badge ${this._scoreClass(a.score)}">${a.score}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : '';

    // ── Audit raggruppati per categoria ───────────────────────────────────────
    const auditSections = this.results.map((r, i) => {
      if (r.failedAudits.length === 0) {
        return `
        <div class="page-audits">
          ${n > 1 ? `<div class="page-url-label">Pagina ${i + 1}: ${r.url}</div>` : ''}
          <p class="no-issues">✅ Nessun audit fallito</p>
        </div>`;
      }

      // Raggruppa per categoria
      const groups = {};
      r.failedAudits.forEach(a => {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
      });

      const groupedHTML = Object.entries(catMeta)
        .filter(([key]) => groups[key]?.length > 0)
        .map(([key, meta]) => `
        <div class="audit-group">
          <div class="audit-group-header">
            <span class="audit-group-icon">${meta.icon}</span>
            <span>${meta.label}</span>
            <span class="audit-group-count">${groups[key].length}</span>
          </div>
          ${groups[key].map(a => `
          <div class="audit-item ${this._scoreClass(a.score)}">
            <div class="audit-header">
              <span class="audit-score ${this._scoreClass(a.score)}">${a.score}</span>
              <span class="audit-title">${a.title}</span>
              ${a.displayValue ? `<span class="audit-value">${a.displayValue}</span>` : ''}
            </div>
            ${a.description ? `<div class="audit-desc">${a.description}</div>` : ''}
          </div>`).join('')}
        </div>`).join('');

      return `
      <div class="page-audits">
        ${n > 1 ? `<div class="page-url-label">Pagina ${i + 1}: ${r.url}</div>` : ''}
        ${groupedHTML}
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lighthouse Report — ${domain}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #111827;
      background: #f0f2f5;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px;
    }

    /* Header */
    .header {
      background: #fff;
      border-top: 4px solid #1e3a5f;
      border-radius: 6px;
      padding: 32px 36px;
      margin-bottom: 24px;
      border: 1px solid #e5e7eb;
      border-top: 4px solid #1e3a5f;
    }

    .header-eyebrow {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 8px;
    }

    .header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
    }

    .header-meta {
      font-size: 0.875rem;
      color: #6b7280;
    }

    /* Section */
    .section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 28px 32px;
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #f3f4f6;
    }

    /* Score rings */
    .scores-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }

    .score-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .score-ring {
      width: 84px;
      height: 84px;
      border-radius: 50%;
      border: 7px solid;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.35rem;
      font-weight: 700;
    }

    .score-ring.high  { border-color: #16a34a; color: #16a34a; }
    .score-ring.medium { border-color: #d97706; color: #d97706; }
    .score-ring.low   { border-color: #dc2626; color: #dc2626; }

    .score-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
      text-align: center;
    }

    /* Metrics */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .metric-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
    }

    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: #111827;
      margin-bottom: 2px;
    }

    .metric-label {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #1e3a5f;
      margin-bottom: 2px;
    }

    .metric-desc {
      font-size: 0.75rem;
      color: #9ca3af;
    }

    /* Table */
    .table-wrap { overflow-x: auto; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th {
      background: #f9fafb;
      padding: 10px 14px;
      text-align: left;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid #f3f4f6;
      color: #374151;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }

    .url-cell {
      font-size: 0.8rem;
      word-break: break-all;
      color: #6b7280;
    }

    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .badge.high   { background: #dcfce7; color: #15803d; }
    .badge.medium { background: #fef9c3; color: #a16207; }
    .badge.low    { background: #fee2e2; color: #b91c1c; }

    /* Audits */
    .page-url-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 12px;
      word-break: break-all;
    }

    .audit-item {
      border: 1px solid #e5e7eb;
      border-left: 3px solid;
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 8px;
    }

    .audit-item.high   { border-left-color: #16a34a; }
    .audit-item.medium { border-left-color: #d97706; }
    .audit-item.low    { border-left-color: #dc2626; }

    .audit-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }

    .audit-score {
      min-width: 32px;
      text-align: center;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .audit-score.high   { background: #dcfce7; color: #15803d; }
    .audit-score.medium { background: #fef9c3; color: #a16207; }
    .audit-score.low    { background: #fee2e2; color: #b91c1c; }

    .audit-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #111827;
      flex: 1;
    }

    .audit-value {
      font-size: 0.8rem;
      color: #6b7280;
      white-space: nowrap;
    }

    .audit-desc {
      font-size: 0.8rem;
      color: #6b7280;
      padding-left: 42px;
    }

    .no-issues {
      color: #16a34a;
      font-weight: 600;
      font-size: 0.875rem;
    }

    /* Action plan */
    .priority-num {
      font-weight: 700;
      color: #9ca3af;
      font-size: 0.8rem;
      width: 28px;
    }

    .audit-title-cell {
      font-size: 0.875rem;
      font-weight: 500;
      color: #111827;
    }

    .owner-cell {
      font-size: 0.8rem;
      color: #6b7280;
      white-space: nowrap;
    }

    .cat-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .cat-server   { background: #eff6ff; color: #1d4ed8; }
    .cat-immagini { background: #f0fdf4; color: #15803d; }
    .cat-js-css   { background: #fefce8; color: #a16207; }
    .cat-html     { background: #fdf4ff; color: #7e22ce; }
    .cat-altro    { background: #f9fafb; color: #6b7280; }

    .impact-bytes { font-weight: 700; color: #dc2626; font-size: 0.8rem; }
    .impact-ms    { font-weight: 700; color: #d97706; font-size: 0.8rem; }
    .impact-none  { color: #9ca3af;   font-size: 0.8rem; }

    /* Audit groups */
    .audit-group {
      margin-bottom: 20px;
    }

    .audit-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #374151;
      padding: 8px 0;
      margin-bottom: 8px;
      border-bottom: 1px solid #f3f4f6;
    }

    .audit-group-icon { font-size: 1rem; }

    .audit-group-count {
      margin-left: auto;
      background: #f3f4f6;
      color: #6b7280;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 10px;
    }

    /* Footer */
    .footer {
      text-align: center;
      padding: 16px;
      font-size: 0.8rem;
      color: #9ca3af;
    }

    @media (max-width: 768px) {
      .scores-grid  { grid-template-columns: repeat(2, 1fr); }
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media print {
      body { background: #fff; }
      .container { padding: 0; }
      .section { box-shadow: none; }
    }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <div class="header-eyebrow">🔦 Lighthouse Report</div>
    <h1>${domain}</h1>
    <div class="header-meta">
      ${endTime.toLocaleDateString('it-IT')} alle ${endTime.toLocaleTimeString('it-IT')}
      &nbsp;·&nbsp; ${n} ${n === 1 ? 'pagina' : 'pagine'} analizzate
      &nbsp;·&nbsp; ${duration}s
    </div>
  </div>

  <div class="section">
    <div class="section-title">Punteggi ${n > 1 ? '(media)' : ''}</div>
    <div class="scores-grid">
      ${scoreRing(avgScores.performance,   'Performance')}
      ${scoreRing(avgScores.accessibility, 'Accessibility')}
      ${scoreRing(avgScores.seo,           'SEO')}
      ${scoreRing(avgScores.bestPractices, 'Best Practices')}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Core Web Vitals ${n > 1 ? '(prima pagina)' : ''}</div>
    <div class="metrics-grid">
      ${metricCard(firstMetrics.lcp,        'LCP',         'Largest Contentful Paint')}
      ${metricCard(firstMetrics.fcp,        'FCP',         'First Contentful Paint')}
      ${metricCard(firstMetrics.tbt,        'TBT',         'Total Blocking Time')}
      ${metricCard(firstMetrics.cls,        'CLS',         'Cumulative Layout Shift')}
      ${metricCard(firstMetrics.tti,        'TTI',         'Time to Interactive')}
      ${metricCard(firstMetrics.speedIndex, 'Speed Index', 'Indice di velocità')}
    </div>
  </div>

  ${pagesTable}

  ${actionPlanSection}

  <div class="section">
    <div class="section-title">Audit per categoria</div>
    ${auditSections}
  </div>

  <div class="footer">
    Report generato con Lighthouse Checker · Playwright + Google Lighthouse
  </div>

</div>
</body>
</html>`;
  }
}

module.exports = { LighthouseChecker };
