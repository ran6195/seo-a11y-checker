#!/usr/bin/env node

const { A11yChecker } = require('./a11y-checker');
const path = require('path');
const fs = require('fs');

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

loadEnvFile();

function showHelp() {
  console.log(`
♿ A11y from JSON - Genera Dichiarazione e Allegato 2 da report JSON

Utilizzo:
  node a11y-from-json.js <file.json> [opzioni]

Parametri:
  file.json              File JSON generato da a11y-cli.js (obbligatorio)

Opzioni per dichiarazione:
  --org <nome>          Nome organizzazione (default: L'ORGANIZZAZIONE)
  --email <email>       Email di contatto (default: contatti@esempio.it)
  --phone <numero>      Telefono di contatto (opzionale)
  --pub-date <data>     Data pubblicazione sito (default: 01/01/2020)
  --cms <sistema>       CMS/Sistema utilizzato (default: Custom)
  --ai-key <key>        Chiave API Anthropic per semplificare descrizioni
  --help                Mostra questo messaggio

Esempi:
  node a11y-from-json.js report.json
  node a11y-from-json.js report.json --org "ACME SRL" --email info@acme.it
  node a11y-from-json.js report.json --org "Comune di Roma" --pub-date 15/03/2019 --cms WordPress

Note:
  - Il file JSON deve essere generato con: node a11y-cli.js <url> -f json
  - Non richiede browser né connessione internet
  - I file vengono salvati nella cartella docs/
`);
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const options = {
    jsonFile: null,
    organizationName: null,
    contactEmail: null,
    contactPhone: null,
    publicationDate: null,
    cms: null,
    anthropicApiKey: null
  };

  if (args[0] && !args[0].startsWith('-')) {
    options.jsonFile = args[0];
  } else {
    console.error('❌ Errore: percorso file JSON richiesto come primo parametro');
    showHelp();
    process.exit(1);
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--org':
        options.organizationName = args[++i];
        break;
      case '--email':
        options.contactEmail = args[++i];
        break;
      case '--phone':
        options.contactPhone = args[++i];
        break;
      case '--pub-date':
        options.publicationDate = args[++i];
        break;
      case '--cms':
        options.cms = args[++i];
        break;
      case '--ai-key':
        options.anthropicApiKey = args[++i];
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`❌ Errore: opzione sconosciuta: ${arg}`);
          showHelp();
          process.exit(1);
        }
    }
  }

  return options;
}

function reconstructResults(jsonReport) {
  if (!jsonReport.pages || !Array.isArray(jsonReport.pages)) {
    throw new Error('Il file JSON non contiene un array "pages" valido');
  }

  return jsonReport.pages.map(page => {
    if (page.status === 'errore') {
      return {
        url: page.url,
        error: page.error,
        timestamp: page.timestamp
      };
    }

    return {
      url: page.url,
      timestamp: page.timestamp,
      axeResults: {
        violations: page.violations || [],
        passes: page.passes || [],
        incomplete: page.incomplete || []
      },
      analysis: {
        score: page.accessibility ? page.accessibility.score : 0,
        summary: page.accessibility ? page.accessibility.summary : {},
        severity: page.accessibility ? page.accessibility.severity : {}
      }
    };
  });
}

async function runFromJson() {
  const options = parseArgs();

  const jsonPath = path.resolve(options.jsonFile);
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ Errore: file non trovato: ${jsonPath}`);
    process.exit(1);
  }

  let jsonReport;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    jsonReport = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Errore nella lettura del file JSON: ${err.message}`);
    process.exit(1);
  }

  if (!jsonReport.pages || !jsonReport.summary) {
    console.error('❌ Errore: il file JSON non sembra un report generato da a11y-cli.js');
    process.exit(1);
  }

  console.log('♿ A11y from JSON - Generazione documenti di conformità');
  console.log('='.repeat(55));
  console.log(`📂 File JSON: ${path.basename(jsonPath)}`);
  console.log(`📊 Pagine nel report: ${jsonReport.pages.length}`);
  if (jsonReport.reportInfo) {
    console.log(`📅 Report generato il: ${jsonReport.reportInfo.generatedAtLocal}`);
  }
  console.log('='.repeat(55));
  console.log();

  const checker = new A11yChecker();
  checker.results = reconstructResults(jsonReport);

  const dichiarazioneOptions = {};
  if (options.organizationName) dichiarazioneOptions.organizationName = options.organizationName;
  if (options.contactEmail)     dichiarazioneOptions.contactEmail = options.contactEmail;
  if (options.contactPhone)     dichiarazioneOptions.contactPhone = options.contactPhone;
  if (options.publicationDate)  dichiarazioneOptions.publicationDate = options.publicationDate;
  if (options.cms)              dichiarazioneOptions.cms = options.cms;

  const apiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    dichiarazioneOptions.anthropicApiKey = apiKey;
    console.log('🤖 Utilizzo AI per semplificare le descrizioni...');
  } else {
    console.log('ℹ️  Nessuna chiave API fornita, uso descrizioni standard');
  }

  const generatedFiles = [];

  const dichiarazionePath = await checker.generateDichiarazioneHTML(dichiarazioneOptions);
  generatedFiles.push({ type: 'Dichiarazione di Accessibilità', path: dichiarazionePath });

  const allegato2Path = await checker.generateAllegato2HTML({});
  generatedFiles.push({ type: 'Allegato 2 AGID', path: allegato2Path });

  console.log('\n📄 Documenti generati:');
  generatedFiles.forEach(file => {
    console.log(`   ${file.type}: ${path.basename(file.path)}`);
  });
  console.log(`\n📁 Directory: ${path.dirname(generatedFiles[0].path)}`);
}

if (require.main === module) {
  runFromJson().catch(error => {
    console.error('❌ Errore fatale:', error.message);
    process.exit(1);
  });
}

module.exports = { runFromJson };
