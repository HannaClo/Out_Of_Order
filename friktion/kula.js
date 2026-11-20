// kula.js: huvudfilen för världen med kulan på backen (p5.js + ml5 handPose)
// Här finns fysiken för de fem nivåerna, handstyrningen, ritningen av scenen och kopplingen till Ljud.

// Här samlar jag alla inställningar som jag kan ändra utan att röra resten av koden.
// LEVEL_DURATION är hur lång en nivå får vara. 1 / 0 är Infinity, alltså byter nivån aldrig av sig själv på tid.
// LEVEL_COUNT är antal nivåer och FADE_SECS hur lång nedtoningen till svart tar.
// HOLD_SECS är hur länge skärmen hålls svart, GRABS_PER_LEVEL hur många grepp som krävs för att gå vidare.
// MIN_GRAB_SECS är kortaste tid ett grepp måste hållas för att räknas, och NEXT_LEVEL_DELAY_SECS väntetiden efter sista släppet.
// BALL_RADIUS är kulans radie i pixlar. SLOPE_START_X, SLOPE_START_Y_RATIO, SLOPE_END_Y_RATIO och GRAVITY_ALONG_SLOPE är äldre backe- och tyngdvärden.
// MAX_POINTER_SPEED är största hastighet som musen eller fingret kan ge kulan.
// BACKGROUND_IMAGE är filen som används som rum. BG_DIM, BG_FLOOR_Y och BG_KEEP_LIGHTS styr hur bakgrundsbilden behandlas.
// BALL_ENV_GAIN, BALL_BRIGHTNESS, BALL_STUDIO och BALL_NEON styr hur kulans yta ser ut.
// MOTION_BLUR och TRAIL_STRENGTH styr rörelseoskärpa och ljussvans.
// STAGE_FX slår på scenljuset, och SMOKE, SMOKE_AMBIENT, SMOKE_OPACITY, SMOKE_MAX, STAGE_BEAMS och RAVE_STROBE styr rök, strålkastare och blixt.
// ADAPTIVE_QUALITY gör att kvaliteten kan sänkas automatiskt om datorn blir för långsam.
const LEVEL_DURATION = 1 / 0, LEVEL_COUNT = 5, FADE_SECS = 2, HOLD_SECS = 1, GRABS_PER_LEVEL = 2, MIN_GRAB_SECS = 0.4, NEXT_LEVEL_DELAY_SECS = 1, BALL_RADIUS = 50, SLOPE_START_X = 55, SLOPE_START_Y_RATIO = 0.3, SLOPE_END_Y_RATIO = 0.82, GRAVITY_ALONG_SLOPE = 230, MAX_POINTER_SPEED = 1500, BACKGROUND_IMAGE = "bakgrund.jpg", BG_DIM = 0, BG_FLOOR_Y = null, BG_KEEP_LIGHTS = !1, BALL_ENV_GAIN = 1.8, BALL_BRIGHTNESS = 1, BALL_STUDIO = 1, BALL_NEON = 0.6, MOTION_BLUR = 1, TRAIL_STRENGTH = 1, STAGE_FX = !0, SMOKE = 1.7, SMOKE_AMBIENT = 0.35, SMOKE_OPACITY = 0.6, ADAPTIVE_QUALITY = !0, SMOKE_MAX = 320, STAGE_BEAMS = 1.5, RAVE_STROBE = 1,

// LEVELS innehåller fysikvärdena för varje nivå.
// Nivå 1–4 använder gravity (tyngd längs backen), damping (hur snabbt farten bromsas) och rollingResistance (extra motstånd).
// Nivå 5 använder i stället omega och zeta, som styr en dämpad svängning mot en punkt.
LEVELS = {
  1: { gravity: 230, damping: 0.1, rollingResistance: 0 },
  2: { gravity: 230, damping: 0.55, rollingResistance: 205 },
  3: { gravity: 230, damping: 0.12, rollingResistance: 0 },
  4: { gravity: 230, damping: 0.32, rollingResistance: 0 },
  5: { omega: 2.7, zeta: 0.16 }
};

// Här deklarerar jag variablerna som håller reda på spelets tillstånd.
// mode är "demo" eller "user", started säger om världen har startats och level är aktuell nivå.
// levelStartedAt sparar när nivån startade.
// ball är själva kulan. x och y är position, vx och vy är hastighet och held säger om den hålls fast.
// holdOffsetX och holdOffsetY är avståndet mellan kulan och pekaren när jag greppar den.
// previousPointerX och previousPointerY används för att räkna ut pekarens hastighet.
// releaseSpeed och releaseTime sparar hur snabbt och när kulan släpptes.
// level4Phase håller reda på vilket steg nivå 4 är i, brakeHits vilka bromszoner kulan passerat på nivå 3, och sleeping om kulan står stilla.
// slope är backens start- och slutpunkt, lastFrameTime förra bildens tid och sens en känslighetsfaktor.
let mode = "demo", started = !1, level = 1, levelStartedAt = 0, ball = {
  x: 55,
  y: 0,
  vx: 0,
  vy: 0,
  held: !1,
  holdOffsetX: 0,
  holdOffsetY: 0,
  previousPointerX: 0,
  previousPointerY: 0,
  releaseSpeed: 0,
  releaseTime: 0,
  level4Phase: 0,
  brakeHits: [!1, !1, !1],
  sleeping: !1
}, slope = { x1: 55, y1: 0, x2: 0, y2: 0 }, lastFrameTime = 0, sens = 1;

// Rullning: x'=v, v'=a-λv (viskös dämpning), nivå 1-4
// Den här klassen räknar ut kulans rörelse när den rullar.
// Hastigheten ändras av accelerationen minus dämpningen gånger hastigheten, och positionen ändras av hastigheten.
class RollingTransferFunction {
  // Konstruktorn startar med position och hastighet noll.
  constructor() {
    this.position = 0, this.velocity = 0;
  }
  // reset sätter position och hastighet till nya värden, till exempel när kulan släpps.
  reset(position, velocity = 0) {
    this.position = position, this.velocity = velocity;
  }
  // update tar ett tidssteg framåt. h är tidssteget men begränsat till högst 1/30 sekund så att fysiken inte skenar vid lagg.
  // Först uppdateras hastigheten, sedan positionen, och den nya positionen returneras.
  update(acceleration, damping, dt) {
    const h = Math.min(dt, 0.03333333333333333);
    return this.velocity += (acceleration - damping * this.velocity) * h, this.position += this.velocity * h, this.position;
  }
}

// Dämpad svängning mot ett mål (ζ<1), nivå 5
// Den här klassen fungerar som en fjäder med dämpning. Kulan dras mot ett mål och svänger förbi det några gånger innan den lugnar sig.
// omega är hur stark fjädern är och zeta hur kraftigt svängningen dämpas (under 1 betyder att den svänger).
class OscillatorTransferFunction {
  // Konstruktorn sparar omega och zeta och börjar med position och hastighet noll.
  constructor(omega, zeta) {
    this.omega = omega, this.zeta = zeta, this.position = 0, this.velocity = 0;
  }
  // reset sätter position och hastighet till nya värden.
  reset(position, velocity = 0) {
    this.position = position, this.velocity = velocity;
  }
  // update tar ett tidssteg framåt, högst 1/60 sekund.
  // Accelerationen a dras mot målet och bromsas av hastigheten. Sedan uppdateras hastighet och position.
  update(target, dt) {
    const h = Math.min(dt, 0.016666666666666666), a = this.omega * this.omega * (target - this.position) - 2 * this.zeta * this.omega * this.velocity;
    return this.velocity += a * h, this.position += this.velocity * h, this.position;
  }
}

// Här skapar jag ett rullningsobjekt som delas av nivå 1–4.
// oscillatorTF skapas senare eftersom den behöver värden från LEVELS.
// De andra variablerna hör till handtrackingen:
// video är kamerabilden, handPose är ml5-modellen och hands är senaste resultatet från den.
// handTrackingReady säger om modellen har laddats och wasPinching om handen just nu håller kulan.
// handTargetX är var handen vill ha kulan, handVelocity handens hastighet i sidled och lastHandPredictionTime tiden för senaste handbilden.
// fistFrames, openFrames och lostHandFrames räknar hur många bilder i rad handen varit knuten, öppen eller borta.
// lastHudUpdate säger när texten på skärmen senast uppdaterades.
const rollingTF = new RollingTransferFunction();
let oscillatorTF = null, video = null, handPose = null, hands = [], handTrackingReady = !1, wasPinching = !1, handTargetX = null, handVelocity = 0, lastHandPredictionTime = 0, fistFrames = 0, openFrames = 0, lostHandFrames = 0, lastHudUpdate = 0;

// perf mäter hur lång tid en bild tar (ms) och q är en kvalitetsfaktor mellan 0,3 och 1 som sänks om datorn har det jobbigt.
const perf = { ms: 16.7, q: 1 };

// Handtracking: startar kamera + ml5 handPose
function setupHandTracking() {
  // Först kontrollerar jag att ml5 har laddats. Om inte skriver jag ett felmeddelande och avbryter.
  if (typeof ml5 > "u" || !ml5.handPose) {
    console.error("ml5 1.x (ml5.handPose) kunde inte laddas - kontrollera scriptet i index.html.");
    return;
  }
  // Här startar jag kameran i storleken 640x480 och döljer själva videoelementet, eftersom jag bara behöver bilden för analysen.
  // Sedan skapar jag handPose-modellen med en enda hand och den lätta modellen. När den är redo börjar den analysera videon
  // och skickar varje resultat till gotPose.
  video = createCapture(VIDEO), video.size(640, 480), video.hide(), handPose = ml5.handPose({ maxHands: 1, modelType: "lite", flipped: !1 }, function() {
    console.log("HandPose-modellen \xE4r redo!"), handTrackingReady = !0, handPose.detectStart(video, gotPose);
  });
}

// Text till HUD:en om handens status
// Funktionen returnerar en text beroende på om kulan hålls, om ingen hand syns eller om handen är redo att greppa.
function handStatus() {
  return wasPinching ? "Greppar kulan" : !hands || hands.length === 0 ? "Ingen hand syns" : "Knyt n\xE4ven f\xF6r att greppa kulan";
}

// Knuten hand = fingrar närmare handleden än fingrarnas basled
// landmarks är handens 21 punkter. Jag jämför avståndet från handleden (punkt 0) till fingrarnas toppar (8)
// med avståndet från handleden till fingrarnas bas (5). Är topparna närmare är handen knuten.
// Grepp med minst två av tre fingrar
function isFist(landmarks) {
  const wrist = landmarks[0];

  // Pekfinger, långfinger och ringfinger
  const fingers = [
    { base: 5, tip: 8 },
    { base: 9, tip: 12 },
    { base: 13, tip: 16 }
  ];

  let bentFingers = 0;

  for (const finger of fingers) {
    const base = landmarks[finger.base];
    const tip = landmarks[finger.tip];

    if (
      dist(tip[0], tip[1], wrist[0], wrist[1]) <
      dist(base[0], base[1], wrist[0], wrist[1])
    ) {
      bentFingers++;
    }
  }

  return bentFingers >= 2;
}

// Anropas av ml5 vid varje kamerabild: greppa/följ/släpp med handen
function gotPose(results) {
  // Jag sparar resultatet i hands. Om en nedtoning pågår (fadeAt) ignorerar jag handen.
  // Om en hand syns räknas det som aktivitet, så att inaktivitetstiden nollställs.
  // Om ingen hand syns räknar jag upp lostHandFrames, och efter 8 bilder utan hand släpps kulan om den hölls.
  if (hands = results, fadeAt !== null) return;
  if (results && results.length > 0 && markActive(), !results || results.length === 0) {
    lostHandFrames++, wasPinching && lostHandFrames >= 8 && releaseHandBall();
    return;
  }
  // En hand syns, så räknaren nollställs.
  // Jag hämtar handens punkter som [x, y]-par och kontrollerar att det finns alla 21.
  lostHandFrames = 0;
  const kp = results[0].keypoints, landmarks = kp ? kp.map((k) => [k.x, k.y]) : null;
  if (!landmarks || landmarks.length < 21) return;
  // Här avgör jag om handen är knuten och räknar hur många bilder i rad den varit knuten eller öppen.
  // Det gör att ett enstaka felaktigt resultat inte räcker för att greppa eller släppa.
  const now = millis(), fistClosed = isFist(landmarks);
  fistClosed ? (fistFrames++, openFrames = 0) : (openFrames++, fistFrames = 0);
  // palm är handflatans mitt (punkt 9). Jag översätter dess x-läge i kamerabilden till x-läge på skärmen och spegelvänder det.
  // safeX begränsar det så att kulan hålls inom backen.
  const palm = landmarks[9], rawX = map(palm[0], 0, video.elt && video.elt.videoWidth || video.width, width, 0), safeX = constrain(rawX, slope.x1 + 50, width - 50);
  // Efter 3 knutna bilder i rad greppas kulan.
  // Då nollställs inaktivitetstimern, greppet registreras och kulan flyttas till handen med hastighet noll.
  if (!wasPinching && fistFrames >= 3 && (window.resetInactivityTimer?.(), wasPinching = !0, noteGrabStart(), handTargetX = safeX, handVelocity = 0, lastHandPredictionTime = now, ball.x = safeX, ball.y = slopeY(ball.x) - 50, ball.vx = 0, ball.vy = 0, ball.held = !0, ball.sleeping = !1), wasPinching && fistClosed) {
    // Medan handen håller kulan räknar jag ut ett mjukt mål (handTargetX) och handens hastighet.
    // dt är tiden sedan förra handbilden, begränsad mellan 0,02 och 0,15 sekunder.
    // Hastigheten begränsas till ±500 och jämnas ut så att släppet inte blir ryckigt.
    const dt = Math.max(0.02, Math.min(0.15, (now - lastHandPredictionTime) / 1e3)), previousTarget = handTargetX;
    handTargetX = lerp(handTargetX, safeX, 0.65);
    const rawVelocity = (handTargetX - previousTarget) / dt;
    handVelocity = lerp(handVelocity, constrain(rawVelocity, -500, 500), 0.4), lastHandPredictionTime = now;
  }
  // Efter 4 öppna bilder i rad släpps kulan.
  wasPinching && openFrames >= 4 && releaseHandBall();
}

// Flyttar kulan mot handen varje ritad bild (tidsbaserat)
function updateHandControl() {
  // Funktionen gör inget om världen inte startat, om kulan inte hålls eller om det inte finns något mål.
  if (!started || !wasPinching || handTargetX === null) return;
  // hdt är tiden sedan förra bilden. since är tiden sedan senaste handbilden, och aim är målpositionen
  // med lite förutsägelse framåt utifrån handens hastighet.
  const hdt = Math.min(0.05, Math.max(1e-3, deltaTime / 1e3)), since = Math.min(0.12, (millis() - lastHandPredictionTime) / 1e3), aim = constrain(handTargetX + handVelocity * since, slope.x1 + 50, width - 50);
  // Kulan flyttas en bit mot målet varje bild (oberoende av bildfrekvensen), placeras på backen och får handens hastighet.
  ball.x += (aim - ball.x) * (1 - Math.exp(-hdt * 16)), ball.y = slopeY(ball.x) - 50, ball.vx = handVelocity, ball.vy = 0, ball.held = !0, ball.sleeping = !1;
}

// Släpper kulan från handen och ger den handens hastighet
function releaseHandBall() {
  // Först nollställer jag inaktivitetstimern, registrerar släppet och spelar ljudet drop.
  // Ju snabbare handen rör sig, desto starkare blir ljudet.
  window.resetInactivityTimer?.(), noteRelease(), snd("drop", 0.7 + Math.min(0.3, Math.abs(handVelocity) / 1500)),
  // Sedan släpps kulan med handens hastighet, och rullningsfunktionerna startas om från den positionen och hastigheten.
  // På nivå 4 i användarläget startar första fasen av den speciella rörelsen.
  ball.held = !1, ball.releaseSpeed = handVelocity, ball.vx = handVelocity, ball.releaseTime = millis() / 1e3, rollingTF.reset(ball.x, ball.vx), oscillatorTF && oscillatorTF.reset(ball.x, ball.vx), mode === "user" && level === 4 && (ball.level4Phase = 1),
  // Till sist nollställs alla handvariabler så att nästa grepp börjar rent.
  wasPinching = !1, handTargetX = null, handVelocity = 0, lastHandPredictionTime = 0, fistFrames = 0, openFrames = 0;
}

// bgImg är bakgrundsbilden, bgNote en text om den, och ballEnv miljön som speglas i kulan.
let bgImg = null, bgNote = "", ballEnv = null;

// Bakgrundsbild: ladda, rita, välj fil (B) och dra-och-släpp
// loadBackground laddar en bild. När den är klar sparas den, scenen byggs om och texten uppdateras.
function loadBackground(src) {
  const im = new Image();
  im.onload = () => {
    bgImg = im, bgNote = "bakgrund.jpg", buildScene(), updateHud();
  }, im.src = src;
}
// paintBackgroundImage ritar bilden så att den fyller hela canvasen utan att sträckas (den skalas och centreras).
function paintBackgroundImage(g, W, H) {
  const s = Math.max(W / bgImg.width, H / bgImg.height), w = bgImg.width * s, h = bgImg.height * s;
  g.imageSmoothingQuality = "high", g.drawImage(bgImg, (W - w) / 2, (H - h) / 2, w, h);
}
// bgPicker är ett dolt filväljarelement som öppnas med tangenten B.
let bgPicker = null;
function initBackground() {
  // Jag skapar ett dolt filfält som bara tar bilder. När en fil väljs laddas den som bakgrund.
  bgPicker = document.createElement("input"), bgPicker.type = "file", bgPicker.accept = "image/*", bgPicker.style.display = "none", document.body.appendChild(bgPicker), bgPicker.onchange = () => {
    bgPicker.files[0] && loadBackground(URL.createObjectURL(bgPicker.files[0])), bgPicker.value = "";
  },
  // Här gör jag det möjligt att dra och släppa en bildfil på fönstret.
  // Webbläsarens standardbeteende stoppas och den första bilden som hittas används som bakgrund.
  window.addEventListener("dragover", (e) => e.preventDefault()), window.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find((f2) => f2.type.startsWith("image/"));
    f && loadBackground(URL.createObjectURL(f));
  }),
  // Till sist laddas standardbakgrunden om en sådan är angiven.
  BACKGROUND_IMAGE && loadBackground(BACKGROUND_IMAGE);
}

