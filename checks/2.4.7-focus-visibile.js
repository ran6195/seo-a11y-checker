const { askVision, parseJSONResponse } = require('./lib/anthropic');

const MAX_TAB_STEPS = 200;

module.exports = {
  id: '2.4.7',
  name: 'Focus visibile',
  level: 'AA',
  description: 'Ogni elemento che riceve il focus da tastiera deve mostrare un indicatore visivo chiaramente percepibile.',
  remediation: 'Aggiungi o rafforza un outline/box-shadow visibile su :focus-visible, con un contrasto di almeno 3:1 rispetto allo sfondo circostante; evita outline: none senza un sostituto altrettanto visibile.',

  async run(ctx) {
    const { page, options } = ctx;

    // IMPORTANTE: qui serve Tab reale da tastiera, non page.focus(selector).
    // page.focus() è un focus programmatico e in Chromium NON attiva :focus-visible,
    // la pseudo-classe con cui i siti moderni mostrano l'indicatore solo su
    // navigazione da tastiera (per non mostrarlo sui click col mouse). Un focus
    // programmatico dà quindi un falso "nessun indicatore" su qualsiasi sito che
    // usa :focus-visible invece di :focus.
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

    const focused = [];
    for (let i = 0; i < MAX_TAB_STEPS; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate((id) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        if (el.hasAttribute('data-a11y-tab-id')) return { repeat: true };
        el.setAttribute('data-a11y-tab-id', String(id));
        const s = window.getComputedStyle(el);
        return {
          repeat: false,
          id,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.value || '').trim().slice(0, 40),
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          boxShadow: s.boxShadow,
          selector: `[data-a11y-tab-id="${id}"]`
        };
      }, i).catch(() => null);

      if (!info || info.repeat) break; // fuori dalla pagina o tornati all'inizio del ciclo
      focused.push(info);
    }

    try {
      if (focused.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun elemento raggiungibile con Tab', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const noIndicator = [];
      const withIndicator = [];
      focused.forEach(item => {
        const hasOutline = item.outlineStyle !== 'none' && item.outlineWidth !== '0px';
        const hasBoxShadow = Boolean(item.boxShadow) && item.boxShadow !== 'none';
        (hasOutline || hasBoxShadow ? withIndicator : noIndicator).push(item);
      });

      if (withIndicator.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `${noIndicator.length}/${focused.length} elementi raggiunti via Tab senza alcun indicatore di focus`, issues: noIndicator },
          ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
          notes: 'Nessun elemento ha un indicatore di focus reale (verificato con Tab da tastiera, non focus programmatico): fallimento già certo.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: noIndicator.length > 0 ? 'fail' : 'needs-review',
          automated: { ran: true, summary: `${withIndicator.length}/${focused.length} con indicatore presente, ${noIndicator.length} senza`, issues: noIndicator },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'La presenza dell\'indicatore è verificata via Tab reale; la sua visibilità (contrasto, spessore contro lo sfondo) richiede --ai o verifica manuale.'
        };
      }

      // Fallback AI con interazione simulata: rifocalizza via Tab (già fatto) gli
      // elementi "sospetti" (indicatore presente ma di visibilità incerta) e ne cattura
      // uno screenshot con contesto per giudicare il contrasto contro lo sfondo reale.
      const limit = options.limit || 5;
      const toCheck = withIndicator.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          await page.focus(item.selector).catch(() => {});
          const box = await page.evaluate((sel) => {
            const el = window.__a11yDeepQuery(sel)[0];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const pad = 24;
            return {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2)
            };
          }, item.selector);

          if (!box || box.width <= 0 || box.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }

          const screenshotBuffer = await page.screenshot({ clip: box }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un elemento <${item.tag}> (testo: "${item.text}") mentre ha il ` +
            'focus da tastiera, con un margine di contesto attorno. L\'indicatore di focus (bordo, contorno o ombra) ' +
            'è chiaramente distinguibile rispetto allo sfondo circostante, con un contrasto sufficiente (criterio ' +
            'WCAG 2.4.7, soglia di riferimento ~3:1 come per 1.4.11)? Se non lo è, suggerisci una modifica pratica ' +
            '(es. colore/spessore dell\'indicatore). Rispondi SOLO con un JSON: {"visibile": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "modifica proposta, o stringa vuota se già visibile"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...item,
            verdict: parsed?.visibile === false ? 'non visibile' : (parsed?.visibile === true ? 'visibile' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...item, verdict: 'errore', reason: err.message });
        }
      }

      const nonVisibili = findings.filter(f => f.verdict === 'non visibile');
      const failCount = noIndicator.length + nonVisibili.length;

      return {
        id: this.id, name: this.name, level: this.level,
        status: failCount > 0 ? 'fail' : 'pass',
        automated: { ran: true, summary: `${withIndicator.length}/${focused.length} con indicatore, ${noIndicator.length} senza`, issues: noIndicator },
        ai: { attempted: true, skippedReason: null, verdict: nonVisibili.length > 0 ? 'fail' : 'pass', findings },
        notes: withIndicator.length > toCheck.length ? `Solo i primi ${limit} elementi con indicatore sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-tab-id]').forEach(el => el.removeAttribute('data-a11y-tab-id'));
      }).catch(() => {});
    }
  }
};
