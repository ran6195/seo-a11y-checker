#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const url = require('url');

let PORT = 3000;

// Server HTTP
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers per permettere richieste dalla pagina
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Gestione OPTIONS per CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Servi la pagina HTML principale
  if (pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'seo-web-ui.html');

    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Errore caricamento pagina');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // API: Esegui controllo SEO
  if (pathname === '/api/run-seo' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const params = JSON.parse(body);
        runSEOCheck(params, res, req);
      } catch (error) {
        // Scrivi header solo se non sono già stati inviati
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parametri non validi' }));
        }
      }
    });
    return;
  }

  // API: Ottieni profili Chrome disponibili
  if (pathname === '/api/chrome-profiles' && req.method === 'GET') {
    const profiles = getChromeProfiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profiles));
    return;
  }

  // API: Download report
  if (pathname.startsWith('/api/download/')) {
    const filename = path.basename(pathname.replace('/api/download/', ''));
    const filePath = path.join(__dirname, filename);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';

      if (ext === '.html') contentType = 'text/html';
      else if (ext === '.md') contentType = 'text/markdown';
      else if (ext === '.json') contentType = 'application/json';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      });

      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File non trovato');
    }
    return;
  }

  // 404 per tutte le altre richieste
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Pagina non trovata');
});

// Funzione per ottenere i profili Chrome (come in seo-cli.js)
function getChromeProfiles() {
  const os = require('os');
  const chromeDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const profiles = [];

  try {
    if (!fs.existsSync(chromeDir)) {
      return profiles;
    }

    const items = fs.readdirSync(chromeDir);

    // Aggiungi profilo Default
    if (items.includes('Default')) {
      profiles.push({
        name: 'Default',
        path: path.join(chromeDir, 'Default'),
        displayName: 'Profilo Predefinito'
      });
    }

    // Cerca altri profili
    items.forEach(item => {
      const itemPath = path.join(chromeDir, item);

      try {
        const stat = fs.statSync(itemPath);
        if (!stat.isDirectory()) return;
      } catch (error) {
        return;
      }

      const prefsPath = path.join(itemPath, 'Preferences');
      if (!fs.existsSync(prefsPath)) return;

      if (item === 'Default' ||
          item.includes('Guest') ||
          item.includes('System') ||
          item.startsWith('.')) return;

      let displayName = item;

      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (prefs.profile && prefs.profile.name) {
          displayName = prefs.profile.name;
        }
      } catch (error) {
        // Ignora errori
      }

      profiles.push({
        name: item,
        path: itemPath,
        displayName: displayName
      });
    });

  } catch (error) {
    console.warn('⚠️  Impossibile accedere ai profili Chrome:', error.message);
  }

  return profiles;
}

