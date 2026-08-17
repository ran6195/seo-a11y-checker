// Criteri WCAG 2.1 A/AA delle fasce C (poco automatizzabile) e D (non automatizzabile),
// così come classificati in checks/CRITERI.md dopo l'implementazione delle fasce A e B.
// Usato solo da checks/report.js per il riepilogo "Copertura dei criteri WCAG" nel report:
// tenuto separato dagli script di checks/ perché non è un controllo, solo un elenco statico.
// Se un criterio da qui viene implementato, va rimosso da questa lista e aggiunto come nuovo
// checks/<sc>-<slug>.js (con l'aggiornamento corrispondente in checks/CRITERI.md).

const POCO_AUTOMATIZZABILE = [
  { id: '1.3.1', name: 'Informazioni e relazioni', level: 'A', reason: 'axe copre pezzi (landmark, liste, tabelle), ma il criterio nel complesso — coerenza visiva/semantica — è troppo ampio per un segnale affidabile' },
  { id: '1.3.2', name: 'Sequenza significativa', level: 'A', reason: 'l\'AI potrebbe leggere il testo linearizzato, ma isolare "cosa linearizzare" e giudicare la coerenza è rumoroso' },
  { id: '1.3.3', name: 'Caratteristiche sensoriali', level: 'A', reason: 'serve leggere tutto il testo della pagina cercando riferimenti solo a forma/posizione — alto rischio di falsi positivi' },
  { id: '1.3.4', name: 'Orientamento', level: 'AA', reason: 'test di nicchia (rotazione viewport), raramente vale il costo di costruirlo' },
  { id: '1.4.1', name: 'Uso del colore', level: 'A', reason: 'giudicare se un\'informazione è veicolata solo dal colore richiede confronto screenshot con/senza colore — fattibile ma delicato' },
  { id: '1.4.13', name: 'Contenuto al passaggio del mouse o focus', level: 'AA', reason: 'serve simulare hover reale e valutare dismissible/hoverable/persistente — interazione complessa per un segnale incerto' },
  { id: '2.1.1', name: 'Tastiera', level: 'A', reason: 'il Tab-walk dà una base, ma "ogni funzionalità raggiungibile da tastiera" non è enumerabile automaticamente con confidenza' },
  { id: '2.1.4', name: 'Scorciatoie con caratteri singoli', level: 'A', reason: 'richiede introspezione degli event listener keydown, non ispezionabile dall\'esterno in modo affidabile' },
  { id: '2.4.5', name: 'Vie molteplici', level: 'AA', reason: 'serve crawling multi-pagina + euristiche di navigazione (menu/ricerca/sitemap); fattibile ma complesso, priorità bassa' },
  { id: '2.5.2', name: 'Cancellazione del puntatore', level: 'A', reason: 'testabile (mousedown + move fuori + mouseup) ma di nicchia' },
  { id: '3.2.1', name: 'Al focus', level: 'A', reason: 'before/after DOM diff su ogni elemento è rumoroso: "cambio di contesto" è un concetto ampio' },
  { id: '3.2.2', name: 'In fase di input', level: 'A', reason: 'stesso limite di 3.2.1, applicato agli input' },
  { id: '3.2.3', name: 'Navigazione coerente', level: 'AA', reason: 'richiede crawling multi-pagina e confronto strutturale dei menu tra pagine' },
  { id: '3.2.4', name: 'Identificazione coerente', level: 'AA', reason: 'confronto multi-pagina di componenti ricorrenti, stesso limite di 3.2.3' },
  { id: '3.3.4', name: 'Prevenzione degli errori (legali, finanziari, dati)', level: 'AA', reason: 'capire se una transazione è "critica" e se esiste conferma/reversibilità è troppo contestuale' }
];

const NON_AUTOMATIZZABILE = [
  { id: '1.2.1', name: 'Solo audio e solo video (preregistrato)', level: 'A', reason: 'serve ascoltare/guardare il contenuto reale' },
  { id: '1.2.2', name: 'Sottotitoli (preregistrato)', level: 'A', reason: 'serve ascoltare/guardare il contenuto reale' },
  { id: '1.2.3', name: 'Audiodescrizione o alternativa (preregistrato)', level: 'A', reason: 'serve ascoltare/guardare il contenuto reale' },
  { id: '1.2.4', name: 'Sottotitoli (diretta)', level: 'AA', reason: 'serve ascoltare/guardare il contenuto reale, in più in tempo reale' },
  { id: '1.2.5', name: 'Audiodescrizione (preregistrato)', level: 'AA', reason: 'serve ascoltare/guardare il contenuto reale' },
  { id: '2.2.1', name: 'Regolazione della tempistica', level: 'A', reason: 'serve capire se esiste un timeout e testarne la regolabilità nel tempo reale' },
  { id: '2.3.1', name: 'Tre lampeggi o soglia inferiore', level: 'A', reason: 'serve analisi frame-by-frame di contenuto animato/video' },
  { id: '2.5.1', name: 'Gesti del puntatore', level: 'A', reason: 'serve un device touch reale o emulazione multi-touch complessa' },
  { id: '2.5.4', name: 'Attivazione mediante movimento', level: 'A', reason: 'serve un device con sensori di movimento reali' }
];

// WCAG 2.2 aggiunge 6 criteri A/AA rispetto ai 50 della WCAG 2.1 (più tre di livello AAA,
// fuori dall'ambito A/AA di questa suite, non elencati qui): 2.5.8 e 2.4.11 sono già
// implementati (checks/2.5.8-dimensione-target.js, checks/2.4.11-focus-non-oscurato.js),
// questi sono i 4 rimasti fuori.
const WCAG22_NON_IMPLEMENTATI = [
  { id: '2.5.7', name: 'Movimenti di trascinamento', level: 'AA', reason: 'richiede riconoscere se un\'interazione è implementata via drag (mousedown+move) e se esiste un\'alternativa a singolo tocco — gli event listener non sono ispezionabili dall\'esterno in modo affidabile, stesso limite di 2.1.4' },
  { id: '3.2.6', name: 'Assistenza coerente', level: 'A', reason: 'richiede confronto multi-pagina della posizione dei meccanismi di aiuto (contatti, chat, FAQ) — stesso limite di 3.2.3/3.2.4, serve crawling e confronto strutturale tra pagine' },
  { id: '3.3.7', name: 'Ridondanza delle informazioni', level: 'A', reason: 'richiede seguire un intero flusso multi-step (es. un checkout) e confrontare semanticamente i campi richiesti in step diversi — troppo specifico per sito e per processo per un controllo generico' },
  { id: '3.3.8', name: 'Autenticazione accessibile (minimo)', level: 'AA', reason: 'richiede accedere a un flusso di login reale e giudicare se il meccanismo (es. CAPTCHA, domande di sicurezza) ha un\'alternativa senza funzione cognitiva — fuori portata di una scansione pubblica non autenticata' }
];

module.exports = { POCO_AUTOMATIZZABILE, NON_AUTOMATIZZABILE, WCAG22_NON_IMPLEMENTATI };
