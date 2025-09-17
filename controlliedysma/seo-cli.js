#!/usr/bin/env node

const { SEOChecker } = require('./seo-checker');
const path = require('path');
const os = require('os');

// Funzione per mostrare l'help
function showHelp() {
  console.log(`
🔍 SEO Checker CLI

Utilizzo:
  node seo-cli.js <url> [opzioni]

Parametri:
  url                    URL del sito da controllare (obbligatorio)

Opzioni:
  -p, --pages <numero>   Numero massimo di pagine da controllare (default: 5)
  -o, --output <file>    Nome file report (default: auto-generato)
  -f, --format <tipo>    Formato report: html, md, both (default: both)
  -h, --headless        Esegui in modalità headless (senza aprire browser)
  --no-profile          Non usare profilo Chrome (usa Chromium)
  --help                Mostra questo messaggio

Esempi:
  node seo-cli.js https://example.com
  node seo-cli.js https://example.com -p 10
  node seo-cli.js https://example.com -f html -o report-esempio
  node seo-cli.js https://example.com -f md --headless
  node seo-cli.js https://example.com --no-profile -f both

`);
}

// Parsing degli argomenti
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const options = {
    url: null,
    pages: 5,
    output: null,
    format: 'both',
    headless: false,
    useProfile: true
  };

  // Prima argomento è sempre l'URL
  if (args[0] && !args[0].startsWith('-')) {
    options.url = args[0];
  } else {
    console.error('❌ Errore: URL richiesto come primo parametro');
    showHelp();
    process.exit(1);
  }

  // Parse delle opzioni
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-p':
      case '--pages':
        const pages = parseInt(args[i + 1]);
        if (isNaN(pages) || pages < 1) {
          console.error('❌ Errore: Numero di pagine deve essere un numero positivo');
          process.exit(1);
        }
        options.pages = pages;
        i++; // Skip del prossimo argomento
        break;

      case '-o':
      case '--output':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Nome file richiesto dopo -o/--output');
          process.exit(1);
        }
        options.output = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '-f':
      case '--format':
        const format = args[i + 1];
        if (!format || !['html', 'md', 'both'].includes(format)) {
          console.error('❌ Errore: Formato deve essere: html, md, both');
          process.exit(1);
        }
        options.format = format;
        i++; // Skip del prossimo argomento
        break;

      case '-h':
      case '--headless':
        options.headless = true;
        break;

      case '--no-profile':
        options.useProfile = false;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`❌ Errore: Opzione sconosciuta: ${arg}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }

  // Validazione URL
  try {
    new URL(options.url);
  } catch (error) {
    console.error(`❌ Errore: URL non valido: ${options.url}`);
    process.exit(1);
  }

  return options;
}

// Funzione principale
async function runSEOCheck() {
  const options = parseArgs();
  const checker = new SEOChecker();

  try {
    console.log('🚀 SEO Checker CLI');
    console.log('='.repeat(40));
    console.log(`📍 URL: ${options.url}`);
    console.log(`📄 Pagine max: ${options.pages}`);
    console.log(`📋 Formato: ${options.format.toUpperCase()}`);
    console.log(`🖥️  Modalità: ${options.headless ? 'Headless' : 'Visibile'}`);
    console.log(`👤 Profilo Chrome: ${options.useProfile ? 'Sì' : 'No'}`);
    console.log('='.repeat(40));
    console.log();

    // Configurazione browser
    const initOptions = {
      headless: options.headless,
      slowMo: options.headless ? 100 : 300
    };

    // Usa profilo Chrome se richiesto
    if (options.useProfile) {
      initOptions.userDataDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default');
      initOptions.args = [
        '--no-first-run',
        '--disable-blink-features=AutomationControlled'
      ];
    }

    await checker.init(initOptions);

    // Esegui controllo
    console.log(`🔍 Inizio controllo di ${options.url}...`);
    await checker.navigateAndCheck(options.url, options.pages);

    // Genera report console
    console.log('\n' + '='.repeat(50));
    checker.generateReport();

    // Genera report in base al formato richiesto
    console.log('\n' + '='.repeat(50));
    console.log('✅ Controllo completato con successo!');

    const generatedFiles = [];

    if (options.format === 'md' || options.format === 'both') {
      const mdFilename = options.output ?
        (options.output.endsWith('.md') ? options.output : `${options.output}.md`) : null;
      const mdPath = checker.generateMarkdownReport(mdFilename);
      generatedFiles.push({ type: 'Markdown', path: mdPath });
    }

    if (options.format === 'html' || options.format === 'both') {
      const htmlFilename = options.output ?
        (options.output.endsWith('.html') ? options.output : `${options.output}.html`) : null;
      const htmlPath = checker.generateHTMLReport(htmlFilename);
      generatedFiles.push({ type: 'HTML', path: htmlPath });
    }

    // Mostra i file generati
    console.log('\n📄 Report generati:');
    generatedFiles.forEach(file => {
      console.log(`   ${file.type}: ${path.basename(file.path)}`);
    });

    if (generatedFiles.length > 0) {
      console.log(`\n📁 Directory: ${path.dirname(generatedFiles[0].path)}`);
    }

  } catch (error) {
    console.error('\n❌ Errore durante il controllo:', error.message);
    process.exit(1);
  } finally {
    await checker.close();
  }
}

// Esegui se chiamato direttamente
if (require.main === module) {
  runSEOCheck().catch(error => {
    console.error('❌ Errore fatale:', error.message);
    process.exit(1);
  });
}

module.exports = { runSEOCheck, parseArgs };