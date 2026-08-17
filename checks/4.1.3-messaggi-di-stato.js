const { askVision, parseJSONResponse } = require('./lib/anthropic');

const LIVE_REGION_SELECTOR = '[role="status"], [role="alert"], [role="log"], [aria-live="polite"], [aria-live="assertive"]';
// Stesso set di campi con vincoli di validazione usato da checks/3.3.1-identificazione-errore.js:
// è l'unica interazione che questa suite considera sicura da eseguire su un sito qualunque
// (solo blur/input, mai un submit reale), e la riusiamo qui come "innesco" per verificare se
// un'eventuale live region reagisce davvero. Il criterio 4.1.3 è più ampio (copre anche
// messaggi come "aggiunto al carrello" o risultati di ricerca aggiornati), ma innescare quelle
// azioni richiederebbe interazioni mutanti (submit, acquisti) fuori dal perimetro sicuro di
// questa suite: dove non possiamo verificarlo empiricamente lo dichiariamo esplicitamente
// invece di fingere una copertura completa.
const FIELD_SELECTOR = [
  'input[required]:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'input[pattern]', 'input[type="email"]', 'input[type="url"]', 'input[type="tel"]', 'input[type="number"]',
  'input[minlength]', 'input[maxlength]', 'input[min]', 'input[max]',
  'textarea[required]', 'textarea[pattern]', 'textarea[minlength]'
].join(', ');

