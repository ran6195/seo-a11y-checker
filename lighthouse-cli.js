#!/usr/bin/env node

const { LighthouseChecker } = require('./lighthouse-checker.js');
const path = require('path');
const os = require('os');
const fs = require('fs');

function getChromeProfiles() {
  const chromeDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const profiles = [];

  try {
    if (!fs.existsSync(chromeDir)) return profiles;

    const items = fs.readdirSync(chromeDir);

    if (items.includes('Default')) {
      profiles.push({
        name: 'Default',
        path: path.join(chromeDir, 'Default'),
        displayName: 'Profilo Predefinito',
      });
    }

    items.forEach(item => {
      if (item === 'Default' || item.startsWith('.')) return;
      const itemPath = path.join(chromeDir, item);
      try {
        if (!fs.statSync(itemPath).isDirectory()) return;
      } catch { return; }
      const prefsPath = path.join(itemPath, 'Preferences');
      if (!fs.existsSync(prefsPath)) return;
      if (item.includes('Guest') || item.includes('System')) return;

      let displayName = item;
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (prefs.profile?.name) displayName = prefs.profile.name;
      } catch { /* ignore */ }

      profiles.push({ name: item, path: itemPath, displayName });
    });
  } catch (e) {
    console.warn('⚠️  Impossibile accedere ai profili Chrome:', e.message);
  }

  return profiles;
}

function selectChromeProfile() {
  const profiles = getChromeProfiles();

  if (profiles.length === 0) {
    console.log('❌ Nessun profilo Chrome trovato. Usa --no-profile per usare Chromium.');
    process.exit(1);
  }

  console.log('🔍 Profili Chrome disponibili:\n');
  profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.displayName} (${p.name})`));
  console.log('  0. Annulla\n');

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    rl.question('👤 Seleziona un profilo (numero): ', answer => {
      rl.close();
      const choice = parseInt(answer);
      if (choice === 0) { console.log('❌ Annullato'); process.exit(0); }
      if (isNaN(choice) || choice < 1 || choice > profiles.length) {
        console.log('❌ Selezione non valida'); process.exit(1);
      }
      const selected = profiles[choice - 1];
      console.log(`✅ Profilo selezionato: ${selected.displayName}\n`);
      resolve(selected.path);
    });
  });
}

function showHelp() {
  console.log(`
🔦 Lighthouse CLI — Analisi Performance, SEO e Accessibilità

Utilizzo:
  node lighthouse-cli.js <url> [opzioni]

Opzioni:
  -p, --pages <numero>         Numero massimo di pagine da analizzare (default: 5)
  -c, --crawl                  Crawling completo del sito (ignora -p)
  -o, --output <file>          Nome file di output (senza estensione)
  -f, --format <tipo>          Formato: html, json, all (default: all)
  -h, --headless               Headless per la fase di crawling (Lighthouse è sempre headless)
  --categories <lista>         Categorie Lighthouse separate da virgola (default: tutte)
                               Valori: performance, accessibility, seo, best-practices
  --device <tipo>              Dispositivo emulato: mobile (default) o desktop
  --throttling <metodo>        Metodo throttling: simulate (default), devtools, none
  --no-profile                 Non usare profilo Chrome (usa Chromium per il crawling)
  --profile <path>             Percorso specifico profilo Chrome
  --select-profile             Scegli profilo Chrome da lista
  --help                       Mostra questo messaggio

Esempi:
  node lighthouse-cli.js https://esempio.it
  node lighthouse-cli.js https://esempio.it -p 10
  node lighthouse-cli.js https://esempio.it --crawl
  node lighthouse-cli.js https://esempio.it --crawl -f html
  node lighthouse-cli.js https://esempio.it --device desktop
  node lighthouse-cli.js https://esempio.it --categories performance,seo
  node lighthouse-cli.js https://esempio.it --throttling none
  node lighthouse-cli.js https://esempio.it --no-profile
  node lighthouse-cli.js https://esempio.it --select-profile

Note:
  - Ogni pagina impiega ~15-30 secondi (Lighthouse è lento per natura)
  - Il crawling usa Playwright per scoprire i link, Lighthouse per analizzarli
  - Richiede Google Chrome installato
`);
}

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
    categories: null,
    device: 'mobile',
    throttling: 'simulate',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('-')) {
      if (!options.url) options.url = arg;
      continue;
    }

    switch (arg) {
      case '-p': case '--pages':
        options.pages = parseInt(args[++i]) || 5;
        break;
      case '-c': case '--crawl':
        options.crawl = true;
        break;
      case '-o': case '--output':
        options.output = args[++i];
        break;
      case '-f': case '--format':
        options.format = args[++i];
        break;
      case '-h': case '--headless':
        options.headless = true;
        break;
      case '--categories':
        options.categories = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--device':
        options.device = args[++i];
        break;
      case '--throttling':
        options.throttling = args[++i] === 'none' ? 'provided' : args[i];
        break;
      case '--no-profile':
        options.useProfile = false;
        break;
      case '--profile':
        options.profilePath = args[++i];
        break;
      case '--select-profile':
        options.selectProfile = true;
        break;
    }
  }

  if (!options.url) {
    console.error('❌ URL obbligatorio.');
    showHelp();
    process.exit(1);
  }

  if (!options.url.startsWith('http://') && !options.url.startsWith('https://')) {
    console.error('❌ URL non valido. Deve iniziare con http:// o https://');
    process.exit(1);
  }

  return options;
}

async function main() {
  const options = parseArgs();

  // Risolvi il profilo Chrome
  let userDataDir = null;

  if (options.selectProfile) {
    userDataDir = await selectChromeProfile();
  } else if (options.profilePath) {
    userDataDir = options.profilePath;
  } else if (options.useProfile) {
    const defaultProfile = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default');
    if (fs.existsSync(defaultProfile)) {
      userDataDir = defaultProfile;
    }
  }

  const checker = new LighthouseChecker();

  // init() è necessario solo se si fa crawling
  const needsCrawl = options.crawl || options.pages > 1;

  const lighthouseOptions = {
    userDataDir,
    categories: options.categories,
    device: options.device,
    throttling: options.throttling,
  };

  if (needsCrawl) {
    await checker.init({ userDataDir, headless: options.headless, ...lighthouseOptions });
  }

  try {
    if (options.crawl) {
      await checker.crawlSite(options.url);
    } else if (options.pages > 1) {
      await checker.navigateAndCheck(options.url, options.pages);
    } else {
      // Singola pagina: nessun crawling, Lighthouse diretto
      await checker.checkUrl(options.url, lighthouseOptions);
    }

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
    if (err.message.toLowerCase().includes('chrome')) {
      console.error('   Assicurati che Google Chrome sia installato.');
    }
    process.exit(1);
  } finally {
    await checker.close();
  }
}

main();
