const { askVision, parseJSONResponse } = require('./lib/anthropic');

const AXE_RULES = ['empty-heading'];
const GENERIC_HEADING_RE = /^(titolo|title|sezione|section|senza titolo|untitled|heading|intestazione)\s*\d*$/i;
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

// Nota di scope: questo script valuta solo le INTESTAZIONI (h1-h6/role=heading).
// La qualità delle etichette dei campi form è coperta separatamente da 3.3.2,
// per non far controllare due volte la stessa cosa da script diversi.
module.exports = {
  id: '2.4.6',
  name: 'Intestazioni ed etichette',
  level: 'AA',
  description: 'Le intestazioni e le etichette devono descrivere l\'argomento o lo scopo del contenuto che introducono.',
  remediation: 'Riscrivi l\'intestazione perché comunichi il contenuto della sezione, non solo un nome proprio o un\'etichetta generica (es. invece di "Titolo" o un nome e basta, aggiungi il ruolo/argomento: "Yuri Cestari — Chef Executive").',
  aiCapable: true,

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} intestazioni vuote (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore.'
      };
    }

    // offsetParent === null esclude intestazioni non renderizzate (display:none),
    // es. varianti duplicate per breakpoint diversi tenute nascoste via CSS.
    await page.evaluate((sel) => {
      window.__a11yDeepQuery(sel)
        .filter(el => el.offsetParent !== null)
        .forEach((el, i) => el.setAttribute('data-a11y-heading-id', String(i)));
    }, HEADING_SELECTOR);

    try {
      const headings = await page.evaluate(() => {
        function followingText(headingEl, maxLen) {
          const headingTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
          // I temi (Shopify in testa) iniettano spesso un <style> scoped subito dopo
          // un'intestazione, per il CSS di quel singolo blocco. Senza escluderlo,
          // .textContent restituisce CSS grezzo invece del vero contenuto della
          // sezione, e l'AI giudica "non descrittiva" un'intestazione confrontandola
          // con del codice, non con quello che un utente vede davvero.
          const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
          function cleanText(el) {
            if (SKIP_TAGS.has(el.tagName)) return '';
            return Array.from(el.childNodes).map(n => {
              if (n.nodeType === 3) return n.textContent;
              if (n.nodeType === 1) return cleanText(n);
              return '';
            }).join(' ');
          }
          function next(n) {
            if (n.nextElementSibling) return n.nextElementSibling;
            return n.parentElement ? next(n.parentElement) : null;
          }
          let text = '';
          let cur = next(headingEl);
          let guard = 0;
          while (cur && text.length < maxLen && guard < 20) {
            guard++;
            if (headingTags.has(cur.tagName) || cur.getAttribute('role') === 'heading') break;
            text += ' ' + cleanText(cur).replace(/\s+/g, ' ').trim();
            cur = cur.nextElementSibling || next(cur);
          }
          return text.trim().slice(0, maxLen);
        }

        return window.__a11yDeepQuery('[data-a11y-heading-id]').map(el => ({
          index: Number(el.getAttribute('data-a11y-heading-id')),
          level: el.tagName.startsWith('H') ? el.tagName.toLowerCase() : `role=heading(${el.getAttribute('aria-level') || '?'})`,
          text: (el.textContent || '').trim(),
          following: followingText(el, 200),
          selector: `[data-a11y-heading-id="${el.getAttribute('data-a11y-heading-id')}"]`
        }));
      });

      const textCounts = new Map();
      headings.forEach(h => {
        const key = h.level + '|' + h.text.toLowerCase();
        textCounts.set(key, (textCounts.get(key) || 0) + 1);
      });

      const candidates = headings.filter(h => {
        const generic = GENERIC_HEADING_RE.test(h.text) || h.text.length <= 2;
        const duplicated = (textCounts.get(h.level + '|' + h.text.toLowerCase()) || 0) > 1;
        return generic || duplicated;
      });

      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: headings.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${headings.length} intestazioni controllate, nessun pattern sospetto`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica copre solo testo generico o duplicato: non garantisce che ogni intestazione descriva davvero la sezione.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${candidates.length}/${headings.length} intestazioni con testo generico o duplicato`,
            issues: candidates.map(c => ({ selector: c.selector, level: c.level, text: c.text }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio su quanto ogni intestazione descriva la sezione che segue.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = candidates.slice(0, limit);
      const findings = [];

      for (const h of toCheck) {
        try {
          const prompt = `Un'intestazione <${h.level}> ha il testo "${h.text}". Il contenuto che segue inizia così: ` +
            `"${h.following || '(vuoto)'}". Secondo il criterio WCAG 2.4.6, questa intestazione descrive adeguatamente ` +
            'la sezione che introduce? Se non lo è, proponi un\'intestazione migliore. Rispondi SOLO con un JSON: ' +
            '{"descrittiva": true|false, "motivo": "spiegazione in una frase, in italiano", ' +
            '"suggerimento": "intestazione proposta, o stringa vuota se già descrittiva"}';

          const response = await askVision({ apiKey: options.apiKey, prompt });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...h,
            verdict: parsed?.descrittiva === false ? 'non descrittiva' : (parsed?.descrittiva === true ? 'descrittiva' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...h, verdict: 'errore', reason: err.message });
        }
      }

      const nonDescrittive = findings.filter(f => f.verdict === 'non descrittiva');

      return {
        id: this.id, name: this.name, level: this.level,
        status: nonDescrittive.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${candidates.length}/${headings.length} candidati da euristica, ${toCheck.length} verificati con AI`,
          issues: candidates.map(c => ({ selector: c.selector, level: c.level, text: c.text }))
        },
        ai: { attempted: true, skippedReason: null, verdict: nonDescrittive.length > 0 ? 'fail' : 'pass', findings },
        notes: candidates.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-heading-id]').forEach(el => el.removeAttribute('data-a11y-heading-id'));
      }).catch(() => {});
    }
  }
};
