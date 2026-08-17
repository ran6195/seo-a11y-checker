#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { launchBrowser, loadPage } = require('./lib/browser');
const { loadChecks, runChecksOnPage } = require('./lib/runner');
const { buildTimestamp, slugifyDomain, slugifyPage } = require('./lib/naming');
const { loadEnvFile } = require('./lib/env');
loadEnvFile();

const STATUS_ICON = {
  pass: '✅',
  fail: '❌',
  'needs-review': '⚠️ ',
  'not-applicable': '➖',
  error: '💥'
};

function printHelp() {
  console.log(`
Uso: node checks/run-site.js <url1> <url2> ... [opzioni]
     node checks/run-site.js --urls-file <file> [opzioni]

Controlla più pagine dello stesso sito in un'unica invocazione: la cartella-run
(<sito>_<timestamp>) viene calcolata una sola volta all'inizio, così tutte le
pagine finiscono nella stessa cartella indipendentemente da quanto dura ciascuna.
Riusa un solo browser per tutte le pagine (più veloce di lanciare checks/run.js
una volta per pagina).

Opzioni: le stesse di checks/run.js (--criteria, --ai, --ai-key, --limit, -h/--headless).
  --urls-file <file>    Legge gli URL da un file di testo, uno per riga (in aggiunta a
                         eventuali URL passati come argomenti). Righe vuote e righe che
                         iniziano con # vengono ignorate.
Non supporta -o/--output: l'output è sempre la cartella-run, una pagina per file JSON.

Esempi:
  node checks/run-site.js https://example.com https://example.com/contatti
  node checks/run-site.js https://example.com https://example.com/chi-siamo --ai --limit 3
  node checks/run-site.js --urls-file pagine.txt --ai

Formato pagine.txt:
  # commento, ignorato
  https://example.com/
  https://example.com/contatti/
`);
}

function readUrlsFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ File non trovato: ${resolved}`);
    process.exit(1);
  }
  return fs.readFileSync(resolved, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function parseArgs(argv) {
  const options = {
    ai: false,
    headless: false,
    limit: 5,
    criteria: null,
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    urls: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ai') options.ai = true;
    else if (arg === '-h' || arg === '--headless') options.headless = true;
    else if (arg === '--limit') options.limit = parseInt(argv[++i], 10) || options.limit;
    else if (arg === '--criteria') options.criteria = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--ai-key') options.apiKey = argv[++i];
    else if (arg === '--urls-file') options.urls.push(...readUrlsFile(argv[++i] || ''));
    else if (arg === '--help') { printHelp(); process.exit(0); }
    else if (!arg.startsWith('-')) options.urls.push(arg);
  }

  return options;
}

async function main() {
  const runStarted = new Date();
  const options = parseArgs(process.argv.slice(2));

  if (options.urls.length === 0) {
    printHelp();
    process.exit(1);
  }
  if (options.ai && !options.apiKey) {
    console.error('❌ --ai richiede una ANTHROPIC_API_KEY (env) oppure --ai-key <chiave>');
    process.exit(1);
  }

  const checks = loadChecks(options.criteria);
  if (checks.length === 0) {
    console.error('❌ Nessuno script trovato per i criteri richiesti');
    process.exit(1);
  }

  // Cartella-run calcolata UNA volta, prima di controllare qualunque pagina: è questo
  // il punto di tutto lo script. checks/run.js la ricalcola ad ogni invocazione, e su
  // un run completo (26 criteri + AI) una singola pagina può superare il minuto,
  // facendo scadere il raggruppamento "stesso timestamp" tra pagine consecutive.
  const site = slugifyDomain(options.urls[0]);
  const runDir = path.join(__dirname, 'output', `${site}_${buildTimestamp(runStarted)}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\n🔎 ${options.urls.length} pagine × ${checks.length} criteri${options.ai ? ' (fallback AI attivo)' : ''}`);
  console.log(`📁 Cartella-run: ${runDir}\n`);

  const { browser, page } = await launchBrowser({ headless: options.headless });
  const summary = [];

  for (const url of options.urls) {
    console.log(`\n🌐 ${url}`);
    const { axeResults } = await loadPage(page, url);

    const results = await runChecksOnPage(
      checks,
      { page, axeResults, url, options },
      (check, result) => {
        console.log(`   ${check.id} ${check.name}... ${STATUS_ICON[result.status] || '?'} ${result.status}`);
      }
    );

    const outputPath = path.join(runDir, `${slugifyPage(url)}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ url, timestamp: new Date().toISOString(), results }, null, 2));
    console.log(`   💾 ${outputPath}`);

    summary.push({ url, results });
  }

  await browser.close();

  console.log('\n📋 Riepilogo run:');
  summary.forEach(({ url, results }) => {
    const counts = {};
    results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const parts = Object.entries(counts).map(([status, n]) => `${STATUS_ICON[status] || '?'} ${n}`).join('  ');
    console.log(`   ${url}\n      ${parts}`);
  });

  console.log(`\n💾 Tutti i report salvati in ${runDir}`);
}

main().catch(err => {
  console.error('💥 Errore fatale:', err);
  process.exit(1);
});
