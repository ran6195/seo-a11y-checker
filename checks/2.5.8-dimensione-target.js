const AXE_RULES = ['target-size'];

module.exports = {
  id: '2.5.8',
  name: 'Dimensione target (minimo)',
  level: 'AA',
  description: 'Ogni target attivabile col puntatore deve misurare almeno 24×24 CSS px, a meno che non esista un\'alternativa equivalente di dimensione adeguata, sia in linea nel testo, sia essenziale, o abbia spazio sufficiente verso i target vicini.',
  remediation: 'Ingrandisci il controllo (padding incluso) fino ad almeno 24×24 CSS px, oppure aumenta lo spazio verso i target adiacenti finché tra i loro bordi c\'è almeno 24px liberi; axe-core calcola già entrambe le condizioni e l\'eventuale eccezione di spaziatura.',
  aiCapable: false,
  wcagVersion: '2.2',

  // Unico criterio WCAG 2.2 della suite (gli altri 26 sono WCAG 2.1 A/AA): la regola axe
  // "target-size" è disabilitata di default anche quando il suo tag (wcag22aa) è incluso
  // nella scansione — va riattivata esplicitamente in checks/lib/browser.js. Il calcolo è
  // interamente geometrico (dimensione del box + distanza dal target più vicino, con
  // l'eccezione di spaziatura già valutata da axe): nessun giudizio semantico o visivo
  // coinvolto, l'AI non servirebbe in nessun caso, superato o fallito che sia.
  async run(ctx) {
    const { axeResults } = ctx;

    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({
        rule: v.id,
        selector: n.target[0],
        html: n.html.slice(0, 120),
        detail: n.failureSummary ? n.failureSummary.replace(/\s+/g, ' ').trim() : ''
      })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} target con dimensione e/o spaziatura insufficienti (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: dimensione e spaziatura sono calcolate geometricamente, nessun ruolo per l\'AI.'
      };
    }

    const totalChecked = (axeResults.passes || []).find(p => AXE_RULES.includes(p.id));

    return {
      id: this.id, name: this.name, level: this.level,
      status: totalChecked ? 'pass' : 'not-applicable',
      automated: {
        ran: true,
        summary: totalChecked ? `${totalChecked.nodes.length} target controllati, tutti con dimensione/spaziatura sufficiente (axe-core)` : 'Nessun target attivabile col puntatore trovato',
        issues: []
      },
      ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
      notes: ''
    };
  }
};
