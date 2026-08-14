const { askVision, parseJSONResponse } = require('./lib/anthropic');

const LABELED_SELECTOR = 'button, a[href], input[type="submit"], input[type="button"], input[type="reset"], [role="button"], [role="link"], [role="menuitem"], [role="tab"]';

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  id: '2.5.3',
  name: 'Etichetta nel nome',
  level: 'A',
  description: 'Per i componenti dell\'interfaccia con un\'etichetta testuale visibile, il nome accessibile deve includere il testo visibile: necessario per chi usa il comando vocale, che si aspetta di poter attivare il controllo pronunciando esattamente ciò che vede scritto.',
  remediation: 'Se aggiungi un aria-label a un controllo che ha già un testo visibile, fai in modo che includa (anche solo come prefisso) lo stesso testo visibile: es. testo visibile "Cerca" → aria-label="Cerca prodotti", non aria-label="Invia ricerca".',

  // Confronto testo visibile vs nome accessibile: quando i due divergono del tutto è un
  // fallimento verificabile solo leggendo il DOM (nessun giudizio visivo necessario, come
  // per 3.1.1/4.1.2 nel caso di fallimento certo di axe). L'AI entra in gioco solo per i
  // casi limite in cui c'è una sovrapposizione parziale ma non una vera e propria inclusione
  // (es. icone o testo decorativo che alterano lievemente il confronto testuale).
  async run(ctx) {
    const { page, options } = ctx;

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-labelname-id', String(i)));
    }, LABELED_SELECTOR);

    try {
      const items = await page.evaluate(() => {
        function accessibleName(el) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.trim()) return { name: ariaLabel.trim(), source: 'aria-label' };
          const labelledby = el.getAttribute('aria-labelledby');
          if (labelledby) {
            const root = el.getRootNode();
            const text = labelledby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
            if (text) return { name: text, source: 'aria-labelledby' };
          }
          return { name: '', source: 'none' };
        }
        return window.__a11yDeepQuery('[data-a11y-labelname-id]').map(el => {
          const visibleText = (el.tagName.toLowerCase() === 'input' ? el.value : el.textContent) || '';
          const acc = accessibleName(el);
          return {
            index: Number(el.getAttribute('data-a11y-labelname-id')),
            selector: `[data-a11y-labelname-id="${el.getAttribute('data-a11y-labelname-id')}"]`,
            tag: el.tagName.toLowerCase(),
            visibleText: visibleText.trim(),
            accessibleName: acc.name,
            overridden: acc.source !== 'none'
          };
        });
      });

      // Un nome accessibile viene "sovrascritto" solo se c'è un aria-label/aria-labelledby
      // esplicito: senza, il nome accessibile di default COINCIDE col testo visibile (nessun
      // divario possibile), quindi quei controlli sono automaticamente conformi.
      const candidates = items.filter(it => it.overridden && it.visibleText.length > 0);

      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: items.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${items.length} controlli con testo visibile controllati, nessuno ha un nome accessibile sovrascritto via aria-label/aria-labelledby`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Senza aria-label/aria-labelledby il nome accessibile coincide sempre col testo visibile: nessun divario possibile.'
        };
      }

      const failed = [];
      const ambiguous = [];
      const passed = [];

      candidates.forEach(it => {
        const normVisible = normalize(it.visibleText);
        const normAccessible = normalize(it.accessibleName);
        if (!normVisible || normAccessible.includes(normVisible)) {
          passed.push(it);
          return;
        }
        const visibleWords = normVisible.split(' ').filter(Boolean);
        const accessibleWords = new Set(normAccessible.split(' ').filter(Boolean));
        const overlap = visibleWords.filter(w => accessibleWords.has(w)).length;
        if (overlap === 0) {
          failed.push(it); // nessuna parola in comune: divergenza certa, nessun bisogno di AI
        } else {
          ambiguous.push(it); // sovrapposizione parziale: caso limite
        }
      });

      if (ambiguous.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: failed.length > 0 ? 'fail' : 'pass',
          automated: {
            ran: true,
            summary: `${candidates.length} controlli con nome accessibile sovrascritto: ${failed.length} senza alcuna parola del testo visibile in comune, ${passed.length} conformi`,
            issues: failed.map(f => ({ selector: f.selector, tag: f.tag, visibleText: f.visibleText, accessibleName: f.accessibleName }))
          },
          ai: { attempted: false, skippedReason: failed.length > 0 ? 'automated-fail' : 'not-needed', verdict: null, findings: [] },
          notes: 'Confronto testuale deterministico: nessuna sovrapposizione parziale da giudicare in questo caso.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: failed.length > 0 ? 'fail' : 'needs-review',
          automated: {
            ran: true,
            summary: `${failed.length} divergenze certe, ${ambiguous.length} casi con sovrapposizione parziale da verificare, ${passed.length} conformi`,
            issues: [...failed, ...ambiguous].map(f => ({ selector: f.selector, tag: f.tag, visibleText: f.visibleText, accessibleName: f.accessibleName }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio sui casi con sovrapposizione parziale (testo visibile parzialmente presente nel nome accessibile).'
        };
      }

      const limit = options.limit || 5;
      const toCheck = ambiguous.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          const prompt = `Un controllo dell'interfaccia (${item.tag}) ha testo visibile "${item.visibleText}" ma nome accessibile ` +
            `"${item.accessibleName}" (quello annunciato dagli screen reader e usato dal comando vocale). Le due stringhe si sovrappongono ` +
            'solo parzialmente. Secondo il criterio WCAG 2.5.3, un utente che pronuncia il testo visibile con un comando vocale riuscirebbe ' +
            'comunque ad attivare questo controllo (perché il nome accessibile include comunque il testo visibile in una forma riconoscibile)? ' +
            'Rispondi SOLO con un JSON: {"conforme": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "nome accessibile corretto proposto, o stringa vuota se già conforme"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, visibleText: item.visibleText, accessibleName: item.accessibleName,
            verdict: parsed?.conforme === false ? 'non conforme' : (parsed?.conforme === true ? 'conforme' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, verdict: 'errore', reason: err.message });
        }
      }

      const nonConformi = findings.filter(f => f.verdict === 'non conforme');
      const overallFail = failed.length > 0 || nonConformi.length > 0;

      return {
        id: this.id, name: this.name, level: this.level,
        status: overallFail ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${failed.length} divergenze certe, ${ambiguous.length} casi ambigui (${toCheck.length} verificati con AI), ${passed.length} conformi`,
          issues: failed.map(f => ({ selector: f.selector, tag: f.tag, visibleText: f.visibleText, accessibleName: f.accessibleName }))
        },
        ai: { attempted: true, skippedReason: null, verdict: nonConformi.length > 0 ? 'fail' : 'pass', findings },
        notes: ambiguous.length > toCheck.length ? `Solo i primi ${limit} casi ambigui sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-labelname-id]').forEach(el => el.removeAttribute('data-a11y-labelname-id'));
      }).catch(() => {});
    }
  }
};
