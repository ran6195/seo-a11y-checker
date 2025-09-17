# SEO Checker con Playwright

Strumento automatizzato per controllare elementi SEO di siti web usando Playwright.

## Installazione

```bash
npm install
npx playwright install
```

## Funzionalità

### ✅ Controlli implementati:

- **Struttura Heading**: Verifica sequenza logica H1-H6
- **Meta Tags**: Controlla title e description
- **Lunghezza testi**:
  - Title: 30-60 caratteri
  - Description: 70-155 caratteri
- **Duplicati**: Identifica title e description duplicate
- **Navigazione**: Esplora automaticamente link del menu

## Utilizzo Base

```javascript
const { SEOChecker } = require('./seo-checker');

async function check() {
  const checker = new SEOChecker();
  await checker.init();

  // Controlla un sito (max 5 pagine)
  await checker.navigateAndCheck('https://tuosito.com', 5);

  // Genera report
  checker.generateReport();

  await checker.close();
}

check();
```

## Esempi

### 1. Test completo sito
```bash
node example.js
```

### 2. Test singola pagina
```javascript
const { testSinglePage } = require('./example');
testSinglePage('https://tuosito.com/pagina');
```

### 3. Configurazione personalizzata
```javascript
const checker = new SEOChecker();
await checker.init();

// Solo heading
const headingResult = await checker.checkHeadingStructure(url);

// Solo meta tags
const metaResult = await checker.checkMetaTags(url);
```

## Output Report

Il report include:

- ✅/❌ Status per ogni pagina
- 📄 Title e lunghezza
- 📝 Description e lunghezza
- 📊 Numero headings trovati
- 🚨 Lista problemi specifici
- 🔍 Duplicati tra pagine
- 📈 Statistiche finali

## Personalizzazione

### Modificare limiti caratteri:
```javascript
// In checkMetaTags()
if (metaData.title.length < 25) { // era 30
if (metaData.title.length > 65) { // era 60
```

### Modalità headless:
```javascript
// In init()
this.browser = await chromium.launch({
  headless: true, // non mostra browser
  slowMo: 0 // velocità massima
});
```

### Selettori menu personalizzati:
```javascript
// In navigateAndCheck()
const navLinks = await this.page.$$eval('nav a, .your-menu a', ...);
```

## Struttura File

- `seo-checker.js` - Classe principale
- `example.js` - Esempi di utilizzo
- `package.json` - Dipendenze NPM

## Note

- Il browser si apre visibile per default (headless: false)
- Velocità rallentata per osservare i controlli (slowMo: 500)
- Timeout 1 secondo tra pagine per evitare sovraccarico server
- Gestione errori per pagine non raggiungibili