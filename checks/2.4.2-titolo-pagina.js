const { askVision, parseJSONResponse } = require('./lib/anthropic');

const GENERIC_TITLE_RE = /^(home|untitled|document|senza titolo|pagina|page|index|new page|nuova pagina)\s*\d*$/i;

module.exports = {
  id: '2.4.2',
  name: 'Titolo della pagina',
  level: 'A',
  description: 'Le pagine devono avere un titolo che ne descriva l\'argomento o lo scopo.',
  remediation: 'Scrivi un <title> specifico per la pagina (non solo il nome del sito, non "Home" generico): includi l\'argomento principale della pagina.',
  aiCapable: true,

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // axe-core copre già l'assenza totale di <title>. Se manca, fallimento certo.
    const violation = (axeResults.violations || []).find(v => v.id === 'document-title');
    if (violation) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: 'Nessun elemento <title> presente o vuoto (axe-core)', issues: [{ selector: 'title' }] },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    const title = (await page.title()).trim();
    const isGeneric = GENERIC_TITLE_RE.test(title) || title.length < 4;

    if (!isGeneric) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'pass',
        automated: { ran: true, summary: `Titolo presente e non generico: "${title}"`, issues: [] },
        ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
        notes: 'L\'euristica intercetta solo titoli palesemente generici: non garantisce che descriva davvero il contenuto specifico.'
      };
    }

    if (!options.ai) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: { ran: true, summary: `Titolo sospetto/generico: "${title}"`, issues: [{ title }] },
        ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
        notes: 'Rilancia con --ai per un giudizio su quanto il titolo descriva la pagina.'
      };
    }

    const h1 = await page.evaluate(() => (window.__a11yDeepQuery('h1')[0]?.textContent || '').trim());
    const prompt = `Il tag <title> di questa pagina è "${title}". L'intestazione principale (h1) è "${h1 || '(assente)'}". ` +
      'Secondo il criterio WCAG 2.4.2, questo titolo descrive adeguatamente l\'argomento o lo scopo della pagina? ' +
      'Se non lo è, proponi un titolo migliore. Rispondi SOLO con un JSON: {"descrittivo": true|false, ' +
      '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "titolo proposto, o stringa vuota se già adeguato"}';

    try {
      const response = await askVision({ apiKey: options.apiKey, prompt });
      const parsed = parseJSONResponse(response);
      const verdict = parsed?.descrittivo === false ? 'non descrittivo' : (parsed?.descrittivo === true ? 'descrittivo' : 'incerto');
      const finding = { title, h1, verdict, reason: parsed?.motivo || response.trim(), suggerimento: parsed?.suggerimento || '' };

      return {
        id: this.id, name: this.name, level: this.level,
        status: verdict === 'non descrittivo' ? 'fail' : 'pass',
        automated: { ran: true, summary: `Titolo sospetto/generico: "${title}"`, issues: [{ title }] },
        ai: { attempted: true, skippedReason: null, verdict: verdict === 'non descrittivo' ? 'fail' : 'pass', findings: [finding] },
        notes: ''
      };
    } catch (err) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'error',
        automated: { ran: true, summary: `Titolo sospetto/generico: "${title}"`, issues: [{ title }] },
        ai: { attempted: true, skippedReason: null, verdict: null, findings: [{ title, verdict: 'errore', reason: err.message }] },
        notes: ''
      };
    }
  }
};
