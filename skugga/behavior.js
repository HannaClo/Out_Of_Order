
// behavior.js – skuggans "konstiga beteende". In: spårad pose (skärmpixlar, {x,y} per led). Ut: manipulerad pose.
// Här tar jag emot personens spårade kroppsposition och förändrar den för att skapa skuggans rörelser.
// En pose är ett objekt som innehåller kroppens olika leder och deras x- och y-koordinater på skärmen.

// Skuggan börjar som perfekt spegling och avviker sedan:
// EVENTS: en kroppsdel avviker en stund (offset, rotate, delay, lead, reverse, freeze, own)
// Jag låter olika kroppsdelar få tillfälliga avvikelser. De kan till exempel förskjutas, roteras,
// röra sig med fördröjning eller börja göra egna rörelser.
// GHOST (nivå 5): hela skuggan kopplar loss och dansar/vinkar själv
// I ghost-läget slutar skuggan följa personens pose och får i stället en egen animerad kropp.
// BLINK: kort "glimt av normalitet" = tillbaka till perfekt spegling
// Under en kort stund återgår skuggan till den ursprungliga speglade posen.

// Kroppsdelar. pivot = led de svänger kring, joints = leder som flyttas. 'neck'/'hipMid' är virtuella (withVirtual i tracking).
// Jag beskriver här vilka leder som hör till varje kroppsdel.
// pivot är den punkt som används som centrum när jag exempelvis roterar en kroppsdel.
// joints är de leder vars positioner jag faktiskt manipulerar.
const PARTS = {
  head:  { pivot: 'neck', joints: ['nose','left_eye','right_eye','left_ear','right_ear'] },
  lArm:  { pivot: 'left_shoulder', joints: ['left_elbow','left_wrist'] },
  rArm:  { pivot: 'right_shoulder', joints: ['right_elbow','right_wrist'] },
  lLeg:  { pivot: 'left_hip', joints: ['left_knee','left_ankle'] },
  rLeg:  { pivot: 'right_hip', joints: ['right_knee','right_ankle'] },
  upper: { pivot: 'hipMid', joints: ['neck','nose','left_eye','right_eye','left_ear','right_ear','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist'] }
};

// Jag använder smoothstep för att få mjuka övergångar.
// Först begränsar jag värdet till intervallet 0–1 och räknar sedan fram en mjuk kurva.
// Funktionen används bland annat när avvikelser tonas in och ut.
const sstep = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }; // smoothstep 0..1 (används även i timeline.js)

// Jag använder den här funktionen för att få ett slumpmässigt värde mellan a och b.
const rnd = (a, b) => a + Math.random() * (b - a);

// Jag roterar en tvådimensionell vektor v med vinkeln a.
// Vinkeln anges i radianer och jag använder sinus och cosinus för att räkna ut de nya koordinaterna.
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

// Jag kopierar en pose så att jag kan arbeta med en separat version utan att ändra originalet.
// För varje led skapar jag ett nytt objekt med samma x- och y-koordinater.
const clonePose = J => { const o = {}; for (const n in J) o[n] = { x: J[n].x, y: J[n].y }; return o; };

// Jag räknar ut avståndet mellan axlarna med Pythagoras sats.
// Axelbredden används som en måttstock så att avvikelsernas storlek kan anpassas efter personens kropp.
// Jag sätter också en minsta bredd på 40 pixlar för att undvika alltför små värden.
const shoulderW = J => Math.max(40, Math.hypot(J.left_shoulder.x - J.right_shoulder.x, J.left_shoulder.y - J.right_shoulder.y));

// Slumpar en nyckel ur w (värden = vikter), null om inget kan väljas
function pick(w) {
  // Jag summerar först alla vikter i objektet.
  // Vikterna avgör hur stor sannolikhet varje alternativ har att väljas.
  let s = 0;
  for (const k in w) s += w[k];

  // Jag skapar ett slumpvärde inom den sammanlagda vikten.
  let r = Math.random() * s;

  // Jag går igenom alternativen och drar bort deras vikter tills slumpvärdet når noll.
  // Det alternativ där detta sker blir det som väljs.
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }

  // Om inget alternativ kan väljas returnerar jag null.
  return null;
}

