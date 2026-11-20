// audio.js – procedurell musik/ljud (Web Audio, inga ljudfiler, inget nätverk)
// Här skapar jag musik och ljudeffekter med kod i stället för att spela upp färdiga ljudfiler.
// Mystisk rave i D-frygisk: mörk drone + pulserande beat som blir tätare, snabbare och mer förvrängd för varje nivå.
// Jag använder en mörk, ihållande ljudmatta som grund och bygger på med fler rytmer och effekter när nivån ökar.
//  - Skuggans avvikelse (dev) styr ett eget "skuggröst"-lager + viskning, panorerad dit skuggan är
// Jag använder avvikelsen för att påverka ett separat ljudlager som dessutom kan placeras åt höger eller vänster i ljudbilden.
//  - Glimt av normalitet = musiken blir dov och tyst en kort stund | Ghost = mer eko och dovare ljud
// Här låter jag spelets olika tillstånd påverka hur musiken låter, så att ljudet förstärker det som händer.
//  - Före nivåbyte byggs en riser, vid bytet kommer en impact | Ljuset (environment.js) läser kickEnv() så allt är i takt
// Jag använder en stigande ljudeffekt före nivåbytet och en kraftigare ljudstöt när bytet sker.
// Funktionen kickEnv() gör det möjligt för en annan del av spelet att läsa av rytmen och synkronisera ljuset.
// Ljudet styrs av upplevelsen, inte av tangenter: tyst utan spelare, drönaren fadear in när nivå 1 börjar, varje nivå lägger till lager (se playStep).
// Det betyder att ljudet anpassas efter spelets tillstånd i stället för att styras direkt av tangenttryckningar.
// OBS: webbläsare spärrar ljud tills sidan fått en användaråtgärd. Vi försöker starta automatiskt (och om var 0,5 s) så det släpps så fort det tillåts.
// Jag tar hänsyn till webbläsarens ljudbegränsningar genom att försöka starta ljudet igen när det blir tillåtet.

const A_ROOT = 73.42;                      // D2
// Jag använder detta som grundfrekvens för musiken. Värdet motsvarar tonen D2 i hertz.
const A_CHORD = [1, 1.0595, 1, 0.8909];    // D, Eb, D, C (byts var 4:e takt)
// Dessa värden multipliceras med grundfrekvensen för att skapa olika grundtoner.
// Jag byter mellan dem med jämna mellanrum för att få en harmonisk variation.
const A_SEMI = [0, 1, 3, 5, 7, 8, 10, 12]; // D-frygisk
// Här anger jag tonsteg i halvtoner som används när melodier och arpeggion skapas.
// Genom att använda samma tonförråd får musiken en sammanhängande karaktär.
const A_LVL = [   // per nivå: 1 drone | 2 hjärtslag | 3 beat+clap | 4 bas+arp | 5 allt+distortion
  // Jag samlar ljudinställningarna för varje nivå i en array.
  // När nivån ökar höjer jag bland annat tempot och lägger till fler ljudlager.
  { bpm: 100, hat: 0,    arp: 0,    tick: 0,    dist: 0,    glitch: 0,    pad: 0.12 },
  { bpm: 108, hat: 0.1,  arp: 0,    tick: 0.25, dist: 0,    glitch: 0,    pad: 0.13 },
  { bpm: 116, hat: 0.5,  arp: 0.12, tick: 0.3,  dist: 0.05, glitch: 0,    pad: 0.14 },
  { bpm: 124, hat: 0.8,  arp: 0.42, tick: 0.35, dist: 0.15, glitch: 0.25, pad: 0.15 },
  { bpm: 134, hat: 1,    arp: 0.72, tick: 0.4,  dist: 0.38, glitch: 0.7,  pad: 0.17 }
];

class ShadowAudio {
  // Jag samlar ljudsystemets funktioner och tillstånd i klassen ShadowAudio.
  // På så sätt kan andra delar av spelet använda samma ljudsystem utan att behöva skapa ljudnoder själva.

