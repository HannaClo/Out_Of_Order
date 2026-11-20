
// environment.js – neonhall + ljusshow. Bakgrunden cachas; allt ljus är additivt och ritas BAKOM skuggan.
// Nivå 1 andning | 2 två strålkastare | 3 fler strålar + golvpuls | 4 färgbyten + diskret blixt | 5 kaos + glitch
// Strålarna siktar mot skuggan. fx.normal ("glimt av normalitet") dämpar ljuset.
// Takt: audio.kickEnv(), annars intern klocka

// Den här hjälpfunktionen bygger en CSS-färgsträng i rgba-format.
// Jag skickar in en färg som en array med rött, grönt och blått samt en genomskinlighet.
// Det gör att jag kan skapa färger som kan vara helt synliga eller delvis genomskinliga.
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Den här funktionen skapar en färgövergång från den angivna färgen till helt transparent.
// g är en gradient, c är färgen och a är startens genomskinlighet.
// addColorStop bestämmer hur färgen förändras längs gradienten.
// Jag returnerar gradienten så att den kan användas direkt när jag ritar ljuseffekterna.
const fade = (g, c, a) => { g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0)); return g; }; // färg a -> transparent

// Jag samlar miljöns funktioner i en klass så att bakgrund, ljus och effekter kan hanteras tillsammans.
class Environment {
  // Konstruktorn körs när jag skapar ett nytt Environment-objekt.
  // cfg innehåller projektets inställningar och img är bakgrundsbilden.
  constructor(cfg, img) {
    this.cfg = cfg; this.img = img; this.audio = null;
    // Jag sparar inställningarna och bilden i objektet.
    // audio börjar som null eftersom ljudobjektet inte har kopplats in ännu.

    // Object.assign skapar ett objekt med standardvärden och skriver sedan över dem
    // med de miljöinställningar som finns i cfg.env.
    // På så sätt finns det reservvärden om någon inställning saknas.
    this.e = Object.assign({ bpm: 124, rimPink: [255, 40, 200], rimBlue: [40, 130, 255], strobe: 0.06 }, cfg.env);

    // Här skapar jag startvärden för bakgrundens cache och storlek.
    // cache kommer senare att innehålla den färdigrenderade bakgrunden.
    // w och h sparar storleken så att jag kan upptäcka om fönstrets eller canvasens storlek ändras.
    // floorLine sparar golvets position och glitch håller reda på en eventuell pågående glitch-effekt.
    this.cache = null; this.w = 0; this.h = 0; this.floorLine = 0; this.glitch = null;
  }

  // Cachar bakgrund (bild "cover" eller enfärgad) + vinjett
  // Jag bygger bakgrunden en gång och sparar resultatet i cache.
  // Det är effektivare än att rita upp hela bakgrunden från början varje bildruta.
  build() {
    // Jag hämtar aktuell bredd och höjd från canvasen.
    // Om storleken ändras kan jag senare bygga om bakgrunden så att den passar.
    this.w = width; this.h = height; this.floorLine = 0;

    // createGraphics skapar en separat grafikyta som jag kan rita bakgrunden på.
    // pixelDensity(1) gör att grafikytan använder en pixel per bildpunkt,
    // vilket ger en mer förutsägbar storlek när jag arbetar med bildens koordinater.
    const g = createGraphics(width, height); g.pixelDensity(1);

    // Jag kontrollerar att det finns en bild och att den har en giltig bredd.
    if (this.img && this.img.width > 0) {

      // Jag räknar ut vilken skalfaktor som krävs för att bilden ska täcka hela canvasen.
      // Math.max gör att bilden alltid täcker både bredden och höjden,
      // även om det innebär att delar av bilden beskärs.
      const s = Math.max(width / this.img.width, height / this.img.height), w = this.img.width * s, h = this.img.height * s,

            // Här räknar jag ut bildens vertikala förskjutning.
            // anchorY bestämmer vilken del av bilden som prioriteras vid beskärningen.
            oy = (height - h) * (this.e.anchorY ?? 0.5);

      // Jag ritar bilden centrerad i sidled och med den beräknade skalan.
      g.image(this.img, (width - w) / 2, oy, w, h);

      // Om floorY finns räknar jag ut var golvlinjen hamnar efter att bilden skalats och placerats.
      // Den här positionen kan sedan användas när golvet ska få en pulserande ljuseffekt.
      if (this.e.floorY != null) this.floorLine = oy + this.e.floorY * h;

    // Om ingen användbar bakgrundsbild finns använder jag i stället projektets reservfärg.
    } else g.background(...this.cfg.bg);

    // Här hämtar jag canvasens vanliga ritkontext för att kunna använda Canvas API direkt.
    const c = g.drawingContext,

          // Jag skapar en radiell gradient som går från genomskinlig i mitten
          // till mörkare ut mot kanterna. Det är vinjetteffekten.
          v = c.createRadialGradient(width / 2, height * 0.55, height * 0.25, width / 2, height * 0.55, height * 0.95);

    // I gradientens mitt är färgen helt genomskinlig.
    v.addColorStop(0, 'rgba(0,0,0,0)');

    // Vid gradientens ytterkant lägger jag till svart med den genomskinlighet
    // som anges av inställningen vignette. Om den saknas använder jag 0.5.
    v.addColorStop(1, `rgba(0,0,0,${this.e.vignette ?? 0.5})`);

    // Jag använder gradienten som fyllningsfärg och täcker hela grafikytan.
    c.fillStyle = v; c.fillRect(0, 0, width, height);

    // Nu sparar jag den färdiga bakgrunden i cache.
    // Den kan återanvändas i draw() utan att hela bakgrunden behöver byggas om varje gång.
    this.cache = g;
  }

