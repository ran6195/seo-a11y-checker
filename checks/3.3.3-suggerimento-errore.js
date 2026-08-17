const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Stessi campi e stessa interazione (blur su valore invalido, mai submit) di
// checks/3.3.1-identificazione-errore.js: 3.3.3 non chiede "l'errore è identificato?"
// (quello è 3.3.1) ma "il messaggio include anche un suggerimento utile per correggerlo?".
const FIELD_SELECTOR = [
  'input[required]:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'input[pattern]', 'input[type="email"]', 'input[type="url"]', 'input[type="tel"]', 'input[type="number"]',
  'input[minlength]', 'input[maxlength]', 'input[min]', 'input[max]',
  'textarea[required]', 'textarea[pattern]', 'textarea[minlength]'
].join(', ');

const GENERIC_ONLY_RE = /^(campo\s*(non\s*)?valido|valore\s*non\s*valido|obbligatorio|required|invalid(o)?|errore|questo\s*campo\s*è\s*obbligatorio|this\s*field\s*is\s*required)\.?$/i;

module.exports = {
  id: '3.3.3',
  name: 'Suggerimento in caso di errore',
  level: 'AA',
  description: 'Se viene rilevato automaticamente un errore di input e sono noti suggerimenti per la correzione, questi devono essere forniti all\'utente, a meno che non comprometta la sicurezza o lo scopo del contenuto.',
  remediation: 'Non limitarti a segnalare che un campo è "non valido": indica il formato atteso o un esempio concreto (es. "Inserisci un\'email nel formato nome@dominio.it") o il vincolo mancante (es. "Deve contenere almeno 8 caratteri").',
  aiCapable: true,
  wcagVersion: '2.1',

  async run(ctx) {
    const { page, options } = ctx;

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-sugg-id', String(i)));
    }, FIELD_SELECTOR);

    try {
      const fieldCount = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-sugg-id]').length);

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
      const withError = [];
      let noErrorCount = 0;

      for (let i = 0; i < toTest; i++) {
        const selector = `[data-a11y-sugg-id="${i}"]`;

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
            constraint: el.hasAttribute('pattern') ? 'pattern' : (el.getAttribute('type') || (el.hasAttribute('minlength') ? 'minlength' : 'required')),
            label: labelFor(el),
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

        // Ripristina subito il valore originale: riguarda solo questa scheda del browser
        // (throwaway, chiusa a fine run), nessun effetto sul sito reale.
        await page.fill(selector, before.value).catch(() => {});

        const alertsChanged = after.alertsText !== before.alertsText && after.alertsText.trim().length > 0;
        const siblingChanged = after.siblingText !== before.siblingText && after.siblingText.trim().length > before.siblingText.trim().length;

        // L'errore va giudicato solo se ne esiste uno effettivamente identificato: se non
        // c'è alcun segnale (né aria-describedby, né live region, né testo aggiunto), questo
        // criterio non si applica — il problema, semmai, è di 3.3.1, non di questo.
        let errorText = after.describedText || '';
        if (!errorText && alertsChanged) errorText = after.alertsText.split('|').filter(Boolean).pop() || '';
        if (!errorText && siblingChanged) errorText = after.siblingText.slice(0, 200);

        if (!errorText.trim()) {
          noErrorCount++;
          continue;
        }

        withError.push({
          index: i, selector, tag: before.tag, type: before.type, constraint: before.constraint,
          label: before.label, invalidValue, errorText: errorText.trim(), box: after.box
        });
      }

      if (withError.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: `${noErrorCount}/${toTest} campi testati non identificano alcun errore dopo blur su valore non valido: 3.3.3 richiede un errore già identificato per potersi applicare`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Se ti aspettavi un errore identificato qui, verifica il criterio 3.3.1 (identificazione dell\'errore): questo criterio giudica solo la qualità del suggerimento, non la sua presenza.'
        };
      }

      const genericOnly = withError.filter(w => GENERIC_ONLY_RE.test(w.errorText));
      const toJudge = withError.filter(w => !GENERIC_ONLY_RE.test(w.errorText));

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${withError.length} campi con un errore identificato (su ${toTest} testati), ${genericOnly.length} con un messaggio genericissimo senza alcun indizio di formato`,
            issues: withError.map(w => ({ selector: w.selector, tag: w.tag, label: w.label, errorText: w.errorText }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su ciascun messaggio: se identifica solo l\'errore o include anche un suggerimento utile per correggerlo.'
        };
      }

      const limitAi = options.limit || 5;
      const toCheck = withError.slice(0, limitAi);
      const findings = [];

      for (const item of toCheck) {
        try {
          const screenshotBuffer = item.box.width > 0 && item.box.height > 0 ? await page.screenshot({ clip: item.box }).catch(() => null) : null;

          const prompt = `Un campo form ("${item.label || item.tag}", vincolo: ${item.constraint}) ha ricevuto il valore non valido ` +
            `"${item.invalidValue}" ed è stato rilevato questo messaggio d'errore: "${item.errorText}". Secondo il criterio WCAG 3.3.3, ` +
            'quando un errore viene rilevato automaticamente, se sono noti dei suggerimenti per correggerlo questi devono essere forniti ' +
            '(a meno che comprometta sicurezza/scopo). Questo messaggio si limita a identificare che c\'è un errore, oppure include anche ' +
            'un suggerimento utile per correggerlo (es. il formato atteso, un esempio, il vincolo mancante)? Rispondi SOLO con un JSON: ' +
            '{"ha_suggerimento": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "testo di errore migliorato proposto, o stringa vuota se già adeguato"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: screenshotBuffer ? [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }] : []
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, label: item.label, errorText: item.errorText,
            verdict: parsed?.ha_suggerimento === false ? 'solo identificazione' : (parsed?.ha_suggerimento === true ? 'con suggerimento' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, label: item.label, errorText: item.errorText, verdict: 'errore', reason: err.message });
        }
      }

      const soloIdentificazione = findings.filter(f => f.verdict === 'solo identificazione');

      return {
        id: this.id, name: this.name, level: this.level,
        status: soloIdentificazione.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${withError.length} campi con errore identificato, ${toCheck.length} verificati con AI per la qualità del suggerimento`,
          issues: withError.map(w => ({ selector: w.selector, tag: w.tag, label: w.label, errorText: w.errorText }))
        },
        ai: { attempted: true, skippedReason: null, verdict: soloIdentificazione.length > 0 ? 'fail' : 'pass', findings },
        notes: withError.length > toCheck.length ? `Solo i primi ${limitAi} campi con errore sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-sugg-id]').forEach(el => el.removeAttribute('data-a11y-sugg-id'));
      }).catch(() => {});
    }
  }
};
