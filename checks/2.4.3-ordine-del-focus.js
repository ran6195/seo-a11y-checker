const { askVision, parseJSONResponse } = require('./lib/anthropic');

const MAX_TAB_STEPS = 200;
// Un <input type="date"/"time"/"datetime-local"/"number"> nativo è composto da più segmenti
// interni (giorno/mese/anno, ore/minuti) che Tab attraversa SENZA cambiare
// document.activeElement per diversi passaggi: senza questo margine il walk si fermerebbe
// dopo un solo elemento. Vedi checks/2.4.7-focus-visibile.js per lo stesso fix.
const MAX_SAME_ELEMENT_RETRIES = 8;
// Quando questo script gira dopo altri Tab-walk sulla stessa pagina (checks/run.js/run-site.js
// eseguono tutti i criteri in sequenza), il primo Tab può atterrare in modo transitorio su
// <body> invece che sul primo elemento reale. Vedi checks/2.4.7-focus-visibile.js per lo
// stesso fix e i dettagli.
const MAX_INITIAL_BODY_RETRIES = 3;
const TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], audio[controls], video[controls], details > summary, iframe';

module.exports = {
  id: '2.4.3',
  name: 'Ordine del focus',
  level: 'A',
  description: 'Se una pagina può essere navigata sequenzialmente e la sequenza di navigazione influisce sul significato o sull\'operatività, gli elementi devono ricevere il focus in un ordine che ne preservi il significato e l\'operatività.',
  remediation: 'Evita valori di tabindex positivi che alterano l\'ordine naturale; se un elemento va spostato visivamente (CSS order/position), verifica che la sua posizione nel DOM resti coerente con l\'ordine di lettura logico.',
  aiCapable: true,

  // Riusa il Tab-walk reale già introdotto per 2.4.7/2.1.2. document.querySelectorAll
  // restituisce sempre gli elementi in ordine di documento: usarlo per assegnare un
  // indice di "ordine DOM" a ogni candidato tabbable, poi confrontarlo con l'ordine reale
  // in cui il Tab li visita, è un modo deterministico di isolare i salti sospetti — un
  // giudizio su se un salto è "logico" o confusionario resta invece compito dell'AI.
  async run(ctx) {
    const { page, options } = ctx;

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-domorder-id', String(i)));
    }, TABBABLE_SELECTOR);

    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

    const focused = [];
    let sameElementStreak = 0;
    let initialBodyRetries = 0;
    for (let i = 0; i < MAX_TAB_STEPS; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate((id) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const existingId = el.getAttribute('data-a11y-order-id');
        if (existingId !== null) return { repeat: true, id: Number(existingId) };
        el.setAttribute('data-a11y-order-id', String(id));
        const domOrder = el.getAttribute('data-a11y-domorder-id');
        const r = el.getBoundingClientRect();
        const pad = 20;
        return {
          repeat: false,
          id,
          domOrder: domOrder !== null ? Number(domOrder) : null,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || '').trim().slice(0, 40),
          selector: `[data-a11y-order-id="${id}"]`,
          box: {
            x: Math.max(0, Math.round(r.left - pad)),
            y: Math.max(0, Math.round(r.top - pad)),
            width: Math.round(r.width + pad * 2),
            height: Math.round(r.height + pad * 2)
          }
        };
      }, focused.length).catch(() => null);

      if (!info) {
        if (focused.length === 0 && initialBodyRetries < MAX_INITIAL_BODY_RETRIES) {
          initialBodyRetries++;
          continue;
        }
        break;
      }

      if (info.repeat) {
        if (info.id === focused.length - 1 && sameElementStreak < MAX_SAME_ELEMENT_RETRIES) {
          sameElementStreak++;
          continue;
        }
        break;
      }

      sameElementStreak = 0;
      focused.push(info);
    }

    try {
      const withOrder = focused.filter(f => f.domOrder !== null);

      if (withOrder.length < 2) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Meno di due elementi tabbable confrontabili trovati', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      // Un "regresso" è un passo di Tab che salta a un elemento con indice DOM inferiore
      // a quello del passo precedente: l'ordine di tabulazione visita gli elementi in una
      // sequenza diversa da quella del documento. Non è automaticamente un errore (può
      // essere intenzionale), ma è l'unico segnale che vale la pena verificare.
      const regressions = [];
      for (let i = 1; i < withOrder.length; i++) {
        if (withOrder[i].domOrder < withOrder[i - 1].domOrder) {
          regressions.push({ from: withOrder[i - 1], to: withOrder[i] });
        }
      }

      if (regressions.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${withOrder.length} elementi tabbable, l'ordine di tabulazione coincide sempre con l'ordine del documento`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Nessun salto rilevato: l\'ordine di tabulazione preserva l\'ordine del documento, base ragionevole per un ordine logico.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${regressions.length} salti all'indietro rispetto all'ordine del documento su ${withOrder.length} elementi tabbable`,
            issues: regressions.map(r => ({ da: `${r.from.tag} "${r.from.text}"`, a: `${r.to.tag} "${r.to.text}"` }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su ciascun salto: potrebbe essere un pattern intenzionale (es. un "vai ai risultati") o un ordine confusionario.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = regressions.slice(0, limit);
      const findings = [];

      for (const { from, to } of toCheck) {
        try {
          const shotFrom = from.box.width > 0 && from.box.height > 0 ? await page.screenshot({ clip: from.box }).catch(() => null) : null;
          const shotTo = to.box.width > 0 && to.box.height > 0 ? await page.screenshot({ clip: to.box }).catch(() => null) : null;

          if (!shotFrom || !shotTo) {
            findings.push({ da: `${from.tag} "${from.text}"`, a: `${to.tag} "${to.text}"`, verdict: 'errore', reason: 'impossibile catturare uno degli screenshot' });
            continue;
          }

          const prompt = `Sto verificando l'ordine di tabulazione (WCAG 2.4.3) di una pagina web. La prima immagine mostra l'elemento ` +
            `<${from.tag}> (testo: "${from.text}") che aveva il focus; subito dopo, premendo Tab, il focus è saltato ` +
            `direttamente all'elemento <${to.tag}> (testo: "${to.text}") mostrato nella seconda immagine, che si trova PRIMA ` +
            'nel documento HTML (un salto all\'indietro rispetto all\'ordine naturale del contenuto). Guardando le due immagini, ' +
            'questo salto crea un ordine di navigazione logico e comprensibile, oppure risulta confusionario per chi naviga solo ' +
            'con la tastiera? Rispondi SOLO con un JSON: {"logico": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "correzione proposta (es. rimuovere tabindex, riordinare nel DOM), o stringa vuota se già logico"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [
              { base64: shotFrom.toString('base64'), mediaType: 'image/png' },
              { base64: shotTo.toString('base64'), mediaType: 'image/png' }
            ]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            da: `${from.tag} "${from.text}"`,
            a: `${to.tag} "${to.text}"`,
            verdict: parsed?.logico === false ? 'illogico' : (parsed?.logico === true ? 'logico' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ da: `${from.tag} "${from.text}"`, a: `${to.tag} "${to.text}"`, verdict: 'errore', reason: err.message });
        }
      }

      const illogici = findings.filter(f => f.verdict === 'illogico');

      return {
        id: this.id, name: this.name, level: this.level,
        status: illogici.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${regressions.length} salti all'indietro rilevati su ${withOrder.length} elementi tabbable, ${toCheck.length} verificati con AI`,
          issues: regressions.map(r => ({ da: `${r.from.tag} "${r.from.text}"`, a: `${r.to.tag} "${r.to.text}"` }))
        },
        ai: { attempted: true, skippedReason: null, verdict: illogici.length > 0 ? 'fail' : 'pass', findings },
        notes: regressions.length > toCheck.length ? `Solo i primi ${limit} salti sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-domorder-id]').forEach(el => el.removeAttribute('data-a11y-domorder-id'));
        window.__a11yDeepQuery('[data-a11y-order-id]').forEach(el => el.removeAttribute('data-a11y-order-id'));
      }).catch(() => {});
    }
  }
};
