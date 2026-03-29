const {
  chromium
} = require('playwright');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

function _buildTimestamp(date) {
  return date.toISOString().slice(0, 16).replace(/-/g, '').replace('T', '_').replace(':', '');
}

function _extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch (e) {
    return 'sito';
  }
}

function _docsPath(filename) {
  const docsDir = path.join(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  return path.join(docsDir, filename);
}

class A11yChecker {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = [];
    this.visitedPages = new Set();
    this.pendingPages = new Set();
    this.startTime = new Date();
    this.baseDomain = null;
    this.maxPages = null;
  }

  async init(options = {}) {
    // Se è specificato un profilo Chrome, usa launchPersistentContext
    if (options.userDataDir) {
      const contextOptions = {
        headless: false,
        slowMo: 0,
        channel: 'chrome',
        ...options
      };

      this.context = await chromium.launchPersistentContext(options.userDataDir, contextOptions);
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else {
      // Modalità normale senza profilo
      const launchOptions = {
        headless: false,
        slowMo: 0,
        ...options
      };

      this.browser = await chromium.launch(launchOptions);
      this.page = await this.browser.newPage();
    }

    // Note: axe-core verrà iniettato per ogni pagina nel metodo checkAccessibility
  }

  async checkAccessibility(url) {
    await this.page.goto(url);

    // Attendi che la pagina sia completamente caricata
    await this.page.waitForLoadState('networkidle');

    // Inietta axe-core nella pagina corrente
    const axeCoreScript = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    await this.page.addScriptTag({ content: axeCoreScript });

    // Attendi un momento per assicurarsi che axe sia completamente caricato
    await this.page.waitForTimeout(500);

    // Esegui il controllo di accessibilità con axe-core
    const axeResults = await this.page.evaluate(async () => {
      // Verifica se axe è disponibile
      if (typeof window.axe === 'undefined') {
        return {
          error: 'axe-core non è stato caricato correttamente',
          violations: [],
          incomplete: [],
          passes: []
        };
      }

      try {
        // Esegui axe-core prima senza localizzazione per assicurarsi che funzioni
        const results = await window.axe.run(document, {
          tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']
        });

        // Traduci i risultati in italiano dopo l'esecuzione
        const italianTranslations = {
          'html-has-lang': {
            description: 'Assicurati che ogni documento HTML abbia un attributo lang',
            help: 'L\'elemento <html> deve avere un attributo lang valido'
          },
          'html-lang-valid': {
            description: 'Assicurati che l\'attributo lang dell\'elemento html abbia un valore valido',
            help: 'L\'attributo lang deve avere un valore di lingua valido'
          },
          'image-alt': {
            description: 'Assicurati che gli elementi <img> abbiano un testo alternativo o un ruolo "none" o "presentation"',
            help: 'Le immagini devono avere un testo alternativo'
          },
          'input-image-alt': {
            description: 'Assicurati che gli elementi <input type="image"> abbiano un testo alternativo',
            help: 'Gli input di tipo immagine devono avere un testo alternativo'
          },
          'label': {
            description: 'Assicurati che ogni controllo di form abbia un\'etichetta',
            help: 'Gli elementi di form devono avere etichette'
          },
          'link-name': {
            description: 'Assicurati che i link abbiano un nome accessibile',
            help: 'I link devono avere testo discernibile'
          },
          'button-name': {
            description: 'Assicurati che i pulsanti abbiano un nome accessibile',
            help: 'I pulsanti devono avere testo discernibile'
          },
          'color-contrast': {
            description: 'Assicurati che il contrasto tra primo piano e sfondo soddisfi le soglie WCAG 2 AA',
            help: 'Gli elementi devono avere un contrasto di colore sufficiente'
          },
          'heading-order': {
            description: 'Assicurati che l\'ordine delle intestazioni sia semanticamente corretto',
            help: 'I livelli di intestazione dovrebbero aumentare di uno solo'
          },
          'landmark-one-main': {
            description: 'Assicurati che il documento abbia un landmark principale',
            help: 'Il documento deve avere un landmark principale'
          },
          'landmark-main-is-top-level': {
            description: 'Assicurati che il landmark principale sia di primo livello',
            help: 'Il landmark principale non deve essere contenuto in un altro landmark'
          },
          'page-has-heading-one': {
            description: 'Assicurati che la pagina, o almeno uno dei suoi frame, contenga un\'intestazione di livello uno',
            help: 'La pagina deve contenere un\'intestazione di livello uno'
          },
          'region': {
            description: 'Assicurati che tutto il contenuto della pagina sia contenuto in landmark',
            help: 'Tutto il contenuto della pagina deve essere contenuto in landmark'
          },
          'skip-link': {
            description: 'Assicurati che tutti i link di salto abbiano un target che può essere messo a fuoco',
            help: 'I link di salto devono avere un target che può essere messo a fuoco'
          },
          'focus-order-semantics': {
            description: 'Assicurati che gli elementi nell\'ordine di focus abbiano un ruolo appropriato',
            help: 'Gli elementi nell\'ordine di focus devono avere un ruolo appropriato'
          },
          'tabindex': {
            description: 'Assicurati che tabindex non sia maggiore di zero',
            help: 'Gli elementi non dovrebbero avere tabindex maggiore di zero'
          },
          'aria-allowed-attr': {
            description: 'Assicurati che gli attributi ARIA siano consentiti per il ruolo di un elemento',
            help: 'Gli elementi devono usare solo attributi ARIA consentiti'
          },
          'aria-required-attr': {
            description: 'Assicurati che gli elementi con ruoli ARIA abbiano tutti gli attributi richiesti',
            help: 'Gli attributi ARIA richiesti devono essere forniti'
          },
          'aria-valid-attr': {
            description: 'Assicurati che gli attributi ARIA siano validi',
            help: 'Gli attributi ARIA devono essere conformi ai nomi validi'
          },
          'aria-valid-attr-value': {
            description: 'Assicurati che tutti i valori degli attributi ARIA siano validi',
            help: 'I valori degli attributi ARIA devono essere validi'
          },
          'duplicate-id': {
            description: 'Assicurati che ogni valore id sia unico',
            help: 'I valori id devono essere unici'
          },
          'form-field-multiple-labels': {
            description: 'Assicurati che i controlli di form non abbiano più di un\'etichetta',
            help: 'I controlli di form non devono avere più di un\'etichetta'
          },
          'area-alt': {
            description: 'Assicurati che gli elementi <area> di mappe immagine abbiano un testo alternativo',
            help: 'Gli elementi area attivi devono avere testo alternativo'
          },
          'aria-hidden-body': {
            description: 'Assicurati che aria-hidden=\'true\' non sia presente sull\'elemento body del documento',
            help: 'L\'elemento body non deve avere aria-hidden=true'
          },
          'definition-list': {
            description: 'Assicurati che gli elementi <dl> siano strutturati correttamente',
            help: 'Gli elementi <dl> devono contenere solo elementi <dt> e <dd> raggruppati correttamente'
          },
          'dlitem': {
            description: 'Assicurati che gli elementi <dt> e <dd> siano contenuti in un <dl>',
            help: 'Gli elementi <dt> e <dd> devono essere contenuti in un elemento <dl>'
          },
          'document-title': {
            description: 'Assicurati che ogni documento HTML abbia un elemento title non vuoto',
            help: 'I documenti devono avere un elemento <title> per aiutare nella navigazione'
          },
          'duplicate-id-active': {
            description: 'Assicurati che ogni valore id su elementi focusabili sia unico',
            help: 'Gli ID su elementi focusabili devono essere unici'
          },
          'duplicate-id-aria': {
            description: 'Assicurati che ogni valore id utilizzato in attributi ARIA sia unico',
            help: 'Gli ID utilizzati in attributi ARIA devono essere unici'
          },
          'frame-title': {
            description: 'Assicurati che gli elementi <iframe> e <frame> abbiano un attributo title unico',
            help: 'I frame devono avere un attributo title'
          },
          'list': {
            description: 'Assicurati che le liste siano strutturate correttamente',
            help: 'Gli elementi <ul> e <ol> devono contenere solo elementi <li>, <script> o <template>'
          },
          'listitem': {
            description: 'Assicurati che gli elementi <li> siano utilizzati semanticamente',
            help: 'Gli elementi <li> devono essere contenuti in un elemento <ul> o <ol>'
          },
          'meta-refresh': {
            description: 'Assicurati che <meta http-equiv="refresh"> non sia utilizzato',
            help: 'Il timing dei refresh non deve essere troppo breve'
          },
          'meta-viewport': {
            description: 'Assicurati che <meta name="viewport"> non disabiliti lo zoom',
            help: 'Lo zoom e il ridimensionamento non devono essere disabilitati'
          }
        };

        if (results.violations) {
          results.violations = results.violations.map(violation => ({
            ...violation,
            description: italianTranslations[violation.id]?.description || violation.description,
            help: italianTranslations[violation.id]?.help || violation.help
          }));
        }

        return results;
      } catch (error) {
        return {
          error: error.message,
          violations: [],
          incomplete: [],
          passes: []
        };
      }
    });

    // Controlli aggiuntivi personalizzati
    const customChecks = await this.performCustomChecks(url);

    // Analizza i risultati
    const analysis = this.analyzeResults(axeResults, customChecks);

    return {
      url,
      axeResults,
      customChecks,
      analysis,
      timestamp: new Date().toISOString()
    };
  }

  async performCustomChecks(url) {
    const checks = {};

    // Controlla presenza di skip links
    checks.skipLinks = await this.page.evaluate(() => {
      const skipLinks = Array.from(document.querySelectorAll('a[href^="#"], a[href*="skip"]'));
      const validSkipLinks = skipLinks.filter(link => {
        const text = link.textContent.toLowerCase();
        return text.includes('skip') || text.includes('main') || text.includes('content');
      });

      return {
        found: validSkipLinks.length > 0,
        count: validSkipLinks.length,
        links: validSkipLinks.map(link => ({
          text: link.textContent.trim(),
          href: link.href,
          visible: link.offsetWidth > 0 && link.offsetHeight > 0
        }))
      };
    });

    // Controlla struttura dei landmark
    checks.landmarks = await this.page.evaluate(() => {
      const landmarks = {
        main: document.querySelectorAll('main, [role="main"]').length,
        navigation: document.querySelectorAll('nav, [role="navigation"]').length,
        banner: document.querySelectorAll('header, [role="banner"]').length,
        contentinfo: document.querySelectorAll('footer, [role="contentinfo"]').length,
        complementary: document.querySelectorAll('aside, [role="complementary"]').length
      };

      const issues = [];
      if (landmarks.main === 0) issues.push('Manca landmark main');
      if (landmarks.main > 1) issues.push(`Troppi landmark main: ${landmarks.main}`);
      if (landmarks.navigation === 0) issues.push('Manca landmark navigation');
      if (landmarks.banner === 0) issues.push('Manca landmark banner');
      if (landmarks.contentinfo === 0) issues.push('Manca landmark contentinfo');

      return {
        landmarks,
        issues,
        valid: issues.length === 0
      };
    });

    // Controlla focus management
    checks.focusManagement = await this.page.evaluate(() => {
      const focusableElements = document.querySelectorAll(`
        a[href], button, input, textarea, select, details, [tabindex]:not([tabindex="-1"])
      `);

      const elementsWithoutFocusIndicator = Array.from(focusableElements).filter(el => {
        const styles = window.getComputedStyle(el, ':focus');
        return !styles.outline || styles.outline === 'none';
      });

      return {
        totalFocusable: focusableElements.length,
        withoutFocusIndicator: elementsWithoutFocusIndicator.length,
        issues: elementsWithoutFocusIndicator.length > 0 ?
          [`${elementsWithoutFocusIndicator.length} elementi senza indicatore di focus`] : [],
        valid: elementsWithoutFocusIndicator.length === 0
      };
    });

    // Controlla immagini
    checks.images = await this.page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const issues = [];

      const missingAlt = images.filter(img => !img.hasAttribute('alt'));
      const emptyAlt = images.filter(img => img.hasAttribute('alt') && img.alt.trim() === '');
      const decorativeImages = images.filter(img => img.alt === '' && !img.hasAttribute('role'));

      if (missingAlt.length > 0) {
        issues.push(`${missingAlt.length} immagini senza attributo alt`);
      }

      const meaningfulImages = images.filter(img =>
        img.alt && img.alt.trim() !== '' && !img.alt.toLowerCase().includes('image')
      );

      return {
        total: images.length,
        missingAlt: missingAlt.length,
        emptyAlt: emptyAlt.length,
        decorative: decorativeImages.length,
        meaningful: meaningfulImages.length,
        issues,
        valid: issues.length === 0
      };
    });

    // Controlla form
    checks.forms = await this.page.evaluate(() => {
      const formControls = Array.from(document.querySelectorAll('input, textarea, select'));
      const issues = [];

      const withoutLabels = formControls.filter(control => {
        const id = control.id;
        const label = document.querySelector(`label[for="${id}"]`);
        const ariaLabel = control.getAttribute('aria-label');
        const ariaLabelledby = control.getAttribute('aria-labelledby');

        return !label && !ariaLabel && !ariaLabelledby;
      });

      if (withoutLabels.length > 0) {
        issues.push(`${withoutLabels.length} controlli form senza etichette`);
      }

      const requiredFields = formControls.filter(control => control.hasAttribute('required'));
      const requiredWithoutAriaRequired = requiredFields.filter(control =>
        !control.hasAttribute('aria-required')
      );

      return {
        total: formControls.length,
        withoutLabels: withoutLabels.length,
        required: requiredFields.length,
        requiredWithoutAriaRequired: requiredWithoutAriaRequired.length,
        issues,
        valid: issues.length === 0
      };
    });

    // Controlla contrasto colori (implementazione base)
    checks.colorContrast = await this.page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*')).filter(el => {
        const styles = window.getComputedStyle(el);
        return styles.color && styles.backgroundColor && el.textContent.trim();
      });

      // Questo è un controllo semplificato - axe-core fa un lavoro più accurato
      return {
        elementsChecked: elements.length,
        note: 'Controllo dettagliato del contrasto eseguito da axe-core'
      };
    });

    return checks;
  }

  analyzeResults(axeResults, customChecks) {
    const analysis = {
      summary: {
        violations: axeResults.violations?.length || 0,
        incomplete: axeResults.incomplete?.length || 0,
        passes: axeResults.passes?.length || 0,
        total: (axeResults.violations?.length || 0) + (axeResults.incomplete?.length || 0) + (axeResults.passes?.length || 0)
      },
      severity: {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0
      },
      categories: {
        wcag2a: 0,
        wcag2aa: 0,
        wcag21aa: 0,
        bestPractice: 0
      },
      customIssues: 0,
      score: 0
    };

    // Analizza violazioni di axe
    if (axeResults.violations) {
      axeResults.violations.forEach(violation => {
        analysis.severity[violation.impact] = (analysis.severity[violation.impact] || 0) + 1;

        violation.tags.forEach(tag => {
          if (analysis.categories[tag] !== undefined) {
            analysis.categories[tag]++;
          }
        });
      });
    }

    // Conta problemi dai controlli personalizzati
    Object.values(customChecks).forEach(check => {
      if (check.issues && check.issues.length > 0) {
        analysis.customIssues += check.issues.length;
      }
    });

    // Calcola score di accessibilità (0-100)
    const totalPossible = analysis.summary.total;
    const totalProblems = analysis.summary.violations + analysis.customIssues;

    if (totalPossible > 0) {
      analysis.score = Math.max(0, Math.round(((totalPossible - totalProblems) / totalPossible) * 100));
    } else {
      analysis.score = 100;
    }

    return analysis;
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

      let pathname = urlObj.pathname;
      if (pathname !== '/' && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      if (!pathname || pathname === '') {
        pathname = '/';
      }
      urlObj.pathname = pathname;
      urlObj.hash = '';

      const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'ref', 'source', 'campaign'
      ];

      paramsToRemove.forEach(param => {
        urlObj.searchParams.delete(param);
      });

      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }

  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      const normalizedHostname = urlObj.hostname.replace(/^www\./, '');
      const normalizedBaseDomain = this.baseDomain.replace(/^www\./, '');

      if (normalizedHostname !== normalizedBaseDomain) {
        return false;
      }

      const excludedExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.rar', '.tar', '.gz',
        '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
        '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav',
        '.css', '.js', '.xml', '.json', '.txt'
      ];

      const pathname = urlObj.pathname.toLowerCase();
      if (excludedExtensions.some(ext => pathname.endsWith(ext))) {
        return false;
      }

      if (url.includes('mailto:') || url.includes('tel:')) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async discoverLinksOnPage() {
    try {
      const links = await this.page.$$eval('a[href]', els =>
        els.map(el => el.href).filter(href => href && href.trim().length > 0)
      );

      const validLinks = links.filter(link => this.isValidUrl(link));
      const normalizedLinks = validLinks.map(link => this.normalizeUrl(link));
      const uniqueLinks = [...new Set(normalizedLinks)];

      return uniqueLinks;
    } catch (error) {
      console.warn(`Errore durante scoperta link: ${error.message}`);
      return [];
    }
  }

  async crawlSite(baseUrl, maxPages = null) {
    console.log(`\n♿ Inizio crawling accessibilità di: ${baseUrl}`);

    this.baseDomain = new URL(baseUrl).hostname;
    this.maxPages = maxPages;
    const normalizedBaseUrl = this.normalizeUrl(baseUrl);

    this.pendingPages.add(normalizedBaseUrl);

    let crawledCount = 0;

    while (this.pendingPages.size > 0 && (maxPages === null || crawledCount < maxPages)) {
      const currentUrl = Array.from(this.pendingPages)[0];
      this.pendingPages.delete(currentUrl);

      // Normalizza currentUrl per consistenza
      const normalizedCurrentUrl = this.normalizeUrl(currentUrl);

      if (this.visitedPages.has(normalizedCurrentUrl)) {
        continue;
      }

      crawledCount++;
      console.log(`\n[${crawledCount}${maxPages ? `/${maxPages}` : ''}] 🔍 ${currentUrl}`);

      // Aggiungi subito a visitedPages per evitare duplicati
      this.visitedPages.add(normalizedCurrentUrl);

      try {
        await this.page.goto(currentUrl, {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        const discoveredLinks = await this.discoverLinksOnPage();

        discoveredLinks.forEach(link => {
          const normalizedLink = this.normalizeUrl(link);
          if (!this.visitedPages.has(normalizedLink) && !this.pendingPages.has(normalizedLink)) {
            this.pendingPages.add(normalizedLink);
          }
        });

        const result = await this.checkAccessibility(currentUrl);
        this.results.push(result);

        console.log(`   📊 Score: ${result.analysis.score}% | Violazioni: ${result.analysis.summary.violations}`);
        console.log(`   📋 Pagine rimanenti: ${this.pendingPages.size}`);

        await this.page.waitForTimeout(500);

      } catch (error) {
        console.error(`   ❌ Errore su ${currentUrl}: ${error.message}`);

        this.results.push({
          url: currentUrl,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    const totalDiscovered = this.visitedPages.size + this.pendingPages.size;
    const crawlPercentage = Math.round((crawledCount / totalDiscovered) * 100);

    console.log(`\n🎯 RIEPILOGO CRAWLING ACCESSIBILITÀ`);
    console.log(`=`.repeat(45));
    console.log(`✅ Pagine elaborate: ${crawledCount}/${totalDiscovered} (${crawlPercentage}%)`);
    console.log(`🔍 Pagine scoperte totali: ${totalDiscovered}`);
    console.log(`⏭️  Pagine saltate: ${this.pendingPages.size}`);
    console.log(`⏱️  Durata: ${Math.round((new Date() - this.startTime) / 1000)}s`);

    if (maxPages && crawledCount >= maxPages) {
      console.log(`🛑 Limite raggiunto (${maxPages} pagine)`);
    }
  }

  async navigateAndCheck(baseUrl, maxPages = 10) {
    console.log(`\n♿ Inizio controllo accessibilità da: ${baseUrl}`);

    this.baseDomain = new URL(baseUrl).hostname;
    this.maxPages = maxPages;
    const normalizedBaseUrl = this.normalizeUrl(baseUrl);

    this.pendingPages.add(normalizedBaseUrl);

    let crawledCount = 0;

    while (this.pendingPages.size > 0 && crawledCount < maxPages) {
      const currentUrl = Array.from(this.pendingPages)[0];
      this.pendingPages.delete(currentUrl);

      // Normalizza currentUrl per consistenza
      const normalizedCurrentUrl = this.normalizeUrl(currentUrl);

      if (this.visitedPages.has(normalizedCurrentUrl)) {
        continue;
      }

      crawledCount++;
      const remaining = maxPages - crawledCount;

      // Aggiungi subito a visitedPages per evitare duplicati
      this.visitedPages.add(normalizedCurrentUrl);

      try {
        await this.page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Scopri nuovi link dalla pagina corrente
        const discoveredLinks = await this.discoverLinksOnPage();
        discoveredLinks.forEach(link => {
          if (!this.visitedPages.has(link) && !this.pendingPages.has(link)) {
            this.pendingPages.add(link);
          }
        });

        const result = await this.checkAccessibility(currentUrl);
        this.results.push(result);

        console.log(`✅ [${crawledCount}/${maxPages}] ${currentUrl} - Score: ${result.analysis.score}% (${remaining} rimanenti, ${this.pendingPages.size} in coda)`);

        await this.page.waitForTimeout(500);

      } catch (error) {
        console.error(`❌ [${crawledCount}/${maxPages}] Errore controllando ${currentUrl}:`, error.message);
        this.results.push({
          url: currentUrl,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    if (this.pendingPages.size > 0) {
      console.log(`\n🛑 Limite raggiunto (${maxPages} pagine). ${this.pendingPages.size} pagine rimanenti in coda non analizzate.`);
    }
  }

  generateReport() {
    console.log('\n♿ REPORT FINALE ACCESSIBILITÀ');
    console.log('='.repeat(55));

    let totalViolations = 0;
    let totalScore = 0;
    let pagesWithIssues = 0;
    const severityCount = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    this.results.forEach((result, index) => {
      if (result.error) {
        console.log(`\n${index + 1}. ❌ ERRORE - ${result.url}`);
        console.log(`   Errore: ${result.error}`);
        return;
      }

      const analysis = result.analysis;
      totalViolations += analysis.summary.violations;
      totalScore += analysis.score;

      if (analysis.summary.violations > 0 || analysis.customIssues > 0) {
        pagesWithIssues++;
      }

      Object.keys(severityCount).forEach(severity => {
        severityCount[severity] += analysis.severity[severity] || 0;
      });

      const scoreEmoji = analysis.score >= 90 ? '🟢' : analysis.score >= 70 ? '🟡' : '🔴';
      console.log(`\n${index + 1}. ${scoreEmoji} ${result.url}`);
      console.log(`   📊 Score Accessibilità: ${analysis.score}%`);
      console.log(`   🚨 Violazioni: ${analysis.summary.violations}`);
      console.log(`   ⚠️ Incompleti: ${analysis.summary.incomplete}`);
      console.log(`   ✅ Superati: ${analysis.summary.passes}`);

      if (analysis.summary.violations > 0) {
        console.log('   🔍 Violazioni per gravità:');
        Object.entries(analysis.severity).forEach(([severity, count]) => {
          if (count > 0) {
            const emoji = severity === 'critical' ? '🔴' : severity === 'serious' ? '🟠' :
                         severity === 'moderate' ? '🟡' : '🔵';
            console.log(`      ${emoji} ${severity}: ${count}`);
          }
        });
      }

      if (result.customChecks) {
        console.log('   🛠️ Controlli personalizzati:');

        if (result.customChecks.skipLinks) {
          const sl = result.customChecks.skipLinks;
          console.log(`      Skip links: ${sl.found ? '✅' : '❌'} (${sl.count} trovati)`);
        }

        if (result.customChecks.landmarks) {
          const lm = result.customChecks.landmarks;
          console.log(`      Landmarks: ${lm.valid ? '✅' : '❌'} (${lm.issues.length} problemi)`);
        }

        if (result.customChecks.images) {
          const img = result.customChecks.images;
          console.log(`      Immagini: ${img.valid ? '✅' : '❌'} (${img.missingAlt} senza alt)`);
        }

        if (result.customChecks.forms) {
          const frm = result.customChecks.forms;
          console.log(`      Form: ${frm.valid ? '✅' : '❌'} (${frm.withoutLabels} senza etichette)`);
        }
      }
    });

    const avgScore = this.results.length > 0 ? Math.round(totalScore / this.results.length) : 0;

    console.log('\n📈 STATISTICHE FINALI');
    console.log('='.repeat(30));
    console.log(`Pagine controllate: ${this.results.length}`);
    console.log(`Pagine con problemi: ${pagesWithIssues}`);
    console.log(`Score medio: ${avgScore}%`);
    console.log(`Violazioni totali: ${totalViolations}`);
    console.log('\nViolazioni per gravità:');
    Object.entries(severityCount).forEach(([severity, count]) => {
      if (count > 0) {
        console.log(`  ${severity}: ${count}`);
      }
    });
  }

  generateMarkdownReport(filename = null) {
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    if (!filename) {
      const domain = this.results.length > 0 ? _extractDomain(this.results[0].url) : 'sito';
      filename = `${_buildTimestamp(endTime)}_${domain}_a11y.md`;
    }

    let totalViolations = 0;
    let totalScore = 0;
    let pagesWithIssues = 0;
    const severityCount = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    this.results.forEach(result => {
      if (result.error) return;

      const analysis = result.analysis;
      totalViolations += analysis.summary.violations;
      totalScore += analysis.score;

      if (analysis.summary.violations > 0 || analysis.customIssues > 0) {
        pagesWithIssues++;
      }

      Object.keys(severityCount).forEach(severity => {
        severityCount[severity] += analysis.severity[severity] || 0;
      });
    });

    const avgScore = this.results.length > 0 ? Math.round(totalScore / this.results.length) : 0;

    let markdown = `# ♿ Report Accessibilità

## ℹ️ Informazioni Generali

- **Data**: ${endTime.toLocaleDateString('it-IT')} alle ${endTime.toLocaleTimeString('it-IT')}
- **Durata controllo**: ${duration} secondi
- **Pagine totali**: ${this.results.length}
- **Pagine con problemi**: ${pagesWithIssues}
- **Score medio**: ${avgScore}%
- **Violazioni totali**: ${totalViolations}

## 📈 Riepilogo Violazioni

| Gravità | Quantità |
|---------|----------|
| 🔴 Critical | ${severityCount.critical} |
| 🟠 Serious | ${severityCount.serious} |
| 🟡 Moderate | ${severityCount.moderate} |
| 🔵 Minor | ${severityCount.minor} |

## 📋 Dettaglio Pagine

`;

    this.results.forEach((result, index) => {
      const pageNumber = index + 1;

      if (result.error) {
        markdown += `### ${pageNumber}. ❌ ERRORE - ${result.url}

**Errore**: ${result.error}

---

`;
        return;
      }

      const analysis = result.analysis;
      const scoreEmoji = analysis.score >= 90 ? '🟢' : analysis.score >= 70 ? '🟡' : '🔴';

      markdown += `### ${pageNumber}. ${scoreEmoji} ${result.url}

**Score Accessibilità**: ${analysis.score}%

**Riepilogo**:
- 🚨 Violazioni: ${analysis.summary.violations}
- ⚠️ Incompleti: ${analysis.summary.incomplete}
- ✅ Superati: ${analysis.summary.passes}

`;

      if (analysis.summary.violations > 0) {
        markdown += `**Violazioni per gravità**:
`;
        Object.entries(analysis.severity).forEach(([severity, count]) => {
          if (count > 0) {
            const emoji = severity === 'critical' ? '🔴' : severity === 'serious' ? '🟠' :
                         severity === 'moderate' ? '🟡' : '🔵';
            markdown += `- ${emoji} ${severity}: ${count}\n`;
          }
        });
        markdown += '\n';
      }

      if (result.customChecks) {
        markdown += `**Controlli personalizzati**:
`;

        Object.entries(result.customChecks).forEach(([checkName, checkResult]) => {
          if (checkResult.issues && checkResult.issues.length > 0) {
            markdown += `- ❌ ${checkName}: ${checkResult.issues.join(', ')}\n`;
          } else {
            markdown += `- ✅ ${checkName}: OK\n`;
          }
        });
        markdown += '\n';
      }

      if (result.axeResults.violations && result.axeResults.violations.length > 0) {
        markdown += `**Dettaglio violazioni axe-core**:

`;
        result.axeResults.violations.slice(0, 5).forEach(violation => {
          markdown += `- **${violation.id}**: ${violation.description}
  - Gravità: ${violation.impact}
  - Elementi: ${violation.nodes.length}
  - Tag: ${violation.tags.join(', ')}`;

          if (violation.nodes && violation.nodes.length > 0) {
            markdown += `
  - **🎯 Elementi interessati**:`;
            violation.nodes.slice(0, 10).forEach((node, index) => {
              const selector = node.target ? node.target.join(' > ') : 'Elemento non identificato';
              markdown += `
    ${index + 1}. \`${selector}\``;
              if (node.html) {
                const htmlSnippet = node.html.length > 80 ? node.html.substring(0, 80) + '...' : node.html;
                markdown += `
       _${htmlSnippet}_`;
              }
            });

            if (violation.nodes.length > 10) {
              markdown += `
    ... e altri ${violation.nodes.length - 10} elementi`;
            }
          }

          markdown += `

`;
        });

        if (result.axeResults.violations.length > 5) {
          markdown += `... e altre ${result.axeResults.violations.length - 5} violazioni

`;
        }
      }

      markdown += '---\n\n';
    });

    markdown += `## 💡 Raccomandazioni

### Accessibilità Web
- ✅ Assicurati che tutti gli elementi interattivi siano accessibili da tastiera
- ✅ Fornisci testo alternativo significativo per tutte le immagini
- ✅ Usa etichette appropriate per tutti i controlli dei form
- ✅ Mantieni un contrasto adeguato tra testo e sfondo
- ✅ Struttura il contenuto con heading in ordine logico (H1 → H2 → H3)
- ✅ Fornisci landmark ARIA per la navigazione
- ✅ Includi skip links per la navigazione rapida
- ✅ Testa con screen reader e navigazione da tastiera

### Standard WCAG
- ✅ Segui le linee guida WCAG 2.1 AA come minimo
- ✅ Considera WCAG 2.1 AAA per contenuti critici
- ✅ Valida il codice HTML per assicurare compatibilità
- ✅ Testa su multiple tecnologie assistive

---

*Report generato automaticamente da A11y Checker con Playwright e axe-core*
`;

    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, markdown, 'utf8');

    console.log(`\n📄 Report Markdown salvato: ${filepath}`);
    return filepath;
  }

  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  generateHTMLReport(filename = null) {
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    if (!filename) {
      const domain = this.results.length > 0 ? _extractDomain(this.results[0].url) : 'sito';
      filename = `${_buildTimestamp(endTime)}_${domain}_a11y.html`;
    }

    let totalViolations = 0;
    let totalScore = 0;

    this.results.forEach(result => {
      if (result.error) return;
      const analysis = result.analysis;
      totalViolations += analysis.summary.violations;
      totalScore += analysis.score;
    });

    const avgScore = this.results.length > 0 ? Math.round(totalScore / this.results.length) : 0;

    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Report Accessibilità - ${endTime.toLocaleDateString('it-IT')}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }

        h1 {
            background: #2c3e50;
            color: white;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 10px;
        }

        .summary {
            background: white;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #3498db;
        }

        .page {
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 5px;
            border-left: 4px solid #e74c3c;
        }

        .page.no-violations {
            border-left-color: #2ecc71;
        }

        .page-url {
            font-size: 1.2em;
            font-weight: bold;
            margin-bottom: 15px;
            color: #2c3e50;
            word-break: break-all;
        }

        .violation {
            background: #fff5f5;
            border-left: 3px solid #e74c3c;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 3px;
        }

        .violation-header {
            font-weight: bold;
            margin-bottom: 10px;
            color: #c0392b;
        }

        .violation-description {
            margin-bottom: 10px;
            color: #555;
        }

        .violation-info {
            font-size: 0.9em;
            color: #666;
            margin-bottom: 10px;
        }

        .elements-list {
            margin-top: 10px;
        }

        .element {
            background: #f8f9fa;
            border-left: 3px solid #95a5a6;
            padding: 10px;
            margin: 5px 0;
            font-family: monospace;
            font-size: 0.9em;
        }

        .selector {
            color: #16a085;
            font-weight: bold;
        }

        .html-snippet {
            color: #7f8c8d;
            margin-top: 5px;
            white-space: pre-wrap;
            word-break: break-all;
        }

        .score {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            color: white;
        }

        .score-high { background: #2ecc71; }
        .score-medium { background: #f39c12; }
        .score-low { background: #e74c3c; }
    </style>
</head>
<body>
    <h1>♿ Report Accessibilità Web</h1>

    <div class="summary">
        <strong>Data:</strong> ${endTime.toLocaleDateString('it-IT')} alle ${endTime.toLocaleTimeString('it-IT')}<br>
        <strong>Pagine analizzate:</strong> ${this.results.length}<br>
        <strong>Violazioni totali:</strong> ${totalViolations}<br>
        <strong>Score medio:</strong> <span class="score ${avgScore >= 90 ? 'score-high' : avgScore >= 70 ? 'score-medium' : 'score-low'}">${avgScore}%</span>
    </div>

    ${this.results.map((result, index) => {
      const pageNumber = index + 1;

      if (result.error) {
        return `
        <div class="page">
            <div class="page-url">Pagina ${pageNumber}: ${this.escapeHtml(result.url)}</div>
            <div style="color: #e74c3c;">❌ Errore: ${this.escapeHtml(result.error)}</div>
        </div>`;
      }

      const analysis = result.analysis;
      const hasViolations = result.axeResults.violations && result.axeResults.violations.length > 0;

      let pageHtml = `
      <div class="page ${!hasViolations ? 'no-violations' : ''}">
          <div class="page-url">
              Pagina ${pageNumber}: ${this.escapeHtml(result.url)}
              <span class="score ${analysis.score >= 90 ? 'score-high' : analysis.score >= 70 ? 'score-medium' : 'score-low'}">${analysis.score}%</span>
          </div>`;

      if (!hasViolations) {
        pageHtml += `<p style="color: #2ecc71; font-weight: bold;">✅ Nessuna violazione rilevata</p>`;
      } else {
        pageHtml += `<p style="margin-bottom: 15px;"><strong>Violazioni trovate:</strong> ${result.axeResults.violations.length}</p>`;
      }

      pageHtml += `</div>`;

      // Aggiungi violazioni come elementi separati
      if (hasViolations) {
        result.axeResults.violations.forEach((violation, vIndex) => {
          pageHtml += `
          <div class="violation">
              <div class="violation-header">
                  Violazione ${vIndex + 1}: ${this.escapeHtml(violation.id)}
              </div>
              <div class="violation-description">
                  ${this.escapeHtml(violation.description)}
              </div>
              <div class="violation-info">
                  <strong>Gravità:</strong> ${this.escapeHtml(violation.impact)} |
                  <strong>Elementi interessati:</strong> ${violation.nodes.length} |
                  <strong>Tag WCAG:</strong> ${this.escapeHtml(violation.tags.join(', '))}
              </div>
          </div>`;

          // Aggiungi elementi come lista separata
          if (violation.nodes && violation.nodes.length > 0) {
            violation.nodes.forEach((node, nIndex) => {
              const htmlSnippet = node.html ? (node.html.length > 150 ? node.html.substring(0, 150) + '...' : node.html) : '';
              pageHtml += `
              <div class="element">
                  <div class="selector">
                      Elemento ${nIndex + 1}: ${node.target ? this.escapeHtml(node.target.join(' > ')) : 'Elemento non identificato'}
                  </div>
                  ${htmlSnippet ? `<div class="html-snippet">${this.escapeHtml(htmlSnippet)}</div>` : ''}
              </div>`;
            });
          }
        });
      }

      return pageHtml;
    }).join('')}

    <div style="text-align: center; margin-top: 30px; padding: 20px; color: #7f8c8d;">
        Report generato con A11y Checker • Playwright + axe-core
    </div>
</body>
</html>`;

    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, html, 'utf8');

    console.log(`\n📄 Report HTML salvato: ${filepath}`);
    return filepath;
  }

  generateJSONReport(filename = null) {
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    if (!filename) {
      const domain = this.results.length > 0 ? _extractDomain(this.results[0].url) : 'sito';
      filename = `${_buildTimestamp(endTime)}_${domain}_a11y.json`;
    }

    let totalViolations = 0;
    let totalScore = 0;
    let pagesWithIssues = 0;
    const severityCount = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    // Calcola statistiche
    this.results.forEach(result => {
      if (result.error) return;

      const analysis = result.analysis;
      totalViolations += analysis.summary.violations;
      totalScore += analysis.score;

      if (analysis.summary.violations > 0 || analysis.customIssues > 0) {
        pagesWithIssues++;
      }

      Object.keys(severityCount).forEach(severity => {
        severityCount[severity] += analysis.severity[severity] || 0;
      });
    });

    const avgScore = this.results.length > 0 ? Math.round(totalScore / this.results.length) : 0;

    // Processa i risultati delle pagine
    const pages = this.results.map(result => {
      if (result.error) {
        return {
          url: result.url,
          status: 'error',
          error: result.error,
          timestamp: result.timestamp
        };
      }

      const analysis = result.analysis;

      // Processa le violazioni axe-core con dettagli degli elementi
      const violations = [];
      if (result.axeResults.violations) {
        result.axeResults.violations.forEach(violation => {
          const violationData = {
            id: violation.id,
            description: violation.description,
            help: violation.help,
            helpUrl: violation.helpUrl || null,
            impact: violation.impact,
            tags: violation.tags,
            elements: []
          };

          // Aggiungi dettagli di ogni elemento interessato
          if (violation.nodes) {
            violation.nodes.forEach((node, index) => {
              const elementData = {
                selector: node.target ? node.target.join(' > ') : null,
                html: node.html || null,
                failureSummary: node.failureSummary || null,
                impact: node.impact || violation.impact
              };

              // Aggiungi informazioni sui check falliti
              if (node.any && node.any.length > 0) {
                elementData.failedChecks = node.any.map(check => ({
                  id: check.id,
                  message: check.message,
                  data: check.data
                }));
              }

              // Aggiungi informazioni sui check che devono tutti passare
              if (node.all && node.all.length > 0) {
                elementData.allChecks = node.all.map(check => ({
                  id: check.id,
                  message: check.message,
                  data: check.data
                }));
              }

              violationData.elements.push(elementData);
            });
          }

          violations.push(violationData);
        });
      }

      // Processa i controlli personalizzati
      const customChecks = {};
      if (result.customChecks) {
        Object.entries(result.customChecks).forEach(([checkName, checkResult]) => {
          customChecks[checkName] = {
            valid: checkResult.valid !== false && (!checkResult.issues || checkResult.issues.length === 0),
            issues: checkResult.issues || [],
            data: checkResult
          };
        });
      }

      return {
        url: result.url,
        status: analysis.summary.violations > 0 ? 'violations' : 'passed',
        timestamp: result.timestamp,
        accessibility: {
          score: analysis.score,
          summary: {
            violations: analysis.summary.violations,
            incomplete: analysis.summary.incomplete,
            passes: analysis.summary.passes,
            total: analysis.summary.total
          },
          severity: analysis.severity,
          wcagCompliance: {
            wcag2a: analysis.score >= 90,
            wcag2aa: analysis.score >= 90,
            level: analysis.score >= 95 ? 'AAA' : analysis.score >= 90 ? 'AA' : analysis.score >= 70 ? 'A' : 'Non-compliant'
          }
        },
        violations: violations,
        customChecks: customChecks,
        incomplete: result.axeResults.incomplete || [],
        passes: result.axeResults.passes || []
      };
    });

    // Struttura finale del JSON
    const jsonReport = {
      reportInfo: {
        generatedAt: endTime.toISOString(),
        generatedAtLocal: endTime.toLocaleString('it-IT'),
        duration: duration,
        durationFormatted: `${duration} secondi`,
        tool: 'A11y Checker with Playwright and axe-core',
        version: '1.0.0'
      },
      summary: {
        statistics: {
          totalPages: this.results.length,
          pagesWithErrors: this.results.filter(r => r.error).length,
          pagesWithViolations: pagesWithIssues,
          pagesWithoutIssues: this.results.length - pagesWithIssues,
          totalViolations: totalViolations,
          averageScore: avgScore,
          wcagCompliance: {
            compliantPages: pages.filter(p => p.accessibility && p.accessibility.score >= 90).length,
            partiallyCompliantPages: pages.filter(p => p.accessibility && p.accessibility.score >= 70 && p.accessibility.score < 90).length,
            nonCompliantPages: pages.filter(p => p.accessibility && p.accessibility.score < 70).length
          }
        },
        severityBreakdown: severityCount,
        topViolations: this.getTopViolations(pages)
      },
      pages: pages,
      recommendations: {
        immediate: this.generateImmediateRecommendations(pages),
        general: [
          'Assicurati che tutti gli elementi interattivi siano accessibili da tastiera',
          'Fornisci testo alternativo significativo per tutte le immagini',
          'Usa etichette appropriate per tutti i controlli dei form',
          'Mantieni un contrasto adeguato tra testo e sfondo',
          'Struttura il contenuto con heading in ordine logico (H1 → H2 → H3)',
          'Fornisci landmark ARIA per la navigazione',
          'Includi skip links per la navigazione rapida',
          'Testa con screen reader e navigazione da tastiera'
        ],
        wcagGuidelines: [
          'Segui le linee guida WCAG 2.1 AA come minimo',
          'Considera WCAG 2.1 AAA per contenuti critici',
          'Valida il codice HTML per assicurare compatibilità',
          'Testa su multiple tecnologie assistive'
        ]
      }
    };

    // Salva il file
    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, JSON.stringify(jsonReport, null, 2), 'utf8');

    console.log(`\n📄 Report JSON salvato: ${filepath}`);
    return filepath;
  }

  getTopViolations(pages) {
    const violationCounts = {};

    pages.forEach(page => {
      if (page.violations) {
        page.violations.forEach(violation => {
          if (!violationCounts[violation.id]) {
            violationCounts[violation.id] = {
              id: violation.id,
              description: violation.description,
              impact: violation.impact,
              count: 0,
              elementsCount: 0
            };
          }
          violationCounts[violation.id].count++;
          violationCounts[violation.id].elementsCount += violation.elements.length;
        });
      }
    });

    return Object.values(violationCounts)
      .sort((a, b) => b.elementsCount - a.elementsCount)
      .slice(0, 10);
  }

  generateImmediateRecommendations(pages) {
    const recommendations = [];
    const commonIssues = new Set();

    pages.forEach(page => {
      if (page.violations) {
        page.violations.forEach(violation => {
          commonIssues.add(violation.id);
        });
      }
    });

    const issueRecommendations = {
      'html-has-lang': 'Aggiungi l\'attributo lang all\'elemento <html> (es. <html lang="it">)',
      'image-alt': 'Aggiungi testo alternativo significativo a tutte le immagini',
      'label': 'Associa etichette a tutti i controlli di form',
      'color-contrast': 'Migliora il contrasto dei colori per rispettare i requisiti WCAG',
      'heading-order': 'Correggi la struttura delle intestazioni (H1 → H2 → H3)',
      'landmark-one-main': 'Aggiungi un landmark <main> al contenuto principale',
      'region': 'Racchiudi tutto il contenuto in landmark semantici appropriati',
      'link-name': 'Fornisci testo descrittivo per tutti i link',
      'button-name': 'Assicurati che tutti i pulsanti abbiano testo descrittivo',
      'duplicate-id': 'Rimuovi ID duplicati dal codice HTML'
    };

    commonIssues.forEach(issueId => {
      if (issueRecommendations[issueId]) {
        recommendations.push(issueRecommendations[issueId]);
      }
    });

    return recommendations;
  }

  async simplifyViolationDescriptions(violations, apiKey) {
    if (!apiKey) {
      // Se non c'è API key, ritorna le descrizioni originali
      console.log('⚠️  Nessuna API key in simplifyViolationDescriptions');
      return violations;
    }

    console.log(`🔑 API key presente: ${apiKey.substring(0, 20)}...`);
    console.log(`📝 Violazioni da semplificare: ${violations.length}`);

    try {
      const anthropic = new Anthropic({
        apiKey: apiKey
      });

      // Prepara il prompt con tutte le violazioni
      const violationsText = violations.map((v, i) =>
        `${i + 1}. [${v.wcag}] ${v.description}`
      ).join('\n');

      console.log('📤 Invio richiesta a Claude...');
      console.log('Violazioni originali:', violationsText.substring(0, 200) + '...');

      const prompt = `Sei un esperto di accessibilità web che deve spiegare problemi tecnici a manager non tecnici.

Riscrivi le seguenti descrizioni di problemi di accessibilità in modo semplice e comprensibile, mantenendo il senso ma usando un linguaggio adatto a chi non ha competenze tecniche. Ogni descrizione deve essere chiara, concisa (massimo 2 righe) e spiegare l'impatto pratico per gli utenti.

REGOLE IMPORTANTISSIME - DEVI SEGUIRLE ALLA LETTERA:
1. Mantieni ESATTAMENTE il formato: numero punto spazio parentesi quadra aperta tag WCAG parentesi quadra chiusa spazio descrizione
2. Esempio di formato CORRETTO: "1. [9.1.1.1] Il sito non ha..."
3. NON rimuovere le parentesi quadre [ ] attorno ai tag WCAG
4. NON cambiare la numerazione
5. Riscrivi SOLO la descrizione dopo la parentesi quadra chiusa, mantenendo tutto il resto identico
6. IMPORTANTE: NON usare "la pagina" ma usa formulazioni generiche come "il sito", "alcune pagine", "alcune sezioni del sito", ecc.

Violazioni da semplificare:
${violationsText}

Rispondi SOLO con la lista numerata, una violazione per riga, mantenendo ESATTAMENTE questo formato:
1. [TAG] descrizione semplificata (usa "il sito" o "alcune pagine", mai "la pagina")
2. [TAG] descrizione semplificata (usa "il sito" o "alcune pagine", mai "la pagina")
ecc.
`;

      const message = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const simplifiedText = message.content[0].text;
      console.log('📥 Risposta ricevuta da Claude');
      console.log('Prime 200 caratteri:', simplifiedText.substring(0, 200) + '...');

      // Parsing della risposta
      const lines = simplifiedText.trim().split('\n').filter(line => line.trim());
      const simplifiedViolations = [];

      console.log(`🔍 Linee da parsare: ${lines.length}`);
      lines.forEach((line, i) => {
        console.log(`   Linea ${i + 1}: ${line.substring(0, 100)}...`);
        // Match: "1. [9.1.1.1] descrizione..."
        const match = line.match(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/);
        if (match) {
          console.log(`   ✅ Match trovato: [${match[1]}] -> ${match[2].substring(0, 50)}...`);
          simplifiedViolations.push({
            wcag: match[1].trim(),
            description: match[2].trim()
          });
        } else {
          console.log(`   ❌ Nessun match per questa linea`);
        }
      });

      console.log(`✅ Parsing completato: ${simplifiedViolations.length} violazioni parsate`);

      // Se il parsing ha avuto successo, usa le descrizioni semplificate
      if (simplifiedViolations.length === violations.length) {
        console.log('✨ Descrizioni semplificate con AI - OK');
        return simplifiedViolations;
      } else {
        console.warn(`⚠️  Parsing AI non riuscito: ${simplifiedViolations.length} vs ${violations.length} attese`);
        console.warn('   Uso descrizioni originali');
        return violations;
      }

    } catch (error) {
      console.error('❌ Errore chiamata AI:', error.message);
      if (error.stack) console.error('Stack:', error.stack);
      console.warn('   Uso descrizioni originali');
      return violations;
    }
  }

  async generateDichiarazioneHTML(options = {}) {
    const endTime = new Date();

    // Estrai il nome del sito dalla prima URL
    let siteName = 'SITO';
    let siteUrl = '';
    if (this.results.length > 0 && this.results[0].url) {
      try {
        const urlObj = new URL(this.results[0].url);
        siteUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        siteName = urlObj.hostname.toUpperCase().replace(/^WWW\./, '');
      } catch (e) {
        // Ignora errori di parsing
      }
    }

    // Opzioni configurabili
    const config = {
      organizationName: options.organizationName || 'L\'ORGANIZZAZIONE',
      siteName: options.siteName || siteName,
      siteUrl: options.siteUrl || siteUrl,
      contactEmail: options.contactEmail || 'contatti@esempio.it',
      contactPhone: options.contactPhone || '',
      publicationDate: options.publicationDate || '01/01/2020',
      cms: options.cms || 'Custom',
      testDate: endTime.toLocaleDateString('it-IT'),
      reviewDate: endTime.toLocaleDateString('it-IT')
    };

    // Calcola statistiche
    let totalViolations = 0;
    const violationsByType = {};

    this.results.forEach(result => {
      if (result.error || !result.axeResults.violations) return;

      result.axeResults.violations.forEach(violation => {
        totalViolations++;

        if (!violationsByType[violation.id]) {
          violationsByType[violation.id] = {
            id: violation.id,
            description: violation.description,
            help: violation.help,
            impact: violation.impact,
            tags: violation.tags,
            count: 0,
            pages: new Set()
          };
        }

        violationsByType[violation.id].count++;
        violationsByType[violation.id].pages.add(result.url);
      });
    });

    // Determina stato di conformità
    let avgScore = 0;
    if (this.results.length > 0) {
      const totalScore = this.results.reduce((sum, r) => {
        return sum + (r.analysis ? r.analysis.score : 0);
      }, 0);
      avgScore = Math.round(totalScore / this.results.length);
    }

    let conformityStatus = 'Non conforme';
    if (avgScore >= 95) {
      conformityStatus = 'Conforme';
    } else if (avgScore >= 70) {
      conformityStatus = 'Parzialmente conforme';
    }

    // Mappa violazioni ai criteri WCAG
    const wcagMapping = {
      'html-has-lang': '9.3.1.1',
      'html-lang-valid': '9.3.1.1',
      'image-alt': '9.1.1.1',
      'input-image-alt': '9.1.1.1',
      'area-alt': '9.1.1.1',
      'label': '9.1.3.1, 9.3.3.2, 9.4.1.2',
      'link-name': '9.2.4.4, 9.4.1.2',
      'button-name': '9.4.1.2',
      'color-contrast': '9.1.4.3',
      'heading-order': '9.1.3.1',
      'landmark-one-main': '9.1.3.1',
      'landmark-main-is-top-level': '9.1.3.1',
      'page-has-heading-one': '9.1.3.1',
      'region': '9.1.3.1',
      'skip-link': '9.2.4.1',
      'focus-order-semantics': '9.2.4.3',
      'tabindex': '9.2.4.3',
      'aria-allowed-attr': '9.4.1.2',
      'aria-required-attr': '9.4.1.2',
      'aria-valid-attr': '9.4.1.2',
      'aria-valid-attr-value': '9.4.1.2',
      'duplicate-id': '9.4.1.1',
      'duplicate-id-active': '9.4.1.1',
      'duplicate-id-aria': '9.4.1.1',
      'form-field-multiple-labels': '9.3.3.2',
      'aria-hidden-body': '9.4.1.2',
      'definition-list': '9.1.3.1',
      'dlitem': '9.1.3.1',
      'document-title': '9.2.4.2',
      'frame-title': '9.2.4.1, 9.4.1.2',
      'list': '9.1.3.1',
      'listitem': '9.1.3.1',
      'meta-refresh': '9.2.2.1, 9.2.2.4, 9.3.2.5',
      'meta-viewport': '9.1.4.4'
    };

    const violationDescriptions = {
      'html-has-lang': 'Il documento HTML non ha un attributo lang definito',
      'html-lang-valid': 'L\'attributo lang dell\'elemento HTML ha un valore non valido',
      'image-alt': 'Alcune immagini sono prive di testo alternativo o di una funzione (ruolo) che le escluda dalla lettura, rendendole incomprensibili',
      'input-image-alt': 'I pulsanti di tipo immagine sono privi di testo alternativo',
      'area-alt': 'Gli elementi area delle mappe immagine non hanno testo alternativo',
      'label': 'Alcuni elementi dei moduli sono completamente privi di etichetta',
      'link-name': 'I collegamenti non hanno un testo chiaro e distinguibile, impedendo agli utenti di capirne la destinazione',
      'button-name': 'I pulsanti non hanno un nome accessibile',
      'color-contrast': 'Il contrasto tra i colori del testo e dello sfondo non soddisfa le soglie minime (WCAG 2.1 AA), rendendo il contenuto difficilmente leggibile',
      'heading-order': 'L\'ordine delle intestazioni della pagina non segue una gerarchia logica, confondendo gli utenti e gli strumenti assistivi',
      'landmark-one-main': 'Il documento è privo della sezione principale (main), ostacolando la navigazione per gli strumenti assistivi',
      'landmark-main-is-top-level': 'La sezione principale (main) non è di primo livello',
      'page-has-heading-one': 'La pagina non contiene un\'intestazione di livello uno (H1)',
      'region': 'Non tutti i contenuti della pagina sono contenuti all\'interno delle sezioni principali (landmark), creando una struttura ambigua',
      'skip-link': 'I collegamenti per saltare contenuti non hanno un target valido',
      'focus-order-semantics': 'Gli elementi nell\'ordine di focus non hanno un ruolo semantico appropriato',
      'tabindex': 'Alcuni elementi hanno valori di tabindex maggiori di zero',
      'aria-allowed-attr': 'Alcuni attributi ARIA non sono consentiti per il ruolo dell\'elemento',
      'aria-required-attr': 'Mancano attributi ARIA richiesti',
      'aria-valid-attr': 'Sono presenti attributi ARIA non validi',
      'aria-valid-attr-value': 'Alcuni attributi ARIA hanno valori non validi',
      'duplicate-id': 'Sono presenti ID duplicati nel documento',
      'duplicate-id-active': 'Sono presenti ID duplicati su elementi focusabili',
      'duplicate-id-aria': 'Sono presenti ID duplicati utilizzati negli attributi ARIA',
      'form-field-multiple-labels': 'Alcuni campi form hanno più di un\'etichetta',
      'aria-hidden-body': 'L\'elemento body ha aria-hidden="true"',
      'definition-list': 'Le liste di definizione non sono strutturate correttamente',
      'dlitem': 'Gli elementi dt/dd non sono contenuti in un elemento dl',
      'document-title': 'Il documento non ha un elemento title',
      'frame-title': 'I frame non hanno un attributo title',
      'list': 'Le liste non sono strutturate correttamente',
      'listitem': 'Gli elementi li non sono contenuti in ul/ol',
      'meta-refresh': 'È presente un meta refresh automatico',
      'meta-viewport': 'La configurazione della visualizzazione (viewport) impedisce lo zoom significativo della pagina da parte dell\'utente'
    };

    // Genera lista violazioni ordinata per tag WCAG (best-practice in fondo)
    const violationsArray = Object.values(violationsByType).map(v => {
      const wcag = wcagMapping[v.id] || 'best-practice';
      const description = violationDescriptions[v.id] || v.description;
      return { wcag, description };
    });

    // Separa violazioni WCAG da best-practice
    const wcagViolations = violationsArray.filter(v => v.wcag !== 'best-practice');
    const bestPracticeViolations = violationsArray.filter(v => v.wcag === 'best-practice');

    // Ordina violazioni WCAG per tag
    wcagViolations.sort((a, b) => {
      // Estrai il primo tag se ci sono multipli (es. "9.1.3.1, 9.3.3.2" -> "9.1.3.1")
      const tagA = a.wcag.split(',')[0].trim();
      const tagB = b.wcag.split(',')[0].trim();
      return tagA.localeCompare(tagB, undefined, { numeric: true });
    });

    // Combina: prima WCAG ordinati, poi best-practice
    let allViolations = [...wcagViolations, ...bestPracticeViolations];

    // Semplifica le descrizioni con AI se disponibile API key
    if (options.anthropicApiKey) {
      console.log(`🤖 Chiamata AI in corso per ${allViolations.length} violazioni...`);
      try {
        allViolations = await this.simplifyViolationDescriptions(allViolations, options.anthropicApiKey);
        console.log(`✅ AI completata, ${allViolations.length} descrizioni semplificate`);
      } catch (error) {
        console.error('❌ Errore durante semplificazione AI:', error.message);
        console.log('⚠️  Uso descrizioni originali');
      }
    } else {
      console.log('ℹ️  Nessuna API key fornita, uso descrizioni standard');
    }

    const violations = allViolations
      .map(v => `<li><strong>${v.wcag}</strong>: ${v.description}</li>`)
      .join('\n');

    // Genera filename
    const sanitizedSiteName = config.siteName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${_buildTimestamp(endTime)}_${sanitizedSiteName}_dichiarazione.html`;

    // Genera HTML
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dichiarazione di Accessibilità - ${config.siteName}</title>
</head>
<body>
<p><strong>Dichiarazione di Accessibilità <a href="${config.siteUrl}">${config.siteName}</a></strong></p>

<p><strong>${config.organizationName}</strong> si impegna a rendere il proprio sito web accessibile, conformemente alla legge 9 gennaio 2004, n. 4. La presente dichiarazione di accessibilità si applica al sito <strong><a href="${config.siteUrl}">${config.siteName}</a></strong></p>

<p><strong>Stato di conformità: ${conformityStatus}</strong></p>

${avgScore >= 95 ? `
<p>Questo sito web è <strong>conforme</strong> ai requisiti previsti dall'appendice A della norma UNI CEI EN 301549.</p>
` : avgScore >= 70 ? `
<p>Questo sito web è <strong>parzialmente conforme</strong> ai requisiti previsti dall'appendice A della norma UNI CEI EN 301549 in ragione dei casi di non conformità elencati di seguito.</p>

<p><strong>Contenuti non accessibili</strong><br />
I contenuti di seguito elencati non sono accessibili per i seguenti motivi inosservanza della legge 9 gennaio 2004, n. 4, in generale:</p>

<ul>
${violations}
</ul>
` : `
<p>Questo sito web è <strong>non conforme</strong> ai requisiti previsti dall'appendice A della norma UNI CEI EN 301549 in ragione dei gravi casi di non conformità elencati di seguito.</p>

<p><strong>Contenuti non accessibili</strong><br />
I contenuti di seguito elencati non sono accessibili per i seguenti motivi inosservanza della legge 9 gennaio 2004, n. 4, in generale:</p>

<ul>
${violations}
</ul>
`}

<p><strong>Redazione della dichiarazione</strong><br />
La presente dichiarazione è stata redatta il <strong>${config.testDate}</strong></p>

<p>La dichiarazione è stata redatta sulla base di una valutazione effettuata da terzi.<br />
La dichiarazione è stata riesaminata da ultimo il <strong>${config.reviewDate}</strong></p>

<p><strong>Feedback e informazioni di contatto</strong><br />
In caso di problemi relativi all'accessibilità del sito web scrivere al seguente indirizzo email: <a href="mailto:${config.contactEmail}"><strong>${config.contactEmail}</strong></a>, occorre riportare nel testo della mail, oltre alla segnalazione, le seguenti informazioni:</p>

<ul>
<li>URL del sito</li>
<li>Strumenti in dotazione (sistema operativo, browser ed eventuali strumenti compensativi e tecnologie assistive in dotazione)</li>
</ul>

${config.contactPhone ? `<p>In alternativa contattare il numero <strong>${config.contactPhone}</strong></p>` : ''}

<p><strong>Modalità di invio delle segnalazioni all'AgID</strong><br />
In caso di risposta insoddisfacente o di mancata risposta, nel termine di trenta giorni, alla notifica o alla richiesta, l'interessato può inoltrare una segnalazione ad AgID, tramite pec, al seguente indirizzo: <strong>protocollo@pec.agid.gov.it</strong></p>

<p><strong>Informazioni sul sito</strong><br />
La data di pubblicazione del sito è <strong>${config.publicationDate}</strong><br />
Sono stati effettuati test di usabilità: <strong>Sì</strong><br />
CMS/Sistema utilizzato per questo sito: <strong>${config.cms}</strong></p>

<p><strong>Statistiche del test di accessibilità</strong><br />
Pagine analizzate: <strong>${this.results.length}</strong><br />
Score medio di accessibilità: <strong>${avgScore}%</strong><br />
Violazioni totali rilevate: <strong>${totalViolations}</strong></p>

<p><em>Ultimo aggiornamento: ${config.reviewDate}</em></p>

</body>
</html>`;

    const filepath = _docsPath(filename);
    fs.writeFileSync(filepath, html, 'utf8');

    console.log(`\n📄 Dichiarazione di Accessibilità salvata: ${filepath}`);
    return filepath;
  }

  async generateAllegato2HTML(options = {}) {
    const endTime = new Date();

    // Estrai il nome del sito dalla prima URL
    let siteName = 'SITO';
    let siteUrl = '';
    if (this.results.length > 0 && this.results[0].url) {
      try {
        const urlObj = new URL(this.results[0].url);
        siteUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        siteName = urlObj.hostname.replace(/^www\./, '');
      } catch (e) {
        // Ignora errori di parsing
      }
    }

    // Opzioni configurabili
    const config = {
      siteName: options.siteName || siteName,
      siteUrl: options.siteUrl || siteUrl,
      testDate: options.testDate || endTime.toLocaleDateString('it-IT'),
      methodology: options.methodology || 'Analisi componenti sito web',
      standard: options.standard || 'Linee guida di riferimento WCAG2.1 AA',
      responsible: options.responsible || 'Esterno'
    };

    // Raccogli tutte le violazioni per tipo
    const violationsByType = {};
    this.results.forEach(result => {
      if (result.error || !result.axeResults.violations) return;

      result.axeResults.violations.forEach(violation => {
        if (!violationsByType[violation.id]) {
          violationsByType[violation.id] = {
            id: violation.id,
            description: violation.description,
            help: violation.help,
            impact: violation.impact,
            tags: violation.tags,
            count: 0,
            pages: new Set()
          };
        }
        violationsByType[violation.id].count++;
        violationsByType[violation.id].pages.add(result.url);
      });
    });

    // Mappa violazioni axe ai criteri WCAG/EN 301 549
    const wcagMapping = {
      'html-has-lang': '9.3.1.1',
      'html-lang-valid': '9.3.1.1',
      'image-alt': '9.1.1.1',
      'input-image-alt': '9.1.1.1',
      'area-alt': '9.1.1.1',
      'label': '9.1.3.1',
      'link-name': '9.2.4.4',
      'button-name': '9.4.1.2',
      'color-contrast': '9.1.4.3',
      'heading-order': '9.1.3.1',
      'landmark-one-main': '9.1.3.1',
      'landmark-main-is-top-level': '9.1.3.1',
      'page-has-heading-one': '9.1.3.1',
      'region': '9.1.3.1',
      'skip-link': '9.2.4.1',
      'focus-order-semantics': '9.2.4.3',
      'tabindex': '9.2.4.3',
      'aria-allowed-attr': '9.4.1.2',
      'aria-required-attr': '9.4.1.2',
      'aria-valid-attr': '9.4.1.2',
      'aria-valid-attr-value': '9.4.1.2',
      'duplicate-id': '9.4.1.1',
      'duplicate-id-active': '9.4.1.1',
      'duplicate-id-aria': '9.4.1.1',
      'form-field-multiple-labels': '9.3.3.2',
      'aria-hidden-body': '9.4.1.2',
      'definition-list': '9.1.3.1',
      'dlitem': '9.1.3.1',
      'document-title': '9.2.4.2',
      'frame-title': '9.2.4.1',
      'list': '9.1.3.1',
      'listitem': '9.1.3.1',
      'meta-refresh': '9.2.2.1',
      'meta-viewport': '9.1.4.4'
    };

    // Definizione completa dei criteri WCAG 2.1 A e AA
    const allCriteria = [
      { num: '1.1.1', title: 'Contenuti non testuali', level: 'A', en: '9.1.1.1' },
      { num: '1.2.1', title: 'Solo audio e solo video (preregistrati)', level: 'A', en: '9.1.2.1' },
      { num: '1.2.2', title: 'Sottotitoli (preregistrati)', level: 'A', en: '9.1.2.2' },
      { num: '1.2.3', title: 'Audiodescrizione o tipo di media alternativo (preregistrato)', level: 'A', en: '9.1.2.3' },
      { num: '1.2.4', title: 'Sottotitoli (in tempo reale)', level: 'AA', en: '9.1.2.4' },
      { num: '1.2.5', title: 'Audiodescrizione (preregistrata)', level: 'AA', en: '9.1.2.5' },
      { num: '1.3.1', title: 'Informazioni e correlazioni', level: 'A', en: '9.1.3.1' },
      { num: '1.3.2', title: 'Sequenza significativa', level: 'A', en: '9.1.3.2' },
      { num: '1.3.3', title: 'Caratteristiche sensoriali', level: 'A', en: '9.1.3.3' },
      { num: '1.3.4', title: 'Orientamento', level: 'AA', en: '9.1.3.4', wcag21: true },
      { num: '1.3.5', title: 'Identificare lo scopo degli input', level: 'AA', en: '9.1.3.5', wcag21: true },
      { num: '1.4.1', title: 'Uso del colore', level: 'A', en: '9.1.4.1' },
      { num: '1.4.2', title: 'Controllo del sonoro', level: 'A', en: '9.1.4.2' },
      { num: '1.4.3', title: 'Contrasto minimo', level: 'AA', en: '9.1.4.3' },
      { num: '1.4.4', title: 'Ridimensionamento del testo', level: 'AA', en: '9.1.4.4' },
      { num: '1.4.5', title: 'Immagini di testo', level: 'AA', en: '9.1.4.5' },
      { num: '1.4.10', title: 'Ricalcolo del flusso', level: 'AA', en: '9.1.4.10', wcag21: true },
      { num: '1.4.11', title: 'Contrasto in contenuti non testuali', level: 'AA', en: '9.1.4.11', wcag21: true },
      { num: '1.4.12', title: 'Spaziatura del testo', level: 'AA', en: '9.1.4.12', wcag21: true },
      { num: '1.4.13', title: 'Contenuto con Hover o Focus', level: 'AA', en: '9.1.4.13', wcag21: true },
      { num: '2.1.1', title: 'Tastiera', level: 'A', en: '9.2.1.1' },
      { num: '2.1.2', title: 'Nessun impedimento all\'uso della tastiera', level: 'A', en: '9.2.1.2' },
      { num: '2.1.4', title: 'Tasti di scelta rapida', level: 'AA', en: '9.2.1.4', wcag21: true },
      { num: '2.2.1', title: 'Regolazione tempi di esecuzione', level: 'A', en: '9.2.2.1' },
      { num: '2.2.2', title: 'Pausa, Stop, Nascondi', level: 'A', en: '9.2.2.2' },
      { num: '2.3.1', title: 'Tre lampeggiamenti o inferiore alla soglia', level: 'A', en: '9.2.3.1' },
      { num: '2.4.1', title: 'Salto di blocchi', level: 'A', en: '9.2.4.1' },
      { num: '2.4.2', title: 'Titolazione della pagina', level: 'A', en: '9.2.4.2' },
      { num: '2.4.3', title: 'Ordine del focus', level: 'A', en: '9.2.4.3' },
      { num: '2.4.4', title: 'Scopo del collegamento (nel contesto)', level: 'A', en: '9.2.4.4' },
      { num: '2.4.5', title: 'Differenti modalità', level: 'AA', en: '9.2.4.5' },
      { num: '2.4.6', title: 'Intestazioni ed etichette', level: 'AA', en: '9.2.4.6' },
      { num: '2.4.7', title: 'Focus visibile', level: 'AA', en: '9.2.4.7' },
      { num: '2.5.1', title: 'Movimenti del puntatore', level: 'AA', en: '9.2.5.1', wcag21: true },
      { num: '2.5.2', title: 'Cancellazione delle azioni del puntatore', level: 'AA', en: '9.2.5.2', wcag21: true },
      { num: '2.5.3', title: 'Etichetta nel nome', level: 'AA', en: '9.2.5.3', wcag21: true },
      { num: '2.5.4', title: 'Azionamento da movimento', level: 'AA', en: '9.2.5.4', wcag21: true },
      { num: '3.1.1', title: 'Lingua della pagina', level: 'A', en: '9.3.1.1' },
      { num: '3.1.2', title: 'Parti in lingua', level: 'AA', en: '9.3.1.2' },
      { num: '3.2.1', title: 'Al Focus', level: 'A', en: '9.3.2.1' },
      { num: '3.2.2', title: 'All\'input', level: 'A', en: '9.3.2.2' },
      { num: '3.2.3', title: 'Navigazione coerente', level: 'AA', en: '9.3.2.3' },
      { num: '3.2.4', title: 'Identificazione coerente', level: 'AA', en: '9.3.2.4' },
      { num: '3.3.1', title: 'Identificazione di errori', level: 'A', en: '9.3.3.1' },
      { num: '3.3.2', title: 'Etichette o istruzioni', level: 'A', en: '9.3.3.2' },
      { num: '3.3.3', title: 'Suggerimenti per gli errori', level: 'AA', en: '9.3.3.3' },
      { num: '3.3.4', title: 'Prevenzione degli errori (legali, finanziari, dati)', level: 'AA', en: '9.3.3.4' },
      { num: '4.1.1', title: 'Analisi sintattica (parsing)', level: 'A', en: '9.4.1.1' },
      { num: '4.1.2', title: 'Nome, ruolo, valore', level: 'A', en: '9.4.1.2' },
      { num: '4.1.3', title: 'Messaggi di stato', level: 'AA', en: '9.4.1.3', wcag21: true }
    ];

    // Determina conformità per ogni criterio
    // Regole:
    // - Default: NA (Non Applicabile)
    // - Se viene trovata una violazione: NS (Non Soddisfatto) e non può più cambiare
    // - Se viene soddisfatto (testato senza violazioni): S (Soddisfatto)
    const criteriaStatus = {};
    const criteriaViolated = new Set(); // Criteri che hanno avuto violazioni

    allCriteria.forEach(criterion => {
      criteriaStatus[criterion.en] = 'NA'; // Default: Non Applicabile
    });

    // Marca come NS i criteri con violazioni (una volta NS, rimane NS)
    Object.values(violationsByType).forEach(violation => {
      const enCriterion = wcagMapping[violation.id];
      if (enCriterion) {
        // Può essere multiplo (es: "9.1.3.1, 9.3.3.2")
        enCriterion.split(',').forEach(en => {
          const trimmedEn = en.trim();
          if (criteriaStatus.hasOwnProperty(trimmedEn)) {
            criteriaStatus[trimmedEn] = 'NS';
            criteriaViolated.add(trimmedEn);
          }
        });
      }
    });

    // Marca come S (Soddisfatto) i criteri testati ma senza violazioni
    // Solo se non sono stati mai marcati come NS
    this.results.forEach(result => {
      if (result.error || !result.axeResults.passes) return;

      result.axeResults.passes.forEach(pass => {
        const enCriterion = wcagMapping[pass.id];
        if (enCriterion) {
          enCriterion.split(',').forEach(en => {
            const trimmedEn = en.trim();
            // Passa a S solo se è ancora NA (non è mai stato violato)
            if (criteriaStatus.hasOwnProperty(trimmedEn) &&
                criteriaStatus[trimmedEn] === 'NA' &&
                !criteriaViolated.has(trimmedEn)) {
              criteriaStatus[trimmedEn] = 'S';
            }
          });
        }
      });
    });

    // Genera le righe della tabella
    const tableRows = allCriteria.map(criterion => {
      const wcag21Note = criterion.wcag21 ? ` (solo livello ${criterion.level} 2.1)` : '';
      const levelNote = criterion.level === 'AA' ? ` (livello ${criterion.level})` : ` (livello ${criterion.level})`;
      const conformity = criteriaStatus[criterion.en] || 'NA';

      return `<tr><td>${criterion.num} ${criterion.title}${levelNote}${wcag21Note} Norma EN 301 549, criterio: ${criterion.en} ${criterion.title}</td><td>${conformity}</td><td></td></tr>`;
    }).join('\n');

    // Template HTML
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Modello di Autovalutazione AGID - Sezione Web</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        h2, h3 {
            color: #003366;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }
        th {
            background-color: #003366;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        .page-break {
            border: none;
            border-top: 2px dashed #ccc;
            margin: 40px 0;
            page-break-after: always;
            break-after: page;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        ul {
            margin: 10px 0;
        }
        li {
            margin: 5px 0;
        }
    </style>
</head>
<body>
    <main>
        <h2 style="padding-top: 200px; padding-bottom: 500px; text-align: center;">ALLEGATO 2 ALLE LINEE GUIDA SULL'ACCESSIBILITÀ DEGLI STRUMENTI INFORMATICI
    MODELLO DI AUTOVALUTAZIONE PER <a href="${config.siteUrl}">${config.siteName.toUpperCase()}</a></h2>

        <hr class="page-break" aria-hidden="true">

        <p>Il modello di autovalutazione di accessibilità è stato realizzato in conformità alla Legge "Disposizioni per favorire e semplificare l'accesso degli utenti e, in particolare, delle persone con disabilità agli strumenti informatici".</p>

        <section>
            <h3>Modello di autovalutazione</h3>
            <p><strong>Data:</strong> ${config.testDate}</p>
            <p><strong>Breve descrizione del prodotto:</strong> Autovalutazione del sito web <a href="${config.siteUrl}">${config.siteName}</a></p>
            <p><strong>Metodologia di valutazione:</strong> ${config.methodology}</p>
            <p><strong>Standard applicabili e linee guida:</strong> ${config.standard}</p>
            <p><strong>Responsabile alla compilazione:</strong> ${config.responsible}</p>
        </section>

        <hr class="page-break" aria-hidden="true">

        <section id="terminologia">
            <h3>Terminologia</h3>
            <p>I termini utilizzati per la dichiarazione di conformità sono definiti come:</p>
            <ul>
                <li><strong>Soddisfatto:</strong> tutte le funzionalità dell'ICT soddisfano il criterio</li>
                <li><strong>Non soddisfatto:</strong> la maggior parte delle funzionalità dell'ICT non soddisfano il criterio</li>
                <li><strong>Non applicabile:</strong> il criterio non è applicabile alle funzionalità dell'ICT</li>
            </ul>

            <h3>Web</h3>
            <p>Requisiti minimi per contenuti livello A e AA (obbligatori)</p>
            <p>Nota: per i documenti inseriti all'interno delle pagine Web (inclusi i documenti e moduli scaricabili) si faccia riferimento ai punti di controllo presenti nella tabella "Documenti non Web".</p>

            <table>
    <thead>
        <tr>
            <th>Criterio</th>
            <th>Conformità</th>
            <th>Note</th>
        </tr>
    </thead>
    <tbody>
${tableRows}
    </tbody>
</table>
        </section>
    </main>

    <footer>
    </footer>
</body>
</html>`;

    // Salva il file
    const siteNameClean = config.siteName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${_buildTimestamp(endTime)}_${siteNameClean}_allegato2.html`;
    const filepath = _docsPath(filename);

    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`\n✅ Allegato 2 AGID generato: ${filename}`);

    return filepath;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
    if (this.context) {
      await this.context.close();
    }
  }
}

module.exports = {
  A11yChecker
};