class ShadowBehavior {
  // Jag samlar logiken för skuggans avvikande rörelser i den här klassen.
  // Klassen tar emot personens pose och räknar fram en ny pose som skuggan ska använda.

  constructor() {
    // När jag skapar ett nytt objekt återställer jag alla variabler till sina grundvärden.
    this.reset();
  }

  // events = pågående avvikelser | hist = poser senaste 2.5 s (för delay/lead) | calmUntil = inga nya avvikelser före detta
  // ghost = pågående loss-kopplad episod | nextGhostAt = tidigast nästa | nw = hur normal skuggan är i glimten (0..1)
  // blinkUntil = glimten pågår till | devS = utjämnad avvikelse per led

  reset() {
    // Jag nollställer alla tillstånd som hör till skuggans beteende.
    // events innehåller aktiva avvikelser och hist sparar tidigare poser.
    // calmUntil håller reda på när skuggan får börja skapa nya avvikelser igen.
    // ghost och nextGhostAt styr ghost-episoderna.
    // nw och blinkUntil styr glimtarna av normalitet.
    // devS sparar de utjämnade avvikelserna för varje led.
    this.events = [];
    this.hist = [];
    this.calmUntil = 0;
    this.ghost = null;
    this.nextGhostAt = 0;
    this.nw = 0;
    this.blinkUntil = 0;
    this.devS = {};
  }

  // Posen vid tiden t (eller närmast äldre)
  past(t) {
    // Jag går bakåt genom historiken för att hitta den senaste posen
    // som registrerades vid eller före den efterfrågade tiden.
    for (let i = this.hist.length - 1; i >= 0; i--)
      if (this.hist[i].t <= t) return this.hist[i].J;

    // Om det inte finns någon äldre pose använder jag den första sparade posen.
    return this.hist[0].J;
  }

  // J = riktig (spegelvänd) pose, dt = sek sedan förra bildrutan, now = tid, p = nivåns parametrar. Ut: manipulerad pose.
  apply(J, dt, now, p) {
    // Det här är huvudfunktionen som bearbetar personens pose.
    // J är den ursprungliga speglade posen, dt är tiden sedan förra bildrutan
    // och p innehåller inställningar för den aktuella nivån.

    // Jag sparar en kopia av den aktuella posen i historiken.
    // Det behövs för avvikelser som delay och lead, där jag jämför med tidigare rörelser.
    this.hist.push({ t: now, J: clonePose(J) });

    // Jag tar bort gamla poser så att historiken bara innehåller ungefär de senaste 2,5 sekunderna.
    while (this.hist.length > 1 && now - this.hist[0].t > 2.5) this.hist.shift();

    // Jag kontrollerar om någon ny avvikelse ska startas eller om skuggan ska få en lugn period.
    this.schedule(dt, now, p);

    // Jag börjar med att kopiera originalposen.
    // Alla förändringar görs sedan på kopian, inte direkt på den ursprungliga posen.
    const out = clonePose(J), S = shoulderW(J);

    // Jag sorterar avvikelserna så att överkroppen behandlas först.
    // På så sätt kan armar och huvud justeras ovanpå den redan förändrade överkroppen.
    this.events.sort((a, b) => (b.part === 'upper') - (a.part === 'upper'));

    // Jag går igenom alla aktiva avvikelser och tar bort dem som har klingat av.
    this.events = this.events.filter(e => {
      // age är hur länge avvikelsen har varit aktiv.
      // ra är hur länge den har varit i sin avtoningsfas.
      // releaseAt kan användas för att börja avtoningen tidigare än planerat.
      const age = now - e.t0, ra = now - (e.releaseAt ?? e.t0 + e.attack + e.hold);

      // Om avtoningstiden har passerat tar jag bort avvikelsen.
      if (ra > e.release) return false;

      // Jag räknar ut hur stark avvikelsen ska vara just nu.
      // Först växer den under attack, sedan ligger den kvar under hold
      // och till sist minskar den under release.
      this.applyEvent(e, out, sstep(age / e.attack) * (ra > 0 ? 1 - sstep(ra / e.release) : 1), age, S, now);

      // Jag behåller avvikelsen så länge den inte har klingat av helt.
      return true;
    });

    // Mjukar bara AVVIKELSEN (inte speglingen), tidskonstant 0.12 s
    // Jag applicerar även ghost-beteendet och får tillbaka en pose som kan innehålla den frikopplade skuggan.
    const raw = this.applyGhost(out, J, dt, now, p);

    // Jag räknar ut en utjämningsfaktor utifrån tiden mellan bildrutorna.
    // Det gör att förändringen inte blir ryckig om bildfrekvensen varierar.
    const a = 1 - Math.exp(-dt / 0.12), res = {};

    // Jag går igenom varje led och jämnar ut själva avvikelsen från originalposen.
    // Jag sparar den utjämnade avvikelsen i devS och lägger sedan tillbaka den på originalpositionen.
    // På så sätt påverkas inte själva speglingen av utjämningen.
    for (const n in raw) {
      const s = this.devS[n] || (this.devS[n] = { x: 0, y: 0 });
      s.x += (raw[n].x - J[n].x - s.x) * a;
      s.y += (raw[n].y - J[n].y - s.y) * a;
      res[n] = { x: J[n].x + s.x, y: J[n].y + s.y };
    }

    // Till sist kontrollerar jag om en glimt av normalitet ska påverka resultatet.
    return this.applyBlink(res, J, dt, now, p);
  }