  // Kick-puls 0..1 (musiken, annars intern klocka)
  // Den här metoden räknar fram en puls som ljuseffekterna kan följa.
  kick(now) {
    // Om ett ljudobjekt finns och musiken faktiskt körs hämtar jag pulsens värde därifrån.
    // kickEnv() ger ett värde som följer musikens kicktrumma.
    return this.audio && this.audio.running ? this.audio.kickEnv() : Math.pow(1 - ((now * this.e.bpm / 60) % 1), 2.5);
    // Om ljudet inte är igång skapar jag i stället en egen puls utifrån tiden och BPM-inställningen.
    // Modulo (%) gör att pulsen upprepas i en cykel.
    // Upphöjningen till 2.5 formar pulsen så att den blir starkare i början av varje cykel
    // och sedan avtar.
  }

  // 0..1 – används av skuggan
  // pulse kombinerar kickpulsen med en långsammare sinusvåg.
  // På så sätt får jag en rörelse som både följer takten och har en mer kontinuerlig variation.
  pulse(now) {
    return Math.min(1, 0.7 * this.kick(now) + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.7)));
    // kick står för 70 procent och den långsamma vågen för 30 procent.
    // Math.min ser till att resultatet aldrig blir större än 1.
  }

  // lvl = 0..4, fx = { normal, shadowX }
  // draw ritar upp miljön för den aktuella bildrutan.
  // now är den aktuella tiden, lvl är nivånumret i formatet 0–4
  // och fx innehåller extra information som påverkar ljuset.
  draw(now, lvl, fx) {

    // Jag bygger bakgrunden om den inte finns ännu eller om canvasens storlek har ändrats.
    // På så sätt använder jag alltid en cache som passar den aktuella storleken.
    if (!this.cache || this.w !== width || this.h !== height) this.build();

    // Här sätter jag standardvärden för effekterna.
    // Om fx redan innehåller normal eller shadowX behåller jag de värdena.
    // Annars används 0 för normal och mitten av canvasen för shadowX.
    fx = { normal: 0, shadowX: width / 2, ...fx };

    // Jag hämtar den vanliga Canvas-ritkontexten.
    // k är den aktuella kickpulsen.
    // dim används för att dämpa ljuset när fx.normal är aktivt.
    // LF är en nivåfaktor som gör att ljuset ökar stegvis mellan nivåerna.
    const ctx = drawingContext, k = this.kick(now), dim = 1 - 0.8 * fx.normal, LF = [0.35, 0.6, 0.8, 1, 1.25][lvl],
          pink = this.e.rimPink, blue = this.e.rimBlue, violet = [150, 70, 255], cyan = [40, 210, 255];

    // Jag ritar den cachade bakgrunden först.
    ctx.drawImage(this.cache.elt, 0, 0, width, height);

    // save sparar ritkontextens nuvarande inställningar.
    // lighter ändrar blandningsläget så att färgerna adderas när de ritas ovanpå varandra.
    // Det ger ett starkare neonliknande ljus där effekterna överlappar.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';

    // Bakgrundsljus (rosa vänster, blått höger) som andas, pulserar och flimrar
    // fl ger ibland ett kort extra ljusflimmer från nivå 2 och uppåt.
    // Slumpvärdet gör att flimret inte inträffar varje bildruta.
    const fl = (lvl >= 2 && Math.random() < 0.03 * lvl / 4) ? 0.2 : 0,

          // cx låter ljusens mittpunkt röra sig långsamt i sidled.
          // Rörelsen blir större på högre nivåer.
          cx = width / 2 + Math.sin(now * 0.35) * width * 0.2 * (lvl / 4), cy = height * 0.45,

          // A bestämmer bakgrundsljusets styrka.
          // Jag kombinerar en grundnivå, kickpulsen och eventuellt flimmer,
          // och multiplicerar sedan med dim för att kunna dämpa ljuset.
          A = ((0.08 + 0.14 * k) * LF + fl) * dim;

    // Jag skapar två ljusområden: ett rosa till vänster och ett blått till höger.
    // d bestämmer deras placering i förhållande till mittpunkten.
    for (const [d, c] of [[-0.15, pink], [0.15, blue]]) {
      const x = cx + d * width;

      // Jag skapar en radiell gradient som är starkast vid ljusets mitt
      // och tonas ut mot kanterna.
      ctx.fillStyle = fade(ctx.createRadialGradient(x, cy, 0, x, cy, height * 0.8), c, A);

      // Jag fyller hela canvasen med gradienten.
      ctx.fillRect(0, 0, width, height);
    }

    // Kantljus längs sidorna
    // E styr hur starkt kantljuset är och påverkas både av kickpulsen och nivån.
    // W bestämmer hur stor del av bredden som kantljuset ska täcka.
    const E = (0.05 + 0.22 * k) * LF * dim, W = width * 0.28;

    // Här skapar jag en linjär gradient från vänsterkanten och in mot bilden.
    // Den rosa färgen tonas ut till genomskinlighet.
    ctx.fillStyle = fade(ctx.createLinearGradient(0, 0, W, 0), pink, E); ctx.fillRect(0, 0, W, height);

    // Samma princip används på höger sida, men med den blå färgen.
    ctx.fillStyle = fade(ctx.createLinearGradient(width, 0, width * 0.72, 0), blue, E); ctx.fillRect(width * 0.72, 0, W, height);

    // Golvet pulserar på kicken
    // Den här effekten aktiveras från nivå 2 och blir starkare på högre nivåer.
    if (lvl >= 1) {

      // Jag använder den beräknade golvlinjen om den finns.
      // Annars placerar jag golvet ungefär vid 75 procent av bildens höjd.
      const y0 = Math.floor(this.floorLine > 0 ? this.floorLine : height * 0.75);

      // globalAlpha styr hur genomskinligt det som ritas blir.
      // Jag använder olika styrkor beroende på nivå och multiplicerar med kickpulsen.
      ctx.globalAlpha = Math.min(1, k * [0, 0.12, 0.22, 0.35, 0.5][lvl] * dim);

      // Jag ritar den nedre delen av den cachade bakgrunden ovanpå sig själv.
      // Genom att ändra genomskinligheten får golvområdet en pulserande ljuseffekt.
      ctx.drawImage(this.cache.elt, 0, y0, width, height - y0, 0, y0, width, height - y0);

      // Jag återställer genomskinligheten så att den inte påverkar efterföljande effekter.
      ctx.globalAlpha = 1;
    }

    // Strålkastare uppifrån som siktar mot skuggan
    // Antalet strålar ökar för varje nivå.
    const N = [0, 2, 4, 6, 8][lvl];

    // Om N är större än 0 ritar jag strålkastarna.
    if (N) {

      // spd styr hur snabbt strålkastarna svänger.
      // sway styr hur mycket de får svänga i sidled.
      // base är deras grundstyrka, som påverkas av nivå, kickpuls och ljusdämpning.
      // L är längden på ljusstrålarna.
      // tx och ty är målpunkten som strålarna riktas mot.
      // Jag låter målet ligga en bit mellan bildens mitt och skuggans aktuella x-position.
      const spd = [0, 0.25, 0.4, 0.7, 1.2][lvl], sway = [0, 0.22, 0.32, 0.45, 0.65][lvl],
            base = [0, 0.07, 0.1, 0.13, 0.17][lvl] * (0.55 + 0.45 * k) * dim, L = height * 1.5,
            tx = width / 2 + (fx.shadowX - width / 2) * 0.7, ty = height * 0.65,

            // På nivå 1–2 använder jag rosa och blått.
            // Från nivå 3 lägger jag även till violett och cyan.
            pal = lvl >= 3 ? [pink, blue, violet, cyan] : [pink, blue];

      // Jag går igenom varje strålkastare och räknar ut dess riktning.
      for (let i = 0; i < N; i++) {

        // ox och oy är strålkastarens startposition.
        // ang räknar ut vinkeln mot målpunkten med Math.atan2.
        // Jag lägger också till en sinusbaserad svängning så att strålen rör sig.
        // col väljer färg ur paletten. På nivå 4 och 5 kan färgerna bytas över tid.
        const ox = (i + 0.5) / N * width, oy = -height * 0.05,
              ang = Math.atan2(ty - oy, tx - ox) + Math.sin(now * spd + i * 1.7) * sway,
              col = pal[(i + (lvl >= 4 ? Math.floor(now * 2) : 0)) % pal.length];

        // Jag sparar ritinställningarna så att varje strålkastare kan transformeras separat.
        ctx.save();

        // translate flyttar ritningens origo till strålkastarens startpunkt.
        // rotate vrider sedan koordinatsystemet så att ljusstrålen pekar åt rätt håll.
        ctx.translate(ox, oy); ctx.rotate(ang);

        // Jag ritar två koner per strålkastare:
        // en bredare och svagare kon samt en smalare och starkare.
        // Tillsammans ger de ett mer markerat ljus än om jag bara ritade en enda kon.
        for (const [wm, am] of [[1.8, 0.45], [1, 1]]) { // bred svag + smal stark kon

          // Jag skapar en gradient längs strålen så att ljuset tonas ut längre bort.
          ctx.fillStyle = fade(ctx.createLinearGradient(0, 0, L, 0), col, base * am); ctx.beginPath();

          // Här formar jag ljuskonen med fyra hörnpunkter.
          // moveTo anger startpunkten och lineTo bygger sidorna.
          // closePath stänger formen och fill fyller den med gradienten.
          ctx.moveTo(0, -4); ctx.lineTo(L, -L * 0.08 * wm); ctx.lineTo(L, L * 0.08 * wm); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        }

        // Jag återställer ritkontexten så att nästa strålkastare börjar med vanliga koordinater.
        ctx.restore();
      }
    }

    // Diskret blixt på kicken (nivå 4–5), låg ljusstyrka = skonsamt
    // Blixten används från nivå 4 och framåt, om strobe-inställningen är större än 0.
    if (lvl >= 3 && this.e.strobe > 0) {

      // Jag skapar ett genomskinligt ljust lager över hela bilden.
      // Styrkan påverkas av strobe-värdet, nivån, kickpulsen och dim.
      // Kickpulsen multipliceras med sig själv för att göra blixten tydligare vid starka kickar.
      ctx.fillStyle = `rgba(255,170,255,${this.e.strobe * ((lvl - 2) / 2) * k * k * dim})`;

      // Jag fyller hela canvasen med blixtfärgen.
      ctx.fillRect(0, 0, width, height);
    }

    // Jag återställer det additiva blandningsläget och andra sparade inställningar.
    // Det gör att glitch-effekten efteråt inte automatiskt får samma ljusblandning.
    ctx.restore();

    // Glitch (nivå 4–5): korta remsor av bakgrunden hoppar i sidled (aldrig skuggan)
    // Den här effekten förändrar bara bakgrundsbilden, inte själva skuggan.
    if (lvl >= 3) {

      // Om ingen glitch redan pågår kan en ny startas.
      // Sannolikheten ökar kraftigt på den sista nivån.
      // Jag minskar också sannolikheten när normal-effekten är aktiv.
      if (!this.glitch && Math.random() < [0, 0, 0, 0.015, 0.07][lvl] * (1 - fx.normal)) {

        // Jag skapar ett glitch-objekt med en sluttid och en lista med remsor.
        // Varje remsa får en slumpmässig höjd, placering och förskjutning i sidled.
        this.glitch = { until: now + 0.05 + Math.random() * 0.09, sl: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
          y: Math.random() * height * 0.85, h: height * (0.015 + Math.random() * 0.06), dx: (Math.random() < 0.5 ? -1 : 1) * width * (0.01 + Math.random() * 0.05) })) };
      }

      // Jag hämtar den aktuella glitch-effekten.
      const gl = this.glitch;

      // Om effekten har passerat sin sluttid tar jag bort den.
      if (gl) {
        if (now > gl.until) this.glitch = null;

        // Annars ritar jag varje remsa från den cachade bakgrunden på en ny x-position.
        // Det skapar intrycket av att delar av bakgrunden tillfälligt hoppar åt sidan.
        else for (const s of gl.sl) ctx.drawImage(this.cache.elt, 0, s.y, width, s.h, s.dx, s.y, width, s.h);
      }
    }
  }
}