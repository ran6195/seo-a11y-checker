const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Gli esempi classici del criterio (menu a tendina, checkbox, radio) sono anche i più
// sicuri da testare: cambiarne il valore è un'azione "di impostazione", non una submit.
// I campi di testo non sono inclusi: il loro "on input" riguarda più la validazione live
// (già coperta da 3.3.1) che un cambio di contesto vero e proprio.
const CANDIDATE_SELECTOR = 'select, input[type="checkbox"], input[type="radio"]';
const TEXT_CHANGE_THRESHOLD = 200;

module.exports = {
  id: '3.2.2',
  name: 'In fase di input',
  level: 'A',
  description: 'Cambiare l\'impostazione di un componente dell\'interfaccia (selezionare un\'opzione, spuntare una casella) non deve automaticamente causare un cambiamento di contesto (navigazione, apertura di una nuova finestra), a meno che l\'utente non ne sia stato avvisato prima di usare il componente.',
  remediation: 'Non collegare la navigazione automatica al solo cambio di valore di un menu a tendina/checkbox/radio ("jump menu" senza conferma): aggiungi un pulsante esplicito che l\'utente deve attivare consapevolmente per procedere.',
  aiCapable: true,
  wcagVersion: '2.1',

  // Stessa filosofia "innesca e osserva" di 3.3.1/3.2.1: cambiamo davvero il valore (mai un
  // submit) e osserviamo se causa navigazione/nuova finestra (fallimento già certo, nessun
  // ruolo per l'AI) o un cambiamento sostanziale del contenuto visibile senza navigazione
  // (ambiguo — può essere un pattern annunciato in anticipo, es. "seleziona per vedere i
  // dettagli" — lasciato al giudizio dell'AI).
  async run(ctx) {
    const { page, options } = ctx;
    const browserContext = page.context();

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null && !el.disabled)
        .forEach((el, i) => el.setAttribute('data-a11y-oninput-id', String(i)));
    }, CANDIDATE_SELECTOR);

    try {
      const candidateCount = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-oninput-id]').length);

      if (candidateCount === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun select/checkbox/radio trovato', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const limit = options.limit || 5;
      const toTest = Math.min(candidateCount, limit);
      const certainFails = [];
      const suspects = [];
      let navigatedAway = false;

      for (let i = 0; i < toTest; i++) {
        const selector = `[data-a11y-oninput-id="${i}"]`;

        const before = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          if (!el) return null;
          const root = el.getRootNode();
          const ariaLabel = el.getAttribute('aria-label');
          let label = ariaLabel ? ariaLabel.trim() : '';
          if (!label && el.id) {
            const l = root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`);
            if (l) label = l.textContent.trim();
          }
          if (!label) {
            const wrap = el.closest('label');
            if (wrap) label = wrap.textContent.trim();
          }
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();
          return {
            tag, type, label: label || el.getAttribute('name') || '',
            value: el.value, checked: el.checked,
            options: tag === 'select' ? Array.from(el.options).map(o => o.value) : null
          };
        }, selector).catch(() => null);

        if (!before) continue;
        if (before.tag === 'select' && (!before.options || before.options.length < 2)) continue;

        const urlBefore = page.url();
        const pagesBefore = browserContext.pages().length;
        const textLenBefore = await page.evaluate(() => document.body.innerText.length).catch(() => 0);

        let changed = true;
        try {
          if (before.tag === 'select') {
            const otherValue = before.options.find(v => v !== before.value) ?? before.options[0];
            await page.selectOption(selector, otherValue);
          } else if (before.type === 'checkbox') {
            if (before.checked) await page.uncheck(selector); else await page.check(selector);
          } else {
            await page.check(selector);
          }
        } catch (e) {
          changed = false;
        }
        if (!changed) continue;

        await page.waitForTimeout(300);

        const pagesAfter = browserContext.pages().length;
        const urlAfter = page.url();

        // Ripristina il valore originale SOLO se non abbiamo navigato altrove (riguarda
        // solo questa scheda del browser, throwaway, chiusa a fine run).
        if (urlAfter === urlBefore) {
          try {
            if (before.tag === 'select') await page.selectOption(selector, before.value);
            else if (before.type === 'checkbox') { if (before.checked) await page.check(selector); else await page.uncheck(selector); }
            // I radio non vengono ripristinati: richiederebbe ri-selezionare un altro
            // elemento dello stesso gruppo, fuori scope di un singolo controllo per elemento.
          } catch (e) { /* best-effort */ }
        }

        if (pagesAfter > pagesBefore) {
          const extra = browserContext.pages().slice(pagesBefore);
          for (const p of extra) { if (p !== page) await p.close().catch(() => {}); }
          certainFails.push({ selector, tag: before.tag, label: before.label, reason: 'Il cambio di valore ha aperto una nuova finestra/scheda' });
          continue;
        }
        if (urlAfter !== urlBefore) {
          certainFails.push({ selector, tag: before.tag, label: before.label, reason: `Il cambio di valore ha causato una navigazione (${urlBefore} → ${urlAfter})` });
          navigatedAway = true;
          break; // il resto dei candidati sulla pagina precedente non è più raggiungibile
        }

        const textLenAfter = await page.evaluate(() => document.body.innerText.length).catch(() => textLenBefore);
        if (Math.abs(textLenAfter - textLenBefore) >= TEXT_CHANGE_THRESHOLD) {
          const screenshotBuffer = (options.ai && suspects.filter(s => s.screenshotBuffer).length < limit)
            ? await page.screenshot().catch(() => null)
            : null;
          suspects.push({ selector, tag: before.tag, label: before.label, delta: textLenAfter - textLenBefore, screenshotBuffer });
        }
      }

      if (certainFails.length > 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `${certainFails.length} campi causano un cambiamento di contesto (navigazione o nuova finestra) al solo cambio di valore`, issues: certainFails },
          ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
          notes: navigatedAway ? 'Il test si è fermato alla prima navigazione rilevata: i candidati successivi sulla pagina precedente non sono stati raggiunti.' : 'Verifica funzionale (cambio di valore reale, URL e finestre reali): nessun ruolo per l\'AI, il cambiamento di contesto è confermato empiricamente.'
        };
      }

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${toTest}/${candidateCount} campi testati, nessuno causa navigazione, nuove finestre, o un cambiamento sostanziale del contenuto visibile`, issues: [] },
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
            summary: `${suspects.length} campi causano un cambiamento sostanziale del testo visibile della pagina subito dopo il cambio di valore (senza navigazione)`,
            issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, label: s.label, delta: s.delta }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su ciascun cambiamento: può essere un comportamento annunciato in anticipo (es. "seleziona per vedere i dettagli") o un vero cambio di contesto inatteso.'
        };
      }

      const toCheck = suspects.filter(s => s.screenshotBuffer).slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          const prompt = `Un campo <${item.tag}> ("${item.label || item.tag}") ha cambiato valore (nessun submit, nessun click su un pulsante ` +
            `di conferma), e subito dopo il testo visibile della pagina è cambiato di circa ${Math.abs(item.delta)} caratteri (nessuna ` +
            'navigazione né apertura di nuova finestra, già escluse). Questo screenshot mostra lo stato della pagina subito dopo il ' +
            'cambiamento. Secondo il criterio WCAG 3.2.2, cambiare un\'impostazione non dovrebbe causare un cambiamento di contesto ' +
            'inatteso, a meno che l\'utente non ne sia stato avvisato in anticipo (es. un\'etichetta che dice "seleziona per aggiornare i ' +
            'risultati"). Guardando lo screenshot, questo cambiamento sembra un problema o un comportamento prevedibile/annunciato? ' +
            'Rispondi SOLO con un JSON: {"problema": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "correzione proposta, o stringa vuota se non è un problema"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: item.screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, label: item.label,
            verdict: parsed?.problema === true ? 'problema' : (parsed?.problema === false ? 'nessun problema' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, label: item.label, verdict: 'errore', reason: err.message });
        }
      }

      const problemi = findings.filter(f => f.verdict === 'problema');

      return {
        id: this.id, name: this.name, level: this.level,
        status: problemi.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length} campi con cambiamento sostanziale del testo visibile, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, label: s.label, delta: s.delta }))
        },
        ai: { attempted: true, skippedReason: null, verdict: problemi.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} campi sospetti sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-oninput-id]').forEach(el => el.removeAttribute('data-a11y-oninput-id'));
      }).catch(() => {});
    }
  }
};
