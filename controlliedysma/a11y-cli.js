#!/usr/bin/env node

const { A11yChecker } = require('./a11y-checker');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Carica variabili d'ambiente da file .env se esiste
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
          }
        }
      }
    });
  }
}

// Carica .env all'avvio
loadEnvFile();

// Funzione per trovare i profili Chrome disponibili
function getChromeProfiles() {
  const chromeDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const profiles = [];

  try {
    if (!fs.existsSync(chromeDir)) {
      return profiles;
    }

    const items = fs.readdirSync(chromeDir);

    // Aggiungi profilo Default
    if (items.includes('Default')) {
      profiles.push({
        name: 'Default',
        path: path.join(chromeDir, 'Default'),
        displayName: 'Profilo Predefinito'
      });
    }

    // Cerca altri profili (Profile 1, Profile 2, etc. e profili personalizzati)
    items.forEach(item => {
      const itemPath = path.join(chromeDir, item);

      // Salta i file e link simbolici
      try {
        const stat = fs.statSync(itemPath);
        if (!stat.isDirectory()) return;
      } catch (error) {
        return; // Salta gli elementi non accessibili
      }

      // Controlla se è un profilo valido (deve avere il file Preferences)
      const prefsPath = path.join(itemPath, 'Preferences');
      if (!fs.existsSync(prefsPath)) return;

      // Salta Default (già aggiunto) e profili di sistema
      if (item === 'Default' ||
          item.includes('Guest') ||
          item.includes('System') ||
          item.startsWith('.')) return;

      let displayName = item;

      // Prova a leggere il nome del profilo dalle preferenze
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (prefs.profile && prefs.profile.name) {
          displayName = prefs.profile.name;
        }
      } catch (error) {
        // Ignora errori di lettura delle preferenze
      }

      profiles.push({
        name: item,
        path: itemPath,
        displayName: displayName
      });
    });

  } catch (error) {
    console.warn('⚠️  Impossibile accedere ai profili Chrome:', error.message);
  }

  return profiles;
}

// Funzione per mostrare la lista dei profili e permettere la selezione
function selectChromeProfile() {
  const profiles = getChromeProfiles();

  if (profiles.length === 0) {
    console.log('❌ Nessun profilo Chrome trovato');
    console.log('💡 Usa --no-profile per usare Chromium invece');
    process.exit(1);
  }

  console.log('🔍 Profili Chrome disponibili:');
  console.log();

  profiles.forEach((profile, index) => {
    console.log(`  ${index + 1}. ${profile.displayName} (${profile.name})`);
  });

  console.log('  0. Annulla');
  console.log();

  // Leggi input utente
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('👤 Seleziona un profilo (numero): ', (answer) => {
      rl.close();

      const choice = parseInt(answer);

      if (choice === 0) {
        console.log('❌ Operazione annullata');
        process.exit(0);
      }

      if (isNaN(choice) || choice < 1 || choice > profiles.length) {
        console.log('❌ Selezione non valida');
        process.exit(1);
      }

      const selectedProfile = profiles[choice - 1];
      console.log(`✅ Profilo selezionato: ${selectedProfile.displayName}`);
      console.log();

      resolve(selectedProfile.path);
    });
  });
}

