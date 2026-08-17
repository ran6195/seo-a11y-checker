#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { loadChecks } = require('./lib/runner');
const { POCO_AUTOMATIZZABILE, NON_AUTOMATIZZABILE } = require('./lib/not-implemented');

const STATUS_ICON = {
  pass: '✅',
  fail: '❌',
  'needs-review': '⚠️',
  'not-applicable': '➖',
  error: '💥'
};

function printHelp() {
  console.log(`
Uso: node checks/report.js <cartella-run-o-slug-sito> [opzioni]

Legge tutti i JSON prodotti da checks/run-site.js (o checks/run.js) in una
cartella-run e genera un report HTML aggregato: matrice criteri × pagine,
problemi sistemici (falliti ovunque siano applicabili) e dettaglio per pagina.

Argomento:
  Un percorso di cartella esatto (es. checks/output/lesepidado_it_20260814_2101),
  oppure solo lo slug del sito (es. lesepidado_it): in questo caso viene usato
  il run più recente trovato in checks/output/<slug>_*.

Opzioni:
  -o, --output <file>   Percorso del report HTML (default: <cartella-run>/report.html).
  --help                Mostra questo messaggio.

Per il PDF, dopo aver generato l'HTML:
  node html-to-pdf.js <report.html>

Esempi:
  node checks/report.js checks/output/lesepidado_it_20260814_2101
  node checks/report.js lesepidado_it
`);
}

function parseArgs(argv) {
  const options = { input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') options.output = argv[++i];
    else if (arg === '--help') { printHelp(); process.exit(0); }
    else if (!options.input) options.input = arg;
  }
  return options;
}

// Se l'argomento è una cartella esistente, usala direttamente (un run preciso).
// Altrimenti trattalo come slug di sito e prendi il run più recente disponibile
// (i nomi <slug>_YYYYMMDD_HHMM ordinano correttamente per data in ordine alfabetico).
function resolveRunFolder(input) {
  const outputRoot = path.join(__dirname, 'output');
  const asPath = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) {
    return asPath;
  }

  if (!fs.existsSync(outputRoot)) return null;
  const candidates = fs.readdirSync(outputRoot)
    .filter(d => d === input || d.startsWith(`${input}_`))
    .filter(d => fs.statSync(path.join(outputRoot, d)).isDirectory())
    .sort();
  if (candidates.length === 0) return null;
  return path.join(outputRoot, candidates[candidates.length - 1]);
}

