
// timeline.js – nivåstyrning. Användarläge: waiting -> running -> finished. Demo: nivå 1, loopar var 30:e s.

// Jag skapar en hjälpfunktion som blandar värdena från två objekt.
// Funktionen används när jag vill gå från en nivås inställningar till nästa
// utan att alla parametrar ändras direkt på en gång.
const lerpObj = (a, b, t) => typeof a === 'number' ? a + (b - a) * t
  // Om värdet är ett tal räknar jag ut ett mellanvärde mellan a och b.
  // t bestämmer hur långt övergången har kommit:
  // 0 betyder helt a och 1 betyder helt b.
  // Om värdet inte är ett tal utgår jag i stället från att det är ett objekt.
  : Object.fromEntries(Object.keys(a).map(k => [k, lerpObj(a[k], b[k], t)]));

// Object.keys(a) hämtar nycklarna i objektet a.
// map går igenom varje nyckel och blandar motsvarande värden i a och b
// genom att anropa lerpObj igen. På så sätt fungerar funktionen även
// för objekt som innehåller andra objekt, till exempel nivåernas partW och kinds.
// Object.fromEntries bygger sedan upp ett nytt objekt av nyckel-värde-paren.

class Timeline {
  // Här skapar jag klassen som ansvarar för upplevelsens tidsförlopp och nivåer.
  // cfg innehåller inställningarna från CONFIG, exempelvis nivåernas längd
  // och reglerna för när upplevelsen ska starta eller återställas.
  constructor(cfg) {
    this.cfg = cfg;

    // demoLevel används för att markera om demoläget är aktivt.
    // null betyder att vanligt användarläge används.
    this.demoLevel = null;

    // Här sparar jag när den aktuella demo-omgången startade.
    this.demoSince = 0;

    // En demo-omgång varar i 30 sekunder innan den börjar om.
    this.demoDuration = 30;

    // Jag återställer grundläggande tids- och tillståndsvärden.
    this.reset();
  }

  // Återställer tidslinjen till vänteläget.
  reset() {
    this.state = 'waiting';

    // seenSince håller reda på när en person först upptäcktes.
    // null betyder att ingen person ännu har registrerats som närvarande.
    this.seenSince = null;

    // t0 är starttiden för den vanliga upplevelsen.
    // Jag använder den som utgångspunkt när jag räknar ut hur långt
    // användaren har kommit i de olika nivåerna.
    this.t0 = 0;
  }

  // Startar demoläget på nivå 1.
  setDemo(i, now) {
    // Jag sätter demoLevel till 0, vilket motsvarar den första nivån.
    // Parametern i finns i funktionsanropet men används inte här,
    // eftersom demoläget alltid låses till nivå 1.
    this.demoLevel = 0;

    // Jag sparar aktuell tid som start för demo-omgången.
    // Samma tid används också som tidslinjens starttid.
    this.demoSince = this.t0 = now;

    // Demoläget ska börja köras direkt och inte vänta på att en person
    // ska upptäckas av kameran.
    this.state = 'running';
  }

  // Avslutar demoläget och återgår till vanligt användarläge.
  clearDemo() {
    this.demoLevel = null;
    this.reset();
  }

  // En getter som räknar ut den sammanlagda längden på alla nivåer.
  // Jag använder reduce för att lägga ihop alla värden i levelDurations.
  // Resultatet blir den totala tiden som användarläget ska pågå.
  get total() {
    return this.cfg.levelDurations.reduce((a, b) => a + b, 0);
  }

