const MAX_TAB_STEPS = 200;
// Stessa tolleranza di checks/2.4.7-focus-visibile.js (e 2.1.2/2.4.3): un <input
// type="date"/"time"> nativo richiede più Tab per muoversi tra i propri segmenti interni
// restando sullo stesso elemento, e il primo Tab dopo un altro script basato su Tab-walk
// può atterrare in modo transitorio su <body>. Vedi quel file per i dettagli.
const MAX_SAME_ELEMENT_RETRIES = 8;
const MAX_INITIAL_BODY_RETRIES = 3;

module.exports = {
  id: '2.4.11',
  name: 'Focus non oscurato (minimo)',
  level: 'AA',
  description: 'Quando un componente riceve il focus da tastiera, non deve restare interamente nascosto da contenuto creato dall\'autore (es. un header, banner o cookie bar in posizione fissa/sticky).',
  remediation: 'Aggiungi scroll-margin-top (o scroll-padding-top sul contenitore scrollabile) pari all\'altezza degli elementi fissi/sticky, così il browser lascia spazio per l\'elemento a fuoco quando lo scrolla in vista; in alternativa riduci lo z-index o la persistenza dell\'elemento che lo copre.',
  aiCapable: false,
  wcagVersion: '2.2',

  // Riusa lo stesso Tab-walk reale di 2.4.7/2.1.2/2.4.3. Il controllo se l'elemento è
  // "interamente nascosto" avviene DENTRO lo stesso passo del walk, subito dopo che
  // riceve il focus (quando il browser lo ha appena scrollato in vista): un secondo
  // passaggio successivo, dopo aver continuato a tabulare su altri elementi, leggerebbe
  // coordinate ormai sbagliate perché la pagina nel frattempo si è scrollata altrove.
  // document.elementFromPoint() su centro + 4 angoli del box è un test geometrico
  // interamente deterministico: nessun ruolo per l'AI, né sul fallimento né sul successo.
  async run(ctx) {
    const { page } = ctx;

    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

    const focused = [];
    let sameElementStreak = 0;
    let initialBodyRetries = 0;

    for (let i = 0; i < MAX_TAB_STEPS; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate((id) => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const existingId = el.getAttribute('data-a11y-obscured-id');
        if (existingId !== null) return { repeat: true, id: Number(existingId) };
        el.setAttribute('data-a11y-obscured-id', String(id));

        const r = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || el.value || '').trim().slice(0, 40);
        const selector = `[data-a11y-obscured-id="${id}"]`;

        if (r.width <= 0 || r.height <= 0) {
          // Non renderizzato/dimensioni nulle: non è questo il criterio da segnalare qui.
          return { repeat: false, id, tag, text, selector, obscured: false };
        }

        const pad = 1; // margine minimo per non campionare esattamente sul bordo
        const points = [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + pad, r.top + pad],
          [r.right - pad, r.top + pad],
          [r.left + pad, r.bottom - pad],
          [r.right - pad, r.bottom - pad]
        ].filter(([x, y]) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight);

        // Se nessun punto ricade nel viewport l'elemento non è visibile a schermo per
        // motivi che esulano da questo criterio (es. troppo grande, o scroll fallito):
        // di default non lo segnaliamo come "oscurato", per evitare falsi positivi.
        const visible = points.length === 0 || points.some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit === el || el.contains(hit);
        });

        return { repeat: false, id, tag, text, selector, obscured: !visible };
      }, focused.length).catch(() => null);

      if (!info) {
        if (focused.length === 0 && initialBodyRetries < MAX_INITIAL_BODY_RETRIES) {
          initialBodyRetries++;
          continue;
        }
        break;
      }

      if (info.repeat) {
        if (info.id === focused.length - 1 && sameElementStreak < MAX_SAME_ELEMENT_RETRIES) {
          sameElementStreak++;
          continue;
        }
        break;
      }

      sameElementStreak = 0;
      focused.push(info);
    }

    try {
      if (focused.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun elemento raggiungibile con Tab', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const obscured = focused.filter(f => f.obscured);

      if (obscured.length > 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: {
            ran: true,
            summary: `${obscured.length}/${focused.length} elementi risultano interamente coperti da altro contenuto quando ricevono il focus`,
            issues: obscured.map(o => ({ selector: o.selector, tag: o.tag, text: o.text }))
          },
          ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
          notes: 'Verifica geometrica (document.elementFromPoint su centro e 4 angoli del box): nessun punto campionato restituisce l\'elemento a fuoco o un suo discendente, quindi risulta interamente nascosto — tipicamente un header/banner in posizione fissa o sticky.'
        };
      }

      return {
        id: this.id, name: this.name, level: this.level,
        status: 'pass',
        automated: { ran: true, summary: `${focused.length} elementi raggiunti via Tab, nessuno risulta interamente coperto quando riceve il focus`, issues: [] },
        ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
        notes: ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-obscured-id]').forEach(el => el.removeAttribute('data-a11y-obscured-id'));
      }).catch(() => {});
    }
  }
};
