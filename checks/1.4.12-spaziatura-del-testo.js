const { askVision, parseJSONResponse } = require('./lib/anthropic');
const { getPaddedBox } = require('./lib/browser');

const TEXT_SELECTOR = 'p, span, a, button, li, label, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote';

// Valori minimi imposti dal criterio WCAG 1.4.12: se il contenuto si rompe (testo tagliato
// o sovrapposto) quando l'utente applica QUESTI valori con un foglio di stile personalizzato,
// è un fallimento — indipendentemente da quali valori il sito usi di default.
const SPACING_STYLE = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p {
    margin-bottom: 2em !important;
  }
`;

module.exports = {
  id: '1.4.12',
  name: 'Spaziatura del testo',
  level: 'AA',
  description: 'Nessuna perdita di contenuto o funzionalità deve verificarsi impostando: interlinea ad almeno 1,5 volte la dimensione del font, spazio dopo i paragrafi ad almeno 2 volte, spaziatura tra lettere ad almeno 0,12 volte, spaziatura tra parole ad almeno 0,16 volte.',
  remediation: 'Evita altezze fisse in px su contenitori di testo con overflow:hidden e imposta line-height in unità relative (non px fissi): il testo deve poter crescere in altezza/larghezza con la spaziatura personalizzata senza essere tagliato.',

  async run(ctx) {
    const { page, options } = ctx;

    const styleHandle = await page.addStyleTag({ content: SPACING_STYLE });
    await page.waitForTimeout(400);

    try {
      // Stesso segnale deterministico usato in 1.4.4 (scrollWidth/Height > area visibile
      // con overflow nascosto), applicato qui dopo aver forzato i valori minimi di
      // spaziatura invece dello zoom: il tipo di rottura è lo stesso (testo tagliato).
      const clipped = await page.evaluate((sel) => {
        return window.__a11yDeepQuery(sel)
          .filter(el => el.offsetParent !== null && (el.textContent || '').trim().length > 0)
          .map((el, i) => {
            const s = getComputedStyle(el);
            const hiddenX = (s.overflowX === 'hidden' || s.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2;
            const hiddenY = (s.overflowY === 'hidden' || s.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2;
            if (!hiddenX && !hiddenY) return null;
            el.setAttribute('data-a11y-spacing-id', String(i));
            const r = el.getBoundingClientRect();
            const pad = 16;
            return {
              index: i,
              selector: `[data-a11y-spacing-id="${i}"]`,
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
          automated: { ran: true, summary: 'Nessun elemento di testo risulta troncato applicando i valori minimi di spaziatura del criterio 1.4.12', issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: ''
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${clipped.length} elementi di testo risultano troncati applicando la spaziatura minima richiesta`,
            issues: clipped.map(c => ({ selector: c.selector, tag: c.tag, text: c.text, axis: c.axis }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per uno screenshot e un giudizio su ciascun troncamento.'
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

          const prompt = `Questo è lo screenshot di un elemento <${item.tag}> (testo atteso: "${item.text}") dopo aver applicato i valori ` +
            'minimi di spaziatura del testo richiesti dal criterio WCAG 1.4.12 (interlinea 1.5, spaziatura lettere/parole aumentata), con ' +
            'un margine di contesto attorno. Il testo risulta tagliato/troncato in modo che una parte sia illeggibile o inaccessibile, oppure ' +
            'si sovrappone visivamente ad altri elementi? Rispondi SOLO con un JSON: {"problema": true|false, ' +
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
        window.__a11yDeepQuery('[data-a11y-spacing-id]').forEach(el => el.removeAttribute('data-a11y-spacing-id'));
      }).catch(() => {});
      await styleHandle.evaluate(el => el.remove()).catch(() => {});
    }
  }
};