  // NIVÅ 5: skuggan kopplar loss, går iväg och gör egna rörelser, och kopplar sedan mjukt tillbaka
  applyGhost(out, J, dt, now, p) {
    // Här hanterar jag ghost-läget, där hela skuggan börjar röra sig självständigt.
    let g = this.ghost;

    // Ny episod: ingen pågår, väntan slut, ingen glimt, slump (ghostRate per sekund)
    // Jag startar en ny ghost-episod om ingen redan pågår, väntetiden har passerat
    // och ingen glimt av normalitet är aktiv.
    // ghostRate avgör sannolikheten att en episod startar per sekund.
    if (!g && now >= this.nextGhostAt && now >= this.blinkUntil && Math.random() < p.ghostRate * dt) {

      // Jag sparar de värden som behövs för att styra skuggans fristående rörelse.
      // dur = hur länge episoden pågår.
      // sgn = vilken sida som motsvarar personens vänstra sida.
      // S = axelbredden som används som skalmått.
      // start = skuggans ursprungliga höftposition.
      // dirG = riktningen skuggan ska glida åt.
      // D = hur långt skuggan ska förflyttas.
      // ph = en slumpad fas som ger variation i rörelsen.
      // mode och prev håller reda på aktuellt och tidigare rörelsemönster.
      // nextSwitch bestämmer när rörelsemönstret ska bytas.
      g = this.ghost = {
        t0: now,
        dur: rnd(p.ghostMin, p.ghostMax),
        sgn: J.left_shoulder.x < J.right_shoulder.x ? -1 : 1,
        S: shoulderW(J),
        start: { x: J.hipMid.x, y: J.hipMid.y },
        dirG: J.hipMid.x > width / 2 ? -1 : 1,
        D: rnd(0.25, 0.4) * width,
        ph: rnd(0, 6.28),
        prev: null,
        mode: pick(GHOST_MODES),
        modeAt: now,
        nextSwitch: now + rnd(3, 5)
      };
    }

    // Om ingen ghost-episod är aktiv behåller jag den vanliga posen.
    if (!g) return out;

    // Jag räknar ut hur länge episoden har pågått och hur länge den har varit i sin avtoning.
    const age = now - g.t0, ra = age - g.dur;

    // När två sekunders avtoning har passerat avslutar jag episoden.
    // Sedan får det gå mellan 1,5 och 3 sekunder innan en ny episod kan starta.
    if (ra > 2) {
      this.ghost = null;
      this.nextGhostAt = now + rnd(1.5, 3);
      return out;
    }

    // Jag räknar ut hur frikopplad skuggan ska vara.
    // Den kopplar loss under 0,8 sekunder och går tillbaka under två sekunder.
    const w = sstep(age / 0.8) * (ra > 0 ? 1 - sstep(ra / 2) : 1);

    // Jag byter rörelsemönster med några sekunders mellanrum.
    // Det nya mönstret blandas in gradvis i stället för att bytas direkt.
    if (now >= g.nextSwitch) {
      g.prev = g.mode;
      g.mode = pick(GHOST_MODES);
      g.modeAt = now;
      g.nextSwitch = now + rnd(3, 5);
    }

    // mb styr blandningen mellan det gamla och det nya rörelsemönstret.
    // A är den nya posen och B är den tidigare posen, om en sådan finns.
    const mb = g.prev ? sstep((now - g.modeAt) / 1.2) : 1,
          A = ghostRig(g.mode, age, g.sgn),
          B = g.prev ? ghostRig(g.prev, age, g.sgn) : A;

    // Djup: skuggan går inåt mot bakväggen – blir mindre (0.3) och fötterna flyttas uppåt (0.12 av skärmhöjden)
    // Jag simulerar att skuggan rör sig bort från betraktaren genom att göra den mindre.
    // Samtidigt flyttar jag fötterna uppåt på skärmen.
    const dep = sstep(age / 6),
          SS = g.S * (1 - 0.3 * dep),
          feet = g.start.y + 2.2 * g.S - dep * 0.12 * height;

    // ax och ay är skuggans nya höftposition.
    // Jag låter skuggan glida åt sidan under sex sekunder och lägger till ett litet svaj.
    // Math.min och Math.max håller positionen inom skärmens gränser.
    const ax = Math.min(width - SS, Math.max(SS, g.start.x + g.dirG * g.D * sstep(age / 6) + Math.sin(age * 0.4 + g.ph) * 0.04 * width)),
          ay = feet - 2.2 * SS + Math.sin(age * 1.3) * 0.01 * height;

    // Jag går igenom alla leder i ghost-posen.
    // För varje led blandar jag personens nuvarande position med ghost-positionen.
    for (const n in A) {
      const rx = B[n].x + (A[n].x - B[n].x) * mb,
            ry = B[n].y + (A[n].y - B[n].y) * mb,
            o = out[n];

      // Jag flyttar gradvis varje led från personens position till den fristående skuggans position.
      out[n] = {
        x: o.x + (ax + rx * SS - o.x) * w,
        y: o.y + (ay + ry * SS - o.y) * w
      };
    }

    return out;
  }

