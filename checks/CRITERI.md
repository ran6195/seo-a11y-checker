# Criteri WCAG 2.1 A/AA — classificazione per automatizzabilità

Elenco di riferimento dei 50 criteri A/AA, divisi in quattro fasce in base a quanto ha senso automatizzarli con l'approccio di questa suite (`checks/`): controllo deterministico (axe-core o calcolo diretto) + fallback AI opzionale solo sui casi ambigui. Aggiornato il 14/08/2026, dopo aver implementato tutti i 26 criteri delle fasce A e B — le fasce riflettono quello che abbiamo effettivamente imparato costruendoli, non solo una stima a tavolino.

- **A — Automatico**: la parte deterministica (axe-core, o un calcolo che facciamo noi come per il contrasto) copre già la maggioranza dei casi reali; l'AI serve solo per un'eccezione minoritaria.
- **B — L'AI ha senso**: axe-core copre poco o nulla, ma un'euristica gratuita isola bene i candidati sospetti e un giudizio AI (visivo o testuale) su quei candidati aggiunge valore reale — è il pattern che abbiamo usato per tutti e 12 i criteri implementati finora.
- **C — Poco automatizzabile**: si potrebbe costruire qualcosa, ma il segnale automatico sarebbe debole, rumoroso, o richiederebbe un'interazione troppo specifica/costosa per il valore che dà. Verifica manuale resta la via principale.
- **D — Non automatizzabile**: richiede un umano, contenuto reale (audio/video), o il passare del tempo reale. Nessuno script ha senso qui, nemmeno con AI.

`✅` = già implementato in `checks/`.

**Totali**: A = 5 (5 fatti) · B = 21 (21 fatti) · C = 15 · D = 9

