const { chromium } = require('playwright');

class SEOChecker {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = [];
    this.visitedPages = new Set();
    this.duplicateTitles = new Map();
    this.duplicateDescriptions = new Map();
  }

  async init(options = {}) {
    // Se è specificato un profilo Chrome, usa launchPersistentContext
    if (options.userDataDir) {
      const contextOptions = {
        headless: false,
        slowMo: 500,
        channel: 'chrome',
        ...options
      };

      this.context = await chromium.launchPersistentContext(options.userDataDir, contextOptions);
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else {
      // Modalità normale senza profilo
      const launchOptions = {
        headless: false,
        slowMo: 500,
        ...options
      };

      this.browser = await chromium.launch(launchOptions);
      this.page = await this.browser.newPage();
    }
  }

  async checkHeadingStructure(url) {
    console.log(`\n📊 Controllo struttura heading per: ${url}`);

    await this.page.goto(url);

    const headings = await this.page.$$eval('h1, h2, h3, h4, h5, h6', els =>
      els.map(el => ({
        tag: el.tagName.toLowerCase(),
        text: el.textContent.trim(),
        level: parseInt(el.tagName.charAt(1))
      }))
    );

    const issues = [];

    // Controlla presenza H1
    const h1Count = headings.filter(h => h.tag === 'h1').length;
    if (h1Count === 0) {
      issues.push('❌ Nessun H1 trovato');
    } else if (h1Count > 1) {
      issues.push(`❌ Troppi H1 trovati: ${h1Count}`);
    }

    // Controlla sequenza logica
    let previousLevel = 0;
    for (let i = 0; i < headings.length; i++) {
      const current = headings[i];
      if (current.level > previousLevel + 1) {
        issues.push(`❌ Salto di livello: da H${previousLevel} a H${current.level} - "${current.text}"`);
      }
      previousLevel = current.level;
    }

    return {
      url,
      headings,
      issues,
      valid: issues.length === 0
    };
  }

  async checkMetaTags(url) {
    console.log(`\n🏷️  Controllo meta tags per: ${url}`);

    await this.page.goto(url);

    const metaData = await this.page.evaluate(() => {
      const title = document.title;
      const descriptionEl = document.querySelector('meta[name="description"]');
      const description = descriptionEl ? descriptionEl.getAttribute('content') : null;

      return {
        title: title || '',
        description: description || ''
      };
    });

    const issues = [];

    // Controlla title
    if (!metaData.title) {
      issues.push('❌ Title mancante');
    } else {
      if (metaData.title.length < 30) {
        issues.push(`❌ Title troppo corto: ${metaData.title.length} caratteri (min 30)`);
      }
      if (metaData.title.length > 60) {
        issues.push(`❌ Title troppo lungo: ${metaData.title.length} caratteri (max 60)`);
      }
    }

    // Controlla description
    if (!metaData.description) {
      issues.push('❌ Meta description mancante');
    } else {
      if (metaData.description.length < 70) {
        issues.push(`❌ Description troppo corta: ${metaData.description.length} caratteri (min 70)`);
      }
      if (metaData.description.length > 155) {
        issues.push(`❌ Description troppo lunga: ${metaData.description.length} caratteri (max 155)`);
      }
    }

    // Traccia duplicati
    if (metaData.title) {
      if (this.duplicateTitles.has(metaData.title)) {
        this.duplicateTitles.get(metaData.title).push(url);
        issues.push(`❌ Title duplicato`);
      } else {
        this.duplicateTitles.set(metaData.title, [url]);
      }
    }

    if (metaData.description) {
      if (this.duplicateDescriptions.has(metaData.description)) {
        this.duplicateDescriptions.get(metaData.description).push(url);
        issues.push(`❌ Description duplicata`);
      } else {
        this.duplicateDescriptions.set(metaData.description, [url]);
      }
    }

    return {
      url,
      title: metaData.title,
      titleLength: metaData.title.length,
      description: metaData.description,
      descriptionLength: metaData.description.length,
      issues,
      valid: issues.length === 0
    };
  }

  async navigateAndCheck(baseUrl, maxPages = 10) {
    console.log(`\n🚀 Inizio navigazione da: ${baseUrl}`);

    await this.page.goto(baseUrl);

    // Trova tutti i link di navigazione
    const navLinks = await this.page.$$eval('nav a, .menu a, .navigation a', els =>
      els.map(el => ({
        href: el.href,
        text: el.textContent.trim()
      })).filter(link => link.href && !link.href.includes('#') && !link.href.includes('mailto:'))
    );

    console.log(`📝 Trovati ${navLinks.length} link di navigazione`);

    const pagesToCheck = [baseUrl, ...navLinks.map(link => link.href)]
      .filter((url, index, arr) => arr.indexOf(url) === index) // Rimuovi duplicati
      .slice(0, maxPages);

    for (const url of pagesToCheck) {
      if (this.visitedPages.has(url)) continue;

      try {
        // Controlla heading
        const headingResult = await this.checkHeadingStructure(url);

        // Controlla meta tags
        const metaResult = await this.checkMetaTags(url);

        this.results.push({
          url,
          heading: headingResult,
          meta: metaResult,
          timestamp: new Date().toISOString()
        });

        this.visitedPages.add(url);

        // Aspetta un po' tra le richieste
        await this.page.waitForTimeout(1000);

      } catch (error) {
        console.error(`❌ Errore controllando ${url}:`, error.message);
        this.results.push({
          url,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  generateReport() {
    console.log('\n📊 REPORT FINALE SEO');
    console.log('='.repeat(50));

    let totalIssues = 0;
    let pagesWithIssues = 0;

    this.results.forEach((result, index) => {
      if (result.error) {
        console.log(`\n${index + 1}. ❌ ERRORE - ${result.url}`);
        console.log(`   Errore: ${result.error}`);
        return;
      }

      const headingIssues = result.heading?.issues || [];
      const metaIssues = result.meta?.issues || [];
      const allIssues = [...headingIssues, ...metaIssues];

      totalIssues += allIssues.length;
      if (allIssues.length > 0) pagesWithIssues++;

      console.log(`\n${index + 1}. ${allIssues.length === 0 ? '✅' : '⚠️'} ${result.url}`);

      if (result.meta) {
        console.log(`   📄 Title: "${result.meta.title}" (${result.meta.titleLength} char)`);
        console.log(`   📝 Description: "${result.meta.description}" (${result.meta.descriptionLength} char)`);
      }

      if (result.heading) {
        console.log(`   📊 Headings: ${result.heading.headings.length} trovati`);
      }

      if (allIssues.length > 0) {
        console.log('   🚨 Problemi:');
        allIssues.forEach(issue => console.log(`      ${issue}`));
      }
    });

    // Report duplicati
    console.log('\n🔍 CONTROLLO DUPLICATI');
    console.log('='.repeat(30));

    const duplicateTitles = Array.from(this.duplicateTitles.entries())
      .filter(([title, urls]) => urls.length > 1);

    const duplicateDescs = Array.from(this.duplicateDescriptions.entries())
      .filter(([desc, urls]) => urls.length > 1);

    if (duplicateTitles.length > 0) {
      console.log('\n❌ TITLE DUPLICATI:');
      duplicateTitles.forEach(([title, urls]) => {
        console.log(`   "${title}"`);
        urls.forEach(url => console.log(`      - ${url}`));
      });
    }

    if (duplicateDescs.length > 0) {
      console.log('\n❌ DESCRIPTION DUPLICATE:');
      duplicateDescs.forEach(([desc, urls]) => {
        console.log(`   "${desc}"`);
        urls.forEach(url => console.log(`      - ${url}`));
      });
    }

    console.log('\n📈 STATISTICHE FINALI');
    console.log('='.repeat(30));
    console.log(`Pagine controllate: ${this.results.length}`);
    console.log(`Pagine con problemi: ${pagesWithIssues}`);
    console.log(`Problemi totali: ${totalIssues}`);
    console.log(`Title duplicati: ${duplicateTitles.length}`);
    console.log(`Description duplicate: ${duplicateDescs.length}`);
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

// Esempio di utilizzo
async function runSEOCheck() {
  const checker = new SEOChecker();

  try {
    await checker.init();

    // Sostituisci con l'URL del sito da controllare
    const website = 'https://example.com';

    await checker.navigateAndCheck(website, 5); // Max 5 pagine

    checker.generateReport();

  } catch (error) {
    console.error('Errore durante il controllo SEO:', error);
  } finally {
    await checker.close();
  }
}

// Esporta per uso come modulo
module.exports = { SEOChecker };

// Esegui se chiamato direttamente
if (require.main === module) {
  runSEOCheck();
}