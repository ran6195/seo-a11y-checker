# 🔧 Troubleshooting - SEO Web Interface

Guida completa per risolvere i problemi con l'interfaccia web del SEO Checker.

## ✅ Checklist Iniziale

Prima di tutto, verifica questi punti:

1. **Server avviato correttamente?**
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null
   node seo-web-server.js
   ```
   Dovresti vedere:
   ```
   ✅ Server avviato su: http://localhost:3000
   ```

2. **Il browser può connettersi?**
   Apri http://localhost:3000 nel browser
   - ✅ Vedi la pagina con il form? Ottimo!
   - ❌ Errore di connessione? Controlla il firewall

3. **Console del browser aperta?**
   - Premi F12 (o Cmd+Option+I su Mac)
   - Vai alla tab "Console"
   - Guarda i messaggi mentre usi l'interfaccia

## 🐛 Problema: "Non succede niente" dopo il click

### Sintomo
Clicchi "Avvia Controllo SEO" ma non vedi output nell'area di log.

### Diagnosi

#### 1. Verifica la console del browser (F12)

**Cosa cercare:**
```javascript
📤 Invio richiesta con parametri: {url: "...", ...}
📥 Risposta ricevuta: 200 OK
🔄 Connessione stabilita, in attesa dell'output...
📦 Ricevute N linee
📨 Dato ricevuto: stdout/stderr/close
```

**Se vedi errori tipo:**
- `ERR_CONNECTION_REFUSED` → Il server non è avviato
- `CORS error` → Problema di configurazione (non dovrebbe succedere)
- `ERR_NETWORK` → Problema di rete/firewall

#### 2. Verifica i log del server

Nel terminale dove hai avviato `node seo-web-server.js`, dovresti vedere:

```
🚀 Esecuzione: node /path/to/seo-cli.js https://... -p 5 -f html
✅ Child process creato, PID: 12345
🎉 Child process spawned successfully
📤 stdout: 🚀 SEO Checker CLI
📤 stdout: ========================================
...
🔚 Child process closed with code: 0
```

**Se vedi:**
- `⚠️  Client disconnesso, termino il processo child` → Il browser chiude la connessione troppo presto
- `❌ Child process error:` → Problema con seo-cli.js
- Nessun messaggio `📤 stdout:` → Il processo non genera output

#### 3. Test manuale del comando

Prova a eseguire il comando SEO manualmente:

```bash
node seo-cli.js https://example.com -p 1 -f html --headless --no-profile
```

**Dovresti vedere:**
- Output del SEO checker
- Report generato

**Se non funziona:**
- Controlla che `seo-cli.js` esista
- Verifica le dipendenze (`npm install`)
- Controlla Playwright (`npx playwright install`)

#### 4. Test con curl

Testa l'API direttamente:

```bash
./test-stream.sh
```

O manualmente:

```bash
curl -N -X POST http://localhost:3000/api/run-seo \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","pages":1,"crawl":false,"format":"html","headless":true,"noProfile":true}' \
  --max-time 120
```

**Dovresti vedere:**
```
data: {"type":"stdout","message":"🔗 Connessione stabilita..."}
data: {"type":"stdout","message":"🚀 SEO Checker CLI..."}
...
data: {"type":"close","code":0,"message":"Processo terminato"}
```

## 🔍 Problemi Comuni

### Problema: Browser disconnette immediatamente

**Sintomo:** Nei log del server vedi subito "Client disconnesso"

**Cause possibili:**
1. **Tab chiusa/cambiata** → Mantieni la tab aperta
2. **Browser timeout** → Alcuni browser chiudono connessioni idle
3. **Proxy/VPN** → Disattiva temporaneamente

**Soluzione:**
- Usa Chrome o Firefox (testati)
- Non cambiare tab mentre il processo è in esecuzione
- Controlla le impostazioni di rete del browser

### Problema: Processo child termina con signal SIGTERM

**Sintomo:** `Child process exited with code: null, signal: SIGTERM`

**Causa:** Il client HTTP disconnette prima del completamento

**Soluzione:**
- Il server ora include keep-alive ping
- Assicurati che il browser riceva il messaggio iniziale
- Controlla la console del browser per errori JavaScript

### Problema: Nessun output stdout

**Sintomo:** Il processo parte ma non vedi log

**Cause possibili:**
1. `seo-cli.js` non stampa su stdout
2. Buffering dell'output
3. Errore nel processo child

**Debug:**
```bash
# Test diretto
node seo-cli.js https://example.com -p 1 -f html --headless --no-profile

# Con log dettagliato
NODE_DEBUG=child_process node seo-web-server.js
```

### Problema: Porta 3000 già in uso

**Sintomo:** `EADDRINUSE: address already in use`

**Soluzione automatica:**
Il server proverà porte 3001-3010 automaticamente

**Soluzione manuale:**
```bash
# Kill il processo sulla porta 3000
lsof -ti:3000 | xargs kill -9

# O usa un'altra porta modificando il server
```

## 🧪 Test Step-by-Step

### Test 1: Server Risponde

```bash
curl -s http://localhost:3000/ | head -5
```

**Atteso:** Dovresti vedere HTML

### Test 2: API Profili

```bash
curl -s http://localhost:3000/api/chrome-profiles | jq
```

**Atteso:** Array JSON con profili Chrome

### Test 3: Streaming SSE

```bash
curl -N -X POST http://localhost:3000/api/run-seo \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","pages":1,"headless":true,"noProfile":true,"format":"html"}' \
  --max-time 60
```

**Atteso:** Stream di messaggi `data: {...}`

## 📞 Supporto

Se dopo questi test il problema persiste:

1. Raccogli i log:
   - Console browser (F12 → Console)
   - Output del server (terminale)
   - Test curl output

2. Controlla:
   - Versione Node.js: `node --version` (richiede >= 14)
   - Playwright installato: `npx playwright --version`
   - File presenti: `ls -la seo-*.js`

3. Prova il SEO checker da CLI:
   ```bash
   node seo-cli.js https://example.com -p 1 -f html --headless --no-profile
   ```

---

**File modificati durante troubleshooting tracciati:**
- `seo-web-server.js`
- `seo-web-ui.html`
