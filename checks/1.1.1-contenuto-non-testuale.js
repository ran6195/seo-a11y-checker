const { askVision, parseJSONResponse } = require('./lib/anthropic');

const AXE_RULES = ['image-alt', 'input-image-alt', 'area-alt', 'svg-img-alt', 'object-alt', 'role-img-alt'];
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i;
const REDUNDANT_RE = /^(immagine|foto|picture|image)\b/i;

module.exports = {
  id: '1.1.1',
  name: 'Contenuto non testuale',
  level: 'A',
  description: 'Ogni contenuto non testuale (immagini, controlli, elementi grafici) deve avere un\'alternativa testuale equivalente.',
  remediation: 'Scrivi un attributo alt che descriva il contenuto informativo dell\'immagine (non il nome del file, non frasi generiche come "immagine di"); per le immagini puramente decorative usa alt="".',
  aiCapable: true,

  async run(ctx) {
    const { page, axeResults, options } = ctx;

    // 1) axe-core copre già la presenza dell'alternativa testuale su img/input[image]/
    //    area/svg/object/role=img. Se fallisce qui, è già un fallimento certo:
    //    l'AI non aggiungerebbe valore nel confermarlo.
    const axeFailNodes = (axeResults.violations || [])
      .filter(v => AXE_RULES.includes(v.id))
      .flatMap(v => v.nodes.map(n => ({ rule: v.id, selector: n.target[0], html: n.html.slice(0, 120) })));

    if (axeFailNodes.length > 0) {
      return {
        id: this.id, name: this.name, level: this.level,
        status: 'fail',
        automated: { ran: true, summary: `${axeFailNodes.length} elementi senza alternativa testuale (axe-core)`, issues: axeFailNodes },
        ai: { attempted: false, skippedReason: 'automated-fail', verdict: null, findings: [] },
        notes: 'Fallimento già certo da axe-core: il controllo AI non aggiungerebbe valore, si passa direttamente alla correzione.'
      };
    }

    // 2) axe è a posto strutturalmente: qui si valuta la QUALITÀ del testo alternativo,
    //    cosa che axe non può fare. Prima un'euristica gratuita per isolare i candidati sospetti.
    await page.evaluate(() => {
      window.__a11yDeepQuery('img[alt]:not([alt=""])').forEach((img, i) => {
        img.setAttribute('data-a11y-img-id', String(i));
      });
    });

    try {
      const images = await page.evaluate(() => {
        return window.__a11yDeepQuery('[data-a11y-img-id]').map(img => ({
          index: Number(img.getAttribute('data-a11y-img-id')),
          src: img.currentSrc || img.src || '',
          alt: img.alt,
          selector: `[data-a11y-img-id="${img.getAttribute('data-a11y-img-id')}"]`
        }));
      });

      const suspects = images.filter(img => {
        const alt = img.alt.trim();
        const filename = decodeURIComponent((img.src.split('/').pop() || '').split('?')[0]);
        const isFilename = IMG_EXT_RE.test(alt) || alt.toLowerCase() === filename.toLowerCase();
        const isRedundant = REDUNDANT_RE.test(alt);
        const tooShort = alt.length <= 2;
        const tooLong = alt.length > 150;
        return isFilename || isRedundant || tooShort || tooLong;
      });

      if (suspects.length === 0) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: images.length === 0 ? 'not-applicable' : 'pass',
          automated: { ran: true, summary: `${images.length} immagini con alt, nessun pattern sospetto rilevato`, issues: [] },
          ai: { attempted: false, skippedReason: 'no-candidates', verdict: null, findings: [] },
          notes: 'L\'euristica copre solo pattern noti (nome file, testo ridondante, lunghezza): non garantisce correttezza semantica su tutte le immagini.'
        };
      }

      if (!options.ai) {
        return {
          id: this.id, name: this.name, level: this.level,
          status: 'needs-review',
          automated: { ran: true, summary: `${suspects.length}/${images.length} testi alternativi con pattern sospetti`, issues: suspects },
          ai: { attempted: false, skippedReason: 'disabled', verdict: null, findings: [] },
          notes: 'Rilancia con --ai per un giudizio automatico sulla pertinenza del testo alternativo rispetto all\'immagine.'
        };
      }

      // 3) Fallback AI: solo sui candidati sospetti, con un tetto (--limit) per contenere costo/tempo.
      const limit = options.limit || 5;
      const toCheck = suspects.slice(0, limit);
      const findings = [];

      for (const img of toCheck) {
        try {
          const handle = await page.$(img.selector);
          const screenshotBuffer = handle ? await handle.screenshot().catch(() => null) : null;
          if (!screenshotBuffer) {
            findings.push({ ...img, verdict: 'errore', reason: 'impossibile catturare uno screenshot dell\'immagine' });
            continue;
          }
          const prompt = `Questa immagine ha come testo alternativo (attributo alt): "${img.alt}". ` +
            'Descrive accuratamente il contenuto informativo dell\'immagine secondo il criterio WCAG 1.1.1 ' +
            '(no descrizioni generiche, no nome file, no ridondanze tipo "immagine di")? ' +
            'Se NON è adeguato, proponi anche un testo alternativo corretto. Rispondi SOLO con un JSON: ' +
            '{"adeguato": true|false, "motivo": "spiegazione in una frase, in italiano", "suggerimento": "testo alt proposto, o stringa vuota se già adeguato"}';

          const response = await askVision({
            apiKey: options.apiKey,
            prompt,
            images: [{ base64: screenshotBuffer.toString('base64'), mediaType: 'image/png' }]
          });
          const parsed = parseJSONResponse(response);

          findings.push({
            ...img,
            verdict: parsed?.adeguato === false ? 'inadeguato' : (parsed?.adeguato === true ? 'adeguato' : 'incerto'),
            reason: parsed?.motivo || response.trim(),
            suggerimento: parsed?.suggerimento || ''
          });
        } catch (err) {
          findings.push({ ...img, verdict: 'errore', reason: err.message });
        }
      }

      const inadeguati = findings.filter(f => f.verdict === 'inadeguato');

      return {
        id: this.id, name: this.name, level: this.level,
        status: inadeguati.length > 0 ? 'fail' : 'pass',
        automated: { ran: true, summary: `${suspects.length}/${images.length} candidati da euristica, ${toCheck.length} verificati con AI`, issues: suspects },
        ai: { attempted: true, skippedReason: null, verdict: inadeguati.length > 0 ? 'fail' : 'pass', findings },
        notes: suspects.length > toCheck.length ? `Solo i primi ${limit} candidati sono stati verificati con AI (--limit).` : ''
      };
    } finally {
      await page.evaluate(() => {
        window.__a11yDeepQuery('[data-a11y-img-id]').forEach(el => el.removeAttribute('data-a11y-img-id'));
      }).catch(() => {});
    }
  }
};