  // GLIMT AV NORMALITET: mitt i en avvikelse snappar skuggan kort tillbaka till perfekt spegling
  applyBlink(res, J, dt, now, p) {
    // Jag kan starta en glimt om ingen annan glimt pågår, normalitetsvärdet är noll
    // och det finns en aktiv avvikelse eller ghost-episod.
    // blinkChance avgör sannolikheten att glimten ska starta.
    if (now >= this.blinkUntil && this.nw <= 0 && (this.events.length > 0 || this.ghost) && Math.random() < p.blinkChance * dt) {
      this.blinkUntil = now + rnd(p.blinkMin, p.blinkMax);

      // Jag stoppar nya avvikelser från att starta medan glimten pågår.
      this.calmUntil = Math.max(this.calmUntil, this.blinkUntil);
    }

    // nw rör sig mot 1 när glimten är aktiv och mot 0 när den är över.
    // Jag använder olika hastigheter för att tona in och ut glimten.
    // CONFIG innehåller inställningarna för dessa övergångar.
    this.nw = Math.min(1, Math.max(0, this.nw + (now < this.blinkUntil ? dt / (CONFIG.blinkIn || 0.35) : -dt / (CONFIG.blinkOut || 0.7))));

    // Jag använder smoothstep för att göra övergången mjuk.
    // Om värdet är noll behöver jag inte förändra posen.
    const k = sstep(this.nw);
    if (k <= 0) return res;

    // Jag skapar ett nytt pose-objekt där varje led flyttas från den avvikande positionen
    // tillbaka mot den ursprungliga speglade positionen.
    const o = {};
    for (const n in res)
      o[n] = {
        x: res[n].x + (J[n].x - res[n].x) * k,
        y: res[n].y + (J[n].y - res[n].y) * k
      };

    return o;
  }

