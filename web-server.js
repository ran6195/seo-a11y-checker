#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const app = express();
let PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Funzione per ottenere i profili Chrome
function getChromeProfiles() {
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

// Funzione per eseguire un controllo (SEO o A11y)
function runCheck(toolType, params, res, req) {
  try {
    const scriptPath = toolType === 'seo'
      ? path.join(__dirname, 'seo-cli.js')
      : path.join(__dirname, 'a11y-cli.js');

    const args = [scriptPath];

    // Aggiungi URL
    args.push(params.url);

    // Aggiungi opzioni comuni
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
      args.push('--profile', params.profilePath);
    }

    if (params.output) {
      args.push('-o', params.output);
    }

    // Opzioni specifiche per A11y (dichiarazione)
    if (toolType === 'a11y') {
      if (params.org) {
        args.push('--org', params.org);
      }
      if (params.email) {
        args.push('--email', params.email);
      }
      if (params.phone) {
        args.push('--phone', params.phone);
      }
      if (params.pubDate) {
        args.push('--pub-date', params.pubDate);
      }
      if (params.cms) {
        args.push('--cms', params.cms);
      }
      if (params.aiKey) {
        args.push('--ai-key', params.aiKey);
      }
    }

    console.log(`🚀 Esecuzione ${toolType.toUpperCase()}:`, 'node', args.join(' '));

    // Imposta headers per streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`data: ${JSON.stringify({ type: 'stdout', message: `🔗 Connessione stabilita, avvio ${toolType.toUpperCase()} checker...\n` })}\n\n`);

    // Esegui il processo
    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
        // Disabilita buffering stdout/stderr
        NODE_OPTIONS: '--no-warnings'
      }
    });

    console.log('✅ Child process creato, PID:', child.pid);

    // Disabilita buffering sui pipe
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.on('spawn', () => {
      console.log('🎉 [SPAWN] Child process spawned successfully');
    });

    // Keep-alive ping
    const keepAliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':ping\n\n');
      }
    }, 5000);

    // Stream output
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (data) => {
      console.log('📤 [STDOUT] Received data:', data.substring(0, 100));
      stdoutBuffer += data;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          const message = line + '\n';
          res.write(`data: ${JSON.stringify({ type: 'stdout', message })}\n\n`);
        }
      }
    });

    child.stderr.on('data', (data) => {
      console.log('📤 [STDERR] Received data:', data.substring(0, 100));
      stderrBuffer += data;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          const message = line + '\n';
          res.write(`data: ${JSON.stringify({ type: 'stderr', message })}\n\n`);
        }
      }
    });

    let processCompleted = false;
    const processStartTime = Date.now();

    child.on('exit', (code, signal) => {
      console.log(`🚪 [EXIT] Child process exited with code: ${code}, signal: ${signal}`);
    });

    child.on('close', (code) => {
      console.log(`🔚 [CLOSE] Child process closed with code: ${code}`);
      processCompleted = true;
      clearInterval(keepAliveInterval);

      // Flush buffer
      if (stdoutBuffer.trim()) {
        console.log('📤 [FLUSH STDOUT]:', stdoutBuffer.substring(0, 100));
        res.write(`data: ${JSON.stringify({ type: 'stdout', message: stdoutBuffer + '\n' })}\n\n`);
      }
      if (stderrBuffer.trim()) {
        console.log('📤 [FLUSH STDERR]:', stderrBuffer.substring(0, 100));
        res.write(`data: ${JSON.stringify({ type: 'stderr', message: stderrBuffer + '\n' })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'close', code, message: 'Processo terminato' })}\n\n`);
      res.end();
    });

    child.on('error', (error) => {
      console.log(`❌ [ERROR] Child process error:`, error.message);
      processCompleted = true;
      clearInterval(keepAliveInterval);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    });

    // Cleanup su disconnessione
    req.on('close', () => {
      const elapsedTime = Date.now() - processStartTime;
      console.log(`⚠️  [REQ CLOSE] Client disconnesso dopo ${elapsedTime}ms`);
      clearInterval(keepAliveInterval);

      // Killa il processo solo se è passato abbastanza tempo (5+ secondi)
      // e il processo non è già completato
      if (!processCompleted && child.exitCode === null && elapsedTime > 5000) {
        console.log('⚠️  Termino il processo child per disconnessione prolungata');
        child.kill();
      } else if (!processCompleted) {
        console.log('ℹ️  Processo continua in background');
      }
    });

  } catch (error) {
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

// Routes

// Serve la pagina principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web-ui.html'));
});

// API: Ottieni profili Chrome
app.get('/api/chrome-profiles', (req, res) => {
  const profiles = getChromeProfiles();
  res.json(profiles);
});

// API: Esegui controllo SEO
app.post('/api/run-seo', (req, res) => {
  runCheck('seo', req.body, res, req);
});

// API: Esegui controllo A11y
app.post('/api/run-a11y', (req, res) => {
  runCheck('a11y', req.body, res, req);
});

// API: Download report
app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, filename);

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.md') contentType = 'text/markdown';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.pdf') contentType = 'application/pdf';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('File non trovato');
  }
});

// API: Lista file dichiarazioni
app.get('/api/list-dichiarazioni', (req, res) => {
  const dichiarazioniDir = path.join(__dirname, 'dichiarazioni');

  if (!fs.existsSync(dichiarazioniDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(dichiarazioniDir)
      .filter(f => f.endsWith('.html') || f.endsWith('.pdf'))
      .map(f => ({
        name: f,
        path: `dichiarazioni/${f}`,
        size: fs.statSync(path.join(dichiarazioniDir, f)).size,
        modified: fs.statSync(path.join(dichiarazioniDir, f)).mtime
      }))
      .sort((a, b) => b.modified - a.modified);

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Funzione per avviare il server con gestione porta occupata
function startServer(port) {
  const server = app.listen(port)
    .on('error', (err) => {
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
    })
    .on('listening', () => {
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('🌐 Web Analysis Toolkit');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      console.log(`✅ Server avviato su: http://localhost:${port}`);
      console.log('');
      console.log('📋 Strumenti disponibili:');
      console.log('   • SEO Checker - Analisi SEO completa');
      console.log('   • Accessibility Checker - Test WCAG 2.1 AA/AAA');
      console.log('');
      console.log('🎯 Per iniziare:');
      console.log(`   1. Apri il browser su http://localhost:${port}`);
      console.log('   2. Seleziona lo strumento desiderato');
      console.log('   3. Configura i parametri');
      console.log('   4. Avvia l\'analisi');
      console.log('');
      console.log('⌨️  Premi Ctrl+C per fermare il server');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    });

  // Gestione chiusura graceful
  process.on('SIGINT', () => {
    console.log('\n\n👋 Chiusura server...');
    server.close(() => {
      console.log('✅ Server chiuso correttamente');
      process.exit(0);
    });
  });
}

// Avvia il server
startServer(PORT);
