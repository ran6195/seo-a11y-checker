const { askVision, parseJSONResponse } = require('./lib/anthropic');

const CANDIDATE_SELECTOR = 'button, input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, [role="button"], [role="checkbox"], [role="switch"]';

// Stessa formula di contrasto usata da axe-core per il testo (WCAG relative luminance),
// applicata qui a bordi/sfondi degli elementi UI. axe-core NON calcola affatto il
// contrasto non testuale: nessuna regola è taggata wcag1411 (verificato sul pacchetto
// installato). Quando i colori sono opachi e risolvibili, il calcolo è deterministico
// e non serve alcun giudizio AI; l'AI entra in gioco solo sui casi non calcolabili
// (trasparenze, gradienti, sfondi a immagine).
const CONTRAST_SCRIPT = `
  function parseColor(str) {
    const m = (str || '').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }
  function relLuminance(c) {
    const [rs, gs, bs] = [c.r, c.g, c.b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  function contrastRatio(c1, c2) {
    const L1 = relLuminance(c1), L2 = relLuminance(c2);
    const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function findAncestorBg(el) {
    let node = el.parentElement;
    while (node) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.99) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  function hasReducedOpacity(el) {
    // CSS opacity (a differenza dell'alpha di background-color) compone l'INTERO
    // elemento con ciò che sta dietro: un elemento con opacity:0.7 e sfondo "opaco"
    // rgb(0,0,0) non è realmente nero in rendering, è nero mescolato al 70% con lo
    // sfondo sottostante. Trattarlo come colore puro produrrebbe un rapporto di
    // contrasto calcolato ma sbagliato — meglio dichiararlo non calcolabile.
    let node = el;
    while (node && node !== document.body.parentElement) {
      const op = parseFloat(getComputedStyle(node).opacity);
      if (!isNaN(op) && op < 0.99) return true;
      node = node.parentElement;
    }
    return false;
  }

  window.__a11yContrastCheck = function(el) {
    if (hasReducedOpacity(el)) {
      return { computable: false, basis: null, ratio: null };
    }
    const style = getComputedStyle(el);
    const borderColor = parseColor(style.borderTopColor);
    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    const hasOpaqueBorder = style.borderTopStyle !== 'none' && borderWidth > 0 && borderColor && borderColor.a > 0.99;
    const ownBg = parseColor(style.backgroundColor);
    const parentBg = findAncestorBg(el);

    if (hasOpaqueBorder) {
      return { computable: true, basis: 'bordo', ratio: contrastRatio(borderColor, parentBg) };
    }
    if (ownBg && ownBg.a > 0.99) {
      return { computable: true, basis: 'sfondo', ratio: contrastRatio(ownBg, parentBg) };
    }
    return { computable: false, basis: null, ratio: null };
  };
`;

module.exports = {
  id: '1.4.11',
  name: 'Contrasto non testuale',
  level: 'AA',
  description: 'I confini di controlli UI (bordi di campi, bottoni) e le icone significative devono avere un contrasto di almeno 3:1 rispetto ai colori adiacenti.',
  remediation: 'Scurisci/schiarisci il bordo o lo sfondo del controllo finché il rapporto di contrasto con l\'area circostante raggiunge almeno 3:1; non affidarti a un bordo troppo simile allo sfondo per delimitare campi o bottoni.',

  async run(ctx) {
    const { page, options } = ctx;

    // Passata via window.eval dentro una vera funzione: page.evaluate(stringa) tratta
    // il primo token della stringa come inizio di una singola espressione, e uno script
    // che comincia con "function" viene scambiato per una function expression isolata,
    // rompendosi sulla seconda dichiarazione di funzione (SyntaxError: Unexpected token
    // 'function'). Con window.eval() lo script gira come una sequenza di statement normale.
    await page.evaluate((src) => { window.eval(src); }, CONTRAST_SCRIPT);
    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-contrast-id', String(i)));
    }, CANDIDATE_SELECTOR);

    try {
      const results = await page.evaluate(() => {
        return window.__a11yDeepQuery('[data-a11y-contrast-id]').map(el => {
          const check = window.__a11yContrastCheck(el);
          const r = el.getBoundingClientRect();
          return {
            index: Number(el.getAttribute('data-a11y-contrast-id')),
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || el.value || '').trim().slice(0, 30),
            selector: `[data-a11y-contrast-id="${el.getAttribute('data-a11y-contrast-id')}"]`,
            computable: check.computable,
            basis: check.basis,
            ratio: check.ratio,
            box: {
              x: Math.max(0, Math.round(r.left - 6)),
              y: Math.max(0, Math.round(r.top - 6)),
              width: Math.round(r.width + 12),
              height: Math.round(r.height + 12)
            }
          };
        });
      });

      if (results.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun bottone/campo/widget trovato in pagina', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      // Calcolo deterministico: dove i colori sono opachi e risolvibili, il rapporto
      // di contrasto è matematico, non un'opinione. Un fallimento qui è già certo.
      const failComputed = results.filter(r => r.computable && r.ratio < 3);
      const uncomputable = results.filter(r => !r.computable);

      if (failComputed.length > 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: {
            ran: true,
            summary: `${failComputed.length}/${results.length} elementi con contrasto ${failComputed[0].basis} calcolato sotto 3:1`,
            issues: failComputed.map(f => ({ selector: f.selector, tag: f.tag, text: f.text, basis: f.basis, ratio: Math.round(f.ratio * 100) / 100 }))
          },
          ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
          notes: 'Rapporto di contrasto calcolato direttamente (stessa formula WCAG usata per il testo), non un giudizio AI: nessuna ambiguità da risolvere.'
        };
      }

      if (uncomputable.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${results.length} elementi controllati, contrasto calcolato sempre ≥ 3:1`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${uncomputable.length}/${results.length} elementi con colori non calcolabili (trasparenza/gradiente/sfondo a immagine)`,
            issues: uncomputable.map(u => ({ selector: u.selector, tag: u.tag, text: u.text }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio visivo su questi elementi.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = uncomputable.slice(0, limit);
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
          const prompt = `Questo è lo screenshot di un controllo dell'interfaccia (${item.tag}${item.text ? `, testo "${item.text}"` : ''}), ` +
            'con un margine di contesto attorno. Il confine del controllo (bordo, sfondo o icona) è chiaramente distinguibile ' +
            'rispetto all\'area circostante, con un contrasto sufficiente (criterio WCAG 1.4.11, soglia ~3:1)? ' +
            'Rispondi SOLO con un JSON: {"sufficiente": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "modifica proposta, o stringa vuota se già sufficiente"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...item,
            verdict: parsed?.sufficiente === false ? 'insufficiente' : (parsed?.sufficiente === true ? 'sufficiente' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...item, verdict: 'errore', reason: err.message });
        }
      }

      const insufficienti = findings.filter(f => f.verdict === 'insufficiente');

      return {
        id: this.id, name: this.name, level: this.level,
        status: insufficienti.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${uncomputable.length}/${results.length} elementi non calcolabili, ${toCheck.length} verificati con AI`,
          issues: uncomputable.map(u => ({ selector: u.selector, tag: u.tag, text: u.text }))
        },
        ai: { attempted: true, skippedReason: null, verdict: insufficienti.length > 0 ? 'fail' : 'pass', findings },
        notes: uncomputable.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-contrast-id]').forEach(el => el.removeAttribute('data-a11y-contrast-id'));
      }).catch(() => {});
    }
  }
};
