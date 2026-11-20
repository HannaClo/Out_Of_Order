// VATTENVÄRLDEN – AQUATIC RAVE: växande 4/4-ravebeat + vattenljud (Web Audio, allt syntetiskt).
// Nivå 0: undervattensatmosfär · 1: mjuk kick, puls, subbas · 2: starkare kick, basgång, clap, percussion
// 3: arpeggio, tätare rytm · 4: offbeat-hats, öppna hats · 5: full rave med fills.
// API: start, update, pourStart, firstHit, slosh, setLevel, getVisualState, setFade, fadeIn, reset
const Vattenljud = (() => {
  "use strict";

  // ---------------- INSTÄLLNINGAR ----------------
  // Här samlar jag volymnivåerna för olika delar av ljudsystemet.
  // Genom att ha dem samlade kan jag justera ljudbalansen utan att behöva ändra varje enskilt ljud.
  const MASTER_VOL = 0.92, MUSIC_VOL = 0.36, SFX_VOL = 0.25, // SFX sänkt för att ge musiken utrymme
    POUR_VOL = 0.40, SPLASH_VOL = 0.35, POOL_VOL = 0.30,
    REVERB_VOL = 0.10, WATER_PITCH = 1.0, MUSIC_DUCK = 0.38,
    BPM = 128, STEP = 60 / BPM / 4;
  // MASTER_VOL är den övergripande volymen (0.92, höjd för att matcha de andra världarna; tidigare 0.82 och ursprungligen 0.75). MUSIC_VOL och SFX_VOL styr musik respektive ljudeffekter.
  // POUR_VOL, SPLASH_VOL och POOL_VOL används för olika typer av vattenljud.
  // REVERB_VOL bestämmer hur starkt efterklangen hörs och WATER_PITCH kan ändra vattenljudens tonhöjd.
  // MUSIC_DUCK anger hur mycket musiken ska sänkas när vattenljuden blir starka.
  // BPM är musikens tempo. STEP räknar ut längden på ett sextondelssteg i sekunder.
  // Jag delar först 60 sekunder med BPM för att få längden på ett fjärdedelsslag och delar sedan med fyra.

  // Dessa små hjälpfunktioner återanvänds på flera ställen i ljudberäkningarna.
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // clamp begränsar ett värde så att det aldrig blir mindre än a eller större än b.
  const lerp = (a, b, t) => a + (b - a) * t;
  // lerp räknar ut ett värde mellan a och b. t anger hur långt mellan värdena jag ska hamna.
  const rnd = (a, b) => a + Math.random() * (b - a);
  // rnd ger mig ett slumpmässigt decimaltal mellan a och b. Det gör att ljuden kan variera lite.
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // mtof omvandlar ett MIDI-tonnummer till en frekvens i hertz.
  // MIDI-tonnummer 69 motsvarar 440 Hz, alltså tonen A.
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  // pick väljer ett slumpmässigt element ur en array, exempelvis en ton ur ett ackord.

  // ---------------- TILLSTÅND ----------------
  // Här sparar jag ljudsystemets aktuella tillstånd och de objekt som skapas med Web Audio API.
  let ctx = null, muted = false, fade = 0;
  // ctx är AudioContext, alltså själva motorn som skapar och spelar upp ljud.
  // muted håller reda på om ljudet är avstängt och fade används för att tona ned eller upp huvudvolymen.
  let master, mixBus, comp, sfxBus, musicBus, musicLP, sfxDuck, reverbIn, convolver, revReturn;
  // Dessa variabler representerar olika delar av ljudkedjan: huvudvolym, mixning, kompressor,
  // separata ljudbussar för effekter och musik samt filter och reverb.
  let white, pink, brown, wIn, waterPan, panLfo, panDepth;
  // Här sparar jag olika typer av brus och ljudnoder som används för vattenljuden.
  const W = {};
  // W använder jag som en samling för vattenljudens oscillatorer, filter och gain-noder.
  let flow = 0, jetRate = 0, dropRate = 0, rainRate = 0, depth = 0, wasPouring = false;
  // Dessa variabler beskriver vad som händer i vattnet just nu.
  // De håller bland annat reda på flöde, vattenstrålar, droppar, regn, djup och om användaren nyss hällde.
  let bubAcc = 0, splatAcc = 0, plipAcc = 0, lapAcc = 0, lastSlosh = -9, lastFirst = -9;
  // Accumulatorerna samlar på sig tid och används för att skapa ljudhändelser med en viss frekvens.
  // lastSlosh och lastFirst gör att vissa ljud inte kan triggas för ofta.

  // Musik
  // Här sparar jag ljudbussarna och tillståndet för den genererade musiken.
  let busPad, busShimmer, busPulse, busArp, busSub, busBeat, busPerc, busBass, busHat;
  // Varje buss samlar en viss typ av musikljud, exempelvis pad, bas, kick, percussion och hi-hat.
  let padFilter, padSub, shimmerFilter, musicDelay;
  const padVoices = [];
  // padVoices innehåller oscillatorerna som bygger upp de mjuka ackordsljuden.
  let musicStep = 0, musicNextTime = 0, musicChord = -1, musicLevel = 0, musicPendingLevel = null, musicTimer = null;
  // musicStep räknar musikens steg. musicNextTime anger när nästa steg ska spelas.
  // musicChord håller reda på aktuellt ackord och musicLevel på musikens intensitetsnivå.
  // musicPendingLevel används när en ny nivå har begärts men ännu inte ska börja gälla.
  // musicTimer är timern som regelbundet kör musikens schemaläggare.

  // Beat-signaler till neonljusen (AudioContext-klocka)
  let visualKickAt = -10, visualHatAt = -10, visualKickAmp = 0, visualHatAmp = 0, visualBeatSide = 0, visualStep = 0;
  // Jag sparar tidpunkten och styrkan för senaste kick och hi-hat.
  // Vattenvärldens visuella effekter kan sedan läsa dessa värden och reagera i takt med musiken.
  // Jag använder AudioContext-klockan i stället för en separat timer för att ljud och ljus ska hålla samma timing.

  // ---------------- HARMONI ----------------
  const AQUA_PROG = [
    // Varje objekt beskriver ett ackord i musikens harmoniska följd.
    // root används för den låga grundtonen, pad innehåller ackordets toner,
    // notes används för melodier och bass anger tonen för basgången.
    { root: 33, pad: [45, 52, 60, 67, 71], notes: [60, 64, 67, 71, 76, 79], bass: 45 },
    { root: 29, pad: [41, 48, 57, 64, 67], notes: [57, 60, 64, 67, 72, 76], bass: 41 },
    { root: 36, pad: [48, 55, 64, 71, 74], notes: [60, 64, 67, 71, 76, 83], bass: 48 },
    { root: 31, pad: [43, 50, 57, 62, 64], notes: [57, 59, 62, 67, 71, 76], bass: 43 },
  ];

  const AQUA_LEVELS = [
    // Här definierar jag ljudinställningarna för musikens sex nivåer.
    // När nivån ökar blir bland annat kick, bas, percussion och hi-hat starkare.
    // cut styr pad-filtrets frekvens och density påverkar hur ofta extra toner spelas.
    { pad: 0.13, cut: 420,  shimmer: 0.012, pulse: 0.035, sub: 0.10, beat: 0,    perc: 0,    bass: 0,    hat: 0,     density: 0.04 },
    { pad: 0.14, cut: 650,  shimmer: 0.025, pulse: 0.10,  sub: 0.17, beat: 0.30, perc: 0.07, bass: 0.20, hat: 0.035, density: 0.14 },
    { pad: 0.15, cut: 1050, shimmer: 0.05,  pulse: 0.14,  sub: 0.21, beat: 0.58, perc: 0.17, bass: 0.34, hat: 0.085, density: 0.25 },
    { pad: 0.16, cut: 1550, shimmer: 0.075, pulse: 0.17,  sub: 0.23, beat: 0.68, perc: 0.23, bass: 0.43, hat: 0.14,  density: 0.36 },
    { pad: 0.18, cut: 2200, shimmer: 0.10,  pulse: 0.20,  sub: 0.26, beat: 0.80, perc: 0.30, bass: 0.51, hat: 0.19,  density: 0.47 },
    { pad: 0.20, cut: 2900, shimmer: 0.13,  pulse: 0.23,  sub: 0.29, beat: 0.92, perc: 0.39, bass: 0.62, hat: 0.25,  density: 0.62 },
  ];
  const AQUA_PATTERN = [0, 2, 4, 3, 1, 4, 5, 2, 0, 3, 4, 2, 1, 5, 3, 4];
  // AQUA_PATTERN bestämmer ordningen på tonerna i arpeggiot.
  // Genom att använda en förutbestämd sekvens får melodin ett mönster i stället för att vara helt slumpmässig.

  // ---------------- HJÄLPFUNKTIONER ----------------
  function gainNode(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  // Jag skapar en GainNode som styr volymen på en ljudsignal.
  // v blir startvärdet för gain. En gain på 1 lämnar signalen oförändrad, medan lägre värden sänker volymen.

  // Envelop: upp till peak på a sek, sedan exponentiellt ner över d sek
  function envAD(g, t, peak, a, d) {
    // Den här funktionen formar ljudets volym över tid.
    // Jag börjar på nästan noll, ökar till peak under a sekunder och tonar sedan ut under d sekunder.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    // Jag använder ett litet minimivärde i stället för exakt noll eftersom exponentiell ramp inte kan gå till noll.
  }

  function noiseSrc(buf, t, dur) {
    // Skapar en ljudkälla som spelar upp ett brus från en AudioBuffer under en begränsad tid.
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    // Jag låter bruset loopa så att det kan användas även om ljudet är längre än själva bufferten.
    s.start(t, Math.random() * Math.max(0.01, buf.duration - 0.2));
    // Startpositionen i bufferten väljs slumpmässigt för att ljuden inte ska låta exakt likadant varje gång.
    s.stop(t + dur + 0.02);
    return s;
  }

  function loopSrc(buf) {
    // Skapar en brusljudkälla som fortsätter spela tills den stoppas eller ljudsystemet stängs ned.
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.start();
    return s;
  }

  function filt(type, freq, q) {
    // Jag skapar ett biquad-filter som kan forma ljudets frekvensinnehåll.
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q === undefined ? 0.7 : q;
    // type bestämmer filtertypen, freq dess frekvens och Q hur smalt eller markerat filtret är.
    // Om inget Q-värde anges använder jag 0.7 som standard.
    return f;
  }

  function panner(v) {
    // Den här funktionen placerar ett ljud i stereobilden, alltså mer åt vänster eller höger.
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : gainNode(1);
    // Om webbläsaren stöder StereoPannerNode använder jag den. Annars skapar jag en vanlig gain-nod som reserv.
    if (p.pan) p.pan.value = clamp(v, -1, 1);
    // Panoreringsvärdet begränsas till -1 för vänster och 1 för höger.
    return p;
  }

  // Sinus som sveper f0→f1 (över sw sek; utan f1 konstant), envelop a/d, ev. via ett filter, till dest
  function tone(t, f0, f1, sw, amp, a, d, dest, stop, via) {
    // Jag skapar en kort ton med en sinusoscillator.
    // Funktionen kan ändra tonhöjd från f0 till f1, forma volymen och skicka ljudet till en vald destination.
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + sw);
    // Om f1 finns gör jag en exponentiell frekvensförändring under sw sekunder.
    envAD(g, t, amp, a, d);
    // Jag använder envelopen för att få ett kontrollerat anslag och avslut.
    if (via) { o.connect(via); via.connect(g); } else o.connect(g);
    // Om ett filter har skickats in kopplar jag oscillatorn genom filtret innan volymkontrollen.
    // Annars kopplar jag oscillatorn direkt till gain-noden.
    g.connect(dest);
    o.start(t); o.stop(t + stop);
    // Jag schemalägger start och stopp med AudioContext-tid, vilket ger exaktare timing.
  }

  // LFO med eget gain (djup) kopplat till target; returnerar [oscillator, gain]
  function lfo(f, depth, target) {
    // En LFO är en långsam oscillator som används för att modulera en annan ljudparameter.
    // Här kan den exempelvis skapa en långsam rörelse i filterfrekvens eller stereopanorering.
    const o = ctx.createOscillator(), g = gainNode(depth);
    o.frequency.value = f; o.connect(g);
    if (target) g.connect(target);
    // Jag kopplar LFO-signalen till target om en sådan har skickats in.
    o.start();
    return [o, g];
    // Jag returnerar både oscillatorn och gain-noden så att moduleringens djup kan ändras senare.
  }

  // Loopat brus → filter → gain(0) → wIn; returnerar [filter, gain]
  function noiseBand(buf, type, f, q) {
    // Jag bygger en kedja av brus, filter och volymkontroll för att skapa en viss del av vattenljudet.
    const F = filt(type, f, q), G = gainNode(0);
    loopSrc(buf).connect(F); F.connect(G); G.connect(wIn);
    // Gain börjar på noll. Senare kan updateWater ändra volymen beroende på vad som händer i världen.
    return [F, G];
  }

  // ---------------- BRUSBUFFERTAR ----------------
  function makeBuffers() {
    // Jag skapar tre typer av brus som används som grundmaterial till vattenljuden.
    const sr = ctx.sampleRate;
    // sampleRate anger hur många ljudprover som spelas upp per sekund.
    white = ctx.createBuffer(1, sr * 2, sr);
    // Jag skapar två sekunder vitt brus med en ljudkanal.
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    // Vitt brus innehåller slumpmässiga värden över hela frekvensområdet.

    pink = ctx.createBuffer(1, sr * 3, sr);
    // Rosa brus får en annan frekvensfördelning och upplevs ofta mjukare och mindre vasst än vitt brus.
    const p = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    // Dessa mellanvärden används i filtret som formar det vita bruset till rosa brus.
    for (let i = 0; i < p.length; i++) {
      const x = Math.random() * 2 - 1;
      // Jag skapar ett nytt slumpmässigt brusvärde för varje ljudprov.
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.96900 * b2 + x * 0.1538520;
      b3 = 0.86650 * b3 + x * 0.3104856;
      b4 = 0.55000 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.0168980;
      // Jag använder flera återkopplade beräkningar för att forma brusets frekvensinnehåll.
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
      // Resultatet skrivs in i bufferten ett prov i taget.
    }

    brown = ctx.createBuffer(1, sr * 3, sr);
    // Brunt brus har mer energi i de lägre frekvenserna och passar därför bra till dovare vattenljud.
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      // Jag låter det föregående värdet påverka nästa värde. Det ger en långsammare variation än vitt brus.
      b[i] = last * 3.5;
      // Jag förstärker värdet och sparar det i ljudbufferten.
    }
  }

  // Reverb-impuls: brus som dämpas och mörknar över tid
  function makeIR(sec) {
    // Jag skapar en impulsrespons som används av ConvolverNode för att simulera efterklang.
    // En impulsrespons beskriver hur ett rum eller en miljö påverkar ett ljud efter att det har spelats.
    const sr = ctx.sampleRate, len = Math.floor(sr * sec), ir = ctx.createBuffer(2, len, sr);
    // Jag räknar ut antalet ljudprov utifrån önskad längd och skapar en stereobuffert.
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr, a = 0.10 + 0.90 * Math.exp(-t * 2.2);
        // t är tiden i sekunder. a styr hur snabbt brusets variation jämnas ut över tiden.
        y += ((Math.random() * 2 - 1) - y) * a;
        d[i] = y * Math.exp(-t * 2.2) * (i < sr * 0.005 ? i / (sr * 0.005) : 1) * 1.6;
        // Jag dämpar ljudet exponentiellt så att efterklangen klingar av.
        // Den sista faktorn ger en kort mjuk inledning för att undvika ett abrupt ljudanslag.
      }
    }
    return ir;
    // Jag skickar tillbaka bufferten så att den kan användas som reverbets impulsrespons.
  }

  // ---------------- LJUDGRAF ----------------
  function build() {
    // Här bygger jag upp hela ljudkedjan. Funktionen körs när ljudsystemet startas första gången.
    makeBuffers();
    // Jag skapar först brusmaterialet som vattenljuden behöver.
    comp = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -12, knee: 12, ratio: 4, attack: 0.004, release: 0.18 }).forEach(([k, v]) => comp[k].value = v);
    // Kompressorn jämnar ut ljudnivåerna så att de starkaste ljuden inte sticker iväg för mycket.
    // threshold anger nivån där komprimeringen börjar, ratio hur kraftig den är och attack/release hur snabbt den reagerar.

    master = gainNode(0.0001);
    mixBus = gainNode(1);
    mixBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    // Jag kopplar ihop huvudkedjan: alla ljud går till mixBus, vidare genom kompressorn,
    // sedan genom huvudvolymen och till sist till högtalarna eller hörlurarna.
    // master börjar nästan helt avstängd så att jag kan tona in ljudet kontrollerat.

    sfxBus = gainNode(SFX_VOL); sfxBus.connect(mixBus);
    // Ljudeffekterna får en egen buss så att deras volym kan styras separat från musiken.

    musicBus = gainNode(MUSIC_VOL);
    musicLP = filt("lowpass", 3200, 0.5);
    sfxDuck = gainNode(1);
    musicBus.connect(musicLP); musicLP.connect(sfxDuck); sfxDuck.connect(mixBus);
    // Musikens ljud går genom ett lågpassfilter och sedan genom sfxDuck innan det når mixningen.
    // sfxDuck används för att sänka musiken när vattenljuden blir intensiva.

    reverbIn = gainNode(1);
    convolver = ctx.createConvolver();
    convolver.buffer = makeIR(3.0);
    revReturn = gainNode(REVERB_VOL);
    reverbIn.connect(convolver); convolver.connect(revReturn); revReturn.connect(mixBus);
    // Här bygger jag reverbkedjan. Ljud som skickas till reverbIn behandlas av ConvolverNode
    // med den impulsrespons jag skapade tidigare. revReturn bestämmer hur mycket efterklang som blandas in.

    buildWater();
    buildMusic();
    // När den gemensamma ljudkedjan är klar bygger jag vattenljuden och musiken var för sig.
  }

  // ---------------- VATTENLJUD ----------------
  function buildWater() {
    // Här skapar jag de ljudkällor och filter som används för det kontinuerliga vattenljudet.
    wIn = gainNode(1);
    waterPan = panner(0);
    wIn.connect(waterPan); waterPan.connect(sfxBus);
    // Alla vattenljud som skickas till wIn kan panoreras och går sedan till ljudeffekternas buss.

    const ws = gainNode(0.15); // vattenreverb-send
    wIn.connect(ws); ws.connect(reverbIn);
    // Jag skickar också en del av vattenljudet till reverb så att det får en mer rumslig känsla.

    [panLfo, panDepth] = lfo(0.5, 0, waterPan.pan);
    [, W.wobDepth] = lfo(2.2, 0);
    // Den första LFO:n kan flytta vattenljudet mellan vänster och höger kanal.
    // Den andra används för att modulera filterfrekvenser. Jag sparar dess gain-nod i W.wobDepth.

    [W.airF, W.airG] = noiseBand(white, "highpass", 3200, 0.65);
    W.wobDepth.connect(W.airF.frequency);
    // Det höga bruslagret ger ett luftigt och fräsande ljud.
    // LFO-signalen kan förändra filtrets frekvens och därmed ljudets karaktär.
    [W.rushF, W.rushG] = noiseBand(pink, "bandpass", 1900, 0.55);
    W.wobDepth.connect(W.rushF.frequency);
    // Det här bandpassfiltrerade lagret används för ett mer framträdande strömmande ljud.
    [W.bodyF, W.bodyG] = noiseBand(pink, "lowpass", 650, 0.65);
    // Ett lågpassfiltrerat lager ger vattenljudet mer kropp och tyngd.
    [W.lapF, W.lapG] = noiseBand(brown, "lowpass", 420, 0.8);
    // Det bruna bruset ger ett dovare skvalpande ljud.
    [W.swF, W.swG] = noiseBand(pink, "bandpass", 1100, 3.5);
    lfo(0.35, 520, W.swF.frequency);
    // Här skapar jag ett svepande ljudlager vars filterfrekvens varierar långsamt.
    [W.shF, W.shG] = noiseBand(pink, "highpass", 5200, 0.65);
    lfo(0.28, 0.12, W.shG.gain);
    // Det höga bruslagret kan variera i volym och bidrar med ett skimrande ljud.

    W.subO = ctx.createOscillator();
    W.subO.type = "sine"; W.subO.frequency.value = 46;
    W.subG = gainNode(0);
    W.subO.connect(W.subG); W.subG.connect(sfxBus);
    W.subO.start();
    // Jag skapar en mycket låg sinusoscillator på 46 Hz.
    // Den fungerar som en subbas under vattenljuden. Volymen börjar på noll och styrs senare av updateWater.
  }

  // ---------------- BUBBLOR OCH PLASK ----------------
  function bubble(t, f, amp, tauMul, dest, up) {
    // Jag skapar ett bubblande ljud med en sinusoscillator.
    f = clamp(f, 90, 9000);
    // Jag begränsar frekvensen så att bubblorna håller sig inom ett användbart hörbart område.
    const d = (0.043 * f + 0.0014 * Math.pow(f, 1.5)) / (tauMul || 1), T = 3 / d;
    // d styr hur snabbt ljudet klingar av. tauMul kan förändra avklingningen.
    // T används för att bestämma hur lång tid frekvensförändringen ska ta.
    const o = ctx.createOscillator(), g = ctx.createGain();

    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (up === false ? 0.72 : 1.3), t + T);
    // Jag låter bubblans tonhöjd glida uppåt eller nedåt.
    // Om up är false sjunker frekvensen till 72 procent av startvärdet, annars stiger den till 130 procent.

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + 0.0015);
    g.gain.setTargetAtTime(0.0001, t + 0.0015, 1 / d);
    // Jag formar volymen med ett mycket snabbt anslag och en mjuk avklingning.
    // Det gör att ljudet upplevs som en kort bubbla i stället för en konstant ton.

    o.connect(g); g.connect(dest || wIn);
    o.start(t); o.stop(t + 0.0015 + 6 / d + 0.02);
    // Jag skickar ljudet till den angivna destinationen, eller till vattenljudens standardingång wIn.
    // Oscillatorn stoppas efter att ljudet har klingat av.
  }

  function splat(t, amp, fc, dur) {
    // Den här funktionen skapar ett plask genom att filtrera brus.
    const bp = filt("bandpass", fc, 1.0);
    bp.frequency.setValueAtTime(fc * 1.35, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(100, fc * 0.65), t + dur);
    // Jag börjar med en högre filterfrekvens och sveper nedåt.
    // Det ger plasket en kort, förändrad klang i stället för ett statiskt brus.

    const g = ctx.createGain(), p = panner(rnd(-0.5, 0.5));
    envAD(g, t, amp, 0.002, dur);
    // Jag formar plaskets volym och placerar det slumpmässigt lite åt vänster eller höger.
    noiseSrc(white, t, dur + 0.01).connect(bp);
    bp.connect(g); g.connect(p); p.connect(wIn);
    // Vitt brus går genom bandpassfiltret, volymkontrollen och panoreringen innan det blandas med vattenljuden.
  }

  function waterDrop(t, amp, freq) {
    // Jag skapar ett droppande ljud med en kort ton som sjunker i frekvens.
    const f = clamp(freq, 500, 6500);
    tone(t, f * 1.15, f * 0.78, 0.055, amp, 0.001, 0.075, wIn, 0.14, filt("bandpass", f, 2.0));
    // Tonen börjar lite högre och sjunker snabbt. Bandpassfiltret framhäver ett begränsat frekvensområde.
    // På så sätt får droppen en tydligare och mer vattenliknande klang.
  }

  function jetBubble(t, j, dep, lv) {
    // Den här funktionen skapar bubblor som hör ihop med en vattenstråle.
    const lo = lerp(1100, 300, dep), hi = lerp(6000, 2800, dep);
    // Jag låter frekvensområdet förändras med vattendjupet.
    // När dep ökar flyttas både den lägsta och högsta möjliga frekvensen nedåt.
    const f = lo * Math.pow(hi / lo, Math.pow(Math.random(), 1.4)) * WATER_PITCH;
    // Jag väljer en slumpmässig frekvens inom intervallet. Den exponentiella fördelningen ger fler värden mot den lägre delen.
    const up = !(lv >= 3 && Math.random() < 0.5);
    // På högre nivåer kan bubblorna slumpmässigt gå nedåt i tonhöjd i stället för uppåt.
    bubble(t, f, (0.025 + 0.045 * j) * POUR_VOL * rnd(0.5, 1) * Math.pow(1000 / f, 0.3), 1.8, wIn, up);
    // Jag anpassar bubblans volym efter strålans styrka och frekvens.
  }

  // ---------------- HÄLLNING, NEDSLAG, SKVALP ----------------
  const live = () => ctx && ctx.state === "running";
  // live kontrollerar att AudioContext finns och faktiskt är igång.
  // Jag använder kontrollen innan jag skapar ljud, så att funktionerna inte försöker spela upp ljud när ljudmotorn är pausad.

  function pourStart() {
    // Den här funktionen skapar ett särskilt ljud när användaren börjar hälla.
    if (!live()) return;
    const t = ctx.currentTime + 0.01, bp = filt("bandpass", 480, 1.1);
    // Jag schemalägger ljudet strax efter aktuell ljudtid och skapar ett bandpassfilter.
    bp.frequency.setValueAtTime(480, t);
    bp.frequency.exponentialRampToValueAtTime(1250, t + 0.30);
    // Filterfrekvensen stiger under 0,3 sekunder, vilket ger ljudet en växande karaktär.

    const g = ctx.createGain();
    envAD(g, t, 0.13 * POUR_VOL, 0.09, 0.24);
    // Jag formar volymen så att hälljudet byggs upp och sedan klingar av.
    noiseSrc(pink, t, 0.38).connect(bp);
    bp.connect(g); g.connect(wIn);
    // Rosa brus filtreras och skickas in i vattenljudens ljudkedja.

    const n = 2 + Math.floor(Math.random() * 3);
    let tt = t + 0.10;
    // Jag väljer mellan två och fyra bubblor som ska komma efter att hällningen börjar.
    for (let i = 0; i < n; i++) {
      bubble(tt, rnd(210, 320) * WATER_PITCH, 0.11 * POUR_VOL * (1 - 0.1 * i), 1.1, wIn, true);
      tt += rnd(0.10, 0.17);
      // Jag spelar bubblorna med små slumpmässiga tidsmellanrum och låter deras volym minska något för varje bubbla.
    }
  }

  function pourEnd() {
    // Den här funktionen skapar några avslutande vattendroppar när hällningen upphör.
    if (!live()) return;
    let t = ctx.currentTime + 0.05;
    const n = 4 + Math.floor(Math.random() * 4);
    // Jag väljer mellan fyra och sju droppar för att avslutet ska variera.
    for (let i = 0; i < n; i++) {
      t += 0.10 + i * 0.065 + Math.random() * 0.05;
      waterDrop(t, 0.045 * POUR_VOL * rnd(0.65, 1), rnd(1300, 3200) * WATER_PITCH);
      // Dropparna får olika tidpunkter, volymer och frekvenser.
    }
    bubble(t + 0.12, rnd(260, 340) * WATER_PITCH, 0.075 * POUR_VOL, 1, wIn, true);
    // Jag lägger till en sista bubbla efter dropparna för att ge hällningen ett tydligt avslut.
  }

  function firstHit() {
    // Den här funktionen spelar ljudet när vattenstrålen träffar en yta eller vattenmassa första gången.
    if (!live()) return;
    const t = ctx.currentTime + 0.005;
    if (t - lastFirst < 1) return;
    // Jag begränsar funktionen till högst ett första-nedslag-ljud per sekund.
    lastFirst = t;

    splat(t, 0.34 * POUR_VOL, 1700, 0.16);
    splat(t + 0.018, 0.18 * POUR_VOL, 3900, 0.09);
    tone(t, 135, 58, 0.13, 0.19 * POUR_VOL, 0.002, 0.16, wIn, 0.23); // dov duns
    // Jag kombinerar två plask med en dov ton som sjunker i frekvens.
    // Tillsammans ger de ett tydligare och mer kraftfullt nedslag.

    for (let i = 0; i < 5; i++) {
      const tt = t + 0.035 + i * rnd(0.025, 0.05);
      if (i % 2 === 0) waterDrop(tt, 0.045 * SPLASH_VOL, rnd(1500, 3500));
      else bubble(tt, rnd(900, 2600), 0.035 * POUR_VOL, 1.8, wIn, true);
      // Jag lägger till fem små efterljud och växlar mellan droppar och bubblor.
      // Det gör att nedslaget får en kort svans av vattenljud.
    }
  }

  function slosh(strength, side) {
    // slosh skapar ett skvalpande ljud när vattenmassan rör sig.
    if (!live()) return;
    const t = ctx.currentTime + 0.01;
    if (t - lastSlosh < 0.5) return;
    // Jag begränsar hur ofta skvalpljudet kan spelas, så att det inte blir överdrivet tätt.
    lastSlosh = t;
    const s = clamp(strength === undefined ? 0.5 : strength, 0.1, 1);
    // Om ingen styrka skickas in använder jag 0.5. Annars begränsar jag styrkan till intervallet 0.1–1.

    const bp = filt("bandpass", 260, 1.0);
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(620, t + 0.30);
    bp.frequency.exponentialRampToValueAtTime(280, t + 0.85);
    // Jag låter filtret först stiga i frekvens och sedan sjunka igen.
    // Det skapar en rörelse i ljudet som liknar vatten som skvalpar fram och tillbaka.

    const g = ctx.createGain(), p = panner((side || 0) * 0.6);
    envAD(g, t, 0.20 * s * POOL_VOL, 0.25, 0.70);
    // Volymen påverkas av både den inkommande styrkan och den övergripande poolvolymen.
    // side styr om ljudet placeras mer åt vänster eller höger.
    noiseSrc(pink, t, 0.95).connect(bp);
    bp.connect(g); g.connect(p); p.connect(wIn);

    bubble(t + 0.13, rnd(380, 700) * WATER_PITCH, 0.045 * s * POOL_VOL, 1.4, wIn, true);
    bubble(t + 0.31, rnd(500, 1100) * WATER_PITCH, 0.035 * s * POOL_VOL, 1.6, wIn, true);
    // Jag lägger till två bubblor efter huvudljudet för att göra skvalpet mer levande.
  }

  // ---------------- UPPDATERA VATTEN ----------------
  function updateWater(o, dt, t) {
    // Funktionen körs löpande och anpassar vattenljuden efter informationen från vattenvärlden.
    // o innehåller aktuella värden för exempelvis flöde, droppar, regn och vattenvolym.
    const lv = clamp(o.lvl | 0, 0, 5), a = tau => 1 - Math.exp(-dt / tau);
    // Jag begränsar nivån till 0–5. | 0 gör om värdet till ett heltal.
    // a räknar ut en utjämningsfaktor utifrån tidssteget dt och en tidskonstant tau.
    const set = (param, v, tc) => param.setTargetAtTime(v, t, tc);
    // set ändrar ett ljudvärde mjukt mot ett nytt målvärde i stället för att ändra det tvärt.
    const fl = clamp(o.flow || 0, 0, 1), vol = clamp(o.vol || 0, 0, 1);
    // Jag hämtar flöde och volym från objektet och begränsar dem till intervallet 0–1.

    flow += (fl - flow) * a(fl > flow ? 0.05 : 0.3);
    jetRate += ((o.jet || 0) / dt - jetRate) * a(0.1);
    dropRate += ((o.drops || 0) / dt - dropRate) * a(0.15);
    rainRate += ((o.rain || 0) / dt - rainRate) * a(0.15);
    depth += (vol - depth) * a(0.5);
    // Jag jämnar ut inkommande värden över tid så att ljuden inte reagerar ryckigt på små förändringar.
    // Flödet reagerar snabbare när det ökar än när det minskar.
    // För jet, drops och rain räknar jag om antal händelser per bildruta till en takt per sekund genom att dividera med dt.
    // depth följer vattenvolymen långsammare och används för att ändra ljudens karaktär.

    const has = !!o.has;
    const j = clamp(jetRate / 600, 0, 1.2), dr = clamp(dropRate / 8000, 0, 1), rr = clamp(rainRate / 200, 0, 1);
    const pool = has ? Math.sqrt(vol) : 0, tc = 0.08;
    // has omvandlas till ett booleskt värde som visar om det finns vatten.
    // j, dr och rr normaliserar händelsetakterna till värden som går att använda för ljudstyrning.
    // pool beskriver vattenmängden och blir noll om det inte finns någon vattenyta.
    // tc är en tidskonstant som används när jag ändrar flera ljudparametrar.

    if (flow > 0.2) wasPouring = true;
    else if (wasPouring && flow < 0.03 && fl === 0) { wasPouring = false; pourEnd(); }
    // Om flödet blir tillräckligt stort markerar jag att användaren häller.
    // När flödet sedan har upphört spelar jag upp avslutningsljudet en gång.

    set(W.airG.gain, 0.035 * POUR_VOL * Math.pow(flow, 0.8), tc);
    set(W.rushF.frequency, lerp(2500, 1450, depth) * WATER_PITCH, tc);
    set(W.rushG.gain, 0.20 * POUR_VOL * Math.pow(j, 0.85), tc);
    set(W.bodyF.frequency, lerp(760, 390, depth) * WATER_PITCH, tc);
    set(W.bodyG.gain, 0.27 * POUR_VOL * Math.pow(j, 0.9) * (has ? 0.25 + 0.75 * depth : 0), tc);
    set(W.lapF.frequency, (210 + 150 * pool) * WATER_PITCH, 0.3);
    set(W.lapG.gain, 0.23 * POOL_VOL * pool * (1 + 0.12 * lv), 0.3);
    // Här styr jag de olika bruslagrens frekvenser och volymer.
    // Exempelvis blir luftljudet starkare när flödet ökar, medan kroppsljudet påverkas av vattenstrålans styrka och vattenvolymen.
    // pool påverkar det dovare skvalpljudet och lv kan förstärka det på högre nivåer.

    set(W.wobDepth.gain, lv >= 2 ? 420 : 0, 0.3);
    if (waterPan.pan) set(waterPan.pan, lv >= 2 ? 0.22 : 0, 0.4);
    set(panDepth.gain, lv >= 4 ? (lv === 5 ? 0.75 : 0.50) : 0, 0.4);
    set(panLfo.frequency, lv === 5 ? 1.1 : 0.5, 0.4);
    // På högre nivåer aktiverar jag mer modulation och stereorörelse.
    // Det gör vattenljuden mer dynamiska när upplevelsen blir intensivare.
    set(W.shG.gain, lv >= 3 ? 0.055 * clamp(j + pool * 0.5, 0, 1) : 0, 0.3);
    set(W.swG.gain, lv >= 4 ? (lv === 5 ? 0.12 : 0.08) * clamp(j * 0.8 + rr + pool * 0.4, 0, 1) : 0, 0.3);
    set(W.subG.gain, lv === 5 ? 0.12 * clamp(j + pool * 0.3, 0, 1) : 0, 0.5);
    // De högre ljudlagren aktiveras först på nivå 3 och 4.
    // Subbasen används bara på nivå 5, vilket gör att den högsta nivån får extra tyngd.
    set(sfxDuck.gain, 1 - clamp(flow * 0.8 + j * 0.4, 0, 1) * MUSIC_DUCK, 0.2); // musiken viker för vattnet
    // När vattenflödet och strålen blir starkare sänker jag musikens volym.
    // Detta gör att vattenljuden får mer utrymme och inte konkurrerar lika mycket med musiken.

    // Vattenhändelser (begränsat antal per bildruta)
    let budget = dt > 0.03 ? 2 : 3;
    // Jag begränsar hur många ljudhändelser som får skapas under en uppdatering.
    // Om en bildruta tar längre tid tillåter jag färre händelser för att minska belastningen.

    if (has) {
      bubAcc += 42 * j * dt;
      // bubAcc samlar på sig hur många bubblor som borde skapas utifrån strålans styrka och tiden som gått.
      while (bubAcc >= 1) {
        bubAcc--;
        if (budget-- > 0) jetBubble(t + Math.random() * dt, j, depth, lv);
        // När accumulatorn når minst ett skapar jag en bubbla och minskar budgeten.
        // Tidpunkten slumpas inom den aktuella uppdateringen för att ljuden inte ska komma i helt jämna intervall.
      }
    } else bubAcc = 0;
    // Om det inte finns vatten återställer jag bubbelräknaren.

    splatAcc += 13 * Math.pow(j, 0.9) * dt;
    let splashBudget = 2;
    while (splatAcc >= 1) {
      splatAcc--;
      if (splashBudget-- > 0) {
        const fc = rnd(1500, 3800) * WATER_PITCH * (has ? 1 - 0.30 * depth : 1.15);
        splat(t + Math.random() * dt, (0.075 + 0.12 * j) * POUR_VOL * rnd(0.5, 1), fc, rnd(0.025, 0.065));
        // Jag skapar plask med varierande filterfrekvens, volym och längd.
        // splashBudget begränsar antalet plask som kan skapas under en uppdatering.
      }
    }

    plipAcc += (30 * Math.pow(dr, 0.8) + 22 * rr) * dt;
    while (plipAcc >= 1) {
      plipAcc--;
      if (budget-- > 0) {
        const tt = t + Math.random() * dt;
        if (has) waterDrop(tt, (0.025 + 0.035 * Math.max(dr, rr)) * SPLASH_VOL, rnd(1300, 3800) * WATER_PITCH * (1 - 0.2 * depth));
        else splat(tt, 0.065 * SPLASH_VOL, rnd(2800, 5200), 0.018);
        // Om det finns vatten spelar jag droppar. Annars använder jag korta plask.
        // Jag låter både droppfrekvensen och regnintensiteten påverka hur ofta ljuden skapas.
      }
    }

    if (pool > 0.01) {
      lapAcc += (0.45 + 1.6 * pool) * dt;
      while (lapAcc >= 1) {
        lapAcc--;
        if (budget-- > 0) bubble(t + Math.random() * dt, rnd(420, 1350) * WATER_PITCH, 0.025 * POOL_VOL * pool, 1.6, wIn, true);
        // När det finns en tillräckligt stor vattenvolym skapar jag extra bubblor som ger en känsla av rörelse i vattenytan.
      }
    } else lapAcc = 0;
    // Om vattenvolymen är för liten återställer jag accumulatorn för skvalpbubblor.
  }

  // ---------------- AQUATIC RAVE-MUSIK ----------------
  function buildMusic() {
    // Här bygger jag upp musikens olika ljudlager och kopplar dem till musikbussen.
    [busPad, busShimmer, busPulse, busArp, busSub, busBeat, busPerc, busBass, busHat] =
      Array.from({ length: 9 }, () => gainNode(0));
    // Jag skapar nio gain-bussar med startvolym noll.
    [busPad, busShimmer, busPulse, busArp, busSub, busBeat, busPerc, busBass, busHat].forEach(b => b.connect(musicBus));
    // Alla bussar kopplas till musikens gemensamma buss, vilket gör att jag kan styra varje lager separat.

    musicDelay = ctx.createDelay(1.5);
    musicDelay.delayTime.value = 0.32;
    const fb = gainNode(0.30), dOut = gainNode(0.19), dFilt = filt("lowpass", 2400, 0.6);
    musicDelay.connect(fb); fb.connect(musicDelay);
    musicDelay.connect(dOut); dOut.connect(dFilt); dFilt.connect(musicBus);
    // Jag skapar en delay-effekt med 0,32 sekunders fördröjning.
    // fb skickar tillbaka en del av signalen till delayen och skapar upprepade ekon.
    // dOut och dFilt styr hur mycket av ekot som kommer tillbaka till musiken och filtrerar bort de högsta frekvenserna.

    // Mörk, mjuk pad: fem röster, tre lätt detunerade sinusar vardera
    padFilter = filt("lowpass", 420, 0.9);
    padFilter.connect(busPad);
    lfo(0.035, 180, padFilter.frequency);
    // Pad-ljudet är ett mjukt, långvarigt ackordslager.
    // Lågpassfiltret gör ljudet mörkare och LFO:n förändrar filterfrekvensen mycket långsamt.

    for (let i = 0; i < 5; i++) {
      const gain = gainNode(0.06);
      gain.connect(padFilter);
      const oscillators = [-7, 0, 7].map(detune => {
        // Jag skapar fem röster, en för varje ton i pad-ackordet.
        // Varje röst består av tre oscillatorer som är lite olika stämda.
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.detune.value = detune;
        osc.frequency.value = mtof(AQUA_PROG[0].pad[i]);
        // Jag omvandlar MIDI-tonen till hertz och ställer in oscillatorns frekvens.
        osc.connect(gain); osc.start();
        return osc;
      });
      padVoices.push({ oscillators, gain });
      // Jag sparar oscillatorerna och deras gemensamma gain-nod så att ackorden kan ändras senare.
    }

    padSub = ctx.createOscillator();
    padSub.type = "sine";
    padSub.frequency.value = mtof(AQUA_PROG[0].root);
    const subFilter = filt("lowpass", 120, 0.8);
    padSub.connect(subFilter); subFilter.connect(busSub);
    padSub.start();
    // Jag skapar en separat låg grundton som följer ackordets root.
    // Den går genom ett lågpassfilter så att bara de lägsta frekvenserna hörs tydligt.

    shimmerFilter = filt("lowpass", 2800, 0.8);
    shimmerFilter.connect(busShimmer);
    // Detta filter används för de ljusa, skimrande tonerna.

    // Låg, rund puls = rörelse under vatten
    const pulseOsc = ctx.createOscillator(), pulseGain = gainNode(0);
    pulseOsc.type = "sine"; pulseOsc.frequency.value = 55;
    pulseOsc.connect(pulseGain); pulseGain.connect(busPulse);
    pulseOsc.start();
    W.musicPulseGain = pulseGain;
    // Jag skapar en låg sinus som ger musiken en mjuk puls.
    // Gain börjar på noll och sparas i W så att nivån kan justeras senare.

    busShimmer.connect(musicDelay);
    busArp.connect(musicDelay);
    // Jag skickar de skimrande tonerna och arpeggiot genom delay-effekten.
    // Det ger dessa ljud mer rymd och gör att de kan klinga vidare efter varje ton.
  }

  function setAquaChord(index, t, immediate) {
    // Funktionen byter ackord i musiken.
    const chord = AQUA_PROG[index];
    // Jag hämtar ackordet som motsvarar det valda indexet i harmoniföljden.
    padVoices.forEach((v, i) => v.oscillators.forEach(osc => {
      if (immediate) osc.frequency.setValueAtTime(mtof(chord.pad[i]), t);
      else osc.frequency.setTargetAtTime(mtof(chord.pad[i]), t, 1.2);
      // Om immediate är true byter jag frekvens direkt vid den angivna tiden.
      // Annars glider tonen mjukt över till den nya frekvensen.
    }));
    padSub.frequency.setTargetAtTime(mtof(chord.root), t, 2.0);
    // Subbasen följer ackordets grundton med en ännu långsammare övergång.
    musicChord = index;
    // Jag sparar vilket ackord som nu är aktivt för att undvika onödiga byten.
  }

  function applyAquaLevel(level, t, fast) {
    // Här applicerar jag inställningarna för en viss musiknivå.
    const L = AQUA_LEVELS[level], tc = fast ? 0.2 : 1.0;
    // Jag hämtar nivåns inställningar. tc bestämmer hur snabbt förändringarna ska ske.
    [[busPad, "pad"], [busShimmer, "shimmer"], [busPulse, "pulse"], [busSub, "sub"],
     [busBeat, "beat"], [busPerc, "perc"], [busBass, "bass"], [busHat, "hat"]]
      .forEach(([bus, k]) => bus.gain.setTargetAtTime(L[k], t, tc));
    // Jag går igenom musikens bussar och ställer in respektive volym från nivåobjektet.
    padFilter.frequency.setTargetAtTime(L.cut, t, tc);
    // Jag ändrar även pad-filtrets frekvens. Högre nivåer får ett öppnare och ljusare ljud.
    if (W.musicPulseGain) W.musicPulseGain.gain.setTargetAtTime(L.pulse * 0.55, t, tc);
    // Om pulsens gain-nod finns justerar jag även den. Jag använder en reducerad del av nivåns pulse-värde.
  }

  // ---------------- MELODI OCH VATTENTONER ----------------
  function aquaDrop(t, midi, amount) {
    // Jag skapar en kort meloditon som har en vattenliknande klang.
    const f = mtof(midi);
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator(), g = ctx.createGain(), g2 = gainNode(0.18);
    // Jag använder två oscillatorer: en grundton och en andra ton som ligger ungefär en oktav över.

    osc.type = "sine";
    osc.frequency.setValueAtTime(f * 0.96, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    // Grundtonen glider snabbt upp till sin slutliga frekvens.
    osc2.type = "sine";
    osc2.frequency.value = f * 2.01;
    // Den andra oscillatorn ligger strax över dubbla grundfrekvensen och tillför en ljus överton.

    envAD(g, t, amount, 0.008, 0.842);
    osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(busArp);
    // Jag blandar ihop oscillatorerna och skickar dem till arpeggio-bussen.
    osc.start(t); osc2.start(t);
    osc.stop(t + 0.95); osc2.stop(t + 0.65);
    // Jag stoppar oscillatorerna efter deras respektive speltider.
  }

  function aquaShimmer(t, midi, amount) {
    // Jag skapar en ljus ton genom att använda tone-funktionen med en frekvens som är dubbelt så hög som MIDI-tonen.
    tone(t, mtof(midi) * 2, 0, 0, amount, 0.08, 1.42, shimmerFilter, 1.6);
    // Ljudet får ett långsammare anslag och en relativt lång avklingning, vilket ger en skimrande effekt.
  }

  // ---------------- TRUMMOR OCH BAS ----------------
  function aquaKick(t, amount) {
    // Jag bygger kicken av två toner: en dov ton som faller i frekvens och ett kortare anslag.
    tone(t, 145, 42, 0.19, amount * 0.95, 0.004, 0.356, busBeat, 0.38);
    tone(t, 1100, 280, 0.025, amount * 0.10, 0.001, 0.029, busBeat, 0.035); // kort tonal attack i stället för brus
    // Den första tonen ger kicken dess låga tyngd. Den andra ger ett kort anslag så att slaget blir tydligare.
  }

  // Tonal, bubblig clap: tre korta resonanser
  function aquaClap(t, amount) {
    [420, 630, 840].forEach((freq, i) => {
      const s = t + i * 0.012;
      tone(s, freq * 1.2, freq, 0.045, amount * (0.20 / (i + 1)), 0.002, 0.108, busPerc, 0.12);
      // Jag skapar tre korta toner med olika frekvenser och fördröjer dem lite i förhållande till varandra.
      // Volymen minskar för varje ton. Tillsammans bildar de ett clap-liknande ljud.
    });
  }

  // Mjuk undervattenshat av tre höga sinusresonanser
  function aquaHat(t, amount, open) {
    const dur = open ? 0.18 : 0.045;
    // En öppen hi-hat får längre varaktighet än en stängd.
    (open ? [4200, 5600, 6800] : [5200, 6400, 7600]).forEach((freq, i) =>
      tone(t, freq * (1 + i * 0.015), 0, 0, amount * (open ? 0.055 : 0.035) / (i + 1), 0.002, dur - 0.002, busHat, dur + 0.01));
    // Jag blandar tre höga sinusfrekvenser för att skapa ett mjukt, syntetiskt hi-hat-ljud.
    // De olika frekvenserna och volymerna ger ljudet lite bredd.
  }

  // Kort filtrerad svepning = bubbligt slag
  function aquaPerc(t, amount) {
    const bp = filt("bandpass", rnd(900, 1800), 2.5);
    // Jag väljer en slumpmässig filterfrekvens för att variera percussion-ljudet.
    tone(t, rnd(900, 1500), rnd(250, 500), 0.075, amount * 0.45, 0.002, 0.088, busPerc, 0.10, bp);
    // Jag skapar en kort ton som sveper nedåt och filtreras för att få ett bubbligt slag.
    if (Math.random() < 0.45) bubble(t + 0.008, rnd(700, 1500), amount * 0.07, 1.8, busPerc, true);
    // I 45 procent av fallen lägger jag till en bubbla direkt efter slaget.
  }

  function aquaBass(t, midi, amount, duration) {
    // Jag skapar basgångens toner med en triangeloscillator.
    const osc = ctx.createOscillator(), g = ctx.createGain(), lp = filt("lowpass", 220, 0.85);
    osc.type = "triangle";
    osc.frequency.setValueAtTime(mtof(midi), t);
    // Jag omvandlar MIDI-tonen till frekvens och ställer in oscillatorn.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amount * 0.72, t + 0.012);
    g.gain.setTargetAtTime(0.0001, t + 0.06, duration || 0.16);
    // Jag ger basnoten ett snabbt anslag och låter sedan volymen klinga av.
    // duration kan styra avklingningen, annars används 0.16 sekunder.
    osc.connect(lp); lp.connect(g); g.connect(busBass);
    // Basen går genom ett lågpassfilter innan den skickas till basbussen.
    osc.start(t); osc.stop(t + 0.65);
  }

  function aquaPulse(t, amount) {
    // En extra låg ton som fungerar som en mjuk puls i musiken.
    tone(t, 95, 48, 0.25, amount * 0.55, 0.025, 0.395, busPulse, 0.45);
    // Frekvensen sjunker från 95 till 48 Hz, vilket skapar en dov pulserande rörelse.
  }

  // ---------------- SCHEMALÄGGNING ----------------
  function scheduleAquaStep(step, t) {
    // Den här funktionen bestämmer vilka musikljud som ska spelas på ett visst musiksteg.
    const s = step % 16, quarter = s % 4 === 0, eighth = s % 2 === 0; // 16 steg per takt
    // Jag räknar om det totala steget till ett steg inom en takt med 16 steg.
    // quarter är true på varje fjärde steg och eighth på vartannat steg.

    // Nivåbyten sker på taktgräns
    if (s === 0 && musicPendingLevel !== null) {
      musicLevel = musicPendingLevel;
      musicPendingLevel = null;
      applyAquaLevel(musicLevel, t, false);
      // Jag genomför ett väntande nivåbyte när en ny takt börjar.
      // På så sätt ändras inte musikens intensitet mitt i en takt.
    }
    const L = AQUA_LEVELS[musicLevel];
    // Jag hämtar inställningarna för den nivå som spelas just nu.

    // Samma schemalagda slag driver neonljusen utan timer-drift
    visualStep = s;
    if (quarter && musicLevel >= 1) { visualKickAt = t; visualKickAmp = L.beat; visualBeatSide = Math.floor(step / 4) % 2; }
    if (musicLevel >= 2 && (eighth || s === 6 || s === 14)) { visualHatAt = t; visualHatAmp = L.hat; }
    // När ett kick- eller hi-hat-slag schemaläggs sparar jag dess tid och styrka.
    // Neonljusen kan läsa dessa värden och skapa ljusreaktioner som följer exakt samma musikslag.
    // visualBeatSide växlar mellan två lägen och kan användas för att variera vilken sida som reagerar.

    // Ackord byts varannan takt
    const chordIndex = Math.floor(step / 32) % AQUA_PROG.length;
    if (chordIndex !== musicChord) setAquaChord(chordIndex, t, false);
    const chord = AQUA_PROG[chordIndex];
    // 32 sextondelssteg motsvarar två takter. Därför byter jag ackord varannan takt.
    // Jag hämtar sedan ackordets toner för att använda dem i bas och melodi.

    if (musicLevel >= 1) { // tydlig 4/4-kick, puls, subbas, bubblor
      if (quarter) aquaKick(t, L.beat);
      // På nivå 1 och uppåt spelar jag en kick på varje fjärdedelsslag.
      if (s % 8 === 0) { aquaPulse(t, L.pulse); aquaBass(t, chord.bass - 12, L.bass * 0.65, 0.24); }
      // Jag lägger in puls och en låg basnot med jämna mellanrum.
      if (s % 8 === 6) bubble(t, rnd(240, 420), 0.025 + L.density * 0.035, 1.7, busPerc, true);
      // En liten bubbla fungerar som extra rytmisk detalj.
      if (Math.random() < L.density * 0.12) aquaDrop(t, pick(chord.notes) + 12, 0.012 + L.shimmer * 0.12);
      // Jag lägger ibland till en slumpmässig meloditon. Sannolikheten ökar med nivåns density.
    }

    if (musicLevel >= 2) { // hats, clap, basgång
      if (eighth && s !== 0) aquaHat(t, L.hat, false);
      // Jag lägger in stängda hi-hats på åttondelspositioner, förutom på taktens första steg.
      if (s % 8 === 4) { aquaClap(t, L.perc); aquaPerc(t, L.perc * 0.65); }
      // Clap och percussion kommer på återkommande slag i takten.
      if (quarter) aquaBass(t, s >= 8 ? chord.bass + 7 : chord.bass, L.bass, 0.16);
      // Basgången följer ackordet och byter ton beroende på var i takten vi befinner oss.
      if (s % 8 === 7) aquaPerc(t, L.perc * 0.55);
      // Jag lägger till ett extra percussion-slag nära slutet av varje halvtakt.
    }

    if (musicLevel >= 3) { // tätare hats, arpeggio
      if (s % 4 === 2) aquaHat(t, L.hat * 1.1, false);
      // Jag ökar tätheten av hi-hats.
      if (eighth) aquaDrop(t, chord.notes[AQUA_PATTERN[s] % chord.notes.length] + 12, L.shimmer * 0.75 + L.bass * 0.08);
      // Jag spelar toner från ackordet enligt AQUA_PATTERN, vilket skapar ett återkommande arpeggio.
      if (s % 8 === 7) aquaPerc(t, L.perc * 0.75);
      // Ytterligare percussion gör rytmen tätare.
    }

    if (musicLevel >= 4) { // offbeat- och öppna hats
      if (s % 4 === 2) aquaHat(t, L.hat * 1.25, false);
      if (s % 8 === 6) aquaHat(t, L.hat, true);
      // Jag förstärker hi-hatsen och lägger till öppna hats för att ge musiken mer rave-känsla.
      if (s % 8 === 3) aquaPerc(t, L.perc * 0.75);
      if (s === 8) aquaBass(t, chord.bass + 12, L.bass * 0.65, 0.12);
      // En extra högre basnot ger variation i basgången.
      if (s % 8 === 5) aquaShimmer(t, pick(chord.notes) + 24, L.shimmer * 0.55);
      // Jag lägger till ljusa toner två oktaver över ackordets toner.
    }

    if (musicLevel >= 5) { // full rave: extra hats, percussion, bas, fills
      if (s % 2 === 1 && Math.random() < 0.72) aquaHat(t, L.hat * 0.72, false);
      // På högsta nivån kan extra hi-hats komma på udda steg.
      if (s % 8 === 7) aquaPerc(t, L.perc * 1.15);
      if (s % 8 === 6) aquaBass(t, chord.bass + 7, L.bass * 0.75, 0.10);
      // Jag lägger till extra percussion och basnoter för att göra rytmen mer intensiv.
      if ((s === 11 || s === 15) && Math.random() < 0.8) aquaDrop(t, pick(chord.notes) + 24, L.shimmer * 0.9);
      // Mot slutet av vissa taktdelar kan en hög meloditon läggas in som ett fill.
      if (s === 15 && Math.random() < 0.35) aquaKick(t, L.beat * 0.55);
      // Ibland kommer även en extra kick precis före nästa takt.
    }
  }

  function aquaScheduler() {
    // Schemaläggaren ser till att musikens kommande steg skapas i god tid.
    if (!live()) return;
    const now = ctx.currentTime;
    while (musicNextTime < now + 0.30) {
      // Jag schemalägger ljud 0,3 sekunder framåt. Det ger webbläsaren tid att förbereda ljuden.
      if (musicNextTime >= now - 0.05) scheduleAquaStep(musicStep, musicNextTime);
      // Jag schemalägger bara steg som inte redan ligger för långt tillbaka i tiden.
      musicNextTime += STEP;
      musicStep++;
      // Jag flyttar tiden framåt ett sextondelssteg och ökar stegräknaren.
    }
  }

  // Ny nivå väntar till nästa taktgräns
  function setLevel(n) {
    // Funktionen tar emot önskad musiknivå och ser till att bytet sker vid en taktgräns.
    n = clamp(Math.round(Number(n) || 0), 0, 5);
    // Jag omvandlar värdet till ett tal, avrundar det och begränsar det till nivåerna 0–5.
    if (n === (musicPendingLevel !== null ? musicPendingLevel : musicLevel)) return;
    // Om den begärda nivån redan är aktiv eller redan väntar på att aktiveras gör jag inget.
    musicPendingLevel = n === musicLevel ? null : n;
    // Om den nya nivån är samma som den nuvarande tar jag bort ett väntande nivåbyte.
    // Annars sparar jag den nya nivån som väntande.
  }

  // ---------------- OFFENTLIGT API ----------------
  function start(level) {
    // start är en av funktionerna som resten av projektet kan anropa för att starta ljudsystemet.
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      // Om ljudsystemet redan finns men är pausat försöker jag återuppta det.
      if (level !== undefined) setLevel(level);
      // Om start anropas med en nivå skickar jag den vidare till setLevel.
      return true;
      // Jag returnerar true eftersom ljudsystemet redan har skapats.
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Jag hämtar webbläsarens AudioContext-konstruktor.
    // webkitAudioContext fungerar som reserv för äldre webbläsarvarianter.
    // Om inget av alternativen finns kan ljudsystemet inte startas.

    ctx = new AC({ latencyHint: "interactive" });
    build();
    // Jag skapar ljudmotorn med inställningen interactive för att prioritera låg fördröjning.
    // Därefter bygger jag alla ljudnoder och kopplingar.

    musicStep = 0;
    musicNextTime = ctx.currentTime + 0.15;
    visualKickAt = visualHatAt = -10;
    visualKickAmp = visualHatAmp = 0;
    visualBeatSide = visualStep = 0;
    musicLevel = clamp(Math.round(Number(level) || 0), 0, 5);
    musicPendingLevel = null;
    musicChord = -1;
    // Jag återställer musikens räknare och visuella signaler inför starten.
    // Den första musiknivån bestäms av argumentet level och begränsas till 0–5.
    // musicChord sätts till -1 så att det första ackordet säkert appliceras.

    setAquaChord(0, ctx.currentTime, true);
    applyAquaLevel(musicLevel, ctx.currentTime, true);
    // Jag ställer in det första ackordet direkt och applicerar nivåns ljudinställningar.
    musicTimer = setInterval(aquaScheduler, 25);
    // Schemaläggaren körs var 25:e millisekund och ser till att musikstegen planeras i förväg.
    document.addEventListener("visibilitychange", () => { if (ctx && !document.hidden) ctx.resume(); });
    // När användaren kommer tillbaka till fliken försöker jag återuppta ljudmotorn om den har pausats.
    ctx.resume();
    fadeIn(2.2);
    // Jag startar ljudmotorn och tonar in huvudvolymen under 2,2 sekunder.
    return true;
    // true visar att ljudsystemet har startats.
  }

  // Beat/hat-styrka (avtar exponentiellt) och nivå/steg till neonljusen
  function getVisualState() {
    // Den här funktionen lämnar tillbaka musikens aktuella rytmiska information till den visuella delen av projektet.
    if (!live()) return { beat: 0, hat: 0, level: musicLevel, side: visualBeatSide, step: visualStep };
    // Om ljudmotorn inte är igång returnerar jag noll för beat och hat, men behåller nivå och steginformation.
    const now = ctx.currentTime, kickAge = Math.max(0, now - visualKickAt), hatAge = Math.max(0, now - visualHatAt);
    // Jag räknar ut hur lång tid som har gått sedan senaste kick respektive hi-hat.
    return {
      beat: kickAge < 0.8 ? visualKickAmp * Math.exp(-kickAge * 13) : 0,
      hat: hatAge < 0.25 ? visualHatAmp * Math.exp(-hatAge * 34) : 0,
      level: musicLevel, side: visualBeatSide, step: visualStep,
      // Jag låter styrkan avta exponentiellt efter varje slag.
      // Kick-signalen får klinga av under högst 0,8 sekunder och hi-hat-signalen under högst 0,25 sekunder.
      // Resultatet kan användas av neonljusen för att skapa en ljuspuls som följer musiken.
    };
  }

  // o = { dt, flow, jet, drops, rain, vol, front, has, lvl, music }
  function update(o) {
    // update är den huvudsakliga uppdateringsfunktionen som resten av vattenvärlden kan anropa löpande.
    // Objektet o innehåller information om vattenrörelsen och önskad musiknivå.
    if (!live()) return;
    // Jag gör inget om ljudmotorn inte är igång.
    setLevel(o.music === undefined ? (o.lvl || 0) : o.music);
    // Om music har angetts använder jag det som musiknivå. Annars använder jag lvl, eller noll om det saknas.
    updateWater(o, clamp(o.dt || 0.016, 0.001, 0.05), ctx.currentTime);
    // Jag skickar vidare vatteninformationen till updateWater.
    // dt begränsas till ett rimligt intervall för att undvika alltför stora förändringar mellan uppdateringarna.
  }

  const masterTarget = () => muted ? 0.0001 : Math.max(0.0001, (1 - fade) * MASTER_VOL);
  const applyMaster = () => { if (ctx) master.gain.setTargetAtTime(masterTarget(), ctx.currentTime, 0.05); };
  // masterTarget räknar ut vilken huvudvolym som ska gälla utifrån mute och fade.
  // applyMaster skickar in den volymen till master-gain-noden med en kort mjuk övergång.

  function setFade(a) { fade = clamp(a, 0, 1); applyMaster(); }
  // setFade låter annan kod styra hur mycket ljudet ska tonas ned.
  // 0 betyder full volym och 1 betyder i princip tystnad, om ljudet inte är mutat.

  function fadeIn(sec) {
    // Den här funktionen tonar in ljudet under den tid som skickas in.
    fade = 0;
    if (!ctx) return;
    // Jag avslutar om ljudmotorn inte har skapats.
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    // Jag tar bort tidigare schemalagda volymförändringar så att de inte krockar med den nya övertoningen.
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(muted ? 0.0001 : MASTER_VOL, t + Math.max(0.05, sec));
    // Jag börjar nästan på noll och ökar volymen linjärt till huvudvolymen.
    // Om ljudet är mutat stannar volymen på nästan noll. Jag använder minst 0,05 sekunder som övergångstid.
  }

  function reset() {
    // reset återställer vattenljudens och musikens interna tillstånd.
    flow = jetRate = dropRate = rainRate = depth = 0;
    wasPouring = false;
    bubAcc = splatAcc = plipAcc = lapAcc = 0;
    // Jag nollställer flöden, räknare och markeringen för om en hällning pågår.
    if (!ctx) return;
    // Om ljudmotorn inte finns behöver jag inte göra några fler ljudinställningar.
    musicLevel = 0;
    musicPendingLevel = null;
    visualKickAmp = visualHatAmp = 0;
    visualKickAt = visualHatAt = -10;
    visualBeatSide = visualStep = 0;
    // Jag återställer musiknivån och de visuella beat-signalerna.
    applyAquaLevel(0, ctx.currentTime, true);
    // Jag ställer tillbaka musikens ljudlager till nivå 0.
  }

  return {
    start, update, pourStart, firstHit, slosh, setLevel, getVisualState, setFade, fadeIn, reset,
    get muted() { return muted; },
    // Här exponerar jag funktionerna som resten av projektet får använda.
    // Jag exponerar även muted som en getter, så att annan kod kan läsa om ljudet är avstängt utan att ändra värdet direkt.
  };
})();