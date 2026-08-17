const { askVision, parseJSONResponse } = require('./lib/anthropic');

const AXE_RULES = ['label', 'aria-input-field-name', 'select-name'];
const GENERIC_NAME_RE = /^(campo|input|field|text|valore|value|dato|dati)\s*\d*$/i;
const REQUIRED_HINT_RE = /(obbligator|richiest|required|\*)/i;
const FIELD_SELECTOR = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';

module.exports = {
  id: '3.3.2',
  name: 'Etichette o istruzioni',
  level: 'A',
  description: 'Quando un contenuto richiede input dall\'utente, devono essere fornite etichette o istruzioni chiare.',
  remediation: 'Usa etichette descrittive (non "Campo 1"); per i campi obbligatori aggiungi un\'indicazione testuale accessibile, non solo un asterisco visivo (es. testo nascosto via CSS ma letto dallo screen reader, o aria-describedby verso un\'istruzione).',
  aiCapable: true,

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // 1) axe-core copre già l'assenza totale di un nome accessibile sui campi form.
    //    Se fallisce qui, è già un fallimento certo: l'AI non aggiungerebbe valore.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} campi form senza nome accessibile (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // 2) axe non giudica la QUALITÀ dell'etichetta né se l'obbligatorietà è comunicata
    //    in modo accessibile (spesso solo un asterisco visivo, invisibile a uno screen
    //    reader se non associato via testo/aria-describedby). Euristica gratuita prima.
    // offsetParent === null esclude elementi non renderizzati (display:none o dentro un
    // antenato display:none) — stesso filtro già usato in a11y-checker.js. Senza, campi
    // tecnici nascosti (es. la textarea interna di Google reCAPTCHA) diventano falsi positivi:
    // axe-core li ignora correttamente perché non visibili, un querySelectorAll grezzo no.
    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-field-id', String(i)));
    }, FIELD_SELECTOR);

    try {
      const fields = await page.evaluate(() => {
        // document.getElementById/querySelector cercano solo nel documento principale.
        // Se il campo è dentro uno shadow root (form builder/web component), la sua label
        // referenziata via id vive nello STESSO shadow root, non nel documento globale:
        // serve risolvere a partire da el.getRootNode(), che torna lo shadow root corretto
        // (o il document stesso se l'elemento non è in uno shadow tree).
        function accessibleName(el) {
          const root = el.getRootNode();
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
          const labelledby = el.getAttribute('aria-labelledby');
          if (labelledby) {
            const text = labelledby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
            if (text) return text;
          }
          if (el.id) {
            const label = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
            if (label && label.textContent.trim()) return label.textContent.trim();
          }
          const wrap = el.closest('label');
          if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
          return '';
        }
        function describedText(el) {
          const describedby = el.getAttribute('aria-describedby');
          if (!describedby) return '';
          const root = el.getRootNode();
          return describedby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
        }

        return window.__a11yDeepQuery('[data-a11y-field-id]').map(el => ({
          index: Number(el.getAttribute('data-a11y-field-id')),
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || (el.tagName.toLowerCase() === 'select' ? 'select' : 'text'),
          name: accessibleName(el),
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
          describedText: describedText(el),
          title: el.getAttribute('title') || '',
          selector: `[data-a11y-field-id="${el.getAttribute('data-a11y-field-id')}"]`
        }));
      });

      const candidates = fields.filter(f => {
        const nameGeneric = GENERIC_NAME_RE.test(f.name.trim()) || f.name.trim().length <= 1;
        const missingRequiredHint = f.required && !REQUIRED_HINT_RE.test(`${f.name} ${f.describedText} ${f.title}`);
        return nameGeneric || missingRequiredHint;
      });

      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: fields.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${fields.length} campi con etichetta, nessun pattern sospetto rilevato`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica copre solo etichette generiche e campi obbligatori senza indicazione accessibile: non garantisce che ogni etichetta sia davvero chiara.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: `${candidates.length}/${fields.length} campi con etichetta generica o obbligatorietà non indicata`, issues: candidates },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio sulla chiarezza di etichette/istruzioni di questi campi.'
        };
      }

      // 3) Fallback AI, solo testuale.
      const limit = options.limit || 5;
      const toCheck = candidates.slice(0, limit);
      const findings = [];

      for (const field of toCheck) {
        try {
          const prompt = `Un campo di tipo "${field.tag}${field.type ? '/' + field.type : ''}" ha come etichetta/nome ` +
            `accessibile: "${field.name || '(vuoto)'}"${field.required ? ', ed è obbligatorio' : ''}. Istruzioni aggiuntive ` +
            `associate: "${field.describedText || '(nessuna)'}". Secondo il criterio WCAG 3.3.2, l'etichetta è ` +
            'sufficientemente chiara da far capire cosa inserire, e se il campo è obbligatorio questo viene comunicato ' +
            'in modo accessibile (non solo un asterisco visivo isolato)? Se non lo è, proponi una correzione concreta. ' +
            'Rispondi SOLO con un JSON: {"chiaro": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "correzione proposta, o stringa vuota se già chiaro"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...field,
            verdict: parsed?.chiaro === false ? 'non chiaro' : (parsed?.chiaro === true ? 'chiaro' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...field, verdict: 'errore', reason: err.message });
        }
      }

      const nonChiari = findings.filter(f => f.verdict === 'non chiaro');

      return {
        id: this.id, name: this.name, level: this.level,
        status: nonChiari.length > 0 ? 'fail' : 'pass',
        automated: { ran: true, summary: `${candidates.length}/${fields.length} candidati da euristica, ${toCheck.length} verificati con AI`, issues: candidates },
        ai: { attempted: true, skippedReason: null, verdict: nonChiari.length > 0 ? 'fail' : 'pass', findings },
        notes: candidates.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-field-id]').forEach(el => el.removeAttribute('data-a11y-field-id'));
      }).catch(() => {});
    }
  }
};
