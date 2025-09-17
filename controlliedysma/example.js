const {
  SEOChecker
} = require('./seo-checker');

async function testSEO() {
  const checker = new SEOChecker();

  try {
    console.log('🚀 Avvio controllo SEO...\n');

    await checker.init();

    // Esempio 1: Controlla un singolo sito
    await checker.navigateAndCheck('https://edysma.com', 10);

    // Genera il report
    checker.generateReport();

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
    console.log('\n✅ Controllo completato!');
  }
}

// Funzione per testare una singola pagina
async function testSinglePage(url) {
  const checker = new SEOChecker();

  try {
    await checker.init();

    console.log(`\n🔍 Test singola pagina: ${url}`);

    const headingResult = await checker.checkHeadingStructure(url);
    const metaResult = await checker.checkMetaTags(url);

    console.log('\n📊 RISULTATI:');
    console.log('='.repeat(30));

    console.log('\n🏷️  META TAGS:');
    console.log(`Title: "${metaResult.title}" (${metaResult.titleLength} caratteri)`);
    console.log(`Description: "${metaResult.description}" (${metaResult.descriptionLength} caratteri)`);

    console.log('\n📈 HEADINGS:');
    headingResult.headings.forEach((h, i) => {
      console.log(`${i + 1}. ${h.tag.toUpperCase()}: ${h.text}`);
    });

    console.log('\n🚨 PROBLEMI:');
    const allIssues = [...(headingResult.issues || []), ...(metaResult.issues || [])];
    if (allIssues.length === 0) {
      console.log('✅ Nessun problema trovato!');
    } else {
      allIssues.forEach(issue => console.log(`   ${issue}`));
    }

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
  }
}

// Esempi di utilizzo
if (require.main === module) {
  // Decommenra quello che vuoi testare:

  // Test completo di un sito
  testSEO();

  // Test di una singola pagina
  // testSinglePage('https://example.com');
}

module.exports = {
  testSEO,
  testSinglePage
};