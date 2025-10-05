const {
  SEOChecker
} = require('../seo-checker');

async function generateMarkdownReport() {
  const checker = new SEOChecker();

  try {
    console.log('🚀 Generazione report SEO in Markdown...\n');

    await checker.init({
      userDataDir: require('path').join(require('os').homedir(), 'Library/Application Support/Google/Chrome/Default'),
      headless: false,
      slowMo: 300
    });

    // Controlla il sito (puoi modificare URL e numero pagine)
    await checker.navigateAndCheck('https://edysma.com', 5);

    // Genera SOLO il report markdown (senza output console)
    const reportPath = checker.generateMarkdownReport('report-seo-edysma.md');

    console.log(`\n✅ Report generato con successo!`);
    console.log(`📄 File: ${reportPath}`);
    console.log(`\n💡 Apri il file per vedere il report dettagliato.`);

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
  }
}

// Funzione per report personalizzato
async function generateCustomReport(url, maxPages = 5, filename = null) {
  const checker = new SEOChecker();

  try {
    await checker.init({
      userDataDir: require('path').join(require('os').homedir(), 'Library/Application Support/Google/Chrome/Default'),
      headless: true, // Modalità silenziosa
      slowMo: 100
    });

    console.log(`🔍 Analizzando ${url}...`);
    await checker.navigateAndCheck(url, maxPages);

    const reportPath = checker.generateMarkdownReport(filename);
    console.log(`✅ Report completato: ${reportPath}`);

    return reportPath;

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
  }
}

if (require.main === module) {
  // Genera report per edysma.com
  generateMarkdownReport();

  // Esempi di utilizzo personalizzato:
  // generateCustomReport('https://tuosito.com', 10, 'report-tuosito.md');
}

module.exports = {
  generateMarkdownReport,
  generateCustomReport
};