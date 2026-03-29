#!/usr/bin/env node

const { LighthouseChecker } = require('./lighthouse-checker.js');

function printHelp() {
  console.log(`
Utilizzo: node lighthouse-cli.js <url> [opzioni]

Opzioni:
  -o, --output <file>      Nome file di output (senza estensione)
  -f, --format <tipo>      Formato: html, json, all (default: all)
  --profile <path>         Usa profilo Chrome (per pagine autenticate)
  --help                   Mostra questo messaggio

Esempi:
  node lighthouse-cli.js https://esempio.it
  node lighthouse-cli.js https://esempio.it -f html
  node lighthouse-cli.js https://esempio.it --profile ~/Library/Application\\ Support/Google/Chrome/Default

Nota: Lighthouse richiede Google Chrome installato.
      Ogni analisi impiega ~15-30 secondi per pagina.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const url = args[0];

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.error('❌ URL non valido. Deve iniziare con http:// o https://');
    process.exit(1);
  }

  const options = {
    output: null,
    format: 'all',
    userDataDir: null,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '-o':
      case '--output':
        options.output = args[++i];
        break;
      case '-f':
      case '--format':
        options.format = args[++i];
        break;
      case '--profile':
        options.userDataDir = args[++i];
        break;
    }
  }

  const checker = new LighthouseChecker();

  try {
    await checker.checkUrl(url, { userDataDir: options.userDataDir });

    const fmt = options.format;

    if (fmt === 'all' || fmt === 'html') {
      checker.generateHTMLReport(options.output ? `${options.output}.html` : null);
    }
    if (fmt === 'all' || fmt === 'json') {
      checker.generateJSONReport(options.output ? `${options.output}.json` : null);
    }

    console.log('\n✅ Analisi completata!');

  } catch (err) {
    console.error('\n❌ Errore durante l\'analisi:', err.message);
    if (err.message.includes('Chrome') || err.message.includes('chrome')) {
      console.error('   Assicurati che Google Chrome sia installato.');
    }
    process.exit(1);
  }
}

main();
