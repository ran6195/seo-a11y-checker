const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Regole non già coperte da altri script (2.4.4 possiede link-name, 3.3.2 possiede
// label/aria-input-field-name/select-name): qui ci occupiamo di bottoni e widget ARIA
// custom (role=button/checkbox/switch/tab/menuitem), non di link o campi form.
const AXE_RULES = ['button-name', 'aria-command-name', 'aria-toggle-field-name', 'aria-valid-attr-value', 'aria-valid-attr', 'aria-allowed-attr'];
const WIDGET_SELECTOR = 'button, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';
const GENERIC_NAME_RE = /^(bottone|button|pulsante|click|clicca|azione|action)\s*\d*$/i;
const SYMBOL_ONLY_RE = /^[×✕✖✗✘☰≡→←↑↓▶◀►◄★☆•·»«˅˄⌄⌃+\-_/\\|]+$/;

module.exports = {
  id: '4.1.2',
  name: 'Nome, ruolo, valore',
  level: 'A',
  description: 'Per ogni componente dell\'interfaccia, nome e ruolo devono essere determinabili via software, e stati/valori devono poter essere impostati dall\'utente e comunicati alle tecnologie assistive.',
  remediation: 'Aggiungi un aria-label descrittivo ai bottoni/widget che mostrano solo un\'icona o un simbolo (es. aria-label="Chiudi" su un bottone "×"); evita nomi generici come "bottone" o "click".',

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} bottoni/widget senza nome o ruolo accessibile valido (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // axe verifica solo che un nome ESISTA. Non giudica se è UTILE: un bottone "×" ha
    // tecnicamente un nome accessibile ("×"), ma molti screen reader non lo annunciano
    // in modo comprensibile — è il gap reale che axe non copre.
    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-widget-id', String(i)));
    }, WIDGET_SELECTOR);

    try {
      const widgets = await page.evaluate(() => {
        function accessibleName(el) {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
          const labelledby = el.getAttribute('aria-labelledby');
          if (labelledby) {
            const root = el.getRootNode();
            const text = labelledby.split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ').trim();
            if (text) return text;
          }
          return (el.textContent || '').trim();
        }
        return window.__a11yDeepQuery('[data-a11y-widget-id]').map(el => ({
          index: Number(el.getAttribute('data-a11y-widget-id')),
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || (el.tagName.toLowerCase() === 'button' ? 'button' : ''),
          name: accessibleName(el),
          selector: `[data-a11y-widget-id="${el.getAttribute('data-a11y-widget-id')}"]`
        }));
      });

      const suspects = widgets.filter(w => {
        const name = w.name.trim();
        return name.length === 0 || GENERIC_NAME_RE.test(name) || SYMBOL_ONLY_RE.test(name) || name.length <= 1;
      });

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: widgets.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${widgets.length} bottoni/widget controllati, nessun nome sospetto`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica intercetta solo nomi vuoti, generici o composti solo da simboli: non garantisce che ogni nome sia davvero chiaro.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: `${suspects.length}/${widgets.length} bottoni/widget con nome vuoto, generico o solo simboli`, issues: suspects },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per uno screenshot e un giudizio su cosa dovrebbe dire il nome accessibile.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const w of toCheck) {
        try {
          const handle = await page.$(w.selector);
          const screenshotBuffer = handle ? await handle.screenshot().catch(() => null) : null;
          if (!screenshotBuffer) {
            findings.push({ ...w, verdict: 'errore', reason: 'impossibile catturare uno screenshot dell\'elemento' });
            continue;
          }
          const prompt = `Questo è lo screenshot di un elemento interattivo (${w.tag}${w.role ? `, role="${w.role}"` : ''}) ` +
            `il cui nome accessibile attuale è "${w.name || '(vuoto)'}". Guardando l'immagine, quale azione compie questo ` +
            'controllo? Il nome accessibile attuale comunica questa azione in modo comprensibile a chi usa uno screen ' +
            'reader (non solo un simbolo o un\'icona)? Rispondi SOLO con un JSON: {"adeguato": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "aria-label proposto, o stringa vuota se già adeguato"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...w,
            verdict: parsed?.adeguato === false ? 'inadeguato' : (parsed?.adeguato === true ? 'adeguato' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...w, verdict: 'errore', reason: err.message });
        }
      }

      const inadeguati = findings.filter(f => f.verdict === 'inadeguato');

      return {
        id: this.id, name: this.name, level: this.level,
        status: inadeguati.length > 0 ? 'fail' : 'pass',
        automated: { ran: true, summary: `${suspects.length}/${widgets.length} candidati da euristica, ${toCheck.length} verificati con AI`, issues: suspects },
        ai: { attempted: true, skippedReason: null, verdict: inadeguati.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-widget-id]').forEach(el => el.removeAttribute('data-a11y-widget-id'));
      }).catch(() => {});
    }
  }
};
