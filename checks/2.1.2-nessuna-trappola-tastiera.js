const { askVision, parseJSONResponse } = require('./lib/anthropic');

const MAX_TAB_STEPS = 200;
const VERIFY_STEPS = 12;
// Un <input type="date"/"time"/"datetime-local"/"number"> nativo è composto da più segmenti
// interni (giorno/mese/anno, ore/minuti) che Tab attraversa SENZA cambiare
// document.activeElement per diversi passaggi: senza questo margine verrebbe scambiato per
// una trappola già dopo un solo elemento. Vedi checks/2.4.7-focus-visibile.js per lo stesso fix.
const MAX_SAME_ELEMENT_RETRIES = 8;
// Quando questo script gira dopo altri Tab-walk sulla stessa pagina (checks/run.js/run-site.js
// eseguono tutti i criteri in sequenza), il primo Tab può atterrare in modo transitorio su
// <body> invece che sul primo elemento reale. Vedi checks/2.4.7-focus-visibile.js per lo
// stesso fix e i dettagli.
const MAX_INITIAL_BODY_RETRIES = 3;
const TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], audio[controls], video[controls], details > summary, iframe';

module.exports = {
  id: '2.1.2',
  name: 'Nessuna trappola per la tastiera',
  level: 'A',
  description: 'Se il focus della tastiera può essere spostato su un componente usando solo la tastiera, deve poter essere spostato via da quel componente usando solo la tastiera; se serve più della semplice freccia/Tab, l\'utente deve esserne informato.',
  remediation: 'Verifica che nessun componente intercetti keydown impedendo a Tab/Shift+Tab di uscirne; se un widget (es. un modale) intrappola volutamente il focus mentre è aperto, assicurati che il tasto Escape lo chiuda e restituisca il focus alla pagina.',

  // Riusa lo stesso Tab-walk reale (non focus programmatico) di checks/2.4.7-focus-visibile.js.
  // Test interamente funzionale, non un giudizio visivo: una vera trappola per la tastiera
  // si dimostra empiricamente (il focus non riesce a uscire da un sottoinsieme di elementi
  // nemmeno dopo altri tentativi e dopo Escape, la convenzione standard per uscirne), quindi
  // l'AI non serve mai qui — stesso principio già seguito da 2.4.1 (bypass dei blocchi).
  async run(ctx) {
    const { page, options } = ctx;

    const candidateCount = await page.evaluate((sel) => {
      return window.__a11yDeepQuery(sel).filter(el => el.offsetParent !== null).length;
    }, TABBABLE_SELECTOR);

    if (candidateCount === 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'not-applicable',
        automated: { ran: true, summary: 'Nessun elemento raggiungibile con Tab', issues: [] },
        ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
        notes: ''
      };
    }

    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

    const focused = [];
    let outcome = 'max-steps';
    let repeatToId = null;
    let sameElementStreak = 0;
    let initialBodyRetries = 0;

    for (let i = 0; i < MAX_TAB_STEPS; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate((id) => {
        const el = document.activeElement;
        if (!el || el === document.body) return { left: true };
        const existingId = el.getAttribute('data-a11y-trap-id');
        if (existingId !== null) return { repeat: true, id: Number(existingId) };
        el.setAttribute('data-a11y-trap-id', String(id));
        return { repeat: false, left: false, id, tag: el.tagName.toLowerCase(), text: (el.textContent || el.value || '').trim().slice(0, 40) };
      }, focused.length).catch(() => ({ left: true }));

      if (info.left) {
        if (focused.length === 0 && initialBodyRetries < MAX_INITIAL_BODY_RETRIES) {
          initialBodyRetries++;
          continue;
        }
        outcome = 'left-page'; break;
      }
      if (info.repeat) {
        if (info.id === focused.length - 1 && sameElementStreak < MAX_SAME_ELEMENT_RETRIES) {
          sameElementStreak++;
          continue;
        }
        outcome = 'repeat'; repeatToId = info.id; break;
      }
      sameElementStreak = 0;
      focused.push(info);
    }

    try {
      if (outcome === 'left-page') {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `Tabulazione completata: ${focused.length} elementi raggiunti (~${candidateCount} candidati stimati), il focus è uscito naturalmente dalla pagina senza restare intrappolato`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica funzionale (Tab reale): se il focus esce dalla pagina non c\'è alcuna trappola da giudicare.'
        };
      }

      if (outcome === 'max-steps') {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: `Raggiunti ${MAX_TAB_STEPS} passi di Tab senza mai ripetere un elemento né uscire dalla pagina (~${candidateCount} candidati stimati): pagina troppo estesa per concludere entro il limite`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Nessun ciclo rilevato nell\'intervallo analizzato: non è la firma tipica di una trappola, ma di una pagina più lunga del limite di passi. Verifica manuale consigliata su pagine molto estese.'
        };
      }

      // outcome === 'repeat': il focus è tornato su un elemento già visitato. Se torna al
      // primissimo elemento (id 0) dopo aver praticamente visitato tutto il resto della
      // pagina, è un normale ciclo completo (alcuni siti implementano un wrap-around
      // manuale invece di lasciare uscire il focus dal documento), non una trappola.
      if (repeatToId === 0 && focused.length >= candidateCount - 3) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `Il focus completa un ciclo pieno sulla pagina (${focused.length} elementi, poi torna al primo) senza restare bloccato in un sottoinsieme`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Wrap-around completo (torna al primo elemento dopo aver visitato tutti gli altri): equivalente a uscire dalla pagina, non è una trappola.'
        };
      }

      // Il ciclo si chiude su un elemento che NON è il primo, prima di aver raggiunto
      // tutti i candidati stimati: è la firma di un sottoinsieme isolato. Verifichiamo se
      // è un blocco insormontabile (bug) o un focus-trap intenzionale ma conforme (es. un
      // modale aperto) provando Escape, la convenzione standard per uscirne (tecnica G21).
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);

      let escapedWithNew = false;
      for (let i = 0; i < VERIFY_STEPS; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate((id) => {
          const el = document.activeElement;
          if (!el || el === document.body) return { left: true };
          const existingId = el.getAttribute('data-a11y-trap-id');
          if (existingId !== null) return { repeat: true };
          el.setAttribute('data-a11y-trap-id', String(id));
          return { repeat: false, left: false, id };
        }, focused.length).catch(() => ({ left: true }));

        if (info.left) { escapedWithNew = true; break; }
        if (!info.repeat) { escapedWithNew = true; focused.push(info); break; }
      }

      const trappedSubset = focused.length - repeatToId;

      if (escapedWithNew) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: {
            ran: true,
            summary: `Il focus era ciclico su un sottoinsieme di ~${trappedSubset} elementi (a partire dall'elemento #${repeatToId}), ma Escape (o la prosecuzione con Tab) permette di uscirne verso nuovi elementi`,
            issues: []
          },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Probabile focus-trap intenzionale e conforme (es. un componente modale) risolvibile con la convenzione standard Escape.'
        };
      }

      // Escape non ha liberato il focus. Prima di dichiarare una trappola certa, verifichiamo
      // se il sottoinsieme ciclico contiene almeno un elemento azionabile (bottone/link): è il
      // caso tipico di un banner cookie o un modale che si chiude con Tab+Invio sul proprio
      // pulsante "Accetta"/"×", non con Escape — un metodo standard e prevedibile da tastiera,
      // non una trappola vera. Non lo attiviamo noi stessi (evitiamo di cliccare "accetta" su
      // siti reali): senza un modo sicuro di confermarlo, il caso resta ambiguo, non un fallimento certo.
      const trappedIds = [];
      for (let id = repeatToId; id < focused.length; id++) trappedIds.push(id);

      const trappedInfo = await page.evaluate((ids) => {
        return ids.map(id => {
          const el = window.__a11yDeepQuery(`[data-a11y-trap-id="${id}"]`)[0];
          if (!el) return null;
          const tag = el.tagName.toLowerCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const r = el.getBoundingClientRect();
          const pad = 16;
          return {
            id, tag, role,
            text: (el.textContent || el.value || '').trim().slice(0, 40),
            actionable: ['button', 'a'].includes(tag) || ['button', 'link', 'menuitem'].includes(role),
            box: {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2)
            }
          };
        }).filter(Boolean);
      }, trappedIds);

      const actionable = trappedInfo.filter(t => t.actionable);

      if (actionable.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'fail',
          automated: {
            ran: true,
            summary: `Il focus resta bloccato in un ciclo di ~${trappedSubset} elementi (a partire dall'elemento #${repeatToId}): né altri ${VERIFY_STEPS} Tab né Escape permettono di raggiungere elementi nuovi o di uscire dalla pagina, e nessuno degli elementi nel ciclo è un bottone/link azionabile che potrebbe chiuderlo`,
            issues: [{ startId: repeatToId }]
          },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'Verifica interamente funzionale (Tab/Escape reali): nessun ruolo per l\'AI, la trappola è confermata empiricamente riprovando più volte, senza alcun controllo visibile per uscirne.'
        };
      }

      const summary = `Il focus resta bloccato in un ciclo di ~${trappedSubset} elementi (a partire dall'elemento #${repeatToId}); Escape non lo libera, ma il ciclo contiene ${actionable.length} elemento/i azionabile/i (es. ${actionable.map(a => `${a.tag} "${a.text}"`).slice(0, 2).join(', ')}) che potrebbero chiuderlo se attivati — non testato per evitare di interagire con controlli come "accetta cookie" su un sito reale`;

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary, issues: actionable.map(a => ({ tag: a.tag, text: a.text })) },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio visivo: probabile modale/banner conforme (es. cookie) risolvibile con Tab+Invio sul bottone, o vera trappola. Verifica manuale consigliata in ogni caso.'
        };
      }

      const minX = Math.min(...actionable.map(a => a.box.x));
      const minY = Math.min(...actionable.map(a => a.box.y));
      const maxX = Math.max(...actionable.map(a => a.box.x + a.box.width));
      const maxY = Math.max(...actionable.map(a => a.box.y + a.box.height));
      const unionBox = { x: minX, y: minY, width: Math.min(maxX - minX, 1200), height: Math.min(maxY - minY, 1000) };

      try {
        const screenshotBuffer = unionBox.width > 0 && unionBox.height > 0 ? await page.screenshot({ clip: unionBox }).catch(() => null) : null;
        if (!screenshotBuffer) {
          return {
            id: this.id, name: this.name, level: this.level,
            status: 'needs-review',
            automated: { ran: true, summary, issues: actionable.map(a => ({ tag: a.tag, text: a.text })) },
            ai: { attempted: true, skippedReason: null, verdict: null, findings: [{ verdict: 'errore', reason: 'impossibile catturare lo screenshot' }] },
            notes: 'Verifica manuale consigliata.'
          };
        }

        const prompt = `Su una pagina web, il focus da tastiera resta intrappolato in un ciclo di elementi che comprende: ` +
          `${actionable.map(a => `${a.tag} "${a.text}"`).join(', ')}. Il tasto Escape non libera il focus. Questo è lo screenshot ` +
          'della zona interessata. In base all\'aspetto, sembra un componente modale legittimo (es. un banner cookie, un popup ' +
          'newsletter, una finestra di dialogo) dove un utente da tastiera potrebbe ragionevolmente tabulare fino a uno dei bottoni ' +
          'visibili e premere Invio per chiuderlo e liberare il focus? Oppure sembra un blocco senza alcuna via d\'uscita chiara? ' +
          'Rispondi SOLO con un JSON: {"modale_legittimo": true|false, "motivo": "spiegazione in una frase, in italiano"}';

        const response = await askVision({
          apiKey: options.apiKey,
          prompt,
          images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
        });
        const parsed = parseJSONResponse(response);
        const verdict = parsed?.modale_legittimo === true ? 'modale legittimo' : (parsed?.modale_legittimo === false ? 'trappola' : 'incerto');

        return {
          id: this.id, name: this.name, level: this.level,
          status: verdict === 'trappola' ? 'fail' : 'needs-review',
          automated: { ran: true, summary, issues: actionable.map(a => ({ tag: a.tag, text: a.text })) },
          ai: {
            attempted: true, skippedReason: null, verdict: verdict === 'trappola' ? 'fail' : null,
            findings: [{ verdict, reason: parsed?.motivo || response.trim() }]
          },
          notes: 'Il giudizio AI è basato solo sull\'aspetto visivo, non sull\'attivazione reale del bottone: verifica manuale consigliata per confermare che Tab+Invio funzioni davvero.'
        };
      } catch (err) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary, issues: actionable.map(a => ({ tag: a.tag, text: a.text })) },
          ai: { attempted: true, skippedReason: null, verdict: null, findings: [{ verdict: 'errore', reason: err.message }] },
          notes: 'Verifica manuale consigliata.'
        };
      }
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-trap-id]').forEach(el => el.removeAttribute('data-a11y-trap-id'));
      }).catch(() => {});
    }
  }
};
