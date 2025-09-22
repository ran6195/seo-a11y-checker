const { SEOChecker } = require('./seo-checker.js');

// Test della normalizzazione URL
async function testUrlNormalization() {
  const checker = new SEOChecker();

  console.log('🧪 Test normalizzazione URL\n');

  const testCases = [
    // Casi base
    'https://edysma.com',
    'https://edysma.com/',
    'https://edysma.com/#',
    'https://edysma.com/#section',

    // Con www
    'https://www.edysma.com',
    'https://www.edysma.com/',
    'https://www.edysma.com/#header',

    // Con path
    'https://edysma.com/about',
    'https://edysma.com/about/',
    'https://edysma.com/about/#team',

    // Con parametri tracking
    'https://edysma.com?utm_source=google',
    'https://edysma.com/?utm_source=google&utm_medium=cpc',
    'https://edysma.com/contact?fbclid=123456',
    'https://edysma.com/services/?gclid=abcdef&ref=twitter',

    // Combinazioni complesse
    'https://www.edysma.com/about/?utm_campaign=test#section',
    'https://edysma.com/contact/#form?utm_source=facebook'
  ];

  console.log('URL Originale → URL Normalizzato');
  console.log('='.repeat(80));

  const normalizedResults = new Map();

  testCases.forEach(url => {
    const normalized = checker.normalizeUrl(url);

    // Traccia risultati per vedere duplicati
    if (!normalizedResults.has(normalized)) {
      normalizedResults.set(normalized, []);
    }
    normalizedResults.get(normalized).push(url);

    console.log(`${url.padEnd(50)} → ${normalized}`);
  });

  console.log('\n📊 Riepilogo normalizzazione:');
  console.log('='.repeat(40));
  console.log(`URL originali testati: ${testCases.length}`);
  console.log(`URL unici dopo normalizzazione: ${normalizedResults.size}`);
  console.log(`URL duplicati eliminati: ${testCases.length - normalizedResults.size}`);

  console.log('\n🔍 Gruppi di URL equivalenti:');
  console.log('='.repeat(40));

  normalizedResults.forEach((originalUrls, normalizedUrl) => {
    if (originalUrls.length > 1) {
      console.log(`\n✅ ${normalizedUrl}`);
      originalUrls.forEach(url => {
        console.log(`   ← ${url}`);
      });
    }
  });

  console.log('\n✨ Test completato!');
}

// Esegui test se chiamato direttamente
if (require.main === module) {
  testUrlNormalization().catch(console.error);
}

module.exports = { testUrlNormalization };