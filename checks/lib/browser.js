const { chromium } = require('playwright');
const fs = require('fs');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];

// Bootstrap minimo e indipendente da a11y-checker.js: naviga, inietta axe-core
// ed esegue un'unica scansione condivisa da tutti gli script di checks/.
// document.querySelectorAll nativo NON attraversa lo Shadow DOM (usato da molti form
// builder/web component moderni). axe-core lo attraversa nativamente, ma i controlli
// custom di checks/ interrogano il DOM a mano: senza questo helper, qualunque elemento
// dentro uno shadow root risulta invisibile e produce falsi "non trovato"/"not-applicable".
// Iniettato una sola volta qui ed esposto come window.__a11yDeepQuery a tutti gli script.
const DEEP_QUERY_INIT_SCRIPT = `
  window.__a11yDeepQuery = function(selector, root) {
    root = root || document;
    const results = Array.from(root.querySelectorAll(selector));
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        results.push(...window.__a11yDeepQuery(selector, el.shadowRoot));
      }
    });
    return results;
  };
`;

// Molti siti (WordPress/Elementor su tutti) rivelano sezioni con visibility:hidden
// + un'animazione "entrance" quando entrano in viewport (scroll-reveal). Appena dopo
// networkidle quel contenuto è già nel DOM ma non ancora visibile: offsetParent!==null
// non lo intercetta (visibility:hidden ha comunque un offsetParent), e Playwright si
// rifiuta correttamente di interagire con un elemento che l'utente reale non vede ancora.
// Scorrendo l'intera pagina una volta, prima di axe e di qualunque check, il contenuto
// si rivela per tutti allo stesso modo.
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      let steps = 0;
      const distance = 400;
      const maxSteps = 60; // tetto di sicurezza contro pagine a scroll infinito
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        total += distance;
        steps += 1;
        if (total >= scrollHeight || steps >= maxSteps) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

// Separato da loadPage() perché uno stesso browser/pagina va riusato su più URL quando
// si controllano più pagine dello stesso sito in sequenza (checks/run-site.js): riaprire
// il browser per ogni pagina è inutile e più lento. page.addInitScript() persiste su
// ogni navigazione della stessa pagina, quindi __a11yDeepQuery resta disponibile anche
// dopo un goto() successivo.
async function launchBrowser({ headless = false } = {}) {
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  await page.addInitScript(DEEP_QUERY_INIT_SCRIPT);
  return { browser, page };
}

// Naviga la pagina già aperta su una nuova URL ed esegue la scansione axe-core condivisa.
// axe-core viene reiniettato ad ogni chiamata (via addScriptTag, non addInitScript):
// corretto, serve fresco ad ogni navigazione, non deve persistere da una pagina all'altra.
async function loadPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await autoScroll(page);

  const axeCoreScript = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: axeCoreScript });
  await page.waitForTimeout(500);

  const axeResults = await page.evaluate(async (tags) => {
    if (typeof window.axe === 'undefined') {
      return { error: 'axe-core non caricato', violations: [], incomplete: [], passes: [] };
    }
    try {
      return await window.axe.run(document, {
        tags,
        // target-size (WCAG 2.5.8, Dimensione target minima) è disabilitata di default in
        // axe-core anche quando il suo tag (wcag22aa) è incluso nella scansione: i tag da
        // soli filtrano SOLO tra le regole già abilitate, non forzano l'esecuzione di una
        // regola con enabled:false. Va riattivata esplicitamente qui.
        rules: { 'target-size': { enabled: true } }
      });
    } catch (error) {
      return { error: error.message, violations: [], incomplete: [], passes: [] };
    }
  }, AXE_TAGS);

  return { url, axeResults };
}

// Comodo per il caso singola-pagina (checks/run.js): apre, carica, restituisce tutto insieme.
async function createContext(url, options = {}) {
  const { browser, page } = await launchBrowser(options);
  const { axeResults } = await loadPage(page, url);
  return { browser, page, axeResults, url };
}

// page.screenshot({ clip }) NON scorre l'elemento in vista prima di catturare (a differenza
// di elementHandle.screenshot(), che lo fa automaticamente): un elemento sotto la piega del
// viewport corrente al momento del clip fa fallire silenziosamente lo screenshot ("Clipped
// area ... is outside of the viewport"), che gli script chiamanti registrano come "errore".
// scrollIntoView() va chiamato subito prima di rileggere getBoundingClientRect() di un
// elemento potenzialmente fuori dal viewport corrente (tipicamente sotto la piega su pagine
// lunghe), per ottenere coordinate valide per un successivo page.screenshot({ clip }).
async function scrollIntoView(page, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
}

// Scorre l'elemento in vista e restituisce un box con margine di contesto pronto per
// page.screenshot({ clip }), o null se l'elemento non esiste più nel DOM.
async function getPaddedBox(page, selector, pad = 12) {
  await scrollIntoView(page, selector);
  const box = await page.evaluate(({ sel, pad }) => {
    const el = window.__a11yDeepQuery(sel)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left - pad)),
      y: Math.max(0, Math.round(r.top - pad)),
      width: Math.round(r.width + pad * 2),
      height: Math.round(r.height + pad * 2)
    };
  }, { sel: selector, pad });
  if (!box) return null;

  // Alcuni elementi (es. un banner cookie con position:fixed/sticky) non si spostano con lo
  // scroll della pagina: scrollIntoViewIfNeeded() non ha alcun effetto su di loro, e se
  // restano comunque oltre i bordi del viewport un clip che li eccede fa fallire
  // page.screenshot ("Clipped area is either empty or outside the resulting image").
  // Tagliamo il box ai confini del viewport corrente: risultato onesto (un box ad area
  // nulla se l'elemento è del tutto fuori vista, già gestito dai chiamanti come "elemento
  // non renderizzato") invece di un fallimento silenzioso dello screenshot.
  const viewport = page.viewportSize();
  if (viewport) {
    const x2 = Math.min(box.x + box.width, viewport.width);
    const y2 = Math.min(box.y + box.height, viewport.height);
    box.x = Math.max(0, Math.min(box.x, viewport.width));
    box.y = Math.max(0, Math.min(box.y, viewport.height));
    box.width = Math.max(0, x2 - box.x);
    box.height = Math.max(0, y2 - box.y);
  }
  return box;
}

module.exports = { createContext, launchBrowser, loadPage, AXE_TAGS, scrollIntoView, getPaddedBox };
