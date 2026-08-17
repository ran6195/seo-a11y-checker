const { askVision, parseJSONResponse } = require('./lib/anthropic');

const AXE_RULES = ['autocomplete-valid'];

// Euristica gratuita: riconosce lo scopo più probabile di un campo dal suo name/id/label/
// placeholder, per un sottoinsieme dei ~50 token noti della sezione 7.5 di WCAG (i più
// comuni nei form reali), e i valori autocomplete accettabili per ciascuno.
const PURPOSE_PATTERNS = [
  { re: /e-?mail/i, category: 'email', accepted: ['email'] },
  { re: /tel(efono)?|phone|cellulare|mobile/i, category: 'telefono', accepted: ['tel', 'tel-national'] },
  { re: /nome\s+e\s+cognome|full[\s-]?name|nome\s+completo/i, category: 'nome completo', accepted: ['name'] },
  { re: /cognome|last[\s-]?name|surname/i, category: 'cognome', accepted: ['family-name'] },
  { re: /\bnome\b|first[\s-]?name/i, category: 'nome', accepted: ['given-name', 'name'] },
  { re: /indirizzo|address|\bvia\b/i, category: 'indirizzo', accepted: ['street-address', 'address-line1', 'address-line2'] },
  { re: /\bcap\b|postal[\s-]?code|zip/i, category: 'CAP', accepted: ['postal-code'] },
  { re: /città|city|comune/i, category: 'città', accepted: ['address-level2'] },
  { re: /provincia|county|state|region/i, category: 'provincia', accepted: ['address-level1'] },
  { re: /paese|nazione|country/i, category: 'paese', accepted: ['country', 'country-name'] },
  { re: /azienda|società|company|organization/i, category: 'azienda', accepted: ['organization'] },
  { re: /nome\s*utente|username/i, category: 'username', accepted: ['username'] },
  { re: /password|parola\s*chiave/i, category: 'password', accepted: ['current-password', 'new-password'] },
  { re: /data\s*di\s*nascita|birth[\s-]?date|\bbday\b/i, category: 'data di nascita', accepted: ['bday'] },
  { re: /numero\s*carta|card[\s-]?number|cc-?number/i, category: 'numero carta', accepted: ['cc-number'] }
];

module.exports = {
  id: '1.3.5',
  name: 'Identificare lo scopo dell\'input',
  level: 'AA',
  description: 'Per i campi che raccolgono informazioni sull\'utente e il cui scopo può essere identificato nella tassonomia HTML autocomplete, lo scopo del campo deve essere programmaticamente determinabile.',
  remediation: 'Aggiungi l\'attributo autocomplete con il valore standard corrispondente allo scopo del campo (es. autocomplete="email", autocomplete="given-name", autocomplete="tel"): elenco completo nella sezione 7.5 delle WCAG.',
  aiCapable: true,

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} campi con autocomplete sintatticamente non valido (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // axe verifica solo che un eventuale autocomplete presente sia sintatticamente valido,
    // non che ne manchi uno dove lo scopo del campo è chiaramente riconoscibile: è il gap
    // che copriamo qui via euristica su name/id/label/placeholder.
    await page.evaluate(() => {
      window.__a11yDeepQuery('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea')
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-purpose-id', String(i)));
    });

    try {
      const fields = await page.evaluate(() => {
        function labelFor(el) {
          const root = el.getRootNode();
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return ariaLabel.trim();
          if (el.id) {
            const l = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
            if (l) return l.textContent.trim();
          }
          const wrap = el.closest('label');
          return wrap ? wrap.textContent.trim() : '';
        }
        return window.__a11yDeepQuery('[data-a11y-purpose-id]').map(el => ({
          index: Number(el.getAttribute('data-a11y-purpose-id')),
          selector: `[data-a11y-purpose-id="${el.getAttribute('data-a11y-purpose-id')}"]`,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || 'text',
          name: el.getAttribute('name') || '',
          id: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
          label: labelFor(el),
          autocomplete: (el.getAttribute('autocomplete') || '').trim().toLowerCase()
        }));
      });

      if (fields.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun campo di input testuale trovato', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const suspects = [];
      fields.forEach(f => {
        const context = [f.name, f.id, f.label, f.placeholder].join(' ');
        const match = PURPOSE_PATTERNS.find(p => p.re.test(context));
        if (!match) return;
        const tokens = f.autocomplete.split(/\s+/).filter(Boolean);
        const lastToken = tokens[tokens.length - 1] || '';
        const isAccepted = match.accepted.includes(lastToken);
        if (!isAccepted) suspects.push({ ...f, guessedCategory: match.category, expectedTokens: match.accepted });
      });

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${fields.length} campi controllati, nessuno scopo riconoscibile privo di autocomplete adeguato`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica copre solo un sottoinsieme dei token della tassonomia WCAG (i più comuni): non garantisce copertura completa dei ~50 valori possibili.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${suspects.length}/${fields.length} campi sembrano avere uno scopo riconoscibile (dal nome/etichetta) ma senza autocomplete adeguato`,
            issues: suspects.map(s => ({ selector: s.selector, label: s.label || s.name || s.id, guessedCategory: s.guessedCategory, currentAutocomplete: s.autocomplete || '(assente)' }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per una conferma testuale dello scopo e il valore autocomplete corretto da usare.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const s of toCheck) {
        try {
          const prompt = `Un campo di un form HTML ha queste caratteristiche: tag "${s.tag}", type "${s.type}", name "${s.name}", ` +
            `id "${s.id}", etichetta associata "${s.label}", placeholder "${s.placeholder}". Il suo attributo autocomplete attuale è ` +
            `"${s.autocomplete || '(assente)'}". In base al contesto, questo campo raccoglie un\'informazione personale dell\'utente la cui ` +
            `natura corrisponde a uno dei valori standard della tassonomia HTML autocomplete (es. email, given-name, family-name, tel, ` +
            'street-address, postal-code, address-level2, country, organization, username, current-password, bday, cc-number)? Se sì, qual è ' +
            'il valore corretto e l\'attributo attuale è adeguato? Rispondi SOLO con un JSON: {"scopo_riconoscibile": true|false, ' +
            '"valore_corretto": "token autocomplete proposto, o stringa vuota se non applicabile", "adeguato": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          const applicable = parsed?.scopo_riconoscibile !== false;
          const adeguato = parsed?.adeguato === true;

          findings.push({
            selector: s.selector, label: s.label || s.name || s.id, guessedCategory: s.guessedCategory,
            currentAutocomplete: s.autocomplete || '(assente)',
            verdict: !applicable ? 'non applicabile' : (adeguato ? 'adeguato' : 'inadeguato'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: (!applicable || adeguato) ? '' : `autocomplete="${parsed?.valore_corretto || s.expectedTokens[0]}"`
          });
        } catch (err) {
          findings.push({ selector: s.selector, label: s.label || s.name || s.id, verdict: 'errore', reason: err.message });
        }
      }

      const inadeguati = findings.filter(f => f.verdict === 'inadeguato');

      return {
        id: this.id, name: this.name, level: this.level,
        status: inadeguati.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length}/${fields.length} candidati da euristica, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, label: s.label || s.name || s.id, guessedCategory: s.guessedCategory, currentAutocomplete: s.autocomplete || '(assente)' }))
        },
        ai: { attempted: true, skippedReason: null, verdict: inadeguati.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-purpose-id]').forEach(el => el.removeAttribute('data-a11y-purpose-id'));
      }).catch(() => {});
    }
  }
};
