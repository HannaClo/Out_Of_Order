
// MICROBIT – Bluetooth-styrning av hällningen i Vattenvärlden.
// Tar emot accelerometer (x,y,z i milli-g) via UART, räknar vinkel 0-90° mot en kalibrerad "upprätt"-position
// och skickar den till WaterWorld.setTilt. Kalibrerar vid anslutning, med A på micro:bit eller [K].
// Återansluter själv via navigator.bluetooth.getDevices(). Kräver Chrome/Edge + localhost/https.
// API: connect (växlar anslut/koppla från), calibrate, status, onStatus
const Microbit = (() => {
  "use strict"; // Jag använder strikt läge så att JavaScript fångar fler typer av fel, till exempel oavsiktliga globala variabler.

  // Här samlar jag Bluetooth-inställningarna och värden som styr hur accelerometerdata behandlas.
  const PREFIX = "BBC micro:bit", // Jag använder namnprefixet för att hitta micro:bit-enheter i Bluetooth.
    SVC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // UUID för micro:bitens UART-tjänst.
    TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // UUID för TX-egenskapen som jag läser inkommande data från.
    SMOOTH = 0.6, RING = 8, G_MIN = 550, G_MAX = 1600, // SMOOTH styr utjämningen, RING antalet sparade mätvärden och G_MIN/G_MAX rimliga gränser för accelerometerns magnitud.
    TRIES = 8, AUTO_TRIES = 10, RETRY = 2000, LAST = "microbit.lastName"; // Här anger jag antal återanslutningsförsök, väntetiden mellan dem och nyckeln där senaste enhetsnamnet sparas.

  // Dessa variabler håller reda på Bluetooth-anslutningen och databehandlingen.
  let dev, buf = "", ref, needCal, manualOff, busy, triedKnown, statusCb = null;
  // dev är den valda Bluetooth-enheten, buf samlar inkommande text och ref innehåller kalibreringsvärdet.
  // needCal visar om en ny kalibrering behövs. manualOff visar om användaren själv har kopplat från.
  // busy hindrar flera anslutningsförsök från att köras samtidigt. triedKnown håller reda på om den sparade enheten redan har testats.
  // statusCb är en valfri funktion som anropas när anslutningsstatusen ändras.

  const ring = [], dec = new TextDecoder(), sleep = ms => new Promise(r => setTimeout(r, ms));
  // ring är en buffert med de senaste accelerometermätningarna som används vid kalibrering.
  // TextDecoder omvandlar inkommande Bluetooth-data till vanlig text.
  // sleep skapar en paus som jag kan använda mellan återanslutningsförsök.

  const M = { status: "ej ansluten", angle: 0, connect, calibrate };
  // M är objektet som jag exponerar utanför den här funktionen.
  // Det innehåller aktuell status, den beräknade lutningsvinkeln och funktionerna för att ansluta och kalibrera.
  // På så sätt kan resten av projektet använda micro:bit-funktionerna utan att behöva komma åt alla interna variabler.

  Object.defineProperty(M, "onStatus", {
    // Jag skapar onStatus som en egenskap med en getter och setter.
    // Det gör att annan kod kan registrera en funktion som ska köras när statusen ändras.
    get: () => statusCb,
    set(f) { statusCb = f; if (f) f(M.status); },
    // När en callback registreras sparar jag den i statusCb.
    // Om funktionen finns anropar jag den direkt med den nuvarande statusen, så att mottagaren inte behöver vänta på nästa statusändring.
  });

  const setStatus = s => { M.status = s; if (statusCb) statusCb(s); };
  // Den här funktionen uppdaterar statusen i det publika objektet.
  // Om någon har registrerat en statusfunktion anropar jag även den med den nya statusen.
  // På så sätt kan gränssnittet visa exempelvis om micro:bit är ansluten eller om ett anslutningsförsök pågår.

  function applyTilt(a) {
    M.angle = a;
    // Jag sparar den nya vinkeln så att den även finns tillgänglig via Microbit.angle.
    if (document.body.classList.contains("intro")) return; // Om startsidans intro visas ignorerar jag lutningen, så att användaren inte påverkar världen innan spelet har startat.
    if (window.WaterWorld) window.WaterWorld.setTilt(a);
    // Här skickar jag den beräknade vinkeln vidare till WaterWorld.
    // Jag kontrollerar först att WaterWorld finns, eftersom den här modulen kan laddas innan själva vattenvärlden har skapats.
    // setTilt är kopplingen mellan micro:bitens fysiska lutning och hur vattenvärlden reagerar.
    // Lutad micro:bit = användaren häller → räknas som aktivitet
    if (a > 35 && typeof window.resetInactivityTimer === "function") window.resetInactivityTimer();
    // Om vinkeln är större än 35 grader tolkar jag det som att användaren aktivt häller.
    // Då återställer jag inaktivitetstimern, men bara om funktionen finns.
  }

  function calibrate() {
    if (ring.length < 3) { needCal = true; return; }
    // Jag behöver minst tre mätvärden för att få en användbar referensposition.
    // Om det finns färre än tre sparar jag att kalibrering fortfarande behövs och avslutar funktionen.
    ref = [0, 1, 2].map(i => ring.reduce((s, v) => s + v[i], 0) / ring.length);
    // Här räknar jag ut medelvärdet för de tre accelerometeraxlarna.
    // ring innehåller flera mätningar, och reduce summerar värdena för en axel i taget.
    // Jag delar summan med antalet mätningar för att få ett genomsnitt som blir referensen för micro:bitens upprätta position.
    needCal = false;
    M.angle = 0;
    // När kalibreringen är klar markerar jag att ingen ny kalibrering behövs och återställer vinkeln till noll.
    setStatus("ansluten (kalibrerad)");
    // Jag uppdaterar statusen så att gränssnittet kan visa att anslutningen är klar och micro:bit har kalibrerats.
  }

  function parse(line) {
    if (line === "C") return calibrate();
    // Om micro:bit skickar tecknet C tolkar jag det som en begäran om kalibrering.
    // Funktionen avslutas direkt efter kalibreringen, eftersom raden då inte innehåller vanliga accelerometerdata.

    const p = line.split(",");
    // Jag delar upp textraden vid kommatecken.
    // Det förutsätter att micro:bit skickar värdena i formatet x,y,z.
    if (p.length !== 3) return;
    // Jag ignorerar raden om den inte innehåller exakt tre värden, eftersom accelerometern ska ge ett värde per axel.

    const v = p.map(Number);
    // Jag omvandlar de tre textvärdena till tal så att jag kan göra matematiska beräkningar på dem.
    if (v.some(n => !isFinite(n))) return;
    // Jag kontrollerar att alla värden är giltiga, alltså inte exempelvis text eller NaN.
    // some går igenom värdena och returnerar true om minst ett av dem inte är ett ändligt tal.

    const mag = Math.hypot(...v);
    // Jag räknar ut vektorns magnitud, alltså den sammanlagda storleken på accelerationen i de tre axlarna.
    // Math.hypot räknar ut kvadratroten ur summan av de tre värdenas kvadrater.
    // Spridningsoperatorn ... skickar in värdena som separata argument.
    if (mag < G_MIN || mag > G_MAX) return;
    // Jag filtrerar bort mätningar som ligger utanför det förväntade intervallet.
    // Det hjälper till att ignorera orimliga värden som kan uppstå vid störningar eller felaktig data.

    ring.push(v);
    // Jag lägger den nya mätningen sist i ring-bufferten.
    if (ring.length > RING) ring.shift();
    // Om bufferten innehåller fler än åtta mätningar tar jag bort den äldsta.
    // På så sätt arbetar jag hela tiden med ett begränsat antal av de senaste värdena.

    if ((!ref || needCal) && (ring.length >= RING || (needCal && ring.length >= 3))) calibrate();
    // Om jag saknar en referensposition eller om en ny kalibrering har begärts försöker jag kalibrera.
    // Normalt väntar jag tills bufferten innehåller åtta mätningar.
    // Om en kalibrering uttryckligen behövs räcker det däremot med tre mätningar.
    if (!ref) return;
    // Om det fortfarande inte finns någon kalibrerad referens kan jag inte räkna ut lutningsvinkeln, så jag avslutar här.

    const dot = (v[0] * ref[0] + v[1] * ref[1] + v[2] * ref[2]) / (mag * Math.hypot(...ref));
    // Här beräknar jag skalärprodukten mellan den aktuella accelerationsvektorn och referensvektorn.
    // Jag dividerar med vektorernas magnituder för att få cosinus för vinkeln mellan dem.
    // Resultatet beskriver hur mycket de två riktningarna pekar åt samma håll.
    const raw = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    // Jag omvandlar cosinusvärdet till en vinkel med arccos.
    // Math.min och Math.max begränsar värdet till intervallet -1 till 1, vilket behövs eftersom arccos annars kan ge ett ogiltigt resultat på grund av små avrundningsfel.
    // Jag omvandlar sedan vinkeln från radianer till grader genom att multiplicera med 180 och dividera med PI.
    applyTilt(M.angle + (Math.min(90, raw) - M.angle) * SMOOTH);
    // Jag begränsar den beräknade vinkeln till högst 90 grader.
    // Sedan jämnar jag ut övergången mellan den gamla vinkeln och den nya.
    // SMOOTH avgör hur snabbt vinkeln följer den nya mätningen: värdet 0.6 gör att 60 procent av skillnaden tas med i varje uppdatering.
    // Det minskar ryckiga rörelser och gör styrningen mjukare.
  }

  function onData(e) {
    buf += dec.decode(e.target.value);
    // När Bluetooth skickar data avkodar jag den till text och lägger till den i bufferten.
    // Jag använder en buffert eftersom en Bluetooth-händelse inte nödvändigtvis innehåller en hel textrad.
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      // Jag letar efter radbrytningar. Varje radbrytning markerar slutet på ett meddelande.
      const line = buf.slice(0, i).trim();
      // Jag hämtar texten fram till radbrytningen och tar bort eventuella extra blanksteg.
      buf = buf.slice(i + 1);
      // Jag tar bort den rad som jag precis har läst från bufferten.
      if (line) parse(line);
      // Om raden inte är tom skickar jag den vidare till parse, som tolkar och behandlar innehållet.
    }
    if (buf.length > 64) buf = "";
    // Om bufferten blir orimligt lång utan att innehålla en radbrytning tömmer jag den.
    // Det skyddar mot att felaktig eller ofullständig data ligger kvar och växer obegränsat.
  }

  async function link() {
    let steg = "ansluter till Bluetooth";
    // Jag sparar vilket steg anslutningen befinner sig i.
    // Om något går fel kan jag använda detta för att ge ett mer informativt felmeddelande.
    try {
      const server = await dev.gatt.connect();
      // Jag ansluter till enhetens GATT-server.
      // GATT är Bluetooth Low Energy-systemet som används för att läsa och skriva data via tjänster och egenskaper.
      steg = "letar efter UART-tjänsten";
      const svc = await server.getPrimaryService(SVC);
      // Jag hämtar micro:bitens UART-tjänst med hjälp av dess UUID.
      steg = "letar efter TX-egenskapen";
      const chr = await svc.getCharacteristic(TX);
      // Jag hämtar TX-egenskapen som innehåller den data som micro:bit skickar till webbläsaren.
      steg = "startar mottagningen";
      chr.addEventListener("characteristicvaluechanged", onData);
      // Jag registrerar onData som händelsehanterare.
      // När värdet i Bluetooth-egenskapen ändras anropas funktionen och den inkommande datan behandlas.
      await chr.startNotifications();
      // Jag aktiverar notiser så att webbläsaren får information automatiskt när micro:bit skickar ny data.
      buf = ""; ring.length = 0; ref = null; needCal = true; triedKnown = false;
      // Jag nollställer bufferten och de gamla mätvärdena inför den nya anslutningen.
      // Jag tar även bort den tidigare kalibreringsreferensen och markerar att en ny kalibrering behövs.
      // triedKnown återställs så att nästa anslutningsförlopp kan försöka med den kända enheten igen.
      try { localStorage.setItem(LAST, dev.name || ""); } catch (_) {}
      // Jag försöker spara namnet på den senast använda micro:bit-enheten i webbläsarens localStorage.
      // Då kan jag försöka hitta samma enhet automatiskt nästa gång sidan öppnas.
      // Fel ignoreras här eftersom lagring inte är avgörande för själva Bluetooth-anslutningen.
      setStatus("ansluten – håll den upprätt");
      // Jag meddelar gränssnittet att anslutningen är klar och att användaren ska hålla micro:bit upprätt inför kalibreringen.
    } catch (err) {
      throw new Error(steg + ": " + (err.message || err));
      // Om något steg misslyckas skickar jag vidare ett nytt felmeddelande som anger var i anslutningen problemet uppstod.
      // Det gör det lättare att förstå om felet gäller Bluetooth-anslutningen, tjänsten, egenskapen eller mottagningen.
    }
  }

  const attach = d => { dev = d; dev.addEventListener("gattserverdisconnected", onDrop); };
  // Jag kopplar den valda enheten till variabeln dev och registrerar en händelse för när Bluetooth-anslutningen bryts.
  // Då kan onDrop automatiskt hantera frånkopplingen och försöka ansluta igen.

  async function reconnect(tries, label, failStatus) {
    if (busy || !dev) return false;
    // Jag avbryter om ett annat anslutningsförsök redan pågår eller om det inte finns någon vald enhet.
    busy = true;
    // Jag markerar att ett återanslutningsförsök pågår så att andra delar av koden inte startar ytterligare försök samtidigt.
    try {
      for (let i = 0; i < tries && !manualOff; i++) {
        // Jag upprepar anslutningsförsöket så länge jag inte har nått maxantalet försök och användaren inte har kopplat från manuellt.
        setStatus(label);
        // Jag uppdaterar statusen så att användaren ser att anslutningen försöker återställas.
        try { await link(); return true; }
        // Jag försöker ansluta genom link. Om det lyckas avslutar jag direkt och returnerar true.
        catch (err) { console.warn("Återanslutning misslyckades:", err.message || err); }
        // Om försöket misslyckas skriver jag ett varningsmeddelande i webbläsarens konsol.
        if (i < tries - 1) await sleep(RETRY);
        // Jag väntar två sekunder innan nästa försök, men bara om det finns fler försök kvar.
      }
    } finally { busy = false; }
    // finally körs oavsett om anslutningen lyckas eller ett fel uppstår.
    // Jag återställer därför busy så att nya anslutningsförsök kan göras efteråt.
    if (!manualOff && failStatus) setStatus(failStatus);
    // Om användaren inte har kopplat från manuellt och alla försök misslyckades visar jag det angivna felmeddelandet.
    return false;
    // Jag returnerar false för att markera att återanslutningen inte lyckades.
  }

  function onDrop() {
    applyTilt(0);
    // När anslutningen bryts återställer jag lutningen till noll så att vattenvärlden inte fortsätter använda den senaste vinkeln.
    if (manualOff) return setStatus("ej ansluten");
    // Om användaren själv valde att koppla från visar jag statusen och gör inget nytt anslutningsförsök.
    reconnect(TRIES, "tappade – ansluter igen…", "tappade anslutningen (tryck för att koppla igen)");
    // Om anslutningen försvann oväntat försöker jag ansluta igen, högst åtta gånger.
    // Om det inte fungerar visar jag ett meddelande om att användaren kan försöka ansluta manuellt.
  }

  // Väntar tills micro:biten annonserar sig (max ms)
  const waitAd = (d, ms = 15000) => new Promise((res, rej) => {
    // Jag skapar ett Promise som väntar på att den valda Bluetooth-enheten ska börja annonsera sig.
    // Funktionen kan antingen lyckas eller avbrytas med ett fel efter den angivna tidsgränsen.
    if (typeof d.watchAdvertisements !== "function") return rej(new Error("watchAdvertisements stöds inte"));
    // Jag kontrollerar att webbläsaren stöder watchAdvertisements för den här enheten.
    // Om funktionen saknas kan jag inte använda just den här metoden för att vänta på en Bluetooth-signal.
    const done = e => { clearTimeout(t); d.removeEventListener("advertisementreceived", ok); e ? rej(e) : res(); },
      // done avslutar väntan, tar bort tidsgränsen och avregistrerar händelsehanteraren.
      // Om den får ett fel avvisas Promise:et, annars markeras väntan som lyckad.
      ok = () => done(),
      // ok körs när en Bluetooth-annons tas emot och avslutar då väntan utan fel.
      t = setTimeout(() => done(new Error("Ingen Bluetooth-signal upptäcktes inom 15 sekunder")), ms);
      // Jag startar en tidsgräns. Om ingen signal kommer inom den angivna tiden avslutas väntan med ett fel.
    d.addEventListener("advertisementreceived", ok);
    // Jag registrerar en händelsehanterare som reagerar när enheten annonserar sig.
    d.watchAdvertisements().then(() => console.log("[microbit] Väntar på Bluetooth-signal..."), done);
    // Jag startar bevakningen av Bluetooth-annonser.
    // När bevakningen startar loggar jag att jag väntar. Om själva anropet misslyckas skickar jag felet till done.
  });

  // Körs när sidan öppnas: hittar redan godkänd micro:bit och ansluter utan klick
  async function autoConnect() {
    if (!navigator.bluetooth?.getDevices) return;
    // Jag kontrollerar att webbläsaren både har Bluetooth-stöd och kan hämta tidigare godkända enheter.
    // Om getDevices saknas avslutar jag, eftersom automatisk återanslutning då inte är tillgänglig.
    try {
      const all = await navigator.bluetooth.getDevices();
      // Jag hämtar de Bluetooth-enheter som användaren tidigare har gett webbplatsen tillåtelse att använda.
      console.log("[microbit] Sparade enheter:", all.length);
      // Jag skriver ut antalet hittade enheter i konsolen, vilket är användbart vid felsökning.
      const list = all.filter(d => d.name && d.name.startsWith(PREFIX));
      // Jag filtrerar listan så att jag bara behåller enheter som har ett namn som börjar med BBC micro:bit.
      if (!list.length) return setStatus("ej ansluten – ingen sparad micro:bit");
      // Om ingen tidigare godkänd micro:bit hittas visar jag det och avslutar funktionen.

      let last = "";
      try { last = localStorage.getItem(LAST) || ""; } catch (_) {}
      // Jag hämtar namnet på den senast använda enheten från localStorage.
      // Om lagringen inte är tillgänglig eller inget namn finns använder jag en tom text.
      attach(list.find(d => d.name === last) || list[0]);
      // Jag väljer först den enhet vars namn matchar den senast använda.
      // Om den inte finns väljer jag den första micro:bit som hittades.
      manualOff = false;
      // Jag markerar att anslutningen inte har stängts av manuellt, så att automatisk anslutning får fortsätta.
      setStatus("väntar på micro:bit...");
      // Jag visar att sidan väntar på att den valda enheten ska bli tillgänglig.

      for (let i = 0; i < AUTO_TRIES && !manualOff; i++) {
        // Jag gör upp till tio automatiska försök, så länge användaren inte avbryter genom att koppla från.
        try {
          await waitAd(dev);
          // Jag väntar på att micro:bit ska annonsera sig via Bluetooth.
          console.log("[microbit] Bluetooth-signal upptäckt!");
          // Jag loggar att enheten har blivit synlig.
          setStatus("ansluter automatiskt...");
          // Jag uppdaterar statusen medan själva anslutningen genomförs.
          await link();
          // Jag använder samma anslutningsfunktion som vid manuell anslutning.
          console.log("[microbit] Automatisk anslutning lyckades!");
          // Jag loggar att anslutningen lyckades.
          return;
          // Jag avslutar funktionen eftersom enheten nu är ansluten.
        } catch (err) {
          console.warn("[microbit] Automatiskt försök misslyckades:", err.message || err);
          // Om väntan eller anslutningen misslyckas loggar jag orsaken som en varning.
          if (!manualOff && i < AUTO_TRIES - 1) await sleep(RETRY);
          // Om användaren inte har avbrutit och det finns fler försök kvar väntar jag innan nästa försök.
        }
      }
      if (!manualOff) setStatus("ej ansluten – tryck för att ansluta");
      // Om alla automatiska försök misslyckas visar jag att användaren kan starta anslutningen manuellt.
    } catch (err) {
      console.error("[microbit] Autoanslutningsfel:", err);
      // Om något går fel när jag hämtar eller väljer enheter loggar jag felet som ett allvarligare fel.
      setStatus("ej ansluten – autoanslutning misslyckades");
      // Jag uppdaterar statusen så att användaren får veta att den automatiska anslutningen inte fungerade.
    }
  }

  async function connect() {
    if (!navigator.bluetooth) return setStatus("kräver Chrome/Edge");
    // Jag kontrollerar först om webbläsaren har Bluetooth-stöd.
    // Om den inte har det visar jag ett meddelande om att en kompatibel webbläsare behövs.
    if (dev && dev.gatt.connected) { manualOff = true; dev.gatt.disconnect(); return; }
    // Om enheten redan är ansluten kopplar jag från den i stället.
    // Jag markerar först att frånkopplingen är manuell, så att onDrop inte försöker ansluta igen automatiskt.
    if (busy) return;
    // Om ett anslutningsförsök redan pågår gör jag inget nytt försök.
    manualOff = false;
    // Jag markerar att användaren vill ansluta och att automatiska återanslutningsförsök därför är tillåtna.

    if (dev && !triedKnown) { // första klicket: försök med den kända enheten
      triedKnown = true;
      // Jag testar först att återansluta till den enhet som redan är vald, i stället för att direkt öppna en ny enhetsväljare.
      await reconnect(1, "ansluter…", "ej ansluten – tryck igen för att välja micro:bit");
      // Jag gör ett försök. Om det misslyckas får användaren möjlighet att klicka igen och välja en enhet manuellt.
      return;
    }

    busy = true;
    // Jag markerar att anslutningsprocessen är upptagen medan jag väljer och ansluter till en enhet.
    try {
      attach(await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: PREFIX }], optionalServices: [SVC] }));
      // Jag öppnar webbläsarens Bluetooth-dialog där användaren kan välja en micro:bit.
      // namePrefix begränsar urvalet till enheter som börjar med BBC micro:bit.
      // optionalServices anger att jag behöver tillgång till UART-tjänsten efter att användaren har valt enheten.
      setStatus("ansluter…");
      // Jag visar att anslutningen håller på att startas.
      await link();
      // Jag genomför anslutningen och startar mottagningen av accelerometerdata.
    } catch (err) {
      setStatus(err && err.name === "NotFoundError" ? "ej ansluten" : "fel: " + (err && err.message || err));
      // Om användaren stänger enhetsväljaren eller avbryter visas statusen ej ansluten.
      // Vid andra fel visar jag felmeddelandet så att det går att förstå vad som gick fel.
    } finally { busy = false; }
    // Jag återställer busy oavsett om anslutningen lyckas eller misslyckas.
  }

  // Koppla ner snyggt när sidan lämnas; anslut igen vid bakåtknapp
  addEventListener("pagehide", () => {
    // pagehide körs när användaren lämnar sidan eller när webbläsaren lägger den i bakgrunden för navigering.
    manualOff = true;
    // Jag stoppar automatiska återanslutningsförsök eftersom sidan håller på att lämnas.
    try { if (dev && dev.gatt.connected) dev.gatt.disconnect(); } catch (_) {}
    // Om enheten är ansluten kopplar jag från den.
    // Jag fångar eventuella fel eftersom frånkopplingen inte ska hindra sidan från att lämnas.
  });
  addEventListener("pageshow", e => { if (e.persisted) autoConnect(); });
  // pageshow körs när sidan visas igen.
  // Om webbläsaren återställer sidan från sin bakåt-/framåt-cache (persisted) försöker jag ansluta automatiskt igen.

  setTimeout(autoConnect, 0);
  // Jag schemalägger autoConnect direkt efter att den aktuella JavaScript-körningen är klar.
  // Det gör att sidan automatiskt försöker hitta och ansluta till en tidigare godkänd micro:bit när den öppnas.

  return M;
  // Jag returnerar det publika objektet så att annan kod kan använda Microbit.status, Microbit.angle,
  // Microbit.connect, Microbit.calibrate och Microbit.onStatus.
})();