// fadeAt är tiden då nedtoningen startade (null om ingen pågår) och lastAct tiden för senaste aktivitet.
let fadeAt = null, lastAct = performance.now();

// musicLevel avgör vilken musiknivå som ska spelas: demoläget använder alltid nivå 3, annars aktuell nivå.
// snd är ett säkert sätt att anropa Ljud. Om Ljud saknas eller något går fel skrivs bara en varning, så att spelet fortsätter.
// fadeEl hämtar det svarta elementet som används för nedtoningen.
const musicLevel = () => mode === "demo" ? 3 : level, snd = (fn, ...a) => {
  try {
    if (typeof Ljud < "u" && Ljud[fn]) return Ljud[fn](...a);
  } catch (e) {
    console.warn("Ljud:", fn, e);
  }
}, fadeEl = () => document.getElementById("fade");

// Nedtoning/återställning, grepp- och nivåräkning
// markActive sparar tiden för senaste aktivitet.
function markActive() {
  lastAct = performance.now();
}
// requestReset startar en nedtoning, men bara om världen är igång och ingen nedtoning redan pågår.
function requestReset() {
  fadeAt === null && started && (fadeAt = performance.now());
}

// Tonar ut till svart, håller, återställer
function updateFade() {
  if (fadeAt === null) return;
  // e är antal sekunder sedan nedtoningen startade.
  // Efter 3 sekunder är allt klart: världen återställs, svärtan tas bort och ljudet startar om med en ny inton.
  const e = (performance.now() - fadeAt) / 1e3;
  if (e >= 3) {
    fadeAt = null, resetWorld(), fadeEl().style.opacity = 0, snd("reset"), snd("fadeIn", 1.6);
    return;
  }
  // Under de första 2 sekunderna ökar svärtan från 0 till 1, och ljudet tonas ner lika mycket.
  const fa = Math.min(1, e / 2);
  fadeEl().style.opacity = fa, snd("setFade", fa);
}
// grabCount räknar grepp på nivån, grabStartedAt är när senaste greppet började och advanceArmedAt när nivåbytet har "laddats".
let grabCount = 0, grabStartedAt = 0, advanceArmedAt = null;
// clearGrabs nollställer greppräkningen och avbryter ett väntande nivåbyte.
function clearGrabs() {
  grabCount = 0, advanceArmedAt = null;
}
// noteGrabStart sparar tiden när ett grepp börjar.
function noteGrabStart() {
  grabStartedAt = performance.now();
}

// Räknar ett grepp om det hållits minst MIN_GRAB_SECS
function noteRelease() {
  // Inget räknas om världen inte startat, om det inte är användarläge, om en nedtoning pågår eller om greppet var kortare än 0,4 sekunder.
  // Annars räknas greppet upp, och efter två grepp laddas nivåbytet.
  !started || mode !== "user" || fadeAt !== null || performance.now() - grabStartedAt < 0.4 * 1e3 || (grabCount++, markActive(), grabCount >= 2 && (advanceArmedAt = performance.now()));
}

// Byter nivå NEXT_LEVEL_DELAY_SECS efter sista släppet
function updateGrabProgress() {
  if (!(advanceArmedAt === null || fadeAt !== null)) {
    // Om kulan greppas igen innan tiden gått avbryts nivåbytet.
    if (ball.held || wasPinching) {
      advanceArmedAt = null;
      return;
    }
    // Annars byts nivå när en sekund har gått sedan sista släppet.
    performance.now() - advanceArmedAt >= 1 * 1e3 && advanceLevel();
  }
}
// advanceLevel går till nästa nivå. Efter nivå 5 startas en nedtoning och återställning i stället.
function advanceLevel() {
  clearGrabs(), level >= 5 ? requestReset() : setLevel(level + 1);
}

// Tillbaka till början: användarläge, nivå 1
function resetWorld() {
  mode = "user", level = 1, levelStartedAt = millis() / 1e3, clearGrabs(), fx.sparks.length = 0, fx.trail.length = 0, resetBall(), markActive(), updateHud(), updateInfo();
}

// Startknappen: startar världen och ljudet
function startWorld() {
  // Jag sätter användarläge, återställer världen och markerar att den startat.
  // Intro-klassen tas bort från sidan och ljudet startas med aktuell tid och musiknivå.
  mode = "user", resetWorld(), started = !0, levelStartedAt = millis() / 1e3, lastFrameTime = millis() / 1e3, document.body.classList.remove("intro"), snd("start", millis() / 1e3, musicLevel());
  // Startskärmen får klassen "leaving" så att den tonas bort, och tas sedan bort helt efter en sekund.
  const st = document.getElementById("start");
  st.classList.add("leaving"), setTimeout(() => st.remove(), 1e3), updateHud();
}

// p5: setup och geometri
function setup() {
  // setup körs en gång av p5. Jag skapar canvasen i fönstrets storlek, sätter pixeltäthet 1, startar handtrackingen,
  // räknar ut backen, bygger scenen, placerar kulan, uppdaterar texterna, laddar bakgrunden och kopplar startknappen.
  createCanvas(windowWidth, windowHeight), pixelDensity(1), setupHandTracking(), calculateSlope(), buildScene(), resetBall(), updateHud(), updateInfo(), initBackground(), document.getElementById("go").onclick = startWorld;
}
// När fönstret ändrar storlek anpassas canvasen och allt som beror på storleken byggs om.
function windowResized() {
  resizeCanvas(windowWidth, windowHeight), calculateSlope(), buildScene();
}

// Backens start- och slutpunkt
// Positionerna anges som andelar av fönstrets bredd och höjd så att backen följer skärmens storlek.
function calculateSlope() {
  slope.x1 = width * 0.02, slope.y1 = height * 0.16, slope.x2 = width * 0.76, slope.y2 = height * 0.81;
}

// Backens höjd vid x (mjuk kurva som planar ut)
function slopeY(x) {
  // t är hur långt längs backen x ligger (0–1). curve gör att backen först är brant och sedan planar ut.
  // Resultatet är y-värdet mellan start- och slutpunktens höjd.
  const t = constrain(
    (x - slope.x1) / (slope.x2 - slope.x1),
    0,
    1
  ), curve = 1 - Math.pow(1 - t, 3);
  return lerp(slope.y1, slope.y2, curve);
}

// Kulan överst på backen, nollställer fysik och hand
function resetBall() {
  // Kulan placeras högst upp på backen med hastighet noll och alla fysikvärden nollställs.
  // På nivå 2 i användarläget får den en startfart på 240.
  ball.x = slope.x1 + 50 + 3, ball.y = slopeY(ball.x) - 50, ball.vx = 0, ball.vy = 0, ball.held = !1, ball.releaseSpeed = 0, ball.releaseTime = 0, ball.level4Phase = 0, ball.brakeHits = [!1, !1, !1], ball.sleeping = !1, mode === "user" && level === 2 && (ball.vx = 240),
  // Rullningsfunktionen startas om och en ny oscillator skapas med värdena för nivå 5.
  rollingTF.reset(ball.x, ball.vx), oscillatorTF = new OscillatorTransferFunction(
    LEVELS[5].omega,
    LEVELS[5].zeta
  ), oscillatorTF.reset(ball.x, 0),
  // Till sist nollställs även all handstyrning.
  wasPinching = !1, handTargetX = null, handVelocity = 0, lastHandPredictionTime = 0, fistFrames = 0, openFrames = 0, lostHandFrames = 0;
}

// Läge och nivåsystem
// setMode byter mellan demo och användarläge. Om läget faktiskt ändras börjar allt om på nivå 1.
function setMode(m) {
  mode !== m && (mode = m, level = 1, levelStartedAt = millis() / 1e3, clearGrabs(), resetBall(), updateHud(), updateInfo());
}
// setLevel byter nivå men behåller kulans position och hastighet, så att den inte hoppar vid bytet.
function setLevel(n) {
  // Jag sparar kulans nuvarande tillstånd, byter nivå (begränsad till 1–5) och återställer räknare.
  const savedX = ball.x, savedY = ball.y, savedVx = ball.vx, savedVy = ball.vy, wasHeld = ball.held;
  level = constrain(n, 1, 5), levelStartedAt = millis() / 1e3, clearGrabs(),
  // Sedan sätter jag tillbaka kulans tillstånd, nollställer nivåspecifika värden och startar om fysikfunktionerna från samma position och hastighet.
  ball.x = savedX, ball.y = savedY, ball.vx = savedVx, ball.vy = savedVy, ball.held = wasHeld, ball.sleeping = !1, ball.brakeHits = [!1, !1, !1], ball.level4Phase = 0, rollingTF.reset(ball.x, ball.vx), oscillatorTF = new OscillatorTransferFunction(LEVELS[5].omega, LEVELS[5].zeta), oscillatorTF.reset(ball.x, ball.vx), updateHud(), updateInfo();
}
// updateLevelDirector skulle byta nivå på tid, men eftersom LEVEL_DURATION är oändligt (1 / 0) händer det aldrig.
function updateLevelDirector(now) {
  mode !== "user" || !started || fadeAt === null && now - levelStartedAt >= 1 / 0 && advanceLevel();
}

// Fysik per nivå (1-5) + kanter
function updateBall(dt, now) {
  // Om kulan hålls eller världen inte startat styr inte fysiken kulan.
  if (ball.held || !started) return;
  // minX och maxX är kanterna kulan får röra sig mellan. angle är backens lutning vid kulan, uträknad ur höjdskillnaden mellan två punkter nära kulan.
  const minX = slope.x1 + 50, maxX = width - 50, angle = Math.atan2(
    slopeY(ball.x + 2) - slopeY(ball.x - 2),
    4
  );
  // Nivå 1 (och demoläget): normal fysik. Tyngden längs backen drar kulan framåt och den bromsas lite av dämpningen 0,1.
  // Kulan får aldrig rulla bakåt.
  if (mode === "demo" || level === 1) {
    const g = 230 * Math.sin(angle) * 3;
    ball.vx = Math.max(0, ball.vx), rollingTF.reset(ball.x, ball.vx), rollingTF.update(g, 0.1, dt), ball.x = rollingTF.position, ball.vx = Math.max(0, rollingTF.velocity);
  // Nivå 2: friktionen ändras. Det extra rullmotståndet drar ifrån en del av tyngden och dämpningen är hög (0,55).
  // Om kulan nästan står still och inte dras framåt längre låter jag den "sova" (stå stilla).
  } else if (level === 2) {
    const p = LEVELS[2], net = p.gravity * Math.sin(angle) * 3 - p.rollingResistance * Math.sin(angle) * 3;
    rollingTF.reset(ball.x, ball.vx), rollingTF.update(net, p.damping, dt), ball.x = rollingTF.position, ball.vx = rollingTF.velocity, Math.abs(ball.vx) < 2 && net <= 0 && (ball.vx = 0, ball.sleeping = !0);
  // Nivå 3: varierande motstånd. Det finns tre zoner längs backen (zones) där kulan bromsas kraftigt.
  // damping blir 5,5 när kulan är nära en zon, och en extra bromskraft (brake) verkar precis före zonen.
  // brakeHits kommer ihåg vilka zoner som kulan redan passerat, så att de bara bromsar en gång.
  } else if (level === 3) {
    const p = LEVELS[3], g = p.gravity * Math.sin(angle) * 3, zones = [0.3, 0.56, 0.78].map((t) => lerp(minX, maxX, t));
    let damping = p.damping, brake = 0;
    zones.forEach((z, i) => {
      Math.abs(ball.x - z) < 42 && (damping = 5.5), ball.x > z + 55 && (ball.brakeHits[i] = !0), !ball.brakeHits[i] && Math.abs(ball.x - z) < 20 && (brake = 115);
    }), rollingTF.reset(ball.x, ball.vx), rollingTF.update(g - brake, damping, dt), ball.x = rollingTF.position, ball.vx = rollingTF.velocity;
  // Nivå 4: riktningen bryts. Efter släppet går kulan genom faser (level4Phase) styrda av tiden t sedan släppet:
  // fas 1 trycker kulan bakåt (-900) i 0,85 s, fas 2 trycker framåt (+260) tills 1,35 s, och fas 3 drar kulan mot mitten av skärmen (52 % av bredden).
  // I fas 3 får kulan sova när den nästan stannat efter 2,5 s.
  } else if (level === 4) {
    const p = LEVELS[4], g = p.gravity * Math.sin(angle) * 3, t = now - ball.releaseTime;
    let a = g;
    ball.level4Phase === 1 ? (a -= 900, t > 0.85 && (ball.level4Phase = 2)) : ball.level4Phase === 2 ? (a += 260, t > 1.35 && (ball.level4Phase = 3)) : ball.level4Phase === 3 && (a += (width * 0.52 - ball.x) * 0.9, Math.abs(ball.vx) < 3 && t > 2.5 && (ball.vx = 0, ball.sleeping = !0)), rollingTF.reset(ball.x, ball.vx), rollingTF.update(a, p.damping, dt), ball.x = rollingTF.position, ball.vx = rollingTF.velocity;
  // Nivå 5: den omöjliga pendelrörelsen. Kulan styrs av den dämpade svängningen mot 52 % av skärmens bredd, oberoende av backen.
  } else level === 5 && (oscillatorTF.update(width * 0.52, dt), ball.x = oscillatorTF.position, ball.vx = oscillatorTF.velocity);
  // Kanterna: vid vänster kant stannar kulan och studsar tillbaka med 25 % av farten. Är farten över 140 spelas ljudet thud.
  // Vid höger kant stannar kulan helt. Sedan placeras kulan på backen och fysikfunktionen synkas med kulans värden.
  ball.x < minX && (ball.x = minX, ball.vx < 0 && (ball.vx < -140 && snd("thud", constrain(-ball.vx / 900, 0.15, 1)), ball.vx *= -0.25)), ball.x > maxX && (ball.x = maxX, ball.vx > 0 && (ball.vx > 140 && snd("thud", constrain(ball.vx / 900, 0.15, 1)), ball.vx = 0)), ball.y = slopeY(ball.x) - 50, rollingTF.position = ball.x, rollingTF.velocity = ball.vx;
}