**Nota WCAG 2.2**: questo elenco copre solo i 50 criteri A/AA della WCAG 2.1. La WCAG 2.2 aggiunge 6 criteri A/AA rispetto alla 2.1 (più tre di livello AAA, fuori dall'ambito di questa suite, non elencati). Di questi 6, **2.5.8 Dimensione target (minimo)** è già implementato (`checks/2.5.8-dimensione-target.js`) — è l'unica regola che axe-core aggiunge sotto il tag `wcag22aa`, controllo puramente geometrico senza AI. I rimanenti 5 non sono ancora coperti:

| SC | Criterio | Liv. | Nota |
|---|---|---|---|
| 2.4.11 | Focus non oscurato (minimo) | AA | riuserebbe il Tab-walk già costruito per 2.4.7/2.1.2/2.4.3 con un controllo `document.elementFromPoint()` per rilevare se l'elemento a fuoco è coperto da un banner/header sticky — deterministico, candidato naturale per una prossima iterazione, non un vero limite tecnico |
| 2.5.7 | Movimenti di trascinamento | AA | richiede riconoscere se un'interazione è implementata via drag (mousedown+move) e se esiste un'alternativa a singolo tocco — gli event listener non sono ispezionabili dall'esterno in modo affidabile, stesso limite di 2.1.4 |
| 3.2.6 | Assistenza coerente | A | richiede confronto multi-pagina della posizione dei meccanismi di aiuto (contatti, chat, FAQ) — stesso limite di 3.2.3/3.2.4, serve crawling e confronto strutturale tra pagine |
| 3.3.7 | Ridondanza delle informazioni | A | richiede seguire un intero flusso multi-step (es. un checkout) e confrontare semanticamente i campi richiesti in step diversi — troppo specifico per sito e per processo per un controllo generico |
| 3.3.8 | Autenticazione accessibile (minimo) | AA | richiede accedere a un flusso di login reale e giudicare se il meccanismo (es. CAPTCHA, domande di sicurezza) ha un'alternativa senza funzione cognitiva — fuori portata di una scansione pubblica non autenticata |

A differenza delle fasce C/D sopra, qui la difficoltà non è uniforme: 2.4.11 è un candidato realistico per una prossima iterazione (stessa infrastruttura già in uso), gli altri quattro hanno gli stessi limiti strutturali già visti in altri criteri WCAG 2.1.

---

## A — Automatico (5)

| SC | Criterio | Liv. | Nota |
|---|---|---|---|
| 1.4.3 ✅ | Contrasto (minimo) | AA | axe calcola il contrasto testo/sfondo in modo affidabile sulla maggioranza dei casi statici |
| 1.4.11 ✅ | Contrasto non testuale | AA | calcoliamo noi il rapporto di contrasto (bordo/sfondo) con la stessa formula WCAG; AI solo su colori non risolvibili (gradienti, trasparenze) |
| 2.4.1 ✅ | Bypass dei blocchi | A | verifica funzionale: clicchiamo davvero lo skip link e controlliamo se il focus si sposta — 100% deterministico |
| 3.1.1 ✅ | Lingua della pagina | A | axe copre l'attributo mancante/non valido; l'euristica su parole comuni it/en risolve la maggior parte dei mismatch senza AI |
| 4.1.1 ✅ | Analisi del contenuto (parsing) | A | axe copre bene id duplicati e markup non valido; puramente sintattico, l'AI non avrebbe nulla da giudicare |

## B — L'AI ha senso (21)

| SC | Criterio | Liv. | Nota |
|---|---|---|---|
| 1.1.1 ✅ | Contenuto non testuale | A | axe vede solo alt mancante/vuoto; la qualità del testo alternativo (il problema più comune) serve l'AI vision |
| 1.3.5 ✅ | Identificare lo scopo dell'input | AA | axe ha `autocomplete-valid`; giudicare se il valore è quello semanticamente corretto per il campo serve l'AI |
| 1.4.2 ✅ | Controllo del sonoro | A | euristica su `<audio>/<video autoplay>` isola i candidati; l'AI verifica se esiste un controllo utilizzabile |
| 1.4.4 ✅ | Ridimensionamento del testo | AA | zoom al 200% via viewport + screenshot; l'AI giudica troncamenti/sovrapposizioni |
| 1.4.5 ✅ | Immagini di testo | AA | screenshot delle immagini candidate; l'AI riconosce testo renderizzato in un'immagine |
| 1.4.10 ✅ | Reflow | AA | overflow orizzontale a 320px è calcolabile (scrollWidth), ma capire se è un problema reale o contenuto volutamente scrollabile serve giudizio |
| 1.4.12 ✅ | Spaziatura del testo | AA | CSS iniettato per forzare la spaziatura richiesta + screenshot; l'AI giudica se il layout si rompe |
| 2.1.2 ✅ | Nessuna trappola per la tastiera | A | estensione del Tab-walk già costruito per 2.4.7: rilevabile per lo più deterministicamente (Tab/Shift+Tab/Escape restano intrappolati in un sottoinsieme), ma quando il ciclo contiene un bottone azionabile (es. un banner cookie) serve l'AI per distinguere un modale legittimo da una vera trappola |
| 2.2.2 ✅ | Pausa, stop, nascondi | A | euristica su animazioni/carousel in autoplay; l'AI verifica se il controllo di pausa è presente e funzionale |
| 2.4.2 ✅ | Titolo della pagina | A | axe vede solo il titolo assente; la qualità/specificità del titolo serve l'AI |
| 2.4.3 ✅ | Ordine del focus | A | estensione del Tab-walk: confronto tra ordine di tabulazione e ordine visivo/DOM, l'AI giudica le anomalie |
| 2.4.4 ✅ | Scopo del link (dal contesto) | A | quasi zero copertura axe; euristica su testo generico/duplicato + AI per il giudizio contestuale |
| 2.4.6 ✅ | Intestazioni ed etichette | AA | axe vede solo intestazioni vuote; se descrivono davvero la sezione serve l'AI |
| 2.4.7 ✅ | Focus visibile | AA | Tab reale rileva la presenza dell'indicatore; la sua visibilità reale (contrasto, spessore) serve l'AI |
| 2.5.3 ✅ | Etichetta nel nome | A | confronto testo visibile vs nome accessibile è rilevabile via DOM; l'AI per i casi limite (nomi parzialmente sovrapposti) |
| 3.1.2 ✅ | Lingua di parti componenti | AA | stessa euristica/AI di 3.1.1 applicata a blocchi di testo, per trovare porzioni senza `lang` locale coerente |
| 3.3.1 ✅ | Identificazione dell'errore | A | zero copertura axe; costruito interamente da noi (blur su valore invalido), AI sui casi visivamente ambigui |
| 3.3.2 ✅ | Etichette o istruzioni | A | axe vede solo l'assenza di label; etichette generiche e obbligatorietà non comunicata (il problema più comune) servono l'AI |
| 3.3.3 ✅ | Suggerimento in caso di errore | AA | estensione naturale di 3.3.1: catturiamo già il testo d'errore, l'AI giudica se è anche un suggerimento utile o solo un'identificazione |
| 4.1.2 ✅ | Nome, ruolo, valore | A | axe copre bene i casi standard; bottoni icona-solo/nomi generici (il problema più comune in pratica) servono l'AI |
| 4.1.3 ✅ | Messaggi di stato | AA | verificabile solo entro i limiti di un'interazione sicura (blur su form, non un submit reale): se non reagisce, l'AI valuta solo la plausibilità strutturale della live region, non una conferma funzionale — verifica manuale resta consigliata |

## C — Poco automatizzabile (15)

| SC | Criterio | Liv. | Nota |
|---|---|---|---|
| 1.3.1 | Informazioni e relazioni | A | axe copre pezzi (landmark, liste, tabelle), ma il criterio nel complesso — coerenza visiva/semantica — è troppo ampio per un segnale affidabile |
| 1.3.2 | Sequenza significativa | A | l'AI potrebbe leggere il testo linearizzato, ma isolare "cosa linearizzare" e giudicare la coerenza è rumoroso |
| 1.3.3 | Caratteristiche sensoriali | A | serve leggere tutto il testo della pagina cercando riferimenti solo a forma/posizione — alto rischio di falsi positivi |
| 1.3.4 | Orientamento | AA | test di nicchia (rotazione viewport), raramente vale il costo di costruirlo |
| 1.4.1 | Uso del colore | A | giudicare se un'informazione è veicolata *solo* dal colore richiede confronto screenshot con/senza colore — fattibile ma delicato |
| 1.4.13 | Contenuto al passaggio del mouse o focus | AA | serve simulare hover reale e valutare dismissible/hoverable/persistente — interazione complessa per un segnale incerto |
| 2.1.1 | Tastiera | A | il Tab-walk dà una base, ma "ogni funzionalità raggiungibile da tastiera" non è enumerabile automaticamente con confidenza |
| 2.1.4 | Scorciatoie con caratteri singoli | A | richiede introspezione degli event listener keydown, non ispezionabile dall'esterno in modo affidabile |
| 2.4.5 | Vie molteplici | AA | serve crawling multi-pagina + euristiche di navigazione (menu/ricerca/sitemap); fattibile ma complesso, priorità bassa |
| 2.5.2 | Cancellazione del puntatore | A | testabile (mousedown + move fuori + mouseup) ma di nicchia |
| 3.2.1 | Al focus | A | before/after DOM diff su ogni elemento è rumoroso: "cambio di contesto" è un concetto ampio |
| 3.2.2 | In fase di input | A | stesso limite di 3.2.1, applicato agli input |
| 3.2.3 | Navigazione coerente | AA | richiede crawling multi-pagina e confronto strutturale dei menu tra pagine |
| 3.2.4 | Identificazione coerente | AA | confronto multi-pagina di componenti ricorrenti, stesso limite di 3.2.3 |
| 3.3.4 | Prevenzione degli errori (legali, finanziari, dati) | AA | capire se una transazione è "critica" e se esiste conferma/reversibilità è troppo contestuale |

## D — Non automatizzabile (9)

| SC | Criterio | Liv. | Nota |
|---|---|---|---|
| 1.2.1 | Solo audio e solo video (preregistrato) | A | serve ascoltare/guardare il contenuto reale |
| 1.2.2 | Sottotitoli (preregistrato) | A | idem |
| 1.2.3 | Audiodescrizione o alternativa (preregistrato) | A | idem |
| 1.2.4 | Sottotitoli (diretta) | AA | idem, in più in tempo reale |
| 1.2.5 | Audiodescrizione (preregistrato) | AA | idem |
| 2.2.1 | Regolazione della tempistica | A | serve capire se esiste un timeout e testarne la regolabilità nel tempo reale |
| 2.3.1 | Tre lampeggi o soglia inferiore | A | serve analisi frame-by-frame di contenuto animato/video |
| 2.5.1 | Gesti del puntatore | A | serve un device touch reale o emulazione multi-touch complessa |
| 2.5.4 | Attivazione mediante movimento | A | serve un device con sensori di movimento reali |

---

## Prossimi candidati

Le fasce A e B sono complete (26/26 criteri implementati al 14/08/2026). Guardando la fascia C, i candidati più ragionevoli da esplorare dopo — quelli con il segnale automatico meno rumoroso tra i "poco automatizzabili":

- **2.4.11** (focus non oscurato, WCAG 2.2 AA) riusa il Tab-walk già costruito per 2.4.7/2.1.2/2.4.3 con un controllo `elementFromPoint()` — probabilmente il più veloce da aggiungere di tutti, essendo pura infrastruttura già esistente.
- **2.5.2** (cancellazione del puntatore) è interamente meccanico (mousedown + move fuori + mouseup) e non richiede alcun giudizio semantico: probabilmente il più vicino a una fascia B tra quelli della WCAG 2.1 rimasti.
- **1.4.1** (uso del colore) è fattibile con un confronto screenshot a colori vs. desaturato, sulla falsariga di 1.4.4/1.4.12 (stessa tecnica di cattura, giudizio AI diverso).
- **2.4.5** (vie molteplici) e **3.2.3/3.2.4** (coerenza tra pagine) richiederebbero di estendere l'orchestratore multi-pagina (`checks/run-site.js`) per confrontare risultati tra le pagine di uno stesso run, non solo aggregarli come fa oggi `checks/report.js` — cambio architetturale più corposo rispetto ai criteri per singola pagina fatti finora.
