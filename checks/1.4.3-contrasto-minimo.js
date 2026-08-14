const { askVision, parseJSONResponse } = require('./lib/anthropic');

module.exports = {
  id: '1.4.3',
  name: 'Contrasto (minimo)',
  level: 'AA',
  description: 'Il testo deve avere un rapporto di contrasto di almeno 4,5:1 con lo sfondo (3:1 per il testo grande, dai 18pt o 14pt in grassetto in su).',
  remediation: 'Scurisci il testo o schiarisci lo sfondo (o viceversa) finché il rapporto di contrasto raggiunge la soglia richiesta; verifica con uno strumento di color contrast checker.',

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // 1) axe-core calcola già il contrasto in modo affidabile sul testo statico.
    //    Se trova già una violazione certa, l'AI non aggiunge valore a confermarla.
    const violation = (axeResults.violations || []).find(v => v.id === 'color-contrast');
    if (violation && violation.nodes.length > 0) {
      const failNodes = violation.nodes.map(n => ({ selector: n.target[0], html: n.html.slice(0, 120) }));
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${failNodes.length} elementi con contrasto insufficiente (axe-core)`, issues: failNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // 2) axe-core marca come "incomplete" gli elementi su cui non riesce a calcolare
    //    il contrasto (sfondo con immagine, gradiente, trasparenza, elementi sovrapposti).
    //    Qui l'AI aggiunge valore reale: axe non ha semplicemente rinunciato a rispondere.
    const incomplete = (axeResults.incomplete || []).find(v => v.id === 'color-contrast');
    const uncertain = incomplete ? incomplete.nodes.map(n => ({ selector: n.target[0], html: n.html.slice(0, 120) })) : [];

    if (uncertain.length === 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'pass',
        automated: { ran: true, summary: 'Nessun elemento con contrasto insufficiente o non determinabile (axe-core)', issues: [] },
        ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
        notes: ''
      };
    }

    if (!options.ai) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: { ran: true, summary: `${uncertain.length} elementi con contrasto non determinabile da axe (sfondo immagine/gradiente/trasparenza)`, issues: uncertain },
        ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
        notes: 'Rilancia con --ai per un giudizio visivo sul contrasto di questi elementi.'
      };
    }

    // 3) Fallback AI: screenshot dell'elemento (con margine per vedere lo sfondo reale)
    //    più dimensione/peso del font, per applicare la soglia corretta (4.5:1 o 3:1).
    const limit = options.limit || 5;
    const toCheck = uncertain.slice(0, limit);
    const findings = [];

    for (const item of toCheck) {
      try {
        const info = await page.evaluate((sel) => {
          const el = window.__a11yDeepQuery(sel)[0];
          if (!el) return null;
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            text: (el.textContent || '').trim().slice(0, 60),
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            box: {
              x: Math.max(0, Math.round(r.left - 8)),
              y: Math.max(0, Math.round(r.top - 8)),
              width: Math.round(r.width + 16),
              height: Math.round(r.height + 16)
            }
          };
        }, item.selector).catch(() => null);

        if (!info || info.box.width <= 0 || info.box.height <= 0) {
          findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
          continue;
        }

        const screenshotBuffer = await page.screenshot({ clip: info.box }).catch(() => null);
        if (!screenshotBuffer) {
          findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
          continue;
        }

        const isLargeText = parseFloat(info.fontSize) >= 24 ||
          (parseFloat(info.fontSize) >= 18.66 && parseInt(info.fontWeight, 10) >= 700);
        const threshold = isLargeText ? '3:1 (testo grande)' : '4.5:1 (testo normale)';

        const prompt = `Questo è lo screenshot di un elemento di testo ("${info.text}", dimensione ${info.fontSize}, ` +
          `peso ${info.fontWeight}) che axe-core non è riuscito a valutare automaticamente (probabile sfondo con ` +
          `immagine, gradiente o trasparenza). Il contrasto tra il testo e lo sfondo soddisfa la soglia WCAG 1.4.3 ` +
          `di ${threshold}? Se insufficiente, suggerisci una modifica pratica (es. un colore più scuro/chiaro). ` +
          'Rispondi SOLO con un JSON: {"sufficiente": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
          '"suggerimento": "modifica proposta, o stringa vuota se già sufficiente"}';

        const response = await askVision({
          apiKey: options.apiKey,
          prompt,
          images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
        });
        const parsed = parseJSONResponse(response);

        findings.push({
          ...item,
          verdict: parsed?.sufficiente === false ? 'insufficiente' : (parsed?.sufficiente === true ? 'sufficiente' : 'incerto'),
          reason: parsed?.motivo || response.trim(),
          suggerimento: parsed?.suggerimento || ''
        });
      } catch (err) {
        findings.push({ ...item, verdict: 'errore', reason: err.message });
      }
    }

    const insufficienti = findings.filter(f => f.verdict === 'insufficiente');

    return {
      id: this.id, name: this.name, level: this.level,
      status: insufficienti.length > 0 ? 'fail' : 'pass',
      automated: { ran: true, summary: `${uncertain.length} candidati non determinabili da axe, ${toCheck.length} verificati con AI`, issues: uncertain },
      ai: { attempted: true, skippedReason: null, verdict: insufficienti.length > 0 ? 'fail' : 'pass', findings },
      notes: uncertain.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
    };
  }
};