// PAL är färgpaletten (magenta, cyan och violett) som används i allt ljus.
// rgbaStr gör om en färg och en genomskinlighet till en CSS-färgsträng.
// clamp01 begränsar ett värde till 0–1 och smoothstep01 ger en mjuk övergång mellan a och b.
// mixCol blandar två färger, där t är hur mycket av den andra färgen som tas.
const PAL = { mag: [255, 35, 220], cya: [0, 235, 255], vio: [165, 65, 255] }, rgbaStr = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`, clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v, smoothstep01 = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}, mixCol = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Här deklarerar jag variablerna för grafiken.
// roomLayer, trackLayer och vignetteLayer är färdigritade lager som jag bara kopierar in varje bild, så att de inte behöver ritas om hela tiden.
// geo sparar banans geometri, floorY är golvets höjd och sceneScale skalar allt efter fönstrets höjd.
// fogSprites är små dimbilder, ballTex är kulans textur och rig innehåller lamporna i taket.
let roomLayer = null, trackLayer = null, vignetteLayer = null, geo = null, floorY = 0, sceneScale = 1, fogSprites = null, ballTex = null, rig = [];

// fx håller det visuella tillståndet som följer kulans rörelse.
// energy är hur "het" scenen är (följer farten), pulse en puls i takt med musiken och speed kulans fart.
// prevV, decel, fric, roll, lift, blend och phase används för inbromsning, friktion, kulans rullning, lyftet vid grepp och animationer.
// chase och drift styr rörliga ljus, sparkAcc räknar gnistor, sparks och trail är listor över gnistor och svans, och key säger vilket läge och vilken nivå som gäller.
const fx = {
  energy: 0,
  pulse: 0,
  speed: 0,
  prevV: 0,
  decel: 0,
  fric: 0,
  roll: 0,
  lift: 0,
  blend: 0,
  phase: 0,
  chase: 0,
  drift: 0,
  sparkAcc: 0,
  sparks: [],
  trail: [],
  key: ""
};
// makeRng skapar en egen slumpgenerator från ett frö (seed). Samma frö ger alltid samma slumptal,
// så att scenen ser likadan ut varje gång den byggs om.
function makeRng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0, a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    return t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t, ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// makeCanvas skapar en ny osynlig canvas av en viss storlek (minst 1x1 pixel).
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  return c.width = Math.max(1, Math.ceil(w)), c.height = Math.max(1, Math.ceil(h)), c;
}
// trussHeight är höjden på takstommen högst upp, 8,5 % av fönstrets höjd men mellan 56 och 120 pixlar.
function trussHeight() {
  return constrain(height * 0.085, 56, 120);
}

// Bygger den statiska scenen (rum, bana, vinjett m.m.)
function buildScene() {
  // Först räknas skalan och golvets höjd ut. Sedan byggs alla lager. Dimsprites och kulans textur byggs bara en gång.
  sceneScale = constrain(height / 1e3, 0.6, 1.5), floorY = Math.min(height - 6, Math.max(height * 0.9, slope.y2 + 100 * sceneScale)), buildRoom(), buildBallEnv(), buildTrack(), buildVignette(), fogSprites || buildFogSprites(), ballTex || buildBallTexture();
}
// drawSeam ritar en skarv mellan två plåtar: en mörk linje och en ljus linje bredvid för att ge känsla av djup.
function drawSeam(g, x1, y1, x2, y2) {
  const ox = x1 === x2 ? 2 : 0, oy = y1 === y2 ? 2 : 0;
  g.strokeStyle = "rgba(0,0,0,.6)", g.lineWidth = 2, g.beginPath(), g.moveTo(x1, y1), g.lineTo(x2, y2), g.stroke(), g.strokeStyle = "rgba(170,160,215,.07)", g.lineWidth = 1, g.beginPath(), g.moveTo(x1 + ox, y1 + oy), g.lineTo(x2 + ox, y2 + oy), g.stroke();
}
// drawColumn ritar en stålpelare i hallen med två flänsar, bultar och en fotplatta.
function drawColumn(g, cx, y0, y1, sc) {
  // Måtten räknas ut. cw är pelarens bredd, fl flänsens bredd och x0 vänsterkanten. Mellandelen fylls med mörk färg.
  const cw = 58 * sc, fl = 15 * sc, x0 = cx - cw / 2;
  g.fillStyle = "#08090d", g.fillRect(x0 + fl, y0, cw - 2 * fl, y1 - y0);
  // Varje fläns får en gradient för metallkänsla, en glansig linje och bultar med små highlights.
  for (const f0 of [x0, x0 + cw - fl]) {
    const fg = g.createLinearGradient(f0, 0, f0 + fl, 0);
    fg.addColorStop(0, "#161922"), fg.addColorStop(0.35, "#2d3340"), fg.addColorStop(0.6, "#1b1f28"), fg.addColorStop(1, "#0b0d13"), g.fillStyle = fg, g.fillRect(f0, y0, fl, y1 - y0), g.fillStyle = "rgba(150,160,195,.22)", g.fillRect(f0 + fl * 0.32, y0, 1, y1 - y0);
    for (let y = y0 + 30 * sc; y < y1 - 20 * sc; y += 46 * sc)
      g.fillStyle = "rgba(0,0,0,.7)", g.beginPath(), g.arc(f0 + fl * 0.5, y, 2.6 * sc, 0, 7), g.fill(), g.fillStyle = "rgba(170,180,215,.25)", g.beginPath(), g.arc(f0 + fl * 0.5 - 0.6, y - 0.6, 1.2 * sc, 0, 7), g.fill();
  }
  // Längst ner ritas fotplattan med två bultar.
  const pg = g.createLinearGradient(0, y1 - 12 * sc, 0, y1);
  pg.addColorStop(0, "#2a2f3b"), pg.addColorStop(1, "#0c0d12"), g.fillStyle = pg, g.fillRect(cx - cw * 0.85, y1 - 12 * sc, cw * 1.7, 12 * sc);
  for (const bx of [-0.62, 0.62])
    g.fillStyle = "rgba(0,0,0,.7)", g.beginPath(), g.arc(cx + cw * bx, y1 - 6 * sc, 3 * sc, 0, 7), g.fill();
}

// Industrihallen (eller bakgrundsbilden)
function buildRoom() {
  // W och H är fönstrets storlek, sc skalan och tb takstommens höjd.
  // roomLayer är en ny canvas som rummet ritas på, och rnd är en slumpgenerator med fast frö.
  const W = width, H = height, sc = sceneScale, tb = trussHeight();
  roomLayer = makeCanvas(W, H);
  const g = roomLayer.getContext("2d"), rnd = makeRng(1337);
  // Om en bakgrundsbild finns ritas den i stället för den egengjorda hallen, och lamporna i rig tas bort.
  if (bgImg) {
    paintBackgroundImage(g, W, H), rig = [];
    return;
  }
  // Väggen fylls med en mörk lila gradient.
  let gr = g.createLinearGradient(0, 0, 0, floorY);
  gr.addColorStop(0, "#07060d"), gr.addColorStop(0.5, "#0f0d18"), gr.addColorStop(1, "#18151f"), g.fillStyle = gr, g.fillRect(0, 0, W, floorY);
  // 80 stora, mjuka fläckar (ljusa eller mörka) ger väggen en ojämn, smutsig känsla.
  for (let i = 0; i < 80; i++) {
    const x = rnd() * W, y = rnd() * floorY, r = 60 + rnd() * 220, light = rnd() < 0.5, rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, light ? "rgba(120,110,150,.07)" : "rgba(0,0,0,.22)"), rg.addColorStop(1, "rgba(0,0,0,0)"), g.fillStyle = rg, g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Här strör jag ut tusentals små ljusa och mörka prickar som ger väggen en kornig yta.
  const n = Math.floor(W * floorY / 40);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * floorY;
    g.fillStyle = rnd() < 0.45 ? `rgba(190,180,230,${(0.02 + rnd() * 0.05).toFixed(3)})` : `rgba(0,0,0,${(0.06 + rnd() * 0.14).toFixed(3)})`, g.fillRect(x, y, rnd() < 0.15 ? 2 : 1, 1);
  }
  // Väggen delas in i metallpaneler (pw gånger ph). Varje rad förskjuts ett halvt panelsteg, och varje panel får skarvar och fyra nitar.
  const pw = 330 * sc, ph = 230 * sc;
  for (let row = 0, y = tb; y < floorY; row++, y += ph) {
    drawSeam(g, 0, y, W, y);
    const off = row % 2 * pw * 0.5;
    for (let x = -off; x < W; x += pw) {
      drawSeam(g, x, y, x, Math.min(y + ph, floorY));
      for (const [hx, hy] of [[0.22, 0.28], [0.78, 0.28], [0.22, 0.72], [0.78, 0.72]]) {
        const px = x + pw * hx, py = y + ph * hy;
        py > floorY - 14 || (g.fillStyle = "rgba(0,0,0,.6)", g.beginPath(), g.arc(px, py, 3.6 * sc, 0, 7), g.fill(), g.strokeStyle = "rgba(170,160,210,.10)", g.lineWidth = 1, g.beginPath(), g.arc(px, py, 4.6 * sc, 0, 7), g.stroke());
      }
    }
  }
  // 16 mörka, lodräta fläckar som liknar rinnande smuts eller skuggor från taket.
  for (let i = 0; i < 16; i++) {
    const x = rnd() * W, w = 8 + rnd() * 30, len = floorY * (0.25 + rnd() * 0.6), sg = g.createLinearGradient(0, tb, 0, tb + len);
    sg.addColorStop(0, "rgba(0,0,0,.30)"), sg.addColorStop(1, "rgba(0,0,0,0)"), g.fillStyle = sg, g.fillRect(x, tb, w, len);
  }
  // En stor industriport på väggen. Först ramen, sedan lameller som ritas en i taget med egen gradient, och sist överstycket.
  const dx0 = W * 0.6, dx1 = W * 0.8, dTop = tb + (floorY - tb) * 0.3;
  g.fillStyle = "#08080d", g.fillRect(dx0 - 10 * sc, dTop - 26 * sc, dx1 - dx0 + 20 * sc, floorY - dTop + 26 * sc);
  const sl = 11 * sc;
  for (let y = dTop; y < floorY; y += sl) {
    const sg = g.createLinearGradient(0, y, 0, y + sl);
    sg.addColorStop(0, "#1b1c26"), sg.addColorStop(0.15, "#232532"), sg.addColorStop(0.7, "#0d0e14"), sg.addColorStop(1, "#050507"), g.fillStyle = sg, g.fillRect(dx0, y, dx1 - dx0, sl - 1);
  }
  const hg = g.createLinearGradient(0, dTop - 26 * sc, 0, dTop);
  hg.addColorStop(0, "#262a35"), hg.addColorStop(1, "#0a0b10"), g.fillStyle = hg, g.fillRect(dx0 - 10 * sc, dTop - 26 * sc, dx1 - dx0 + 20 * sc, 26 * sc);
  // Tre pelare ritas på väggen (vid 4,5 %, 50 % och 95,5 % av bredden).
  for (const f of [0.045, 0.5, 0.955]) drawColumn(g, W * f, tb, floorY, sc);
  // Två horisontella rörledningar med metallgradient och små fästen längs med.
  for (const py of [tb + H * 0.075, tb + H * 0.075 + 24 * sc]) {
    const pg = g.createLinearGradient(0, py - 9 * sc, 0, py + 9 * sc);
    pg.addColorStop(0, "#0b0c11"), pg.addColorStop(0.3, "#3a4050"), pg.addColorStop(0.5, "#232733"), pg.addColorStop(1, "#07080b"), g.fillStyle = pg, g.fillRect(0, py - 9 * sc, W, 18 * sc);
    for (let x = 140 * sc; x < W; x += 260 * sc)
      g.fillStyle = "#12141b", g.fillRect(x, py - 13 * sc, 10 * sc, 26 * sc), g.fillStyle = "rgba(150,160,195,.18)", g.fillRect(x, py - 13 * sc, 10 * sc, 1);
  }
  // Golvet under väggen: en mörk gradient, och inom ett klippt område ritas perspektivlinjer (som löper mot en försvinningspunkt) och tvärlinjer.
  gr = g.createLinearGradient(0, floorY, 0, H), gr.addColorStop(0, "#110f1b"), gr.addColorStop(1, "#030207"), g.fillStyle = gr, g.fillRect(0, floorY, W, H - floorY), g.save(), g.beginPath(), g.rect(0, floorY, W, H - floorY), g.clip(), g.strokeStyle = "rgba(190,180,240,.05)", g.lineWidth = 1;
  const vpx = W / 2, vpy = floorY - (H - floorY) * 3.2;
  for (let k = -16; k <= 16; k++) {
    const bx = vpx + k * W * 0.07, t = (floorY - vpy) / (H - vpy), sx = vpx + (bx - vpx) * t;
    g.beginPath(), g.moveTo(sx, floorY), g.lineTo(bx, H), g.stroke();
  }
  for (let j = 1; j <= 6; j++) {
    const y = floorY + (H - floorY) * Math.pow(j / 6, 1.7);
    g.beginPath(), g.moveTo(0, y), g.lineTo(W, y), g.stroke();
  }
  // En ljus glans (sheen) nära väggen, och små prickar som ger golvet en kornig yta. Därefter avslutas det klippta området.
  const sheen = g.createLinearGradient(0, floorY, 0, floorY + (H - floorY) * 0.6);
  sheen.addColorStop(0, "rgba(120,100,200,.10)"), sheen.addColorStop(1, "rgba(120,100,200,0)"), g.fillStyle = sheen, g.fillRect(0, floorY, W, H - floorY);
  for (let i = 0; i < W * (H - floorY) / 90; i++)
    g.fillStyle = `rgba(200,190,255,${(0.02 + rnd() * 0.04).toFixed(3)})`, g.fillRect(rnd() * W, floorY + rnd() * (H - floorY), 1, 1);
  // Sockeln där väggen möter golvet, med en ljus kant överst och en skugga under. Sedan fylls taket med en mörk färg.
  g.restore(), g.fillStyle = "#0a090f", g.fillRect(0, floorY - 12 * sc, W, 12 * sc), g.fillStyle = "rgba(150,140,200,.25)", g.fillRect(0, floorY - 12 * sc, W, 1), g.fillStyle = "rgba(0,0,0,.7)", g.fillRect(0, floorY, W, 2), g.fillStyle = "#08080d", g.fillRect(0, 0, W, tb);
  // Takstommens sicksackstag: en mörk linje och en ljus linje bredvid för djup.
  const stp = 70 * sc;
  for (let x = -stp; x < W + stp; x += stp)
    g.strokeStyle = "#1d212b", g.lineWidth = 4 * sc, g.beginPath(), g.moveTo(x, 10 * sc), g.lineTo(x + stp / 2, tb - 10 * sc), g.lineTo(x + stp, 10 * sc), g.stroke(), g.strokeStyle = "rgba(130,140,175,.22)", g.lineWidth = 1, g.beginPath(), g.moveTo(x - 1, 10 * sc), g.lineTo(x + stp / 2 - 1, tb - 10 * sc), g.lineTo(x + stp - 1, 10 * sc), g.stroke();
  // Takstommens övre och undre balk.
  for (const cy of [0, tb - 12 * sc]) {
    const cg = g.createLinearGradient(0, cy, 0, cy + 12 * sc);
    cg.addColorStop(0, "#2d3240"), cg.addColorStop(0.4, "#171a23"), cg.addColorStop(1, "#09090e"), g.fillStyle = cg, g.fillRect(0, cy, W, 12 * sc);
  }
  // rig skapas: tio strålkastare i taket. Varje lampa får en position, en färg från paletten, en grundvinkel (base),
  // en spridning (spread) och en fasförskjutning (phase) så att de rör sig olika.
  const cols = [PAL.mag, PAL.cya, PAL.vio, PAL.mag, PAL.cya, PAL.vio, PAL.mag, PAL.cya, PAL.vio, PAL.mag];
  rig = [0.06, 0.16, 0.27, 0.38, 0.49, 0.6, 0.71, 0.82, 0.92, 0.98].map((fr, i) => ({
    x: W * fr,
    y: tb + 20 * sc,
    col: cols[i],
    base: (i - 2.5) * 0.075,
    spread: 0.045 + 0.012 * (i % 3),
    phase: i * 1.3
  }));
  // Själva lamphusen ritas i taket: ett fäste och en kropp med metallgradient och en mörk lins.
  for (const f of rig) {
    g.fillStyle = "#12141b", g.fillRect(f.x - 3 * sc, tb - 2 * sc, 6 * sc, 10 * sc);
    const cg = g.createLinearGradient(f.x - 17 * sc, 0, f.x + 17 * sc, 0);
    cg.addColorStop(0, "#0a0b10"), cg.addColorStop(0.35, "#2c313e"), cg.addColorStop(1, "#08090d"), g.fillStyle = cg, g.fillRect(f.x - 17 * sc, tb + 4 * sc, 34 * sc, 24 * sc), g.fillStyle = "#050508", g.fillRect(f.x - 13 * sc, tb + 24 * sc, 26 * sc, 5 * sc);
  }
  // Allra sist en mörk gradient överst som gör taket mörkare.
  const tg = g.createLinearGradient(0, 0, 0, floorY * 0.35);
  tg.addColorStop(0, "rgba(0,0,0,.45)"), tg.addColorStop(1, "rgba(0,0,0,0)"), g.fillStyle = tg, g.fillRect(0, 0, W, floorY * 0.35);
}
// sampleStops hämtar en färg från en lista med färgstopp (som en gradient) vid positionen f (0–1)
// och blandar mellan närmaste två stopp. Den används för att skugga banans metall pixel för pixel.
function sampleStops(stops, f) {
  for (let i = 1; i < stops.length; i++)
    if (f <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], t = (f - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return `rgb(${a[1][0] + (b[1][0] - a[1][0]) * t | 0},${a[1][1] + (b[1][1] - a[1][1]) * t | 0},${a[1][2] + (b[1][2] - a[1][2]) * t | 0})`;
    }
  const l = stops[stops.length - 1][1];
  return `rgb(${l[0]},${l[1]},${l[2]})`;
}

// Banan
function buildTrack() {
  // trackLayer är en ny canvas för banan. d är halva spårets bredd, T tjockleken på banans sida och rail kanten bakom.
  // xs och ys är listor med punkter längs backens kurva (var 6:e pixel), som används för att rita alla delar av banan.
  const W = width, H = height, sc = sceneScale;
  trackLayer = makeCanvas(W, H);
  const g = trackLayer.getContext("2d"), rnd = makeRng(4242), d = 15 * sc, T = 46 * sc, rail = 18 * sc, xs = [], ys = [];
  for (let x = 0; x < W; x += 6)
    xs.push(x), ys.push(slopeY(x));
  xs.push(W), ys.push(slopeY(W));
  // N är antal punkter. Tre hjälpfunktioner följer:
  // trace ritar en linje längs backen med en förskjutning off, bandPath skapar en yta mellan två förskjutningar,
  // och shadeBand fyller en yta med många tunna linjer som får färg från sampleStops, så att den får en metallisk gradient tvärs över banan.
  const N = xs.length, trace = (off, i0 = 0, i1 = N - 1) => {
    g.beginPath(), g.moveTo(xs[i0], ys[i0] + off);
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(xs[i], ys[i] + off);
  }, bandPath = (c, o0, o1) => {
    c.beginPath(), c.moveTo(xs[0], ys[0] + o0);
    for (let i = 1; i < N; i++) c.lineTo(xs[i], ys[i] + o0);
    for (let i = N - 1; i >= 0; i--) c.lineTo(xs[i], ys[i] + o1);
    c.closePath();
  }, shadeBand = (o0, o1, stops, stepPx) => {
    g.lineCap = "butt", g.lineJoin = "round";
    for (let o = o0; o < o1; o += stepPx)
      g.strokeStyle = sampleStops(stops, (o - o0) / (o1 - o0)), g.lineWidth = stepPx + 0.8, trace(o + stepPx / 2), g.stroke();
  }, fg = g.createLinearGradient(0, floorY - 4, 0, floorY + 34 * sc);
  // Skuggan på golvet under banan.
  fg.addColorStop(0, "rgba(0,0,0,.65)"), fg.addColorStop(1, "rgba(0,0,0,0)"), g.fillStyle = fg, g.fillRect(0, floorY - 4, W, 38 * sc);
  // Stöttorna under banan. För varje ben (legs) ritas två stolpar med kryssformade tvärstag, en ljus linje bredvid för djup, och en fotplatta.
  // Stolparna börjar där banans undersida är och går ner till golvet.
  const legs = [0.07, 0.25, 0.43, 0.6, 0.76, 0.9, 0.985], gap = 44 * sc, lw = 14 * sc;
  for (const lf of legs) {
    const cx = W * lf, xl = cx - gap / 2, xr = cx + gap / 2, tl = slopeY(xl) + d + T * 0.5, tr = slopeY(xr) + d + T * 0.5, st = Math.max(tl, tr) + 6, step = 110 * sc;
    g.strokeStyle = "#161921", g.lineWidth = 4 * sc;
    for (let yy = st; yy + step < floorY - 10; yy += step)
      g.beginPath(), g.moveTo(xl, yy), g.lineTo(xr, yy + step), g.moveTo(xr, yy), g.lineTo(xl, yy + step), g.moveTo(xl, yy), g.lineTo(xr, yy), g.stroke();
    g.strokeStyle = "rgba(150,160,195,.16)", g.lineWidth = 1;
    for (let yy = st; yy + step < floorY - 10; yy += step)
      g.beginPath(), g.moveTo(xl - 1, yy), g.lineTo(xr - 1, yy + step), g.moveTo(xr - 1, yy), g.lineTo(xl - 1, yy + step), g.stroke();
    for (const [px, top] of [[xl, tl], [xr, tr]]) {
      const pg = g.createLinearGradient(px - lw / 2, 0, px + lw / 2, 0);
      pg.addColorStop(0, "#12151c"), pg.addColorStop(0.35, "#323847"), pg.addColorStop(0.65, "#1b1f29"), pg.addColorStop(1, "#08090d"), g.fillStyle = pg, g.fillRect(px - lw / 2, top, lw, floorY - top), g.fillStyle = "rgba(150,160,195,.22)", g.fillRect(px - lw / 2 + lw * 0.3, top, 1, floorY - top);
    }
    const bg = g.createLinearGradient(0, floorY - 10 * sc, 0, floorY);
    bg.addColorStop(0, "#2a2f3b"), bg.addColorStop(1, "#0b0c11"), g.fillStyle = bg, g.fillRect(cx - gap * 0.8, floorY - 10 * sc, gap * 1.6, 10 * sc);
  }
  // Själva banan byggs i lager: först en stor mjuk skugga, sedan bakre kanten (rail), själva rullytan i mitten och framkanten med sin sida.
  // Varje del fylls först med en jämn färg och skuggas sedan med shadeBand så att den får ljusa kanter och mörkare mitt.
  g.save(), g.shadowColor = "rgba(0,0,0,.8)", g.shadowBlur = 40 * sc, g.shadowOffsetY = 26 * sc, g.fillStyle = "#000", bandPath(g, d, d + T), g.fill(), g.restore(), bandPath(g, -d - rail, -d), g.fillStyle = "#1a1d26", g.fill(), shadeBand(-d - rail, -d, [[0, [120, 128, 150]], [0.12, [46, 50, 62]], [1, [20, 22, 30]]], 1.5), bandPath(g, -d, d), g.fillStyle = "#3a3e4c", g.fill(), shadeBand(-d, d, [[0, [62, 68, 84]], [0.5, [100, 108, 130]], [1, [50, 54, 68]]], 1.5), bandPath(g, d, d + T), g.fillStyle = "#22252f", g.fill(), shadeBand(d, d + T, [[0, [150, 160, 185]], [0.07, [56, 61, 75]], [0.5, [31, 34, 44]], [0.9, [18, 19, 26]], [1, [8, 8, 12]]], 2);
  // streak ritar slumpmässiga korta ljusa och mörka streck längs banan som ser ut som repor och slitage.
  const streak = (off0, off1, count) => {
    for (let i = 0; i < count; i++) {
      const off = off0 + rnd() * (off1 - off0), a = Math.floor(rnd() * (N - 8)), b = Math.min(N - 1, a + 4 + Math.floor(rnd() * 40));
      g.strokeStyle = rnd() < 0.6 ? `rgba(255,255,255,${(0.02 + rnd() * 0.05).toFixed(3)})` : `rgba(0,0,0,${(0.08 + rnd() * 0.12).toFixed(3)})`, g.lineWidth = 1, trace(off, a, b), g.stroke();
    }
  };
  streak(-d, d, 160), streak(d + 2, d + T - 2, 200), streak(-d - rail, -d, 50);
  // Skarvar över banans framsida med jämna mellanrum (var 180:e pixel).
  const seamStep = 180 * sc;
  for (let x = seamStep; x < W; x += seamStep) {
    const y = slopeY(x);
    g.strokeStyle = "rgba(0,0,0,.6)", g.lineWidth = 2, g.beginPath(), g.moveTo(x, y + d), g.lineTo(x, y + d + T), g.stroke(), g.strokeStyle = "rgba(170,180,215,.10)", g.lineWidth = 1, g.beginPath(), g.moveTo(x + 2, y + d), g.lineTo(x + 2, y + d + T), g.stroke();
  }
  // Nitar längs banans framsida, var 44:e pixel, med en liten ljus punkt som highlight.
  for (let x = 24 * sc; x < W; x += 44 * sc) {
    const y = slopeY(x) + d + T * 0.62;
    g.fillStyle = "rgba(0,0,0,.75)", g.beginPath(), g.arc(x, y, 3 * sc, 0, 7), g.fill(), g.fillStyle = "rgba(180,190,225,.40)", g.beginPath(), g.arc(x - 0.7, y - 0.8, 1.3 * sc, 0, 7), g.fill();
  }
  // Kantlinjer: ljusa kanter där ytan fångar ljus och tjocka mörka linjer som placeras där neonljusen senare ska ritas.
  g.strokeStyle = "rgba(205,215,240,.55)", g.lineWidth = 1, trace(d), g.stroke(), g.strokeStyle = "rgba(0,0,0,.9)", g.lineWidth = 6 * sc, trace(d + 7 * sc), g.stroke(), g.strokeStyle = "rgba(0,0,0,.9)", g.lineWidth = 5 * sc, trace(-d - rail + 3 * sc), g.stroke(), g.strokeStyle = "rgba(205,215,240,.35)", g.lineWidth = 1, trace(-d - rail), g.stroke(), g.strokeStyle = "rgba(0,0,0,.8)", g.lineWidth = 2, trace(d + T), g.stroke();
  // body är banans hela omkrets som en Path2D. Den används senare för att klippa ljus så att det bara hamnar på banan.
  // geo sparar allt som andra funktioner behöver veta om banan, bland annat var neonlisterna sitter (neonFront och neonBack).
  const body = new Path2D();
  body.moveTo(xs[0], ys[0] - d - rail);
  for (let i = 1; i < N; i++) body.lineTo(xs[i], ys[i] - d - rail);
  for (let i = N - 1; i >= 0; i--) body.lineTo(xs[i], ys[i] + d + T);
  body.closePath(), geo = { xs, ys, N, d, T, rail, neonFront: d + 7 * sc, neonBack: -d - rail + 3 * sc, body };
}
// buildVignette skapar mörka hörn runt bilden (vinjett) med en radiell gradient. Hörnen är mörkare med den egengjorda hallen än med en bakgrundsbild.
function buildVignette() {
  const W = width, H = height;
  vignetteLayer = makeCanvas(W, H);
  const g = vignetteLayer.getContext("2d"), r = Math.hypot(W, H) / 2, vg = g.createRadialGradient(W / 2, H * 0.55, r * 0.3, W / 2, H * 0.55, r * 1.02);
  vg.addColorStop(0, "rgba(0,0,0,0)"), vg.addColorStop(0.6, "rgba(0,0,0,.20)"), vg.addColorStop(1, bgImg ? "rgba(0,0,0,.40)" : "rgba(0,0,0,.75)"), g.fillStyle = vg, g.fillRect(0, 0, W, H);
}

// Dimsprites
// Jag skapar tre små 256x256-bilder av mjuka färgade moln (magenta, cyan, violett) som används som dimma.
function buildFogSprites() {
  fogSprites = [PAL.mag, PAL.cya, PAL.vio].map((col) => {
    const c = makeCanvas(256, 256), g = c.getContext("2d"), rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    return rg.addColorStop(0, rgbaStr(col, 0.5)), rg.addColorStop(0.45, rgbaStr(col, 0.17)), rg.addColorStop(1, rgbaStr(col, 0)), g.fillStyle = rg, g.fillRect(0, 0, 256, 256), c;
  });
}

// Kulans textur
// Här räknar jag i förväg ut allt om kulans yta som aldrig ändras, så att det går snabbt att rita den varje bild.
// Kulan ses som en spegelkula. För varje pixel räknas ytans normal, vart reflektionen pekar och hur starkt olika ljuskällor syns där.
function buildBallTexture() {
  // S är texturens storlek (106 pixlar), N antal pixlar och cx mitten. cv och ctx är canvasen och dess rityta, och img är pixeldatan.
  // F skapar en tom lista med flyttal. t samlar alla förberäknade listor:
  // al (genomskinlighet/kant), nx och ny (ytans normal), rx och up (reflektionens riktning i sidled och uppåt),
  // fres och f4 (fresnel-kanten), sky och skyG (himlen/taket), key, strip och hot (studioljus),
  // ao (skugga mot undersidan), side (vänster/höger), fl (golvets reflektion), gm, gc och gv (magenta, cyan och violett glans)
  // och gl (fyra lampor i taket).
  // box är en hjälpfunktion som ger en mjuk rektangel, och lampX är lampornas lägen i sidled.
  const S = Math.ceil(106), N = S * S, cx = (S - 1) / 2, cv = makeCanvas(S, S), ctx = cv.getContext("2d"), img = ctx.createImageData(S, S), F = () => new Float32Array(N), t = {
    S,
    N,
    cv,
    ctx,
    img,
    al: F(),
    nx: F(),
    ny: F(),
    rx: F(),
    up: F(),
    fres: F(),
    f4: F(),
    sky: F(),
    skyG: F(),
    key: F(),
    strip: F(),
    hot: F(),
    ao: F(),
    side: F(),
    fl: F(),
    gm: F(),
    gc: F(),
    gv: F(),
    gl: [F(), F(), F(), F()]
  }, box = (v, c, h, s) => smoothstep01(h + s, h - s, Math.abs(v - c)), lampX = [-0.72, -0.26, 0.24, 0.7];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // För varje pixel räknas avståndet d från mitten (i kulans radie) och al, som är 1 inuti kulan och mjukt går mot 0 vid kanten.
    // Pixlar utanför kulan hoppas över.
    const i = y * S + x, dx = (x - cx) / 50, dy = (y - cx) / 50, d = Math.sqrt(dx * dx + dy * dy), a = clamp01((1 - d) * 50 + 0.5);
    if (t.al[i] = a, a <= 0) continue;
    // Ytans normal (nx, ny, nz) räknas ut som på en sfär. Sedan räknas reflektionsriktningen (rx, ry, rz) ut, och up är hur mycket den pekar uppåt.
    const k = d > 1 ? 1 / d : 1, nx = dx * k, ny = dy * k, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    t.nx[i] = nx, t.ny[i] = ny;
    const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1, up = -ry;
    t.rx[i] = rx, t.up[i] = up;
    // Fresnel: kulans kanter reflekterar lite mer än mitten.
    const f = 1 - nz, f2 = f * f;
    t.fres[i] = 0.88 + 0.12 * f2 * f2 * f, t.f4[i] = f2 * f2;
    // Himlen: ljusare uppåt och mörkare nedåt, med en smal ljus horisontlinje. Sedan beräknas studioljusen (key, strip och hot),
    // skuggan mot undersidan (ao), vänster/höger (side) och de tre färgade glansarna (gm, gc, gv).
    // Om reflektionen pekar tillräckligt uppåt (up > 0,25) beräknas även de fyra lamporna (gl).
    let sky = up >= 0 ? 0.42 + 0.7 * smoothstep01(0, 0.95, up) : 0.17 + 0.14 * smoothstep01(-1, -0.1, up);
    if (sky += 0.55 * Math.exp(-(up * up) / 16e-4), t.sky[i] = sky, t.skyG[i] = smoothstep01(-0.3, 0.8, up), t.key[i] = box(rx, -0.5, 0.26, 0.07) * box(up, 0.58, 0.2, 0.07), t.strip[i] = box(rx, 0.66, 0.05, 0.035) * box(up, 0.15, 0.55, 0.12), t.hot[i] = Math.exp(-((rx + 0.5) * (rx + 0.5) + (up - 0.62) * (up - 0.62)) / 35e-4), t.ao[i] = 1 - 0.18 * smoothstep01(0.15, 1, ny), t.side[i] = smoothstep01(-0.3, 0.3, nx), t.gm[i] = Math.exp((rx * 0.881 + up * 0.275 + rz * 0.385 - 1) * 20), t.gc[i] = Math.exp((-rx * 0.87 - up * 0.127 + rz * 0.477 - 1) * 16), t.gv[i] = Math.exp((rx * 0.1 + up * 0.35 - rz * 0.93 - 1) * 10), up > 0.25) {
      const dyy = (up - 0.62) / 0.085;
      for (let j = 0; j < 4; j++) {
        const dxx = (rx - lampX[j]) / 0.15;
        t.gl[j][i] = Math.exp(-(dxx * dxx + dyy * dyy));
      }
    }
    // Om reflektionen pekar nedåt (golvet) sparas hur mycket golvet ska lysa i den pixeln.
    up < -0.1 && (t.fl[i] = smoothstep01(-0.1, -0.85, up));
  }
  // Här skapar jag sju slumpmässiga repor på kulan: vinkel (sca och ssa), förskjutning (so) och längd (sl).
  // Allt sparas i t, och t sparas i ballTex.
  const rnd = makeRng(99), sca = [], ssa = [], so = [], sl = [];
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI;
    sca.push(Math.cos(a)), ssa.push(Math.sin(a)), so.push((rnd() - 0.5) * 1.3), sl.push(0.25 + rnd() * 0.5);
  }
  Object.assign(t, { sca, ssa, so, sl }), ballTex = t;
}

// Miljö som speglas i kulan
// Jag förminskar rummet (roomLayer) till en liten bild på 192 pixlar bred och sparar färgerna som flyttal med en kvadrat (ungefär som ljusstyrka).
// Kulan kan sedan slå upp färger ur den för att spegla rummet. Om något går fel (till exempel av säkerhetsskäl för bilden) rensas bgNote.
function buildBallEnv() {
  ballEnv = null;
  try {
    const eh = Math.max(8, Math.round(192 * height / width)), c = makeCanvas(192, eh), g = c.getContext("2d", { willReadFrequently: !0 });
    g.drawImage(roomLayer, 0, 0, 192, eh);
    const px = g.getImageData(0, 0, 192, eh).data, out = new Float32Array(192 * eh * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3)
      out[j] = (px[i] / 255) ** 2, out[j + 1] = (px[i + 1] / 255) ** 2, out[j + 2] = (px[i + 2] / 255) ** 2;
    ballEnv = { w: 192, h: eh, d: out };
  } catch {
    bgImg && (bgNote = "");
  }
}

// Ritar kulans rullande textur
// Funktionen körs varje bild. roll är hur mycket kulan har rullat (för reporna) och pos kulans position.
function renderBallTexture(roll, pos) {
  // Här räknas alla värden ut som ändras över tid och som används för varje pixel:
  // en (energi), pu (puls) och ph (fas) från fx, cr och sr (rullningens vinkel), neon (neonstyrka, svagare med bakgrundsbild),
  // inten (ljusstyrka efter energi), lampC och lampI (lampornas färg och styrka), aL/cl/sl och aL2/cl2/sl2 (riktning på två rörliga lasrar),
  // laserI, floorI, magI, cyaI, vioI och edgeI (styrka på laser, golv, glans och kant), wob (liten svajning),
  // studio (studioljus), skyW (himlens vikt), uOff (förskjutning i miljöbilden efter kulans läge) samt ew och eh (miljöbildens storlek).
  const t = ballTex, d = t.img.data, N = t.N, env = ballEnv, en = fx.energy, pu = fx.pulse, ph = fx.phase, cr = Math.cos(roll), sr = Math.sin(roll), neon = 0.6 * (bgImg ? 0.45 : 1), inten = 0.38 + 0.62 * en, lampC = [PAL.mag, PAL.cya, PAL.vio, PAL.mag].map((c) => [c[0] / 255, c[1] / 255, c[2] / 255]), lampI = [0, 1, 2, 3].map((j) => (inten * (0.55 + 0.45 * Math.sin(ph * 2.1 + j * 1.7)) + pu * 0.8) * neon), aL = ph * 0.8, cl = Math.cos(aL), sl = Math.sin(aL), oL = 0.12 * Math.sin(ph * 1.3), aL2 = -ph * 0.55 + 1.2, cl2 = Math.cos(aL2), sl2 = Math.sin(aL2), oL2 = 0.15 * Math.cos(ph * 0.9), laserI = (0.15 + 0.85 * en) * neon, floorI = (0.3 + 0.9 * en + pu * 0.5) * neon * 0.65, magI = (1.15 * inten + pu * 0.9) * neon, cyaI = (1 * inten + pu * 0.6) * neon, vioI = 0.6 * inten * neon, edgeI = (0.12 + en * 0.55) * neon, wob = 0.18 * Math.sin(ph * 1.1), studio = 1 * (0.8 + 0.2 * inten), skyW = env ? 0.35 : 1, envG = 1.8, uOff = (pos.x / width - 0.5) * 0.3, ew = env ? env.w : 0, eh = env ? env.h : 0;
  for (let i = 0; i < N; i++) {
    // Pixlar utanför kulan görs genomskinliga. För övriga börjar jag med himlens färg (r, g, b), lite blåaktig och ljusare uppåt.
    const al = t.al[i];
    if (al <= 0) {
      d[i * 4 + 3] = 0;
      continue;
    }
    const rx = t.rx[i], up = t.up[i], sk = t.sky[i] * skyW, g1 = t.skyG[i];
    let r = sk * (0.74 + 0.26 * g1), g = sk * (0.75 + 0.25 * g1), b = sk * (0.8 + 0.2 * g1);
    // Om en miljöbild finns slår jag upp färgen i rummet dit reflektionen pekar. u och v är läget i bilden.
    // Jag blandar mellan de fyra närmaste pixlarna (bilinjär interpolation) så att det blir mjukt, och lägger till färgen.
    if (env) {
      let u = 0.5 + rx * 0.48 + uOff, v = 0.5 - up * 0.48;
      u -= Math.floor(u * 0.5) * 2, u > 1 && (u = 2 - u), v = v < 0 ? 0 : v > 1 ? 1 : v;
      const fxp = u * (ew - 1), fyp = v * (eh - 1), x0 = fxp | 0, y0 = fyp | 0, x1 = x0 + 1 < ew ? x0 + 1 : x0, y1 = y0 + 1 < eh ? y0 + 1 : y0, tx = fxp - x0, ty = fyp - y0, a00 = (y0 * ew + x0) * 3, a10 = (y0 * ew + x1) * 3, a01 = (y1 * ew + x0) * 3, a11 = (y1 * ew + x1) * 3, E = env.d, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      r += (E[a00] * w00 + E[a10] * w10 + E[a01] * w01 + E[a11] * w11) * envG, g += (E[a00 + 1] * w00 + E[a10 + 1] * w10 + E[a01 + 1] * w01 + E[a11 + 1] * w11) * envG, b += (E[a00 + 2] * w00 + E[a10 + 2] * w10 + E[a01 + 2] * w01 + E[a11 + 2] * w11) * envG;
    }
    // Studioljusen (ke och se) läggs till som vitt ljus.
    const ke = (t.key[i] * 2.6 + t.hot[i] * 2.4) * studio, se = t.strip[i] * 1.8 * studio;
    r += ke * 0.99 + se * 0.92, g += ke + se * 0.96, b += ke + se;
    // De fyra lamporna i taket läggs till, var och en i sin egen färg.
    for (let j = 0; j < 4; j++) {
      const e = t.gl[j][i] * lampI[j] * 1.3, c = lampC[j];
      r += e * c[0], g += e * c[1], b += e * c[2];
    }
    // Tre färgade glansar: magenta, cyan och violett.
    const em = t.gm[i] * magI;
    r += em, g += em * 0.16, b += em * 0.84;
    const ec = t.gc[i] * cyaI;
    r += ec * 0.1, g += ec * 0.9, b += ec;
    const ev = t.gv[i] * vioI;
    // Om reflektionen pekar nedåt tillkommer golvets sken, som blandas mellan cyan och magenta beroende på sidled.
    if (r += ev * 0.59, g += ev * 0.29, b += ev, up < -0.1) {
      const m = clamp01(0.5 + rx * 0.7 + wob), e = t.fl[i] * floorI;
      r += e * ((PAL.cya[0] * (1 - m) + PAL.mag[0] * m) / 255), g += e * ((PAL.cya[1] * (1 - m) + PAL.mag[1] * m) / 255), b += e * ((PAL.cya[2] * (1 - m) + PAL.mag[2] * m) / 255);
    }
    // Två rörliga laserlinjer (l1 och l2) syns som smala ljusa band i reflektionen.
    const p1 = rx * cl + up * sl - oL, l1 = Math.exp(-p1 * p1 / 9e-4) * laserI * 0.7, p2 = rx * cl2 + up * sl2 - oL2, l2 = Math.exp(-p2 * p2 / 9e-4) * laserI * 0.7;
    r += l1 * 0.1 + l2, g += l1 * 0.9 + l2 * 0.15, b += l1 + l2 * 0.85;
    // Ett färgat sken längs kulans kant, där vänster sida är mer magenta och höger mer cyan.
    const f4 = t.f4[i] * edgeI, sd = t.side[i];
    r += f4 * (0.15 + 0.8 * sd), g += f4 * (0.8 - 0.55 * sd), b += f4 * (1 - 0.15 * sd);
    // Fresnel och skugga mot undersidan multipliceras in, så att färgen blir något mörkare där.
    const k = t.fres[i] * t.ao[i];
    r *= k * 0.97, g *= k * 0.985, b *= k;
    // Reporna: jag vrider pixelns läge med kulans rullning (sx, sy) och kontrollerar för varje repa om pixeln ligger nära den.
    // I så fall ökar scr, som blir en liten ljusning.
    const sx = t.nx[i] * cr + t.ny[i] * sr, sy = -t.nx[i] * sr + t.ny[i] * cr;
    let scr = 0;
    for (let q = 0; q < 7; q++) {
      const dd = sx * t.sca[q] + sy * t.ssa[q] - t.so[q];
      if (dd < 0.012 && dd > -0.012) {
        const al2 = -sx * t.ssa[q] + sy * t.sca[q];
        al2 > -t.sl[q] && al2 < t.sl[q] && (scr += (1 - Math.abs(dd) / 0.012) * 0.5);
      }
    }
    // Reporna lägger på ljus, starkare där kulan redan är ljus.
    const lum0 = (r + g + b) / 3, add = scr * (0.02 + lum0 * 0.18);
    r += add, g += add, b += add;
    // Tonmappning: starkt ljus trycks ihop med en exponentialkurva så att färgerna inte bränns ut, och mycket ljusa pixlar blandas mot vitt.
    // Sist skrivs färgen och genomskinligheten in i pixeldatan (0–255).
    const lum = (r + g + b) / 3, w = smoothstep01(0.9, 2.2, lum) * 0.85, ex = 1.5 * 1;
    r = 1 - Math.exp(-r * ex), g = 1 - Math.exp(-g * ex), b = 1 - Math.exp(-b * ex), r += (1 - r) * w, g += (1 - g) * w, b += (1 - b) * w, d[i * 4] = r * 255, d[i * 4 + 1] = g * 255, d[i * 4 + 2] = b * 255, d[i * 4 + 3] = al * 255;
  }
  // När alla pixlar är klara skickas bilden till kulans canvas.
  t.ctx.putImageData(t.img, 0, 0);
}

// Visuellt tillstånd (energi, puls, friktion) följer kulans fart
function updateFx(dt, now) {
  // th är backens lutning vid kulan och sp kulans fart. Hålls kulan används ett mått på handens rörelse i stället.
  const th = Math.atan2(slopeY(ball.x + 2) - slopeY(ball.x - 2), 4), sp = ball.held ? Math.min(Math.hypot(ball.vx, ball.vy) * 0.6, 900) : Math.abs(ball.vx);
  fx.speed = sp;
  // energy går mot ett mål (farten delat med 850, max 1). Den stiger snabbare (4,5) än den sjunker (1,5), så att scenen "värms upp" fort och svalnar långsamt.
  // phase, chase och drift är klockor som går snabbare ju högre energin är.
  // pulse är en puls som slår i takt med musiken (128 slag per minut) och är starkast på slaget.
  // roll ökar när kulan rullar, så att reporna på kulan vrids.
  const target = clamp01(sp / 850);
  fx.energy += (target - fx.energy) * (1 - Math.exp(-dt * (target > fx.energy ? 4.5 : 1.5))), fx.phase += dt * (0.3 + 1.2 * fx.energy), fx.chase += dt * (30 + 280 * fx.energy), fx.drift += dt * (0.4 + 0.8 * fx.energy), fx.pulse = Math.pow(1 - now * 128 / 60 % 1, 3) * fx.energy, ball.held || (fx.roll += ball.vx / Math.max(0.35, Math.cos(th)) * dt / 50);
  // key2 är läge och nivå. Om de är oförändrade och kulan inte hålls räknar jag ut hur snabbt farten minskar (dec, max 2500).
  // Annars nollställs det, så att ett nivåbyte inte räknas som en inbromsning. decel följer dec mjukt.
  const key2 = mode + ":" + level;
  let dec = 0;
  key2 === fx.key && !ball.held && (dec = Math.min(2500, Math.max(0, (fx.prevV - sp) / Math.max(dt, 1e-3)))), fx.key = key2, fx.prevV = sp, fx.decel += (dec - fx.decel) * (1 - Math.exp(-dt * 9));
  // fr är friktionen som ger gnistor och glöd. På nivå 1–3 (och i demo) bestäms den av hur kraftigt kulan bromsar.
  // På nivå 2 finns alltid lite friktion när kulan rör sig, och på nivå 3 blir den stark när kulan är nära en bromszon.
  let fr = 0;
  if ((mode === "demo" || level <= 3) && (fr = clamp01(fx.decel / 240)), mode === "user" && level === 2 && (fr = Math.max(fr, 0.5 * clamp01(sp / 200))), mode === "user" && level === 3 && !ball.held) {
    const minX = slope.x1 + 50, maxX = width - 50;
    for (const tt of [0.3, 0.56, 0.78])
      Math.abs(ball.x - lerp(minX, maxX, tt)) < 42 && (fr = Math.max(fr, 0.85 * clamp01(sp / 160)));
  }
  // Hålls kulan finns ingen friktion. Värdet sparas i fx.fric, som även används av Ljud.
  fx.fric = ball.held ? 0 : fr;
}

// Kulans ritade position (följer banans lutning)
function ballVisualPos(dt) {
  // lift är hur mycket kulan lyfts från banan när den greppas (34 pixlar) och blend hur mycket den ligger på banan (1) eller svävar (0).
  // Båda rör sig mjukt mot sina mål.
  fx.lift += ((ball.held ? 34 : 0) - fx.lift) * (1 - Math.exp(-dt * 18)), fx.blend += ((ball.held ? 0 : 1) - fx.blend) * (1 - Math.exp(-dt * 9));
  // Här räknas två positioner ut. restX och restY är där kulan ligger när den vilar på den lutande banan (förskjuten vinkelrätt mot ytan),
  // och hx och hy är där den är när den hålls (med lyftet). Resultatet blandas mellan de två med blend.
  // cx och cy är banans punkt rakt under kulan och används för skuggor och ljus.
  const th = Math.atan2(slopeY(ball.x + 2) - slopeY(ball.x - 2), 4), cy = slopeY(ball.x), restX = ball.x + 50 * Math.sin(th), restY = cy - 50 * Math.cos(th), hx = ball.x, hy = ball.y - fx.lift;
  return { x: hx + (restX - hx) * fx.blend, y: hy + (restY - hy) * fx.blend, th, cx: ball.x, cy };
}

// Dimma
// layer är 0 för dimma bakom banan och 1 för dimma framför. Varje lager ritar varannan av 14 dimsprites.
function drawFog(ctx, now, layer) {
  const en = fx.energy, W = width;
  // Dimman ritas med "lighter" så att färgerna adderas. Varje sprite driver långsamt i sidled (drift) och guppar uppåt och nedåt med en sinusvåg.
  // Genomskinligheten ökar med energi och puls.
  ctx.save(), ctx.globalCompositeOperation = "lighter";
  for (let i = layer; i < 14; i += 2) {
    const sp = fogSprites[i % 3], x = ((i * 0.173 + fx.drift * (4e-3 + 15e-4 * (i % 5))) % 1.3 - 0.15) * W, y = floorY * (0.3 + 0.62 * (i * 0.382 % 1)) + Math.sin(now * 0.25 + i) * 22, sz = (300 + 110 * (i % 4)) * sceneScale;
    ctx.globalAlpha = 0.05 + 0.07 * en + 0.04 * fx.pulse, ctx.drawImage(sp, x - sz / 2, y - sz / 2, sz, sz * 0.7);
  }
  // Det främre lagret får även ett violett dis längs golvet (hz), som blir tydligare med energin.
  if (layer === 1) {
    ctx.globalAlpha = 1;
    const hz = ctx.createLinearGradient(0, floorY - height * 0.18, 0, floorY + height * 0.04);
    hz.addColorStop(0, "rgba(110,60,190,0)"), hz.addColorStop(0.8, `rgba(110,60,190,${(0.05 + 0.09 * en).toFixed(3)})`), hz.addColorStop(1, "rgba(110,60,190,0)"), ctx.fillStyle = hz, ctx.fillRect(0, floorY - height * 0.18, W, height * 0.22);
  }
  ctx.restore();
}

// Strålkastare
// Den här funktionen ritar de äldre taklamporna i rig. De används bara när ingen bakgrundsbild finns.
function drawBeams(ctx) {
  const en = fx.energy, pu = fx.pulse, sc = sceneScale;
  // För varje lampa räknas en svepande vinkel ut (sweep) som blir större med energin. L är strålens längd ner till golvet och a dess styrka.
  ctx.save(), ctx.globalCompositeOperation = "lighter", rig.forEach((f, i) => {
    const sweep = (0.1 + 0.28 * en) * Math.sin(fx.phase * (0.8 + 0.12 * i) + f.phase), ang = f.base + sweep, L = (floorY - f.y) / Math.cos(ang), a = (0.03 + 0.085 * en + 0.16 * pu) * (0.7 + 0.3 * Math.sin(fx.phase * 1.7 + i));
    // Strålen ritas som tre trianglar på varandra (bred, medel och smal) med en gradient som tonar ut mot golvet.
    ctx.save(), ctx.translate(f.x, f.y), ctx.rotate(ang), [1, 0.55, 0.28].forEach((m) => {
      const hw = L * Math.tan(f.spread * m), gr = ctx.createLinearGradient(0, 0, 0, L);
      gr.addColorStop(0, rgbaStr(f.col, a * 1.6)), gr.addColorStop(0.6, rgbaStr(f.col, a * 0.7)), gr.addColorStop(1, rgbaStr(f.col, a * 0.25)), ctx.fillStyle = gr, ctx.beginPath(), ctx.moveTo(0, 0), ctx.lineTo(-hw, L), ctx.lineTo(hw, L), ctx.closePath(), ctx.fill();
    }), ctx.restore();
    // Där strålen träffar golvet ritas en platt ljuspöl (hx är träffpunkten), och vid lampan en glödande punkt.
    const hx = f.x - Math.sin(ang) * L, rad = Math.max(40 * sc, L * Math.tan(f.spread) * 2.2);
    ctx.save(), ctx.translate(hx, floorY), ctx.scale(1, 0.16);
    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    pg.addColorStop(0, rgbaStr(f.col, 0.35 * (0.4 + en + pu))), pg.addColorStop(1, rgbaStr(f.col, 0)), ctx.fillStyle = pg, ctx.beginPath(), ctx.arc(0, 0, rad, 0, 7), ctx.fill(), ctx.restore();
    const lg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 26 * sc);
    lg.addColorStop(0, rgbaStr(mixCol(f.col, [255, 255, 255], 0.6), 0.35 + 0.5 * en + 0.4 * pu)), lg.addColorStop(1, rgbaStr(f.col, 0)), ctx.fillStyle = lg, ctx.beginPath(), ctx.arc(f.x, f.y, 26 * sc, 0, 7), ctx.fill();
  }), ctx.restore();
}

// Lasrar
// De äldre lasrarna. De syns inte alls när energin är under 0,03.
function drawLasers(ctx) {
  const en = fx.energy;
  if (en < 0.03) return;
  // Lasrarna utgår från takstommen. Jag klipper till rummet ovanför golvet och ritar med "lighter".
  const sc = sceneScale, ty = trussHeight() + 8 * sc, len = Math.hypot(width, height);
  ctx.save(), ctx.beginPath(), ctx.rect(0, 0, width, floorY), ctx.clip(), ctx.globalCompositeOperation = "lighter", ctx.lineCap = "round", [[0.2, PAL.cya, 1], [0.5, PAL.mag, -1], [0.8, PAL.cya, 1]].forEach(([fr, col, dir], e) => {
    // Tre utgångspunkter (vid 20 %, 50 % och 80 % av bredden), var och en med tre lasrar som svänger i olika vinklar.
    // Varje laser ritas två gånger: en bred, svag linje som sken och en tunn skarp linje med gradient.
    const ox = width * fr;
    for (let k = 0; k < 3; k++) {
      const ang = dir * (0.15 + 0.3 * Math.sin(fx.phase * 0.9 + e * 2 + k * 0.6)) + (k - 1) * 0.2, ex = ox + Math.sin(ang) * len, ey = ty + Math.cos(ang) * len, lgr = ctx.createLinearGradient(ox, ty, ex, ey);
      lgr.addColorStop(0, rgbaStr(mixCol(col, [255, 255, 255], 0.5), 0.55 * en)), lgr.addColorStop(0.55, rgbaStr(col, 0.22 * en)), lgr.addColorStop(1, rgbaStr(col, 0)), ctx.strokeStyle = rgbaStr(col, 0.05 * en), ctx.lineWidth = 5 * sc, ctx.beginPath(), ctx.moveTo(ox, ty), ctx.lineTo(ex, ey), ctx.stroke(), ctx.strokeStyle = lgr, ctx.lineWidth = 1.2, ctx.beginPath(), ctx.moveTo(ox, ty), ctx.lineTo(ex, ey), ctx.stroke();
    }
  }), ctx.restore();
}
// tracePoly ritar en linje längs banans kurva med förskjutningen off (utan att själv fylla eller linjera den).
function tracePoly(ctx, off) {
  ctx.beginPath(), ctx.moveTo(geo.xs[0], geo.ys[0] + off);
  for (let i = 1; i < geo.N; i++) ctx.lineTo(geo.xs[i], geo.ys[i] + off);
}

// Ljus på banan
function drawTrackLight(ctx, pos) {
  const en = fx.energy, pu = fx.pulse, sc = sceneScale, W = width;
  // Allt ljus klipps till banans form (geo.body) så att det inte syns utanför banan.
  // Fem långsamt rörliga, platta ljusfläckar glider längs banans framsida, växelvis magenta och cyan.
  ctx.save(), ctx.clip(geo.body), ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const u = (fx.drift * (0.05 + 0.02 * i) + i * 0.21) % 1.2 - 0.1, x = u * W, y = slopeY(x) + geo.d + geo.T * 0.35, col = i % 2 ? PAL.cya : PAL.mag;
    ctx.save(), ctx.translate(x, y), ctx.scale(3.2, 0.5);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    gr.addColorStop(0, rgbaStr(col, 0.05 + 0.18 * en + 0.2 * pu)), gr.addColorStop(1, rgbaStr(col, 0)), ctx.fillStyle = gr, ctx.beginPath(), ctx.arc(0, 0, 60, 0, 7), ctx.fill(), ctx.restore();
  }
  // Under kulan lyser banan i en färg som växlar mellan magenta och cyan (gc). Den syns bara när kulan ligger på banan (fx.blend).
  const gc = mixCol(PAL.mag, PAL.cya, 0.5 + 0.5 * Math.sin(fx.phase * 1.3));
  ctx.save(), ctx.translate(pos.cx, pos.cy), ctx.scale(1, 0.45);
  const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 150);
  bg.addColorStop(0, rgbaStr(gc, (0.14 + 0.22 * en + 0.25 * pu) * fx.blend)), bg.addColorStop(1, rgbaStr(gc, 0)), ctx.fillStyle = bg, ctx.beginPath(), ctx.arc(0, 0, 150, 0, 7), ctx.fill(), ctx.restore(), ctx.restore();
  // Neonlisterna längs banans fram- (magenta) och baksida (cyan). Varje list ritas i flera lager: två breda sken, en tydlig färgad linje,
  // en tunn vit kärna, och sist en prickad vit linje som "springer" längs listen (chase).
  // Fronten och baksidan springer åt olika håll.
  const glow = 0.45 + 0.35 * en + 0.35 * pu;
  ctx.save(), ctx.globalCompositeOperation = "lighter", ctx.lineJoin = "round", [[geo.neonFront, PAL.mag], [geo.neonBack, PAL.cya]].forEach(([off, col]) => {
    tracePoly(ctx, off), ctx.setLineDash([]), ctx.strokeStyle = rgbaStr(col, 0.07 * glow), ctx.lineWidth = 14 * sc, ctx.stroke(), ctx.strokeStyle = rgbaStr(col, 0.16 * glow), ctx.lineWidth = 7 * sc, ctx.stroke(), ctx.strokeStyle = rgbaStr(col, 0.9), ctx.lineWidth = 2.6 * sc, ctx.stroke(), ctx.strokeStyle = `rgba(255,255,255,${(0.55 * glow).toFixed(3)})`, ctx.lineWidth = 1, ctx.stroke(), ctx.setLineDash([70 * sc, 180 * sc]), ctx.lineDashOffset = -fx.chase * (off > 0 ? 1 : -1), ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (0.25 + 0.75 * en)).toFixed(3)})`, ctx.lineWidth = 3.6 * sc, ctx.stroke(), ctx.setLineDash([]);
  }), ctx.restore();
}

