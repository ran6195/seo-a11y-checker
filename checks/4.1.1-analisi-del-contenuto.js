const AXE_RULES = ['duplicate-id', 'duplicate-id-active', 'duplicate-id-aria'];

module.exports = {
  id: '4.1.1',
  name: 'Analisi del contenuto (parsing)',
  level: 'A',
  description: 'Gli elementi devono avere tag di apertura/chiusura completi, essere annidati secondo le loro specifiche, non contenere attributi duplicati, e ogni id deve essere univoco (tranne dove le specifiche lo consentono).',
  remediation: 'Rendi univoco ogni id nel documento (compresi quelli generati dinamicamente da widget/plugin duplicati sulla stessa pagina); valida il markup con un validatore HTML per correggere annidamento e tag non chiusi.',

  async run(ctx) {
    const { axeResults } = ctx;

    // Criterio puramente sintattico: axe-core copre già in modo affidabile id duplicati
    // (la causa più comune in pratica, tipica di widget/componenti instanziati più volte
    // sulla stessa pagina) e markup non valido. Non c'è alcun giudizio semantico o visivo
    // da fare: l'AI non avrebbe nulla da aggiungere in nessun caso, superato o fallito.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} problemi di markup rilevati (axe-core, regole: ${[...new Set(axeFailNodes.map(f => f.rule))].join(', ')})`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
        notes: 'Verifica interamente deterministica: nessun ruolo per l\'AI in questo criterio, superato o fallito che sia.'
      };
    }

    return {
      id: this.id, name: this.name, level: this.level,
      status: 'pass',
      automated: { ran: true, summary: 'Nessun id duplicato o problema di markup rilevato da axe-core', issues: [] },
      ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
      notes: 'axe-core non copre la validità HTML completa (tag non chiusi, annidamento errato) quanto un validatore HTML dedicato: per una verifica esaustiva usa anche https://validator.w3.org/.'
    };
  }
};
