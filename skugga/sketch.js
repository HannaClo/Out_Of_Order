
// sketch.js – huvudprogram
// Tangenter: C kalibrering (där M speglar) | 1 DEMO | 2 ANVÄNDARLÄGE
// Demo kan också startas med index.html?demo

// Här deklarerar jag variablerna som används för att hålla reda på programmets olika delar.
// De får sina värden när setup() körs. Genom att deklarera dem här kan jag använda dem
// i flera funktioner, till exempel både i setup(), draw() och keyPressed().
let model, video, tracker, timeline, behavior, renderer, env, audio, bgImg, calMode = false, demoMode = false;

// Hanterar uttoning och återstart när alla nivåer är klara.
let finishFadeAt = null;
let finishResetDone = false;

const FADE_SECS = 2;
const HOLD_SECS = 1;

// BONES beskriver vilka leder som ska kopplas ihop när kroppen ritas som ett skelett.
// Varje inre array innehåller två lednamn som bildar ett ben eller en kroppsdel.
// Listan används som en gemensam beskrivning av kroppens skelettstruktur.
const BONES = [['left_shoulder','right_shoulder'],['left_shoulder','left_elbow'],['left_elbow','left_wrist'],
  ['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['left_shoulder','left_hip'],['right_shoulder','right_hip'],
  ['left_hip','right_hip'],['left_hip','left_knee'],['left_knee','left_ankle'],['right_hip','right_knee'],['right_knee','right_ankle']];

function preload() {
  // preload() körs av p5.js innan setup().
  // Jag använder den för att ladda in sådant som behövs när upplevelsen startar.

  // Här skapar jag en MoveNet-modell genom ml5.js.
  // MULTIPOSE_LIGHTNING innebär att modellen är inställd på att kunna hitta flera personer
  // och att den använder en snabb modellvariant.
  model = ml5.bodyPose('MoveNet', { modelType: 'MULTIPOSE_LIGHTNING' });

  // Jag försöker ladda bakgrundsbilden som anges i CONFIG.env.image.
  // Om ingen bild har angetts använder jag filnamnet bakgrund.jpg.
  // Den sista callback-funktionen körs om bilden inte kan laddas och sätter då bgImg till null.
  // Det gör att resten av programmet kan använda sin reservbakgrund i stället.
  bgImg = loadImage((CONFIG.env && CONFIG.env.image) || 'bakgrund.jpg', () => {}, () => { bgImg = null; }); // saknas bilden används reservbakgrund
}

function setup() {
  // setup() körs en gång när p5.js startar själva programmet.

  // Jag skapar canvasen och låter den fylla hela webbläsarfönstret.
  // pixelDensity(1) gör att canvasen använder en pixel per skärmpixel,
  // vilket ger mer förutsägbar prestanda och koordinathantering.
  createCanvas(windowWidth, windowHeight); pixelDensity(1);

  // Jag startar kamerainhämtningen och väljer en videostorlek på 640 x 480 pixlar.
  // hide() gör att själva videoelementet inte visas direkt på sidan.
  // Kamerabilden används i stället som underlag för kroppsspårningen.
  video = createCapture(VIDEO); video.size(640, 480); video.hide();

  // Jag skapar kroppsspåraren med projektets inställningar och kopplar den till kameran
  // och MoveNet-modellen. start() startar själva spårningen.
  tracker = new BodyTracker(CONFIG); tracker.start(video, model);

  // Här skapar jag de objekt som styr tidslinjen, skuggans beteende och själva ritningen.
  // Timeline hanterar nivåernas förlopp, ShadowBehavior bestämmer hur skuggan avviker
  // från personen och ShadowRenderer ansvarar för att rita skuggan.
  timeline = new Timeline(CONFIG); behavior = new ShadowBehavior(); renderer = new ShadowRenderer(CONFIG);

  // Jag skapar miljön med inställningarna och den bakgrundsbild som laddades i preload().
  env = new Environment(CONFIG, bgImg);

  // Jag skapar ljudsystemet och kopplar det till miljön.
  // Det gör att miljön kan använda ljudets puls som underlag för ljuseffekterna.
  audio = new ShadowAudio(CONFIG); env.audio = audio;

  // Jag försöker starta ljudet direkt.
  // Webbläsare kan blockera ljud som startar utan att användaren har klickat,
  // så ljudet kan också behöva startas genom ett senare klick.
  audio.start(); // startar direkt om webbläsaren tillåter, annars vid första klicket

  // Jag avgör om programmet ska starta i demoläge.
  // Det kan antingen styras av CONFIG.mode eller genom att URL:en innehåller parametern demo.
  // URLSearchParams gör det möjligt att läsa parametrar från webbadressen.
  demoMode = CONFIG.mode === 'demo' || new URLSearchParams(location.search).has('demo');

  // Om demoläget är aktivt ställer jag in tidslinjen på demo.
  // millis() ger tiden sedan p5-programmet startade, och jag omvandlar millisekunder till sekunder.
  if (demoMode) timeline.setDemo(0, millis() / 1000);
}

function finishFade(now) {
  // Starta övergången första gången tidslinjen blir färdig.
  if (timeline.state === 'finished' && finishFadeAt === null) {
    finishFadeAt = now;
    finishResetDone = false;
  }

  if (finishFadeAt === null) return 0;

  const elapsed = now - finishFadeAt;

  // Fasa till svart under FADE_SECS.
  if (elapsed < FADE_SECS) {
    return constrain(elapsed / FADE_SECS, 0, 1);
  }

  // Håll skärmen svart och återställ tidslinjen efter pausen.
  if (elapsed < FADE_SECS + HOLD_SECS) {
    return 1;
  }

  if (!finishResetDone) {
    timeline.reset();
    finishResetDone = true;
  }

  // Fasa tillbaka från svart.
  const fadeIn = elapsed - FADE_SECS - HOLD_SECS;
  const alpha = 1 - constrain(fadeIn / FADE_SECS, 0, 1);

  // Avsluta övergången när intoningen är klar.
  if (fadeIn >= FADE_SECS) {
    finishFadeAt = null;
    finishResetDone = false;
    return 0;
  }

  return alpha;
}

function draw() {
  // draw() är p5.js huvudloop och körs om och om igen, vanligtvis många gånger per sekund.
  // Det är här jag uppdaterar spårningen, räknar ut skuggans beteende och ritar varje bildruta.

  // now är programmets aktuella tid i sekunder.
  // dt är tiden som gått sedan föregående bildruta.
  // Jag begränsar dt till högst 0.1 sekunder så att ett tillfälligt bildrutestopp
  // inte orsakar ett alltför stort hopp i tidsbaserade beräkningar.
  const now = millis() / 1000, dt = Math.min(deltaTime / 1000, 0.1);

  // Jag uppdaterar kroppsspåraren så att den kan ta hänsyn till den senaste kamerabilden.
  tracker.update(now);

  // Här kontrollerar jag hur länge en person har varit frånvarande.
  // Resultatet används sedan av tidslinjen och för att tona bort skuggan.
  const absent = tracker.absentFor(now);

  // Jag uppdaterar tidslinjen med information om personen är närvarande,
  // hur länge personen har varit borta och den aktuella tiden.
  // Det gör att tidslinjen kan hantera nivåernas förlopp och eventuell återställning.
  timeline.update(absent === 0, absent, now);

  // Om upplevelsen inte är i tillståndet running återställer jag skuggans beteende.
  // Det innebär att tidigare avvikelser och tillfälliga rörelseeffekter inte ligger kvar.
  if (timeline.state !== 'running') behavior.reset();

  // Jag tar reda på om upplevelsen körs just nu.
  // Om den gör det hämtar jag den aktuella nivån från tidslinjen.
  // lvl blir nivåns index, eller 0 om det inte finns någon aktiv nivå.
  const running = timeline.state === 'running', lv = running ? timeline.level(now) : null, lvl = lv ? lv.index : 0,

        // fade styr hur synlig skuggan ska vara när personen försvinner.
        // Efter en kort nådatid börjar värdet minska från 1 till 0.
        // constrain begränsar resultatet så att det aldrig hamnar utanför intervallet 0–1.
        fade = 1 - constrain((absent - 0.5) / 1.5, 0, 1);

  // Pose först (behövs av både ljus och ljud), ritning sen
  // J innehåller kroppens ledpunkter när de har bearbetats.
  // dev är ett värde som beskriver hur mycket skuggan avviker från personens rörelser.
  let J = null, dev = 0;

  // Jag fortsätter bara med kroppens positioner om spåraren har hittat leder
  // och personen fortfarande har ett positivt fade-värde.
  if (tracker.joints && fade > 0) {

    // Jag omvandlar först kamerans ledkoordinater till skärmkoordinater med renderer.mapPose().
    // withVirtual lägger till virtuella leder som behövs för att beskriva kroppen,
    // exempelvis en beräknad mittpunkt eller halsposition.
    const Jr = withVirtual(renderer.mapPose(tracker.joints, tracker.vw, tracker.vh));

    // Jr är den ursprungliga, omräknade kroppsställningen innan skuggans beteende förändras.
    J = Jr;

    // Om upplevelsen körs i användarläge använder jag ShadowBehavior för att skapa avvikelser.
    // I demoläget gör jag inte detta, vilket innebär att skuggan följer den bearbetade kroppsställningen
    // utan att få dessa extra beteendeförändringar.
    if (running && !demoMode) { J = behavior.apply(Jr, dt, now, timeline.params(now)); dev = deviation(Jr, J); }
  }

  // Jag samlar information som miljön behöver för att anpassa ljuset.
  // normal beskriver hur mycket skuggan tillfälligt går tillbaka mot normal spegling.
  // ghost visar om skuggan befinner sig i ett frikopplat spöktillstånd.
  // dev beskriver avvikelsen och shadowX anger skuggans ungefärliga position i sidled.
  const fx = { normal: behavior.nw || 0, ghost: !!behavior.ghost, dev, shadowX: J ? J.hipMid.x : width / 2 };

  // Jag ritar miljöns bakgrund och ljuseffekter.
  // Den får bland annat veta vilken nivå som är aktiv och hur skuggan beter sig.
  env.draw(now, lvl, fx);

  // Jag uppdaterar ljudsystemet med information om den aktuella situationen.
  // Nivå och tid används för att anpassa ljudet till tidslinjen.
  // nextIn räknar ut hur lång tid som återstår till nästa nivå när det är relevant.
  // normal och ghost skickar vidare skuggans aktuella tillstånd.
  // pan räknar om skuggans horisontella position till ett värde mellan -1 och 1,
  // vilket kan användas för att placera ljudet åt vänster eller höger.
  audio.update(now, {
    level: running ? lvl : -1, t: lv ? lv.t : 0,
    nextIn: running && lvl < CONFIG.levelDurations.length - 1 && timeline.demoLevel == null ? CONFIG.levelDurations[lvl] - lv.t : null,
    normal: fx.normal, ghost: fx.ghost, dev, pan: (fx.shadowX / width) * 2 - 1
  });

  // Om det finns en kroppsställning ritar jag skuggan.
  // Jag skickar med fade för genomskinligheten, miljöns puls och golvlinjens position.
  if (J) renderer.drawShadow(J, fade, env.pulse(now), env.floorLine);

  // Nivå-HUD visas bara i användarläget
  // Jag hämtar HTML-elementet som visar vilken nivå användaren befinner sig på.
  const hud = document.getElementById('level-hud');
  if (hud) {
    // I användarläget visar jag aktuell nivå och det totala antalet nivåer.
    if (!demoMode) hud.textContent = `NIVÅ ${lvl + 1}/${CONFIG.levelDurations.length}`;

    // I demoläget döljer jag nivåinformationen.
    // Annars visas den som ett blockelement.
    hud.style.display = demoMode ? 'none' : 'block';
  }

  // Om kalibreringsläget är aktivt ritar jag extra information (kamerarektangel, nivå, fps och kalibreringsvärden).
  if (calMode) debugOverlay(now);

  // Tonar till svart när alla nivåer är färdiga,
// återställer tidslinjen och tonar sedan tillbaka.
const finishAlpha = finishFade(now);

if (finishAlpha > 0) {
  push();
  noStroke();
  fill(0, finishAlpha * 255);
  rect(0, 0, width, height);
  pop();
}
}

// Hur mycket skuggan avviker från personen: medelavstånd / axelbredd, 0..1
function deviation(A, B) {
  // Jag använder avståndet mellan axlarna som ett mått på personens storlek.
  // Minsta värdet är 40 pixlar så att beräkningen inte blir instabil om axlarna ligger nära varandra.
  const S = Math.max(40, Math.hypot(A.left_shoulder.x - A.right_shoulder.x, A.left_shoulder.y - A.right_shoulder.y));

  // sum samlar ihop avstånden mellan motsvarande leder i de två kroppsställningarna.
  // n räknar hur många leder som jämförs.
  let sum = 0, n = 0;

  // KP innehåller de ledpunkter som ska användas i jämförelsen.
  // För varje punkt räknar jag det raka avståndet mellan personens och skuggans position.
  for (const k of KP) { sum += Math.hypot(A[k].x - B[k].x, A[k].y - B[k].y); n++; }

  // Jag räknar ut medelavståndet, delar det med axelbredden för att få ett relativt mått
  // och begränsar slutresultatet till 1.
  // På så sätt blir avvikelsen mindre beroende av hur nära kameran personen står.
  return Math.min(1, sum / n / S / 1.2);
}

// Funktionen finns kvar men ritar ingen synlig överlagring i demoläget.
function demoOverlay() {} // ingen synlig demo-overlay

function debugOverlay(now) {
  // Jag omvandlar kamerabildens övre vänstra och nedre högra hörn till skärmkoordinater.
  // Dessa punkter används för att rita en rektangel som visar var kamerabilden hamnar på canvasen.
  const a = renderer.mapPoint({ x: 0, y: 0 }, tracker.vw, tracker.vh), b = renderer.mapPoint({ x: tracker.vw, y: tracker.vh }, tracker.vw, tracker.vh),

        // Jag hämtar den aktiva nivån om tidslinjen körs, samt renderer-objektets kalibreringsvärden.
        lv = timeline.state === 'running' ? timeline.level(now) : null, c = renderer.cal;

  // Jag ritar en röd rektangel runt det område där kamerabilden mappas.
  noFill(); stroke(255, 80, 80); strokeWeight(2);
  rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));

  // Jag ställer in textens utseende och visar information om programmets tillstånd.
  // Informationen innehåller bland annat aktuell nivå och bildfrekvensen (fps).
  noStroke(); fill(255); textSize(14);

  // Om kalibreringsläget är aktivt lägger jag även till värden för position och skala.
  // toFixed(2) gör att värdena visas med två decimaler.
  text(`${timeline.state}  nivå ${lv ? lv.index + 1 : '-'}  fps ${frameRate().toFixed(0)}` +
    (calMode ? `  [KALIBRERING offX ${c.offX.toFixed(2)} offY ${c.offY.toFixed(2)} skala ${c.scale.toFixed(2)}]` : ''), 12, height - 14);
}

