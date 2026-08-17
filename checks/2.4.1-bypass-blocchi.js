const AXE_RULES = ['bypass', 'skip-link'];
const SKIP_TEXT_RE = /salta|skip|vai al contenuto|vai al testo|passa al contenuto/i;

module.exports = {
  id: '2.4.1',
  name: 'Bypass dei blocchi',
  level: 'A',
  description: 'Deve esistere un meccanismo per saltare blocchi di contenuto ripetuti (un link "salta al contenuto", o una struttura di landmark/intestazioni) e raggiungere velocemente il contenuto principale.',
  remediation: 'Aggiungi un link "Salta al contenuto principale" come primo elemento focusabile della pagina, che sposti davvero il focus (non solo lo scroll) su un contenitore raggiungibile via tabindex="-1".',
  aiCapable: false,

  async run(ctx) {
    const { page, axeResults } = ctx;

    // axe copre già la presenza strutturale di un meccanismo di bypass (skip link,
    // landmark, gerarchia di intestazioni) e che un eventuale skip link abbia un
    // target effettivamente mettibile a fuoco. Se manca del tutto, fallimento certo.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `Nessun meccanismo di bypass rilevato (axe-core, regole: ${axeFailNodes.map(f => f.rule).join(', ')})`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core.'
      };
    }

    // axe conferma che ESISTE un meccanismo strutturale, ma non verifica se un vero
    // "skip link" testuale FUNZIONA davvero: cliccarlo deve spostare il FOCUS (non solo
    // far scrollare la pagina) su un contenuto raggiungibile. Verifica interamente
    // deterministica: nessun giudizio semantico coinvolto, l'AI non serve in nessun caso.
    await page.evaluate((re) => {
      const pattern = new RegExp(re, 'i');
      const cand = window.__a11yDeepQuery('a[href^="#"]').find(a => pattern.test(a.textContent || ''));
      if (cand) cand.setAttribute('data-a11y-skip-id', '0');
    }, SKIP_TEXT_RE.source);

    const selector = '[data-a11y-skip-id="0"]';

    try {
      const candidate = await page.evaluate((sel) => {
        const el = window.__a11yDeepQuery(sel)[0];
        return el ? { text: el.textContent.trim(), href: el.getAttribute('href') } : null;
      }, selector);

      if (!candidate) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: 'axe rileva un meccanismo di bypass (landmark/intestazioni), ma nessun classico "skip link" testuale da testare funzionalmente', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Verifica manualmente che la struttura di landmark permetta davvero una navigazione rapida al contenuto principale.'
        };
      }

      const targetId = (candidate.href || '').replace(/^#/, '');
      if (!targetId) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `Skip link trovato ("${candidate.text}") ma senza un href con ancora valida (#id)`, issues: [{ text: candidate.text, href: candidate.href }] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica interamente deterministica: nessun ruolo per l\'AI in questo criterio.'
        };
      }

      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      await page.focus(selector).catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(250);

      const outcome = await page.evaluate((id) => {
        const active = document.activeElement;
        const target = document.getElementById(id) ||
          document.querySelector(`[name="${CSS.escape(id)}"]`);
        return {
          targetExists: Boolean(target),
          movedFocus: Boolean(target) && Boolean(active) && (active === target || target.contains(active)),
          activeTag: active ? active.tagName.toLowerCase() : null
        };
      }, targetId);

      if (!outcome.targetExists) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `Skip link ("${candidate.text}") punta a #${targetId}, ma nessun elemento con quell'id esiste nella pagina`, issues: [{ text: candidate.text, href: candidate.href }] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica interamente deterministica: nessun ruolo per l\'AI in questo criterio.'
        };
      }

      if (!outcome.movedFocus) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: { ran: true, summary: `Attivare lo skip link ("${candidate.text}") non sposta il focus sul target #${targetId} (probabile scroll visivo senza tabindex sul target)`, issues: [{ text: candidate.text, href: candidate.href }] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica interamente deterministica: nessun ruolo per l\'AI in questo criterio.'
        };
      }

      return {
        id: this.id, name: this.name, level: this.level,
        status: 'pass',
        automated: { ran: true, summary: `Skip link ("${candidate.text}") funzionante: il focus si sposta correttamente su #${targetId}`, issues: [] },
        ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
        notes: ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-skip-id]').forEach(el => el.removeAttribute('data-a11y-skip-id'));
      }).catch(() => {});
    }
  }
};