  constructor(cfg) {
    // Här skapar jag objektets grundinställningar.
    // Jag sätter standardvärden för ljudet och låter eventuella inställningar i cfg.audio skriva över dem.
    this.cfg = { enabled: true, volume: 0.06, ...cfg.audio };

    // Här sparar jag ljudkontexten och olika variabler som behövs medan ljudet spelas.
    // ctx håller själva Web Audio-systemet, level håller aktuell nivå och kicks sparar tidpunkterna för kickljud.
    this.ctx = null; this.level = -2; this.kicks = []; this.mute = false;

    // Jag samlar information om spelets aktuella ljudtillstånd i ett objekt.
    // Det innehåller bland annat normalitet, ghost-läge, skuggans avvikelse och panorering.
    this.st = { normal: 0, ghost: false, dev: 0, pan: 0 };

    // Dessa variabler styr musikens timing och utveckling.
    // bpm är tempot, step är aktuellt sekvenssteg och nextT är tidpunkten för nästa ljudhändelse.
    // duck används för att tillfälligt sänka ljudstyrkan och root håller aktuell grundton.
    this.bpm = 96; this.step = 0; this.nextT = 0; this.duck = 1; this.root = A_ROOT; this.lastU = 0; this.risedLevel = -9;

    // Jag skapar ett mönster med 16 möjliga melodisteg.
    // Math.random gör att vissa steg får en ton medan andra blir tysta, vilket skapar variation.
    this.motif = Array.from({ length: 16 }, () => Math.random() < 0.55 ? Math.floor(Math.random() * A_SEMI.length) : -1);

    this.lt = 0; // sekunder in i nuvarande nivå (mjuka inträden)
    // lt håller reda på hur länge spelaren har varit på nivån. Det används för att tona in nya ljudlager gradvis.

    // Jag lyssnar efter ett musklick eller annat pekartryck.
    // Det fungerar som en reserv om webbläsaren inte tillåter ljudstart automatiskt.
    window.addEventListener('pointerdown', () => this.start());
  }

  // Den här gettern kontrollerar om ljudkontexten finns och faktiskt spelar.
  // Jag får true endast när ljudkontexten har tillståndet running.
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  start() {
    // Om ljudet är avstängt i inställningarna behöver jag inte starta något.
    if (!this.cfg.enabled) return;

    // Om ljudkontexten redan finns skapar jag inte en ny.
    // Om den däremot är pausad försöker jag återuppta den.
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }

    // Jag hämtar webbläsarens AudioContext.
    // webkitAudioContext finns som alternativ för webbläsare som använder den äldre benämningen.
    const AC = window.AudioContext || window.webkitAudioContext;

    // Om webbläsaren saknar stöd för Web Audio avslutar jag funktionen.
    if (!AC) return;

