const fs = require('fs');
const path = require('path');

// Stesso meccanismo (senza dipendenza dotenv) già usato in a11y-cli.js e
// a11y-from-json.js, puntato allo stesso .env nella root del progetto: una sola
// chiave ANTHROPIC_API_KEY condivisa da tutto il toolkit, non duplicata. Estratto qui
// perché sia checks/run.js che checks/run-site.js ne hanno bisogno.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
          }
        }
      }
    });
  }
}

module.exports = { loadEnvFile };
