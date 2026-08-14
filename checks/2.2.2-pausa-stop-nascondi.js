const { askVision, parseJSONResponse } = require('./lib/anthropic');
const { getPaddedBox } = require('./lib/browser');

const CAROUSEL_CLASS_RE = /carousel|slider|swiper|slick|owl-carousel|splide/i;
const CONTROL_HINT_RE = /pausa|pause|stop|ferma|play/i;
const ANIMATION_CANDIDATE_SELECTOR = 'div, section, span, ul, li, img, svg, a';

module.exports = {
  id: '2.2.2',
  name: 'Pausa, stop, nascondi',
  level: 'A',
  description: 'Per contenuto in movimento, lampeggiante, scorrevole o che si aggiorna automaticamente, che parte in automatico, dura più di 5 secondi ed è presentato insieme ad altro contenuto, l\'utente deve poter metterlo in pausa, fermarlo o nasconderlo.',
  remediation: 'Aggiungi un pulsante play/pausa ben visibile e funzionale (raggiungibile da tastiera) su carousel, animazioni e contenuti che si aggiornano da soli; in alternativa rispetta prefers-reduced-motion o evita l\'avvio automatico.',

  async run(ctx) {
    const { page, options } = ctx;

    // axe-core non ha una regola per questo criterio (comportamento runtime, non markup
    // statico). Isoliamo qui tre firme comuni di contenuto in movimento automatico: video/
    // audio con loop, <marquee>, container di classiche librerie carousel/slider, e
    // animazioni CSS con iterazione infinita su elementi di dimensione non trascurabile
    // (per scartare piccoli spinner di caricamento, che non sono "contenuto" nel senso del
    // criterio). La presenza di un controllo di pausa vicino è un segnale forte ma non
    // sufficiente da solo: la verifica se sia davvero funzionale resta compito dell'AI.
    const candidates = await page.evaluate(({ sel, carouselRe }) => {
      const found = [];
      const re = new RegExp(carouselRe, 'i');

      window.__a11yDeepQuery('marquee').forEach(el => found.push({ el, kind: 'marquee' }));
      window.__a11yDeepQuery('video[autoplay][loop], audio[autoplay][loop]').forEach(el => {
        found.push({ el, kind: `${el.tagName.toLowerCase()} in loop automatico` });
      });
      window.__a11yDeepQuery(sel).forEach(el => {
        if (found.some(f => f.el === el)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 40) return;
        if (re.test(el.className || '')) {
          found.push({ el, kind: 'carousel/slider (classe riconosciuta)' });
          return;
        }
        const s = getComputedStyle(el);
        if (s.animationIterationCount === 'infinite' && s.animationPlayState !== 'paused' && parseFloat(s.animationDuration) > 0) {
          found.push({ el, kind: 'animazione CSS a ciclo infinito' });
        }
      });

      return found.map((f, i) => {
        f.el.setAttribute('data-a11y-motion-id', String(i));
        const r = f.el.getBoundingClientRect();
        const container = f.el.closest('div, section, article') || f.el.parentElement;
        const nearbyText = container ? container.textContent.slice(0, 300) : '';
        const pad = 20;
        return {
          index: i,
          selector: `[data-a11y-motion-id="${i}"]`,
          kind: f.kind,
          nearbyText,
          box: {
            x: Math.max(0, Math.round(r.left - pad)),
            y: Math.max(0, Math.round(r.top - pad)),
            width: Math.round(r.width + pad * 2),
            height: Math.round(r.height + pad * 2)
          }
        };
      });
    }, { sel: ANIMATION_CANDIDATE_SELECTOR, carouselRe: CAROUSEL_CLASS_RE.source });

    try {
      if (candidates.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'not-applicable',
          automated: { ran: true, summary: 'Nessun contenuto in movimento automatico rilevato (video/audio in loop, marquee, carousel riconosciuto, animazione CSS infinita)', issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'Euristica basata su firme comuni: non rileva animazioni pilotate via JavaScript senza classi riconoscibili né aggiornamenti automatici di contenuto (es. ticker via fetch periodico).'
        };
      }

      const suspects = candidates.map(c => ({ ...c, hasNearbyHint: CONTROL_HINT_RE.test(c.nearbyText || '') }));
      const withHint = suspects.filter(s => s.hasNearbyHint);
      const withoutHint = suspects.filter(s => !s.hasNearbyHint);

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: {
            ran: true,
            summary: `${candidates.length} elementi con movimento automatico rilevati (${withHint.length} con un possibile controllo vicino, ${withoutHint.length} senza alcun indizio)`,
            issues: suspects.map(s => ({ selector: s.selector, kind: s.kind, hasNearbyHint: s.hasNearbyHint }))
          },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per uno screenshot e un giudizio su un eventuale controllo di pausa/stop funzionale.'
        };
      }

      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const item of toCheck) {
        try {
          // Il box era stato calcolato in blocco su tutti i candidati prima di sapere quali
          // sarebbero stati verificati con AI: va riscorso in vista e riletto ora, altrimenti
          // un elemento sotto la piega fa fallire lo screenshot.
          const freshBox = await getPaddedBox(page, item.selector, 20);
          if (!freshBox || freshBox.width <= 0 || freshBox.height <= 0) {
            findings.push({ ...item, verdict: 'errore', reason: 'elemento non renderizzato o dimensioni nulle' });
            continue;
          }
          const screenshotBuffer = await page.screenshot({ clip: freshBox }).catch(() => null);
          if (!screenshotBuffer) {
            findings.push({ ...item, verdict: 'errore', reason: 'impossibile catturare lo screenshot' });
            continue;
          }

          const prompt = `Questo è lo screenshot di un elemento con movimento/aggiornamento automatico (${item.kind}), con un margine di ` +
            'contesto attorno. È visibile un controllo funzionale (pulsante pausa/stop/play) che permetta all\'utente di fermare o mettere ' +
            'in pausa questo contenuto? Rispondi SOLO con un JSON: {"controllo_presente": true|false, ' +
            '"motivo": "spiegazione in una frase, in italiano", "suggerimento": "modifica proposta, o stringa vuota se già presente"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            selector: item.selector, kind: item.kind,
            verdict: parsed?.controllo_presente === false ? 'assente' : (parsed?.controllo_presente === true ? 'presente' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ selector: item.selector, kind: item.kind, verdict: 'errore', reason: err.message });
        }
      }

      const assenti = findings.filter(f => f.verdict === 'assente');

      return {
        id: this.id, name: this.name, level: this.level,
        status: assenti.length > 0 ? 'fail' : 'pass',
        automated: {
          ran: true,
          summary: `${candidates.length} elementi con movimento automatico, ${toCheck.length} verificati con AI`,
          issues: suspects.map(s => ({ selector: s.selector, kind: s.kind }))
        },
        ai: { attempted: true, skippedReason: null, verdict: assenti.length > 0 ? 'fail' : 'pass', findings },
        notes: candidates.length > toCheck.length ? `Solo i primi ${limit} elementi sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-motion-id]').forEach(el => el.removeAttribute('data-a11y-motion-id'));
      }).catch(() => {});
    }
  }
};
