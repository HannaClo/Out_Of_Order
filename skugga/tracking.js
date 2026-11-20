
// tracking.js – kamera -> stabila kroppspunkter.
// Varje led har .c (confidence) och .miss (antal bildrutor i rad som leden varit osäker).
// En identifierad kropp räknas som aktivitet: inaktivitetstimern återställs högst en gång per sekund.

// Här listar jag kroppens viktigaste punkter som modellen ska identifiera.
// Varje namn motsvarar en led eller punkt på kroppen, exempelvis näsan,
// axlarna, armbågarna, handlederna, höfterna, knäna och anklarna.
// Listans ordning behöver stämma med ordningen på keypoints från posemodellen,
// eftersom jag senare använder samma index för att koppla ihop punkterna med deras namn.
const KP = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'];

// Jag sätter en gräns för hur länge en led får vara osäker innan jag börjar
// uppskatta dess position i stället för att lita på den gamla koordinaten.
// 30 bildrutor motsvarar ungefär en halv sekund vid 60 bildrutor per sekund.
const MISS_LIMIT = 30; // ~0.5 s osäker led -> vi gissar den istället

class BodyTracker {
  // Klassen samlar allt som behövs för att följa en person genom kameran.
  // cfg innehåller inställningar från CONFIG, bland annat minsta tillåtna
  // säkerhet för en kroppspunkt och hur mycket koordinaterna ska jämnas ut.
  constructor(cfg) {
    this.cfg = cfg;

    // raw innehåller de senaste resultaten från posemodellen.
    // Det kan finnas flera identifierade personer i resultatet.
    this.raw = [];

    // joints innehåller kroppspunkterna som jag har bearbetat och stabiliserat.
    // null betyder att jag ännu inte har någon sparad kropp att utgå från.
    this.joints = null;

    // lastSeen sparar när jag senast hittade en användbar person.
    // Ett mycket negativt startvärde gör att systemet från början räknar
    // som om ingen person nyligen har setts.
    this.lastSeen = -1e9;

    // centroid är mittpunkten mellan personens axlar.
    // Jag använder den för att känna igen samma person mellan bildrutorna.
    this.centroid = null;

    // Här sparar jag videons bredd och höjd.
    // Startvärdena är 640 x 480, men de uppdateras när kameran startas.
    this.vw = 640;
    this.vh = 480;

    // Jag sparar när inaktivitetstimern senast återställdes.
    // -Infinity gör att den första identifierade personen kan återställa
    // timern direkt, utan att behöva vänta en sekund.
    this.lastActivityReset = -Infinity;
  }

  // Kopplar kroppsspårningen till videon och posemodellen.
  start(video, model) {

    // Jag hämtar videons faktiska dimensioner så att jag vet vilket
    // koordinatsystem modellens kroppspunkter kommer från.
    this.vw = video.width;
    this.vh = video.height;

    // detectStart startar modellens kontinuerliga identifiering av kroppar.
    // Varje gång modellen ger ett nytt resultat sparar jag det i raw.
    // Funktionen använder en callback eftersom resultaten kommer löpande,
    // inte som ett enda färdigt svar.
    model.detectStart(video, r => (this.raw = r));
  }

  // Räknar ut hur länge det har gått sedan jag senast såg en person.
  absentFor(now) {

    // Jag räknar skillnaden mellan aktuell tid och senaste tidpunkten
    // då en användbar person identifierades.
    const g = now - this.lastSeen;

    // lossGrace fungerar som en kort toleransperiod.
    // Om personen försvinner ur spårningen en mycket kort stund räknar
    // jag inte det direkt som frånvaro.
    return g < this.cfg.lossGrace ? 0 : g;
  }

  // Bearbetar de senaste resultaten från kameran och uppdaterar kroppspunkterna.
  update(now) {
    const c = this.cfg;

    // Jag börjar med att välja vilken identifierad person som ska följas.
    // best innehåller den person jag väljer och bs håller reda på
    // det bästa poängvärdet hittills.
    let best = null, bs = -1;

    // Posemodellen kan identifiera flera personer samtidigt.
    // Därför går jag igenom alla personer i resultatet och bedömer dem en i taget.
    for (const p of this.raw) {
      const k = p.keypoints;

      // Jag kräver att båda axlarna har tillräckligt hög confidence.
      // Confidence är modellens uppskattning av hur säker den är på en punkt,
      // vanligtvis uttryckt som ett värde mellan 0 och 1.
      // Om någon av axlarna är för osäker hoppar jag över personen,
      // eftersom axlarna behövs för att uppskatta kroppens position och storlek.
      if (k[5].confidence < c.minConfidence || k[6].confidence < c.minConfidence) continue;

      // Jag behåller de punkter som har högre säkerhet än gränsvärdet.
      // Sedan samlar jag deras x- och y-koordinater var för sig.
      const pts = k.filter(q => q.confidence > c.minConfidence), xs = pts.map(q => q.x), ys = pts.map(q => q.y);

      // Jag uppskattar personens storlek genom att beräkna en rektangel
      // runt de identifierade punkterna.
      // Rektangelns bredd multiplicerad med dess höjd ger en ungefärlig yta.
      // Det gör att större och tydligare identifierade kroppar får högre poäng.
      let s = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));

