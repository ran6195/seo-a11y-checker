const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Euristica gratuita: confronta il testo visibile con un piccolo elenco di parole
// comuni in italiano/inglese, per intercettare il caso più frequente in pratica
// (template con lang="en" di default, contenuto reale in italiano, o viceversa)
// senza dover chiamare l'AI ogni volta.
const STOPWORDS = {
  it: ['il', 'la', 'lo', 'di', 'che', 'per', 'sono', 'con', 'non', 'una', 'gli', 'delle', 'della', 'questo', 'anche', 'nel', 'alla', 'dei', 'come', 'più'],
  en: ['the', 'and', 'is', 'of', 'to', 'in', 'for', 'are', 'with', 'this', 'that', 'not', 'you', 'your', 'have', 'from', 'more', 'about']
};

function scoreLang(text, words) {
  const lower = text.toLowerCase();
  return words.reduce((sum, w) => {
    const matches = lower.match(new RegExp(`\\b${w}\\b`, 'g'));
    return sum + (matches ? matches.length : 0);
  }, 0);
}

module.exports = {
  id: '3.1.1',
  name: 'Lingua della pagina',
  level: 'A',
  description: 'L\'elemento <html> deve dichiarare la lingua principale della pagina con un attributo lang valido.',
  remediation: 'Imposta lang sull\'elemento <html> con il codice corretto (es. lang="it" per contenuto in italiano), coerente con la lingua reale del testo.',
  aiCapable: true,
  wcagVersion: '2.1',

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // axe-core copre già l'assenza dell'attributo lang o un valore non valido (BCP47).
    // Se fallisce qui, è già un fallimento certo.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => v.id === 'html-has-lang' || v.id === 'html-lang-valid')
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `Attributo lang assente o non valido (axe-core, regole: ${axeFailNodes.map(f => f.rule).join(', ')})`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // axe verifica solo che il VALORE sia sintatticamente valido, non che corrisponda
    // alla lingua reale del contenuto. Qui l'euristica sulle parole comuni copre già
    // il caso più frequente (mismatch it/en); per altre lingue o casi ambigui serve l'AI.
    const { lang, textSample } = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute('lang') || '',
      textSample: (document.body.innerText || '').slice(0, 3000)
    }));

    const primary = lang.split('-')[0].toLowerCase();

    if (primary === 'it' || primary === 'en') {
      const scoreIt = scoreLang(textSample, STOPWORDS.it);
      const scoreEn = scoreLang(textSample, STOPWORDS.en);
      const declaredScore = primary === 'it' ? scoreIt : scoreEn;
      const otherScore = primary === 'it' ? scoreEn : scoreIt;

      if (declaredScore >= otherScore && declaredScore >= 5) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `lang="${lang}" coerente con il testo (euristica su parole comuni it/en: ${declaredScore} vs ${otherScore})`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Euristica limitata a italiano/inglese: per altre lingue dichiarate serve --ai o verifica manuale.'
        };
      }
    }

    if (!options.ai) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: { ran: true, summary: `lang="${lang}" dichiarato; l'euristica su parole comuni non è sufficiente a confermarlo (lingua non coperta, o punteggio ambiguo)`, issues: [{ lang }] },
        ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
        notes: 'Rilancia con --ai per un confronto diretto tra testo e lingua dichiarata.'
      };
    }

    const prompt = `L'attributo lang della pagina è "${lang}". Ecco un estratto del testo visibile: "${textSample.slice(0, 800)}". ` +
      'La lingua dichiarata corrisponde alla lingua reale in cui è scritto questo testo? Rispondi SOLO con un JSON: ' +
      '{"corretto": true|false, "motivo": "spiegazione in una frase, in italiano", "suggerimento": "codice lang corretto proposto, o stringa vuota se già corretto"}';

    try {
      const response = await askVision({ apiKey: options.apiKey, prompt });
      const parsed = parseJSONResponse(response);
      const verdict = parsed?.corretto === false ? 'non corretto' : (parsed?.corretto === true ? 'corretto' : 'incerto');
      const finding = { lang, verdict, reason: parsed?.motivo || response.trim(), suggerimento: parsed?.suggerimento || '' };

      return {
        id: this.id, name: this.name, level: this.level,
        status: verdict === 'non corretto' ? 'fail' : 'pass',
        automated: { ran: true, summary: `lang="${lang}" dichiarato, euristica non conclusiva`, issues: [{ lang }] },
        ai: { attempted: true, skippedReason: null, verdict: verdict === 'non corretto' ? 'fail' : 'pass', findings: [finding] },
        notes: ''
      };
    } catch (err) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'error',
        automated: { ran: true, summary: `lang="${lang}" dichiarato, euristica non conclusiva`, issues: [{ lang }] },
        ai: { attempted: true, skippedReason: null, verdict: null, findings: [{ lang, verdict: 'errore', reason: err.message }] },
        notes: ''
      };
    }
  }
};
