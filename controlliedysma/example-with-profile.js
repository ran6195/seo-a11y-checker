const {
  SEOChecker
} = require('./seo-checker');
const path = require('path');
const os = require('os');

async function testWithChromeProfile() {
  const checker = new SEOChecker();

  try {
    console.log('🚀 Avvio controllo SEO con profilo Chrome...\n');

    // Configurazione profilo Chrome
    const profileOptions = {
      // Opzione 1: Usa profilo esistente
      userDataDir: path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),

      // Opzione 2: Crea profilo temporaneo (decommenta se preferisci)
      // userDataDir: path.join(__dirname, 'chrome-profile'),

      // Altre opzioni utili
      headless: false,
      slowMo: 300,

      // Mantieni sessione (cookies, login, etc.)
      args: [
        '--no-first-run',
        '--disable-blink-features=AutomationControlled'
      ]
    };

    await checker.init(profileOptions);

    // Controlla il sito
    await checker.navigateAndCheck('https://edysma.com', 10);

    // Genera il report console
    checker.generateReport();

    // Genera anche il report markdown
    const reportPath = checker.generateMarkdownReport();
    console.log(`\n📄 Report Markdown disponibile: ${reportPath}`);

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
    console.log('\n✅ Controllo completato!');
  }
}

// Funzione per testare con profilo personalizzato
async function testWithCustomProfile(profilePath) {
  const checker = new SEOChecker();

  try {
    await checker.init({
      userDataDir: profilePath,
      headless: false,
      args: ['--no-first-run']
    });

    await checker.navigateAndCheck('https://edysma.com', 2);
    checker.generateReport();

  } catch (error) {
    console.error('❌ Errore:', error.message);
  } finally {
    await checker.close();
  }
}

// Esempi di utilizzo
if (require.main === module) {
  // Test con profilo Chrome default
  testWithChromeProfile();

  // Test con profilo personalizzato (decommenta se necessario)
  // testWithCustomProfile('/path/to/your/chrome/profile');
}

module.exports = {
  testWithChromeProfile,
  testWithCustomProfile
};