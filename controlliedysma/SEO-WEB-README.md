# 🌐 SEO Checker - Interfaccia Web

Interfaccia web user-friendly per eseguire controlli SEO senza utilizzare la command line.

## 🚀 Avvio Rapido

### Metodo 1: Script di avvio (raccomandato)
```bash
./start-seo-web.sh
```

### Metodo 2: Comando diretto
```bash
node seo-web-server.js
```

Poi apri il browser su: **http://localhost:3000**

## ✨ Caratteristiche

### 📋 Form Parametri Completo
- **URL del sito**: Campo obbligatorio per inserire l'URL da analizzare
- **Crawling completo**: Opzione per scansionare l'intero sito
- **Numero pagine**: Limite di pagine da controllare (se crawling non attivo)
- **Formato report**: Scegli tra HTML, Markdown, JSON o entrambi
- **Modalità headless**: Esegui il browser in background senza interfaccia grafica
- **Profilo Chrome**: Selezione automatica dei profili disponibili (utile per siti autenticati)
- **Nome file output**: Personalizza il nome del report o usa timestamp automatico

### 🎨 Interfaccia Moderna
- Design responsive (funziona su desktop, tablet e mobile)
- Gradienti moderni e animazioni fluide
- Console-style output area per vedere i log in tempo reale
- Indicatori di stato colorati (running/success/error)

### ⚡ Funzionalità Real-Time
- **Streaming output**: Vedi i log del processo mentre vengono generati
- **Status bar dinamica**: Indicatori visivi dello stato corrente
- **Download automatico**: Link ai report generati appena disponibili
- **Nessun refresh necessario**: Tutto aggiornato in tempo reale

## 🔧 Risoluzione Problemi

### Porta già in uso
Se vedi l'errore "address already in use", il server proverà automaticamente porte alternative (3001-3010).

Per killare manualmente i processi sulla porta 3000:
```bash
lsof -ti:3000 | xargs kill -9
```

### Il browser non si connette
1. Verifica che il server sia avviato correttamente
2. Controlla che non ci siano firewall che bloccano la porta
3. Prova a usare `http://127.0.0.1:3000` invece di `localhost`

### I report non vengono scaricati
I report sono salvati nella directory del progetto. Se i link di download non funzionano, puoi trovarli manualmente nella cartella principale.

## 📁 File Coinvolti

- **seo-web-server.js**: Server HTTP con API endpoints
- **seo-web-ui.html**: Interfaccia HTML/CSS/JavaScript
- **start-seo-web.sh**: Script di avvio semplificato
- **seo-cli.js**: Script CLI chiamato dal server

## 🎯 Casi d'Uso

### Analisi Rapida di un Sito
1. Avvia il server
2. Inserisci l'URL
3. Lascia i parametri di default
4. Clicca "Avvia Controllo SEO"

### Crawling Completo con Autenticazione
1. Avvia il server
2. Inserisci l'URL
3. Attiva "Crawling completo"
4. Seleziona il profilo Chrome appropriato
5. Clicca "Avvia Controllo SEO"

### Solo Report JSON per CI/CD
1. Avvia il server
2. Inserisci l'URL
3. Seleziona formato "Solo JSON"
4. Attiva "Modalità headless"
5. Clicca "Avvia Controllo SEO"

## 🛠️ Tecnologie Utilizzate

- **Backend**: Node.js con modulo HTTP nativo
- **Frontend**: HTML5, CSS3, JavaScript vanilla (no framework)
- **Comunicazione**: Server-Sent Events (SSE) per streaming real-time
- **Automazione**: Playwright per browser automation

## 📞 Supporto

Per problemi o domande, consulta:
- Il file `CLAUDE.md` nella root del progetto
- La documentazione di `seo-cli.js` con `--help`

---

Made with ❤️ for easy SEO checking
