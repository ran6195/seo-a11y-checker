const { askVision, parseJSONResponse } = require('./lib/anthropic');

const MAX_TAB_STEPS = 200;
// Stessa tolleranza di checks/2.4.7-focus-visibile.js (e 2.1.2/2.4.3/2.4.11): un input
// data/ora nativo richiede più Tab restando sullo stesso elemento, e il primo Tab dopo un
// altro script basato su Tab-walk può atterrare in modo transitorio su <body>.
const MAX_SAME_ELEMENT_RETRIES = 8;
const MAX_INITIAL_BODY_RETRIES = 3;
// Soglia minima di variazione del testo visibile della pagina per considerare "sospetto"
// un cambiamento avvenuto subito dopo il focus: abbastanza alta da non scattare per rumore
// di fondo (un orologio, un contatore), abbastanza bassa da cogliere un pannello/modale
// che si apre.
const TEXT_CHANGE_THRESHOLD = 200;

module.exports = {
  id: '3.2.1',
  name: 'Al focus',
  level: 'A',
  description: 'Quando un componente dell\'interfaccia riceve il focus, questo non deve avviare un cambiamento di contesto (navigazione, apertura di una nuova finestra, invio di un form, o uno spostamento sostanziale e inatteso del contenuto).',
  remediation: 'Non collegare navigazione, invio di form o cambiamenti sostanziali del contenuto al solo evento di focus: quelle azioni dovrebbero scattare con un\'attivazione esplicita (click, Invio/Spazio), non con il semplice passaggio del focus da tastiera.',
  aiCapable: true,
  wcagVersion: '2.1',

  // Riusa lo stesso Tab-walk di 2.4.7/2.1.2/2.4.3/2.4.11. Navigazione o apertura di una
  // nuova finestra causate dal solo focus sono fallimenti già certi (nessuna interazione
  // di attivazione, solo Tab): deterministico, nessun ruolo per l'AI. Un cambiamento
  // sostanziale del testo visibile della pagina senza navigazione è invece ambiguo — può
  // essere un mega-menu o un suggerimento di completamento automatico (normale) oppure un
  // vero cambio di contesto disorientante — e viene lasciato al giudizio dell'AI.
  async run(ctx) {
    const { page, options } = ctx;
    const browserContext = page.context();

    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

    const focused = [];
    let sameElementStreak = 0;
    let initialBodyRetries = 0;
    const certainFails = [];
    const suspects = [];
    let navigatedAway = false;

    for (let i = 0; i < MAX_TAB_STEPS; i++) {
      const urlBefore = page.url();
      const pagesBefore = browserContext.pages().length;
      const textLenBefore = await page.evaluate(() => document.body.innerText.length).catch(() => 0);

      await page.keyboard.press('Tab');
      await page.waitForTimeout(80); // margine minimo perché un'eventuale navigazione/popup si registri

      const info = await page.evaluate((id) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const existingId = el.getAttribute('data-a11y-onfocus-id');
        if (existingId !== null) return { repeat: true, id: Number(existingId) };
        el.setAttribute('data-a11y-onfocus-id', String(id));
        return { repeat: false, id, tag: el.tagName.toLowerCase(), text: (el.textContent || el.value || '').trim().slice(0, 40), selector: `[data-a11y-onfocus-id="${id}"]` };
      }, focused.length).catch(() => null);

      if (!info) {
        if (focused.length === 0 && initialBodyRetries < MAX_INITIAL_BODY_RETRIES) { initialBodyRetries++; continue; }
        break;
      }
      if (info.repeat) {
        if (info.id === focused.length - 1 && sameElementStreak < MAX_SAME_ELEMENT_RETRIES) { sameElementStreak++; continue; }
        break;
      }
      sameElementStreak = 0;

      const pagesAfter = browserContext.pages().length;
      if (pagesAfter > pagesBefore) {
        const extra = browserContext.pages().slice(pagesBefore);
        for (const p of extra) { if (p !== page) await p.close().catch(() => {}); }
        certainFails.push({ selector: info.selector, tag: info.tag, text: info.text, reason: 'Il focus ha aperto una nuova finestra/scheda' });
        focused.push(info);
        continue;
      }

      const urlAfter = page.url();
      if (urlAfter !== urlBefore) {
        certainFails.push({ selector: info.selector, tag: info.tag, text: info.text, reason: `Il focus ha causato una navigazione (${urlBefore} → ${urlAfter})` });
        focused.push(info);
        navigatedAway = true;
        break; // la pagina è cambiata: il resto del walk sul documento precedente non ha più senso
      }

      const textLenAfter = await page.evaluate(() => document.body.innerText.length).catch(() => textLenBefore);
      if (Math.abs(textLenAfter - textLenBefore) >= TEXT_CHANGE_THRESHOLD) {
        // Screenshot catturato QUI, subito dopo aver rilevato il cambiamento: un secondo
        // passaggio successivo, dopo aver continuato il walk su altri elementi, mostrerebbe
        // uno stato della pagina ormai diverso (scroll/focus nel frattempo spostati altrove).
        const screenshotBuffer = (options.ai && suspects.filter(s => s.screenshotBuffer).length < (options.limit || 5))
          ? await page.screenshot().catch(() => null)
          : null;
        suspects.push({ selector: info.selector, tag: info.tag, text: info.text, delta: textLenAfter - textLenBefore, screenshotBuffer });
      }

      focused.push(info);
    }

    try {
      if (certainFails.length > 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `${certainFails.length} elementi causano un cambiamento di contesto (navigazione o nuova finestra) al solo focus`, issues: certainFails },
          ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
          notes: navigatedAway ? 'Il Tab-walk si è fermato alla prima navigazione rilevata: il resto della pagina precedente non è stato esplorato.' : 'Verifica funzionale (Tab reale, URL e finestre reali): nessun ruolo per l\'AI, il cambiamento di contesto è confermato empiricamente.'
        };
      }

      if (focused.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun elemento raggiungibile con Tab', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${focused.length} elementi raggiunti via Tab, nessuno causa navigazione, nuove finestre, o un cambiamento sostanziale del contenuto visibile`, issues: [] },
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
            summary: `${suspects.length} elementi causano un cambiamento sostanziale del testo visibile della pagina subito dopo il focus (senza navigazione)`,
            issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, text: s.text, delta: s.delta }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su ciascun cambiamento: può essere un pattern prevedibile (mega-menu, autocomplete) o un vero cambio di contesto disorientante.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.filter(s => s.screenshotBuffer).slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          const screenshotBuffer = item.screenshotBuffer;
          const prompt = `Un elemento <${item.tag}> (testo: "${item.text}") ha ricevuto il focus da tastiera (Tab, nessun click né altra ` +
            `attivazione), e subito dopo il testo visibile della pagina è cambiato di circa ${Math.abs(item.delta)} caratteri (nessuna ` +
            'navigazione né apertura di nuova finestra, già escluse). Questo screenshot mostra lo stato della pagina subito dopo il ' +
            'cambiamento. Secondo il criterio WCAG 3.2.1, ricevere il focus non dovrebbe causare un cambiamento di contesto inatteso o ' +
            'disorientante; un pattern prevedibile e comune (es. un menu a tendina che si apre, un suggerimento di completamento ' +
            'automatico) è generalmente accettabile. Guardando lo screenshot, questo cambiamento sembra un problema o un comportamento ' +
            'normale/prevedibile? Rispondi SOLO con un JSON: {"problema": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "correzione proposta, o stringa vuota se non è un problema"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, text: item.text,
            verdict: parsed?.problema === true ? 'problema' : (parsed?.problema === false ? 'nessun problema' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, text: item.text, verdict: 'errore', reason: err.message });
        }
      }

      const problemi = findings.filter(f => f.verdict === 'problema');

      return {
        id: this.id, name: this.name, level: this.level,
        status: problemi.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length} elementi con cambiamento sostanziale del testo visibile, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, text: s.text, delta: s.delta }))
        },
        ai: { attempted: true, skippedReason: null, verdict: problemi.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} elementi sospetti sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-onfocus-id]').forEach(el => el.removeAttribute('data-a11y-onfocus-id'));
      }).catch(() => {});
    }
  }
};
