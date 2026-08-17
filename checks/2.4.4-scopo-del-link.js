const { askVision, parseJSONResponse } = require('./lib/anthropic');

const GENERIC_TEXT_RE = /^(clicca\s*qui|click\s*here|qui|here|leggi\s*(di\s*più|tutto)?|scopri\s*(di\s*più)?|vedi\s*(tutto|di\s*più)?|read\s*more|learn\s*more|more|continua\s*a\s*leggere|continue\s*reading|link|vai|go|dettagli|details)$/i;

module.exports = {
  id: '2.4.4',
  name: 'Scopo del link (dal contesto)',
  level: 'A',
  description: 'Lo scopo di ogni link deve essere comprensibile dal testo del link stesso o dal contesto immediato che lo circonda.',
  remediation: 'Sostituisci testi generici ("clicca qui", "leggi di più") con testo che descriva la destinazione (es. "Leggi la privacy policy"); se serve un testo breve, rafforzalo con un aria-label più descrittivo.',
  aiCapable: true,
  wcagVersion: '2.1',

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // 1) axe-core copre già i link senza ALCUN nome accessibile (link-name).
    //    Se falliscono qui, è già un fallimento certo: l'AI non serve a confermarlo.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => v.id === 'link-name')
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} link senza alcun nome accessibile (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // 2) axe non può giudicare se un link CON nome ha comunque un testo troppo generico
    //    ("clicca qui") o ambiguo (stesso testo, destinazioni diverse). Euristica gratuita
    //    per isolare i candidati prima di spendere una chiamata AI.
    // offsetParent === null esclude link non renderizzati (display:none), come i link
    // tecnici duplicati che alcuni plugin/widget iniettano nascosti nel DOM.
    await page.evaluate(() => {
      window.__a11yDeepQuery('a[href]')
        .filter(a => a.offsetParent !== null)
        .forEach((a, i) => a.setAttribute('data-a11y-link-id', String(i)));
    });

    try {
      const links = await page.evaluate(() => {
        return window.__a11yDeepQuery('[data-a11y-link-id]')
          .map(a => {
            const container = a.closest('li, p, td, div') || a.parentElement;
            return {
              index: Number(a.getAttribute('data-a11y-link-id')),
              text: (a.textContent || a.getAttribute('aria-label') || '').trim(),
              href: a.getAttribute('href') || '',
              context: (container ? container.textContent : '').trim().slice(0, 200),
              selector: `[data-a11y-link-id="${a.getAttribute('data-a11y-link-id')}"]`
            };
          })
          .filter(l => l.text);
      });

      const genericCandidates = links.filter(l => GENERIC_TEXT_RE.test(l.text));

      const hrefsByText = new Map();
      links.forEach(l => {
        const key = l.text.toLowerCase();
        if (!hrefsByText.has(key)) hrefsByText.set(key, new Set());
        hrefsByText.get(key).add(l.href);
      });
      const duplicateAmbiguous = links.filter(l => (hrefsByText.get(l.text.toLowerCase()) || new Set()).size > 1);

      const candidateMap = new Map();
      [...genericCandidates, ...duplicateAmbiguous].forEach(l => candidateMap.set(l.selector, l));
      const candidates = Array.from(candidateMap.values());

      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: links.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${links.length} link controllati, nessun pattern sospetto (testo generico o duplicato su destinazioni diverse)`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica copre solo pattern noti: non garantisce che ogni testo di link sia comprensibile fuori contesto.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${candidates.length}/${links.length} link con testo generico o duplicato su destinazioni diverse`,
            issues: candidates.map(c => ({ selector: c.selector, text: c.text, href: c.href }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su quanto lo scopo del link sia comprensibile dal testo/contesto.'
        };
      }

      // 3) Fallback AI, solo testuale: nessuno screenshot, basta testo del link + contesto immediato.
      const limit = options.limit || 5;
      const toCheck = candidates.slice(0, limit);
      const findings = [];

      for (const link of toCheck) {
        try {
          const prompt = `Un link ha il testo "${link.text}" e porta a "${link.href}". Il contesto immediato ` +
            `attorno al link nella pagina è: "${link.context}". Secondo il criterio WCAG 2.4.4, lo scopo/la ` +
            'destinazione del link è comprensibile da questo testo e contesto, anche se letto isolatamente ' +
            '(es. da una lista di link di uno screen reader)? Se non è chiaro, proponi un testo di link migliore. ' +
            'Rispondi SOLO con un JSON: {"chiaro": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "testo di link proposto, o stringa vuota se già chiaro"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...link,
            verdict: parsed?.chiaro === false ? 'non chiaro' : (parsed?.chiaro === true ? 'chiaro' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...link, verdict: 'errore', reason: err.message });
        }
      }

      const nonChiari = findings.filter(f => f.verdict === 'non chiaro');

      return {
        id: this.id, name: this.name, level: this.level,
        status: nonChiari.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${candidates.length}/${links.length} candidati da euristica, ${toCheck.length} verificati con AI`,
          issues: candidates.map(c => ({ selector: c.selector, text: c.text, href: c.href }))
        },
        ai: { attempted: true, skippedReason: null, verdict: nonChiari.length > 0 ? 'fail' : 'pass', findings },
        notes: candidates.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-link-id]').forEach(el => el.removeAttribute('data-a11y-link-id'));
      }).catch(() => {});
    }
  }
};