function loadPages(runFolder) {
  return fs.readdirSync(runFolder)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(runFolder, f), 'utf8'));
      return { slug: f.replace(/\.json$/, ''), data };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function aggregate(pages) {
  const criteriaMap = new Map();
  pages.forEach(p => {
    p.data.results.forEach(r => {
      if (!criteriaMap.has(r.id)) {
        criteriaMap.set(r.id, { id: r.id, name: r.name, level: r.level, description: r.description, remediation: r.remediation });
      }
    });
  });
  const criteria = Array.from(criteriaMap.values()).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const matrix = criteria.map(c => ({
    ...c,
    byPage: pages.map(p => p.data.results.find(r => r.id === c.id) || null)
  }));

  const counts = { pass: 0, fail: 0, 'needs-review': 0, 'not-applicable': 0, error: 0 };
  matrix.forEach(row => row.byPage.forEach(r => { if (r) counts[r.status] = (counts[r.status] || 0) + 1; }));

  // "Sistemico": fallisce su TUTTE le pagine dove è applicabile, e lo è su almeno 2
  // pagine (altrimenti "sistemico" non significa nulla). Segnale che vale la pena
  // sistemare una volta sola nel tema/template condiviso, non pagina per pagina.
  const systemic = matrix
    .map(row => {
      const applicable = row.byPage.filter(r => r && r.status !== 'not-applicable' && r.status !== 'error');
      const failing = applicable.filter(r => r.status === 'fail');
      return { row, applicable, failing };
    })
    .filter(({ applicable, failing }) => applicable.length >= 2 && failing.length === applicable.length)
    .map(({ row }) => row);

  return { criteria, matrix, counts, systemic };
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pageLabel(page) {
  try {
    const u = new URL(page.data.url);
    const p = u.pathname.replace(/\/+$/, '');
    return p ? p : '/';
  } catch (e) {
    return page.slug;
  }
}

function collectSuggestions(result) {
  const fromAi = ((result.ai && result.ai.findings) || []).map(f => f.suggerimento).filter(Boolean);
  if (fromAi.length > 0) return fromAi.slice(0, 3);
  return result.remediation ? [result.remediation] : [];
}

// Ogni script di checks/ struttura i propri automated.issues[] con campi diversi a seconda
// del criterio (name, visibleText, alt, kind, role/ariaLive, da/a...): non esiste un unico
// campo "descrizione" comune a tutti. Questa funzione prova, in ordine di preferenza, i campi
// testuali più informativi, e solo se nessuno è disponibile ripiega su un'etichetta sintetica
// da tag/tipo — il selettore temporaneo (es. [data-a11y-field-id="0"], rimosso dal DOM a fine
// controllo) resta l'ultimissima risorsa, non il caso comune.
function issueLabel(i) {
  if (i.da && i.a) return `${i.da} → ${i.a}`; // 2.4.3: salto nell'ordine del focus
  const primary = i.text || i.title || i.label || i.name || i.visibleText || i.accessibleName ||
    i.alt || i.errorText || i.kind || i.html || i.lang;
  if (primary) return primary;
  if (i.role || i.ariaLive) return `role="${i.role || '?'}" aria-live="${i.ariaLive || '?'}"`;
  if (i.tag) {
    const extra = i.type ? ` [${i.type}]` : (i.width ? ` (${i.width}px)` : '');
    return `<${i.tag}>${extra} — nessun testo disponibile`;
  }
  return i.selector || '';
}

// I primi 4 restano sempre visibili; il resto va dentro un <details> nativo (niente
// JS): a schermo è compatto e cliccabile, in PDF html-to-pdf.js forza tutti i
// <details> aperti prima di stampare, quindi in stampa è comunque tutto visibile.
function renderIssues(issues) {
  if (!issues || issues.length === 0) return '';
  const shown = issues.slice(0, 4);
  const rest = issues.slice(4);
  const shownItems = shown.map(i => `<li>${esc(issueLabel(i)).slice(0, 140)}</li>`).join('');
  if (rest.length === 0) {
    return `<ul class="issue-list">${shownItems}</ul>`;
  }
  const restItems = rest.map(i => `<li>${esc(issueLabel(i)).slice(0, 140)}</li>`).join('');
  return `<ul class="issue-list">${shownItems}</ul><details class="more-details"><summary>+ ${rest.length} altri</summary><ul class="issue-list">${restItems}</ul></details>`;
}

function renderPageDetail(page) {
  const actionable = page.data.results.filter(r => r.status === 'fail' || r.status === 'needs-review' || r.status === 'error');
  const clean = page.data.results.filter(r => r.status === 'pass' || r.status === 'not-applicable');

  const cards = actionable.map(r => {
    const suggestions = collectSuggestions(r).map(s => `<div class="fix"><span class="fix-label">Correzione proposta</span>${esc(s)}</div>`).join('');
    return `
    <div class="crit">
      <div class="crit-head"><span class="crit-id">${esc(r.id)}</span><span class="crit-name">${esc(r.name)}</span><span class="lvl">${esc(r.level)}</span><span class="badge ${r.status}">${esc(r.status)}</span></div>
      <p class="crit-desc">${esc(r.description)}</p>
      ${r.automated && r.automated.summary ? `<p class="crit-summary">${esc(r.automated.summary)}</p>` : ''}
      ${renderIssues(r.automated && r.automated.issues)}
      ${r.notes ? `<p class="crit-note">${esc(r.notes)}</p>` : ''}
      ${suggestions}
    </div>`;
  }).join('');

  const cleanList = clean.map(r =>
    `<li><span class="badge ${r.status}">${esc(r.status)}</span> <span class="crit-id">${esc(r.id)}</span> ${esc(r.name)}</li>`
  ).join('');

  return `
  <section class="page-report">
    <div class="page-report-head"><h2>${esc(pageLabel(page))}</h2><span class="page-url">${esc(page.data.url)}</span></div>
    ${cards || '<p class="crit-summary">Nessun criterio in fail/needs-review su questa pagina.</p>'}
    ${cleanList ? `<details class="clean-details"><summary>${clean.length} criteri superati o non applicabili</summary><ul class="clean-list">${cleanList}</ul></details>` : ''}
  </section>`;
}

// Una riga per pagina invece della matrice criteri × pagine: con molte pagine la
// matrice diventa larghissima (una colonna per pagina) e poco leggibile. Il dettaglio
// per singolo criterio resta comunque disponibile nella sezione "Dettaglio per pagina".
function renderPageSummary(pages) {
  const rows = pages.map(p => {
    const counts = { pass: 0, fail: 0, 'needs-review': 0, 'not-applicable': 0, error: 0 };
    p.data.results.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    return `
    <tr>
      <td class="row-page"><span class="page-name">${esc(pageLabel(p))}</span><span class="page-url-small">${esc(p.data.url)}</span></td>
      <td class="count-cell fail">${counts.fail}</td>
      <td class="count-cell pass">${counts.pass}</td>
      <td class="count-cell needs-review">${counts['needs-review']}</td>
      <td class="count-cell na">${counts['not-applicable']}</td>
    </tr>`;
  }).join('');
  return `
  <div class="table-wrap">
    <table class="page-summary">
      <thead><tr><th>Pagina</th><th>❌ Falliti</th><th>✅ Superati</th><th>⚠️ Da rivedere</th><th>➖ N/A</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderSystemic(systemic) {
  if (systemic.length === 0) return '';
  const items = systemic.map(row =>
    `<li><strong>${esc(row.id)}</strong> — ${esc(row.name)}: fallisce su tutte le pagine dove è applicabile. ${esc(row.remediation)}</li>`
  ).join('');
  return `
  <div class="callout">
    <h3>Problemi sistemici</h3>
    <p>Questi criteri falliscono su ogni pagina in cui sono applicabili: probabile problema nel tema o in un componente condiviso, da sistemare una volta sola invece che pagina per pagina.</p>
    <ul>${items}</ul>
  </div>`;
}

// Riepilogo di metodologia, non dei risultati di questo run: quali criteri WCAG questa
// suite copre e come (sempre in automatico, con AI opzionale per i casi ambigui o no), e
// quali restano fuori perché poco o per niente automatizzabili — la stessa classificazione
// di checks/CRITERI.md, qui in forma compatta per chi legge solo il report generato.
function renderCoverage() {
  const implemented = loadChecks(null); // ordinati per id, uno per script in checks/
  const implementedRows = implemented.map(c => `
    <tr>
      <td class="mono">${esc(c.id)}</td>
      <td>${esc(c.name)}</td>
      <td class="count-cell"><span class="lvl">${esc(c.level)}</span></td>
      <td class="count-cell"><span class="method-badge ${c.aiCapable ? 'ai' : 'auto'}">${c.aiCapable ? 'Automatico + AI' : 'Automatico'}</span></td>
    </tr>`).join('');

  const notImplementedList = (items) => items.map(c =>
    `<li><span class="crit-id">${esc(c.id)}</span> <strong>${esc(c.name)}</strong> <span class="lvl">${esc(c.level)}</span> — ${esc(c.reason)}</li>`
  ).join('');

  const aiCount = implemented.filter(c => c.aiCapable).length;
  const totalWcag = implemented.length + POCO_AUTOMATIZZABILE.length + NON_AUTOMATIZZABILE.length;

  return `
  <section class="coverage">
    <h2>Copertura dei criteri WCAG 2.1 A/AA</h2>
    <p class="crit-desc">Questo audit copre ${implemented.length} dei ${totalWcag} criteri A/AA. Ognuno è sempre verificato in automatico (axe-core e/o euristiche); per ${aiCount} è disponibile anche un fallback AI opzionale (Claude) per i casi che il controllo automatico da solo non può giudicare con certezza — mai per confermare un esito già certo.</p>
    <div class="table-wrap">
      <table class="page-summary coverage-table">
        <thead><tr><th>SC</th><th>Criterio</th><th>Liv.</th><th>Metodo</th></tr></thead>
        <tbody>${implementedRows}</tbody>
      </table>
    </div>
    <details class="more-details">
      <summary>${POCO_AUTOMATIZZABILE.length + NON_AUTOMATIZZABILE.length} criteri non ancora implementati</summary>
      <h3>Poco automatizzabile (${POCO_AUTOMATIZZABILE.length})</h3>
      <p class="crit-note">Un controllo si potrebbe costruire, ma il segnale automatico sarebbe debole o rumoroso rispetto al valore che darebbe: per ora verifica manuale.</p>
      <ul class="issue-list not-impl-list">${notImplementedList(POCO_AUTOMATIZZABILE)}</ul>
      <h3>Non automatizzabile (${NON_AUTOMATIZZABILE.length})</h3>
      <p class="crit-note">Richiede un umano, contenuto reale (audio/video) o un dispositivo fisico (touch, sensori di movimento): nessuno script avrebbe senso qui, nemmeno con AI.</p>
      <ul class="issue-list not-impl-list">${notImplementedList(NON_AUTOMATIZZABILE)}</ul>
    </details>
  </section>`;
}

function renderHtml({ site, runFolder, pages, criteria, counts, systemic }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pagesMeta = pages.map(p => `<div class="meta-item"><dt>${esc(pageLabel(p))}</dt><dd>${esc(new Date(p.data.timestamp).toLocaleString('it-IT'))}</dd></div>`).join('');

  return `<title>Audit ${esc(site)}</title>
<style>
  :root {
    --bg: #F3F6F6; --surface: #FFFFFF; --surface-2: #EBF0EF;
    --ink: #142023; --ink-soft: #4E6167; --ink-faint: #7C8C90; --border: #D7E0DF;
    --accent: #2C6E68; --accent-ink: #1E4D49; --accent-bg: #E4F0EE;
    --warn: #96530F; --warn-ink: #7A4308; --warn-bg: #FBF0E2; --warn-border: #E7C99A;
    --info: #3D6B8A; --info-bg: #E8F1F7; --info-border: #BFDAEA;
    --neutral-bg: #EDEFEF; --neutral-ink: #5B6669;
    --error: #B3261E; --error-bg: #FBEAE9; --error-border: #F1C3C0;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0E1517; --surface: #16201F; --surface-2: #1B2725;
      --ink: #E7EEEC; --ink-soft: #9FB3B0; --ink-faint: #728482; --border: #2A3735;
      --accent: #63C2B7; --accent-ink: #8FDCD2; --accent-bg: rgba(99,194,183,0.12);
      --warn: #E3A15C; --warn-ink: #F0BE86; --warn-bg: rgba(227,161,92,0.12); --warn-border: rgba(227,161,92,0.35);
      --info: #7FB2D9; --info-bg: rgba(127,178,217,0.12); --info-border: rgba(127,178,217,0.35);
      --neutral-bg: #212C2A; --neutral-ink: #96A6A3;
      --error: #F2A39D; --error-bg: rgba(242,163,157,0.14); --error-border: rgba(242,163,157,0.35);
    }
  }
  :root[data-theme="dark"] {
    --bg: #0E1517; --surface: #16201F; --surface-2: #1B2725;
    --ink: #E7EEEC; --ink-soft: #9FB3B0; --ink-faint: #728482; --border: #2A3735;
    --accent: #63C2B7; --accent-ink: #8FDCD2; --accent-bg: rgba(99,194,183,0.12);
    --warn: #E3A15C; --warn-ink: #F0BE86; --warn-bg: rgba(227,161,92,0.12); --warn-border: rgba(227,161,92,0.35);
    --info: #7FB2D9; --info-bg: rgba(127,178,217,0.12); --info-border: rgba(127,178,217,0.35);
    --neutral-bg: #212C2A; --neutral-ink: #96A6A3;
    --error: #F2A39D; --error-bg: rgba(242,163,157,0.14); --error-border: rgba(242,163,157,0.35);
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 1rem; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .page { max-width: 960px; margin: 0 auto; padding: 3.5rem 1.5rem 5rem; }
  h1, h2, h3 { font-family: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; font-weight: 600; text-wrap: balance; color: var(--ink); }
  code, .mono { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; }
  .masthead { border-bottom: 1px solid var(--border); padding-bottom: 2rem; margin-bottom: 2rem; }
  .eyebrow { font-size: .72rem; text-transform: uppercase; letter-spacing: .09em; color: var(--accent-ink); font-weight: 600; margin-bottom: .9rem; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.3rem); letter-spacing: -.01em; margin: 0 0 .6rem; }
  .subtitle { color: var(--ink-soft); font-size: 1.02rem; max-width: 62ch; margin: 0 0 1.5rem; }
  .meta-row { display: flex; flex-wrap: wrap; gap: .5rem 1.6rem; font-size: .82rem; color: var(--ink-soft); }
  .meta-row dt { font-weight: 600; color: var(--ink); display: inline; } .meta-row dd { display: inline; margin: 0 0 0 .35em; }
  .meta-item { display: flex; gap: .3em; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin: 1.6rem 0 0; }
  .stat { background: var(--surface); padding: 1rem; }
  .stat .num { font-family: ui-serif, Georgia, serif; font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; display: block; }
  .stat .label { font-size: .75rem; color: var(--ink-soft); margin-top: .15rem; }
  .stat.fail .num { color: var(--warn); } .stat.pass .num { color: var(--accent-ink); }
  section { margin-bottom: 2.6rem; }
  h2 { font-size: 1.3rem; }
  .table-wrap { overflow-x: auto; margin-bottom: 2rem; }
  table.page-summary { width: 100%; border-collapse: collapse; font-size: .88rem; }
  table.page-summary th, table.page-summary td { border: 1px solid var(--border); padding: .55rem .7rem; }
  table.page-summary th { background: var(--surface-2); font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); text-align: left; }
  table.page-summary th:not(:first-child), table.page-summary td.count-cell { text-align: center; width: 1%; white-space: nowrap; }
  .row-page { display: flex; flex-direction: column; gap: .1rem; }
  .page-name { font-weight: 600; }
  .page-url-small { font-size: .76rem; color: var(--ink-faint); font-family: ui-monospace, monospace; }
  .count-cell.fail { color: var(--warn); font-weight: 600; }
  .count-cell.pass { color: var(--accent-ink); font-weight: 600; }
  .count-cell.needs-review { color: var(--info); font-weight: 600; }
  .more-details { margin-top: .3rem; font-size: .82rem; }
  .more-details summary { cursor: pointer; color: var(--ink-faint); padding: .2rem 0; }
  .more-details[open] summary { margin-bottom: .3rem; }
  .callout { background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 4px; padding: 1rem 1.2rem; font-size: .94rem; margin: 0 0 2rem; }
  .callout h3 { font-size: 1rem; margin: 0 0 .5rem; } .callout p { margin: 0 0 .6rem; } .callout ul { margin: .4rem 0 0; padding-left: 1.2rem; } .callout li { margin-bottom: .4rem; }
  .page-report-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: .6rem; margin-bottom: 1.1rem; flex-wrap: wrap; }
  .page-report-head h2 { margin: 0; } .page-url { font-size: .82rem; color: var(--ink-faint); font-family: ui-monospace, monospace; }
  .crit { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); padding: 1rem 1.2rem; margin-bottom: .9rem; }
  .crit-head { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; margin-bottom: .35rem; }
  .crit-id { font-family: ui-monospace, monospace; font-size: .85rem; color: var(--ink-faint); }
  .crit-name { font-weight: 600; font-size: .98rem; }
  .lvl { font-size: .66rem; font-weight: 600; padding: .04rem .38rem; border: 1px solid var(--border); border-radius: 3px; color: var(--ink-soft); font-family: ui-monospace, monospace; }
  .badge { font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: .14rem .5rem; border-radius: 3px; margin-left: auto; white-space: nowrap; }
  .badge.pass { background: var(--accent-bg); color: var(--accent-ink); }
  .badge.fail { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-border); }
  .badge.needs-review { background: var(--info-bg); color: var(--info); border: 1px solid var(--info-border); }
  .badge.error { background: var(--error-bg); color: var(--error); border: 1px solid var(--error-border); }
  .badge.not-applicable { background: var(--neutral-bg); color: var(--neutral-ink); }
  .crit-desc { color: var(--ink-soft); font-size: .88rem; margin: .2rem 0 .6rem; max-width: 68ch; }
  .crit-summary { font-size: .88rem; color: var(--ink); margin: 0 0 .5rem; }
  .crit-note { font-size: .82rem; color: var(--ink-faint); margin: 0 0 .6rem; font-style: italic; }
  .issue-list { list-style: none; margin: 0 0 .7rem; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .issue-list li { font-size: .82rem; color: var(--ink-soft); background: var(--surface-2); border-radius: 3px; padding: .35rem .6rem; }
  .issue-more { font-size: .78rem; color: var(--ink-faint); }
  .fix { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 4px; padding: .6rem .8rem; font-size: .85rem; margin-top: .3rem; }
  .fix-label { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; color: var(--warn-ink); display: block; margin-bottom: .25rem; }
  .clean-details { font-size: .85rem; color: var(--ink-soft); margin-top: .6rem; }
  .clean-details summary { cursor: pointer; padding: .4rem 0; }
  .clean-list { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; }
  .clean-list li { display: flex; align-items: center; gap: .5rem; }
  .method-badge { font-size: .68rem; font-weight: 600; padding: .14rem .5rem; border-radius: 3px; white-space: nowrap; }
  .method-badge.auto { background: var(--neutral-bg); color: var(--neutral-ink); }
  .method-badge.ai { background: var(--info-bg); color: var(--info); border: 1px solid var(--info-border); }
  table.coverage-table td:nth-child(2) { max-width: 32ch; }
  .not-impl-list li { line-height: 1.5; }
  .coverage h3 { font-size: .95rem; margin: 1.1rem 0 .3rem; }
  footer { border-top: 1px solid var(--border); padding-top: 1.5rem; font-size: .82rem; color: var(--ink-soft); }
  footer p { margin: 0 0 .6rem; }
  @media (max-width: 560px) { .stats { grid-template-columns: repeat(2,1fr); } }

  /* Playwright applica il CSS "print" di default quando genera il PDF (html-to-pdf.js
     non chiama emulateMedia('screen')): questo blocco si attiva solo in stampa/PDF,
     mai nella vista a schermo. Font più piccolo e meno spaziatura per stare in più
     pagine leggibili; i <details> sono già forzati aperti da html-to-pdf.js stesso. */
  @media print {
    /* Il PDF non deve ereditare lo sfondo di --bg (tinta chiara o, in dark mode, quasi
       nero): in stampa/PDF vogliamo sempre pagina bianca, indipendentemente dal tema. */
    body { font-size: .82rem; background: #fff; }
    .page { max-width: 100%; padding: 1rem .4rem; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.05rem; }
    .stat .num { font-size: 1.3rem; }
    .crit, table.page-summary, .stats, .callout { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style>

<div class="page">
  <header class="masthead">
    <div class="eyebrow">Report generato da checks/report.js</div>
    <h1>Audit ${esc(site)}</h1>
    <p class="subtitle">${criteria.length} criteri WCAG 2.1 A/AA su ${pages.length} pagine — controllo automatico (axe-core + euristiche) con fallback AI per i casi ambigui.</p>
    <dl class="meta-row">${pagesMeta}</dl>
    <div class="stats">
      <div class="stat fail"><span class="num">${counts.fail}</span><span class="label">falliti</span></div>
      <div class="stat pass"><span class="num">${counts.pass}</span><span class="label">superati</span></div>
      <div class="stat"><span class="num">${counts['needs-review']}</span><span class="label">da rivedere</span></div>
      <div class="stat"><span class="num">${total}</span><span class="label">controlli totali (${criteria.length} × ${pages.length})</span></div>
    </div>
  </header>

  ${renderSystemic(systemic)}

  <section>
    <h2>Riepilogo per pagina</h2>
    ${renderPageSummary(pages)}
  </section>

  <section>
    <h2>Dettaglio per pagina</h2>
    ${pages.map(renderPageDetail).join('')}
  </section>

  ${renderCoverage()}

  <footer>
    <p><strong>Metodologia</strong>: axe-core per i fallimenti strutturali certi, euristiche su markup/testo per isolare i candidati ambigui, fallback Claude Haiku 4.5 per i casi che richiedono giudizio semantico o visivo. I verdetti AI sono un segnale assistivo, da rileggere prima di considerarli conclusivi.</p>
    <p>Cartella-run sorgente: <code>${esc(runFolder)}</code></p>
  </footer>
</div>
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input) {
    printHelp();
    process.exit(1);
  }

  const runFolder = resolveRunFolder(options.input);
  if (!runFolder) {
    console.error(`❌ Nessuna cartella trovata per "${options.input}" (né come percorso esatto, né come slug di sito in checks/output/)`);
    process.exit(1);
  }

  const pages = loadPages(runFolder);
  if (pages.length === 0) {
    console.error(`❌ Nessun file JSON trovato in ${runFolder}`);
    process.exit(1);
  }

  const folderSlug = path.basename(runFolder).replace(/_\d{8}_\d{4}$/, '');
  let site = folderSlug;
  try {
    site = new URL(pages[0].data.url).hostname.replace(/^www\./, '');
  } catch (e) { /* mantieni lo slug come fallback */ }
  const { criteria, matrix, counts, systemic } = aggregate(pages);

  console.log(`\n📊 ${pages.length} pagine, ${criteria.length} criteri, cartella-run: ${runFolder}`);
  console.log(`   ❌ ${counts.fail} fail  ✅ ${counts.pass} pass  ⚠️ ${counts['needs-review']} needs-review  ➖ ${counts['not-applicable']} n/a`);
  if (systemic.length > 0) {
    console.log(`\n⚠️  Problemi sistemici (falliscono su tutte le pagine applicabili): ${systemic.map(r => r.id).join(', ')}`);
  }

  const html = renderHtml({ site, runFolder, pages, criteria, counts, systemic });
  const outputPath = options.output || path.join(runFolder, 'report.html');
  fs.writeFileSync(outputPath, html);
  console.log(`\n💾 Report HTML salvato in ${outputPath}`);
  console.log(`   Per il PDF: node html-to-pdf.js ${outputPath}`);
}

if (require.main === module) {
  main();
}
