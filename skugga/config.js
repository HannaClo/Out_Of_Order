
// config.js – ALLA inställningar på ett ställe (CONFIG). Ändra här för att ändra hur upplevelsen känns;
// övriga filer läser härifrån (t.ex. CONFIG.blendTime).
// Jag samlar alltså projektets inställningar i ett gemensamt objekt.
// På så sätt kan andra filer använda samma värden utan att jag behöver skriva in dem flera gånger.
// Om jag vill ändra exempelvis en övergångstid eller hur ofta skuggan ska avvika gör jag det här.
const CONFIG = {

  // ---------- TID / NIVÅER ----------
  // Här bestämmer jag hur länge varje nivå ska pågå och hur övergångarna mellan nivåerna ska fungera.
  levelDurations: [8, 15, 15, 15, 30], // sekunder per nivå (fem nivåer, totalt 83 s)
  blendTime: 2.5,     // sek för mjuk övergång in i ny nivå (förra nivåns värden blandas med nya). Max kortaste nivån.
  // Jag använder blendTime för att förändringen mellan nivåernas inställningar inte ska ske tvärt.
  // blinkIn och blinkOut styr den korta stunden då skuggan återgår till att följa personen exakt.
  blinkIn: 0.35,    // "glimt av normalitet": sek för att snabbt snappa tillbaka till exakt spegling
  blinkOut: 0.7,    // ...och sek för att glida tillbaka in i avvikelsen

  // ---------- NÄRVARO / ÅTERSTÄLLNING ----------
  // Här styr jag hur programmet reagerar på om en person finns framför kameran eller försvinner.
  inactivityReset: 30,  // sek utan person -> hela upplevelsen börjar om
  rearmAbsence: 2,      // sek utan person efter nivå 5 innan nästa användare kan starta
  presenceToStart: 0.6, // sek en person måste synas innan det startar (förbipasserande ska inte starta den)
  lossGrace: 0.5,       // sek tracking får tappas utan att räknas som "borta"
  // Jag har alltså både en gräns för när upplevelsen ska starta och en tolerans för korta avbrott i spårningen.
  // Det gör att en person som tillfälligt tappas av kameran inte direkt behandlas som att den har lämnat.

  // ---------- TRACKING ----------
  // Tracking är den del som följer personens kropp och uppskattar var kroppens olika punkter befinner sig.
  minConfidence: 0.3,   // 0–1, under detta litar vi inte på en punkt från AI-modellen
  smoothing: 0.35,      // 0–1, lägre = mjukare men släpigare, högre = snabbare men darrigare
  // Jag använder smoothing för att jämna ut små variationer i positionerna från AI-modellen.
  // Det är en avvägning: mer utjämning ger lugnare rörelser, men gör också att skuggan reagerar långsammare.
  mirror: true,         // true = skuggan speglas som en spegel

  // ---------- UTSEENDE ----------
  // Här lägger jag inställningar för det visuella grundutseendet.
  bg: [48, 48, 56],     // bakgrundsfärg (reserv om bilden saknas)
  // Färgen anges som tre värden för rött, grönt och blått (RGB).
  // Den fungerar som reservbakgrund om den vanliga bakgrundsbilden inte kan användas.

  // ---------- MILJÖ (bakgrundsbild) ----------
  // Här samlar jag inställningar som påverkar bakgrundsmiljön och ljuseffekterna.
  env: {
    image: 'bakgrund.jpg',   // bildfil i samma mapp som index.html
    // Jag anger vilken bild som ska användas som miljöns bakgrund.
    bpm: 128,                // takten ljuset pulserar i
    // BPM betyder beats per minute, alltså slag per minut.
    // Värdet används för att koppla ljusets puls till en bestämd takt.
    anchorY: 1,              // vid beskärning: 1 = behåll botten (golvet), 0 = toppen, 0.5 = mitten
    // Jag använder anchorY för att bestämma vilken del av bilden som ska prioriteras om den behöver beskäras.
    floorY: 0.80,            // golvlinjens höjd i bilden (0 = överkant, 1 = nederkant)
    // floorY anger var programmet räknar med att golvet ligger i bakgrundsbilden.
    vignette: 0.25,          // mörkare kanter (0 = av)
    // Vignette gör bildens kanter mörkare och kan hjälpa till att rikta uppmärksamheten mot mitten.
    strobe: 0.06,            // blixt på kicken nivå 4–5 (0 = av). Håll lågt av hänsyn till ljuskänsliga
    // Strobe styr en kort ljusblixt som är kopplad till musikens kicktrumma.
    // Jag håller värdet lågt eftersom snabba ljusförändringar kan vara besvärliga för ljuskänsliga personer.
    rimPink: [255, 40, 200], // ljusfärg vänster
    rimBlue: [30, 120, 255]  // ljusfärg höger
    // Dessa två RGB-färger används för ljuseffekter från varsin sida.
  },

  // ---------- LJUD ----------
  // Här bestämmer jag om ljudet ska vara aktivt och hur hög volymen ska vara.
  audio: { enabled: true, volume: 0.55 },  // volym 0–1. Musiken genereras i koden (audio.js)
  // enabled fungerar som en av/på-inställning, medan volume anger ljudnivån.
  // Musiken skapas av ljudkoden i stället för att spelas upp från en vanlig musikfil.

  // ---------- SKUGGA ----------
  // Här styr jag hur skuggan och dess visuella effekter ska se ut.
  shadow: {
    pool: 0.24,       // ljuspool bakom figuren (0 = av)
    // pool styr ljusområdet som kan visas bakom personen.
    strength: 0.92,   // hur mörk skuggan är
    // strength bestämmer skuggans styrka. Ett högre värde innebär en tydligare och mörkare skugga.
    offset: 0.07,     // avstånd mellan rosa/blå skugga
    // offset bestämmer hur långt isär de färgade skugglagren placeras.
    floorCast: true,  // skuggor som läggs ut längs golvet
    // Med floorCast kan jag slå på eller av skuggeffekterna som placeras längs golvet.
    floorLean: 0.55,  // hur långt golvskuggorna sträcks i sidled
    floorFlat: 0.22,  // hur platta de är (lägre = plattare)
    // De två värdena påverkar formen på golvskuggorna: hur långt de sträcks och hur platta de blir.
    reflection: 0.22, contact: 0.5
    // Här anger jag ytterligare värden för reflektion och kontakt.
    // Exakt hur de används visuellt beror på hur skugginställningarna läses i den fil som ritar upp skuggan.
  },

  // ---------- NIVÅER ----------
  // Här kommer inställningarna som gör att upplevelsen förändras stegvis mellan de fem nivåerna.
  // Jag använder ett separat objekt för varje nivå.
  // Objekten har samma uppsättning nycklar, så att andra delar av programmet kan blanda värdena
  // mellan två nivåer utan att behöva hantera olika strukturer.
  //
  //   rate        hur ofta nya avvikelser startar        maxParts   max antal kroppsdelar som avviker samtidigt
  //   intensity   hur kraftig avvikelsen är (0–1)        durMin/Max hur länge en avvikelse varar (sek)
  //   calmChance  chans för lugn paus mellan avvikelser  calmMin/Max pausens längd
  //   blinkChance chans för "glimt av normalitet"        blinkMin/Max glimtens längd
  //   ghostRate   hur ofta skuggan kopplar loss helt (bara nivå 5)   ghostMin/Max episodens längd
  //   partW       vikt per kroppsdel (0 = aldrig, 1 = gärna): head, lArm/rArm, lLeg/rLeg, upper (överkropp)
  //   kinds       vikt per avvikelsetyp: offset (förskjuten), delay (släpar), rotate, reverse (omvänd rörelse),
  //               lead (före personen), freeze, own (egen rörelse)
  //
  // Jag använder sannolikhetsvikter för att styra vilka kroppsdelar och rörelsetyper som kan väljas.
  // En vikt på 0 innebär att typen inte väljs, medan ett högre värde gör den mer sannolik.
  levels: [
    // Nivå 1: exakt spegling (rate 0 = inga avvikelser, bara introduktion)
    // I första nivån är avvikelserna avstängda. Personen får därför se hur skuggan följer kroppen normalt.
    { rate: 0, maxParts: 0, intensity: 0, durMin: 1, durMax: 2, calmChance: 0, calmMin: 1, calmMax: 2,
      blinkChance: 0, blinkMin: 1, blinkMax: 2, ghostRate: 0, ghostMin: 6, ghostMax: 9,
      // partW anger vilka kroppsdelar som kan väljas. Här är armar och ben viktade, men maxParts är 0
      // och rate är 0, så inga avvikelser ska starta på den här nivån.
      partW: { head: 0, lArm: 1, rArm: 1, lLeg: 1, rLeg: 1, upper: 0 },
      // kinds anger vilka sorters avvikelser som kan väljas. Här är offset den enda typen med positiv vikt.
      kinds: { offset: 1, delay: 0, rotate: 0, reverse: 0, lead: 0, freeze: 0, own: 0 } },

    // Nivå 2: armar/ben avviker märkbart men måttligt (max 1 del)
    // Här börjar skuggan avvika lite från personens rörelser.
    // Endast en kroppsdel kan påverkas åt gången, och huvud och överkropp är bortvalda.
    { rate: 0.45, maxParts: 1, intensity: 0.45, durMin: 1.5, durMax: 3, calmChance: 0.2, calmMin: 1.5, calmMax: 3,
      blinkChance: 0.15, blinkMin: 0.8, blinkMax: 1.8, ghostRate: 0, ghostMin: 6, ghostMax: 9,
      // Jag låter armarna ha full vikt och benen något lägre vikt.
      partW: { head: 0, lArm: 1, rArm: 1, lLeg: 0.6, rLeg: 0.6, upper: 0 },
      // Här kan skuggan förskjutas, släpa efter, rotera eller göra en egen rörelse.
      // Vikterna gör offset och delay vanligare än rotate och own.
      kinds: { offset: 1, delay: 1, rotate: 0.6, reverse: 0, lead: 0, freeze: 0, own: 0.35 } },

    // Nivå 3: mer galet (huvudet kan avvika, upp till 2 delar)
    // Jag ökar både intensiteten och antalet kroppsdelar som kan påverkas samtidigt.
    // Huvudet får också en positiv vikt, så det kan börja röra sig annorlunda än personens huvud.
    { rate: 0.4, maxParts: 2, intensity: 0.75, durMin: 2, durMax: 4, calmChance: 0.2, calmMin: 1.5, calmMax: 3,
      blinkChance: 0.2, blinkMin: 1, blinkMax: 2.2, ghostRate: 0, ghostMin: 6, ghostMax: 9,
      partW: { head: 0.6, lArm: 1, rArm: 1, lLeg: 0.8, rLeg: 0.8, upper: 0 },
      // Rotate blir nu den vanligaste avvikelsetypen, men offset, delay, reverse och own kan också förekomma.
      kinds: { offset: 0.6, delay: 0.8, rotate: 1, reverse: 0.3, lead: 0, freeze: 0, own: 0.9 } },

    // Nivå 4: ännu mer – även överkropp, omvänd rörelse, lead och frysning
    // Här ökar jag antalet möjliga kroppsdelar och lägger till fler typer av avvikande rörelser.
    { rate: 0.5, maxParts: 3, intensity: 0.95, durMin: 2, durMax: 5, calmChance: 0.2, calmMin: 1, calmMax: 2.5,
      blinkChance: 0.25, blinkMin: 1, blinkMax: 2.5, ghostRate: 0, ghostMin: 6, ghostMax: 9,
      // Även överkroppen kan nu påverkas, samtidigt som huvud, armar och ben får högre vikter.
      partW: { head: 0.8, lArm: 1, rArm: 1, lLeg: 0.9, rLeg: 0.9, upper: 0.6 },
      // Jag aktiverar även reverse, lead och freeze.
      // Det innebär att skuggan bland annat kan röra sig omvänt, före personen eller hålla kvar en position.
      kinds: { offset: 0.5, delay: 0.7, rotate: 1, reverse: 1, lead: 0.8, freeze: 0.4, own: 1 } },

    // Nivå 5: skuggan kopplar loss helt och lever sitt eget liv (ghostRate > 0 först här)
    // Den sista nivån har högst intensitet och alla kroppsdelar och avvikelsetyper kan väljas.
    // ghostRate gör dessutom att skuggan ibland kan lämna den vanliga speglingen helt.
    { rate: 0.5, maxParts: 3, intensity: 1, durMin: 2, durMax: 5, calmChance: 0.1, calmMin: 1, calmMax: 2,
      blinkChance: 0.25, blinkMin: 1.2, blinkMax: 3, ghostRate: 0.5, ghostMin: 7, ghostMax: 11,
      // Alla kroppsdelar har nu full vikt och kan därför väljas.
      partW: { head: 1, lArm: 1, rArm: 1, lLeg: 1, rLeg: 1, upper: 1 },
      // Samtliga rörelsetyper är aktiverade. Det ger störst variation i hur skuggan kan bete sig.
      kinds: { offset: 0.5, delay: 0.7, rotate: 1, reverse: 1, lead: 1, freeze: 1, own: 1 } }
  ]
};