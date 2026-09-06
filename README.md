# Bookmark

Gestore di segnalibri **React Native per Android e Android TV**, realizzato secondo `AI_INSTRUCTIONS.md`. Interfaccia italiana landscape, colori scuri con focus azzurro, accenti viola e stelle gialle.

## Funzioni

- Importazione di esportazioni HTML Firefox dal selettore file Android, anche da unità USB esposte dal gestore file.
- Archivio SQLite locale, con SHA-256 dell’URL come chiave primaria. Le reimportazioni aggiungono solo gli URL nuovi e mantengono titolo, prima importazione, visto, rating e visibilità degli URL esistenti.
- Titoli completi a capo, senza ellissi. Le frecce scorrono anche le righe di un titolo più alto dell’area disponibile, prima di passare al successivo.
- Apertura nel browser di sistema o in un browser scelto per questa app. Il segnalibro viene segnato come visto dopo l’avvio riuscito del browser.
- Menu contestuale con visto/non visto, valutazione 1–5, nascondi/riattiva e apertura nel browser.
- Un’unica appbar con importazione, ordine alfabetico crescente, prima importazione decrescente, rating decrescente, filtro tutti/da vedere/già visti, testo da 20 a 38 dp, inclusione dei nascosti, browser, Log, versione e conteggio dei segnalibri visualizzati. Tutto lo spazio sottostante è dedicato all’elenco, senza intestazioni, barra laterale o piè di pagina.
- Impostazioni salvate localmente, elenco virtualizzato e supporto a telecomando, tastiera e touch.

I segnalibri nuovi partono come **non visti e non valutati**. Le stelle vuote indicano l’assenza di una valutazione. “Mostra nascosti” include i nascosti nell’elenco, mantenendo il filtro di visione selezionato; per riattivarne uno basta aprirne il menu. Nascondere non elimina i dati e non protegge l’accesso con un PIN.

La prima importazione è la data in cui l’URL entra nell’app. `ADD_DATE` di Firefox viene conservato separatamente come data di origine. L’identità usa l’URL decodificato dalle entità HTML, senza spazi esterni; percorso, parametri e frammento restano invariati. Sono accettati solo HTTP/HTTPS. L’HTML viene analizzato come dati e mai eseguito. Il limite per file è 20 MB.

## Installazione e primo avvio

L’APK prodotto si trova in `dist/Bookmark-<versione>-build-<numero>.apk`. Versione e numero sono visibili nella appbar e nella schermata **Log**. Copialo sul dispositivo e aprilo dal gestore file, oppure (sostituisci il nome con quello stampato dalla build):

```bash
adb install -r dist/Bookmark-1.0.1-build-2.apk
```

È richiesto **Android 7.0 / API 24 o successivo**. La build predefinita include ARM a 32 e 64 bit, x86 e x86_64, quindi supporta anche gli AVD Android TV x86 a 32 bit e gli AVD x86_64. L’app compare sia nel launcher Android sia in quello Android TV.

Il nome visualizzato è **Bookmark**. L’identificativo Android `it.massimo.streammark` e i nomi degli archivi locali restano invariati per aggiornare le installazioni precedenti conservando segnalibri e preferenze.

1. In Firefox apri la gestione dei segnalibri e scegli **Importa e salva → Esporta segnalibri in HTML**.
2. Copia il file sul dispositivo o su una chiavetta USB.
3. Nell’app seleziona **Importa HTML** e scegli il file. Il riepilogo indica nuovi, già presenti e ignorati.

L’archivio parte vuoto. Il file personale `sample/bookmarks.html` serve per verificare l’importatore e non viene incluso nell’APK. `sample/demo.html` contiene sei segnalibri dimostrativi e un duplicato intenzionale.