  // Slumpar nya avvikelser och ibland "lugn"-perioder (parametrar p från nivån)
  schedule(dt, now, p) {
    // Om vi fortfarande befinner oss i en lugn period startar jag inga nya avvikelser.
    if (now < this.calmUntil) return;

    // Ibland (calmChance/s) släpps alla avvikelser snabbt = tillfälligt normal spegling
    // Jag kan slumpmässigt starta en lugn period där alla aktiva avvikelser börjar klinga av.
    if (this.events.length && Math.random() < p.calmChance * dt) {
      this.calmUntil = now + rnd(p.calmMin, p.calmMax);

      // Jag sätter releaseAt till nu så att avvikelserna börjar släppas direkt.
      // Jag begränsar också deras återstående avtoning till ett slumpat värde mellan 0,8 och 1,5 sekunder.
      this.events.forEach(e => {
        if (e.releaseAt == null || e.releaseAt > now) e.releaseAt = now;
        e.release = Math.min(e.release, rnd(0.8, 1.5));
      });
      return;
    }

    // Ny avvikelse om maxantalet inte nåtts och slumpen (rate/s) säger ja
    // Jag kontrollerar om det finns plats för en ny avvikelse och om slumpen säger att en ska starta.
    if (this.events.length < Math.round(p.maxParts) && Math.random() < p.rate * dt) {

      // Kroppsdel som inte redan är påverkad, viktad efter partW (vikter <= 0.01 räknas bort)
      // Jag skapar en lista över kroppsdelar som inte redan har en aktiv avvikelse.
      // partW bestämmer sannolikheten för varje kroppsdel.
      const used = new Set(this.events.map(e => e.part)), pw = {};

      for (const k in p.partW)
        if (!used.has(k) && p.partW[k] > 0.01) pw[k] = p.partW[k];

      // Jag väljer först en kroppsdel och sedan vilken typ av avvikelse den ska få.
      // Om något av alternativen saknas avbryter jag funktionen.
      const part = pick(pw), kind = pick(p.kinds);
      if (!part || !kind) return;

      // amp = styrka | t0 = start | attack/hold/release = tid in/kvar/ut | releaseAt = satt om den avbryts | dir = riktning (offset)
      // sign = rotationsriktning | freq/phase = vågrörelse | ref = sparade lägen (reverse/freeze) | tgt = slump för var 'own' pekar
      // Här skapar jag själva avvikelsen och sparar alla värden som behövs för att styra den.
      this.events.push({
        part,
        kind,
        amp: p.intensity * rnd(0.6, 1),
        t0: now,
        attack: rnd(0.9, 2.2),
        hold: rnd(p.durMin, p.durMax),
        release: rnd(1, 2.2),
        releaseAt: null,
        dir: rnd(0, 6.28),
        sign: Math.random() < 0.5 ? -1 : 1,
        freq: rnd(0.4, 1.1),
        phase: rnd(0, 6.28),
        ref: {},
        tgt: Math.random()
      });
    }
  }

  // 'own': arm/ben får egen rörelse (egen vinkel + våg), oberoende av personens led
  applyOwn(e, out, w, age) {
    // Jag hämtar information om den kroppsdel som ska röra sig självständigt.
    const P = PARTS[e.part],
          pv = out[P.pivot],
          j1 = P.joints[0],
          j2 = P.joints[1],
          c1 = out[j1],
          c2 = out[j2],

          // Jag räknar ut längden på de två segmenten, till exempel överarm och underarm.
          // Genom att behålla längderna kan jag ändra vinklarna utan att ändra kroppsdelens ungefärliga storlek.
          l1 = Math.hypot(c1.x - pv.x, c1.y - pv.y),
          l2 = Math.hypot(c2.x - c1.x, c2.y - c1.y),

          // Jag kontrollerar om det är en arm, eftersom armar och ben får olika grundvinklar.
          arm = e.part.endsWith('Arm'),

          // Jag bestämmer åt vilket håll kroppsdelen pekar utifrån vilken sida av höften den befinner sig på.
          sd = pv.x >= out.hipMid.x ? 1 : -1,

          // Jag skapar en sinusbaserad svängning så att rörelsen inte blir helt statisk.
          sw = Math.sin(age * e.freq * 2 + e.phase),

          // Jag räknar fram en grundvinkel.
          // Armar får ett större vinkelområde än ben.
          base = (arm ? 1.2 + e.tgt * 1.7 : 0.3 + e.tgt * 0.7) * (0.4 + 0.6 * e.amp),

          // Jag räknar ut vinkeln för det första och andra segmentet.
          a1 = base * (0.88 + 0.12 * sw),
          a2 = a1 + (arm ? 0.7 : 0.3) * Math.sin(age * e.freq * 3 + e.phase + 1),

          // Jag räknar ut den nya positionen för armbågen eller knät och sedan handleden eller fotleden.
          el = { x: pv.x + sd * Math.sin(a1) * l1, y: pv.y + Math.cos(a1) * l1 },
          wr = { x: el.x + sd * Math.sin(a2) * l2, y: el.y + Math.cos(a2) * l2 };

    // Jag blandar den nuvarande positionen med den nya positionen.
    // w styr hur starkt den egna rörelsen ska påverka kroppsdelen.
    out[j1] = { x: c1.x + (el.x - c1.x) * w, y: c1.y + (el.y - c1.y) * w };
    out[j2] = { x: c2.x + (wr.x - c2.x) * w, y: c2.y + (wr.y - c2.y) * w };
  }