// När användaren klickar med musen försöker jag starta ljudet igen.
// Det är särskilt användbart om webbläsaren har blockerat ljud vid sidans start.
function mousePressed() { audio.start(); }

function keyPressed() {
  // Jag hämtar aktuell tid och gör om den tryckta tangenten till små bokstäver.
  // Då kan jag jämföra tangenter som D och d på samma sätt.
  const now = millis() / 1000, kl = key.toLowerCase();

  // M används bara i kalibreringsläget, där den växlar mellan speglad och ospeglad visning.
  // Utanför kalibreringen gör M ingenting. return gör att tangenten inte hanteras två gånger längre ner.
  if (kl === 'm') { if (calMode) renderer.calKey(keyCode, key); return; }

  // C växlar kalibreringsläget.
  if (kl === 'c') calMode = !calMode;

  // Tangent 1 aktiverar demoläget och startar tidslinjen från början.
  if (key === '1') { demoMode = true; timeline.setDemo(0, now); }

  // Tangent 2 stänger av demoläget och återgår till användarläget.
  if (key === '2') { demoMode = false; timeline.clearDemo(); }

  // Om kalibreringsläget är aktivt skickar jag tangenttryckningen vidare till renderern.
  // Där hanteras bland annat piltangenterna för att flytta skuggan och tangenterna för att ändra skalan.
  if (calMode) renderer.calKey(keyCode, key);
}

// Den här funktionen körs när webbläsarfönstrets storlek ändras.
// Jag anpassar canvasen till den nya bredden och höjden så att den fortsätter fylla fönstret.
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