// Funzione per eseguire il controllo SEO
function runSEOCheck(params, res, req) {
  try {
    const args = [path.join(__dirname, 'seo-cli.js')];

    // Aggiungi URL
    args.push(params.url);

    // Aggiungi opzioni
    if (params.pages && !params.crawl) {
      args.push('-p', params.pages.toString());
    }

    if (params.crawl) {
      args.push('--crawl');
    }

    if (params.format) {
      args.push('-f', params.format);
    }

    if (params.headless) {
      args.push('--headless');
    }

    if (params.noProfile) {
      args.push('--no-profile');
    }

    if (params.profilePath) {
      // Modifica temporaneamente lo script per accettare un path specifico
      // Per ora usiamo una variabile d'ambiente
      process.env.SELECTED_PROFILE_PATH = params.profilePath;
    }

    if (params.output) {
      args.push('-o', params.output);
    }

    console.log('🚀 Esecuzione:', 'node', args.join(' '));

    // Imposta headers per streaming PRIMA di spawn
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disabilita buffering di nginx/proxy
    });

    // Invia messaggio iniziale per confermare la connessione
    res.write(`data: ${JSON.stringify({ type: 'stdout', message: '🔗 Connessione stabilita, avvio processo...\n' })}\n\n`);

    // Esegui il processo con stdio esplicito e env per disabilitare buffering
    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, pipe stdout/stderr
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '0', // Disabilita colori che potrebbero causare problemi
        NODE_NO_WARNINGS: '1'
      }
    });

    console.log('✅ Child process creato, PID:', child.pid);

    // Configura encoding per stdout/stderr
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    // Keep-alive ping ogni 5 secondi per mantenere la connessione aperta
    const keepAliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':ping\n\n'); // Commento SSE (ignorato dal client)
      }
    }, 5000);

    // Stream output al client con buffering per linee
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (data) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // Mantieni l'ultima linea incompleta

      for (const line of lines) {
        if (line.trim()) {
          const message = line + '\n';
          console.log('📤 stdout:', message.substring(0, 100));
          res.write(`data: ${JSON.stringify({ type: 'stdout', message })}\n\n`);
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          const message = line + '\n';
          console.log('📤 stderr:', message.substring(0, 100));
          res.write(`data: ${JSON.stringify({ type: 'stderr', message })}\n\n`);
        }
      }
    });

    child.on('spawn', () => {
      console.log('🎉 Child process spawned successfully');
    });

    let processCompleted = false;

    child.on('exit', (code, signal) => {
      console.log(`🚪 Child process exited with code: ${code}, signal: ${signal}`);
    });

    child.on('close', (code) => {
      console.log(`🔚 Child process closed with code: ${code}`);
      processCompleted = true;
      clearInterval(keepAliveInterval);

      // Flush eventuali buffer rimanenti
      if (stdoutBuffer.trim()) {
        console.log('📤 stdout (flush):', stdoutBuffer.substring(0, 100));
        res.write(`data: ${JSON.stringify({ type: 'stdout', message: stdoutBuffer + '\n' })}\n\n`);
      }
      if (stderrBuffer.trim()) {
        console.log('📤 stderr (flush):', stderrBuffer.substring(0, 100));
        res.write(`data: ${JSON.stringify({ type: 'stderr', message: stderrBuffer + '\n' })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'close', code, message: 'Processo terminato' })}\n\n`);
      res.end();
    });

    child.on('error', (error) => {
      console.log(`❌ Child process error:`, error.message);
      processCompleted = true;
      clearInterval(keepAliveInterval);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    });

    // Chiudi il processo se il client disconnette (solo se il processo non è già terminato)
    req.on('close', () => {
      clearInterval(keepAliveInterval);
      if (!processCompleted && child.exitCode === null) {
        console.log('⚠️  Client disconnesso, termino il processo child');
        child.kill();
      }
    });

  } catch (error) {
    // Se c'è un errore e gli header non sono stati inviati
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
}

// Funzione per avviare il server con gestione porta occupata
function startServer(port) {
  // Rimuovi listener precedenti per evitare leak
  server.removeAllListeners('error');

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Porta ${port} già in uso`);

      const nextPort = port + 1;
      if (nextPort <= 3010) {
        console.log(`🔄 Tentativo con porta ${nextPort}...`);
        PORT = nextPort;
        startServer(nextPort);
      } else {
        console.error('');
        console.error('❌ Impossibile trovare una porta libera (provate 3000-3010)');
        console.error('');
        console.error('💡 Suggerimento: Chiudi il processo sulla porta 3000 con:');
        console.error('   lsof -ti:3000 | xargs kill -9');
        console.error('');
        process.exit(1);
      }
    } else {
      console.error('❌ Errore server:', err);
      process.exit(1);
    }
  });

  server.listen(port, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🌐 SEO Checker Web Interface');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log(`✅ Server avviato su: http://localhost:${port}`);
    console.log('');
    console.log('📋 Per iniziare:');
    console.log(`   1. Apri il browser su http://localhost:${port}`);
    console.log('   2. Inserisci i parametri nel form');
    console.log('   3. Clicca "Avvia Controllo SEO"');
    console.log('');
    console.log('⌨️  Premi Ctrl+C per fermare il server');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  });
}

// Avvia il server
startServer(PORT);

// Gestione chiusura graceful
process.on('SIGINT', () => {
  console.log('\n\n👋 Chiusura server...');
  server.close(() => {
    console.log('✅ Server chiuso correttamente');
    process.exit(0);
  });
});
