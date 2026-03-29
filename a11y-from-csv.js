#!/usr/bin/env node

const { A11yChecker } = require('./a11y-checker.js');
const fs = require('fs');
const path = require('path');

class A11yFromCSV extends A11yChecker {
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const urls = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Salta linee vuote
      if (!line) continue;

      // Salta header se presente
      if (i === 0 && (line.toLowerCase().includes('url') || line.toLowerCase().includes('link')) && !line.startsWith('http')) {
        continue;
      }

      // Parsing CSV semplice (gestisce virgole e virgolette)
      let url = line;

      // Se la riga contiene virgole, prendi il primo campo
      if (line.includes(',')) {
        const match = line.match(/^"([^"]*)"|^([^,]*)/);
        url = match ? (match[1] || match[2]).trim() : line;
      }

      // Rimuovi virgolette
      url = url.replace(/^["']|["']$/g, '').trim();

      // Valida URL
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        urls.push(url);
      }
    }

    return urls;
  }

  async scanFromCSV(csvPath) {
    console.log(`\n♿ Inizio scansione accessibilità da CSV: ${csvPath}`);

    // Leggi e parsa CSV
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const urls = this.parseCSV(csvContent);

    if (urls.length === 0) {
      console.error('❌ Nessun URL valido trovato nel CSV');
      return;
    }

    console.log(`✅ Trovati ${urls.length} URL da analizzare\n`);

    // Analizza ogni URL
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] 🔍 ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        const result = await this.checkAccessibility(url);
        this.results.push(result);

        if (result.error) {
          console.log(`   ❌ Errore: ${result.error}`);
        } else {
          console.log(`   📊 Score: ${result.analysis.score}% | Violazioni: ${result.analysis.summary.violations}`);
        }

        await this.page.waitForTimeout(500);

      } catch (error) {
        console.error(`   ❌ Errore caricando ${url}:`, error.message);
        this.results.push({
          url,
          error: error.message,
          timestamp: new Date().toISOString(),
          axeResults: { violations: [], incomplete: [], passes: [] },
          analysis: {
            score: 0,
            summary: { violations: 0, incomplete: 0, passes: 0 },
            severityCount: { critical: 0, serious: 0, moderate: 0, minor: 0 },
            violations: [],
            incomplete: [],
            passes: []
          }
        });
      }
    }

    console.log(`\n✅ Scansione completata: ${this.results.length} pagine analizzate`);
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
♿ A11y from CSV - Scansione accessibilità da file CSV

Uso:
  node a11y-from-csv.js <file.csv> [opzioni]

Opzioni:
  -o, --output <base>    Nome base per i file di output (default: auto-generato)
  -f, --format <tipo>    Formato report: html, md, all (default: all)
  --headless             Esegui in modalità headless
  --visible              Esegui con browser visibile (default)
  --profile <path>       Usa profilo Chrome specifico
  --help                 Mostra questo messaggio

Formato CSV:
  Il file CSV deve contenere un URL per riga, oppure URL nella prima colonna.
  Esempio:
    https://example.com
    https://example.com/about
    https://example.com/contact

  Oppure con header:
    url
    https://example.com
    https://example.com/about

Esempi:
  # Analizza URL da CSV e genera tutti i report
  node a11y-from-csv.js urls.csv

  # Con output personalizzato
  node a11y-from-csv.js urls.csv -o myreport

  # Solo HTML
  node a11y-from-csv.js urls.csv -f html

  # Solo Markdown
  node a11y-from-csv.js urls.csv -f md

  # In headless mode
  node a11y-from-csv.js urls.csv --headless

  # Con profilo Chrome (per siti autenticati)
  node a11y-from-csv.js urls.csv --profile ~/Library/Application\\ Support/Google/Chrome/Default
`);
    process.exit(0);
  }

  const csvPath = args[0];

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File non trovato: ${csvPath}`);
    process.exit(1);
  }

  const options = {
    output: null,
    format: 'all',
    headless: false,
    userDataDir: null
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
      case '--headless':
        options.headless = true;
        break;
      case '--visible':
        options.headless = false;
        break;
      case '--profile':
        options.userDataDir = args[++i];
        break;
    }
  }

  // Generate output filenames
  const csvStem = csvPath.replace(/.*[\\/]/, '').replace(/\.[^.]*$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const now = new Date();
  const ts = now.toISOString().slice(0, 16).replace(/-/g, '').replace('T', '_').replace(':', '');
  const baseName = options.output || `${ts}_${csvStem}_a11y`;

  const checker = new A11yFromCSV();

  try {
    await checker.init(options);
    await checker.scanFromCSV(csvPath);

    checker.generateReport();

    if (options.format === 'all' || options.format === 'html') {
      checker.generateHTMLReport(`${baseName}.html`);
    }
    if (options.format === 'all' || options.format === 'md' || options.format === 'markdown') {
      checker.generateMarkdownReport(`${baseName}.md`);
    }

    console.log(`\n✅ Scansione completata con successo!`);

  } catch (error) {
    console.error('❌ Errore durante la scansione:', error);
    process.exit(1);
  } finally {
    await checker.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { A11yFromCSV };