Su Android TV l’importazione accetta sia un URI singolo sia il file restituito in `ClipData`. Se il gestore conferma la selezione senza fornire un file, l’app mostra `PICKER_NO_FILE`; se manca il permesso di lettura, mostra `READ_PERMISSION`. Un annullamento viene segnalato come “nessun file ricevuto”. Se Android riavvia Bookmark mentre è aperto il gestore file, al ritorno compare `IMPORT_INTERRUPTED`. Questi messaggi permettono di descrivere il problema anche senza accedere ai log del dispositivo.

Ogni apertura del selettore ha un codice richiesta distinto, anche nel passaggio da `OPEN_DOCUMENT` a `GET_CONTENT`. Il risultato annullato del tentativo fallito non può quindi chiudere l’importazione ancora in corso nel selettore di ripiego. Anche le risposte tardive di importazioni precedenti vengono ignorate. I messaggi temporanei restano disponibili mentre l’app è in background: i 6,5 secondi di visualizzazione ripartono al ritorno in primo piano.

## Log diagnostico

La registrazione verbosa è attiva anche negli APK release. Premi **Log** nella appbar dopo aver riprodotto il problema. La schermata mostra versione installata, build, modello, Android, architetture e gli eventi più recenti. **Aggiorna** rilegge il file; **Salva in Download** crea un file `.log.txt` in `Download/Bookmark/`, direttamente tramite [MediaStore](https://developer.android.com/training/data-storage/shared/media), senza aprire il selettore file. L’esportazione diretta richiede Android 10 o successivo; la consultazione nell’app funziona anche sulle versioni precedenti.

Con il telecomando, ↑/↓ scorrono il testo, ←/→ scelgono il pulsante, OK esegue e Indietro chiude. Se un’operazione resta in attesa, **Menu/F2** apre il log; è presente anche un pulsante Log nella schermata di attesa.

Sono registrati avvio e ciclo di vita Android, risultato originale del selettore prima dell’inoltro a React Native, callback del modulo, flag, provider e struttura degli URI, metadati, lettura e decodifica, parsing, avanzamento e commit SQLite, conteggi caricati nell’interfaccia, messaggi, attese, errori JavaScript e crash nativi. Il contenuto HTML e i singoli segnalibri non vengono registrati. Le righe hanno orario UTC, identificativo del processo/sessione e, per il selettore, identificativo del tentativo.

I file interni `files/logs/bookmark.log` e `bookmark.previous.log` mantengono circa 4 MB complessivi con rotazione automatica. Sopravvivono a chiusura e aggiornamento dell’app; disinstallare l’app elimina questi log interni. La schermata legge gli ultimi 60.000 caratteri, mentre l’esportazione include entrambi i file completi. I file già esportati in Download restano disponibili. Nell’anteprima web il log persiste nel browser e il pulsante avvia un download.

## Comandi

| Comando | Azione |
| --- | --- |
| ↑ / ↓ nell’elenco | Scorri i titoli e passa tra i segnalibri |
| ↑ dal primo segnalibro, oppure ← | Vai alla barra dei comandi |
| ← / → nella barra | Seleziona un comando |
| ↓ dalla barra | Torna al primo segnalibro |
| OK / Invio / Spazio | Apri il segnalibro o attiva il comando |
| OK premuto per 550 ms | Apri il menu contestuale |
| → nell’elenco, Menu o F2 | Apri il menu contestuale |
| ↑ / ↓ nel menu | Seleziona un’azione |
| ← / → sulla valutazione | Riduci/aumenta da 1 a 5 stelle |
| OK sulla valutazione | Passa alla valutazione successiva, ciclicamente |
| Indietro / Esc | Chiudi il messaggio o il menu; dalla raccolta esci dall’app Android |

Il menu offre anche pulsanti per assegnare direttamente ciascun numero di stelle. Tutte le modifiche vengono salvate subito. Sul touch sono disponibili tap, pressione prolungata e pulsante ⋮.

## Ambiente e compilazione

Versioni allineate all’ambiente di `/home/massimo/prg/passport-app`: **Node 22 LTS, OpenJDK 21, Expo 57, React Native 0.86.3**. Il progetto è indipendente e non modifica né importa codice di Passport.

Android SDK predefinito: `/home/<utente>/Android/Sdk`. Componenti richiesti:

```bash
sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
nvm use
npm ci
npm run build:android
```

Lo script verifica TypeScript e i test, rigenera il progetto Android mediante Expo e compila un APK release con JavaScript incorporato: **non serve Metro per usare l’APK**. `android/` è generato e ignorato da Git; le personalizzazioni sono nel plugin e nel modulo locale.

Ogni compilazione dell’app incrementa automaticamente la patch della versione (`1.0.1`, `1.0.2`, …) e `android.versionCode`. L’incremento avviene nel progetto Gradle tramite `scripts/bump-version.cjs`, prima del bundle JavaScript e del manifest: vale anche per `npm run android` e per le build Gradle dirette debug/release, dopo il prebuild. `app.json`, `package.json` e `package-lock.json` vengono aggiornati insieme. Un numero assegnato a una compilazione fallita resta consumato; le sole compilazioni dell’APK di test non incrementano la versione dell’app. Lo script principale serializza le build per evitare sovrapposizioni.

```bash
# Dipendenze già installate, cache Gradle disponibile
bash build-android.sh --skip-install --offline

# SDK in una posizione diversa
ANDROID_HOME=/percorso/sdk npm run build:android

# APK più piccolo, solo per dispositivi ARM (esclude gli AVD x86 e x86_64)
STREAMMARK_ARCHITECTURES=armeabi-v7a,arm64-v8a npm run build:android

# Copia aggiuntiva opzionale, ad esempio come in Passport
STREAMMARK_COPY_TO=/mnt/d/delete npm run build:android
```

Se un vecchio APK si chiude subito su un AVD x86 o x86_64 con `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`, ricompila con le architetture predefinite e reinstalla con `adb install -r`: l’APK ARM può essere accettato dall’emulatore, ma fallire al caricamento delle librerie native. Gli AVD Android TV possono usare x86 a 32 bit, che richiede librerie diverse da x86_64; `adb shell getprop ro.product.cpu.abilist` mostra le architetture del dispositivo. In WSL, per un AVD avviato da Android Studio su Windows, usa l’`adb.exe` dell’SDK Windows; la build continua a usare l’SDK Linux.

L’APK locale usa la chiave di sviluppo standard del template Expo ed è adatto al sideload. Per una distribuzione con firma propria, imposta `STREAMMARK_KEYSTORE` (percorso assoluto), `STREAMMARK_STORE_PASSWORD`, `STREAMMARK_KEY_ALIAS` e `STREAMMARK_KEY_PASSWORD` prima della compilazione. `scripts/configure-signing.cjs` legge queste variabili senza scrivere le password nel progetto.

## Sviluppo e verifiche

```bash
npm run android      # Build di sviluppo su un dispositivo/emulatore collegato
npm run web          # Anteprima del medesimo layout nel browser
npm run typecheck
npm test
npm run export:web   # Build web in dist/web
```

L’anteprima web usa IndexedDB; l’app Android usa SQLite. La scelta di un browser Android e il selettore documenti nativo richiedono la build Android: il modulo locale non è incluso in Expo Go.

Per i test visivi e funzionali Playwright:

```bash
npx playwright install chromium
# In un terminale: npm run web -- --port 8082
npm run test:ui

# Oppure una build web servita localmente
# python3 -m http.server 8083 --bind 127.0.0.1 --directory dist/web
STREAMMARK_TEST_URL=http://localhost:8083 npm run test:ui
```

Se Chromium è già installato, `STREAMMARK_CHROMIUM=/percorso/chrome` ne seleziona l’eseguibile. I test generano screenshot in `dist/screenshots/`, utilizzano solo dati dimostrativi e simulano l’apertura del browser senza visitare siti esterni.

I test del database usano SQLite reale tramite `node:sqlite`: importazione Firefox, entità/Unicode, URL non validi, SHA-256, titoli lunghi, deduplicazione con conservazione dei metadati, rollback dell’importazione, validazione rating, preferenze e combinazioni di filtri/ordinamenti. Il campione personale viene verificato se presente, senza stamparne il contenuto.

La suite UI copre import/reimport, messaggio di annullamento del selettore, accesso al Log durante un’attesa, download del log da tastiera, persistenza dei log al reload, OK prolungato, rating, visto, nascosti/riattivazione, filtri, ordinamento, persistenza al reload, errore del browser, layout 960×540 e navigazione virtualizzata con 166 segnalibri.

I test nativi usano le API Android reali per URI, `ClipData`, risultati vuoti, annullamenti, metadati mancanti, permessi, UTF-16, file vuoti, limite di 20 MB, rotazione dei log e omissione di percorsi/contenuti dai dettagli diagnostici degli Intent. Dopo aver generato `android/`, compila e installa l’APK di test separato (sostituisci `x86` con l’architettura dell’emulatore):

```bash
cd android
./gradlew :streammark-tv-native:assembleReleaseAndroidTest -PreactNativeArchitectures=x86
adb install -r -t ../modules/streammark-tv/android/build/outputs/apk/androidTest/release/streammark-tv-native-release-androidTest.apk
adb shell am instrument -w expo.modules.streammark.test/expo.modules.streammark.HtmlImportTestRunner
```

L’APK di test include anche il selettore “Bookmark import test”, utile per provare dall’app una risposta contenente solo `ClipData`, un risultato senza file o un annullamento. Il selettore e il provider di prova non sono inclusi nell’APK Bookmark distribuito.

Per configurare il selettore di test con il solo `GET_CONTENT`, usa `adb shell am instrument -w -e picker get-content-only expo.modules.streammark.test/expo.modules.streammark.HtmlImportTestRunner`; `-e picker both` ripristina anche `OPEN_DOCUMENT`. Su un emulatore privo di altri selettori documenti, questo permette di riprodurre il ripiego osservato sull’HK1 RBOX H8. I test nativi verificano che un annullamento del primo tentativo non consumi il risultato del secondo, che gli annullamenti reali siano rispettati e che i codici non vengano riutilizzati alla ricreazione del modulo.

## Struttura

| Percorso | Responsabilità |
| --- | --- |
| `src/App.tsx`, `src/ui/` | Interfaccia, focus e navigazione |
| `src/core/bookmarks.ts` | Parser Firefox, hash, filtri e ordinamento |
| `src/core/repository.ts` | Schema SQLite, import atomico, aggiornamenti e preferenze |
| `src/platform/` | Adattatori Android e anteprima web |
| `modules/streammark-tv/` | Modulo Kotlin: telecomando, selettore documenti e browser |
| `plugins/withTv.js` | Manifest TV, landscape, input Activity, fullscreen e icone |
| `tests/` | Test SQLite e interfaccia |

Il database resta nel contenitore locale dell’app, con backup Android disabilitato. L’importazione usa [`ACTION_OPEN_DOCUMENT`](https://developer.android.com/guide/components/intents-common#Storage), con ripiego su `ACTION_GET_CONTENT` se necessario, senza richiedere accesso generale alla memoria. La lettura del contenuto procede anche se il provider non espone il nome del file. Il modulo nativo segue le [API dei moduli Expo](https://docs.expo.dev/modules/module-api/); le scritture di importazione usano una [transazione SQLite esclusiva](https://docs.expo.dev/versions/latest/sdk/sqlite/).

Alcune TV non includono un selettore documenti: in quel caso serve un gestore file compatibile, come indicato dall’errore nell’app. È necessario un browser installato per aprire i segnalibri. Le verifiche automatiche dell’interfaccia non sostituiscono una prova del telecomando, del selettore file e del browser sul modello di TV di destinazione.
