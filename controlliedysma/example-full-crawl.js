const { SEOChecker } = require('./seo-checker');
const path = require('path');
const os = require('os');

async function fullSiteCrawl() {
  const checker = new SEOChecker();

  try {
    console.log('🕷️  SEO Crawler - Analisi completa sito\n');

    await checker.init({
      userDataDir: path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),
      headless: false,
      slowMo: 500,
      args: [
        '--no-first-run',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    // Crawling completo (tutte le pagine del sito)
    await checker.crawlSite('https://edysma.com');

    // Genera entrambi i report
    checker.generateReport();
    const mdReport = checker.generateMarkdownReport('crawl-completo-edysma.md');
    const htmlReport = checker.generateHTMLReport('crawl-completo-edysma.html');

    console.log('\n' + '='.repeat(50));
    console.log('✅ Crawling completo terminato!');
    console.log(`📄 Report Markdown: ${path.basename(mdReport)}`);
    console.log(`🌐 Report HTML: ${path.basename(htmlReport)}`);

  } catch (error) {
    console.error('❌ Errore durante il crawling:', error.message);
  } finally {
    await checker.close();
  }
}

// Funzione per crawling con limite
async function limitedCrawl(url, maxPages = 50) {
  const checker = new SEOChecker();

  try {
    await checker.init({
      userDataDir: path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),
      headless: true, // Modalità veloce
      slowMo: 200
    });

    console.log(`🔍 Crawling limitato a ${maxPages} pagine per ${url}...`);

    // Crawling con limite di pagine
    await checker.crawlSite(url, maxPages);

    // Genera solo report HTML per velocità
    const htmlReport = checker.generateHTMLReport();
    console.log(`✅ Report generato: ${path.basename(htmlReport)}`);

    return htmlReport;

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
  }
}

// Test crawling con diversi siti
async function testMultipleSites() {
  const sites = [
    'https://edysma.com',
    // Aggiungi altri siti da testare
  ];

  for (const site of sites) {
    console.log(`\n🌐 Analizzando: ${site}`);
    try {
      await limitedCrawl(site, 20);
    } catch (error) {
      console.error(`❌ Errore su ${site}:`, error.message);
    }
  }
}

if (require.main === module) {
  // Scegli il tipo di test:

  // 1. Crawling completo di un sito
  fullSiteCrawl();

  // 2. Crawling limitato
  // limitedCrawl('https://example.com', 30);

  // 3. Test multipli siti
  // testMultipleSites();
}

module.exports = { fullSiteCrawl, limitedCrawl, testMultipleSites };