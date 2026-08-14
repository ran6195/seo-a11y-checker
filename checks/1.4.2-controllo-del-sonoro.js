const { askVision, parseJSONResponse } = require('./lib/anthropic');

const CONTROL_HINT_RE = /pausa|pause|stop|arresta|mute|muto|volume|play/i;

module.exports = {
  id: '1.4.2',
  name: 'Controllo del sonoro',
  level: 'A',
  description: 'Se un audio parte automaticamente e dura più di 3 secondi, deve esistere un meccanismo per metterlo in pausa, fermarlo, o controllarne il volume indipendentemente dal volume di sistema.',
  remediation: 'Rimuovi l\'autoplay, oppure aggiungi controlli nativi (attributo controls) o un pulsante play/pausa/mute personalizzato ben visibile accanto al contenuto multimediale.',

  async run(ctx) {
    const { page, options } = ctx;

    // axe-core non ha alcuna regola per questo criterio (autoplay è un comportamento
    // runtime, non un problema strutturale del markup isolato). Isoliamo qui i candidati:
    // audio/video con autoplay non mutati, e iframe di embed (YouTube/Vimeo e simili) con
    // autoplay nell'URL. La presenza di controlli nativi (attributo controls, o l'assenza
    // di controls=0 nell'URL dell'embed) è un segnale abbastanza forte da bastare da solo;
    // l'ambiguità reale (un controllo personalizzato esiste ma non si vede o non è chiaro,
    // o la durata è indeterminabile da qui) è ciò che l'AI aiuta a risolvere.
    const mediaCandidates = await page.evaluate(() => {
      return window.__a11yDeepQuery('audio, video')
        .filter(el => el.hasAttribute('autoplay') && !el.muted && !el.hasAttribute('muted'))
        .map((el, i) => {
          el.setAttribute('data-a11y-sound-id', `m${i}`);
          const r = el.getBoundingClientRect();
          const pad = 30;
          const container = el.closest('div, section, article, figure') || el.parentElement;
          const nearbyText = container ? container.textContent.slice(0, 300) : '';
          return {
            id: `m${i}`,
            selector: `[data-a11y-sound-id="m${i}"]`,
            tag: el.tagName.toLowerCase(),
            hasControls: el.hasAttribute('controls'),
            nearbyText,
            box: {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2)
            }
          };
        });
    });

    const iframeCandidates = await page.evaluate(() => {
      return window.__a11yDeepQuery('iframe')
        .filter(el => /autoplay(=1|=true)?\b/i.test(el.getAttribute('src') || ''))
        .map((el, i) => {
          el.setAttribute('data-a11y-sound-id', `f${i}`);
          const r = el.getBoundingClientRect();
          const pad = 10;
          return {
            id: `f${i}`,
            selector: `[data-a11y-sound-id="f${i}"]`,
            tag: 'iframe',
            hasControls: !/controls=0/i.test(el.getAttribute('src') || ''),
            src: (el.getAttribute('src') || '').slice(0, 150),
            box: {
              x: Math.max(0, Math.round(r.left - pad)),
              y: Math.max(0, Math.round(r.top - pad)),
              width: Math.round(r.width + pad * 2),
              height: Math.round(r.height + pad * 2)
            }
          };
        });
    });

    try {
      const all = [...mediaCandidates, ...iframeCandidates];

      if (all.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun audio/video con autoplay non mutato, né embed con autoplay nell\'URL', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: ''
        };
      }

      const withNativeControl = all.filter(m => m.hasControls);
      let suspects = all.filter(m => !m.hasControls);

      // Per i candidati audio/video senza attributo controls, un ultimo controllo gratuito:
      // esiste un elemento vicino (bottone, testo) che sembra un controllo di riproduzione
      // personalizzato? Se sì li spostiamo comunque tra i sospetti (serve comunque un
      // giudizio visivo per capire se è davvero funzionale), ma lo segnaliamo nell'issue.
      suspects = suspects.map(s => ({ ...s, hasNearbyHint: CONTROL_HINT_RE.test(s.nearbyText || '') }));

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'pass',
          automated: { ran: true, summary: `${all.length} elementi con autoplay trovati, tutti con un meccanismo di controllo nativo (controls, o embed senza controls=0)`, issues: [] },
          ai: { attempted: false, skippedReason: 'not-needed', verdict: null, findings: [] },
          notes: 'La presenza di un controllo nativo è sufficiente indipendentemente dalla durata effettiva della riproduzione.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${suspects.length}/${all.length} elementi con autoplay privi di controlli nativi (${withNativeControl.length} con controlli nativi già a posto)`,
            issues: suspects.map(s => ({ selector: s.selector, tag: s.tag, hasNearbyHint: s.hasNearbyHint }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per uno screenshot e un giudizio su un eventuale controllo personalizzato; se il contenuto dura ≤3 secondi il criterio non si applica comunque (non verificabile automaticamente da qui).'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          if (item.box.width <= 0 || item.box.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }
          const screenshotBuffer = await page.screenshot({ clip: item.box }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un elemento ${item.tag} che riproduce audio automaticamente (autoplay), con un margine ` +
            'di contesto attorno. È visibile un controllo funzionale (pulsante play/pausa, stop, o regolazione del volume) che permetta di ' +
            'fermare o controllare il suono indipendentemente dal volume di sistema? Rispondi SOLO con un JSON: {"controllo_presente": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "modifica proposta, o stringa vuota se già presente"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, tag: item.tag,
            verdict: parsed?.controllo_presente === false ? 'assente' : (parsed?.controllo_presente === true ? 'presente' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, tag: item.tag, verdict: 'errore', reason: err.message });
        }
      }

      const assenti = findings.filter(f => f.verdict === 'assente');

      return {
        id: this.id, name: this.name, level: this.level,
        status: assenti.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${suspects.length}/${all.length} elementi senza controlli nativi, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, tag: s.tag }))
        },
        ai: { attempted: true, skippedReason: null, verdict: assenti.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-sound-id]').forEach(el => el.removeAttribute('data-a11y-sound-id'));
      }).catch(() => {});
    }
  }
};