// Golvljus
function drawFloorLight(ctx, pos) {
  const en = fx.energy, pu = fx.pulse, W = width, sc = sceneScale;
  // Fem platta färgade ljuspölar jämnt fördelade längs golvet, ritade som tillplattade radiella gradienter.
  ctx.save(), ctx.globalCompositeOperation = "lighter", [PAL.cya, PAL.vio, PAL.mag, PAL.vio, PAL.cya].forEach((c, i) => {
    const x = W * (0.1 + i * 0.2);
    ctx.save(), ctx.translate(x, floorY + 4 * sc), ctx.scale(1, 0.14);
    const r2 = W * 0.2, gr2 = ctx.createRadialGradient(0, 0, 0, 0, 0, r2);
    gr2.addColorStop(0, rgbaStr(c, 0.05 + 0.1 * en + 0.12 * pu)), gr2.addColorStop(1, rgbaStr(c, 0)), ctx.fillStyle = gr2, ctx.beginPath(), ctx.arc(0, 0, r2, 0, 7), ctx.fill(), ctx.restore();
  });
  // Under kulan ritas ytterligare en ljuspöl på golvet i en växlande färg, som följer kulans läge i sidled.
  const gc = mixCol(PAL.mag, PAL.cya, 0.5 + 0.5 * Math.sin(fx.phase * 1.3));
  ctx.save(), ctx.translate(pos.cx, floorY + 6 * sc), ctx.scale(1, 0.15);
  const r = 190 * sc, gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, rgbaStr(gc, 0.1 + 0.3 * en + 0.25 * pu)), gr.addColorStop(1, rgbaStr(gc, 0)), ctx.fillStyle = gr, ctx.beginPath(), ctx.arc(0, 0, r, 0, 7), ctx.fill(), ctx.restore(), ctx.restore();
}

