const { askVision, parseJSONResponse } = require('./lib/anthropic');

// Stessa euristica di checks/3.1.1-lingua-pagina.js (parole comuni it/en), applicata qui
// a singoli blocchi di testo invece che all'intera pagina: individua paragrafi/blocchi la
// cui lingua dominante sembra diversa da quella dichiarata sull'<html>, e privi di un
// proprio attributo lang che lo dichiari esplicitamente.
const STOPWORDS = {
  it: ['il', 'la', 'lo', 'di', 'che', 'per', 'sono', 'con', 'non', 'una', 'gli', 'delle', 'della', 'questo', 'anche', 'nel', 'alla', 'dei', 'come', 'più'],
  en: ['the', 'and', 'is', 'of', 'to', 'in', 'for', 'are', 'with', 'this', 'that', 'not', 'you', 'your', 'have', 'from', 'more', 'about']
};
const BLOCK_SELECTOR = 'p, li, blockquote, td, dd';
const MIN_LENGTH = 40;

function scoreLang(text, words) {
  const lower = text.toLowerCase();
  return words.reduce((sum, w) => {
    const matches = lower.match(new RegExp(`\\b${w}\\b`, 'g'));
    return sum + (matches ? matches.length : 0);
  }, 0);
}

module.exports = {
  id: '3.1.2',
  name: 'Lingua di parti componenti',
  level: 'AA',
  description: 'Ogni brano di testo (o frase) in una lingua diversa da quella principale della pagina deve avere un attributo lang che ne identifichi la lingua.',
  remediation: 'Aggiungi lang="codice" (es. lang="en") sull\'elemento che racchiude il brano di testo in lingua diversa (una citazione, un blocco tradotto, un termine straniero corposo), non solo sull\'<html> principale.',

  async run(ctx) {
    const { page, options } = ctx;

    const pageLang = await page.evaluate(() => (document.documentElement.getAttribute('lang') || '').split('-')[0].toLowerCase());

    if (pageLang !== 'it' && pageLang !== 'en') {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'needs-review',
        automated: { ran: true, summary: `Lingua principale dichiarata "${pageLang || '(assente)'}", non coperta dall'euristica su parole comuni (solo it/en)`, issues: [] },
        ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
        notes: 'Verifica manuale consigliata per pagine con lingua principale diversa da italiano/inglese.'
      };
    }

    await page.evaluate((sel) => {
      const accepted = [];
      window.__a11yDeepQuery(sel).forEach(el => {
        if (el.offsetParent === null) return;
        if ((el.textContent || '').trim().length < 40) return;
        // Salta i blocchi già dentro un blocco già accettato (evita doppio conteggio di
        // testo annidato, es. un <li> con un <p> dentro entrambi nel selettore).
        if (accepted.some(a => a.contains(el))) return;
        accepted.push(el);
      });
      accepted.forEach((el, i) => el.setAttribute('data-a11y-partlang-id', String(i)));
    }, BLOCK_SELECTOR);

    try {
      const blocks = await page.evaluate(() => {
        return window.__a11yDeepQuery('[data-a11y-partlang-id]').map(el => ({
          index: Number(el.getAttribute('data-a11y-partlang-id')),
          selector: `[data-a11y-partlang-id="${el.getAttribute('data-a11y-partlang-id')}"]`,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 500),
          ownLang: el.closest('[lang]') ? el.closest('[lang]').getAttribute('lang') : ''
        }));
      });

      const withoutLang = blocks.filter(b => !b.ownLang);

      if (withoutLang.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: blocks.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${blocks.length} blocchi di testo controllati, tutti già entro un elemento con lang esplicito o troppo pochi per l'analisi`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const other = pageLang === 'it' ? 'en' : 'it';
      const suspects = withoutLang
        .map(b => {
          const scoreOwn = scoreLang(b.text, STOPWORDS[pageLang]);
          const scoreOther = scoreLang(b.text, STOPWORDS[other]);
          return { ...b, scoreOwn, scoreOther };
        })
        .filter(b => b.scoreOther >= 4 && b.scoreOther > b.scoreOwn);

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${withoutLang.length} blocchi senza lang locale controllati, nessuno sembra in una lingua diversa da quella dichiarata (${pageLang})`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Euristica limitata a italiano/inglese e a blocchi di testo abbastanza lunghi: brevi termini o frasi corte in altra lingua non sono rilevabili così.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${suspects.length}/${withoutLang.length} blocchi senza lang locale sembrano scritti in ${other} mentre la pagina dichiara ${pageLang}`,
            issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, text: s.text.slice(0, 100) }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per una conferma diretta della lingua di ciascun blocco.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          const prompt = `La lingua principale dichiarata della pagina è "${pageLang}". Ecco un brano di testo estratto da un blocco privo ` +
            `di un proprio attributo lang: "${item.text}". Questo brano è scritto in una lingua diversa da "${pageLang}"? Se sì, quale codice ` +
            'lang (es. en, fr, de) dovrebbe avere questo blocco? Rispondi SOLO con un JSON: {"lingua_diversa": true|false, ' +
            '"codice_lang": "codice proposto, o stringa vuota se non diversa", "motivo": "spiegazione in una frase, in italiano"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag, text: item.text.slice(0, 100),
            verdict: parsed?.lingua_diversa === true ? 'lingua diversa' : (parsed?.lingua_diversa === false ? 'stessa lingua' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.lingua_diversa === true ? `lang="${parsed?.codice_lang || other}"` : ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, verdict: 'errore', reason: err.message });
        }
      }

      const linguaDiversa = findings.filter(f => f.verdict === 'lingua diversa');

      return {
        id: this.id, name: this.name, level: this.level,
        status: linguaDiversa.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length} blocchi sospetti su ${withoutLang.length} senza lang locale, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, text: s.text.slice(0, 100) }))
        },
        ai: { attempted: true, skippedReason: null, verdict: linguaDiversa.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} blocchi sospetti sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-partlang-id]').forEach(el => el.removeAttribute('data-a11y-partlang-id'));
      }).catch(() => {});
    }
  }
};