      // Jag räknar ut personens ungefärliga mittpunkt genom att ta
      // medelvärdet av vänster och höger axels position.
      const cen = { x: (k[5].x + k[6].x) / 2, y: (k[5].y + k[6].y) / 2 };

      // Om jag redan har en sparad mittpunkt jämför jag den med den nya.
      // Det hjälper mig att fortsätta följa samma person även om någon annan
      // person i bilden tillfälligt får en större identifierad yta.
      if (this.centroid) {
        // Math.hypot räknar ut det raka avståndet mellan de två punkterna.
        const d = Math.hypot(cen.x - this.centroid.x, cen.y - this.centroid.y);

        // Om den nya personen ligger tillräckligt nära den tidigare positionen
        // får den en mycket stor bonus.
        // Jag drar av avståndet så att en person närmare föregående position
        // får en något högre poäng än en person som ligger längre bort.
        if (d < this.vw * 0.3) s += 1e9 - d;
      }

      // Om den här personen har högre poäng än den bästa hittills
      // sparar jag personen och dess axelmittpunkt.
      if (s > bs) { bs = s; best = { k, cen }; }
    }

    // Om ingen person uppfyller kraven avbryter jag uppdateringen.
    // Då behåller jag de tidigare kroppspunkterna och ändrar inte lastSeen.
    if (!best) return;

    // Inaktivitetstimern.
    // Jag använder performance.now() för att mäta verklig tid med hög precision.
    const activityNow = performance.now();

    // Jag återställer bara timern om minst en sekund har gått sedan förra gången.
    // På så sätt undviker jag att anropa återställningsfunktionen varje bildruta.
    if (activityNow - this.lastActivityReset >= 1000) {

      // ?. är optional chaining: funktionen anropas bara om den finns.
      // Det gör att koden inte kraschar om resetInactivityTimer inte har definierats.
      window.resetInactivityTimer?.();

      // Jag sparar tidpunkten för återställningen så att jag kan begränsa
      // nästa anrop till tidigast en sekund senare.
      this.lastActivityReset = activityNow;
    }

    // Nu börjar jag uppdatera kroppspunkterna.
    // Om det har gått mer än två sekunder sedan jag senast såg personen
    // nollställer jag den gamla kroppen. Nästa uppdatering får då skapa
    // nya punkter från kamerans aktuella resultat.
    if (now - this.lastSeen > 2) this.joints = null;

    // Jag uppdaterar tiden då personen senast identifierades
    // och sparar den nya mittpunkten mellan axlarna.
    this.lastSeen = now;
    this.centroid = best.cen;

    // Om jag redan har ett objekt med kroppspunkter använder jag det.
    // Annars skapar jag ett nytt tomt objekt.
    const J = this.joints || (this.joints = {});

    // Jag går igenom alla namn i KP.
    // i används för att hämta motsvarande punkt från modellens resultat.
    KP.forEach((n, i) => {
      const q = best.k[i];

      // ok blir true om modellens confidence når den inställda gränsen.
      const ok = q.confidence >= c.minConfidence;

      // Om punkten inte finns sedan tidigare skapar jag den direkt.
      // Jag sparar dess koordinater, confidence och miss-räknare.
      // En osäker punkt får miss-värdet 999 för att markera att den
      // redan från början ska betraktas som saknad.
      if (!J[n]) { J[n] = { x: q.x, y: q.y, c: q.confidence, miss: ok ? 0 : 999 }; return; }

      // Jag uppdaterar alltid confidence med det senaste resultatet,
      // även om själva koordinaten inte går att använda.
      J[n].c = q.confidence;

      // Om punkten är osäker ökar jag miss-räknaren och behåller
      // den tidigare positionen tills vidare.
      if (!ok) { J[n].miss++; return; }

      // Om punkten har varit osäker längre än MISS_LIMIT flyttar jag den
      // direkt till den nya positionen. Då undviker jag att långvarigt
      // felaktiga gamla koordinater drar med sig den nya positionen.
      if (J[n].miss > MISS_LIMIT) { J[n].x = q.x; J[n].y = q.y; }

      // Om punkten inte har varit osäker så länge jämnar jag i stället ut
      // rörelsen genom att bara flytta en del av sträckan mot den nya positionen.
      // c.smoothing styr hur stor del av skillnaden jag använder:
      // ett lägre värde ger mjukare men långsammare rörelser,
      // medan ett högre värde gör att punkten följer modellen snabbare.
      else {
        J[n].x += (q.x - J[n].x) * c.smoothing;
        J[n].y += (q.y - J[n].y) * c.smoothing;
      }

      // När punkten åter blir säker nollställer jag antalet missade bildrutor.
      J[n].miss = 0;
    });
  }
}