// Reflektion i golvet
function drawFloorReflection(ctx) {
  // Hf är höjden på området som speglas. Är det för litet (under 8 pixlar) görs ingenting.
  const W = width, Hf = Math.min(height - floorY, floorY * 0.5);
  if (Hf < 8) return;
  // Jag kopierar den redan ritade bilden ovanför golvet, vänder den upp och ned under golvlinjen och ritar den med 30 % styrka.
  // Sedan läggs en mörk gradient över golvet så att reflektionen tonar bort nedåt.
  ctx.save(), ctx.globalAlpha = 0.3, ctx.translate(0, floorY * 2), ctx.scale(1, -1), ctx.drawImage(ctx.canvas, 0, floorY - Hf, W, Hf, 0, floorY - Hf, W, Hf), ctx.restore();
  const fg = ctx.createLinearGradient(0, floorY, 0, height);
  fg.addColorStop(0, "rgba(4,3,8,.15)"), fg.addColorStop(1, "rgba(4,3,8,.92)"), ctx.fillStyle = fg, ctx.fillRect(0, floorY, W, height - floorY);
}
// stageOn säger om scenljuset är på (tangenten S växlar).
let stageOn = !0;

// STAGE_LEVELS är hur scenen ska se ut på varje nivå (och i demoläget). Det är här "mer rave ju högre nivå" bestäms.
// top och floor är antal tak- och golvstrålkastare som är tända, speed hur snabbt de rör sig och amp hur stora svepen är.
// bright är ljusstyrka, warm hur mycket magenta jämfört med cyan, och cycle hur mycket färgerna växlar över tid.
// zones (nivå 3) riktar strålkastare mot bromszonerna och track (nivå 2 och 5) får dem att följa kulan.
// smoke är mängden rök, strobe (nivå 4–5) blixtar i takt med musiken, laser styrkan på lasrarna och beat hur mycket de reagerar på taktslagen.
// spread är hur breda strålarna är.
// TOP_X, FLOOR_X och LEG_X är lägen (som andel av bredden) för taklampor, golvlampor och punkter där rök släpps ut.
// ZONE_OF kopplar vissa taklampor (index 0, 2 och 1) till var sin bromszon.
// stage är det aktuella, mjukt förändrade tillståndet: v är de nuvarande värdena (börjar som demo), phase en klocka, beat taktslaget,
// bx och by en fördröjd kopia av kulans läge, zoneX och zoneHit bromszonernas lägen och hur aktiva de är, och spots ljuspunkterna som röken lyses av.
const STAGE_LEVELS = {
  demo: { top: 6, floor: 4, speed: 0.45, amp: 0.18, bright: 0.85, warm: 0.3, cycle: 0.5, zones: 0, track: 0, smoke: 1.4, strobe: 0, laser: 0.3, beat: 0.35, spread: 1 },
  1: { top: 6, floor: 4, speed: 0.48, amp: 0.18, bright: 0.85, warm: 0.3, cycle: 0.4, zones: 0, track: 0, smoke: 1.4, strobe: 0, laser: 0.3, beat: 0.35, spread: 1 },
  2: { top: 7, floor: 5, speed: 0.55, amp: 0.22, bright: 0.95, warm: 0.6, cycle: 0.5, zones: 0, track: 0.35, smoke: 1.6, strobe: 0, laser: 0.4, beat: 0.5, spread: 1 },
  3: { top: 7, floor: 5, speed: 0.75, amp: 0.28, bright: 1, warm: 0.4, cycle: 0.8, zones: 1, track: 0, smoke: 1.6, strobe: 0, laser: 0.5, beat: 0.7, spread: 1 },
  4: { top: 8, floor: 6, speed: 0.85, amp: 0.32, bright: 1.1, warm: 0.5, cycle: 1, zones: 0, track: 0, smoke: 1.8, strobe: 0.2, laser: 0.8, beat: 0.85, spread: 1 },
  5: { top: 8, floor: 6, speed: 1.35, amp: 0.42, bright: 1.2, warm: 0.5, cycle: 1, zones: 0, track: 0.6, smoke: 2, strobe: 0.5, laser: 1, beat: 1, spread: 1 }
}, TOP_X = [0.08, 0.18, 0.29, 0.4, 0.5, 0.6, 0.71, 0.82, 0.92, 0.98], ZONE_OF = { 0: 0, 2: 1, 1: 2 }, FLOOR_X = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92], LEG_X = [0.04, 0.14, 0.25, 0.36, 0.47, 0.58, 0.69, 0.8, 0.91, 0.98], stage = { v: { ...STAGE_LEVELS.demo }, phase: 0, beat: 0, bx: 0, by: 0, zoneX: [0, 0, 0], zoneHit: [0, 0, 0], spots: [] };
// stageColor väljer färg på lampa nummer i. Jämna lampor är cyan/magenta och udda är violetta, beroende på nivåns warm-värde.
// Om cycle är över 0,01 blandas färgen dessutom med en färg som långsamt växlar mellan magenta och cyan.
function stageColor(i) {
  const v = stage.v, cool = i % 2 ? PAL.vio : PAL.cya, hot = i % 2 ? PAL.vio : PAL.mag;
  let c = mixCol(cool, hot, v.warm);
  return v.cycle > 0.01 && (c = mixCol(c, mixCol(PAL.mag, PAL.cya, 0.5 + 0.5 * Math.sin(stage.phase * 0.7 + i * 1.1)), v.cycle)), c;
}