  // Tillämpar avvikelsen e på out med styrkan w (0..1)
  applyEvent(e, out, w, age, S, now) {
    // Jag kontrollerar vilken typ av avvikelse som ska användas.
    // own fungerar bara för armar och ben. Om det används på en annan kroppsdel
    // ändrar jag typen till rotate i stället.
    const kind = e.kind === 'own' && !/Arm|Leg/.test(e.part) ? 'rotate' : e.kind;

    // Om avvikelsen är own skickar jag vidare till funktionen som skapar egna arm- eller benrörelser.
    if (kind === 'own') return this.applyOwn(e, out, w, age);

    // Jag hämtar kroppsdelens pivotpunkt och räknar ut en sinusvåg som kan användas i rörelsen.
    const P = PARTS[e.part], pv = out[P.pivot], sw = Math.sin(age * e.freq * 2 + e.phase);

    // Jag går igenom alla leder som hör till den aktuella kroppsdelen.
    for (const n of P.joints) {
      const cur = out[n],
            rc = { x: cur.x - pv.x, y: cur.y - pv.y };

      // rc är ledens position relativt pivotpunkten.
      // rt är den position jag vill att leden ska röra sig mot.
      let rt = rc;

      // offset: förskjut åt slumpad riktning, pulserande (skalar med S)
      // Jag flyttar leden i en slumpad riktning.
      // Förskjutningen varierar lite över tid och anpassas efter axelbredden.
      if (kind === 'offset') {
        const m = e.amp * 0.8 * S * (0.7 + 0.3 * sw);
        rt = { x: rc.x + Math.cos(e.dir) * m, y: rc.y + Math.sin(e.dir) * m };
      }

      // rotate: kring pivot med svajande vinkel (huvud 0.45 gånger)
      // Jag roterar ledens position runt pivotpunkten.
      // Huvudet får en mindre rotation än övriga kroppsdelar.
      else if (kind === 'rotate')
        rt = rot(rc, e.sign * e.amp * 1.9 * (e.part === 'head' ? 0.45 : 1) * (0.6 + 0.4 * sw));

      // reverse: spegla rörelsen kring startläget (ref)
      // Jag sparar ledens ursprungliga relativa position första gången och låter sedan rörelsen gå åt motsatt håll.
      else if (kind === 'reverse') {
        const r = e.ref[n] || (e.ref[n] = rc);
        rt = { x: 2 * r.x - rc.x, y: 2 * r.y - rc.y };
      }

      // freeze: leden stannar där den var vid start
      // Jag sparar ledens position när avvikelsen börjar och använder den positionen under hela effekten.
      else if (kind === 'freeze')
        rt = e.ref[n] || (e.ref[n] = rc);

      // delay = var du VAR för en stund sedan (0.3–1.5 s) | lead = förlänger rörelsen (nu vs 0.15 s sen) med faktor k = förutsäger
      // Här använder jag den sparade historiken för att skapa fördröjda eller förstärkta rörelser.
      else if (kind === 'delay' || kind === 'lead') {

        // Vid delay hämtar jag en äldre pose. Fördröjningen ökar med avvikelsens styrka.
        // Vid lead använder jag i stället en pose från 0,15 sekunder tidigare.
        const Jp = this.past(now - (kind === 'delay' ? 0.3 + 1.2 * e.amp : 0.15)),
              pp = Jp[P.pivot],
              rp = { x: Jp[n].x - pp.x, y: Jp[n].y - pp.y };

        // delay använder den äldre positionen direkt.
        // lead förstärker skillnaden mellan den aktuella och den tidigare positionen,
        // så att rörelsen fortsätter längre i samma riktning.
        if (kind === 'delay') rt = rp;
        else {
          const k = 2 + e.amp * 4;
          rt = { x: rc.x + (rc.x - rp.x) * k, y: rc.y + (rc.y - rp.y) * k };
        }
      }

      // Jag blandar den nuvarande positionen med målpositionen.
      // w avgör hur stor del av avvikelsen som ska synas.
      out[n] = {
        x: pv.x + rc.x + (rt.x - rc.x) * w,
        y: pv.y + rc.y + (rt.y - rc.y) * w
      };
    }
  }
}