// Gissar saknade leder med kroppsproportioner (i andelar av axelbredden S), riktning = "nedåt" vinkelrätt mot axellinjen.

// Den här funktionen fyller i leder som modellen inte har kunnat identifiera.
// Jag använder axelbredden som ett ungefärligt mått på kroppens storlek
// och placerar saknade leder utifrån proportioner i förhållande till den.
function completeBody(J) {

  // bad kontrollerar om en led saknas eller har varit osäker
  // minst MISS_LIMIT bildrutor i rad.
  const bad = p => !p || (p.miss !== undefined && p.miss >= MISS_LIMIT);

  // Jag hämtar axlarnas positioner och räknar ut avståndet mellan dem.
  // Math.max ser till att avståndet aldrig blir mindre än 40 pixlar,
  // så att efterföljande beräkningar inte använder en alltför liten skala.
  const ls = J.left_shoulder, rs = J.right_shoulder, S = Math.max(40, Math.hypot(ls.x - rs.x, ls.y - rs.y));

  // Jag räknar ut en riktning som är vinkelrät mot linjen mellan axlarna.
  // Genom att använda axlarnas koordinater kan jag uppskatta vilken riktning
  // som motsvarar nedåt längs kroppen, även om personen lutar.
  let dx = -(rs.y - ls.y), dy = rs.x - ls.x;

  // Jag beräknar längden på riktningsvektorn.
  // Om längden skulle bli 0 använder jag 1 för att undvika division med noll.
  const L = Math.hypot(dx, dy) || 1;

  // Här normaliserar jag vektorn genom att dela båda komponenterna med längden.
  // Då får jag en riktningsvektor med längden 1, vilket gör att jag kan
  // använda den tillsammans med olika avstånd i kroppens proportioner.
  dx /= L; dy /= L;

  // Jag kontrollerar att riktningen verkligen pekar nedåt i bildens koordinatsystem.
  // Om y-komponenten är negativ vänder jag på båda komponenterna.
  if (dy < 0) { dx = -dx; dy = -dy; }

  // fix är en lokal hjälpfunktion som uppskattar positionen för en viss led.
  // n är namnet på leden, from är punkten jag utgår från och len är avståndet
  // uttryckt som en andel av axelbredden S.
  const fix = (n, from, len) => {

    // Jag skriver bara över punkten om den saknas eller bedöms som osäker.
    // Den nya positionen räknas ut genom att gå från from i nedåtriktningen
    // med avståndet len gånger axelbredden.
    // c sätts till 0 och miss till 999 för att markera att detta är en uppskattning,
    // inte en punkt som modellen har identifierat säkert.
    if (bad(J[n])) J[n] = { x: from.x + dx * len * S, y: from.y + dy * len * S, c: 0, miss: 999 };
  };

  // Jag går igenom båda kroppssidorna med samma beräkningar.
  // På så sätt slipper jag skriva separat kod för vänster och höger sida.
  for (const s of ['left', 'right']) {

    // Jag uppskattar höften utifrån axeln, med ett avstånd på 1,5 axelbredder.
    fix(s + '_hip', J[s + '_shoulder'], 1.5);

    // Armbågen uppskattas utifrån axeln.
    fix(s + '_elbow', J[s + '_shoulder'], 0.9);

    // Handleden uppskattas utifrån armbågen.
    fix(s + '_wrist', J[s + '_elbow'], 0.8);

    // Knät uppskattas utifrån höften.
    fix(s + '_knee', J[s + '_hip'], 1.1);

    // Vristen/ankeln uppskattas utifrån knät.
    fix(s + '_ankle', J[s + '_knee'], 1.1);
  }
}

// Kompletterar kroppen och skapar de virtuella punkterna neck och hipMid.

// Den här funktionen ser till att kroppen har de punkter som resten
// av programmet behöver, även om vissa leder har saknats i kamerans resultat.
// Den skapar också två extra punkter som inte kommer direkt från modellen.
function withVirtual(J) {

  // Först fyller jag i saknade leder med hjälp av kroppens proportioner.
  completeBody(J);

  // mid räknar ut mittpunkten mellan två punkter genom att ta medelvärdet
  // av deras x- och y-koordinater.
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // neck är en virtuell punkt mitt emellan vänster och höger axel.
  // Den kan användas som en ungefärlig position för halsen.
  J.neck = mid(J.left_shoulder, J.right_shoulder);

  // hipMid är mittpunkten mellan höfterna.
  // Den ger en gemensam referenspunkt för kroppens nedre del
  // och används bland annat när skuggans position ska beräknas.
  J.hipMid = mid(J.left_hip, J.right_hip);

  // Jag returnerar det kompletterade objektet med både de ursprungliga
  // kroppspunkterna och de två virtuella punkterna.
  return J;
}