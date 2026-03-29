#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Funzione per mostrare l'help
function showHelp() {
  console.log(`
📄 HTML to PDF Converter

Utilizzo:
  node html-to-pdf.js <file.html> [opzioni]

Parametri:
  file.html              File HTML da convertire (obbligatorio)

Opzioni:
  -o, --output <file>    Nome file PDF di output (default: stesso nome del file HTML)
  --format <formato>     Formato pagina: A4, A3, Letter, Legal (default: A4)
  --landscape            Orientamento orizzontale (default: verticale)
  --margin <margine>     Margine in mm (es: 10 o "10,20,10,20") (default: 10mm)
  --help                 Mostra questo messaggio

Esempi:
  node html-to-pdf.js report.html
  node html-to-pdf.js report.html -o output.pdf
  node html-to-pdf.js report.html --format A3 --landscape
  node html-to-pdf.js report.html --margin 20
  node html-to-pdf.js report.html --margin "15,20,15,20"

Formati supportati: A4, A3, A5, Letter, Legal, Tabloid
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
    inputFile: null,
    outputFile: null,
    format: 'A4',
    landscape: false,
    margin: '10mm'
  };

  // Primo argomento è il file HTML
  if (args[0] && !args[0].startsWith('-')) {
    options.inputFile = args[0];
  } else {
    console.error('❌ Errore: File HTML richiesto come primo parametro');
    showHelp();
    process.exit(1);
  }

  // Parse delle opzioni
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-o':
      case '--output':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Nome file richiesto dopo -o/--output');
          process.exit(1);
        }
        options.outputFile = args[i + 1];
        i++;
        break;

      case '--format':
        const format = args[i + 1];
        const validFormats = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'];
        if (!format || !validFormats.includes(format)) {
          console.error(`❌ Errore: Formato deve essere uno di: ${validFormats.join(', ')}`);
          process.exit(1);
        }
        options.format = format;
        i++;
        break;

      case '--landscape':
        options.landscape = true;
        break;

      case '--margin':
        if (!args[i + 1] || args[i + 1].startsWith('-')) {
          console.error('❌ Errore: Valore margine richiesto dopo --margin');
          process.exit(1);
        }
        options.margin = args[i + 1];
        i++;
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

  return options;
}

// Funzione principale
async function convertHtmlToPdf() {
  const options = parseArgs();

  // Verifica che il file HTML esista
  const inputPath = path.resolve(options.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Errore: File non trovato: ${options.inputFile}`);
    process.exit(1);
  }

  // Determina il nome del file PDF di output
  let outputPath;
  if (options.outputFile) {
    outputPath = path.resolve(options.outputFile);
  } else {
    const parsed = path.parse(inputPath);
    outputPath = path.join(parsed.dir, `${parsed.name}.pdf`);
  }

  console.log('📄 HTML to PDF Converter');
  console.log('='.repeat(50));
  console.log(`📥 Input:  ${inputPath}`);
  console.log(`📤 Output: ${outputPath}`);
  console.log(`📐 Formato: ${options.format} ${options.landscape ? '(orizzontale)' : '(verticale)'}`);
  console.log(`📏 Margine: ${options.margin}`);
  console.log('='.repeat(50));
  console.log();

  let browser = null;

  try {
    console.log('🚀 Avvio browser...');
    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage();

    console.log('📖 Caricamento HTML...');
    await page.goto(`file://${inputPath}`, {
      waitUntil: 'networkidle'
    });

    // Aspetta un momento per assicurarsi che tutto sia renderizzato
    await page.waitForTimeout(500);

    console.log('🖨️  Generazione PDF...');

    // Configura i margini
    let marginConfig;
    if (options.margin.includes(',')) {
      // Formato: "top,right,bottom,left"
      const margins = options.margin.split(',').map(m => m.trim());
      if (margins.length === 4) {
        marginConfig = {
          top: margins[0],
          right: margins[1],
          bottom: margins[2],
          left: margins[3]
        };
      } else {
        console.warn('⚠️  Formato margine non valido, uso margine predefinito');
        marginConfig = { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' };
      }
    } else {
      // Margine uniforme
      marginConfig = {
        top: options.margin,
        right: options.margin,
        bottom: options.margin,
        left: options.margin
      };
    }

    await page.pdf({
      path: outputPath,
      format: options.format,
      landscape: options.landscape,
      margin: marginConfig,
      printBackground: true // Include colori e immagini di sfondo
    });

    console.log();
    console.log('✅ PDF generato con successo!');
    console.log(`📄 File: ${path.basename(outputPath)}`);
    console.log(`📁 Directory: ${path.dirname(outputPath)}`);

    // Mostra dimensione del file
    const stats = fs.statSync(outputPath);
    const fileSizeInKB = (stats.size / 1024).toFixed(2);
    console.log(`📦 Dimensione: ${fileSizeInKB} KB`);

  } catch (error) {
    console.error('\n❌ Errore durante la conversione:', error.message);
    console.error('💡 Suggerimenti:');
    console.error('   - Verifica che il file HTML sia valido');
    console.error('   - Controlla che il percorso di output sia scrivibile');
    console.error('   - Prova con un margine diverso o formato diverso');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Esegui se chiamato direttamente
if (require.main === module) {
  convertHtmlToPdf().catch(error => {
    console.error('❌ Errore fatale:', error.message);
    process.exit(1);
  });
}

module.exports = { convertHtmlToPdf };