// Rök och nivåstyrda strålkastare (STAGE_FX, S växlar)
function updateStage(dt, now) {
  // t är målvärdena för aktuell nivå (demo i demoläget) och v de nuvarande. Varje värde i v flyttas lite mot sitt mål varje bild,
  // så att scenen glider mjukt mellan nivåerna i stället för att hoppa.
  const t = STAGE_LEVELS[mode === "demo" ? "demo" : level] || STAGE_LEVELS[1], v = stage.v, k = 1 - Math.exp(-dt * 1.6);
  for (const n in t) v[n] += (t[n] - v[n]) * k;
  // Fasen går framåt, taktslaget (beat) räknas ut i takt med musiken, och bx/by får sitt första värde.
  // Sedan följer bx och by efter kulan med en fördröjning, vilket får strålkastarna att följa efter lite mjukt.
  stage.phase += dt * (0.25 + 1.3 * v.speed), stage.beat = Math.pow(1 - now * 128 / 60 % 1, 3), stage.bx || (stage.bx = ball.x, stage.by = ball.y);
  const kb = 1 - Math.exp(-dt * 2.5);
  stage.bx += (ball.x - stage.bx) * kb, stage.by += (ball.y - stage.by) * kb;
  // Bromszonernas lägen räknas ut (samma som i fysiken). zoneHit går mot 1 när kulan på nivå 3 är nära zonen och rullar, annars mot 0.
  // Därefter byggs rökens sprites om de saknas och röken uppdateras.
  const minX = slope.x1 + 50, maxX = width - 50;
  [0.3, 0.56, 0.78].forEach((tt, j) => {
    stage.zoneX[j] = lerp(minX, maxX, tt);
    const near = mode === "user" && level === 3 && !ball.held && Math.abs(ball.x - stage.zoneX[j]) < 60;
    stage.zoneHit[j] += ((near ? 1 : 0) - stage.zoneHit[j]) * (1 - Math.exp(-dt * 8));
  }), smoke.spr || buildSmokeSprites(), updateSmoke(dt, now);
}
// smoke samlar röken. p är listan med puffar, acc en räknare för när nästa puff ska skapas och burst tiden till nästa större utsläpp.
// spr är puffarnas bilder och bank en bred rökbank som ligger längs golvet.
// noiseGrid är ett rutnät med slumptal (NG x NG) som används för att skapa naturligt utseende moln.
const smoke = { p: [], acc: 0, burst: 1, vent: 0, spr: null, bank: null };
let noiseGrid = null;
const NG = 64;

// Brusfunktion för röken
// fbm (fractal Brownian motion) lägger flera lager av mjukt brus på varandra, där varje lager har dubbelt så hög frekvens och halva styrkan.
// Resultatet blir moln-liknande mönster. x och y är läget, per gör att mönstret kan upprepas sömlöst i sidled och oct är antal lager.
function fbm(x, y, per, oct) {
  // Första gången skapas rutnätet med slumptal (med fast frö, så att det alltid blir likadant).
  if (!noiseGrid) {
    const r = makeRng(555);
    noiseGrid = new Float32Array(NG * NG);
    for (let i = 0; i < NG * NG; i++) noiseGrid[i] = r();
  }
  // För varje lager räknas rutan som punkten ligger i ut, och de fyra hörnens värden blandas mjukt (xf och yf formas med smoothstep, u och v).
  // Lagren summeras och delas på summan av vikterna (norm) så att resultatet ligger mellan 0 och 1.
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let k = 0; k < oct; k++) {
    const px = per > 0 ? Math.min(NG, per * f) : NG, X = x * f + k * 13, Y = y * f + k * 7.7, xi = Math.floor(X), yi = Math.floor(Y), xf = X - xi, yf = Y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), x0 = (xi % px + px) % px, x1 = (x0 + 1) % px, y0 = (yi % NG + NG) % NG, y1 = (y0 + 1) % NG, n0 = noiseGrid[y0 * NG + x0] * (1 - u) + noiseGrid[y0 * NG + x1] * u, n1 = noiseGrid[y1 * NG + x0] * (1 - u) + noiseGrid[y1 * NG + x1] * u;
    s += (n0 * (1 - v) + n1 * v) * a, norm += a, a *= 0.5, f *= 2;
  }
  return s / norm;
}

// Rökpuffar
function buildSmokeSprites() {
  // tints är fyra färger: en grå dimfärg och magenta, cyan och violett för när röken lyses upp av strålkastare.
  // paint omvandlar en lista med täthet (dens2) och eventuell ljussättning (lit) till en bild med den valda färgen.
  // mixw avgör hur mycket vitt som blandas in i färgen.
  const tints = [[165, 172, 190], [255, 90, 230], [70, 225, 255], [185, 110, 255]], paint = (w, h, dens2, lit, col, mixw) => {
    const c = makeCanvas(w, h), g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < w * h; i++) {
      const a = dens2[i];
      if (a <= 0) continue;
      const L = lit ? lit[i] : 1;
      d[i * 4] = (col[0] * (1 - mixw) + 255 * mixw) * L, d[i * 4 + 1] = (col[1] * (1 - mixw) + 255 * mixw) * L, d[i * 4 + 2] = (col[2] * (1 - mixw) + 255 * mixw) * L, d[i * 4 + 3] = a * 255;
    }
    return g.putImageData(img, 0, 0), c;
  };
  // Sex olika puffar (sd) på 160x160 pixlar skapas. För varje pixel räknar jag avståndet r från mitten (ovalt), och utanför r = 1 finns ingen rök.
  // Tätheten (dens2) kommer från fbm, vriden av två andra brusfält (wx och wy) så att formen blir virvlande, och tonas ut mot kanten.
  // lit får lite skuggning genom att jämföra bruset med en något förskjuten punkt, så att puffen ser tredimensionell ut.
  // Varje puff sparas i fyra färger.
  smoke.spr = [];
  const S = 160;
  for (let sd = 0; sd < 6; sd++) {
    const dens2 = new Float32Array(S * S), lit = new Float32Array(S * S), ox = sd * 3.7, oy = sd * 2.3;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, dx = (u - 0.5) * 2, dy = (v - 0.5) * 2.2, r = Math.sqrt(dx * dx + dy * dy);
      if (r >= 1) continue;
      const wx = fbm(u * 2 + ox + 5, v * 2 + oy, 0, 3) - 0.5, wy = fbm(u * 2 + ox, v * 2 + oy + 9, 0, 3) - 0.5, px = u * 3 + wx * 1.4 + ox, py = v * 3 + wy * 1.4 + oy, n = fbm(px, py, 0, 4);
      dens2[y * S + x] = clamp01((n - 0.3) * 2.2) * smoothstep01(1, 0.15, r) * 0.85, lit[y * S + x] = clamp01(0.8 + (fbm(px - 0.05, py + 0.05, 0, 4) - n) * 6);
    }
    smoke.spr.push(tints.map((col, ti) => paint(S, S, dens2, lit, col, ti ? 0.1 : 0)));
  }
  // Rökbanken är en bred bild (512x128) som kan upprepas i sidled utan synlig skarv (per = 8). Den är tät i mitten och tonar ut upptill och nertill.
  // Den sparas i samma fyra färger.
  const BW = 512, BH = 128, dens = new Float32Array(BW * BH);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const u = x / BW, v = y / BH, n = fbm(u * 8, v * 2.2 + 3, 8, 4), prof = smoothstep01(0, 0.6, v) * (1 - smoothstep01(0.85, 1, v));
    dens[y * BW + x] = clamp01((n - 0.36) * 2.4) * prof;
  }
  smoke.bank = tints.map((col, ti) => paint(BW, BH, dens, null, col, ti ? 0.1 : 0));
}

// Skapar rök
// En ny puff skapas vid x, nära golvet. Är burst sant är det ett större utsläpp med snabbare och mer spridda puffar,
// annars en lugn puff som långsamt stiger. Varje puff får storlek (s), livslängd (max), rotation, vilken bild den använder (sh),
// styrka (a), ett slumpfrö och om den ritas framför (front) eller bakom kulan.
function spawnSmoke(x, burst) {
  const sc = sceneScale;
  smoke.p.push({
    x: x + (Math.random() - 0.5) * 50 * sc,
    y: floorY + (Math.random() - 0.4) * 10 * sc,
    vx: (Math.random() - 0.5) * (burst ? 280 : 30) * sc,
    vy: -(burst ? 25 + Math.random() * 60 : 3 + Math.random() * 9) * sc,
    s: (burst ? 55 + Math.random() * 45 : 70 + Math.random() * 60) * sc,
    life: 0,
    max: 7 + Math.random() * 5,
    rot: (Math.random() - 0.5) * 0.6,
    vr: (Math.random() - 0.5) * 0.08,
    sh: Math.random() * 6 | 0,
    a: 0.1 + Math.random() * 0.08,
    seed: Math.random() * 100,
    front: Math.random() < 0.3
  });
}