  // Uppdaterar tidslinjens tillstånd utifrån om en person är närvarande,
  // hur länge personen har varit borta och den aktuella tiden.
  update(present, absent, now) {

    // Först kontrollerar jag om demoläget är aktivt.
    if (this.demoLevel != null) {

      // Om 30 sekunder har gått startar jag om demo-tiden.
      // Jag flyttar både demoSince och t0 till den aktuella tiden.
      // Det gör att demoläget börjar om från början i stället för
      // att fortsätta räkna vidare.
      if (now - this.demoSince >= this.demoDuration) this.demoSince = this.t0 = now;

      // När demoläget är aktivt avslutar jag funktionen här.
      // Då körs inte reglerna för närvaro och frånvaro i användarläget.
      return;
    }

    // Jag hämtar inställningarna från CONFIG för att kunna använda
    // samma tröskelvärden som resten av projektet.
    const c = this.cfg;

    // WAITING: Upplevelsen väntar på att en person ska upptäckas.
    if (this.state === 'waiting') {

      // Om ingen person är närvarande nollställer jag registreringen.
      // En person som bara passerar kort ska alltså inte automatiskt starta
      // upplevelsen efter att ha varit synlig en liten stund.
      if (!present) this.seenSince = null;

      else {
        // Om personen precis har upptäckts sparar jag den aktuella tiden.
        // Jag använder null som kontroll för att bara sätta starttiden
        // första gången personen registreras som närvarande.
        if (this.seenSince == null) this.seenSince = now;

        // Jag kontrollerar hur länge personen har varit närvarande.
        // När tiden når CONFIG.presenceToStart går upplevelsen över
        // från waiting till running.
        if (now - this.seenSince >= c.presenceToStart) {
          this.state = 'running';

          // Jag sparar starttiden för hela nivåförloppet.
          this.t0 = now;
        }
      }

    // RUNNING: Upplevelsen är igång och nivåernas tid räknas.
    } else if (this.state === 'running') {

      // Om personen har varit borta längre än gränsen för inaktivitetsåterställning
      // börjar upplevelsen om från vänteläget.
      if (absent >= c.inactivityReset) this.reset();

      // Om den sammanlagda tiden för alla nivåer har passerat
      // markerar jag upplevelsen som färdig.
      else if (now - this.t0 >= this.total) this.state = 'finished';

    // FINISHED: Upplevelsen är färdig och väntar på att kunna startas om.
    } else if (absent >= c.rearmAbsence) {

      // När en person har varit borta tillräckligt länge återställer jag
      // tidslinjen till waiting, så att nästa användare kan starta upplevelsen.
      this.reset();
    }
  }

  // Hämtar den aktuella nivån och hur lång tid som har gått inom just den nivån.
  // index är nivåns index i listan, där 0 motsvarar nivå 1.
  // t är tiden i sekunder sedan den aktuella nivån började.

  level(now) {

    // I demoläget returnerar jag alltid nivå 1.
    // Tiden t räknas från starten av den aktuella demo-omgången.
    if (this.demoLevel != null) return { index: 0, t: now - this.demoSince };

    // Jag hämtar längden på varje nivå från CONFIG.
    // t börjar som den totala tiden sedan användarläget startade.
    // i börjar på 0 eftersom den första nivån har index 0.
    const d = this.cfg.levelDurations;
    let t = now - this.t0, i = 0;

    // Här går jag igenom nivåernas längder för att hitta vilken nivå
    // den totala tiden motsvarar.
    // Så länge t är större än eller lika med den aktuella nivåns längd
    // drar jag bort den längden och går vidare till nästa nivå.
    while (i < d.length - 1 && t >= d[i]) t -= d[i++];

    // Jag returnerar både nivåns index och tiden som har gått inom den.
    // Den informationen används bland annat för att välja rätt parametrar
    // och avgöra hur långt in i nivån upplevelsen befinner sig.
    return { index: i, t };
  }

  // Hämtar parametrarna för den aktuella nivån.
  // Om en nivå precis har börjat blandar jag gradvis in dess värden
  // från föregående nivå, så att förändringen inte blir abrupt.
  params(now) {

    // I demoläget använder jag alltid parametrarna för nivå 1.
    // Därför sker ingen övergång mellan nivåer i demo.
    if (this.demoLevel != null) return this.cfg.levels[0];

    // Jag hämtar aktuell nivå och tiden inom den genom level().
    // L är listan med alla nivåers inställningar.
    const { index: i, t } = this.level(now), L = this.cfg.levels;

    // Om jag befinner mig efter den första nivån och fortfarande är
    // inom övergångstiden blendTime blandar jag föregående nivås värden
    // med den nya nivåns värden.
    //
    // sstep gör att övergången får en mjuk start och avslutning.
    // lerpObj blandar sedan alla parametrar, även värden i underobjekt.
    //
    // Om övergångstiden har passerat, eller om jag är på första nivån,
    // returnerar jag nivåns inställningar direkt utan blandning.
    return i > 0 && t < this.cfg.blendTime
      ? lerpObj(L[i - 1], L[i], sstep(t / this.cfg.blendTime))
      : L[i];
  }
}