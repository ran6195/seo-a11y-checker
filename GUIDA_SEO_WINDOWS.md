# Guida all'uso del Controllo SEO per Windows 11

Questa guida spiega passo-passo come utilizzare lo strumento di controllo SEO dei siti web su Windows 11, anche se non hai esperienza tecnica.

## Cosa serve prima di iniziare

1. **Node.js** installato sul computer (versione 14 o superiore)
2. **Google Chrome** installato
3. La cartella del progetto sul tuo computer

---

## Parte 1: Come aprire PowerShell

PowerShell è il programma dove scriverai i comandi per far funzionare lo strumento.

### Metodo 1: Dal menu Start (più semplice)
1. Clicca sul pulsante **Start** (icona Windows in basso a sinistra)
2. Scrivi nella barra di ricerca: **powershell**
3. Clicca su **Windows PowerShell** quando appare nei risultati
4. Si aprirà una finestra blu con del testo bianco

### Metodo 2: Da Esplora File
1. Apri **Esplora File** (icona della cartella nella barra in basso)
2. Vai nella cartella del progetto (quella che contiene i file `seo-cli.js`, `package.json`, ecc.)
3. Tieni premuto il tasto **Shift** (Maiuscolo) sulla tastiera
4. Fai clic destro in un punto vuoto della cartella
5. Scegli **"Apri finestra PowerShell qui"** oppure **"Apri in Terminale"**

### Come verificare di essere nella cartella giusta
Dopo aver aperto PowerShell, vedrai un testo che indica dove ti trovi, ad esempio:
```
PS C:\Users\TuoNome\Desktop\controlliedysma>
```

Se non sei nella cartella giusta, spostati con questo comando:
```powershell
cd C:\percorso\alla\cartella\controlliedysma
```

(Sostituisci il percorso con quello reale della tua cartella)

---

## Parte 2: Installare il programma (solo la prima volta)

Prima di usare lo strumento, devi installare i componenti necessari. **Fai questo solo la prima volta**.

### Passo 1: Installare i componenti
Scrivi questo comando e premi **Invio**:
```powershell
npm install
```

Vedrai scorrere molto testo. Aspetta che finisca (può richiedere qualche minuto).

### Passo 2: Installare il browser di test
Scrivi questo comando e premi **Invio**:
```powershell
npx playwright install
```

Anche questo richiederà qualche minuto. Aspetta che finisca.

---

## Parte 3: Come controllare la SEO di un sito

Ora sei pronto per controllare i siti web!

### Comando base (esempio più semplice)

Per controllare un sito web, usa questo comando:
```powershell
node seo-cli.js https://esempio.it
```

Sostituisci `https://esempio.it` con l'indirizzo del sito che vuoi controllare.

**Esempio reale:**
```powershell
node seo-cli.js https://www.comune.milano.it
```

### Cosa succede dopo il comando?
1. Si aprirà una finestra di Chrome
2. Vedrai il browser visitare le pagine del sito
3. Nella finestra PowerShell vedrai apparire i risultati
4. Alla fine, verranno creati dei file con i report nella cartella `reports`

---

## Parte 4: Opzioni utili

Puoi aggiungere delle "opzioni" al comando per personalizzare il controllo.

### Controllare più pagine
Per controllare più pagine (esempio: 20 pagine invece delle 5 predefinite):
```powershell
node seo-cli.js https://esempio.it -p 20
```

### Controllare tutto il sito
Per controllare tutte le pagine del sito (attenzione: può richiedere molto tempo!):
```powershell
node seo-cli.js https://esempio.it --crawl
```

### Nascondere la finestra del browser
Se non vuoi vedere la finestra di Chrome mentre lavora:
```powershell
node seo-cli.js https://esempio.it --headless
```

### Scegliere il formato del report
Puoi scegliere in che formato vuoi il report:

**Solo HTML (file da aprire nel browser):**
```powershell
node seo-cli.js https://esempio.it -f html
```

**Solo Markdown (file di testo formattato):**
```powershell
node seo-cli.js https://esempio.it -f md
```

**Solo JSON (file dati per altri programmi):**
```powershell
node seo-cli.js https://esempio.it -f json
```

**Tutti i formati insieme:**
```powershell
node seo-cli.js https://esempio.it -f all
```

### Dare un nome al report
Per dare un nome specifico al file del report:
```powershell
node seo-cli.js https://esempio.it -o mio-report-seo
```

Il report si chiamerà `mio-report-seo.html`, `mio-report-seo.md`, ecc.

---

## Parte 5: Esempi completi

### Esempio 1: Controllo veloce di 10 pagine
```powershell
node seo-cli.js https://www.example.com -p 10 --headless -f html
```
Questo comando:
- Controlla il sito www.example.com
- Analizza massimo 10 pagine
- Non mostra la finestra del browser
- Crea solo il report HTML

### Esempio 2: Controllo completo del sito
```powershell
node seo-cli.js https://www.mysite.com --crawl -f all -o report-seo-completo
```
Questo comando:
- Controlla tutto il sito www.mysite.com
- Visita tutte le pagine trovate
- Crea report in tutti i formati (HTML, MD, JSON)
- Nomina i file `report-seo-completo.*`

### Esempio 3: Controllo rapido senza browser visibile
```powershell
node seo-cli.js https://www.esempio.it -p 5 --headless -f html -o check-veloce
```

---