module.exports = {
  id: '4.1.3',
  name: 'Messaggi di stato',
  level: 'AA',
  description: 'I messaggi di stato (conferme, errori, avvisi, aggiornamenti) devono poter essere comunicati alle tecnologie assistive senza ricevere il focus, tramite un ruolo o proprietà appropriati (es. role="status", aria-live).',
  remediation: 'Racchiudi i messaggi generati dinamicamente (conferme, contatori di risultati, errori) in un contenitore con role="status" (o aria-live="polite"/"assertive" per gli avvisi urgenti), presente nel DOM fin dal caricamento della pagina e aggiornato senza spostare il focus.',
  aiCapable: true,
  wcagVersion: '2.1',

  async run(ctx) {
    const { page, options } = ctx;

    const liveRegions = await page.evaluate((sel) => {
      return window.__a11yDeepQuery(sel).map((el, i) => {
        el.setAttribute('data-a11y-status-id', String(i));
        return {
          index: i,
          selector: `[data-a11y-status-id="${i}"]`,
          role: el.getAttribute('role') || '',
          ariaLive: el.getAttribute('aria-live') || '',
          initialText: (el.textContent || '').trim().slice(0, 100)
        };
      });
    }, LIVE_REGION_SELECTOR);

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-status-trigger-id', String(i)));
    }, FIELD_SELECTOR);

    try {
      const fieldCount = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-status-trigger-id]').length);

      if (liveRegions.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: 'Nessuna live region (role="status"/"alert"/"log" o aria-live) trovata nel markup iniziale', issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Non è verificabile in modo sicuro se la pagina genera messaggi di stato dinamici (es. conferme, contatori) tramite interazioni che questa suite non esegue (submit, acquisti): se il sito lo fa, dovrebbe comunque avere una live region nel DOM per comunicarlo alle tecnologie assistive, e qui non ne è stata trovata nessuna.'
        };
      }

      if (fieldCount === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: `${liveRegions.length} live region trovate nel markup, ma nessun campo form testabile con l'interazione sicura di questa suite per verificarne la reattività`, issues: liveRegions },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica manuale consigliata: esegui un\'azione che genera un messaggio di stato sul sito (es. un submit reale, un filtro di ricerca) e controlla con uno screen reader se viene annunciato.'
        };
      }

      const limit = options.limit || 5;
      const toTest = Math.min(fieldCount, limit);
      let reacted = false;
      const reactedRegions = [];

      for (let i = 0; i < toTest; i++) {
        const selector = `[data-a11y-status-trigger-id="${i}"]`;

        const before = await page.evaluate((sel) => window.__a11yDeepQuery(sel).map(el => ({ id: el.getAttribute('data-a11y-status-id'), text: (el.textContent || '').trim() })), LIVE_REGION_SELECTOR);

        const invalidValue = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'email') return 'non-una-email';
          if (type === 'number') return 'abc';
          const minlength = el.getAttribute('minlength');
          if (minlength && Number(minlength) > 0) return 'x'.repeat(Math.max(0, Number(minlength) - 1));
          return el.hasAttribute('pattern') ? '@@invalid@@' : '';
        }, selector);

        const originalValue = await page.evaluate((sel) => window.__a11yDeepQuery(sel)[0]?.value, selector);

        try {
          await page.fill(selector, invalidValue);
          await page.locator(selector).blur();
          await page.waitForTimeout(400);
        } catch (e) { continue; }

        const after = await page.evaluate((sel) => window.__a11yDeepQuery(sel).map(el => ({ id: el.getAttribute('data-a11y-status-id'), text: (el.textContent || '').trim() })), LIVE_REGION_SELECTOR);

        await page.fill(selector, originalValue || '').catch(() => {});

        after.forEach(a => {
          const b = before.find(x => x.id === a.id);
          if (b && b.text !== a.text) {
            reacted = true;
            if (!reactedRegions.includes(a.id)) reactedRegions.push(a.id);
          }
        });

        if (reacted) break;
      }

      if (reacted) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: {
            ran: true,
            summary: `Almeno una live region (${reactedRegions.length}/${liveRegions.length}) aggiorna il proprio testo in reazione a un errore di validazione, senza spostare il focus`,
            issues: []
          },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verificato solo per la validazione di campi form; altri tipi di messaggio di stato (conferme, contatori) non sono testati da questa interazione.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${liveRegions.length} live region presenti nel markup, ma nessuna ha reagito all'interazione di test su ${toTest} campi`,
            issues: liveRegions.map(r => ({ selector: r.selector, role: r.role, ariaLive: r.ariaLive }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio sul contesto HTML delle live region trovate; la mancata reazione potrebbe dipendere da un\'interazione diversa da quella testata (non necessariamente un difetto).'
        };
      }

      const toCheck = liveRegions.slice(0, options.limit || 5);
      const findings = [];

      for (const region of toCheck) {
        try {
          const context = await page.evaluate((sel) => {
            const el = window.__a11yDeepQuery(sel)[0];
            if (!el) return '';
            return (el.outerHTML || '').slice(0, 400);
          }, region.selector);

          const prompt = `Questo è il markup di un elemento pensato per comunicare messaggi di stato dinamici (role="${region.role}", ` +
            `aria-live="${region.ariaLive}"), attualmente vuoto o statico: ${context}. Non è stato osservato reagire a un test di ` +
            'validazione di un campo form (potrebbe dover reagire ad altre interazioni, es. un submit o un filtro). In base alla sua ' +
            'posizione/struttura nel markup, sembra plausibilmente collegato a un meccanismo che lo aggiorna dinamicamente (es. vicino a un ' +
            'form o a un\'area di risultati), o sembra inutilizzato/isolato? Rispondi SOLO con un JSON: {"plausibile": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: region.selector, role: region.role, ariaLive: region.ariaLive,
            verdict: parsed?.plausibile === false ? 'isolata' : (parsed?.plausibile === true ? 'plausibile' : 'incerto'),
            reason: parsed?.motivo || response.trim()
          });
        } catch (err) {
          findings.push({ selector: region.selector, verdict: 'errore', reason: err.message });
        }
      }

      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: {
          ran: true,
          summary: `${liveRegions.length} live region presenti nel markup, nessuna ha reagito all'interazione di test`,
          issues: liveRegions.map(r => ({ selector: r.selector, role: r.role, ariaLive: r.ariaLive }))
        },
        ai: { attempted: true, skippedReason: null, verdict: null, findings },
        notes: 'La sola analisi statica del markup non può confermare se il meccanismo funziona davvero: verifica manuale con screen reader consigliata sull\'interazione reale che genera il messaggio.'
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-status-id]').forEach(el => el.removeAttribute('data-a11y-status-id'));
        window.__a11yDeepQuery('[data-a11y-status-trigger-id]').forEach(el => el.removeAttribute('data-a11y-status-trigger-id'));
      }).catch(() => {});
    }
  }
};
