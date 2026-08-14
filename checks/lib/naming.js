// Stessa granularità del timestamp già usata in a11y-checker.js (YYYYMMDD_HHMM, senza
// secondi). In run-site.js questo non serve più a "raggruppare per fortuna" più pagine
// nello stesso minuto (la cartella ora si calcola una sola volta per l'intero run), ma
// resta comunque il formato leggibile e coerente col resto del progetto.
function buildTimestamp(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

function slugifyDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch (e) {
    return 'sito';
  }
}

function slugifyPage(url) {
  try {
    const trimmed = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
    return trimmed ? trimmed.replace(/[^a-z0-9]+/gi, '_').toLowerCase() : 'home';
  } catch (e) {
    return 'pagina';
  }
}

module.exports = { buildTimestamp, slugifyDomain, slugifyPage };