## Parte 6: Cosa controlla lo strumento SEO

Lo strumento verifica questi aspetti SEO del tuo sito:

### 1. Meta Tag (Title e Description)
- **Title**: Deve essere lungo tra 30 e 60 caratteri
- **Description**: Deve essere lunga tra 70 e 155 caratteri
- Verifica la presenza di questi tag in ogni pagina

### 2. Struttura dei Titoli (H1-H6)
- Controlla che ogni pagina abbia un solo H1
- Verifica la gerarchia corretta dei titoli (H1 → H2 → H3, ecc.)
- Identifica problemi come titoli saltati (es. H1 → H3 senza H2)

### 3. Dimensioni delle Pagine
- Calcola il peso totale di ogni pagina (HTML + risorse)
- Segnala pagine che superano i 200 KB
- Aiuta a identificare pagine lente da caricare

### 4. Favicon
- Verifica la presenza dell'icona del sito (favicon)

### 5. Email Esposte
- Rileva indirizzi email visibili nel codice HTML
- Utile per prevenire spam

### 6. Sezioni Legali
- Controlla la presenza di link a:
  - Privacy Policy
  - Cookie Policy
  - Termini e Condizioni

### 7. Contenuti Duplicati
- Identifica pagine con contenuto identico o molto simile

---

## Parte 7: Dove trovare i report

Dopo che il controllo è finito, i report vengono salvati nella cartella:
```
C:\percorso\tuo\progetto\reports\
```

### Come aprire i report

**Report HTML:**
- Vai nella cartella `reports`
- Trova il file che finisce con `.html`
- Fai doppio clic per aprirlo nel browser

**Report Markdown (.md):**
- Puoi aprirli con Notepad o un editor di testo
- Oppure usa un visualizzatore Markdown per una migliore formattazione

**Report JSON:**
- Puoi aprirli con Notepad o un editor di testo
- Sono file dati pensati per essere letti da altri programmi

---

## Parte 8: Risoluzione problemi comuni

### "Il comando node non è riconosciuto"
**Problema:** Node.js non è installato o non è nel PATH di sistema.

**Soluzione:**
1. Scarica Node.js da: https://nodejs.org/
2. Installa la versione LTS (raccomandata)
3. Riavvia PowerShell dopo l'installazione

### "Impossibile caricare il file... non è consentita l'esecuzione di script"
**Problema:** PowerShell blocca l'esecuzione degli script per sicurezza.

**Soluzione:**
1. Apri PowerShell **come Amministratore** (clic destro > "Esegui come amministratore")
2. Scrivi questo comando:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Premi **Invio** e digita **S** (Sì) per confermare
4. Chiudi e riapri PowerShell normalmente

### "Il browser non si apre"
**Problema:** Playwright non è installato correttamente.

**Soluzione:**
Esegui di nuovo:
```powershell
npx playwright install
```

### Il programma sembra bloccato
**Problema:** Il sito è molto lento o ci sono molte pagine.

**Soluzione:**
- Aspetta qualche minuto
- Se dopo 10-15 minuti non succede nulla, premi **Ctrl+C** per interrompere
- Riprova con meno pagine: `-p 5`

### "Errore di timeout" o "Pagina non risponde"
**Problema:** Il sito è troppo lento o non risponde.

**Soluzione:**
- Verifica che l'indirizzo del sito sia corretto
- Prova ad aprire il sito nel browser per verificare che funzioni
- Alcuni siti possono bloccare i controlli automatici

---

## Parte 9: Usare l'interfaccia Web (alternativa più semplice)

Se preferisci non usare PowerShell, puoi usare l'interfaccia web del programma!

### Come avviare l'interfaccia web

1. Apri PowerShell nella cartella del progetto
2. Scrivi questo comando:
   ```powershell
   node seo-web-server.js
   ```
3. Apri il browser e vai all'indirizzo: **http://localhost:3000**
4. Vedrai un'interfaccia con moduli da compilare
5. Compila i campi e clicca sul pulsante per avviare il controllo
6. I risultati appariranno direttamente nella pagina web

### Vantaggi dell'interfaccia web
- Non serve conoscere i comandi
- Tutti i parametri sono visibili in un modulo
- I report si scaricano automaticamente con un clic
- Puoi selezionare il profilo Chrome da un menu a tendina

---

## Riepilogo comandi rapidi

```powershell
# Controllo base (5 pagine, tutti i formati)
node seo-cli.js https://esempio.it

# Controllo veloce (10 pagine, solo HTML, senza finestra browser)
node seo-cli.js https://esempio.it -p 10 -f html --headless

# Controllo completo di tutto il sito
node seo-cli.js https://esempio.it --crawl -f all

# Controllo con nome personalizzato
node seo-cli.js https://esempio.it -o mio-report -f html

# Avviare interfaccia web
node seo-web-server.js
```

---

## Bisogno di aiuto?

Se qualcosa non funziona:
1. Verifica di essere nella cartella giusta in PowerShell
2. Controlla di aver installato Node.js e i componenti (`npm install`)
3. Prova a riavviare PowerShell
4. Verifica che l'indirizzo del sito sia corretto (deve iniziare con `http://` o `https://`)
5. Se i comandi sono troppo complicati, prova l'interfaccia web con `node seo-web-server.js`

Per ulteriori informazioni tecniche, consulta il file `CLAUDE.md` nella cartella del progetto.
