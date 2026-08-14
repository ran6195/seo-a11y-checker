const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Campi con un vincolo di validazione riconoscibile (required/pattern/type/min/max).
// Escludiamo checkbox/radio/submit/button/reset/image: la logica di "valore non valido"
// qui sotto è pensata per campi testuali/numerici, non per controlli booleani o di azione.
const FIELD_SELECTOR = [
  'input[required]:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'input[pattern]', 'input[type="email"]', 'input[type="url"]', 'input[type="tel"]', 'input[type="number"]',
  'input[minlength]', 'input[maxlength]', 'input[min]', 'input[max]',
  'textarea[required]', 'textarea[pattern]', 'textarea[minlength]'
].join(', ');

module.exports = {
  id: '3.3.1',
  name: 'Identificazione dell\'errore',
  level: 'A',
  description: 'Se viene rilevato automaticamente un errore di input, l\'elemento in errore deve essere identificato e l\'errore descritto all\'utente in un testo.',
  remediation: 'Al momento della validazione imposta aria-invalid="true" sul campo e collega un messaggio di errore testuale via aria-describedby (o un role="alert"/aria-live), non solo un cambio di colore del bordo.',

  async run(ctx) {
    const { page, options } = ctx;

    // axe-core non ha alcuna regola per questo criterio (verificato: nessuna regola
    // taggata wcag331): serve interazione reale per osservare se un errore viene
    // comunicato. Qui usiamo SOLO blur/input — mai un submit reale — per restare
    // sicuri su siti live: non clicchiamo pulsanti di invio, non chiamiamo
    // form.submit()/requestSubmit(). Copre la validazione campo-per-campo (la più
    // comune), non quella che scatta solo al submit: limite noto, esplicitato in
    // automated.summary più sotto.
    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-err-id', String(i)));
    }, FIELD_SELECTOR);

    try {
      const fieldCount = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-err-id]').length);

      if (fieldCount === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun campo con vincoli di validazione (required/pattern/type/min/max) trovato', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const limit = options.limit || 5;
      const toTest = Math.min(fieldCount, limit);
      const tested = [];
      const findings = [];
      let aiCalls = 0;

      for (let i = 0; i < toTest; i++) {
        const selector = `[data-a11y-err-id="${i}"]`;

        const before = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          if (!el) return null;
          const root = el.getRootNode();
          function labelFor(el) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel.trim();
            if (el.id) {
              const l = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
              if (l) return l.textContent.trim();
            }
            const wrap = el.closest('label');
            return wrap ? wrap.textContent.trim() : '';
          }
          const describedby = el.getAttribute('aria-describedby');
          const describedText = describedby ? describedby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim() : '';
          const alerts = window.__a11yDeepQuery('[role="alert"], [aria-live]').map(a => (a.textContent || '').trim()).join('|');
          return {
            value: el.value,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || 'text',
            label: labelFor(el),
            ariaInvalid: el.getAttribute('aria-invalid'),
            describedText,
            alertsText: alerts,
            siblingText: (el.parentElement ? el.parentElement.textContent : '').trim()
          };
        }, selector);

        if (!before) continue;

        const invalidValue = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'email') return 'non-una-email';
          if (type === 'url') return 'non un url';
          if (type === 'tel') return 'abc';
          if (type === 'number') {
            const min = el.getAttribute('min');
            const max = el.getAttribute('max');
            if (min !== null && !isNaN(Number(min))) return String(Number(min) - 1);
            if (max !== null && !isNaN(Number(max))) return String(Number(max) + 1);
            return 'abc';
          }
          const minlength = el.getAttribute('minlength');
          if (minlength && Number(minlength) > 0) return 'x'.repeat(Math.max(0, Number(minlength) - 1));
          if (el.hasAttribute('pattern')) return '@@invalid@@';
          return '';
        }, selector);

        let filled = true;
        try {
          await page.fill(selector, invalidValue);
        } catch (e) {
          filled = false;
        }
        if (!filled) continue;

        await page.locator(selector).blur().catch(() => {});
        await page.waitForTimeout(400);

        const after = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          const root = el.getRootNode();
          const describedby = el.getAttribute('aria-describedby');
          const describedText = describedby ? describedby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim() : '';
          const alerts = window.__a11yDeepQuery('[role="alert"], [aria-live]').map(a => (a.textContent || '').trim()).join('|');
          const r = el.getBoundingClientRect();
          const pad = 12;
          return {
            ariaInvalid: el.getAttribute('aria-invalid'),
            describedText,
            alertsText: alerts,
            siblingText: (el.parentElement ? el.parentElement.textContent : '').trim(),
            box: {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2 + 60)
            }
          };
        }, selector);

        const becameInvalid = after.ariaInvalid === 'true';
        const hasDescribedText = Boolean(after.describedText);
        const alertsChanged = after.alertsText !== before.alertsText && after.alertsText.trim().length > 0;
        const siblingChanged = after.siblingText !== before.siblingText;

        const clearPass = (becameInvalid && hasDescribedText) || alertsChanged;
        const clearFail = !becameInvalid && !hasDescribedText && !alertsChanged && !siblingChanged;
        const ambiguous = !clearPass && !clearFail;

        const item = {
          index: i, selector, tag: before.tag, type: before.type, label: before.label,
          becameInvalid, hasDescribedText, alertsChanged, siblingChanged
        };

        // Screenshot solo per i casi ambigui (qualcosa è visivamente cambiato ma senza
        // associazione ARIA chiara), e solo se --ai è attivo: è l'unico caso in cui il
        // controllo automatico da solo non basta a decidere.
        if (ambiguous && options.ai && aiCalls < limit) {
          try {
            const screenshotBuffer = await page.screenshot({ clip: after.box }).catch(() => null);
            if (screenshotBuffer) {
              aiCalls++;
              const prompt = `Questo è lo screenshot di un campo form ("${before.label || before.tag}") dopo che vi è ` +
                'stato inserito un valore non valido e il campo ha perso il focus (blur), con un margine di contesto ' +
                'attorno. È presente un messaggio d\'errore chiaramente visibile e associato a questo campo (non un ' +
                'messaggio generico altrove)? Secondo il criterio WCAG 3.3.1, l\'errore è identificato in modo che un ' +
                'utente possa capire quale campo è sbagliato e perché? Se non lo è, suggerisci come comunicarlo ' +
                '(es. testo d\'errore da mostrare, associazione aria-describedby). Rispondi SOLO con un JSON: ' +
                '{"identificato": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
                '"suggerimento": "correzione proposta, o stringa vuota se già identificato"}';

              const response = await askVision({
                apiKey: options.apiKey,
                prompt,
                images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
              });
              const parsed = parseJSONResponse(response);
              item.aiVerdict = parsed?.identificato === false ? 'non identificato' : (parsed?.identificato === true ? 'identificato' : 'incerto');
              item.aiReason = parsed?.motivo || response.trim();
              item.aiSuggerimento = parsed?.suggerimento || '';
              findings.push({ ...item, verdict: item.aiVerdict, reason: item.aiReason, suggerimento: item.aiSuggerimento });
            }
          } catch (err) {
            item.aiVerdict = 'errore';
            item.aiReason = err.message;
          }
        }

        item.classification = clearPass ? 'pass' : (clearFail ? 'fail' : 'ambiguous');
        tested.push(item);

        // Ripristina il valore originale: riguarda solo questa scheda del browser
        // (throwaway, chiusa a fine run), non ha alcun effetto sul sito reale.
        await page.fill(selector, before.value).catch(() => {});
      }

      if (tested.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'error',
          automated: { ran: true, summary: 'Nessun campo testabile (riempimento fallito per tutti i candidati)', issues: [] },
          ai: { attempted: false, skippedReason: null, verdict: null, findings: [] },
          notes: ''
        };
      }

      const failItems = tested.filter(t => t.classification === 'fail');
      const ambiguousItems = tested.filter(t => t.classification === 'ambiguous');
      const passItems = tested.filter(t => t.classification === 'pass');

      const baseNote = `Verificato solo via blur/input su ${tested.length}/${fieldCount} campi con vincoli di ` +
        'validazione, mai via submit reale: un form che valida solo al momento dell\'invio potrebbe comunque gestire ' +
        'l\'errore correttamente in quel momento, non osservabile con questo approccio.';

      if (!options.ai && ambiguousItems.length > 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: failItems.length > 0 ? 'fail' : 'needs-review',
          automated: {
            ran: true,
            summary: `${failItems.length} campi senza alcuna segnalazione, ${ambiguousItems.length} con un cambiamento visivo ma senza associazione ARIA chiara, ${passItems.length} con errore accessibile confermato`,
            issues: [...failItems, ...ambiguousItems].map(t => ({ selector: t.selector, tag: t.tag, type: t.type, label: t.label }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: `${baseNote} Rilancia con --ai per un giudizio sui campi ambigui.`
        };
      }

      const nonIdentificati = findings.filter(f => f.verdict === 'non identificato');
      const overallFail = failItems.length > 0 || nonIdentificati.length > 0;

      return {
        id: this.id, name: this.name, level: this.level,
        status: overallFail ? 'fail' : (ambiguousItems.length > 0 && findings.length === 0 ? 'needs-review' : 'pass'),
        automated: {
          ran: true,
          summary: `${failItems.length} campi senza alcuna segnalazione, ${ambiguousItems.length} ambigui (${findings.length} verificati con AI), ${passItems.length} con errore accessibile confermato`,
          issues: failItems.map(t => ({ selector: t.selector, tag: t.tag, type: t.type, label: t.label }))
        },
        ai: { attempted: findings.length > 0, skippedReason: findings.length > 0 ? null : (options.ai ? 'no-candidates' : 'disabled'), verdict: nonIdentificati.length > 0 ? 'fail' : (findings.length > 0 ? 'pass' : null), findings },
        notes: baseNote
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-err-id]').forEach(el => el.removeAttribute('data-a11y-err-id'));
      }).catch(() => {});
    }
  }
};
