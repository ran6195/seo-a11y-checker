const { askVision, parseJSONResponse } = require('./lib/anthropic');
const { getPaddedBox } = require('./lib/browser');

// Nessuna regola axe-core rileva "testo dentro un'immagine": è per definizione un
// riconoscimento visivo. L'euristica qui si limita a candidare le immagini più probabili
// (dimensioni non da icona, alt non vuoto e composto da più parole — tipico di banner/slogan
// renderizzati come immagine anziché testo vero) e lascia il riconoscimento del testo e la
// verifica delle eccezioni (loghi, presentazione essenziale) all'AI.
const CTA_HINT_RE = /scopri|offerta|sconto|scarica|richiedi|contattaci|acquista|iscriviti|leggi|preventivo|promo/i;

module.exports = {
  id: '1.4.5',
  name: 'Immagini di testo',
  level: 'AA',
  description: 'Se la stessa presentazione visiva può essere ottenuta con testo vero, un\'immagine non deve essere usata per presentare del testo (eccetto loghi o quando la particolare resa è essenziale all\'informazione).',
  remediation: 'Sostituisci l\'immagine con testo HTML reale formattato via CSS (font, colore, dimensione); mantieni l\'immagine solo se è un logo o se la resa visiva specifica è essa stessa l\'informazione da comunicare.',
  aiCapable: true,

  async run(ctx) {
    const { page, options } = ctx;

    const candidates = await page.evaluate(() => {
      return window.__a11yDeepQuery('img')
        .filter(el => el.offsetParent !== null)
        .map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            index: i, el, alt: (el.getAttribute('alt') || '').trim(),
            src: (el.getAttribute('src') || '').split('/').pop() || '',
            width: r.width, height: r.height
          };
        })
        // Scarta icone/spaziatori (troppo piccoli per contenere testo leggibile) e immagini
        // esplicitamente decorative (alt="").
        .filter(c => c.width >= 40 && c.height >= 20 && c.alt.length > 0)
        .map((c, i) => {
          c.el.setAttribute('data-a11y-imgtext-id', String(i));
          const r = c.el.getBoundingClientRect();
          const pad = 6;
          return {
            index: i,
            selector: `[data-a11y-imgtext-id="${i}"]`,
            alt: c.alt,
            src: c.src,
            wordCount: c.alt.split(/\s+/).filter(Boolean).length,
            box: {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2)
            }
          };
        });
    });

    try {
      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessuna immagine di dimensioni significative con alt non vuoto trovata', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const suspects = candidates.filter(c => c.wordCount >= 3 || CTA_HINT_RE.test(c.alt) || CTA_HINT_RE.test(c.src));

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${candidates.length} immagini controllate, nessuna con alt/nome file che suggerisca testo renderizzato (frase lunga o parole tipiche di banner/slogan)`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Euristica basata solo su alt/nome file: non riconosce testo renderizzato in immagini con alt breve o generico.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${suspects.length}/${candidates.length} immagini con alt/nome file che suggeriscono possibile testo renderizzato`,
            issues: suspects.map(s => ({ selector: s.selector, alt: s.alt, src: s.src }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un riconoscimento visivo del testo e una verifica delle eccezioni (logo, presentazione essenziale).'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          // Il box era stato calcolato in blocco su tutti i candidati prima di sapere quali
          // sarebbero stati verificati con AI: va riscorso in vista e riletto ora, altrimenti
          // un elemento sotto la piega fa fallire lo screenshot.
          const freshBox = await getPaddedBox(page, item.selector, 6);
          if (!freshBox || freshBox.width <= 0 || freshBox.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }
          const screenshotBuffer = await page.screenshot({ clip: freshBox }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un'immagine con testo alternativo "${item.alt}". L'immagine contiene testo renderizzato ` +
            'graficamente (parole leggibili disegnate/renderizzate nell\'immagine stessa, non sovrimpresse da HTML)? Se sì, si tratta di un ' +
            'logo aziendale/logotipo (ammesso dal criterio WCAG 1.4.5), o di una resa visiva essenziale all\'informazione stessa (es. uno ' +
            'screenshot di codice, una mappa con etichette)? Se non rientra in queste eccezioni, lo stesso testo potrebbe essere realizzato ' +
            'con HTML/CSS reale invece che come immagine. Rispondi SOLO con un JSON: {"contiene_testo": true|false, ' +
            '"eccezione": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "cosa fare, o stringa vuota se non è un problema"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          const containsText = parsed?.contiene_testo === true;
          const isException = parsed?.eccezione === true;

          findings.push({
            selector: item.selector, alt: item.alt, src: item.src,
            verdict: containsText && !isException ? 'testo in immagine' : (containsText && isException ? 'eccezione ammessa' : 'nessun testo'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, alt: item.alt, verdict: 'errore', reason: err.message });
        }
      }

      const testoInImmagine = findings.filter(f => f.verdict === 'testo in immagine');

      return {
        id: this.id, name: this.name, level: this.level,
        status: testoInImmagine.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length}/${candidates.length} candidati da euristica, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, alt: s.alt, src: s.src }))
        },
        ai: { attempted: true, skippedReason: null, verdict: testoInImmagine.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-imgtext-id]').forEach(el => el.removeAttribute('data-a11y-imgtext-id'));
      }).catch(() => {});
    }
  }
};