// Uppdaterar rök
function updateSmoke(dt, now) {
  // dens är rökmängden för nivån och P listan med puffar.
  // Om det finns rök att skapa räknas acc upp, och varje gång den når 1 skapas en puff (högst 320 gånger kvalitetsfaktorn perf.q).
  // Puffen skapas oftast vid en av benens positioner (LEG_X), men ibland var som helst längs bredden.
  const v = stage.v, W = width, sc = sceneScale, dens = 1.7 * v.smoke, P = smoke.p;
  if (dens > 0.02) {
    for (smoke.acc += dt * (4 + 5 * dens); smoke.acc >= 1 && (smoke.acc -= 1, !(P.length >= 320 * perf.q)); )
      spawnSmoke(Math.random() < 0.25 ? Math.random() * W : W * LEG_X[Math.random() * LEG_X.length | 0], !1);
    // Med slumpmässiga mellanrum (1–2,8 s) släpps ett större utsläpp (burst) ut vid ett av benen, med fler puffar när rökmängden är större.
    if (smoke.burst -= dt, smoke.burst <= 0) {
      smoke.burst = 1 + Math.random() * 1.8;
      const vx = W * LEG_X[Math.random() * LEG_X.length | 0], n = Math.round(6 + 6 * dens);
      for (let i = 0; i < n && P.length < 320 * perf.q; i++) spawnSmoke(vx, !0);
    }
  }
  // RX2 är kvadraten på avståndet inom vilket kulan påverkar röken, och top är högsta höjden som röken får stiga till.
  const RX2 = Math.pow(260 * sc, 2), top = floorY - height * 0.5;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    // Puffens ålder ökas, och är den äldre än sin livslängd tas den bort. u är hur långt in i livet puffen är (0–1).
    if (p.life += dt, p.life > p.max) {
      P.splice(i, 1);
      continue;
    }
    const u = p.life / p.max;
    // Röken drivs av luftströmmar (sinusvågor som beror på läge och tid) och stiger lite. Luftmotståndet (drag) är starkare i början av livet.
    // Röken trycks tillbaka ner om den kommer över toppnivån och stoppas vid golvet.
    p.vx += (Math.sin(p.y * 0.011 + now * 0.45 + p.seed) + 0.6 * Math.sin(p.x * 6e-3 - now * 0.3 + p.seed * 2.1)) * 14 * sc * dt, p.vy += Math.sin(p.x * 9e-3 + now * 0.38 + p.seed * 1.7) * 5 * sc * dt - 9 * sc * (1 - u) * dt;
    const drag = Math.exp(-dt * (0.4 + 1.4 * (1 - clamp01(u * 4))));
    p.vx *= drag, p.vy *= Math.exp(-dt * (0.5 + 0.8 * (1 - clamp01(u * 4)))), p.y < top && (p.vy += (top - p.y) * 0.5 * dt), p.y > floorY + 16 * sc && (p.y = floorY + 16 * sc, p.vy > 0 && (p.vy = 0));
    // När kulan rullar nära en puff (inom RX2) blåses röken med: den får kulans fart i sidled, trycks bort från kulan och lyfts lite uppåt.
    // Effekten är starkast nära kulan (f). Sist flyttas puffen och roteras.
    const dx = p.x - ball.x, dy = (p.y - ball.y) * 0.5, d2 = dx * dx + dy * dy;
    if (d2 < RX2 && !ball.held) {
      const f = 1 - d2 / RX2;
      p.vx += ball.vx * 1.4 * f * dt + dx / (Math.abs(dx) + 30) * 60 * f * dt, p.vy -= Math.abs(ball.vx) * 0.15 * f * dt;
    }
    p.x += p.vx * dt, p.y += p.vy * dt, p.rot += p.vr * dt;
  }
}