    // Jag skapar ljudkontexten och bygger upp hela ljudsystemet.
    // Om något går fel fångar jag felet och skriver ett meddelande i konsolen.
    try { this.build(new AC()); } catch (e) { console.warn('Ljud kunde inte startas', e); }
  }

  // Den här funktionen växlar mellan ljud på och ljud av.
  // Jag ändrar bara mute-värdet här. Ljudnivån används sedan i update().
  toggleMute() { this.mute = !this.mute; }

  // ---------- Små hjälpfunktioner för att skapa ljudnoder ----------

  // Jag har gjort små hjälpfunktioner för att slippa upprepa samma kod när jag skapar ljudnoder.
  // Gain styr ljudstyrkan, filter förändrar ljudets frekvenser och oscillatorer skapar toner.
  // Brusläsaren använder den brusbuffert som jag skapar senare i build().

  _g(v) {
    // Jag skapar en GainNode som används för att justera ljudstyrkan.
    const g = this.ctx.createGain();

    // Om jag har fått ett värde sätter jag det som startvolym.
    if (v != null) g.gain.value = v;

    return g;
  }

  _f(type, f, q) {
    // Jag skapar ett filter som kan släppa igenom eller dämpa olika frekvenser.
    const n = this.ctx.createBiquadFilter();

    // Jag anger filtertypen, till exempel lowpass eller highpass.
    n.type = type;

    // Om en frekvens har skickats in använder jag den som filtrets startfrekvens.
    if (f != null) n.frequency.value = f;

    // Q styr filtrets resonans eller hur tydlig toppen kring brytfrekvensen blir.
    if (q != null) n.Q.value = q;

    return n;
  }

  _o(type, f) {
    // Jag skapar en oscillator som genererar en ljudvåg.
    const o = this.ctx.createOscillator();

    // Jag anger vågform och frekvens om ett frekvensvärde finns.
    if (f != null) o.frequency.value = f;

    return o;
  }

  _nz() {
    // Jag skapar en ljudkälla som använder den brusbuffert jag har sparat i this.noise.
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    return n;
  }

  // ---------- Ljudgraf ----------

  build(c) {
    // Här bygger jag upp själva ljudgrafen.
    // En ljudgraf består av noder som kopplas ihop och skickar ljud vidare genom olika effekter.
    this.ctx = c;

    // Jag skapar huvudvolymen, en kompressor och ett lågpassfilter.
    // Ljudet går genom filtret, sedan kompressorn och därefter huvudvolymen innan det når högtalarna.
    const master = this.master = this._g(0), comp = c.createDynamicsCompressor(), lp = this.lp = this._f('lowpass', 16000, 0.7);

    // Jag ställer in kompressorn så att den jämnar ut stora skillnader i ljudstyrka.
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;

    // Här kopplar jag ihop huvudkedjan för ljudet.
    lp.connect(comp);
    comp.connect(master);
    master.connect(c.destination);

    // Brus + reverb (genererad impulsrespons)
    // Jag skapar en två sekunder lång buffert med slumpmässigt brus.
    // Den kan användas som ljudkälla för exempelvis viskningar, hi-hats och andra brusbaserade effekter.
    const nb = this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Jag skapar också en impulsrespons på tre sekunder för att bygga ett eget reverb.
    // En impulsrespons beskriver hur ett ljud klingar av i ett rum.
    const len = c.sampleRate * 3, ir = c.createBuffer(2, len, c.sampleRate), rev = c.createConvolver();

    // Jag fyller båda ljudkanalerna med slumpmässigt brus som gradvis blir svagare.
    // Det gör att reverbet får en avklingande svans i stället för att fortsätta med samma styrka.
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }

    // Jag kopplar impulsresponsen till ConvolverNode, som skapar reverbeffekten.
    rev.buffer = ir;
    this.revIn = this._g();
    this.revOut = this._g(0.6);
    this.revIn.connect(rev);
    rev.connect(this.revOut);
    this.revOut.connect(lp);

    // Eko (punkterad åttondel)
    // Här bygger jag en fördröjningskedja som skickar tillbaka en del av ljudet till sig själv.
    // Det skapar upprepade ekon som gradvis klingar av.
    const dly = this.dly = c.createDelay(2), fb = this._g(0.42), df = this._f('lowpass', 2800);
    this.dlyIn = this._g();
    this.dlyIn.connect(dly);
    dly.connect(df);
    df.connect(fb);
    fb.connect(dly);
    df.connect(lp);

    // Förvrängning (parallell), växer med nivån
    // Jag skapar en WaveShaperNode som förändrar ljudvågens form och därmed ger distortion.
    const ws = c.createWaveShaper(), curve = new Float32Array(1024);

    // Jag räknar fram en kurva med tanh för att forma ljudet och skapa en mjukare typ av klippning.
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 6);

    // Jag kopplar förvrängningen till egna in- och utgångar.
    // Genom att ändra distOut kan jag styra hur mycket av den förvrängda signalen som hörs.
    ws.curve = curve;
    this.distIn = this._g();
    this.distOut = this._g(0);
    this.distIn.connect(ws);
    ws.connect(this.distOut);
    this.distOut.connect(lp);

    // Bussar med sändningar: mk(bus-nivå, reverb, eko, distortion)
    // Jag skapar separata ljudbussar för olika typer av ljud.
    // Varje buss kan ha en egen grundvolym och skicka delar av ljudet till reverb, eko eller distortion.
    const mk = (g, rv, dl, ds) => {
      const b = this._g(g);
      b.connect(lp);

      // Den här inre funktionen kopplar en del av bussens ljud till en effekt.
      // Jag skapar bara en sådan koppling om effektens nivå är större än noll.
      const s = (to, a) => {
        if (a > 0) {
          const x = this._g(a);
          b.connect(x);
          x.connect(to);
        }
      };

      s(this.revIn, rv);
      s(this.dlyIn, dl);
      s(this.distIn, ds);
      return b;
    };

    // Här skapar jag bussarna för trummor, bas, ljudmatta, arpeggio och specialeffekter.
    // Det gör det möjligt att ge olika ljudtyper olika mängd effekter.
    this.bus = {
      drum: mk(0.9, 0.06, 0, 0.5),
      bass: mk(0.28, 0, 0, 0.5),
      pad: mk(0.17, 0.5, 0, 0),
      arp: mk(0.09, 0.35, 0.5, 0.4),
      fx: mk(1, 0.8, 0.2, 0)
    };

    // Panorering för skuggans egna röst
    // Jag skapar en separat ingång för skuggans röst så att jag kan placera ljudet i stereobilden.
    const panIn = this._g();
    this.pan = c.createStereoPanner ? c.createStereoPanner() : null;

    // Om webbläsaren stöder StereoPannerNode kopplar jag ljudet genom den.
    // Annars skickar jag ljudet direkt till effektbussen utan panorering.
    if (this.pan) {
      panIn.connect(this.pan);
      this.pan.connect(this.bus.fx);
    } else panIn.connect(this.bus.fx);

    // Oscillator som startar direkt: osc(typ, frekvens, detune, mål)
    // Jag använder den här hjälpfunktionen för oscillatorer som ska starta direkt och fortsätta spela.
    const osc = (t, f, d, to) => {
      const o = this._o(t, f);
      o.detune.value = d;
      o.connect(to);
      o.start();
      return o;
    };

    // Pad/drone (alltid på): detunade sågvågor genom långsamt svepande filter
    // Jag bygger en lång ljudmatta av flera oscillatorer med olika frekvenser och vågformer.
    const padF = this._f('lowpass', 700, 2);
    this.padG = this._g(0);
    padF.connect(this.padG);
    this.padG.connect(this.bus.pad);

    // Jag kombinerar flera oscillatorer och ändrar deras tonhöjd lite med detune.
    // Det skapar en bredare och mer levande klang än om jag bara använde en oscillator.
    this.padOsc = [[1, 'sawtooth', -6], [1.5, 'sawtooth', 5], [2, 'triangle', 0], [2.4, 'sawtooth', -10]].map(([r, t, d]) => [osc(t, A_ROOT * 2 * r, d, padF), r]);

    // Jag kopplar en långsam sinusoscillator till filtrets frekvens.
    // Det gör att ljudmattans filter rör sig långsamt och ger en svepande känsla.
    const lg = this._g(400);
    lg.connect(padF.frequency);
    osc('sine', 0.07, 0, lg);

    // Skuggans röst (två lätt ostämda toner som "skär" mot varandra) + viskning
    // Jag skapar ett eget ljudlager som kan förstärkas när skuggans avvikelse ökar.
    const vf = this._f('lowpass', 1800);
    this.voiceG = this._g(0);
    vf.connect(this.voiceG);
    this.voiceG.connect(panIn);

    // Två triangelformade oscillatorer skapar skuggans röst.
    // De har olika frekvensförhållanden och är lite ostämda mot varandra.
    this.voiceOsc = [[1, -7], [1.5, 6]].map(([r, d]) => [osc('triangle', A_ROOT * 8 * r, d, vf), r]);

    // Jag skapar en brusbaserad viskning som går genom ett bandpassfilter.
    const wn = this._nz(), wbp = this._f('bandpass', 2400, 4);
    wn.loop = true;
    this.whisG = this._g(0);
    wn.connect(wbp);
    wbp.connect(this.whisG);
    this.whisG.connect(panIn);
    wn.start();

    // Även viskningens filter påverkas av en långsam oscillator.
    const wlg = this._g(900);
    wlg.connect(wbp.frequency);
    osc('sine', 0.35, 0, wlg);

    // Jag startar en timer som regelbundet kör tick().
    // Den används för att planera musikens nästa steg.
    this.timer = setInterval(() => this.tick(), 25);

    // Släpp ljudet så fort webbläsaren tillåter (t.ex. efter fokus/fullskärm). Försök tyst.
    // Jag försöker återuppta ljudkontexten var 500:e millisekund om webbläsaren fortfarande har pausat den.
    this.unlock = setInterval(() => {
      if (c.state === 'suspended') c.resume().catch(() => {});
    }, 500);
  }

  // ---------- Instrument ----------

  // Jag använder en gemensam envelope-funktion för att styra hur snabbt ljud startar och klingar av.
  // Det gör att ljuden får tydliga anslag och avtoningar i stället för att bara slås på och av.
  _env(g, t, peak, dec, atk = 0.003) {
    // Först börjar jag nästan helt tyst.
    g.gain.setValueAtTime(0.0001, t);

    // Sedan ökar jag volymen till peak under attack-tiden.
    g.gain.linearRampToValueAtTime(peak, t + atk);

    // Till sist låter jag ljudet klinga av exponentiellt.
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  }

  kick(t, v, soft) {
    // Jag skapar en sinusoscillator för bastrummans ljud.
    const o = this._o('sine'), g = this._g();

    // Jag börjar med en högre frekvens och sänker den snabbt.
    // Det ger bastrumman dess karakteristiska dunk.
    o.frequency.setValueAtTime(soft ? 90 : 150, t);
    o.frequency.exponentialRampToValueAtTime(soft ? 38 : 44, t + 0.14);

    // Jag formar volymen med en envelope och kopplar ljudet till trumbussen.
    this._env(g, t, v * 0.95, soft ? 0.4 : 0.32);
    o.connect(g);
    g.connect(this.bus.drum);
    o.start(t);
    o.stop(t + 0.5);

    // Jag sparar tidpunkten för kicken så att ljuset kan reagera på den.
    this.kicks.push(t);
  }

  hat(t, v, open) {
    // Jag använder brus för att skapa ett fräsigt hi-hat-ljud.
    const n = this._nz(), f = this._f('highpass', 7500), g = this._g(), dec = open ? 0.25 : 0.045;

    // Ett öppet hi-hat-ljud får längre avklingning än ett stängt.
    this._env(g, t, 0.18 * v, dec, 0.001);

    // Jag filtrerar bort de lägre frekvenserna så att ljudet blir ljust.
    n.connect(f);
    f.connect(g);
    g.connect(this.bus.drum);

    // Jag startar bruskällan med en slumpmässig startposition och stoppar den efter avklingningen.
    n.start(t, Math.random() * 1.5);
    n.stop(t + dec + 0.05);
  }

  clap(t, v) {
    // Jag skapar en clap av tre korta brusstötar.
    // Den sista stöten får längre avklingning och mer reverb.
    [0, 0.011, 0.022].forEach((d, i) => {
      const n = this._nz(), f = this._f('bandpass', 1400, 1), g = this._g(), dec = i === 2 ? 0.18 : 0.012;

      // Jag använder olika avklingning beroende på vilken av de tre stötarna det gäller.
      this._env(g, t + d, 0.35 * v, dec, 0.001);
      n.connect(f);
      f.connect(g);
      g.connect(this.bus.drum);
      g.connect(this.revIn);

      // Jag startar och stoppar varje brusstöt vid rätt tidpunkt.
      n.start(t + d, Math.random());
      n.stop(t + d + dec + 0.05);
    });
  }

  tick_(t, f, v) {
    // Jag skapar ett kort, träaktigt blip-ljud med en triangelformad oscillator.
    const o = this._o('triangle', f), g = this._g();

    // Jag ger ljudet ett snabbt anslag och kort avklingning.
    this._env(g, t, 0.12 * v, 0.08, 0.001);
    o.connect(g);
    g.connect(this.bus.arp);
    o.start(t);
    o.stop(t + 0.15);
  }

  bass(t, f, dur, v) {
    // Jag bygger basljudet av två oscillatorer: en sågtand och en sinus.
    // Sinusoscillatorn ligger en oktav under sågtandsoscillatorn.
    const o = this._o('sawtooth', f), s = this._o('sine', f / 2), fl = this._f('lowpass'), g = this._g();

    // Jag börjar med ett öppnare filter och sänker sedan frekvensen.
    // Det gör att basljudet får ett tydligare anslag och sedan blir dovare.
    fl.frequency.setValueAtTime(900, t);
    fl.frequency.exponentialRampToValueAtTime(150, t + dur);

    // Jag formar ljudets volym och kopplar oscillatorerna genom filtret.
    this._env(g, t, 0.28 * v, dur, 0.005);
    o.connect(fl);
    s.connect(fl);
    fl.connect(g);
    g.connect(this.bus.bass);

    // Jag startar och stoppar båda oscillatorerna samtidigt.
    o.start(t);
    s.start(t);
    o.stop(t + dur + 0.1);
    s.stop(t + dur + 0.1);
  }

  arp(t, f, v) {
    // Jag skapar ett arpeggioljud med två oscillatorer som spelar nästan samma frekvens.
    // Den ena använder triangelform och den andra fyrkantsform.
    const o = this._o('triangle', f), o2 = this._o('square', f * 1.005), g2 = this._g(0.3), fl = this._f('lowpass'), g = this._g();

    // Jag låter filtret bli dovare under ljudets gång.
    fl.frequency.setValueAtTime(3200, t);
    fl.frequency.exponentialRampToValueAtTime(800, t + 0.25);

    // Jag formar volymen och kopplar oscillatorerna till filtret.
    this._env(g, t, 0.16 * v, 0.28, 0.004);
    o.connect(fl);
    o2.connect(g2);
    g2.connect(fl);
    fl.connect(g);
    g.connect(this.bus.arp);

    // Jag startar båda tonerna och stoppar dem efter en kort stund.
    o.start(t);
    o2.start(t);
    o.stop(t + 0.4);
    o2.stop(t + 0.4);
  }

  riser(t, dur) {
    // Jag skapar en stigande brus-effekt som används inför ett nivåbyte.
    const n = this._nz(), f = this._f('bandpass', null, 6), g = this._g();

    // Jag begränsar längden så att effekten inte blir längre än 1,9 sekunder.
    dur = Math.min(1.9, dur);

    // Jag höjer filtrets frekvens från 250 Hz till 9000 Hz.
    // Det gör att bruset gradvis blir ljusare och upplevs som att det stiger.
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(9000, t + dur);

    // Jag låter ljudstyrkan öka under hela effekten och sänker den direkt efteråt.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.26, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.02);

    // Jag kopplar ihop brus, filter och volym och bestämmer när ljudet ska stoppas.
    n.connect(f);
    f.connect(g);
    g.connect(this.bus.fx);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  impact(t, v) {
    // Jag skapar en djup ljudstöt som används när en nivå börjar eller när ghost-läget aktiveras.
    const o = this._o('sine'), g = this._g();

    // Jag sänker frekvensen snabbt för att skapa ett tungt och mörkt anslag.
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);

    // Jag formar ljudets avklingning och skickar det till effektbussen.
    this._env(g, t, v, 0.9, 0.003);
    o.connect(g);
    g.connect(this.bus.fx);
    o.start(t);
    o.stop(t + 1.1);

    // Jag sparar även impact-tidpunkten så att ljuset kan reagera på den.
    this.kicks.push(t);
  }

  // ---------- Sekvenserare ----------

  tick() {
    // Jag hämtar ljudkontexten och avbryter om ljudet inte är igång.
    const c = this.ctx;
    if (!c || c.state !== 'running') return;

    // Om nästa planerade ljudtid redan har passerat flyttar jag fram den lite.
    // Det minskar risken för att sekvensen hamnar efter ljudkontextens aktuella tid.
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.05;

    // Jag planerar ljudhändelser en bit framåt i tiden.
    // Det kallas lookahead och gör rytmen stabilare än om jag försökte spela ljud exakt vid varje timeranrop.
    while (this.nextT < c.currentTime + 0.2) {
      this.playStep(this.step, this.nextT);
      this.nextT += 60 / this.bpm / 4;
      this.step++;
    }
  }

  // Lager per nivå (0 = nivå 1 ... 4 = nivå 5). s = 16-delssteg, D = ducking (glimt), sd = steglängd i sek
  playStep(step, t) {
    // Jag räknar ut vilket steg i takten vi befinner oss på och vilken takt det är.
    const lv = this.level, s = step % 16, bar = Math.floor(step / 16), D = this.duck, sd = 60 / this.bpm / 4, R = Math.random;

    // Jag byter ackord vid början av var fjärde takt.
    if (s === 0 && bar % 4 === 0) this.setChord(bar, t);

    // Jag ändrar ibland en slumpmässigt vald plats i melodimönstret.
    // Det gör att arpeggiot kan variera medan musiken spelas.
    if (s === 0 && R() < 0.3) this.motif[Math.floor(R() * 16)] = R() < 0.6 ? Math.floor(R() * A_SEMI.length) : -1;

    // Om level är negativt finns ingen aktiv spelupplevelse, så jag spelar inga instrument.
    if (lv < 0) return;

    // Jag hämtar grundtonen och inställningarna för den aktuella nivån.
    const root = this.root, P = A_LVL[lv], rp = i => lv === i ? 0.3 + 0.7 * Math.min(1, this.lt / 6) : 1;

    // rp gör att ljudlagret som hör till den nya nivån tonas in under ungefär sex sekunder.

    // KICK: nivå 2 hjärtslag, nivå 3 två slag/takt, nivå 4–5 fyra-på-golvet (+ synkoper)
    // Jag varierar bastrummans rytm beroende på nivån.
    if (lv === 1) {
      if (s === 0) this.kick(t, 0.55 * D * rp(1), true);
      if (s === 3) this.kick(t, 0.3 * D * rp(1), true);
    }
    else if (lv === 2) {
      if (s === 0 || s === 8) this.kick(t, 0.8 * D * rp(2));
    }
    else if (lv >= 3) {
      if (s % 4 === 0) this.kick(t, D * rp(3));
      else if ((s === 7 || s === 11 || s === 15) && R() < (lv === 3 ? 0.15 : 0.35)) this.kick(t, 0.55 * D);
    }

    // HI-HAT: sparsamt från nivå 2, tätare uppåt
    // Jag lägger till hi-hat-ljud på olika steg och ökar sannolikheten när nivån blir högre.
    if (lv >= 1) {
      if (s % 4 === 2) {
        if (R() < (lv === 1 ? 0.4 : 1)) this.hat(t, 0.5 * D * rp(lv === 1 ? 1 : 2), lv >= 2 && s === 14 && R() < 0.3);
      }
      else if (s % 2 === 0) {
        if (lv >= 2 && R() < P.hat * 0.9) this.hat(t, 0.35 * D * rp(2));
      }
      else if (lv >= 3 && R() < P.hat * 0.8) this.hat(t, (0.2 + R() * 0.3) * D * rp(3));
    }

    // CLAP från nivå 3, TRÄBLIPPAR från nivå 2
    // Jag lägger in clap på bestämda steg från nivå 3 och blippar som extra rytm från nivå 2.
    if (lv >= 2 && (s === 4 || s === 12)) this.clap(t, (lv === 2 ? 0.35 : 0.6) * D * rp(2));
    if (lv >= 1 && s % 2 === 1 && R() < P.tick * 0.25) this.tick_(t, root * 8 * Math.pow(2, A_SEMI[Math.floor(R() * 6)] / 12), D * rp(1));

    // BAS från nivå 4
    // Jag lägger till basnoter från nivå 4 och väljer vilka sextondelssteg som ska få en ton.
    if (lv >= 3 && (lv === 3 ? [2, 3, 6, 10, 11, 14] : [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]).includes(s))
      this.bass(t, s % 4 === 2 ? root : root * [1, 1.5, 1.0595, 2][Math.floor(R() * 4)], 0.18, D * rp(3));

    // ARPEGGIO (sparsamt från nivå 3). Nivå 5 hoppar oktaver och stammar.
    // Jag hämtar en ton från det slumpmässigt föränderliga motivet och spelar den som ett kort arpeggio.
    if (lv >= 2 && R() < P.arp) {
      const idx = this.motif[s];

      // Ett negativt värde betyder att just det steget är tyst.
      if (idx >= 0) {
        let f = root * 4 * Math.pow(2, A_SEMI[idx] / 12);

        // På nivå 5 kan jag ibland flytta tonen en oktav upp eller ner.
        if (lv === 4 && R() < 0.2) f *= R() < 0.5 ? 2 : 0.5;

        this.arp(t, f, D * rp(lv === 2 ? 2 : 3));

        // Ibland upprepar jag samma ton snabbt för att skapa en stammig effekt.
        if (lv === 4 && R() < 0.25) this.arp(t + sd / 2, f, 0.7 * D);
      }
    }

    // GLITCH-rullar från nivå 4
    // Jag skapar snabba hi-hat-upprepningar mot slutet av takten när glitch-värdet är tillräckligt högt.
    if (lv >= 3 && s >= 12 && R() < P.glitch * 0.25)
      for (let i = 0; i < 4; i++) this.hat(t + i * sd / 4, (0.3 + 0.1 * i) * D);
  }

  setChord(bar, t) {
    // Jag väljer en av grundtonerna i A_CHORD utifrån vilken takt som spelas.
    const r = this.root = A_ROOT * A_CHORD[Math.floor(bar / 4) % 4];

    // Jag uppdaterar frekvensen på alla oscillatorer i ljudmattan.
    // setTargetAtTime gör att tonhöjden glider mjukt i stället för att ändras tvärt.
    this.padOsc.forEach(([o, k]) => o.frequency.setTargetAtTime(r * 2 * k, t, 0.5));
  }

  // ---------- Per bildruta (parametrar uppdateras ~20 ggr/s) ----------

  // s = { level (-1 = ingen upplevelse, 0–4), t (sek in i nivån), nextIn (sek till nästa nivå eller null), normal, ghost, dev, pan }
  update(now, s) {
    // Den här funktionen tar emot spelets aktuella tillstånd och anpassar ljudet efter det.
    // Den anropas regelbundet medan spelet körs.
    const c = this.ctx;
    if (!c || c.state !== 'running') return;

    const t = c.currentTime, lv = s.level;

    // Jag upptäcker om spelaren har gått till en annan nivå.
    if (lv !== this.level) {
      // Vid ett nivåbyte spelar jag en impact.
      // Om det är första nivån blir ljudet svagare än vid ett vanligt nivåbyte.
      if (lv >= 0) this.impact(t + 0.02, this.level >= 0 ? 0.55 : 0.25);

      // Jag sparar den nya nivån och återställer informationen om risern.
      this.level = lv;
      this.risedLevel = -9;
    }

    // Om ghost-läget precis har aktiverats spelar jag också en impact.
    if (s.ghost && !this.st.ghost) this.impact(t + 0.02, 0.4);

    // Riser precis före nästa nivå, slutar vid själva bytet
    // Jag startar en stigande effekt när det är mindre än två sekunder kvar till nästa nivå.
    // risedLevel gör att effekten inte startas om vid varje uppdatering.
    if (lv >= 0 && s.nextIn != null && s.nextIn < 2 && this.risedLevel !== lv) {
      this.riser(t, Math.max(0.5, s.nextIn));
      this.risedLevel = lv;
    }

    // Jag sparar det senaste tillståndet och tiden som gått på nivån.
    this.st = s;
    this.lt = s.t || 0;

    // Jag begränsar hur ofta resten av ljudparametrarna uppdateras till ungefär 20 gånger per sekund.
    if (now - this.lastU < 0.05) return;
    this.lastU = now;

    // Jag hämtar information om normalitet, aktuell nivå och skuggans avvikelse.
    const amb = lv < 0, nrm = s.normal || 0, P = A_LVL[Math.max(0, lv)], dev = Math.min(1, s.dev || 0), T = (p, v, k) => p.setTargetAtTime(v, t, k);

    // duck sänker ljudstyrkan på rytmlagren när normalitetsvärdet ökar.
    // bpm glider gradvis mot tempot som hör till den aktuella nivån.
    this.duck = 1 - 0.75 * nrm;
    this.bpm += ((amb ? 96 : P.bpm) - this.bpm) * 0.05;

    // Jag justerar huvudvolymen. Ljudet blir tyst när det inte finns någon aktiv upplevelse
    // eller när användaren har stängt av ljudet.
    // setTargetAtTime gör volymändringen mjuk.
    T(this.master.gain, this.mute || amb ? 0 : this.cfg.volume, amb ? 1.2 : 1.5);

    // Jag ändrar huvudfiltrets frekvens beroende på spelets tillstånd.
    // Normalitetsläget gör ljudet dovare, och ghost-läget använder också en lägre filterfrekvens.
    T(this.lp.frequency, Math.max(300, (s.ghost ? 4800 : 16000) * (1 - nrm) + 450 * nrm), 0.06);

    // Jag styr ljudmattans volym efter nivån.
    T(this.padG.gain, amb ? 0.1 : P.pad, 0.5);

    // Jag ökar mängden distortion när nivån kräver det.
    T(this.distOut.gain, amb ? 0 : P.dist, 0.5);

    // Jag höjer reverbet i ghost-läget och gradvis även när nivån blir högre.
    T(this.revOut.gain, 0.55 + (s.ghost ? 0.5 : 0) + 0.2 * Math.max(0, lv) / 4, 0.4);

    // Jag styr skuggans röst utifrån avvikelsen.
    // Ju större avvikelse, desto starkare blir röstlagret, upp till ett begränsat maxvärde.
    T(this.voiceG.gain, amb ? 0 : Math.min(0.02, dev * 0.065) * (1 - nrm), 0.15);

    // Jag gör samma sak med viskningen och lägger till lite extra styrka i ghost-läget.
    T(this.whisG.gain, amb ? 0 : Math.min(0.022, dev * 0.06 + (s.ghost ? 0.05 : 0)) * (1 - nrm), 0.2);

    // Jag låter skuggans röst ändra tonhöjd lite beroende på avvikelsen.
    this.voiceOsc.forEach(([o, k]) => T(o.frequency, this.root * 8 * k * (1 + 0.03 * dev), 0.3));

    // Om panorering stöds flyttar jag skuggans röst åt det håll som anges av spelet.
    // Jag begränsar värdet till intervallet -0.9 till 0.9.
    if (this.pan) T(this.pan.pan, Math.max(-0.9, Math.min(0.9, s.pan || 0)), 0.1);
  }

  // 0..1, 1 precis när en kick/impact hörs, avtar sedan. Används av ljuset.
  kickEnv() {
    // Jag skickar tillbaka 0 om ljudsystemet inte är igång.
    if (!this.running) return 0;

    // Jag räknar ut aktuell ljudtid och tar hänsyn till eventuell utgångsfördröjning.
    const n = this.ctx.currentTime - (this.ctx.outputLatency || 0), ks = this.kicks;
    let last = -1;

    // Jag letar bakifrån efter den senaste kick eller impact som redan har inträffat.
    for (let i = ks.length - 1; i >= 0; i--)
      if (ks[i] <= n) { last = ks[i]; break; }

    // Jag tar bort gamla tidpunkter när listan blivit större än åtta poster.
    // Då behöver jag inte spara ljudhändelser som inte längre är relevanta.
    while (ks.length > 8 && ks[0] < n - 1) ks.shift();

    // Om ingen kick har inträffat returnerar jag 0.
    // Annars returnerar jag ett värde som börjar nära 1 och avtar exponentiellt.
    // Det kan användas av ljussystemet för att skapa en puls i takt med musiken.
    return last < 0 ? 0 : Math.exp(-(n - last) / 0.16);
  }
}