const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Pattern comuni per contenuto rivelato da hover/focus creato dall'autore. Il title
// nativo del browser (tooltip di sistema, non un elemento del DOM) resta naturalmente
// escluso: __a11yDeepQuery non lo vede, quindi un elemento con solo [title] e nessun
// altro indizio semplicemente non produrrà "nuovo contenuto visibile" più sotto — è
// l'esenzione pratica comune per i tooltip nativi, senza bisogno di un caso speciale.
const CANDIDATE_SELECTOR = '[title], [aria-describedby], [data-tooltip], [data-toggle="tooltip"], [class*="tooltip" i]';
const PERSIST_WAIT_MS = 2500;

module.exports = {
  id: '1.4.13',
  name: 'Contenuto al passaggio del mouse o del focus',
  level: 'AA',
  description: 'Se il passaggio del mouse o il focus da tastiera rivelano nuovo contenuto (es. un tooltip), questo deve poter essere chiuso senza spostare puntatore/focus (dismissable), deve restare visibile finché l\'hover/focus permane (persistent), e deve essere possibile spostare il puntatore su di esso senza farlo sparire (hoverable).',
  remediation: 'Non nascondere il contenuto rivelato con un timeout automatico mentre l\'hover è ancora attivo; assicurati che Escape lo chiuda senza spostare il focus; mantienilo visibile se il puntatore si sposta sopra di esso.',
  aiCapable: true,
  wcagVersion: '2.1',

  // Nessuna regola axe-core copre questo criterio (comportamento runtime, non markup
  // statico). L'euristica isola i candidati più probabili (title/aria-describedby/pattern
  // tooltip comuni) e verifica empiricamente se l'hover rivela DAVVERO nuovo contenuto nel
  // DOM (non solo un cambio di stile): solo a quel punto ha senso testare dismissable
  // (Escape) e persistent (attesa), e chiedere all'AI un giudizio complessivo — l'unica
  // verifica di "hoverable" (spostare il puntatore sul contenuto stesso) non è testata con
  // precisione geometrica, è lasciata al giudizio visivo dell'AI sullo screenshot.
  async run(ctx) {
    const { page, options } = ctx;

    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-hover-id', String(i)));
    }, CANDIDATE_SELECTOR);

    try {
      const candidateCount = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-hover-id]').length);

      if (candidateCount === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun elemento con title/aria-describedby/pattern tooltip comuni trovato', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Euristica basata su pattern comuni: non rileva tooltip custom senza alcun indizio nel markup.'
        };
      }

      const limit = options.limit || 5;
      const toTest = Math.min(candidateCount, limit);
      const triggered = [];

      for (let i = 0; i < toTest; i++) {
        const selector = `[data-a11y-hover-id="${i}"]`;

        await page.evaluate(() => {
          window.__a11yDeepQuery('body *').forEach(el => {
            if (el.offsetParent !== null) el.setAttribute('data-a11y-hb-seen', '1');
          });
        });

        await page.hover(selector).catch(() => {});
        await page.waitForTimeout(400);

        const revealed = await page.evaluate((sel) => {
          const trigger = window.__a11yDeepQuery(sel)[0];
          const newVisible = window.__a11yDeepQuery('body *').filter(el => el.offsetParent !== null && !el.hasAttribute('data-a11y-hb-seen'));
          // Tag persistente sul contenuto rivelato (distinto da "seen"), per poterne
          // ricontrollare la visibilità più avanti dopo l'attesa e dopo Escape.
          newVisible.forEach(el => el.setAttribute('data-a11y-hb-new', '1'));
          const pad = 12;
          let box = null;
          [trigger, ...newVisible.slice(0, 20)].forEach(el => {
            if (!el) return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            if (!box) box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            else {
              box.left = Math.min(box.left, r.left);
              box.top = Math.min(box.top, r.top);
              box.right = Math.max(box.right, r.right);
              box.bottom = Math.max(box.bottom, r.bottom);
            }
          });
          const tag = trigger ? trigger.tagName.toLowerCase() : '';
          const label = trigger ? (trigger.getAttribute('title') || trigger.getAttribute('aria-label') || (trigger.textContent || '').trim().slice(0, 40)) : '';
          return {
            newCount: newVisible.length,
            tag, label,
            box: box ? {
              x: Math.max(0, Math.round(box.left - pad)),
              y: Math.max(0, Math.round(box.top - pad)),
              width: Math.round(box.right - box.left + pad * 2),
              height: Math.round(box.bottom - box.top + pad * 2)
            } : null
          };
        }, selector);

        await page.evaluate(() => {
          window.__a11yDeepQuery('[data-a11y-hb-seen]').forEach(el => el.removeAttribute('data-a11y-hb-seen'));
        });

        if (revealed.newCount === 0 || !revealed.box) {
          await page.evaluate(() => {
            window.__a11yDeepQuery('[data-a11y-hb-new]').forEach(el => el.removeAttribute('data-a11y-hb-new'));
          });
          await page.mouse.move(0, 0).catch(() => {});
          continue;
        }

        // Persistent: il contenuto rivelato deve restare visibile finché l'hover permane,
        // senza sparire da solo per un timeout. Non spostiamo il mouse durante l'attesa.
        await page.waitForTimeout(PERSIST_WAIT_MS);
        const stillVisibleAfterWait = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-hb-new]').filter(el => el.offsetParent !== null).length);
        const persistedThroughWait = stillVisibleAfterWait > 0;

        const screenshotBuffer = await page.screenshot({ clip: revealed.box }).catch(() => null);

        // Dismissable: Escape deve poter chiudere il contenuto senza spostare puntatore/focus.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        const stillVisibleAfterEscape = await page.evaluate(() => window.__a11yDeepQuery('[data-a11y-hb-new]').filter(el => el.offsetParent !== null).length);
        const dismissedByEscape = stillVisibleAfterEscape === 0;

        await page.evaluate(() => {
          window.__a11yDeepQuery('[data-a11y-hb-new]').forEach(el => el.removeAttribute('data-a11y-hb-new'));
        });
        await page.mouse.move(0, 0).catch(() => {});
        await page.waitForTimeout(150);

        triggered.push({
          selector, tag: revealed.tag, label: revealed.label,
          persistedThroughWait,
          dismissedByEscape,
          screenshotBuffer
        });
      }

      if (triggered.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: `${toTest}/${candidateCount} candidati testati, nessuno rivela nuovo contenuto DOM all'hover (probabile solo tooltip nativo del browser, o solo un cambio di stile)`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${triggered.length}/${toTest} candidati rivelano nuovo contenuto all'hover; da verificare dismissable/hoverable/persistent`,
            issues: triggered.map(t => ({ selector: t.selector, tag: t.tag, label: t.label, dismissedByEscape: t.dismissedByEscape }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio visivo su dismissable/hoverable/persistent di ciascun contenuto rivelato.'
        };
      }

      const findings = [];
      for (const item of triggered) {
        if (!item.screenshotBuffer) {
          findings.push({ selector: item.selector, tag: item.tag, label: item.label, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
          continue;
        }
        try {
          const prompt = `Un elemento <${item.tag}> ("${item.label}") rivela nuovo contenuto al passaggio del mouse (screenshot allegato, ` +
            `catturato subito dopo l'hover). Dati osservati: dopo un'attesa di ${PERSIST_WAIT_MS / 1000}s senza muovere il puntatore, il ` +
            `contenuto ${item.persistedThroughWait ? 'era ancora presente' : 'era scomparso da solo'}; premendo Escape, il contenuto ` +
            `${item.dismissedByEscape ? 'si è chiuso' : 'NON si è chiuso'}. Secondo il criterio WCAG 1.4.13, il contenuto deve essere: ` +
            'dismissable (chiudibile senza spostare hover/focus, es. con Escape — salvo che non copra altro contenuto), hoverable ' +
            '(il puntatore deve potersi spostare su di esso senza farlo sparire, valutalo dalla posizione nello screenshot), persistent ' +
            '(non deve sparire da solo per timeout mentre l\'hover è attivo). Nel complesso il comportamento sembra conforme? Rispondi SOLO ' +
            'con un JSON: {"conforme": true|false, "motivo": "spiegazione in una frase, in italiano", "suggerimento": "correzione proposta, o stringa vuota se già conforme"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: item.screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, label: item.label,
            verdict: parsed?.conforme === false ? 'non conforme' : (parsed?.conforme === true ? 'conforme' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, label: item.label, verdict: 'errore', reason: err.message });
        }
      }

      const nonConformi = findings.filter(f => f.verdict === 'non conforme');

      return {
        id: this.id, name: this.name, level: this.level,
        status: nonConformi.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${triggered.length}/${toTest} candidati rivelano nuovo contenuto all'hover, tutti verificati con AI`,
          issues: triggered.map(t => ({ selector: t.selector, tag: t.tag, label: t.label }))
        },
        ai: { attempted: true, skippedReason: null, verdict: nonConformi.length > 0 ? 'fail' : 'pass', findings },
        notes: candidateCount > toTest ? `Solo i primi ${limit} candidati sono stati testati (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-hover-id]').forEach(el => el.removeAttribute('data-a11y-hover-id'));
        window.__a11yDeepQuery('[data-a11y-hb-seen]').forEach(el => el.removeAttribute('data-a11y-hb-seen'));
        window.__a11yDeepQuery('[data-a11y-hb-new]').forEach(el => el.removeAttribute('data-a11y-hb-new'));
      }).catch(() => {});
    }
  }
};
