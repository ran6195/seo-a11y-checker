const { askVision, parseJSONResponse } = require('./lib/anthropic');

const AXE_RULES = ['link-in-text-block'];

module.exports = {
  id: '1.4.1',
  name: 'Uso del colore',
  level: 'A',
  description: 'Il colore non deve essere l\'unico mezzo visivo usato per veicolare un\'informazione, indicare un\'azione, richiedere una risposta, o distinguere un elemento visivo (es. un link nel testo, un campo obbligatorio, un errore).',
  remediation: 'Aggiungi un secondo indizio non cromatico (sottolineatura per i link nel testo, un\'icona o un\'etichetta testuale per gli errori, un simbolo oltre al colore per gli stati) così l\'informazione resti percepibile anche in scala di grigi.',
  aiCapable: true,
  wcagVersion: '2.1',

  // axe-core copre già il caso più comune e circoscritto (link nel testo distinguibili
  // solo dal colore, senza sottolineatura né altro). Il criterio nel complesso è però più
  // ampio (errori di validazione solo rossi, stati indicati solo da un pallino colorato,
  // legende di grafici) e non isolabile con un'euristica affidabile: qui usiamo un
  // confronto diretto colore vs scala di grigi dell'intero viewport, lasciando all'AI un
  // giudizio olistico — l'unico modo ragionevole di coprire pattern così eterogenei.
  async run(ctx) {
    const { page, axeResults, options } = ctx;

    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} link nel testo distinguibili solo dal colore, senza sottolineatura né altro indizio (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    if (!options.ai) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: { ran: true, summary: 'axe-core non rileva link nel testo distinguibili solo dal colore; il resto del criterio (errori, stati, legende) richiede un giudizio visivo non automatizzabile con euristiche', issues: [] },
        ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
        notes: 'Rilancia con --ai per un confronto diretto tra la pagina a colori e la stessa in scala di grigi.'
      };
    }

    try {
      const colorShot = await page.screenshot().catch(() => null);
      if (!colorShot) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'error',
          automated: { ran: true, summary: 'Impossibile catturare lo screenshot a colori', issues: [] },
          ai: { attempted: false, skippedReason: null, verdict: null, findings: [] },
          notes: ''
        };
      }

      const styleHandle = await page.addStyleTag({ content: 'html { filter: grayscale(100%) !important; }' });
      await page.waitForTimeout(200);
      const grayShot = await page.screenshot().catch(() => null);
      await styleHandle.evaluate(el => el.remove()).catch(() => {});

      if (!grayShot) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'error',
          automated: { ran: true, summary: 'Impossibile catturare lo screenshot in scala di grigi', issues: [] },
          ai: { attempted: false, skippedReason: null, verdict: null, findings: [] },
          notes: ''
        };
      }

      const prompt = 'Confronta queste due immagini della stessa pagina web: la prima a colori, la seconda in scala di grigi ' +
        '(stessa immagine, solo desaturata). Secondo il criterio WCAG 1.4.1 (uso del colore), un\'informazione, un\'azione da ' +
        'compiere, o una distinzione visiva tra elementi (es. un link nel testo, un campo con errore, uno stato "attivo/' +
        'disattivo") deve rimanere percepibile anche senza il colore. Guardando la versione in scala di grigi, c\'è qualcosa che ' +
        'diventa ambiguo o indistinguibile rispetto alla versione a colori? Rispondi SOLO con un JSON: {"problema": true|false, ' +
        '"motivo": "spiegazione in una frase, in italiano, che descrive cosa si perde (o conferma che nulla si perde)", ' +
        '"suggerimento": "modifica proposta, o stringa vuota se non è un problema"}';

      const response = await askVision({
        apiKey: options.apiKey,
        prompt,
        images: [
          { base64: colorShot.toString('base64'), mediaType: 'image/png' },
          { base64: grayShot.toString('base64'), mediaType: 'image/png' }
        ]
      });
      const parsed = parseJSONResponse(response);
      const finding = {
        verdict: parsed?.problema === true ? 'problema' : (parsed?.problema === false ? 'nessun problema' : 'incerto'),
        reason: parsed?.motivo || response.trim(),
        suggerimento: parsed?.suggerimento || ''
      };

      return {
        id: this.id, name: this.name, level: this.level,
        status: finding.verdict === 'problema' ? 'fail' : 'pass',
        automated: { ran: true, summary: 'Nessun link nel testo distinguibile solo dal colore rilevato da axe-core; verificato il resto della pagina con un confronto colore/scala di grigi', issues: [] },
        ai: { attempted: true, skippedReason: null, verdict: finding.verdict === 'problema' ? 'fail' : 'pass', findings: [finding] },
        notes: 'Il confronto copre solo il viewport corrente, non l\'intera pagina: contenuto sotto la piega non è verificato da questo controllo.'
      };
    } catch (err) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'error',
        automated: { ran: true, summary: '', issues: [] },
        ai: { attempted: true, skippedReason: null, verdict: null, findings: [{ verdict: 'errore', reason: err.message }] },
        notes: ''
      };
    }
  }
};
