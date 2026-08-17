const { askVision, parseJSONResponse } = require('./lib/anthropic');

const CANDIDATE_SELECTOR = 'div, section, article, aside, nav, header, footer, table, pre, ul, ol, form, figure, img, video, iframe, svg, canvas';
// Contenuti per cui le WCAG stesse ammettono uno scroll bidimensionale (tabelle dati,
// codice, media, grafica vettoriale): esclusi a priori dai sospetti.
const EXEMPT_TAGS = new Set(['table', 'pre', 'code', 'svg', 'canvas', 'video', 'iframe']);

module.exports = {
  id: '1.4.10',
  name: 'Reflow',
  level: 'AA',
  description: 'Il contenuto deve essere presentabile senza richiedere lo scroll in due dimensioni: a 320 CSS px di larghezza (equivalente a 1280px con zoom 400%) non deve servire lo scroll orizzontale, salvo per contenuti che richiedono per natura una disposizione bidimensionale (tabelle dati, mappe, diagrammi, video).',
  remediation: 'Usa layout responsive (max-width:100%, flex/grid che vanno a capo, unità relative) invece di larghezze fisse in px; per le tabelle dati valuta uno scroll orizzontale contenuto al solo blocco tabella, non all\'intera pagina.',
  aiCapable: true,
  wcagVersion: '2.1',

  async run(ctx) {
    const { page, options } = ctx;

    const originalViewport = page.viewportSize();

    try {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.waitForTimeout(400);

      const pageOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
      });

      if (!pageOverflow) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: 'A 320 CSS px di larghezza la pagina non richiede alcuno scroll orizzontale', issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: ''
        };
      }

      // La pagina nel complesso eccede la larghezza: isoliamo gli elementi "colpevoli" (più
      // larghi del viewport), scartando i discendenti di un colpevole già trovato (evita di
      // segnalare a cascata decine di elementi annidati nello stesso contenitore troppo largo).
      const culprits = await page.evaluate((sel) => {
        const clientWidth = document.documentElement.clientWidth;
        return window.__a11yDeepQuery(sel)
          .filter(el => el.offsetParent !== null)
          .filter(el => el.getBoundingClientRect().width > clientWidth + 2)
          .filter(el => !el.parentElement || !el.parentElement.closest('[data-a11y-reflow-id]'))
          .map((el, i) => {
            el.setAttribute('data-a11y-reflow-id', String(i));
            const r = el.getBoundingClientRect();
            return {
              index: i,
              selector: `[data-a11y-reflow-id="${i}"]`,
              tag: el.tagName.toLowerCase(),
              width: Math.round(r.width),
              box: {
                x: 0,
                y: Math.max(0, Math.round(r.top)),
                width: Math.min(Math.round(r.width) + 20, 1200),
                height: Math.min(Math.round(r.height) + 20, 1000)
              }
            };
          });
      }, CANDIDATE_SELECTOR);

      const suspects = culprits.filter(c => !EXEMPT_TAGS.has(c.tag));
      const exempted = culprits.filter(c => EXEMPT_TAGS.has(c.tag));

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: exempted.length > 0 ? 'pass' : 'needs-review',
          automated: {
            ran: true,
            summary: exempted.length > 0
              ? `Scroll orizzontale presente, ma causato solo da contenuti esentati dalle WCAG (${[...new Set(exempted.map(e => e.tag))].join(', ')})`
              : 'Scroll orizzontale rilevato a livello di pagina, ma nessun elemento colpevole isolabile con questa euristica',
            issues: exempted.map(e => ({ selector: e.selector, tag: e.tag, width: e.width }))
          },
          ai: { attempted: false, skippedReason: exempted.length > 0 ? 'not-needed' : 'no-candidates', verdict: null, findings: [] },
          notes: exempted.length > 0 ? 'Tabelle dati, codice e contenuti multimediali possono legittimamente richiedere uno scroll bidimensionale.' : 'Verifica manuale consigliata: possibile overflow causato da margini/padding negativi o da elementi fuori dal set di selettori controllati.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${suspects.length} elementi più larghi del viewport a 320px, non riconducibili a contenuti esentati (${suspects.map(s => s.tag).join(', ')})`,
            issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, width: s.width }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su ciascun elemento: contenuto che richiede per natura una disposizione bidimensionale, oppure bug di layout non responsive.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          if (item.box.width <= 0 || item.box.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }
          const screenshotBuffer = await page.screenshot({ clip: item.box }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un elemento <${item.tag}> (largo ${item.width}px) su una pagina ridotta a 320px di ` +
            'larghezza (test di reflow WCAG 1.4.10), che costringe la pagina a uno scroll orizzontale. Il contenuto di questo elemento ' +
            'richiede per sua natura una disposizione bidimensionale per essere usabile (es. una mappa, un diagramma, un\'immagine dove i ' +
            'dettagli contano), oppure sembra un problema di layout non responsive che dovrebbe invece andare a capo/restringersi? ' +
            'Rispondi SOLO con un JSON: {"richiede_2d": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "modifica CSS proposta, o stringa vuota se il 2D è legittimo"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, width: item.width,
            verdict: parsed?.richiede_2d === true ? 'contenuto 2D legittimo' : (parsed?.richiede_2d === false ? 'bug di layout' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, verdict: 'errore', reason: err.message });
        }
      }

      const bug = findings.filter(f => f.verdict === 'bug di layout');

      return {
        id: this.id, name: this.name, level: this.level,
        status: bug.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length} elementi sospetti, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, width: s.width }))
        },
        ai: { attempted: true, skippedReason: null, verdict: bug.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-reflow-id]').forEach(el => el.removeAttribute('data-a11y-reflow-id'));
      }).catch(() => {});
      if (originalViewport) {
        await page.setViewportSize(originalViewport).catch(() => {});
      }
    }
  }
};
