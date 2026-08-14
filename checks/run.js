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
Uso: node checks/run.js <url> [opzioni]

Suite indipendente di controlli WCAG: uno script per criterio (checks/<sc>.js),
ognuno con un check automatico e un fallback AI opzionale. Per controllare più
pagine dello stesso sito in un'unica cartella-run, usa checks/run-site.js.

Opzioni:
  --criteria <lista>    Criteri da eseguire, separati da virgola (es. 1.1.1,2.4.7). Default: tutti quelli trovati in checks/.
  --ai                  Abilita il fallback AI (richiede ANTHROPIC_API_KEY o --ai-key).
  --ai-key <key>        Chiave API Anthropic (default: env ANTHROPIC_API_KEY).
  --limit <n>           Numero massimo di elementi verificati via AI per criterio (default: 5).
  -h, --headless        Esegui senza interfaccia del browser.
  -o, --output <file>   Salva il report JSON in un percorso specifico (disattiva il salvataggio automatico).
  --no-save             Non salvare alcun file, solo output a console.
  --help                Mostra questo messaggio.

Salvataggio automatico (default, se non usi -o o --no-save):
  checks/output/<sito>_<YYYYMMDD_HHMM>/<pagina>.json

Esempi:
  node checks/run.js https://example.com
  node checks/run.js https://example.com --criteria 1.1.1 --ai --limit 3
  node checks/run.js https://example.com/contatti --ai
`);
}

function parseArgs(argv) {
  const options = {
    ai: false,
    headless: false,
    limit: 5,
    criteria: null,
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    output: null,
    noSave: false,
    url: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ai') options.ai = true;
    else if (arg === '-h' || arg === '--headless') options.headless = true;
    else if (arg === '--limit') options.limit = parseInt(argv[++i], 10) || options.limit;
    else if (arg === '--criteria') options.criteria = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--ai-key') options.apiKey = argv[++i];
    else if (arg === '-o' || arg === '--output') options.output = argv[++i];
    else if (arg === '--no-save') options.noSave = true;
    else if (arg === '--help') { printHelp(); process.exit(0); }
    else if (!options.url) options.url = arg;
  }

  return options;
}

async function main() {
  const runStarted = new Date();
  const options = parseArgs(process.argv.slice(2));

  if (!options.url) {
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

  console.log(`\n🔎 ${checks.length} criteri da verificare su ${options.url}${options.ai ? ' (fallback AI attivo)' : ''}\n`);

  const { browser, page } = await launchBrowser({ headless: options.headless });
  const { axeResults } = await loadPage(page, options.url);

  const results = await runChecksOnPage(
    checks,
    { page, axeResults, url: options.url, options },
    (check, result) => {
      console.log(`   ${check.id} ${check.name}... ${STATUS_ICON[result.status] || '?'} ${result.status}`);
    }
  );

  await browser.close();

  // Suggerimenti specifici dall'AI (per singolo elemento) se disponibili, altrimenti
  // il suggerimento generico statico dello script: mai duplicare una chiamata AI solo
  // per generare un consiglio, si riusa quella già fatta per la verifica.
  function collectSuggestions(result) {
    const fromAi = ((result.ai && result.ai.findings) || [])
      .map(f => f.suggerimento)
      .filter(Boolean);
    if (fromAi.length > 0) return fromAi;
    return result.remediation ? [result.remediation] : [];
  }

  console.log('\n📋 Riepilogo:');
  results.forEach(r => {
    console.log(`   ${STATUS_ICON[r.status] || '?'} ${r.id} ${r.name} — ${r.status}`);
    if (r.description) console.log(`      ${r.description}`);
    if (r.notes) console.log(`      ${r.notes}`);
    if (r.status === 'fail' || r.status === 'needs-review') {
      collectSuggestions(r).slice(0, 3).forEach(s => console.log(`      💡 ${s}`));
    }
  });

  let outputPath = options.output;
  if (!outputPath && !options.noSave) {
    const dir = path.join(__dirname, 'output', `${slugifyDomain(options.url)}_${buildTimestamp(runStarted)}`);
    fs.mkdirSync(dir, { recursive: true });
    outputPath = path.join(dir, `${slugifyPage(options.url)}.json`);
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify({ url: options.url, timestamp: new Date().toISOString(), results }, null, 2));
    console.log(`\n💾 Report salvato in ${outputPath}`);
  }
}

main().catch(err => {
  console.error('💥 Errore fatale:', err);
  process.exit(1);
});
