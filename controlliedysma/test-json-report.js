const { SEOChecker } = require('./seo-checker.js');

// Test del report JSON
async function testJSONReport() {
  const checker = new SEOChecker();

  try {
    console.log('🧪 Test generazione report JSON\n');

    await checker.init({ headless: true });

    // Simula alcuni risultati per il test
    const testResults = [
      {
        url: 'https://example.com',
        heading: {
          valid: true,
          headings: [
            { tag: 'h1', text: 'Titolo Principale', level: 1 },
            { tag: 'h2', text: 'Sezione 1', level: 2 },
            { tag: 'h3', text: 'Sottosezione 1.1', level: 3 }
          ],
          issues: []
        },
        meta: {
          valid: false,
          title: 'Esempio di Titolo Troppo Lungo Per Gli Standard SEO',
          titleLength: 55,
          description: 'Descrizione breve',
          descriptionLength: 18,
          pageType: 'homepage',
          issues: [
            '❌ Description troppo corta per homepage: 18 caratteri (min 70)'
          ]
        },
        pageSize: {
          valid: true,
          pageSize: 50000,
          pageSizeKB: 49,
          issues: []
        },
        favicon: {
          valid: true,
          faviconExists: true,
          faviconFormat: 'png',
          faviconUrl: 'https://example.com/favicon.png',
          faviconSize: 2048,
          issues: []
        },
        email: {
          valid: false,
          emailCount: 1,
          obfuscatedCount: 0,
          exposedEmails: ['contact@example.com'],
          obfuscatedEmails: [],
          suggestions: ['💡 Suggerimento: usa "contact[@]example.com" invece di "contact@example.com"'],
          issues: ['❌ Email esposta pubblicamente: contact@example.com']
        },
        timestamp: new Date().toISOString()
      },
      {
        url: 'https://example.com/about',
        heading: {
          valid: false,
          headings: [
            { tag: 'h2', text: 'Chi Siamo', level: 2 }
          ],
          issues: ['❌ Nessun H1 trovato']
        },
        meta: {
          valid: true,
          title: 'Chi Siamo - Informazioni sulla nostra azienda',
          titleLength: 44,
          description: 'Scopri la storia della nostra azienda, i nostri valori e il team che lavora ogni giorno per offrirti i migliori servizi.',
          descriptionLength: 132,
          pageType: 'page',
          issues: []
        },
        pageSize: {
          valid: true,
          pageSize: 75000,
          pageSizeKB: 73,
          issues: []
        },
        favicon: {
          valid: true,
          faviconExists: true,
          faviconFormat: 'png',
          faviconUrl: 'https://example.com/favicon.png',
          faviconSize: 2048,
          issues: []
        },
        email: {
          valid: true,
          emailCount: 0,
          obfuscatedCount: 1,
          exposedEmails: [],
          obfuscatedEmails: ['info[@]example.com'],
          suggestions: [],
          issues: ['✅ Email correttamente obfuscata trovata: info[@]example.com']
        },
        timestamp: new Date().toISOString()
      }
    ];

    // Simula duplicati
    checker.duplicateTitles.set('Titolo Duplicato', [
      'https://example.com/page1',
      'https://example.com/page2'
    ]);

    // Assegna risultati di test
    checker.results = testResults;

    // Genera report JSON
    const jsonPath = checker.generateJSONReport('test-report.json');

    console.log('✅ Report JSON generato con successo!\n');

    // Leggi e mostra struttura del JSON
    const fs = require('fs');
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log('📋 Struttura del report JSON:');
    console.log('='.repeat(40));

    console.log('\n🔍 Sezioni principali:');
    Object.keys(jsonContent).forEach(key => {
      console.log(`  • ${key}`);
    });

    console.log('\n📊 Statistiche:');
    const stats = jsonContent.summary.statistics;
    console.log(`  • Pagine totali: ${stats.totalPages}`);
    console.log(`  • Pagine con problemi: ${stats.pagesWithIssues}`);
    console.log(`  • Problemi totali: ${stats.totalIssues}`);

    console.log('\n📄 Prima pagina analizzata:');
    const firstPage = jsonContent.pages[0];
    console.log(`  • URL: ${firstPage.url}`);
    console.log(`  • Tipo: ${firstPage.pageType}`);
    console.log(`  • Status: ${firstPage.status}`);
    console.log(`  • Checks: ${Object.keys(firstPage.checks).join(', ')}`);

    console.log('\n🔧 Controlli dettagliati per la prima pagina:');
    Object.entries(firstPage.checks).forEach(([checkType, checkData]) => {
      console.log(`  • ${checkType}: ${checkData.valid ? '✅ Valido' : '❌ Problemi'}`);
      if (checkData.issues && checkData.issues.length > 0) {
        console.log(`    - Problemi: ${checkData.issues.length}`);
      }
    });

    console.log('\n🧱 Struttura heading prima pagina:');
    firstPage.checks.heading.structure.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.tag.toUpperCase()}: "${h.text}"`);
    });

    console.log('\n💡 Esempi di utilizzo JSON per automazioni:');
    console.log('='.repeat(50));
    console.log('// Filtra pagine con problemi');
    console.log('const problematicPages = jsonContent.pages.filter(p => p.status === "issues");');
    console.log('');
    console.log('// Trova pagine senza H1');
    console.log('const pagesWithoutH1 = jsonContent.pages.filter(p => ');
    console.log('  p.checks.heading.issues.some(issue => issue.includes("Nessun H1"))');
    console.log('');
    console.log('// Ottieni statistiche email esposte');
    console.log('const totalExposedEmails = jsonContent.pages.reduce((sum, p) => ');
    console.log('  sum + p.checks.email.exposedCount, 0);');

    console.log('\n✨ Test completato! File salvato come:', jsonPath);

  } catch (error) {
    console.error('❌ Errore durante il test:', error.message);
  } finally {
    await checker.close();
  }
}

// Esegui test se chiamato direttamente
if (require.main === module) {
  testJSONReport().catch(console.error);
}

module.exports = { testJSONReport };