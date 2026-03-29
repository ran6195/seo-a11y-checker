#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function listLinks(url, options = {}) {
  const {
    output = null,
    format = 'console', // console, txt, json, csv
    headless = true,
    userDataDir = null
  } = options;

  let browser = null;
  let context = null;

  try {
    // Inizializza browser
    if (userDataDir) {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        channel: 'chrome'
      });
    } else {
      browser = await chromium.launch({ headless });
      context = await browser.newContext();
    }

    const page = await context.newPage();

    console.log(`🔍 Caricamento pagina: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Estrai tutti i link
    const links = await page.$$eval('a[href]', els =>
      els.map(el => ({
        href: el.href,
        text: el.textContent.trim(),
        title: el.title || '',
        target: el.target || '_self'
      })).filter(link => link.href && link.href.trim().length > 0)
    );

    console.log(`\n✅ Trovati ${links.length} link sulla pagina\n`);

    // Rimuovi duplicati basati su href
    const uniqueLinks = Array.from(
      new Map(links.map(link => [link.href, link])).values()
    );

    console.log(`📊 Link unici: ${uniqueLinks.length}\n`);

    // Output
    if (format === 'console' || !output) {
      printToConsole(uniqueLinks, url);
    }

    if (output) {
      saveToFile(uniqueLinks, url, output, format);
    }

    await context.close();
    if (browser) await browser.close();

    return uniqueLinks;

  } catch (error) {
    console.error('❌ Errore:', error.message);
    if (context) await context.close();
    if (browser) await browser.close();
    process.exit(1);
  }
}

function printToConsole(links, url) {
  console.log('='.repeat(80));
  console.log(`ELENCO LINK DA: ${url}`);
  console.log('='.repeat(80));
  console.log();

  // Raggruppa per tipo
  const internal = links.filter(l => {
    try {
      const linkUrl = new URL(l.href);
      const pageUrl = new URL(url);
      return linkUrl.hostname === pageUrl.hostname;
    } catch {
      return false;
    }
  });

  const external = links.filter(l => !internal.includes(l));
  const mailto = links.filter(l => l.href.startsWith('mailto:'));
  const tel = links.filter(l => l.href.startsWith('tel:'));

  console.log(`📍 Link interni: ${internal.length}`);
  internal.forEach((link, i) => {
    console.log(`  ${i + 1}. ${link.href}`);
    if (link.text) console.log(`     📝 "${link.text.substring(0, 60)}${link.text.length > 60 ? '...' : ''}"`);
  });

  if (external.length > 0) {
    console.log(`\n🌐 Link esterni: ${external.length}`);
    external.forEach((link, i) => {
      console.log(`  ${i + 1}. ${link.href}`);
      if (link.text) console.log(`     📝 "${link.text.substring(0, 60)}${link.text.length > 60 ? '...' : ''}"`);
    });
  }

  if (mailto.length > 0) {
    console.log(`\n📧 Link email: ${mailto.length}`);
    mailto.forEach((link, i) => {
      console.log(`  ${i + 1}. ${link.href}`);
    });
  }

  if (tel.length > 0) {
    console.log(`\n📞 Link telefono: ${tel.length}`);
    tel.forEach((link, i) => {
      console.log(`  ${i + 1}. ${link.href}`);
    });
  }

  console.log();
  console.log('='.repeat(80));
}

function saveToFile(links, url, outputPath, format) {
  let content = '';
  let filename = outputPath;

  switch (format) {
    case 'txt':
      content = generateTxt(links, url);
      if (!filename.endsWith('.txt')) filename += '.txt';
      break;

    case 'json':
      content = JSON.stringify({
        url,
        timestamp: new Date().toISOString(),
        totalLinks: links.length,
        links
      }, null, 2);
      if (!filename.endsWith('.json')) filename += '.json';
      break;

    case 'csv':
      content = generateCsv(links);
      if (!filename.endsWith('.csv')) filename += '.csv';
      break;

    case 'md':
    case 'markdown':
      content = generateMarkdown(links, url);
      if (!filename.endsWith('.md')) filename += '.md';
      break;

    default:
      console.log('⚠️  Formato non riconosciuto, uso txt');
      content = generateTxt(links, url);
      if (!filename.endsWith('.txt')) filename += '.txt';
  }

  fs.writeFileSync(filename, content, 'utf8');
  console.log(`✅ File salvato: ${path.resolve(filename)}`);
}

function generateTxt(links, url) {
  let txt = `ELENCO LINK DA: ${url}\n`;
  txt += `Data: ${new Date().toLocaleString('it-IT')}\n`;
  txt += `Totale link: ${links.length}\n`;
  txt += '='.repeat(80) + '\n\n';

  links.forEach((link, i) => {
    txt += `${i + 1}. ${link.href}\n`;
    if (link.text) txt += `   Testo: ${link.text}\n`;
    if (link.title) txt += `   Titolo: ${link.title}\n`;
    txt += '\n';
  });

  return txt;
}

function generateCsv(links) {
  let csv = 'N,URL,Testo,Titolo,Target\n';
  links.forEach((link, i) => {
    const text = link.text.replace(/"/g, '""');
    const title = link.title.replace(/"/g, '""');
    csv += `${i + 1},"${link.href}","${text}","${title}","${link.target}"\n`;
  });
  return csv;
}

function generateMarkdown(links, url) {
  let md = `# Elenco Link\n\n`;
  md += `**URL analizzato:** ${url}  \n`;
  md += `**Data:** ${new Date().toLocaleString('it-IT')}  \n`;
  md += `**Totale link:** ${links.length}\n\n`;
  md += `---\n\n`;

  links.forEach((link, i) => {
    md += `## ${i + 1}. [${link.text || 'Link'}](${link.href})\n\n`;
    if (link.title) md += `**Titolo:** ${link.title}  \n`;
    md += `**URL:** \`${link.href}\`  \n`;
    md += `**Target:** ${link.target}\n\n`;
  });

  return md;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
📋 List Links - Estrai link da una pagina web

Uso:
  node list-links.js <url> [opzioni]

Opzioni:
  -o, --output <file>    Salva output su file
  -f, --format <tipo>    Formato output: console, txt, json, csv, md (default: console)
  -h, --headless         Esegui in modalità headless (default: true)
  --visible              Esegui con browser visibile
  --profile <path>       Usa profilo Chrome specifico
  --help                 Mostra questo messaggio

Esempi:
  # Stampa a console
  node list-links.js https://example.com

  # Salva in file di testo
  node list-links.js https://example.com -o links.txt -f txt

  # Salva in JSON
  node list-links.js https://example.com -o links.json -f json

  # Salva in CSV
  node list-links.js https://example.com -o links.csv -f csv

  # Salva in Markdown
  node list-links.js https://example.com -o links.md -f md

  # Con browser visibile
  node list-links.js https://example.com --visible

  # Usa profilo Chrome
  node list-links.js https://example.com --profile ~/Library/Application\\ Support/Google/Chrome/Default
`);
    process.exit(0);
  }

  const url = args[0];
  const options = {
    output: null,
    format: 'console',
    headless: true,
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
      case '--visible':
        options.headless = false;
        break;
      case '-h':
      case '--headless':
        options.headless = true;
        break;
      case '--profile':
        options.userDataDir = args[++i];
        break;
    }
  }

  listLinks(url, options);
}

module.exports = { listLinks };
