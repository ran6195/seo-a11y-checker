const fs = require('fs');
const path = require('path');

// Carica dinamicamente ogni script checks/<sc>.js che rispetta il contratto
// { id, name, level, run(ctx) }. Filtro POSITIVO sul nome file (deve iniziare con un
// numero di criterio, es. "1.2.3-nome.js"), non una lista di esclusioni per nome: gli
// script di supporto in checks/ (run.js, run-site.js, report.js, e qualunque tool
// futuro) non seguono questo pattern e vengono ignorati automaticamente, senza dover
// ricordare di aggiungerli a una lista ogni volta. Importante perché alcuni di questi
// script eseguono codice/CLI al require() (es. report.js chiama main() se lanciato
// direttamente): richiederli per errore qui li farebbe partire con l'argv sbagliato.
function loadChecks(criteriaFilter) {
  const dir = path.join(__dirname, '..');
  return fs.readdirSync(dir)
    .filter(f => /^\d+\.\d+\.\d+-.*\.js$/.test(f))
    .map(f => require(path.join(dir, f)))
    .filter(mod => mod && mod.id && typeof mod.run === 'function')
    .filter(mod => !criteriaFilter || criteriaFilter.includes(mod.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// Esegue in sequenza tutti i check su una pagina già caricata (page + axeResults pronti),
// allegando description/remediation statiche di ogni script al risultato. onProgress,
// se passato, viene chiamato dopo ogni singolo criterio (usato per stampare a console
// sia da run.js che da run-site.js senza duplicare quella logica).
async function runChecksOnPage(checks, ctx, onProgress) {
  const results = [];
  for (const check of checks) {
    let result;
    try {
      result = await check.run(ctx);
      result.description = check.description || '';
      result.remediation = check.remediation || '';
    } catch (err) {
      result = {
        id: check.id, name: check.name, level: check.level,
        description: check.description || '', remediation: check.remediation || '',
        status: 'error',
        automated: { ran: false, summary: null, issues: [] },
        ai: { attempted: false, skippedReason: null, verdict: null, findings: [] },
        notes: err.message
      };
    }
    results.push(result);
    if (onProgress) onProgress(check, result);
  }
  return results;
}

module.exports = { loadChecks, runChecksOnPage };
