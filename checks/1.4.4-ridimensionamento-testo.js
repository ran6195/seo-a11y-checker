const { askVision, parseJSONResponse } = require('./lib/anthropic');
const { getPaddedBox } = require('./lib/browser');

const TEXT_SELECTOR = 'p, span, a, button, li, label, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote';

module.exports = {
  id: '1.4.4',
  name: 'Ridimensionamento del testo',
  level: 'AA',
  description: 'Il testo deve poter essere ingrandito fino al 200% senza perdita di contenuto o funzionalità, e senza richiedere lo scroll orizzontale per leggerlo (a parte contenuti che lo richiedono per natura).',
  remediation: 'Evita altezze/larghezze fisse in px su contenitori di testo con overflow:hidden; usa unità relative (em/rem/%) così il testo può crescere senza essere tagliato o sovrapporsi ad altri elementi.',

  async run(ctx) {
    const { page, options } = ctx;

    // CSS zoom (non standard ma supportato da Chromium/Blink) è il modo più affidabile per
    // simulare lo zoom nativo del browser via Playwright: ricalcola il layout come farebbe
    // uno zoom reale al 200%, cosa che un semplice viewport più piccolo non garantisce allo
    // stesso modo per ogni sito. Va sempre ripristinato a 1 prima di ritornare, perché lo
    // stesso browser/pagina viene riusato per i check successivi (checks/run-site.js).
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    await page.waitForTimeout(400);

    try {
      // Segnale deterministico di troncamento: un elemento di testo il cui contenuto reale
      // (scrollWidth/Height) supera lo spazio visibile (clientWidth/Height) mentre l'overflow
      // è nascosto — il testo è letteralmente tagliato, non solo "va a capo".
      const clipped = await page.evaluate((sel) => {
        return window.__a11yDeepQuery(sel)
          .filter(el => el.offsetParent !== null && (el.textContent || '').trim().length > 0)
          .map((el, i) => {
            const s = getComputedStyle(el);
            const hiddenX = (s.overflowX === 'hidden' || s.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2;
            const hiddenY = (s.overflowY === 'hidden' || s.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2;
            if (!hiddenX && !hiddenY) return null;
            el.setAttribute('data-a11y-resize-id', String(i));
            const r = el.getBoundingClientRect();
            const pad = 16;
            return {
              index: i,
              selector: `[data-a11y-resize-id="${i}"]`,
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 60),
              axis: hiddenX ? 'orizzontale' : 'verticale',
              box: {
                x: Math.max(0, Math.round(r.left - pad)),
                y: Math.max(0, Math.round(r.top - pad)),
                width: Math.round(r.width + pad * 2),
                height: Math.round(r.height + pad * 2)
              }
            };
          })
          .filter(Boolean);
      }, TEXT_SELECTOR);

      if (clipped.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: 'Nessun elemento di testo risulta troncato (scrollWidth/Height > area visibile con overflow nascosto) allo zoom del 200%', issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica solo il troncamento per overflow nascosto; sovrapposizioni tra elementi non correlate a un overflow di testo non sono rilevabili con questa euristica.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${clipped.length} elementi di testo risultano troncati (overflow nascosto) allo zoom del 200%`,
            issues: clipped.map(c => ({ selector: c.selector, tag: c.tag, text: c.text, axis: c.axis }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per uno screenshot e un giudizio su ciascun troncamento (contenuto perso vs. comportamento intenzionale tipo ellissi con testo comunque raggiungibile altrove).'
        };
      }

      const limit = options.limit || 5;
      const toCheck = clipped.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          // Il box era stato calcolato in blocco su tutti i candidati prima di sapere quali
          // sarebbero stati verificati con AI: va riscorso in vista e riletto ora, altrimenti
          // un elemento sotto la piega fa fallire lo screenshot.
          const freshBox = await getPaddedBox(page, item.selector, 16);
          if (!freshBox || freshBox.width <= 0 || freshBox.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }
          const screenshotBuffer = await page.screenshot({ clip: freshBox }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un elemento <${item.tag}> (testo atteso: "${item.text}") a zoom 200%, con un margine ` +
            `di contesto attorno. Il testo risulta tagliato/troncato in modo che una parte del contenuto sia illeggibile o inaccessibile ` +
            '(non solo andato a capo), oppure si sovrappone visivamente ad altri elementi? Secondo il criterio WCAG 1.4.4, questo costituisce ' +
            'una perdita di contenuto o funzionalità con lo zoom? Rispondi SOLO con un JSON: {"problema": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "modifica CSS proposta, o stringa vuota se non è un problema"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, text: item.text, axis: item.axis,
            verdict: parsed?.problema === true ? 'problema confermato' : (parsed?.problema === false ? 'nessun problema' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, verdict: 'errore', reason: err.message });
        }
      }

      const problemi = findings.filter(f => f.verdict === 'problema confermato');

      return {
        id: this.id, name: this.name, level: this.level,
        status: problemi.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${clipped.length} elementi troncati rilevati, ${toCheck.length} verificati con AI`,
          issues: clipped.map(c => ({ selector: c.selector, tag: c.tag, text: c.text, axis: c.axis }))
        },
        ai: { attempted: true, skippedReason: null, verdict: problemi.length > 0 ? 'fail' : 'pass', findings },
        notes: clipped.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
        window.__a11yDeepQuery('[data-a11y-resize-id]').forEach(el => el.removeAttribute('data-a11y-resize-id'));
      }).catch(() => {});
    }
  }
};