// Ghostens rörelsemönster (koordinater relativt höften, i axelbredder, y neråt). Värden = vikter för pick(): lika sannolika.
// Jag definierar fyra möjliga rörelsemönster för ghost-skuggan.
// Alla koordinater räknas relativt höften och anges i förhållande till axelbredden.
// Vikterna gör att alla fyra mönster har samma sannolikhet att väljas.
const GHOST_MODES = { wave: 1, dance: 1, march: 1, reach: 1 };

// Bygger en hel pose för mönstret m vid tiden t. sgn = +1/-1 beroende på om personens vänstra sida är åt höger/vänster.
function ghostRig(m, t, sgn) {
  // Den här funktionen bygger en komplett kroppsposition för ghost-skuggan.
  // m anger rörelsemönstret, t hur länge rörelsen har pågått och sgn vilken sida som är vänster.
  const s = Math.sin, P = Math.PI;

  // Vinklar i rad (0 = hänger rakt ner, PI = rakt upp). lean = överkroppens lutning, head = extra huvudlutning, bob = studs uppåt
  // la/ra = [överarm, underarm] vänster/höger | ll/rl = [lår, underben] vänster/höger
  // Jag börjar med grundvärden för kroppens lutning, huvudets vinkel och benens och armarnas vinklar.
  // Vinklarna anges i radianer.
  let lean = 0, head = 0, bob = 0,
      la = [0.15, 0.1],
      ra = [0.15, 0.1],
      ll = [0.1, 0.1],
      rl = [0.1, 0.1];

  // wave: höger arm högt upp och vinkar snabbt
  // I wave-mönstret lyfter jag ena armen och låter den röra sig fram och tillbaka.
  // Huvudet och överkroppen får också små rörelser.
  if (m === 'wave') {
    ra = [2.5 + 0.25 * s(t * 5), 2.9 + 0.7 * s(t * 7)];
    head = 0.25 * s(t * 0.9);
    lean = 0.08 * s(t * 0.7);
  }

  // dance: armar i motfas (c och -c), benen studsar, kroppen lutar och studsar
  // I dance-mönstret rör jag armarna åt motsatta håll och låter benen och kroppen studsa.
  else if (m === 'dance') {
    const c = s(t * 2.6);
    la = [1.3 + 0.9 * c, 1.3 + 0.9 * c + 0.5 * s(t * 5)];
    ra = [1.3 - 0.9 * c, 1.3 - 0.9 * c + 0.5 * s(t * 5 + 1)];
    ll = [0.25 + 0.2 * s(t * 5.2), 0.1];
    rl = [0.25 + 0.2 * s(t * 5.2 + P), 0.1];
    lean = 0.3 * s(t * 1.3);
    bob = 0.06 * Math.abs(c);
    head = 0.3 * s(t * 1.3 + 1);
  }

  // march: benen lyfts växelvis (max(0,..) = bara när sinus > 0), armarna i motfas
  // I march-mönstret lyfter jag benen växelvis så att skuggan ser ut att marschera.
  // Armarna rör sig i motsatt takt till varandra.
  else if (m === 'march') {
    const a = s(t * 3.4), b = s(t * 3.4 + P),
          pa = Math.max(0, a), pb = Math.max(0, b);

    la = [0.5 + 0.4 * a, 0.5 + 0.4 * a];
    ra = [0.5 + 0.4 * b, 0.5 + 0.4 * b];
    ll = [0.1 + 0.7 * pa, 0.1 - 0.5 * pa];
    rl = [0.1 + 0.7 * pb, 0.1 - 0.5 * pb];
    bob = 0.04 * Math.abs(a);
    lean = 0.1 * a;
  }

  // reach: båda armarna sträcks långsamt uppåt
  // I reach-mönstret sträcker jag båda armarna uppåt med lite olika timing.
  // Kroppen och huvudet får mindre rörelser samtidigt.
  else {
    la = [2.4 + 0.3 * s(t * 0.9), 2.7 + 0.4 * s(t * 1.3)];
    ra = [2.4 + 0.3 * s(t * 0.9 + 1.5), 2.7 + 0.4 * s(t * 1.3 + 1.5)];
    ll = [0.35, 0.3];
    rl = [0.35, 0.3];
    head = 0.15 * s(t);
    lean = 0.1 * s(t * 0.5);
  }

  // rt = rotera (x,y) med a | add = addera punkter | v = vektor med längd l, vinkel a, sida sd
  // Jag skapar tre små hjälpfunktioner för att bygga kroppens koordinater.
  // rt roterar en punkt, add lägger ihop två punkter och v skapar en vektor med en viss längd och vinkel.
  const rt = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const v = (a, l, sd) => ({ x: sd * Math.sin(a) * l, y: Math.cos(a) * l });

  // Jag skapar först höftens mittpunkt och halsens position.
  // Höften är origo, alltså koordinaten (0, 0), och halsen placeras ovanför den.
  // Överkroppens lutning påverkar halsens position.
  const R = { hipMid: { x: 0, y: 0 }, neck: rt(0, -1.3, lean) };

  // Jag går igenom vänster och höger sida av kroppen.
  // För varje sida räknar jag ut axel, armbåge, handled, höft, knä och fotled.
  // sd anger åt vilket håll sidan ligger och ar respektive lg innehåller armens och benets vinklar.
  for (const [k, sd, ar, lg] of [['left', sgn, la, ll], ['right', -sgn, ra, rl]]) {

    // Jag placerar axeln i förhållande till halsen och överkroppens lutning.
    // Sedan räknar jag ut armbågen och handleden med hjälp av vinklar och segmentlängder.
    const sh = add(R.neck, rt(sd * 0.5, 0, lean)),
          el = add(sh, v(ar[0], 0.85, sd)),
          hp = { x: sd * 0.3, y: 0 },
          kn = add(hp, v(lg[0], 1.1, sd));

    // Jag sparar lederna i objektet R så att de kan användas när hela posen byggs klart.
    R[k + '_shoulder'] = sh;
    R[k + '_elbow'] = el;
    R[k + '_wrist'] = add(el, v(ar[1], 0.8, sd));
    R[k + '_hip'] = hp;
    R[k + '_knee'] = kn;
    R[k + '_ankle'] = add(kn, v(lg[1], 1.1, sd));
  }

  // Jag räknar ut huvudets mittpunkt utifrån halsens position.
  // Därefter placerar jag öron, ögon och näsa runt huvudets mittpunkt.
  const hc = add(R.neck, rt(0, -0.6, lean + head)),
        ha = lean + head;

  R.left_ear = add(hc, rt(sgn * 0.25, 0, ha));
  R.right_ear = add(hc, rt(-sgn * 0.25, 0, ha));
  R.left_eye = add(hc, rt(sgn * 0.12, -0.02, ha));
  R.right_eye = add(hc, rt(-sgn * 0.12, -0.02, ha));
  R.nose = add(hc, rt(0, 0.12, ha));

  // Jag flyttar alla punkter uppåt med bob-värdet.
  // Det används för att skapa en studsande rörelse i hela kroppen.
  for (const n in R) R[n] = { x: R[n].x, y: R[n].y - bob };

  // Till sist returnerar jag hela den beräknade posen.
  // Den innehåller koordinater för skuggans virtuella kropp och används av applyGhost().
  return R;
}