const { chromium } = require('playwright');
const fs = require('fs');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'];

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
      return await window.axe.run(document, { tags });
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

module.exports = { createContext, launchBrowser, loadPage, AXE_TAGS };