// Ritar rök
// layer 0 ritar rökbanken och puffarna bakom kulan, layer 1 puffarna framför.
function drawSmoke(ctx, layer) {
  const v = stage.v, en = fx.energy, dens = 1.7 * v.smoke, spots = stage.spots, sc = sceneScale;
  // Inget ritas om sprites saknas eller om det varken finns rök att skapa eller puffar kvar.
  if (!smoke.spr || dens < 0.02 && !smoke.p.length) return;
  // T är tiden i sekunder och bt är taktslagets styrka för nivån.
  const T = millis() / 1e3, bt = stage.beat * v.beat;
  // Det bakre lagret börjar med rökbanken: flera (KB, färre om datorn är långsam) horisontella band som glider i sidled med olika fart.
  // Varje band ritas två gånger bredvid varandra så att det blir sömlöst. Först en grå bas, sedan ett färgat sken ovanpå som blir starkare med energi och taktslag.
  if (ctx.save(), ctx.globalCompositeOperation = "source-over", layer === 0) {
    const W = width, Wb = W * 1.2, bh = height * 0.3, KB = Math.max(1, Math.round(4 * perf.q));
    for (let k = 0; k < KB; k++) {
      const off = ((T * (7 + 4 * k) + k * W * 0.37) % Wb + Wb) % Wb, y = floorY - bh * (0.62 - 0.11 * k) + Math.sin(T * 0.3 + k) * 6 * sc, base = Math.min(1, (0.1 + 0.04 * k) * Math.min(1.5, dens)) * 0.6;
      for (const ox of [-off, -off + Wb])
        ctx.globalCompositeOperation = "source-over", ctx.globalAlpha = base * 0.35 * 1.6, ctx.drawImage(smoke.bank[0], ox, y, Wb, bh), ctx.globalCompositeOperation = "lighter", ctx.globalAlpha = Math.min(1, base * (0.25 + 0.9 * en + 0.9 * bt) * 0.8), ctx.drawImage(smoke.bank[1 + k % 3], ox, y, Wb, bh);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  // PN är de tre färgerna (magenta, cyan, violett) som röken kan lysas upp i, normaliserade till 0–1.
  const PN = [[1, 0.14, 0.86], [0, 0.92, 1], [0.65, 0.25, 1]];
  for (const p of smoke.p) {
    // Puffar som hör till det andra lagret hoppas över. env är en mjuk in- och uttoning över livet och al puffens genomskinlighet. s är storleken, som växer när puffen åldras.
    if (layer === 1 !== p.front) continue;
    const u = p.life / p.max, env = smoothstep01(0, 0.12, u) * (1 - smoothstep01(0.45, 1, u)), al = p.a * env * clamp01(0.4 + dens) * (layer ? 0.8 : 1) * 0.6;
    if (al < 3e-3) continue;
    const s = p.s * (1 + 1.5 * Math.sqrt(u));
    // Här räknas hur mycket ljus från strålkastarna (spots) som träffar puffen. Varje ljuspunkt bidrar med sin färg, starkast nära punkten.
    // lit blir det sammanlagda ljuset (0–1).
    let r = 0, g = 0, b = 0;
    for (const sp of spots) {
      const rr = sp.r * 2.5 + 90 * sc, dx = (p.x - sp.x) / rr, dy = (p.y - sp.y) / (rr * (sp.flat < 0.5 ? 1.6 : 1)), w = Math.exp(-(dx * dx + dy * dy) * 2) * sp.a;
      r += sp.col[0] * w, g += sp.col[1] * w, b += sp.col[2] * w;
    }
    let lit = (r + g + b) / 765 * 1.4;
    // Finns inga ljuspunkter alls används en färg från stageColor efter puffens läge i sidled.
    if (!spots.length) {
      const c = stageColor(Math.floor(p.x / width * 8));
      r = c[0], g = c[1], b = c[2], lit = 0.35 * (0.4 + en + bt);
    }
    // Är puffen tillräckligt upplyst väljer jag den av de tre färgerna (ti) som ligger närmast ljusets färg.
    lit = clamp01(lit);
    let ti = 0;
    if (lit > 0.02) {
      const m = Math.max(r, g, b, 1), nr = r / m, ng = g / m, nb = b / m;
      let best = 9;
      PN.forEach((c, i) => {
        const d = (nr - c[0]) ** 2 + (ng - c[1]) ** 2 + (nb - c[2]) ** 2;
        d < best && (best = d, ti = i);
      });
    }
    // Puffen ritas roterad: först den grå bilden, och om den är upplyst även den färgade bilden ovanpå med "lighter".
    const set = smoke.spr[p.sh];
    ctx.save(), ctx.translate(p.x, p.y), ctx.rotate(p.rot), ctx.globalAlpha = Math.min(1, al * 3 * 0.35 * 1.6), ctx.drawImage(set[0], -s / 2, -s * 0.4, s, s * 0.8), lit > 0.02 && (ctx.globalCompositeOperation = "lighter", ctx.globalAlpha = Math.min(1, al * 3 * lit * 1), ctx.drawImage(set[1 + ti], -s / 2, -s * 0.4, s, s * 0.8)), ctx.restore();
  }
  ctx.restore();
}
// stageBeam ritar en enskild ljusstråle: den utgår från (sx, sy), roteras med rot och har längden L. spr är spridningen, col färgen och a styrkan.
// Strålen ritas som tre trianglar på varandra (bred, medel, smal) med gradient, så att mitten är starkast.
function stageBeam(ctx, sx, sy, rot, L, spr, col, a) {
  ctx.save(), ctx.translate(sx, sy), ctx.rotate(rot);
  for (const m of [1, 0.55, 0.28]) {
    const hw = L * Math.tan(spr * m), g = ctx.createLinearGradient(0, 0, 0, L);
    g.addColorStop(0, rgbaStr(col, a * 1.6)), g.addColorStop(0.6, rgbaStr(col, a * 0.7)), g.addColorStop(1, rgbaStr(col, a * 0.25)), ctx.fillStyle = g, ctx.beginPath(), ctx.moveTo(0, 0), ctx.lineTo(-hw, L), ctx.lineTo(hw, L), ctx.closePath(), ctx.fill();
  }
  ctx.restore();
}

// Nivåstyrda strålkastare
function drawStageBeams(ctx) {
  // base är grundstyrkan på strålarna, som ökar med ljusstyrkan för nivån och med energin. spots töms och fylls på nytt för varje bild.
  const v = stage.v, sc = sceneScale, en = fx.energy, bt = stage.beat * v.beat, ph = stage.phase, base = 1.5 * v.bright * (0.045 + 0.06 * en);
  stage.spots.length = 0, ctx.save(), ctx.globalCompositeOperation = "lighter", TOP_X.forEach((fr, i) => {
    // Taklamporna: on är hur tänd lampa i är (nivåns top-värde bestämmer hur många som lyser, och mjuka övergångar ger en gradvis tändning).
    // sx är lampans läge i taket och ang0 dess svepande vinkel. (tx, ty) är var strålen träffar, som först är golvet.
    const on = clamp01(v.top - i);
    if (on < 0.01) return;
    const sx = width * fr, sy = 0, zi = ZONE_OF[i], ang0 = (fr - 0.5) * 0.3 + v.amp * Math.sin(ph * (0.8 + 0.12 * i) + i * 1.3);
    let tx = sx - Math.tan(ang0) * floorY, ty = floorY, hit = 0;
    // Om lampan hör till en bromszon och zones är på (nivå 3) riktas strålen mot zonen på banan. hit blir större när kulan är där, och gör ljuset kraftigare och vitare.
    if (zi !== void 0 && v.zones > 0.01) {
      const zx = stage.zoneX[zi];
      tx += (zx - tx) * v.zones, ty += (slopeY(zx) - ty) * v.zones, hit = stage.zoneHit[zi] * v.zones;
    }
    // Om track är på (nivå 2 och 5) riktas strålarna mot kulan (bx, by, fördröjd), med en liten spridning (fan) så att de inte alla träffar samma punkt.
    if (v.track > 0.01) {
      const fan = (i - 2.5) * 60 * sc * (0.6 + 0.4 * Math.sin(ph * 1.3 + i));
      tx += (stage.bx + fan - tx) * v.track, ty += (Math.min(floorY, stage.by) - ty) * v.track;
    }
    // L är strålens längd, spr dess spridning, col färgen (vitare vid träff) och a styrkan, som ökar med taktslaget och med träffen.
    // Strålen ritas, och två ljuspunkter sparas i stage.spots: en där strålen landar (som lyser upp röken) och en vid lampan.
    const L = Math.hypot(tx - sx, ty - sy), spr = (0.027 + 7e-3 * (i % 3)) * v.spread, col = mixCol(stageColor(i), [255, 255, 255], 0.4 * hit), a = (base * (0.75 + 0.25 * Math.sin(ph * 1.7 + i)) + 1.5 * 0.1 * bt * v.bright) * on * (1 + 2.2 * hit);
    stageBeam(ctx, sx, sy, Math.atan2(sx - tx, ty - sy), L, spr, col, a), stage.spots.push({
      x: tx,
      y: ty,
      col,
      a: 0.35 * (0.4 + en + bt) * on * v.bright * (1 + hit),
      r: Math.max(28 * sc, L * Math.tan(spr) * 1.7),
      flat: 0.16 + 0.4 * clamp01(v.zones + v.track)
    }), stage.spots.push({ x: sx, y: 0, col, a: 0.4 * on, r: 18 * sc, flat: 1 });
  }), FLOOR_X.forEach((fr, i) => {
    // Golvlamporna: samma idé som taklamporna, men de sitter på golvet och lyser uppåt (strålen vänds med Math.PI).
    // floor-värdet bestämmer hur många som är tända. De lämnar också en ljuspunkt efter sig.
    const on = clamp01(v.floor - i);
    if (on < 0.01) return;
    const sx = width * fr, sy = floorY, ang = (fr - 0.5) * 0.3 + v.amp * 1.2 * Math.sin(ph * (0.9 + 0.1 * i) + i * 2.1 + 1), col = stageColor(i + 1), a = (base * 0.9 * (0.75 + 0.25 * Math.sin(ph * 1.9 + i)) + 1.5 * 0.09 * bt * v.bright) * on;
    stageBeam(ctx, sx, sy, Math.PI - ang, sy / Math.cos(ang), 0.024 * v.spread, col, a), stage.spots.push({ x: sx, y: sy + 4 * sc, col, a: 0.4 * (0.5 + bt + en) * on * v.bright, r: 70 * sc, flat: 0.25 });
  }), ctx.restore();
}
// drawStageSpots ritar själva ljuspunkterna (från stage.spots) som mjuka, tillplattade ljuspölar där strålarna träffar.
function drawStageSpots(ctx) {
  ctx.save(), ctx.globalCompositeOperation = "lighter";
  for (const s of stage.spots) {
    ctx.save(), ctx.translate(s.x, s.y), ctx.scale(1, s.flat);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
    g.addColorStop(0, rgbaStr(s.col, s.a)), g.addColorStop(1, rgbaStr(s.col, 0)), ctx.fillStyle = g, ctx.beginPath(), ctx.arc(0, 0, s.r, 0, 7), ctx.fill(), ctx.restore();
  }
  ctx.restore();
}
// drawStageLasers ritar lasrarna för scenen. Styrkan (laser) kommer från nivån, och lasrarna blir lite starkare på taktslagen.
// De fungerar som drawLasers ovan, men utgår från överkanten (y = 0) och följer scenens fas.
function drawStageLasers(ctx) {
  const la = stage.v.laser;
  if (la < 0.03) return;
  const sc = sceneScale, len = Math.hypot(width, height), ph = stage.phase, bt = 1 + 0.8 * stage.beat * stage.v.beat;
  ctx.save(), ctx.beginPath(), ctx.rect(0, 0, width, floorY), ctx.clip(), ctx.globalCompositeOperation = "lighter", ctx.lineCap = "round", [[0.2, PAL.cya, 1], [0.5, PAL.mag, -1], [0.8, PAL.cya, 1]].forEach(([fr, col, dir], e) => {
    const ox = width * fr;
    for (let k = 0; k < 3; k++) {
      const ang = dir * (0.15 + 0.3 * Math.sin(ph * 0.9 + e * 2 + k * 0.6)) + (k - 1) * 0.2, ex = ox + Math.sin(ang) * len, ey = Math.cos(ang) * len, lg = ctx.createLinearGradient(ox, 0, ex, ey);
      lg.addColorStop(0, rgbaStr(mixCol(col, [255, 255, 255], 0.5), 0.55 * la * bt)), lg.addColorStop(0.55, rgbaStr(col, 0.22 * la * bt)), lg.addColorStop(1, rgbaStr(col, 0)), ctx.strokeStyle = rgbaStr(col, 0.05 * la), ctx.lineWidth = 5 * sc, ctx.beginPath(), ctx.moveTo(ox, 0), ctx.lineTo(ex, ey), ctx.stroke(), ctx.strokeStyle = lg, ctx.lineWidth = 1.2, ctx.beginPath(), ctx.moveTo(ox, 0), ctx.lineTo(ex, ey), ctx.stroke();
    }
  }), ctx.restore();
}

// Blixt på taktslagen (nivå 5)
function drawStrobe(ctx, now) {
  // s är blixtens styrka för nivån (0 på nivå 1–3, 0,2 på nivå 4 och 0,5 på nivå 5). Under 0,02 ritas ingenting.
  const s = stage.v.strobe * 1;
  if (s < 0.02) return;
  // f är en kort puls som är som starkast i början av varje taktslag och sedan snabbt dör ut. Är den tillräckligt stor
  // fylls hela skärmen med ett svagt ljuslila ljus.
  const f = Math.pow(Math.max(0, 1 - now * 128 / 60 % 1 * 5), 2);
  f < 0.01 || (ctx.save(), ctx.globalCompositeOperation = "lighter", ctx.fillStyle = `rgba(225,205,255,${(0.08 * s * f).toFixed(4)})`, ctx.fillRect(0, 0, width, height), ctx.restore());
}

// Ljussvans efter kulan
function drawTrail(ctx, pos, now) {
  // tr är listan med kulans senaste positioner. När kulan rör sig snabbare än 80 läggs en ny punkt till, och gamla punkter (äldre än 0,42 s, eller fler än 64) tas bort.
  // amt är hur synlig svansen är (starkare vid högre fart, borta när kulan hålls). Är svansen för kort eller för svag ritas ingenting.
  const tr = fx.trail;
  for (!ball.held && fx.speed > 80 && tr.push({ x: pos.x, y: pos.y, t: now }); tr.length && (now - tr[0].t > 0.42 || tr.length > 64); ) tr.shift();
  const amt = smoothstep01(160, 750, fx.speed) * (ball.held ? 0 : 1) * 1, n = tr.length;
  if (n < 5 || amt < 0.02) return;
  // För varje punkt räknar jag ut en riktning och sedan en normal (nxs, nys) vinkelrätt mot rörelsen.
  // Normalerna används för att kunna rita parallella linjer vid sidan av svansens mittlinje.
  const R = 50, nxs = [], nys = [];
  for (let i = 0; i < n; i++) {
    const a = tr[Math.max(0, i - 1)], b = tr[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len, dy /= len, nxs.push(-dy), nys.push(dx);
  }
  // Första gången skapas elva streck (streaks) med slumpade egenskaper: sidoförskjutning (off), längd, tjocklek, styrka, färgblandning och fas.
  // De får ett fast frö så att de ser likadana ut varje gång.
  if (!fx.streaks) {
    const rnd = makeRng(7);
    fx.streaks = [];
    for (let k = 0; k < 11; k++) fx.streaks.push({
      off: (rnd() + rnd() - 1) * 0.85,
      len: 0.3 + rnd() * 0.7,
      w: 0.7 + rnd() * 1.9,
      b: 0.35 + rnd() * 0.65,
      mix: rnd(),
      ph: rnd() * 6.28
    });
  }
  // pathOffset skapar en bana längs svansens punkter, förskjuten sidledes med off. grad skapar en gradient längs svansen från första till sista punkten.
  const pathOffset = (i0, off) => {
    ctx.beginPath();
    for (let i = i0; i < n; i++) {
      const px = tr[i].x + nxs[i] * off, py = tr[i].y + nys[i] * off;
      i === i0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  }, grad = (i0, off, stops) => {
    const p0 = tr[i0], p1 = tr[n - 1], g = ctx.createLinearGradient(p0.x + nxs[i0] * off, p0.y + nys[i0] * off, p1.x + nxs[n - 1] * off, p1.y + nys[n - 1] * off);
    for (const [s, c] of stops) g.addColorStop(s, c);
    return g;
  };
  // Först ritas tre breda, mjuka band i violett, magenta och cyan som utgör svansens sken. De tonar ut från början av svansen mot kulan.
  ctx.save(), ctx.globalCompositeOperation = "lighter", ctx.lineCap = "round", ctx.lineJoin = "round", [[1.15, 0.06, PAL.vio], [0.7, 0.09, PAL.mag], [0.32, 0.12, PAL.cya]].forEach(([wf, al, col]) => {
    pathOffset(0, 0), ctx.strokeStyle = grad(0, 0, [[0, rgbaStr(col, 0)], [0.55, rgbaStr(col, al * amt * 0.6)], [1, rgbaStr(col, al * amt * 1.6)]]), ctx.lineWidth = R * wf, ctx.stroke();
  });
  // Sedan ritas de elva tunna strecken ovanpå. Varje streck börjar vid en punkt i svansen (efter längd), får sin egen färg mellan cyan och magenta
  // och flimrar lite med tiden (fl). Strecket är starkast och vitast nära kulan.
  for (const s of fx.streaks) {
    const i0 = Math.min(n - 2, Math.floor(n * (1 - s.len))), off = s.off * R * 0.8, col = mixCol(PAL.cya, PAL.mag, s.mix), fl = 0.8 + 0.2 * Math.sin(now * 28 + s.ph), a = amt * s.b * fl;
    pathOffset(i0, off), ctx.strokeStyle = grad(i0, off, [
      [0, rgbaStr(col, 0)],
      [0.45, rgbaStr(col, 0.28 * a)],
      [1, rgbaStr(mixCol(col, [255, 255, 255], 0.65), 0.85 * a)]
    ]), ctx.lineWidth = s.w * sceneScale, ctx.stroke();
  }
  ctx.restore();
}

// Kontaktskugga mot banan
function drawContact(ctx, pos) {
  // a är hur mycket kulan ligger mot banan (fx.blend). När kulan lyfts är skuggan borta.
  const a = fx.blend;
  if (a < 0.02) return;
  // Skuggan ritas roterad så att den följer banans lutning (pos.th). Först en bred, mjuk skugga (platt ellips), sedan en mindre och mörkare precis under kontaktpunkten.
  ctx.save(), ctx.translate(pos.cx, pos.cy), ctx.rotate(pos.th), ctx.save(), ctx.scale(1, 0.2);
  let gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 50 * 1.15);
  gr.addColorStop(0, `rgba(0,0,0,${(0.8 * a).toFixed(3)})`), gr.addColorStop(1, "rgba(0,0,0,0)"), ctx.fillStyle = gr, ctx.beginPath(), ctx.arc(0, 0, 50 * 1.15, 0, 7), ctx.fill(), ctx.restore(), ctx.save(), ctx.scale(1, 0.1), gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 50 * 0.5), gr.addColorStop(0, `rgba(0,0,0,${(0.95 * a).toFixed(3)})`), gr.addColorStop(1, "rgba(0,0,0,0)"), ctx.fillStyle = gr, ctx.beginPath(), ctx.arc(0, 0, 50 * 0.5, 0, 7), ctx.fill(), ctx.restore(), ctx.restore();
}

// Gnistor
function drawSparks(ctx, pos, dt) {
  const sp = fx.sparks;
  // Gnistor skapas när kulan rör sig (snabbare än 25 och inte hålls). Antalet per sekund (rate) beror mest på friktionen, men även lite på farten.
  // sparkAcc räknar upp och en gnista skapas varje gång den når 1 (högst 260 samtidigt).
  // Varje gnista startar vid kontaktpunkten med en hastighet som är en blandning av kulans rörelse (tx, ty), en riktning bort från banan (nx, ny) och slump.
  // Färgen är magenta eller cyan.
  if (!ball.held && fx.speed > 25) {
    const rate = fx.fric * 120 + clamp01(fx.speed / 900) * 10 * (fx.fric > 0.05 ? 1 : 0.6);
    for (fx.sparkAcc += rate * dt; fx.sparkAcc >= 1 && (fx.sparkAcc -= 1, !(sp.length > 260)); ) {
      const tx = Math.cos(pos.th), ty = Math.sin(pos.th), nx = Math.sin(pos.th), ny = -Math.cos(pos.th), v = Math.abs(ball.vx), s = 60 + Math.random() * 220;
      sp.push({
        x: pos.cx + (Math.random() - 0.5) * 10,
        y: pos.cy - 1,
        vx: tx * v * 0.35 + nx * s * 0.5 + (Math.random() - 0.3) * 90,
        vy: ty * v * 0.35 + ny * s + (Math.random() - 0.5) * 30,
        life: 0,
        max: 0.22 + Math.random() * 0.35,
        col: Math.random() < 0.5 ? PAL.mag : PAL.cya
      });
    }
  } else fx.sparkAcc = 0;
  // Vid friktion (över 0,05) ritas även ett varmt sken vid kontaktpunkten, som blir starkare med friktionen.
  if (ctx.save(), ctx.globalCompositeOperation = "lighter", ctx.lineCap = "round", fx.fric > 0.05) {
    const gr = ctx.createRadialGradient(pos.cx, pos.cy, 0, pos.cx, pos.cy, 34);
    gr.addColorStop(0, `rgba(255,220,250,${(0.35 * fx.fric).toFixed(3)})`), gr.addColorStop(1, "rgba(255,60,220,0)"), ctx.fillStyle = gr, ctx.beginPath(), ctx.arc(pos.cx, pos.cy, 34, 0, 7), ctx.fill();
  }
  // Varje gnista uppdateras: gamla gnistor och de som nått golvet tas bort. Tyngdkraften drar ner dem (900), de bromsas lite i sidled och flyttas.
  // De ritas som korta streck bakåt längs rörelsen. Färgen går från vit till gnistans färg när den åldras, och den blir tunnare och svagare (f).
  for (let i = sp.length - 1; i >= 0; i--) {
    const s = sp[i];
    if (s.life += dt, s.life > s.max || s.y > floorY) {
      sp.splice(i, 1);
      continue;
    }
    s.vy += 900 * dt, s.vx *= 1 - 1.2 * dt, s.x += s.vx * dt, s.y += s.vy * dt;
    const f = 1 - s.life / s.max;
    ctx.strokeStyle = rgbaStr(mixCol([255, 255, 255], s.col, 1 - f), f), ctx.lineWidth = 0.4 + 1.6 * f, ctx.beginPath(), ctx.moveTo(s.x, s.y), ctx.lineTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035), ctx.stroke();
  }
  ctx.restore();
}

// Ritar kulan med rörelseoskärpa och grepp-ring
function drawBallVisual(ctx, pos) {
  const en = fx.energy, pu = fx.pulse;
  // Först ett mjukt sken runt kulan i en färg som växlar mellan magenta och cyan. Sedan renderas kulans textur för den här bilden.
  ctx.save(), ctx.globalCompositeOperation = "lighter";
  const hc = mixCol(PAL.mag, PAL.cya, 0.5 + 0.5 * Math.sin(fx.phase * 1.3)), hg = ctx.createRadialGradient(pos.x, pos.y, 50 * 0.9, pos.x, pos.y, 50 * 2.4);
  hg.addColorStop(0, rgbaStr(hc, 0.05 + 0.12 * en + 0.18 * pu)), hg.addColorStop(1, rgbaStr(hc, 0)), ctx.fillStyle = hg, ctx.beginPath(), ctx.arc(pos.x, pos.y, 50 * 2.4, 0, 7), ctx.fill(), ctx.restore(), renderBallTexture(fx.roll, pos);
  // Rörelseoskärpa: half är halva texturens storlek och blur hur stark oskärpan är (ökar med farten, borta när kulan hålls).
  // Är den tillräckligt stor ritas kulan flera gånger (steps, färre om datorn är långsam) på tidigare positioner längs banan
  // (som om slutaren varit öppen 0,042 s) med svag genomskinlighet.
  const half = ballTex.S / 2, blur = smoothstep01(120, 900, Math.abs(ball.vx)) * (ball.held ? 0 : 1) * fx.blend * 1;
  if (blur > 0.02) {
    const steps = Math.max(3, Math.round(12 * perf.q)), shutter = 0.042;
    ctx.save();
    for (let k = steps; k >= 1; k--) {
      const q = k / steps, gx = ball.x - ball.vx * shutter * q;
      if (gx < slope.x1) continue;
      const p = restPosAt(gx);
      ctx.globalAlpha = blur * 0.26 * (1 - q * 0.85), ctx.drawImage(ballTex.cv, p.x - half, p.y - half);
    }
    ctx.restore();
  }
  // Själva kulan ritas, och när den hålls ritas även en cyanfärgad ring runt den (en bred svag och en tunn tydlig) som visar att den är greppad.
  ctx.drawImage(ballTex.cv, pos.x - half, pos.y - half), ball.held && (ctx.save(), ctx.globalCompositeOperation = "lighter", ctx.strokeStyle = "rgba(25,230,255,.18)", ctx.lineWidth = 7, ctx.beginPath(), ctx.arc(pos.x, pos.y, 50 * 1.55, 0, 7), ctx.stroke(), ctx.strokeStyle = "#19e6ff", ctx.lineWidth = 1.5, ctx.beginPath(), ctx.arc(pos.x, pos.y, 50 * 1.55, 0, 7), ctx.stroke(), ctx.restore());
}

// Kulans mittpunkt när den vilar på banan vid x
// Samma uträkning som i ballVisualPos: kulan placeras vinkelrätt ovanför banan med hänsyn till lutningen.
function restPosAt(x) {
  const th = Math.atan2(slopeY(x + 2) - slopeY(x - 2), 4), cy = slopeY(x);
  return { x: x + 50 * Math.sin(th), y: cy - 50 * Math.cos(th) };
}

// Hela scenen, lager för lager
function renderScene(dt, now) {
  // ctx är canvasens ritfunktioner. Saknas något lager byggs scenen. Sedan uppdateras det visuella tillståndet (fx) och scenljuset,
  // och kulans ritade position räknas ut.
  const ctx = drawingContext;
  (!roomLayer || !trackLayer || !geo) && buildScene(), updateFx(dt, now), stageOn && updateStage(dt, now);
  const pos = ballVisualPos(dt);
  // Lagren ritas i den här ordningen (längst bak först):
  // 1. rummet, 2. de äldre ljusen (dimma, strålkastare och lasrar, bara utan bakgrundsbild) eller scenens strålkastare och lasrar,
  // 3. banan, 4. ljus på banan, 5. ljuspunkter och bakre rök, 6. golvljus och golvreflektion (bara utan bakgrundsbild),
  // 7. kulans svans, 8. kontaktskugga, 9. kulan, 10. gnistor, 11. främre rök och dimma, 12. blixt,
  // 13. en rosa puls över hela bilden i takt med musiken, och 14. vinjetten överst.
  ctx.save(), ctx.globalAlpha = 1, ctx.globalCompositeOperation = "source-over", ctx.drawImage(roomLayer, 0, 0);
  const lights = !bgImg || !1;
  lights && (drawFog(ctx, now, 0), drawBeams(ctx), drawLasers(ctx)), stageOn && !lights && (drawStageBeams(ctx), drawStageLasers(ctx)), ctx.drawImage(trackLayer, 0, 0), drawTrackLight(ctx, pos), stageOn && (drawStageSpots(ctx), drawSmoke(ctx, 0)), lights && (drawFloorLight(ctx, pos), drawFloorReflection(ctx)), drawTrail(ctx, pos, now), drawContact(ctx, pos), drawBallVisual(ctx, pos), drawSparks(ctx, pos, dt), stageOn && drawSmoke(ctx, 1), lights && drawFog(ctx, now, 1), stageOn && drawStrobe(ctx, now), fx.pulse > 0.02 && (ctx.globalCompositeOperation = "lighter", ctx.fillStyle = `rgba(255,50,220,${(0.03 * fx.pulse).toFixed(4)})`, ctx.fillRect(0, 0, width, height), ctx.globalCompositeOperation = "source-over"), ctx.drawImage(vignetteLayer, 0, 0), ctx.restore();
}

// p5: huvudloop
function draw() {
  // draw körs av p5 för varje bild. Först målas bakgrunden mörk och handstyrningen uppdateras. Är världen inte startad ritas inget mer.
  if (background("#06040e"), updateHandControl(), !started) return;
  // Nedtoningen och nivåräkningen uppdateras. perf.ms följer hur lång tid en bild tar. Är den över 22 ms sänks kvaliteten (perf.q) långsamt,
  // och är den under 18 ms höjs den igen.
  updateFade(), updateGrabProgress(), perf.ms += (Math.min(100, deltaTime) - perf.ms) * 0.05, perf.ms > 22 ? perf.q = Math.max(0.3, perf.q - 0.01) : perf.ms < 18 && (perf.q = Math.min(1, perf.q + 4e-3));
  // now är tiden i sekunder och dt tiden sedan förra bilden (mellan 1 ms och 33 ms, så att fysiken inte skenar vid lagg).
  // Sedan uppdateras nivåstyrningen, kulans fysik och scenen ritas.
  // Till sist skickas information till Ljud (tid, fart, om kulan hålls, friktion och musiknivå), och texten på skärmen uppdateras var 0,15 sekund.
  const now = millis() / 1e3, dt = Math.min(0.033, Math.max(1e-3, now - lastFrameTime || 0.016));
  lastFrameTime = now, updateLevelDirector(now), updateBall(dt, now), renderScene(dt, now), snd("update", { dt, speed: Math.abs(ball.vx), held: ball.held, fric: fx.fric, level: musicLevel() }), now - lastHudUpdate > 0.15 && (updateHud(), lastHudUpdate = now);
}

// HUD – placering och stil
function updateHud() {
  // status är en text om läget, och extra visar hur många grepp som gjorts på nivån (bara i användarläget).
  const status = mode === "demo" ? "DEMO (l\xE5st, allt fungerar)" : "ANV\xC4NDARE";
  let extra = mode === "user" ? `
Grepp denna niv\xE5: ${Math.min(grabCount, 2)}/2` : "";
  // label är nivåtexten, desc en beskrivning av nivån och controls en lista över tangenterna (de två sistnämnda används inte i den slutliga texten).
  const label = mode === "demo" ? "NIV\xC5 1/5" : `NIV\xC5 ${level}/5`, desc = mode === "demo" ? "Fri fysik" : LEVELS[level].name, controls = mode === "demo" ? `1 = demol\xE4ge
2 = anv\xE4ndarl\xE4ge
Knyt handen (eller anv\xE4nd musen) f\xF6r att greppa kulan` : `1 = demol\xE4ge
2 = anv\xE4ndarl\xE4ge`;
  // Texten som visas på skärmen: nivå, antal grepp och handens status.
  document.getElementById("hud").textContent = `
${label}${extra}
Hand: ${handStatus()}`;
}
// updateInfo tömmer infotexten på skärmen.
function updateInfo() {
  document.getElementById("info").textContent = "";
}

// Tangentbord: 1/2 läge
function keyPressed() {
  // Varje tangenttryck räknas som aktivitet. Sedan avgör tangenten vad som händer:
  // 1 = demoläge och 2 = användarläge.
  markActive(), key === "1" ? setMode("demo") : key === "2" && setMode("user");
}

// Musplatta/touch: greppa, dra, släpp
// pointerPressed körs när musen eller fingret trycks ner. Är den inom 130 pixlar från kulan (50 * 2,6) och kulan inte redan hålls,
// greppas kulan: aktivitet och grepp registreras, avståndet mellan pekaren och kulan sparas (holdOffset) och hastigheten nollställs.
// Funktionen returnerar false så att webbläsarens standardbeteende (till exempel scrollning) stoppas.
function pointerPressed() {
  return started && dist(mouseX, mouseY, ball.x, ball.y) <= 50 * 2.6 && !ball.held && (markActive(), ball.held = !0, ball.sleeping = !1, noteGrabStart(), ball.holdOffsetX = ball.x - mouseX, ball.holdOffsetY = ball.y - mouseY, ball.previousPointerX = mouseX, ball.previousPointerY = mouseY, ball.vx = 0, ball.vy = 0), !1;
}
// pointerDragged körs när pekaren dras. Kulan följer pekaren (med sparat avstånd) men hålls inom skärmen.
// Hastigheten räknas ut från hur långt pekaren flyttats sedan förra gången och begränsas till ±1500. Den används som kulans fart vid släpp.
function pointerDragged() {
  if (!ball.held) return !1;
  ball.x = constrain(mouseX + ball.holdOffsetX, 50, width - 50), ball.y = constrain(mouseY + ball.holdOffsetY, 50, height - 50);
  const h = Math.max(1e-3, deltaTime / 1e3);
  return ball.vx = constrain((mouseX - ball.previousPointerX) / h, -1500, 1500), ball.vy = constrain((mouseY - ball.previousPointerY) / h, -1500, 1500), ball.previousPointerX = mouseX, ball.previousPointerY = mouseY, !1;
}
// pointerReleased körs när pekaren släpps. Greppet registreras, kulan släpps med sin fart, flyttas till backen och fysikfunktionerna startas om.
// På nivå 4 i användarläget startar den första fasen av rörelsen.
function pointerReleased() {
  return ball.held && (noteRelease(), ball.held = !1, ball.releaseSpeed = ball.vx, ball.releaseTime = millis() / 1e3, ball.x = constrain(ball.x, slope.x1, width - 50), ball.y = slopeY(ball.x) - 50, rollingTF.reset(ball.x, ball.vx), oscillatorTF.reset(ball.x, ball.vx), mode === "user" && level === 4 && (ball.level4Phase = 1)), !1;
}
// De här sex funktionerna kopplar mus och touch till samma tre funktioner ovan, så att det fungerar likadant på båda.
function mousePressed() {
  return pointerPressed();
}
function mouseDragged() {
  return pointerDragged();
}
function mouseReleased() {
  return pointerReleased();
}
function touchStarted() {
  return pointerPressed();
}
function touchMoved() {
  return pointerDragged();
}
function touchEnded() {
  return pointerReleased();
}