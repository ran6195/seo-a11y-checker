const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class SEOChecker {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = [];
    this.visitedPages = new Set();
    this.pendingPages = new Set();
    this.duplicateTitles = new Map();
    this.duplicateDescriptions = new Map();
    this.startTime = new Date();
    this.baseDomain = null;
    this.maxPages = null;
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

  detectPageType(url) {
    const urlPath = new URL(url).pathname.toLowerCase();

    // Pattern comuni per categorie
    const categoryPatterns = [
      /\/category\//,
      /\/categories\//,
      /\/cat\//,
      /\/categoria\//,
      /\/categorie\//,
      /\/tag\//,
      /\/tags\//,
      /\/topic\//,
      /\/topics\//,
      /\/prodotti\//,
      /\/products\//,
      /\/servizi\//,
      /\/services\//,
      /\/blog\/category\//,
      /\/news\/category\//
    ];

    const isCategory = categoryPatterns.some(pattern => pattern.test(urlPath));

    // Pattern per articoli/post
    const articlePatterns = [
      /\/blog\//,
      /\/news\//,
      /\/post\//,
      /\/article\//,
      /\/articolo\//,
      /\/\d{4}\/\d{2}\//, // Date pattern (2024/01/)
    ];

    const isArticle = articlePatterns.some(pattern => pattern.test(urlPath));

    if (isCategory) return 'category';
    if (isArticle) return 'article';
    if (urlPath === '/' || urlPath === '') return 'homepage';

    return 'page';
  }

  async checkPageSize(url) {

    const response = await this.page.goto(url, { waitUntil: 'networkidle' });

    // Ottieni la dimensione della risposta HTTP
    const contentLength = response.headers()['content-length'];
    let pageSize = 0;

    if (contentLength) {
      pageSize = parseInt(contentLength);
    } else {
      // Se non c'è content-length, calcola la dimensione del DOM
      const bodyContent = await this.page.content();
      pageSize = Buffer.byteLength(bodyContent, 'utf8');
    }

    const pageSizeKB = Math.round(pageSize / 1024);
    const issues = [];

    if (pageSizeKB > 200) {
      issues.push(`❌ Pagina troppo pesante: ${pageSizeKB} KB (limite: 200 KB)`);
    }

    return {
      url,
      pageSize,
      pageSizeKB,
      issues,
      valid: issues.length === 0
    };
  }

  async checkMetaTags(url) {

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

    const pageType = this.detectPageType(url);

    const issues = [];

    // Controlla title in base al tipo di pagina
    if (!metaData.title) {
      issues.push(`❌ Title mancante (pagina ${pageType})`);
    } else {
      // Limiti specifici per tipo di pagina
      let titleMin = 30, titleMax = 60;

      if (pageType === 'category') {
        titleMin = 25; // Categorie possono essere più corte
        titleMax = 65;
      } else if (pageType === 'article') {
        titleMin = 35; // Articoli dovrebbero essere più descrittivi
        titleMax = 60;
      }

      if (metaData.title.length < titleMin) {
        issues.push(`❌ Title troppo corto per ${pageType}: ${metaData.title.length} caratteri (min ${titleMin})`);
      }
      if (metaData.title.length > titleMax) {
        issues.push(`❌ Title troppo lungo per ${pageType}: ${metaData.title.length} caratteri (max ${titleMax})`);
      }

      // Controllo specifico per categorie
      if (pageType === 'category') {
        const categoryKeywords = ['categoria', 'category', 'prodotti', 'products', 'servizi', 'services'];
        const hasCategory = categoryKeywords.some(keyword =>
          metaData.title.toLowerCase().includes(keyword)
        );
        if (!hasCategory) {
          issues.push(`💡 Suggerimento: Considera di includere "categoria" o "prodotti" nel title`);
        }
      }
    }

    // Controlla description in base al tipo di pagina
    if (!metaData.description) {
      issues.push(`❌ Meta description mancante (pagina ${pageType})`);
    } else {
      let descMin = 70, descMax = 155;

      if (pageType === 'category') {
        descMin = 60; // Categorie possono avere description più concise
        descMax = 160;
      }

      if (metaData.description.length < descMin) {
        issues.push(`❌ Description troppo corta per ${pageType}: ${metaData.description.length} caratteri (min ${descMin})`);
      }
      if (metaData.description.length > descMax) {
        issues.push(`❌ Description troppo lunga per ${pageType}: ${metaData.description.length} caratteri (max ${descMax})`);
      }

      // Controllo specifico per categorie
      if (pageType === 'category') {
        const categoryDescWords = ['scopri', 'esplora', 'trova', 'selezione', 'collezione'];
        const hasCategoryDesc = categoryDescWords.some(word =>
          metaData.description.toLowerCase().includes(word)
        );
        if (!hasCategoryDesc) {
          issues.push(`💡 Suggerimento: Usa parole come "scopri", "esplora" nella description di categoria`);
        }
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
      pageType,
      issues,
      valid: issues.length === 0
    };
  }

  isValidUrl(url) {
    try {
      const urlObj = new URL(url);

      // Deve essere stesso dominio (gestisce www)
      const normalizedHostname = urlObj.hostname.replace(/^www\./, '');
      const normalizedBaseDomain = this.baseDomain.replace(/^www\./, '');

      if (normalizedHostname !== normalizedBaseDomain) {
        return false;
      }

      // Esclude file documenti e immagini
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

      // Esclude parametri comuni di sessione/tracking
      const excludedParams = ['utm_', 'fbclid', 'gclid', 'ref=', 'source='];
      const search = urlObj.search.toLowerCase();
      if (excludedParams.some(param => search.includes(param))) {
        return false;
      }

      // Esclude anchor/fragment solo se è solo un anchor senza path diverso
      if (urlObj.hash && urlObj.pathname === new URL(this.page.url()).pathname) {
        return false;
      }

      // Esclude email e telefono
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
        els.map(el => {
          const href = el.href;
          return href;
        }).filter(href => href && href.trim().length > 0)
      );

      const validLinks = links.filter(link => this.isValidUrl(link));

      // Normalizza URL (rimuovi trailing slash, parametri inutili, gestisci www)
      const normalizedLinks = validLinks.map(link => {
        const url = new URL(link);
        // Rimuovi trailing slash tranne per root
        if (url.pathname !== '/' && url.pathname.endsWith('/')) {
          url.pathname = url.pathname.slice(0, -1);
        }
        // Normalizza hostname rimuovendo www per evitare duplicati
        url.hostname = url.hostname.replace(/^www\./, '');
        return url.toString();
      });

      return [...new Set(normalizedLinks)]; // Rimuovi duplicati
    } catch (error) {
      console.warn(`Errore durante scoperta link: ${error.message}`);
      return [];
    }
  }

  async crawlSite(baseUrl, maxPages = null) {
    console.log(`\n🕷️  Inizio crawling completo di: ${baseUrl}`);

    // Imposta dominio base
    this.baseDomain = new URL(baseUrl).hostname;
    this.maxPages = maxPages;

    // Inizializza con URL base
    this.pendingPages.add(baseUrl);

    let crawledCount = 0;

    while (this.pendingPages.size > 0 && (maxPages === null || crawledCount < maxPages)) {
      // Prendi il prossimo URL da elaborare
      const currentUrl = Array.from(this.pendingPages)[0];
      this.pendingPages.delete(currentUrl);

      // Salta se già visitato
      if (this.visitedPages.has(currentUrl)) {
        continue;
      }

      crawledCount++;
      console.log(`\n[${crawledCount}${maxPages ? `/${maxPages}` : ''}] 🔍 ${currentUrl}`);

      try {
        await this.page.goto(currentUrl, {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        // Scopri nuovi link sulla pagina corrente
        const discoveredLinks = await this.discoverLinksOnPage();

        // Aggiungi nuovi link alla coda
        discoveredLinks.forEach(link => {
          if (!this.visitedPages.has(link) && !this.pendingPages.has(link)) {
            this.pendingPages.add(link);
          }
        });

        // Esegui controlli SEO
        const headingResult = await this.checkHeadingStructure(currentUrl);
        const metaResult = await this.checkMetaTags(currentUrl);
        const pageSizeResult = await this.checkPageSize(currentUrl);

        this.results.push({
          url: currentUrl,
          heading: headingResult,
          meta: metaResult,
          pageSize: pageSizeResult,
          timestamp: new Date().toISOString()
        });

        this.visitedPages.add(currentUrl);

        // Status update semplificato
        console.log(`   📊 Pagine rimanenti: ${this.pendingPages.size}`);

        // Pausa tra richieste per non sovraccaricare il server
        await this.page.waitForTimeout(1000);

      } catch (error) {
        console.error(`   ❌ Errore su ${currentUrl}: ${error.message}`);

        this.results.push({
          url: currentUrl,
          error: error.message,
          timestamp: new Date().toISOString()
        });

        this.visitedPages.add(currentUrl);
      }
    }

    const totalDiscovered = this.visitedPages.size + this.pendingPages.size;
    const crawlPercentage = Math.round((crawledCount / totalDiscovered) * 100);

    console.log(`\n🎯 RIEPILOGO CRAWLING`);
    console.log(`=`.repeat(40));
    console.log(`✅ Pagine elaborate: ${crawledCount}/${totalDiscovered} (${crawlPercentage}%)`);
    console.log(`🔍 Pagine scoperte totali: ${totalDiscovered}`);
    console.log(`⏭️  Pagine saltate: ${this.pendingPages.size}`);
    console.log(`⏱️  Durata: ${Math.round((new Date() - this.startTime) / 1000)}s`);

    if (maxPages && crawledCount >= maxPages) {
      console.log(`🛑 Limite raggiunto (${maxPages} pagine)`);
    }
  }

  async navigateAndCheck(baseUrl, maxPages = 10) {
    console.log(`\n🚀 Inizio navigazione da: ${baseUrl}`);

    await this.page.goto(baseUrl);

    // Trova tutti i link di navigazione (incluse categorie)
    const navLinks = await this.page.$$eval(`
      nav a, .menu a, .navigation a,
      .category-menu a, .categories a,
      .product-categories a, .cat-menu a,
      .main-menu a, .primary-menu a,
      .categoria a, .categorie a,
      [class*="category"] a,
      [class*="categoria"] a
    `, els =>
      els.map(el => ({
        href: el.href,
        text: el.textContent.trim(),
        className: el.className
      })).filter(link =>
        link.href &&
        !link.href.includes('#') &&
        !link.href.includes('mailto:') &&
        !link.href.includes('tel:') &&
        link.text.length > 0
      )
    );

    // Cerca anche link nelle categorie nel footer o sidebar
    const additionalCategoryLinks = await this.page.$$eval(`
      .footer a, .sidebar a, .widget a,
      [class*="category-list"] a,
      [class*="cat-list"] a,
      .product-menu a
    `, els =>
      els.map(el => ({
        href: el.href,
        text: el.textContent.trim(),
        className: el.className
      })).filter(link => {
        if (!link.href || link.href.includes('#') || link.href.includes('mailto:')) return false;

        // Filtra solo link che sembrano categorie
        const categoryIndicators = [
          'category', 'categoria', 'cat-', 'product', 'service', 'tag'
        ];
        const url = link.href.toLowerCase();
        const text = link.text.toLowerCase();

        return categoryIndicators.some(indicator =>
          url.includes(indicator) || text.includes(indicator)
        );
      })
    ).catch(() => []);

    // Combina tutti i link e rimuovi duplicati
    const allLinks = [...navLinks, ...additionalCategoryLinks];
    const uniqueLinks = allLinks.filter((link, index, arr) =>
      arr.findIndex(l => l.href === link.href) === index
    );

    console.log(`📝 Trovati ${uniqueLinks.length} link totali (${navLinks.length} navigazione + ${additionalCategoryLinks.length} categorie aggiuntive)`);

    // Classifica i link per tipo
    const linksByType = {
      category: [],
      article: [],
      page: [],
      homepage: []
    };

    uniqueLinks.forEach(link => {
      const pageType = this.detectPageType(link.href);
      linksByType[pageType].push(link);
    });

    console.log(`   📁 Categorie: ${linksByType.category.length}`);
    console.log(`   📰 Articoli: ${linksByType.article.length}`);
    console.log(`   📄 Pagine: ${linksByType.page.length}`);

    // Prioritizza le categorie nel controllo
    const prioritizedPages = [baseUrl];

    // Aggiungi tutte le categorie trovate
    prioritizedPages.push(...linksByType.category.map(link => link.href));

    // Aggiungi altre pagine fino al limite
    const remainingSlots = maxPages - prioritizedPages.length;
    if (remainingSlots > 0) {
      const otherPages = [
        ...linksByType.page.map(link => link.href),
        ...linksByType.article.map(link => link.href)
      ];
      prioritizedPages.push(...otherPages.slice(0, remainingSlots));
    }

    const pagesToCheck = prioritizedPages
      .filter((url, index, arr) => arr.indexOf(url) === index) // Rimuovi duplicati
      .slice(0, maxPages);

    for (const url of pagesToCheck) {
      if (this.visitedPages.has(url)) continue;

      try {
        // Controlla heading
        const headingResult = await this.checkHeadingStructure(url);

        // Controlla meta tags
        const metaResult = await this.checkMetaTags(url);

        // Controlla dimensioni pagina
        const pageSizeResult = await this.checkPageSize(url);

        this.results.push({
          url,
          heading: headingResult,
          meta: metaResult,
          pageSize: pageSizeResult,
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
      const pageSizeIssues = result.pageSize?.issues || [];
      const allIssues = [...headingIssues, ...metaIssues, ...pageSizeIssues];

      totalIssues += allIssues.length;
      if (allIssues.length > 0) pagesWithIssues++;

      const pageTypeEmoji = {
        homepage: '🏠',
        category: '📁',
        article: '📰',
        page: '📄'
      };

      const emoji = pageTypeEmoji[result.meta?.pageType] || '📄';
      console.log(`\n${index + 1}. ${allIssues.length === 0 ? '✅' : '⚠️'} ${emoji} ${result.url}`);

      if (result.meta) {
        console.log(`   📄 Title: "${result.meta.title}" (${result.meta.titleLength} char)`);
        console.log(`   📝 Description: "${result.meta.description}" (${result.meta.descriptionLength} char)`);
        console.log(`   🔖 Tipo: ${result.meta.pageType}`);
      }

      if (result.heading) {
        console.log(`   📊 Headings: ${result.heading.headings.length} trovati`);
      }

      if (result.pageSize) {
        console.log(`   📏 Dimensione: ${result.pageSize.pageSizeKB} KB`);
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

    // Statistiche per tipo di pagina
    const pageTypeStats = {
      homepage: 0,
      category: 0,
      article: 0,
      page: 0
    };

    this.results.forEach(result => {
      if (result.meta?.pageType) {
        pageTypeStats[result.meta.pageType]++;
      }
    });

    console.log('\n📈 STATISTICHE FINALI');
    console.log('='.repeat(30));
    console.log(`Pagine controllate: ${this.results.length}`);
    console.log(`  🏠 Homepage: ${pageTypeStats.homepage}`);
    console.log(`  📁 Categorie: ${pageTypeStats.category}`);
    console.log(`  📰 Articoli: ${pageTypeStats.article}`);
    console.log(`  📄 Altre pagine: ${pageTypeStats.page}`);
    console.log(`Pagine con problemi: ${pagesWithIssues}`);
    console.log(`Problemi totali: ${totalIssues}`);
    console.log(`Title duplicati: ${duplicateTitles.length}`);
    console.log(`Description duplicate: ${duplicateDescs.length}`);
  }

  generateMarkdownReport(filename = null) {
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    if (!filename) {
      const timestamp = endTime.toISOString().slice(0, 19).replace(/[T:]/g, '-');
      filename = `seo-report-${timestamp}.md`;
    }

    let totalIssues = 0;
    let pagesWithIssues = 0;
    let pagesWithoutErrors = 0;

    // Calcola statistiche
    const pageTypeStats = {
      homepage: 0,
      category: 0,
      article: 0,
      page: 0
    };

    this.results.forEach(result => {
      if (result.error) return;

      // Conta per tipo di pagina
      if (result.meta?.pageType) {
        pageTypeStats[result.meta.pageType]++;
      }

      const headingIssues = result.heading?.issues || [];
      const metaIssues = result.meta?.issues || [];
      const pageSizeIssues = result.pageSize?.issues || [];
      const allIssues = [...headingIssues, ...metaIssues, ...pageSizeIssues];

      totalIssues += allIssues.length;
      if (allIssues.length > 0) {
        pagesWithIssues++;
      } else {
        pagesWithoutErrors++;
      }
    });

    const duplicateTitles = Array.from(this.duplicateTitles.entries())
      .filter(([title, urls]) => urls.length > 1);

    const duplicateDescs = Array.from(this.duplicateDescriptions.entries())
      .filter(([desc, urls]) => urls.length > 1);

    // Genera contenuto markdown
    let markdown = `# 📊 Report SEO

## ℹ️ Informazioni Generali

- **Data**: ${endTime.toLocaleDateString('it-IT')} alle ${endTime.toLocaleTimeString('it-IT')}
- **Durata controllo**: ${duration} secondi
- **Pagine totali**: ${this.results.length}
  - 🏠 Homepage: ${pageTypeStats.homepage}
  - 📁 Categorie: ${pageTypeStats.category}
  - 📰 Articoli: ${pageTypeStats.article}
  - 📄 Altre pagine: ${pageTypeStats.page}
- **Pagine senza errori**: ${pagesWithoutErrors}
- **Pagine con problemi**: ${pagesWithIssues}
- **Problemi totali**: ${totalIssues}

## 📈 Riepilogo Problemi

| Tipo | Quantità |
|------|----------|
| 🚨 Problemi SEO totali | ${totalIssues} |
| 📄 Title duplicati | ${duplicateTitles.length} |
| 📝 Description duplicate | ${duplicateDescs.length} |
| ❌ Pagine con errori | ${this.results.filter(r => r.error).length} |

## 📋 Dettaglio Pagine

`;

    // Dettaglio per ogni pagina
    this.results.forEach((result, index) => {
      const pageNumber = index + 1;

      if (result.error) {
        markdown += `### ${pageNumber}. ❌ ERRORE - ${result.url}

**Errore**: ${result.error}

---

`;
        return;
      }

      const headingIssues = result.heading?.issues || [];
      const metaIssues = result.meta?.issues || [];
      const pageSizeIssues = result.pageSize?.issues || [];
      const allIssues = [...headingIssues, ...metaIssues, ...pageSizeIssues];
      const status = allIssues.length === 0 ? '✅ VALIDA' : '⚠️ PROBLEMI';

      const pageTypeEmoji = {
        homepage: '🏠',
        category: '📁',
        article: '📰',
        page: '📄'
      };

      const emoji = pageTypeEmoji[result.meta?.pageType] || '📄';

      markdown += `### ${pageNumber}. ${status} ${emoji} ${result.url}

**Tipo**: ${result.meta?.pageType || 'sconosciuto'}

`;

      // Meta informazioni
      if (result.meta) {
        markdown += `**📄 Title**: "${result.meta.title}" _(${result.meta.titleLength} caratteri)_

**📝 Description**: "${result.meta.description}" _(${result.meta.descriptionLength} caratteri)_

`;
      }

      // Struttura heading
      if (result.heading && result.heading.headings.length > 0) {
        markdown += `**📊 Struttura Heading** (${result.heading.headings.length} elementi):

`;
        result.heading.headings.forEach((h, i) => {
          markdown += `${i + 1}. **${h.tag.toUpperCase()}**: ${h.text}\n`;
        });
        markdown += '\n';
      }

      // Dimensioni pagina
      if (result.pageSize) {
        markdown += `**📏 Dimensione Pagina**: ${result.pageSize.pageSizeKB} KB

`;
      }

      // Problemi trovati
      if (allIssues.length > 0) {
        markdown += `**🚨 Problemi riscontrati**:

`;
        allIssues.forEach(issue => {
          markdown += `- ${issue}\n`;
        });
        markdown += '\n';
      }

      markdown += '---\n\n';
    });

    // Sezione duplicati
    if (duplicateTitles.length > 0 || duplicateDescs.length > 0) {
      markdown += `## 🔍 Controllo Duplicati

`;

      if (duplicateTitles.length > 0) {
        markdown += `### ❌ Title Duplicati

`;
        duplicateTitles.forEach(([title, urls]) => {
          markdown += `**"${title}"**:
`;
          urls.forEach(url => {
            markdown += `- ${url}\n`;
          });
          markdown += '\n';
        });
      }

      if (duplicateDescs.length > 0) {
        markdown += `### ❌ Description Duplicate

`;
        duplicateDescs.forEach(([desc, urls]) => {
          markdown += `**"${desc}"**:
`;
          urls.forEach(url => {
            markdown += `- ${url}\n`;
          });
          markdown += '\n';
        });
      }
    }

    // Raccomandazioni
    markdown += `## 💡 Raccomandazioni

### Title
- ✅ Lunghezza ottimale: 30-60 caratteri
- ✅ Ogni pagina deve avere un title unico
- ✅ Includere parole chiave principali

### Meta Description
- ✅ Lunghezza ottimale: 70-155 caratteri
- ✅ Ogni pagina deve avere una description unica
- ✅ Deve essere descrittiva e invitante al click

### Struttura Heading
- ✅ Una sola H1 per pagina
- ✅ Sequenza logica: H1 → H2 → H3 (no salti)
- ✅ Utilizzare per strutturare il contenuto

---

*Report generato automaticamente da SEO Checker con Playwright*
`;

    // Salva il file
    const filepath = path.join(process.cwd(), filename);
    fs.writeFileSync(filepath, markdown, 'utf8');

    console.log(`\n📄 Report Markdown salvato: ${filepath}`);
    return filepath;
  }

  generateHTMLReport(filename = null) {
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);

    if (!filename) {
      const timestamp = endTime.toISOString().slice(0, 19).replace(/[T:]/g, '-');
      filename = `seo-report-${timestamp}.html`;
    }

    let totalIssues = 0;
    let pagesWithIssues = 0;
    let pagesWithoutErrors = 0;

    // Calcola statistiche
    this.results.forEach(result => {
      if (result.error) return;

      const headingIssues = result.heading?.issues || [];
      const metaIssues = result.meta?.issues || [];
      const pageSizeIssues = result.pageSize?.issues || [];
      const allIssues = [...headingIssues, ...metaIssues, ...pageSizeIssues];

      totalIssues += allIssues.length;
      if (allIssues.length > 0) {
        pagesWithIssues++;
      } else {
        pagesWithoutErrors++;
      }
    });

    const duplicateTitles = Array.from(this.duplicateTitles.entries())
      .filter(([title, urls]) => urls.length > 1);

    const duplicateDescs = Array.from(this.duplicateDescriptions.entries())
      .filter(([desc, urls]) => urls.length > 1);

    // Template HTML professionale
    const html = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SEO Report - ${endTime.toLocaleDateString('it-IT')}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 0;
            margin-bottom: 30px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 300;
        }

        .header .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            border-left: 4px solid #667eea;
        }

        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 5px;
        }

        .stat-label {
            color: #666;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .summary-table {
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            margin-bottom: 30px;
        }

        .table-header {
            background: #667eea;
            color: white;
            padding: 20px;
            font-size: 1.2rem;
            font-weight: 600;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th, td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }

        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #555;
        }

        .page-card {
            background: white;
            border-radius: 10px;
            margin-bottom: 25px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
        }

        .page-header {
            padding: 20px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .page-status {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .status-success { background: #28a745; }
        .status-warning { background: #ffc107; }
        .status-error { background: #dc3545; }

        .page-url {
            font-weight: 600;
            color: #333;
            word-break: break-all;
        }

        .page-content {
            padding: 20px;
        }

        .meta-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .meta-item h4 {
            color: #667eea;
            margin-bottom: 8px;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .meta-value {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 0.9rem;
            border-left: 3px solid #667eea;
        }

        .char-count {
            font-size: 0.8rem;
            color: #666;
            margin-top: 5px;
        }

        .headings-list {
            margin-bottom: 20px;
        }

        .heading-item {
            padding: 8px 12px;
            margin: 5px 0;
            background: #f8f9fa;
            border-radius: 5px;
            border-left: 3px solid #28a745;
            font-size: 0.9rem;
        }

        .heading-tag {
            font-weight: bold;
            color: #667eea;
            margin-right: 10px;
        }

        .issues-list {
            margin-top: 15px;
        }

        .issue-item {
            padding: 10px 15px;
            margin: 5px 0;
            background: #fff5f5;
            border-left: 3px solid #dc3545;
            border-radius: 5px;
            color: #721c24;
        }

        .duplicates-section {
            background: white;
            border-radius: 10px;
            padding: 25px;
            margin-bottom: 30px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
        }

        .duplicate-group {
            margin-bottom: 20px;
            padding: 15px;
            background: #fff5f5;
            border-radius: 8px;
            border-left: 4px solid #dc3545;
        }

        .duplicate-title {
            font-weight: 600;
            margin-bottom: 10px;
            color: #721c24;
        }

        .duplicate-urls {
            list-style: none;
            margin-left: 15px;
        }

        .duplicate-urls li {
            padding: 5px 0;
            color: #666;
        }

        .recommendations {
            background: white;
            border-radius: 10px;
            padding: 25px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
        }

        .rec-section {
            margin-bottom: 20px;
        }

        .rec-section h3 {
            color: #667eea;
            margin-bottom: 10px;
        }

        .rec-list {
            list-style: none;
        }

        .rec-list li {
            padding: 8px 0;
            padding-left: 25px;
            position: relative;
        }

        .rec-list li::before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #28a745;
            font-weight: bold;
        }

        .footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px;
            color: #666;
            font-size: 0.9rem;
        }

        @media (max-width: 768px) {
            .container { padding: 10px; }
            .header h1 { font-size: 2rem; }
            .meta-info { grid-template-columns: 1fr; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Report SEO</h1>
            <div class="subtitle">${endTime.toLocaleDateString('it-IT')} alle ${endTime.toLocaleTimeString('it-IT')} • Durata: ${duration}s</div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${this.results.length}</div>
                <div class="stat-label">Pagine Totali</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${pagesWithoutErrors}</div>
                <div class="stat-label">Senza Errori</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${pagesWithIssues}</div>
                <div class="stat-label">Con Problemi</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${totalIssues}</div>
                <div class="stat-label">Problemi Totali</div>
            </div>
        </div>

        <div class="summary-table">
            <div class="table-header">📈 Riepilogo Problemi</div>
            <table>
                <thead>
                    <tr>
                        <th>Tipo</th>
                        <th>Quantità</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>🚨 Problemi SEO totali</td><td>${totalIssues}</td></tr>
                    <tr><td>📄 Title duplicati</td><td>${duplicateTitles.length}</td></tr>
                    <tr><td>📝 Description duplicate</td><td>${duplicateDescs.length}</td></tr>
                    <tr><td>❌ Pagine con errori</td><td>${this.results.filter(r => r.error).length}</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style="margin-bottom: 20px; color: #333;">📋 Dettaglio Pagine</h2>

        ${this.results.map((result, index) => {
          const pageNumber = index + 1;

          if (result.error) {
            return `
            <div class="page-card">
                <div class="page-header">
                    <div class="page-status status-error"></div>
                    <div class="page-url">${pageNumber}. ${result.url}</div>
                </div>
                <div class="page-content">
                    <div class="issue-item">Errore: ${result.error}</div>
                </div>
            </div>`;
          }

          const headingIssues = result.heading?.issues || [];
          const metaIssues = result.meta?.issues || [];
          const pageSizeIssues = result.pageSize?.issues || [];
          const allIssues = [...headingIssues, ...metaIssues, ...pageSizeIssues];
          const statusClass = allIssues.length === 0 ? 'status-success' : 'status-warning';

          return `
          <div class="page-card">
              <div class="page-header">
                  <div class="page-status ${statusClass}"></div>
                  <div class="page-url">${pageNumber}. ${result.url}</div>
              </div>
              <div class="page-content">
                  ${result.meta ? `
                  <div class="meta-info">
                      <div class="meta-item">
                          <h4>📄 Title</h4>
                          <div class="meta-value">
                              ${result.meta.title}
                              <div class="char-count">${result.meta.titleLength} caratteri</div>
                          </div>
                      </div>
                      <div class="meta-item">
                          <h4>📝 Description</h4>
                          <div class="meta-value">
                              ${result.meta.description}
                              <div class="char-count">${result.meta.descriptionLength} caratteri</div>
                          </div>
                      </div>
                  </div>` : ''}

                  ${result.pageSize ? `
                  <div class="meta-info">
                      <div class="meta-item">
                          <h4>📏 Dimensione Pagina</h4>
                          <div class="meta-value">
                              ${result.pageSize.pageSizeKB} KB
                              ${result.pageSize.pageSizeKB > 200 ? '<span style="color: #dc3545; font-weight: bold;"> (⚠️ Troppo pesante)</span>' : '<span style="color: #28a745;"> (✅ OK)</span>'}
                          </div>
                      </div>
                  </div>` : ''}

                  ${result.heading && result.heading.headings.length > 0 ? `
                  <div class="headings-list">
                      <h4 style="margin-bottom: 10px; color: #667eea;">📊 Struttura Heading (${result.heading.headings.length} elementi)</h4>
                      ${result.heading.headings.map((h, i) => `
                          <div class="heading-item">
                              <span class="heading-tag">${h.tag.toUpperCase()}</span>
                              ${h.text}
                          </div>
                      `).join('')}
                  </div>` : ''}

                  ${allIssues.length > 0 ? `
                  <div class="issues-list">
                      <h4 style="margin-bottom: 10px; color: #dc3545;">🚨 Problemi Riscontrati</h4>
                      ${allIssues.map(issue => `<div class="issue-item">${issue}</div>`).join('')}
                  </div>` : ''}
              </div>
          </div>`;
        }).join('')}

        ${duplicateTitles.length > 0 || duplicateDescs.length > 0 ? `
        <div class="duplicates-section">
            <h2 style="margin-bottom: 20px; color: #333;">🔍 Controllo Duplicati</h2>

            ${duplicateTitles.length > 0 ? `
            <h3 style="color: #dc3545; margin-bottom: 15px;">❌ Title Duplicati</h3>
            ${duplicateTitles.map(([title, urls]) => `
                <div class="duplicate-group">
                    <div class="duplicate-title">"${title}"</div>
                    <ul class="duplicate-urls">
                        ${urls.map(url => `<li>• ${url}</li>`).join('')}
                    </ul>
                </div>
            `).join('')}` : ''}

            ${duplicateDescs.length > 0 ? `
            <h3 style="color: #dc3545; margin-bottom: 15px;">❌ Description Duplicate</h3>
            ${duplicateDescs.map(([desc, urls]) => `
                <div class="duplicate-group">
                    <div class="duplicate-title">"${desc}"</div>
                    <ul class="duplicate-urls">
                        ${urls.map(url => `<li>• ${url}</li>`).join('')}
                    </ul>
                </div>
            `).join('')}` : ''}
        </div>` : ''}

        <div class="recommendations">
            <h2 style="margin-bottom: 20px; color: #333;">💡 Raccomandazioni</h2>

            <div class="rec-section">
                <h3>Title</h3>
                <ul class="rec-list">
                    <li>Lunghezza ottimale: 30-60 caratteri</li>
                    <li>Ogni pagina deve avere un title unico</li>
                    <li>Includere parole chiave principali</li>
                </ul>
            </div>

            <div class="rec-section">
                <h3>Meta Description</h3>
                <ul class="rec-list">
                    <li>Lunghezza ottimale: 70-155 caratteri</li>
                    <li>Ogni pagina deve avere una description unica</li>
                    <li>Deve essere descrittiva e invitante al click</li>
                </ul>
            </div>

            <div class="rec-section">
                <h3>Struttura Heading</h3>
                <ul class="rec-list">
                    <li>Una sola H1 per pagina</li>
                    <li>Sequenza logica: H1 → H2 → H3 (no salti)</li>
                    <li>Utilizzare per strutturare il contenuto</li>
                </ul>
            </div>
        </div>

        <div class="footer">
            <p>Report generato automaticamente da SEO Checker con Playwright</p>
        </div>
    </div>
</body>
</html>`;

    // Salva il file
    const filepath = path.join(process.cwd(), filename);
    fs.writeFileSync(filepath, html, 'utf8');

    console.log(`\n📄 Report HTML salvato: ${filepath}`);
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