// Funzione per mostrare l'help
function showHelp() {
  console.log(`
♿ A11y Checker CLI - Controllo Accessibilità Web

Utilizzo:
  node a11y-cli.js <url> [opzioni]

Parametri:
  url                    URL del sito da controllare (obbligatorio)

Opzioni:
  -p, --pages <numero>   Numero massimo di pagine da controllare (default: 5)
  -c, --crawl           Modalità crawling completo del sito (ignora -p)
  -o, --output <file>    Nome file report (default: auto-generato)
  -f, --format <tipo>    Formato report: html, md, json, dichiarazione, allegato2, all (default: all)
  -h, --headless        Esegui in modalità headless (senza aprire browser)
  --no-profile          Non usare profilo Chrome (usa Chromium)
  --profile <path>      Percorso specifico profilo Chrome da usare
  --select-profile      Mostra lista profili Chrome disponibili per selezione
  --help                Mostra questo messaggio

Opzioni per formato dichiarazione:
  --org <nome>          Nome organizzazione (default: L'ORGANIZZAZIONE)
  --email <email>       Email di contatto (default: contatti@esempio.it)
  --phone <numero>      Telefono di contatto (opzionale)
  --pub-date <data>     Data pubblicazione sito (default: 01/01/2020)
  --cms <sistema>       CMS/Sistema utilizzato (default: Custom)
  --ai-key <key>        Chiave API Anthropic per semplificare descrizioni (default: ANTHROPIC_API_KEY env)

Esempi:
  node a11y-cli.js https://example.com
  node a11y-cli.js https://example.com -p 10
  node a11y-cli.js https://example.com --crawl
  node a11y-cli.js https://example.com --crawl -f html -o report-accessibilita
  node a11y-cli.js https://example.com -f json --headless
  node a11y-cli.js https://example.com -f all -o report-completo
  node a11y-cli.js https://example.com --no-profile -f json
  node a11y-cli.js https://example.com --select-profile
  node a11y-cli.js https://example.com -f dichiarazione --org "ACME SRL" --email info@acme.it

Note:
  - Utilizza axe-core per controlli di accessibilità completi
  - Supporta standard WCAG 2.1 AA e AAA
  - Include controlli personalizzati per skip links, landmark e form
  - Genera report dettagliati con score di accessibilità

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
    crawl: false,
    output: null,
    format: 'all',
    headless: false,
    useProfile: true,
    selectProfile: false,
    profilePath: null,
    // Opzioni per dichiarazione
    organizationName: null,
    contactEmail: null,
    contactPhone: null,
    publicationDate: null,
    cms: null,
    anthropicApiKey: null
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
        if (!format || !['html', 'md', 'json', 'dichiarazione', 'allegato2', 'all'].includes(format)) {
          console.error('❌ Errore: Formato deve essere: html, md, json, dichiarazione, allegato2, all');
          process.exit(1);
        }
        options.format = format;
        i++; // Skip del prossimo argomento
        break;

      case '-c':
      case '--crawl':
        options.crawl = true;
        break;

      case '-h':
      case '--headless':
        options.headless = true;
        break;

      case '--no-profile':
        options.useProfile = false;
        break;

      case '--profile':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Percorso profilo richiesto dopo --profile');
          process.exit(1);
        }
        options.profilePath = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--select-profile':
        options.selectProfile = true;
        break;

      case '--org':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Nome organizzazione richiesto dopo --org');
          process.exit(1);
        }
        options.organizationName = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--email':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Email richiesta dopo --email');
          process.exit(1);
        }
        options.contactEmail = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--phone':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Telefono richiesto dopo --phone');
          process.exit(1);
        }
        options.contactPhone = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--pub-date':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Data pubblicazione richiesta dopo --pub-date');
          process.exit(1);
        }
        options.publicationDate = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--cms':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: CMS/Sistema richiesto dopo --cms');
          process.exit(1);
        }
        options.cms = args[i + 1];
        i++; // Skip del prossimo argomento
        break;

      case '--ai-key':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Chiave API richiesta dopo --ai-key');
          process.exit(1);
        }
        options.anthropicApiKey = args[i + 1];
        i++; // Skip del prossimo argomento
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

  // Validazione opzioni
  if (options.selectProfile && !options.useProfile) {
    console.error('❌ Errore: --select-profile richiede che i profili Chrome siano abilitati');
    console.error('💡 Rimuovi --no-profile o non usare --select-profile');
    process.exit(1);
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
async function runA11yCheck() {
  const options = parseArgs();
  const checker = new A11yChecker();

  // Gestione profilo Chrome
  let selectedProfilePath = null;
  if (options.profilePath) {
    // Usa il profilo specificato con --profile
    selectedProfilePath = options.profilePath;
  } else if (options.selectProfile && options.useProfile) {
    // Mostra menu di selezione profilo
    selectedProfilePath = await selectChromeProfile();
  }

  try {
    console.log('♿ A11y Checker CLI - Controllo Accessibilità');
    console.log('='.repeat(50));
    console.log(`📍 URL: ${options.url}`);
    console.log(`🕷️  Modalità: ${options.crawl ? 'Crawling completo' : `Limitato a ${options.pages} pagine`}`);
    console.log(`📋 Formato: ${options.format.toUpperCase()}`);
    console.log(`🖥️  Browser: ${options.headless ? 'Headless' : 'Visibile'}`);

    if (options.useProfile) {
      const profileDisplay = selectedProfilePath ?
        `Sì (${path.basename(selectedProfilePath)})` : 'Sì (Default)';
      console.log(`👤 Profilo Chrome: ${profileDisplay}`);
    } else {
      console.log(`👤 Profilo Chrome: No`);
    }

    console.log(`🔧 Tool: axe-core + controlli personalizzati`);
    console.log('='.repeat(50));
    console.log();

    // Configurazione browser
    const initOptions = {
      headless: options.headless,
      slowMo: options.headless ? 100 : 300
    };

    // Usa profilo Chrome se richiesto
    if (options.useProfile) {
      // Usa il profilo selezionato dall'utente o quello di default
      initOptions.userDataDir = selectedProfilePath ||
        path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default');
      initOptions.args = [
        '--no-first-run',
        '--disable-blink-features=AutomationControlled'
      ];
    }

    await checker.init(initOptions);

    // Esegui controllo
    if (options.crawl) {
      console.log(`♿ Inizio crawling accessibilità completo di ${options.url}...`);
      await checker.crawlSite(options.url);
    } else {
      console.log(`♿ Inizio controllo accessibilità limitato di ${options.url}...`);
      await checker.navigateAndCheck(options.url, options.pages);
    }

    // Genera report console
    console.log('\n' + '='.repeat(55));
    checker.generateReport();

    // Genera report in base al formato richiesto
    console.log('\n' + '='.repeat(55));
    console.log('✅ Controllo accessibilità completato con successo!');

    const generatedFiles = [];

    if (options.format === 'md' || options.format === 'all') {
      const mdFilename = options.output ?
        (options.output.endsWith('.md') ? options.output : `${options.output}.md`) : null;
      const mdPath = checker.generateMarkdownReport(mdFilename);
      generatedFiles.push({ type: 'Markdown', path: mdPath });
    }

    if (options.format === 'html' || options.format === 'all') {
      const htmlFilename = options.output ?
        (options.output.endsWith('.html') ? options.output : `${options.output}.html`) : null;
      const htmlPath = checker.generateHTMLReport(htmlFilename);
      generatedFiles.push({ type: 'HTML', path: htmlPath });
    }

    if (options.format === 'json' || options.format === 'all') {
      const jsonFilename = options.output ?
        (options.output.endsWith('.json') ? options.output : `${options.output}.json`) : null;
      const jsonPath = checker.generateJSONReport(jsonFilename);
      generatedFiles.push({ type: 'JSON', path: jsonPath });
    }

    if (options.format === 'dichiarazione' || options.format === 'allegato2') {
      // Genera dichiarazione
      const dichiarazioneOptions = {};
      if (options.organizationName) dichiarazioneOptions.organizationName = options.organizationName;
      if (options.contactEmail) dichiarazioneOptions.contactEmail = options.contactEmail;
      if (options.contactPhone) dichiarazioneOptions.contactPhone = options.contactPhone;
      if (options.publicationDate) dichiarazioneOptions.publicationDate = options.publicationDate;
      if (options.cms) dichiarazioneOptions.cms = options.cms;

      // Usa API key da parametro o da variabile d'ambiente
      const apiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        dichiarazioneOptions.anthropicApiKey = apiKey;
        console.log('🤖 Utilizzo AI per semplificare le descrizioni...');
      } else {
        console.log('ℹ️  Nessuna chiave API fornita, uso descrizioni standard');
        console.log('   Usa --ai-key o imposta ANTHROPIC_API_KEY per descrizioni semplificate');
      }

      const dichiarazionePath = await checker.generateDichiarazioneHTML(dichiarazioneOptions);
      generatedFiles.push({ type: 'Dichiarazione', path: dichiarazionePath });

      // Genera anche allegato2
      const allegato2Options = {};
      const allegato2Path = await checker.generateAllegato2HTML(allegato2Options);
      generatedFiles.push({ type: 'Allegato 2 AGID', path: allegato2Path });
    }

    // Mostra i file generati
    console.log('\n📄 Report generati:');
    generatedFiles.forEach(file => {
      console.log(`   ${file.type}: ${path.basename(file.path)}`);
    });

    if (generatedFiles.length > 0) {
      console.log(`\n📁 Directory: ${path.dirname(generatedFiles[0].path)}`);
    }

    // Calcola score medio
    const validResults = checker.results.filter(r => !r.error);
    if (validResults.length > 0) {
      const avgScore = Math.round(
        validResults.reduce((sum, r) => sum + r.analysis.score, 0) / validResults.length
      );
      const totalViolations = validResults.reduce((sum, r) => sum + r.analysis.summary.violations, 0);

      console.log(`\n📊 Riepilogo Finale:`);
      console.log(`   Score medio: ${avgScore}% ${avgScore >= 90 ? '🟢' : avgScore >= 70 ? '🟡' : '🔴'}`);
      console.log(`   Violazioni totali: ${totalViolations}`);
      console.log(`   Standard: WCAG 2.1 AA ${avgScore >= 90 ? '✅' : '❌'}`);
    }

  } catch (error) {
    console.error('\n❌ Errore durante il controllo accessibilità:', error.message);
    console.error('💡 Suggerimenti:');
    console.error('   - Verifica che l\'URL sia accessibile');
    console.error('   - Controlla la connessione internet');
    console.error('   - Prova con --headless se il browser non si apre');
    console.error('   - Usa --no-profile se ci sono problemi con Chrome');
    process.exit(1);
  } finally {
    await checker.close();
  }
}

// Esegui se chiamato direttamente
if (require.main === module) {
  runA11yCheck().catch(error => {
    console.error('❌ Errore fatale:', error.message);
    process.exit(1);
  });
}

module.exports = { runA11yCheck, parseArgs };