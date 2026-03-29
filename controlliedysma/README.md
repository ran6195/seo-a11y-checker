# Controlliedysma

Toolkit per audit automatico di siti web: analisi SEO e test di accessibilità (WCAG 2.1). Genera report in HTML, Markdown e JSON, oltre a documenti normativi italiani (Dichiarazione di Accessibilità Legge 4/2004, Allegato 2 AGID).

## Requisiti

- [Node.js](https://nodejs.org/) v18 o superiore
- [Python 3](https://www.python.org/) (solo per le utility CSV)
- Google Chrome installato (opzionale, per usare profili autenticati)

## Installazione

```bash
git clone <url-repo>
cd controlliedysma
npm install
npx playwright install chromium
```

## Configurazione

Crea un file `.env` nella root del progetto:

```env
# Opzionale: chiave API Anthropic per semplificare le descrizioni nelle dichiarazioni
ANTHROPIC_API_KEY=sk-ant-api03-...
```

## Avvio rapido — Interfaccia web

Il modo più semplice per usare il toolkit è l'interfaccia web:

```bash
node web-server.js
```

Apri il browser su `http://localhost:3000`. L'interfaccia permette di eseguire controlli SEO e accessibilità, scegliere tutti i parametri tramite form, e scaricare i report generati.

## Utilizzo da riga di comando

### SEO Checker

```bash
# Controlla una singola pagina
node seo-cli.js https://esempio.it

# Scansiona fino a 10 pagine, output HTML
node seo-cli.js https://esempio.it -p 10 -f html

# Scansione completa del sito
node seo-cli.js https://esempio.it --crawl

# Modalità headless (senza finestra browser)
node seo-cli.js https://esempio.it --headless --no-profile
```

### Accessibility Checker

```bash
# Controlla una singola pagina
node a11y-cli.js https://esempio.it

# Scansiona fino a 10 pagine, tutti i formati
node a11y-cli.js https://esempio.it -p 10 -f all

# Genera la Dichiarazione di Accessibilità (Legge 4/2004)
node a11y-cli.js https://esempio.it -f dichiarazione --org "Nome Ente" --email info@ente.it

# Genera l'Allegato 2 AGID (autovalutazione WCAG 2.1 AA)
node a11y-cli.js https://esempio.it -f allegato2
```

### Opzioni comuni

| Opzione | Descrizione |
|---|---|
| `-p <n>` | Numero massimo di pagine da analizzare (default: 5) |
| `--crawl` | Scansione completa del sito (ignora `-p`) |
| `-f <formato>` | Formato output: `html`, `md`, `json`, `all` |
| `-o <file>` | Nome file di output |
| `--headless` | Esegui senza finestra browser |
| `--no-profile` | Usa Chromium invece di Chrome |
| `--select-profile` | Scegli profilo Chrome da una lista |

### Analisi da CSV (accessibilità)

```bash
node a11y-from-csv.js urls.csv
node a11y-from-csv.js urls.csv -f html --headless
```

### Estrazione link

```bash
node list-links.js https://esempio.it
node list-links.js https://esempio.it -o links.csv -f csv
```

### Conversione HTML → PDF

```bash
node html-to-pdf.js report.html
node html-to-pdf.js report.html -o output.pdf --format A3
```

## Formati di output

| Formato | SEO | Accessibilità | Descrizione |
|---|---|---|---|
| `html` | ✅ | ✅ | Report dettagliato con indice pagine |
| `md` | ✅ | ✅ | Report in Markdown |
| `json` | ✅ | ✅ | Dati strutturati per integrazione CI/CD |
| `dichiarazione` | — | ✅ | Dichiarazione accessibilità (Legge 4/2004) |
| `allegato2` | — | ✅ | Autovalutazione AGID con criteri WCAG 2.1 AA |

## Note

- I report vengono salvati nella cartella corrente con timestamp nel nome (es. `seo-report-2025-01-15-10-30-00.html`).
- Per siti con autenticazione, usa `--select-profile` per scegliere un profilo Chrome già loggato.
- La funzione di semplificazione AI delle descrizioni (nelle dichiarazioni) richiede una chiave API Anthropic nel file `.env`.

## Licenza

MIT
