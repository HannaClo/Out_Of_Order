/* =====================================================================
   VÄRLDSMILJÖ – visuellt lager för "Fysik är ett förslag, Värld 1"

   Detta skript ansvarar för att skapa och hantera den visuella miljön
   runt partiklarnas rörelser. Det fungerar som ett kompletterande
   grafiskt lager ovanpå programmets ursprungliga fysiksimulering.

   Skriptet läggs in efter huvudskriptet eftersom det behöver komma åt
   funktioner, variabler och objekt som redan har definierats där.

   Den ursprungliga fysiken, klappdetekteringen, mikrofonhanteringen
   och ljudsyntesen lämnas orörda. Det nya skriptet fokuserar istället
   på hur simuleringen presenteras visuellt.

   De olika effekterna kan justeras genom objektet VIS, vilket gör det
   möjligt att förändra utseendet utan att behöva ändra själva
   funktionerna som ritar upp miljön.

   Lagerordning (z-index):
   0 = Bakgrundsmiljö
   1 = Dimma
   2 = Ljuseffekter
   3 = Partiklar (p5.js)
   4 = Golv och reflektioner
   5 = Efterbearbetning och bloom
   6 = Vinjettering
   7 = Bildbrus
   8 = Gränssnitt

   Tangentbordskontroller:
   E = Aktivera/inaktivera miljön
   F = Aktivera/inaktivera dimman
   L = Aktivera/inaktivera ljuset
   G = Aktivera/inaktivera golvet
   B = Aktivera/inaktivera bloom
   Q = Växla mellan kvalitetsinställningar
   ===================================================================== */

   (function () {
    'use strict';
  
    // Ett omedelbart anropat funktionsuttryck (IIFE) används för att
    // samla skriptets variabler och funktioner i ett eget lokalt scope.
    // Detta minskar risken för namnkonflikter med variabler i huvudprogrammet.
  
    // 'use strict' aktiverar JavaScripts strikta läge, vilket bland annat
    // hjälper till att upptäcka vissa typer av programmeringsfel.
  
  
    /* ---------- INSTÄLLNINGAR ---------- */
  
    // VIS innehåller programmets visuella inställningar.
    // Genom att samla inställningarna i ett objekt blir det enklare
    // att justera olika effekter utan att behöva ändra flera funktioner.
  
    const VIS = {
  
      // Bestämmer hur mycket beräkningskraft som används för effekterna.
      // Lägre kvalitet innebär generellt färre grafiska beräkningar.
      quality: 'med',
  
      // Inställningar för bakgrundsmiljön.
      env: {
        enabled: true,
        image: 'assets/gravitation_bakgrund.jpeg',
        darken: 0
      },
  
      // Inställningar för dimman.
      // Density styr hur tät dimman upplevs och speed dess rörelsehastighet.
      fog: {
        enabled: true,
        density: 1,
        speed: 1
      },
  
      // Inställningar för ljuskällorna.
      // Beams bestämmer antalet ljusstrålar och intensity deras styrka.
  
      lights: {
        enabled: true,
        beams: 4,
        intensity: 1,
        fixtures: true
      },
  
      // Inställningar för partiklarna.
      // dof aktiverar skärpedjup och micro styr små visuella rörelser.
      // clapPulse bestämmer hur mycket partiklarna förstoras vid en klapp.
      particles: {
        dof: true,
        micro: 1,
        clapPulse: 0.5
      },
  
      // Inställningar för golvets visuella effekter.
      // Reflection styr speglingens styrka.
      // Pools och groundFog aktiverar ljuspölar respektive markdimma.
      floor: {
        enabled: true,
        reflection: 0.5,
        pools: true,
        groundFog: true
      },
  
      // Efterbearbetning av bilden.
      // Bloom skapar en mjuk ljusspridning, shake ger kameraskakningar
      // och rings styr synligheten hos de cirkulära tryckvågorna.
      post: {
        enabled: true,
        bloom: 0.45,
        shake: 0.4,
        rings: 0.5
      },
  
      // Inställningar för ljudanalysen.
      // Breath innebär att miljön även kan ha en långsam grundrörelse
      // när det inte finns någon aktiv ljudsignal.
      audio: {
        enabled: true,
        breath: true
      }
    };
  
    // Gör inställningsobjektet globalt tillgängligt.
    // Det innebär att värden kan ändras direkt från webbläsarens konsol,
    // exempelvis genom att skriva VIS.fog.density = 2.
    window.VIS = VIS;
  
  
    // Färgpalett som används för att skapa variation mellan ljus och partiklar.
    // Värdena motsvarar nyansvinklar (hue) i färgsystemet HSL/HSLA.
    // Exempelvis ger 185 en cyanliknande färg medan 268 ger violett.
    const PAL = [185, 222, 268, 320, 200];
  
  
    // Kvalitetsinställningarna bestämmer hur många beräkningar som utförs
    // för vissa visuella effekter.
    // Lägre bloom-värde innebär en mindre nedskalning av bilden,
    // vilket ger bättre bildkvalitet men kräver mer beräkningsarbete.
    const QUAL = {
      'låg': { bloom: 8, fog: 2 },
      'med': { bloom: 5, fog: 3 },
      'hög': { bloom: 3, fog: 3 }
    };
  
  
    // FIX beskriver de fyra fasta ljuskällornas placering och egenskaper.
    // x anger ljuskällans horisontella position i förhållande till skärmens bredd.
    // hue anger ljusets färgnyans.
    // ph är en individuell fasförskjutning som gör att ljuskällorna
    // kan röra sig och variera oberoende av varandra.
    const FIX = [
      { x: .14, ph: 0 },
      { x: .38, ph: 2.1 },
      { x: .62, ph: 4.2 },
      { x: .86, ph: 1.3 }
    ];
  
    /* ---------- LAGER (CANVAS) ---------- */
  
    // L innehåller samtliga canvaslager som skapas av skriptet.
    // Varje lager får en egen canvas och en tillhörande 2D-ritkontext.
    // På så sätt kan exempelvis dimma och ljus ritas separat utan att
    // behöva rita om hela miljön varje gång.
  
    const L = {};
  
    let pc = null; // Referens till p5.js-canvasen där partiklarna ritas.
  
  
    // Funktionen mk skapar ett nytt canvaslager.
    // name används som identifierare i objektet L.
    // z bestämmer lagrets placering i förhållande till andra lager.
    // blend är ett valfritt blandningsläge som påverkar hur lagret
    // kombineras visuellt med innehållet bakom det.
  
    function mk(name, z, blend) {
  
      const c = document.createElement('canvas');
      const s = c.style;
  
      // Canvasen placeras fixerad i webbläsarfönstret.
      // Detta innebär att den täcker skärmen oberoende av sidans scrollning.
      s.position = 'fixed';
      s.left = s.top = '0';
      s.width = s.height = '100%';
  
      // z-index avgör vilket lager som visas framför andra.
      s.zIndex = z;
  
      // Genom pointerEvents = 'none' kan användaren fortfarande
      // interagera med knappar och andra element bakom canvasen.
      s.pointerEvents = 'none';
  
      // Exempelvis används screen för att ljusare pixlar ska blandas
      // med bakgrunden, vilket passar bra för ljus- och dimmeffekter.
      if (blend) s.mixBlendMode = blend;
  
      document.body.appendChild(c);
  
      // Både canvasen och dess 2D-ritkontext sparas.
      // Ritkontexten används senare för att rita grafiken.
      L[name] = {
        c,
        g: c.getContext('2d')
      };
    }
  
  
    // Anpassar canvaslagrens faktiska upplösning till fönstrets storlek.
    // Detta är viktigt eftersom canvasens ritbara upplösning inte
    // automatiskt följer CSS-storleken.
  
    function resize() {
  
      for (const k in L) {
        L[k].c.width = innerWidth;
        L[k].c.height = innerHeight;
      }
  
      // Miljön är statisk och rensas när canvasens storlek sätts,
      // så den måste ritas om här (även vid första starten).
      if (L.env) Env.draw();
    }
  
  
    // Initierar hela lagersystemet.
    // Funktionen körs första gången render() anropas.
  
    function init() {
  
      // Hämtar canvasen som p5.js använder för partikelgrafiken.
      pc = drawingContext.canvas;
  
      // Skapar de olika visuella lagren i rätt ordning.
      mk('env', 0);
      mk('fog', 1, 'screen');
      mk('lights', 2, 'screen');
      mk('floor', 4, 'screen');
      mk('post', 5, 'screen');
      mk('finalFade', 9);
  
      // Ändrar p5.js-canvasens placering så att den hamnar mellan
      // ljuslagret och golvlagret.
      Object.assign(pc.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        zIndex: 3,
        mixBlendMode: 'screen'
      });
  
      // Ändrar även placeringen av programmets befintliga gränssnitt.
      const z = (id, v) => {
        document.getElementById(id).style.zIndex = v;
      };
  
      z('vignette', 6);
      z('grain', 7);
      z('hud', 8);
      z('board', 8);
  
      // Anpassar samtliga lager till skärmens aktuella storlek.
      resize();
    }
  
    /* ---------- 0. MILJÖ: STATISK BETONGHALL ---------- */
  
    // Env ansvarar för att skapa bakgrundsmiljön.
    // Denna miljö är huvudsakligen statisk och behöver därför inte
    // ritas om varje bildruta. Den ritas istället om när fönstrets
    // storlek ändras eller när bakgrunden uppdateras.
  
    const Env = {
  
      // Här sparas en eventuell bakgrundsbild.
      img: null,
  
      draw() {
  
        // Hämtar canvasens ritkontext, bredd, höjd och golvets position.
        const { c, g } = L.env;
        const w = c.width;
        const h = c.height;
        const fy = floorY;
  
  
        // Om en bakgrundsbild har angetts laddas den in.
        // Bilden kan exempelvis föreställa en verklig betonghall.
        if (VIS.env.image) {
  
          // Bilden skapas endast en gång.
          // onload ser till att miljön ritas om när bilden har laddats färdigt.
          if (!Env.img) {
            Env.img = new Image();
            Env.img.onload = () => Env.draw();
            Env.img.onerror = () => console.warn('Hittar inte bakgrundsbilden:', VIS.env.image);
            Env.img.src = VIS.env.image;
          }
  
          // Kontrollerar att bilden verkligen har laddats och har en giltig bredd.
          if (Env.img.complete && Env.img.naturalWidth) {
  
            // Beräknar en skalningsfaktor som gör att bilden täcker hela skärmen.
            // Math.max används för att undvika att tomma områden uppstår.
            const k = Math.max(
              w / Env.img.width,
              h / Env.img.height
            );
  
            const iw = Env.img.width * k;
            const ih = Env.img.height * k;
  
            // Bilden centreras och skalas så att den täcker hela canvasen.
            g.drawImage(
              Env.img,
              (w - iw) / 2,
              (h - ih) / 2,
              iw,
              ih
            );
  
            // Ett halvtransparent mörkt lager läggs över väggdelen.
            // Golvet lämnas däremot opåverkat för att behålla bildens färger.
            g.fillStyle = `rgba(4,3,10,${VIS.env.darken})`;
            g.fillRect(0, 0, w, fy);
          }
  
        } else {
  
          // Om ingen egen bild används skapas istället en hall med pelare.
          // Tre olika djup används för att skapa perspektiv.
          // Avlägsna pelare är ljusare medan de närmare pelarna är mörkare.
  
          const layers = [
            { n: 8, wd: .016, col: 'rgb(18,16,38)', rim: .10 },
            { n: 5, wd: .03, col: 'rgb(10,9,22)', rim: .14 },
            { n: 3, wd: .055, col: 'rgb(4,3,9)', rim: .18 }
          ];
  
          layers.forEach((ly, li) => {
  
            for (let i = 0; i < ly.n; i++) {
  
              // Slumpliknande placering används för att undvika
              // att pelarna ser alltför regelbundet placerade ut.
              const x = (i + .5 + (r() - .5) * .35) / ly.n * w;
  
              const pw = ly.wd * w;
              const top = h * .05;
  
              // Själva pelaren ritas som en rektangel.
              g.fillStyle = ly.col;
              g.fillRect(x - pw / 2, top, pw, fy - top);
  
              // En horisontell gradient skapar en färgad kant på pelaren.
              // Detta ger intrycket av att pelaren belyses från sidan.
              const rim = g.createLinearGradient(
                x - pw / 2, 0,
                x + pw / 2, 0
              );
  
              const hue = PAL[(i + li) % 5];
  
              rim.addColorStop(
                0,
                `hsla(${hue},80%,55%,${ly.rim})`
              );
  
              rim.addColorStop(
                .18,
                `hsla(${hue},80%,55%,0)`
              );
  
              g.fillStyle = rim;
              g.fillRect(x - pw / 2, top, pw, fy - top);
            }
          });
  
          // Taket skapas som ett mörkt område längst upp.
          g.fillStyle = '#020106';
          g.fillRect(0, 0, w, h * .06);
  
          // Takets fackverk ritas med tunna linjer.
          g.strokeStyle = 'rgba(70,66,130,.16)';
          g.lineWidth = 1;
  
          for (let x = -40; x < w + 40; x += w / 26) {
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x + w / 52, h * .06);
            g.lineTo(x + w / 26, 0);
            g.stroke();
          }
  
          // En tunn horisontell linje markerar övergången mellan tak och vägg.
          g.fillStyle = 'rgba(60,56,110,.25)';
          g.fillRect(0, h * .06, w, 2);
        }
  
      }
    };
  
    /* ---------- 1. DIMMA: TRE TILEBARA TEXTURER MED PARALLAX ---------- */
  
    // Fog ansvarar för att skapa en rörlig dimma.
    // Effekten byggs upp av flera genomskinliga texturer som rör sig
    // med olika hastigheter och skalor.
    // Kombinationen ger ett större visuellt djup än en enda dimbild.
  
    const Fog = {
  
      // tiles lagrar skapade texturer så att de kan återanvändas.
      // pats innehåller de mönster som används vid själva ritningen.
      tiles: {},
      pats: [],
  
      tile(hue) {
  
        // Om en textur med aktuell färg redan finns används den igen.
        // Detta minskar onödiga beräkningar.
        if (this.tiles[hue]) return this.tiles[hue];
  
        // Skapar en kvadratisk canvas som fungerar som dimtextur.
        const c = document.createElement('canvas');
        c.width = c.height = 256;
  
        const g = c.getContext('2d');
        let s = hue + 3;
  
        // En enkel deterministisk slumptalsgenerator används för att
        // skapa en varierad men återupprepningsbar textur.
        const r = () =>
          (s = (s * 16807 + 11) % 2147483647) / 2147483647;
  
        // Skapar flera mjuka ljusfläckar med radiella gradienter.
        for (let i = 0; i < 46; i++) {
  
          const x = r() * 256;
          const y = r() * 256;
          const rad = 30 + r() * 60;
  
          // Texturen ritas även utanför canvasens gränser.
          // Detta gör att den kan upprepas utan tydliga kanter.
          for (const dx of [-256, 0, 256]) {
            for (const dy of [-256, 0, 256]) {
  
              const gx = x + dx;
              const gy = y + dy;
  
              const gr = g.createRadialGradient(
                gx, gy, 0,
                gx, gy, rad
              );
  
              gr.addColorStop(
                0,
                `hsla(${hue},60%,55%,.16)`
              );
  
              gr.addColorStop(
                1,
                `hsla(${hue},60%,55%,0)`
              );
  
              g.fillStyle = gr;
              g.fillRect(
                gx - rad,
                gy - rad,
                rad * 2,
                rad * 2
              );
            }
          }
        }
  
        // Den färdiga texturen sparas för framtida användning.
        return (this.tiles[hue] = c);
      },
  
  
      draw(now, a) {
  
        const { c, g } = L.fog;
        const w = c.width;
        const h = c.height;
  
        // Rensar föregående bildruta.
        g.clearRect(0, 0, w, h);
  
        if (!VIS.fog.enabled) return;
  
        // Antalet dimlager bestäms av vald kvalitetsinställning.
        const n = QUAL[VIS.quality].fog;
        const sp = VIS.fog.speed;
  
        // Dimtätheten påverkas av både användarens inställning
        // och ljudanalysens värden.
        const dens =
          VIS.fog.density *
          (0.55 + 0.25 * a.energy + 0.1 * a.breath);
  
        // Varje dimlager har en egen färg, skala, hastighet och transparens.
        // Detta gör att lagren rör sig olika och skapar en parallaxeffekt.
        const hues = [222, 268, 200];
        const sc = [2.6, 1.7, 1.1];
        const vx = [4, 9, 16];
        const al = [.55, .5, .4];
  
        for (let i = 0; i < n; i++) {
  
          // Texturen omvandlas till ett repeterande mönster.
          if (!this.pats[i]) {
            this.pats[i] = g.createPattern(
              this.tile(hues[i]),
              'repeat'
            );
          }
  
          const t = now * sp;
  
          // setTransform förflyttar och skalar texturen.
          // Eftersom lagren har olika hastigheter uppstår en känsla av djup.
          this.pats[i].setTransform(
            new DOMMatrix()
              .translate(
                t * vx[i],
                Math.sin(t * .05 + i) * 30 + t * 2
              )
              .scale(sc[i])
          );
  
          g.globalAlpha = al[i] * dens;
          g.fillStyle = this.pats[i];
          g.fillRect(0, 0, w, h);
        }
  
        g.globalAlpha = 1;
  
        // destination-in används för att skapa en mask.
        // Genom att kombinera dimman med en vertikal gradient blir den
        // mer synlig nära golvet och svagare högre upp i rummet.
        g.globalCompositeOperation = 'destination-in';
  
        const m = g.createLinearGradient(0, 0, 0, floorY);
  
        m.addColorStop(0, 'rgba(0,0,0,.3)');
        m.addColorStop(1, 'rgba(0,0,0,1)');
  
        g.fillStyle = m;
        g.fillRect(0, 0, w, h);
  
        // Återställer standardläget för blandning.
        g.globalCompositeOperation = 'source-over';
      }
    };
  
    /* ---------- 2. LJUS: STRÅLAR, FIXTURER OCH LJUSPÖLAR ---------- */
  
    // Lights ansvarar för att skapa och rita de olika ljuseffekterna
    // i den virtuella miljön. Ljuset består av flera delar: riktade
    // ljusstrålar, synliga ljuskällor och ljuspölar som uppstår där
    // ljusstrålarna träffar golvet.
    //
    // Effekterna är dynamiska och uppdateras varje bildruta. Ljuset
    // påverkas dessutom av ljudanalysen, vilket gör att miljön kan
    // reagera visuellt på exempelvis basljud och identifierade beats.
  
    const Lights = {
  
      // Här sparas information om de aktiva ljusstrålarna.
      // Informationen kan även användas av partikelsystemet för att
      // beräkna hur partiklar påverkas visuellt av ljuskällorna.
      beams: [],
  
      draw(now, a) {
  
        // Hämtar canvasens ritkontext och aktuella dimensioner.
        const { c, g } = L.lights;
        const w = c.width;
        const h = c.height;
        const fy = floorY;
  
        // Rensar föregående bildruta och tömmer listan med ljusstrålar.
        g.clearRect(0, 0, w, h);
        this.beams.length = 0;
  
        // Avbryter ritningen om ljuseffekterna har stängts av.
        if (!VIS.lights.enabled) return;
  
        // Beräknar hur mycket en klapp fortfarande påverkar ljuset.
        // Math.exp används för att skapa en exponentiellt avtagande puls.
        // Detta gör att effekten gradvis försvinner istället för att
        // stängas av direkt.
        const pulse = Math.exp(-(now - lastClapT) * 4);
  
        // lighter gör att färgerna adderas med varandra.
        // Det innebär att överlappande ljusområden blir ljusare.
        g.globalCompositeOperation = 'lighter';
  
        // Rave-upptrappning under de tre sista stegen.
        const raveProgress = constrain((K - 0.7) / 0.3, 0, 1);
        const raveBoost = lerp(1, 2.8, pow(raveProgress, 1.4));
  
  
        // Rörelsen blir snabbare mot finalen.
        const raveSpeed = lerp(1, 2.5, raveProgress);
  
        // Antalet aktiva ljusstrålar begränsas till antalet definierade
        // ljuskällor i FIX. Detta förhindrar att fler strålar än det
        // finns ljuskällor försöker ritas.
        const n = Math.min(VIS.lights.beams, FIX.length);
  
        for (let i = 0; i < n; i++) {
  
          const f = FIX[i];
  
          // Beräknar ljusstrålens svängning.
          // Sinusfunktioner används för att skapa en mjuk och kontinuerlig
          // rörelse som gör att ljuset inte känns helt statiskt.
          //
          // K påverkar hur mycket ljuset reagerar på simuleringens
          // aktuella dynamik.
          const sway =
            Math.sin(now * .15 * (1 + 2 * K) * raveSpeed + f.ph) * .14 * raveSpeed +
            K * .2 * Math.sin(now * (.5 + 1.5 * K) * raveSpeed + f.ph * 1.7);
  
          // Bestämmer ljusstrålens vinkel.
          // Placeringen av ljuskällan påverkar grundvinkeln medan sway
          // ger en mindre animerad förskjutning.
          const th = (.5 - f.x) * .8 + sway;
  
          // Omvandlar ljuskällans relativa position till pixlar.
          // Ljuskällorna placeras nära taket.
          const sx = w * f.x;
          const sy = h * .035;
  
          // Sinus och cosinus används för att bestämma ljusstrålens riktning.
          const dx = Math.sin(th);
          const dy = Math.cos(th);
  
          // Beräknar hur lång ljusstrålen behöver vara för att nå golvet.
          const len = (fy - sy) / dy;
  
          // Ljusets färgnyans varierar långsamt över tid.
          // K påverkar hur mycket färgförändringen förstärks.
          // Strålkastarna följer världens cyan-, rosa- och lilapalett.
          // Strålkastarna använder världens cyan, rosa och violett.
          const worldHues = [185, 320, 270];
          const baseHue = worldHues[i % worldHues.length];
  
          const hue =
            baseHue + Math.sin(now * .3 * raveSpeed + f.ph) * K * 18;
  
          // Om ljudanalysen identifierar ett beat kopplas en extra
          // ljusförstärkning till den aktuella ljuskällan.
          // På så sätt får endast en ljuskälla en tydlig ljuspuls åt gången.
          const kick = (a.fix === i) ? a.beat * .12 : 0;
  
          // Beräknar ljusstrålens transparens och intensitet.
          // Basnivån påverkas av VIS.lights.intensity.
          // a.bass påverkar hur starkt ljuset reagerar på basljud.
          // noise skapar en mindre oregelbunden variation.
          // Extra ljusstyrka under de tre sista stegen.
          const ai =
            (.2 * VIS.lights.intensity *
            raveBoost *
            (0.85 + 0.15 * a.bass) *
            (0.8 + 0.4 * noise(now * .2 * raveSpeed + i * 9))
            + kick * raveBoost + K * pulse * .08);
  
          // Sparar information om ljusstrålen.
          // Denna information används senare av partikelsystemet för
          // att beräkna vilka partiklar som befinner sig nära ljuset.
          this.beams.push({
            sx, sy, dx, dy, th, len, slope: .14, hue
          });
  
          // save() sparar ritkontextens nuvarande inställningar.
          // translate() flyttar koordinatsystemets origo till ljuskällan.
          // rotate() roterar sedan koordinatsystemet så att ljusstrålen
          // kan ritas med rätt riktning.
          g.save();
          g.translate(sx, sy);
          g.rotate(-th);
  
          // Bestämmer hur genomskinlig ljusstrålen ska vara.
          g.globalAlpha = Math.min(1, ai);
  
          // beamSprite() hämtar en förberäknad grafisk bild av ljusstrålen.
          // Den återanvänds här istället för att skapa en ny gradient
          // för varje enskild bildruta.
          // Strålkastarljuset slocknar efter finalens BANG.
          if (finaleBangAt === null) {
            g.drawImage(
              beamSprite(((hue % 360) + 360) % 360),
              -len * .21,
              0,
              len * .42,
              len
            );
          }
  
          // Återställer koordinatsystemet och ritinställningarna.
          g.restore();
  
  
          // Om fixtures är aktiverat ritas även själva lampan.
          // Lampan representeras av en glowSprite som skapar ett
          // mjukt ljussken runt ljuskällan.
          if (VIS.lights.fixtures) {
            g.globalAlpha = finaleBangAt === null ? .7 + kick * 2 : 0.15;
  
            const fs = 22;
  
            g.drawImage(
              glowSprite(((hue % 360) + 360) % 360),
              sx - fs / 2,
              sy - fs / 2,
              fs,
              fs
            );
          }
  
  
          // Om pools är aktiverat skapas en ljuspöl på golvet.
          // Den placeras där den beräknade ljusstrålen träffar golvytan.
          if (VIS.floor.pools) {
  
            const px = sx + dx * len;
            const pw = len * .34;
  
            // Golvets ljuspöl görs bredare än den ursprungliga ljuskällan.
            // scale(1, .13) pressar ihop ljuset vertikalt så att det
            // får formen av en elliptisk ljusreflektion.
            g.save();
            g.translate(px, fy + 5);
            g.scale(1, .13);
  
            g.globalAlpha = Math.min(1, ai * 1.8);
  
            g.drawImage(
              glowSprite(((hue % 360) + 360) % 360),
              -pw / 2,
              -pw / 2,
              pw,
              pw
            );
  
            g.restore();
          }
        }
  
        // Återställer transparens och blandningsläge efter ritningen.
        // Detta är viktigt eftersom ritinställningar annars kan påverka
        // andra delar av programmet som använder samma ritkontext.
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    };
  
    /* ---------- 3. PARTIKLAR: SAMMA DATA SOM FÖRUT, NY RITNING ---------- */
  
    // Funktionen bokeh skapar en mjuk och oskarp ljuscirkel.
    // Effekten används för att simulera skärpedjup, där partiklar
    // som befinner sig längre bort i rummet blir mindre skarpa.
    //
    // hue anger vilken färg partikeln ska ha.
  
    function bokeh(hue) {
  
      // snapHue avrundar färgnyansen till ett bestämt intervall.
      // Detta gör att flera partiklar kan återanvända samma grafik.
      const h = snapHue(hue, 5);
  
      // cachedImage kontrollerar om bilden redan finns lagrad.
      // Om den gör det återanvänds den istället för att skapas igen.
      return cachedImage('bk' + h, () => {
  
        // Skapar en separat canvas för partikelformen.
        const c = document.createElement('canvas');
        c.width = c.height = 64;
  
        const g = c.getContext('2d');
  
        // Skapar en radiell gradient med ljusare färg i mitten
        // och gradvis minskad transparens mot ytterkanten.
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  
        gr.addColorStop(0, `hsla(${h},90%,60%,.30)`);
        gr.addColorStop(.75, `hsla(${h},90%,62%,.38)`);
        gr.addColorStop(.92, `hsla(${h},90%,70%,.5)`);
        gr.addColorStop(1, `hsla(${h},90%,70%,0)`);
  
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
  
        return c;
      });
    }
  
  
    // Parts ansvarar för att rita partiklarna och deras tillhörande effekter.
    // Själva partiklarnas fysik beräknas fortfarande av huvudprogrammet.
    // Detta objekt arbetar därför främst med hur partiklarna presenteras.
  
    const Parts = {
  
      draw(now, dt, a) {
  
        // Hämtar den ursprungliga p5.js-ritkontexten.
        const ctx = drawingContext;
  
        // P innehåller användarens partikelinställningar.
        const P = VIS.particles;
  
        // Begränsar partiklarnas maximala visuella storlek.
        const MAX = 11;
  
        // Beräknar hur mycket en tidigare klapp fortfarande påverkar
        // partiklarna. Effekten avtar exponentiellt med tiden.
        const pulse = Math.exp(-(now - lastClapT) * 4);
  
  
        // destination-out används för att gradvis sudda bort tidigare
        // ritade partiklar. Eftersom transparensen inte är fullständig
        // finns en del av föregående bildruta kvar.
        //
        // Detta skapar en efterglöd eller ett rörelsespår bakom partiklarna.
        ctx.globalCompositeOperation = 'destination-out';
  
        ctx.fillStyle = `rgba(0,0,0,${0.42 - 0.30 * K})`;
  
        ctx.fillRect(0, 0, width, height);
  
        // Byter tillbaka till lighter för att partiklarna ska kunna
        // överlappa varandra och skapa starkare ljusområden.
        ctx.globalCompositeOperation = 'lighter';
  
  
        // Sparar ritkontextens tillstånd innan eventuella
        // förflyttningar och förändringar av koordinatsystemet.
        ctx.save();
  
        // Beräknar hur mycket kameran ska skaka.
        // Skakningen påverkas av K, klappens eftereffekt och användarens
        // inställning för shake.
        const shake = K * 8 * pulse * VIS.post.shake;
  
        // Om skakningen är tillräckligt stor förflyttas hela partikelbilden
        // en liten slumpmässig sträcka i både x- och y-led.
        if (shake > .3) {
          ctx.translate(
            random(-shake, shake),
            random(-shake, shake)
          );
        }
  
  
        // drift skapar en långsam förändring av partiklarnas färgnyanser.
        // PAL.map används för att skapa en uppsättning ljussprites
        // med färger som varierar tillsammans.
        const drift =
          Math.round(Math.sin(now * .07) * K * 4) * 5;
  
        const sp = PAL.map(h =>
          glowSprite((h + drift + 360) % 360)
        );
  
        // Skapar motsvarande uppsättning oskarpa partiklar.
        const bk = PAL.map(h =>
          bokeh((h + drift + 360) % 360)
        );
  
  
        // sizeBoost förstorar partiklarna tillfälligt vid en klapp.
        // Storleken påverkas av K, pulse och användarens inställning.
        const sizeBoost =
          1 + K * .8 * pulse * P.clapPulse;
  
        // Hämtar ljusstrålarna från Lights.
        // Dessa används för att beräkna hur mycket partiklarna
        // förstärks visuellt när de befinner sig nära en ljusstråle.
        const beams = Lights.beams;
  
  
        // Går igenom samtliga partiklar i simuleringen.
        for (const p of particles) {
  
          // Kontrollerar om partikeln befinner sig i viloläge.
          const resting = p.state === 'resting';
  
          // Om partikeln precis har övergått till viloläge registreras
          // detta och dess värmevärde återställs.
          if (resting) {
  
            if (!p.wasResting) {
  
              p.wasResting = true;
              p.heat = 1;
  
              // Om partikeln hade hög hastighet före landningen
              // skapas gnistor för att förstärka känslan av en kollision.
              if (p.lastSpeed > 350) spawnSparks(p);
            }
  
          } else {
  
            p.wasResting = false;
  
            // När partikeln faller beräknas dess aktuella hastighet
            // med hjälp av Pythagoras sats.
            // Detta används senare för att avgöra hur tydligt
            // rörelsespåret ska visas.
            if (p.state === 'falling') {
              p.lastSpeed = Math.sqrt(
                p.vx * p.vx + p.vy * p.vy
              );
            }
          }
  
  
          // heat minskar successivt efter en landning.
          // dt gör att avklingningen blir beroende av tidsförloppet
          // istället för antalet bildrutor.
          if (p.heat > 0) {
            p.heat = Math.max(0, p.heat - dt * 1.1);
          }
  
  
          // depth anger partikelns djup i den simulerade miljön.
          // far beskriver hur långt bort partikeln befinner sig.
          const d = p.depth;
          const far = 1 - d;
  
          // twinkle skapar en liten regelbunden variation i ljusstyrkan.
          // Varje partikel får en egen fas genom p.phase.
          const twinkle =
            .78 + .22 * Math.sin(
              now * (1.5 + d * 3.5) + p.phase * 5
            );
  
          // glint skapar korta, intensiva ljusreflexer.
          // Potensen 48 gör att ljusreflexen blir mycket kortvarig
          // och endast syns nära sinusfunktionens maximala värde.
          const glint =
            Math.pow(
              Math.max(0, Math.sin(now * .9 + p.phase * 13)),
              48
            ) * (1 + a.high * 1.5);
  
  
          // beamBoost beräknar hur nära partikeln befinner sig en ljusstråle.
          // När partikeln är nära ljuset kan dess visuella ljusstyrka öka.
          const boost = beams.length
            ? beamBoost(p, beams)
            : 0;
  
  
          // Beräknar partikelns slutliga transparens.
          // Faktorerna kombinerar djup, blinkning, partikelns tillstånd,
          // ljuspåverkan och atmosfäriskt perspektiv.
          const al =
            d *
            twinkle *
            (resting ? .38 : .95) *
            (1 + boost * 1.6 + glint * 2.2) *
            (1 - .5 * far);
  
  
          // Beräknar partikelns storlek.
          // Partiklar på större djup blir mindre.
          // Storleken påverkas även av klappens puls, ljusreflexer
          // och närhet till ljusstrålar.
          const s = Math.min(
            MAX,
            Math.max(3.2, p.size * d * 6.5) *
            sizeBoost *
            (1 + glint * .5 + boost * .15)
          );
  
  
          // Mikrorörelserna påverkar endast den visuella positionen.
          // Den ursprungliga fysikens koordinater ändras inte.
          // Detta gör att partiklarna kan upplevas som levande
          // även när deras huvudsakliga rörelse är begränsad.
          const mo = P.micro * (1.2 - d);
  
          const x =
            p.x +
            (p.state === 'floating'
              ? Math.sin(now * 1.7 + p.phase * 9) * .7 * mo
              : 0);
  
          const y =
            p.y +
            (p.state === 'floating'
              ? Math.cos(now * 1.3 + p.phase * 7) * .7 * mo
              : 0);
  
  
          // Avlägsna partiklar får en gemensam färgnyans.
          // Detta bidrar till atmosfäriskt perspektiv genom att
          // färgerna blir mer lika dimmans blå ton.
          const hi = d < .5 ? 1 : p.hue;
  
          // blur beräknar hur mycket partikeln ska påverkas av skärpedjupet.
          // Om dof är avstängt blir blur alltid noll.
          const blur = P.dof ? Math.abs(d - .78) : 0;
  
  
          // Om partikeln befinner sig tillräckligt långt från det
          // definierade skärpedjupsområdet ritas den som en oskarp bokeh.
          if (blur > .3 && s > 4.5) {
  
            const bs = s * 1.8;
  
            ctx.globalAlpha = Math.min(1, al * .55);
  
            ctx.drawImage(
              bk[hi],
              x - bs / 2,
              y - bs / 2,
              bs,
              bs
            );
  
          } else {
  
            // Om partikeln faller snabbt skapas ett rörelsespår.
            // Antalet spårbilder bestäms av partikelns hastighet.
            if (p.state === 'falling' && p.lastSpeed > 250) {
  
              const steps = p.lastSpeed > 900 ? 3 : 2;
  
              for (let k = 1; k <= steps; k++) {
  
                // Varje efterföljande bild blir något mindre.
                const sk = s * (1 - .12 * k);
  
                // Transparensen minskar för varje steg.
                ctx.globalAlpha = Math.min(1, al * .45 / k);
  
                // Partikelns hastighetsvektor används för att placera
                // efterbilderna bakom den aktuella positionen.
                ctx.drawImage(
                  sp[hi],
                  x - p.vx * .0075 * k - sk / 2,
                  y - p.vy * .0075 * k - sk / 2,
                  sk,
                  sk
                );
              }
            }
  
            // Ritar själva partikeln.
            ctx.globalAlpha = Math.min(1, al);
  
            ctx.drawImage(
              sp[hi],
              x - s / 2,
              y - s / 2,
              s,
              s
            );
          }
  
  
          // Om partikeln har ett värmevärde över en viss gräns
          // ritas en större ljusbild runt den.
          // Effekten används för att simulera efterglöd efter en landning.
          if (p.heat > .05) {
  
            const hs = s * 2.2;
  
            ctx.globalAlpha = Math.min(
              1,
              p.heat * .7 * d
            );
  
            ctx.drawImage(
              sp[hi],
              x - hs / 2,
              y - hs / 2,
              hs,
              hs
            );
          }
        }
  
  
        // Gnistor och dammpartiklar som uppstår vid landningar hanteras
        // separat från huvudpartiklarna.
        // Baklänges iteration gör att element kan tas bort ur arrayen
        // utan att efterföljande element hoppas över.
        for (let i = sparks.length - 1; i >= 0; i--) {
  
          const q = sparks[i];
  
          // Minskar gnistans återstående livslängd.
          q.life -= dt;
  
          // Om livslängden är slut tas gnistan bort.
          // Den sista arrayposten flyttas till den borttagna positionen.
          // Detta är ett effektivt sätt att ta bort element utan splice().
          if (q.life <= 0) {
  
            sparks[i] = sparks[sparks.length - 1];
            sparks.pop();
  
            continue;
          }
  
          // Uppdaterar gnistans hastighet med hjälp av acceleration.
          q.vx += q.ax * dt;
          q.vy += q.ay * dt;
  
          // Dämpar hastigheten så att gnistan gradvis tappar fart.
          q.vx *= 1 - 1.5 * dt;
          q.vy *= 1 - 1.5 * dt;
  
          // Uppdaterar gnistans position.
          q.x += q.vx * dt;
          q.y += q.vy * dt;
  
          // k anger hur stor del av gnistans livslängd som återstår.
          // Detta används för att beräkna storlek och transparens.
          const k = q.life / q.max;
          const ss = q.size * (.6 + .4 * k);
  
          ctx.globalAlpha = k * k * .9;
  
          ctx.drawImage(
            sp[q.hue],
            q.x - ss / 2,
            q.y - ss / 2,
            ss,
            ss
          );
        }
  
        // Återställer tidigare ritinställningar.
        ctx.restore();
  
  
        // Tryckvågor tas bort när de har existerat längre än 1,2 sekunder.
        // filter() skapar en ny array med endast de ringar som fortfarande
        // ska visas.
        rings = rings.filter(r => now - r.t0 < 1.2);
  
        for (const r of rings) {
  
          const age = now - r.t0;
  
          if (age < 0) continue;
  
          // Tryckvågens transparens minskar successivt med dess ålder.
          ctx.strokeStyle =
            `hsla(${PAL[HUES.indexOf(r.hue) % 5 < 0 ? 0 : HUES.indexOf(r.hue) % 5]},90%,70%,${(1 - age / 1.2) * VIS.post.rings})`;
  
          ctx.lineWidth = 2;
          ctx.beginPath();
  
          // Tryckvågen ritas som en cirkel som växer ut från skärmens mitt.
          ctx.arc(
            width / 2,
            height * .5,
            age * width * .5,
            0,
            TWO_PI
          );
  
          ctx.stroke();
        }
  
  
        // flash används för en kortvarig vit ljusblixt.
        // Den kan exempelvis kopplas till en kraftigare händelse i simuleringen.
        if (flash > 0) {
  
          // Sinusfunktionen skapar ett snabbt flimmer i blixtens intensitet.
          ctx.fillStyle =
            `rgba(255,255,255,${flash * .25 *
            (Math.sin(now * 90) > 0 ? 1 : .3)})`;
  
          ctx.fillRect(0, 0, width, height);
  
          // Minskar blixtens styrka över tid.
          flash -= dt * 3.5;
        }
  
        // Återställer transparens och blandningsläge så att efterföljande
        // ritfunktioner inte påverkas av partikelsystemets inställningar.
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  
    /* ---------- 4. GOLV: GLÖD, SPEGLING OCH LÅGT LIGGANDE DIMMA ---------- */
  
    // En separat canvas används tillfälligt för att skapa golvreflektionen.
    // rf innehåller den speglade bilden och rg är dess ritkontext.
    // Genom att använda en separat canvas kan reflektionen bearbetas
    // innan den ritas ut i det slutliga golvlagret.
  
    const rf = document.createElement('canvas');
    const rg = rf.getContext('2d');
  
  
    const Floor = {
  
      draw(now, a) {
  
        const { c, g } = L.floor;
        const w = c.width;
        const h = c.height;
        const fy = floorY;
  
        // Rensar golvlagret inför varje ny bildruta.
        g.clearRect(0, 0, w, h);
  
        // Om golvet är avstängt behöver inga fler effekter ritas.
        if (!VIS.floor.enabled) return;
  
        // Ljus från olika effekter adderas med varandra.
        g.globalCompositeOperation = 'lighter';
  
  
        // Beräknar höjden på området under golvlinjen.
        const rh = Math.floor(h - fy);
  
  
        // ---------------- SPEGLING ----------------
  
        // Om reflection är större än noll och golvytan har tillräcklig
        // höjd skapas en spegling av partiklarna.
        if (VIS.floor.reflection > 0 && rh > 4) {
  
          // Anpassar reflektionscanvasens storlek vid behov.
          if (rf.width !== w || rf.height !== rh) {
            rf.width = w;
            rf.height = rh;
          }
  
          // Rensar den tillfälliga canvasen.
          rg.globalCompositeOperation = 'source-over';
          rg.clearRect(0, 0, w, rh);
  
          // scale(1, -1) vänder bilden vertikalt.
          // På så sätt skapas en spegling av partikelcanvasens nedre del.
          rg.save();
          rg.scale(1, -1);
  
          rg.drawImage(
            pc,
            0, fy - rh, w, rh,
            0, -rh, w, rh
          );
  
          rg.restore();
  
  
          // destination-in kombinerar speglingen med en gradientmask.
          // Resultatet blir en reflektion som gradvis försvinner
          // ju längre ned på golvet den kommer.
          rg.globalCompositeOperation = 'destination-in';
  
          const m = rg.createLinearGradient(0, 0, 0, rh);
  
          m.addColorStop(0, 'rgba(0,0,0,.9)');
          m.addColorStop(.5, 'rgba(0,0,0,.25)');
          m.addColorStop(1, 'rgba(0,0,0,0)');
  
          rg.fillStyle = m;
          rg.fillRect(0, 0, w, rh);
  
  
          // Reflektionens transparens påverkas både av användarens
          // inställning och ljudets basnivå.
          g.globalAlpha =
            VIS.floor.reflection * (.55 + .2 * a.bass);
  
          // Delar upp reflektionen i fyra horisontella band.
          // Varje band förskjuts något olika för att skapa ett
          // vattenliknande och lätt förvrängt utseende.
          const bands = 4;
          const bh = rh / bands;
  
          for (let b = 0; b < bands; b++) {
  
            const off =
              Math.sin(now * 2 + b * 1.7) * (1 + K * 3);
  
            g.drawImage(
              rf,
              0, b * bh, w, bh,
              off, fy + 2 + b * bh, w, bh
            );
          }
        }
  
  
        // ---------------- LÅGT LIGGANDE DIMMA ----------------
  
        // groundFog aktiverar en separat dimmeffekt som ligger nära golvet.
        // Effekten består av flera lager för att skapa ett mer naturligt
        // och tredimensionellt intryck.
        if (VIS.floor.groundFog) {
  
          g.save();
  
          // screen gör att dimman blandas med bakgrunden på ett ljusare sätt.
          g.globalCompositeOperation = 'screen';
  
          const smokeHue = 190;
  
          // Hämtar ljudets energinivå och basnivå.
          // || 0 innebär att värdet blir noll om det saknas.
          const energy = a.energy || 0;
          const bass = a.bass || 0;
  
  
          // Varje lager har en egen höjd, spridning, transparens och hastighet.
          // Detta ger variation i hur röken rör sig längs golvet.
          const floorLayers = [
            { y: fy + 12, spread: 150, height: 48, alpha: 0.10, speed: 0.18 },
            { y: fy + 55, spread: 210, height: 65, alpha: 0.075, speed: 0.13 },
            { y: fy + 105, spread: 260, height: 80, alpha: 0.045, speed: 0.09 }
          ];
  
  
          // Går igenom samtliga dimlager.
          for (let layer = 0; layer < floorLayers.length; layer++) {
  
            const cfg = floorLayers[layer];
  
            // Antalet rökformationer anpassas efter skärmens bredd.
            const count = Math.ceil(w / 105);
  
            for (let i = 0; i < count; i++) {
  
              // Baspositionen för varje rökformation fördelas över skärmen.
              const baseX = (i / count) * w;
  
              // Sinusfunktionen skapar en långsam sidledsrörelse.
              const drift =
                Math.sin(now * cfg.speed + i * 1.7 + layer) *
                cfg.spread;
  
              const x = baseX + drift;
  
              // Även höjden varierar något över tid.
              const y =
                cfg.y + Math.sin(now * 0.25 + i * 2) * 18;
  
              // Bestämmer rökelementets horisontella och vertikala storlek.
              const rx =
                cfg.spread * (0.7 + Math.sin(now * 0.2 + i) * 0.2);
  
              const ry = cfg.height;
  
  
              // Skapar en radiell gradient som fungerar som en mjuk rökfläck.
              const grad = g.createRadialGradient(
                x, y, 2,
                x, y, rx
              );
  
              grad.addColorStop(
                0,
                `hsla(${smokeHue},45%,75%,${cfg.alpha})`
              );
  
              grad.addColorStop(
                0.45,
                `hsla(215,40%,65%,${cfg.alpha * 0.55})`
              );
  
              grad.addColorStop(
                1,
                'rgba(100,160,200,0)'
              );
  
              g.fillStyle = grad;
  
              // Genom att skala koordinatsystemet vertikalt skapas
              // en elliptisk form istället för en helt cirkulär rökfläck.
              g.save();
  
              g.translate(x, y);
              g.scale(1, ry / rx);
              g.translate(-x, -y);
  
              g.fillRect(
                x - rx, y - rx,
                rx * 2, rx * 2
              );
  
              g.restore();
            }
          }
  
  
          // ---------------- STIGANDE RÖK ----------------
  
          // Skapar ytterligare rökformationer som rör sig uppåt från golvet.
          // Dessa gör att miljön upplevs som mer tredimensionell.
          const roomSmokeCount = 18;
  
          for (let i = 0; i < roomSmokeCount; i++) {
  
            // Röken får en horisontell rörelse som varierar med tiden.
            const x =
              (i / roomSmokeCount) * w +
              Math.sin(now * 0.16 + i * 2.3) * 55;
  
            // rise bestämmer hur långt röken har hunnit stiga.
            // Modulo används för att börja om rörelsen när den når
            // en viss höjd, vilket skapar en kontinuerlig animation.
            const rise =
              (now * (12 + i % 5) + i * 83) % (h * 0.62);
  
            const y = fy - rise;
  
            // Olika rökformationer får olika radie.
            const radius = 45 + (i % 4) * 22;
  
            // Röken blir svagare ju högre upp den stiger.
            // energy ger dessutom en liten förstärkning vid ljudaktivitet.
            const alpha =
              (0.025 + energy * 0.012) *
              (1 - rise / (h * 0.72));
  
            const grad = g.createRadialGradient(
              x, y, 1,
              x, y, radius
            );
  
            grad.addColorStop(
              0,
              `hsla(195,38%,75%,${alpha})`
            );
  
            grad.addColorStop(
              0.4,
              `hsla(220,32%,65%,${alpha * 0.55})`
            );
  
            grad.addColorStop(
              1,
              'rgba(120,160,200,0)'
            );
  
            g.fillStyle = grad;
  
            g.fillRect(
              x - radius,
              y - radius,
              radius * 2,
              radius * 2
            );
          }
  
  
          // ---------------- DIMMA LÄNGS GOLVLINJEN ----------------
  
          // En linjär gradient används för att skapa ett tydligare
          // turkost ljus längs gränsen mellan vägg och golv.
          const lineFog = g.createLinearGradient(
            0, fy - 45,
            0, fy + 65
          );
  
          lineFog.addColorStop(
            0,
            'rgba(70,210,230,0)'
          );
  
          // Basljudet påverkar dimmans intensitet.
          lineFog.addColorStop(
            0.35,
            `rgba(70,210,230,${0.07 + bass * 0.025})`
          );
  
          lineFog.addColorStop(
            0.6,
            'rgba(90,190,225,0.055)'
          );
  
          lineFog.addColorStop(
            1,
            'rgba(70,210,230,0)'
          );
  
          g.fillStyle = lineFog;
  
          g.fillRect(
            0,
            fy - 45,
            w,
            110
          );
  
          // Återställer ritkontextens inställningar.
          g.restore();
        }
  
  
        // Här kan ytterligare golveffekter läggas till, exempelvis
        // en ljus kärna längs golvkanten eller ett starkare sken
        // som reagerar på partiklar som landar.
      }
    };
  
    /* ---------- 5. POST: BLOOM FRÅN EN NEDSKALAD, MJUK KOPIA ---------- */
  
    // sm är en separat canvas som används för att skapa bloom-effekten.
    // Genom att arbeta med en mindre kopia av partikelbilden kan
    // ljusområden spridas ut utan att hela originalbilden behöver
    // bearbetas i full upplösning.
  
    const sm = document.createElement('canvas');
    const sg = sm.getContext('2d');
  
  
    const Post = {
  
      draw(a) {
  
        const { c, g } = L.post;
        const w = c.width;
        const h = c.height;
  
        // Rensar det tidigare innehållet i efterbearbetningslagret.
        g.clearRect(0, 0, w, h);
  
        // Om postprocesseringen är avstängd eller bloom-värdet är noll
        // avslutas funktionen direkt.
        if (!VIS.post.enabled || VIS.post.bloom <= 0) return;
  
        // sc bestämmer hur mycket bilden ska skalas ned.
        // Ju större sc är, desto mindre blir arbetsbilden.
        const sc = QUAL[VIS.quality].bloom;
  
        const bw = Math.ceil(w / sc);
        const bh = Math.ceil(h / sc);
  
        // Anpassar den mindre canvasens storlek vid behov.
        if (sm.width !== bw || sm.height !== bh) {
          sm.width = bw;
          sm.height = bh;
        }
  
        // Rensar den mindre arbetsbilden.
        sg.clearRect(0, 0, bw, bh);
  
        // blur gör bilden mjukare och sprider ljusa pixlar.
        // Effekten används för att skapa bloom, alltså en ljusgloria
        // runt objekt som har hög ljusintensitet.
        sg.filter = 'blur(1.5px)';
  
        // Kopierar den ursprungliga partikelcanvasen till den mindre canvasen.
        // Bilden skalas ned vilket också minskar mängden data som behöver
        // behandlas i nästa steg.
        sg.drawImage(pc, 0, 0, bw, bh);
  
        // lighter gör att den suddade kopian adderas till ljuset
        // i det ursprungliga visuella lagret.
        g.globalCompositeOperation = 'lighter';
  
        // Bloom-intensiteten påverkas av användarens inställning
        // och ljudets energinivå.
        g.globalAlpha =
          VIS.post.bloom * (.8 + .3 * a.energy);
  
        g.imageSmoothingEnabled = true;
  
        // Den nedskalade bilden förstoras tillbaka till skärmens storlek.
        // Eftersom bilden redan har suddats skapas en mjuk ljusspridning.
        g.drawImage(sm, 0, 0, w, h);
  
        // Återställer standardinställningarna.
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    };
  
    /* ---------- 6. LJUDNIVÅER: ETT BAND PER LAGER ---------- */
  
    // A innehåller de värden som beskriver ljudets aktuella egenskaper.
    // Dessa värden uppdateras kontinuerligt och används av exempelvis
    // dimman, ljusstrålarna och partiklarna.
    //
    // Genom att dela upp ljudet i olika frekvensområden kan olika
    // visuella effekter reagera på olika delar av ljudsignalen.
  
    const A = {
  
      // Bass, mid och high representerar bas, mellanregister och diskant.
      bass: 0,
      high: 0,
  
      // energy beskriver ljudets sammanlagda energinivå.
      energy: 0,
  
      // beat används för att skapa kortvariga visuella pulser.
      beat: 0,
  
      // breath skapar en långsam grundrörelse även i tystnad.
      breath: 0,
  
      // fix anger vilken ljuskälla som för tillfället ska reagera på beat.
      fix: 0,
  
      // an innehåller Web Audio API:s analysator.
      an: null,
  
      // buf innehåller ljudets frekvensdata.
      buf: null,
  
      // pk lagrar tidigare toppnivåer för respektive frekvensband.
      // Detta används för att normalisera ljudnivåerna.
      pk: {
        b: .25,
        m: .25,
        h: .25
      },
  
      // prevBass sparar föregående basvärde för att upptäcka förändringar.
      prevBass: 0,
  
      // beatAt sparar tidpunkten för det senaste identifierade beatet.
      beatAt: 0
    };
  
  
    // Initierar ljudanalysen.
    // Funktionen använder Web Audio API för att läsa av ljudets frekvenser.
  
    function audioInit() {
  
      // Kontrollerar att analysatorn inte redan finns,
      // att huvudprogrammets ljudsystem är tillgängligt
      // och att ljudanalysen är aktiverad.
      if (A.an || !master || !VIS.audio.enabled) return;
  
      // Skapar en separat analysator.
      // Denna analyserar ljudsignalen utan att behöva förändra själva ljudet.
      A.an = audioCtx.createAnalyser();
  
      // fftSize bestämmer hur många datapunkter som används
      // vid frekvensanalysen.
      // Ett värde på 1024 ger en balans mellan frekvensupplösning
      // och hur snabbt analysen kan uppdateras.
      A.an.fftSize = 1024;
  
      // smoothingTimeConstant jämnar ut variationer mellan mätningar.
      // Ett högre värde ger generellt mjukare förändringar.
      A.an.smoothingTimeConstant = .6;
  
      // Kopplar analysatorn till programmets master-signal.
      // Anslutningen används för analys och behöver inte förändra ljudet.
      master.connect(A.an);
  
      // Skapar en array där frekvensvärdena lagras.
      A.buf = new Uint8Array(A.an.frequencyBinCount);
    }
  
  
    // band beräknar medelvärdet för ett visst intervall i frekvensarrayen.
    // i0 anger första index och i1 anger det första index som inte ska ingå.
    //
    // Resultatet divideras med 255 eftersom frekvensvärdena representeras
    // som heltal mellan 0 och 255.
  
    function band(i0, i1) {
  
      let s = 0;
  
      for (let i = i0; i < i1; i++) {
        s += A.buf[i];
      }
  
      return s / (i1 - i0) / 255;
    }
  
  
    // ease används för att skapa mjuka övergångar mellan två värden.
    // Funktionen gör att ljudets visuella påverkan inte förändras
    // abrupt när ljudnivån varierar.
    //
    // atk bestämmer hur snabbt värdet stiger.
    // rel bestämmer hur snabbt värdet sjunker.
    // dt gör att utjämningen blir tidsbaserad.
  
    function ease(v, t, dt, atk, rel) {
  
      return v + (t - v) *
        (1 - Math.exp(-dt / (t > v ? atk : rel)));
    }
  
  
    // Uppdaterar ljudanalysen och beräknar de värden som ska användas
    // av programmets visuella effekter.
  
    function audioUpdate(now, dt) {
  
      let b = 0;
      let m = 0;
      let hi = 0;
  
      // Om analysatorn finns hämtas aktuell frekvensdata.
      if (A.an) {
  
        A.an.getByteFrequencyData(A.buf);
  
        // Delar upp frekvensinformationen i tre olika band.
        // Indexintervallen motsvarar ungefär olika delar av ljudspektrumet.
        const rb = band(1, 5);
        const rm = band(5, 40);
        const rh = band(60, 250);
  
        // Sparar den högsta uppmätta nivån för varje frekvensband.
        // Topparna minskar mycket långsamt över tid.
        // Detta gör det möjligt att anpassa normaliseringen till ljudet.
        A.pk.b = Math.max(rb, A.pk.b * .995);
        A.pk.m = Math.max(rm, A.pk.m * .995);
        A.pk.h = Math.max(rh, A.pk.h * .995);
  
        // Normaliserar ljudnivåerna genom att dividera med respektive
        // toppvärde. Math.max säkerställer att nämnaren inte blir för liten.
        b = rb / Math.max(A.pk.b, .25);
        m = rm / Math.max(A.pk.m, .25);
        hi = rh / Math.max(A.pk.h, .25);
  
  
        // Beat detekteras genom att kontrollera om basnivån ökat snabbt.
        // Skillnaden mellan nuvarande och föregående värde måste vara
        // större än 0.12.
        //
        // Villkoret now > A.beatAt + .25 fungerar som en spärr som
        // förhindrar att flera beats registreras alltför tätt.
        if (rb - A.prevBass > .12 && now > A.beatAt + .25) {
  
          // Aktiverar en ny beatpuls.
          A.beat = 1;
  
          // Växlar till nästa ljuskälla.
          A.fix = (A.fix + 1) % FIX.length;
  
          // Sparar tidpunkten för den identifierade händelsen.
          A.beatAt = now;
        }
  
        // Sparar basnivån inför nästa uppdatering.
        A.prevBass = rb;
      }
  
  
      // Skapar en långsam sinusbaserad grundrörelse.
      // Denna gör att miljön fortsätter att leva även när inget ljud spelas.
      A.breath = VIS.audio.breath
        ? .5 + .5 * Math.sin(now * .25)
        : 0;
  
  
      // ease används för att jämna ut förändringarna i de olika ljudbanden.
      // Bass reagerar relativt snabbt på förändringar men avtar långsammare.
      A.bass = ease(
        A.bass,
        Math.max(b, A.breath * .15),
        dt,
        .05,
        .5
      );
  
      // Diskanten reagerar snabbt, vilket gör att korta ljuddetaljer
      // kan påverka de visuella effekterna.
      A.high = ease(
        A.high,
        hi,
        dt,
        .03,
        .15
      );
  
      // energy beräknas som medelvärdet av de tre ljudbanden.
      // Resultatet jämnas sedan ut för att skapa en stabil helhetsnivå.
      A.energy = ease(
        A.energy,
        (b + m + hi) / 3,
        dt,
        .4,
        3
      );
  
      // Beatpulsen avtar exponentiellt.
      // Detta gör att den visuella reaktionen blir kortvarig.
      A.beat *= Math.exp(-dt * 6);
    }
  
    /* ---------- KOPPLING TILL ORIGINALKODEN ---------- */
  
    // Här kopplas det nya visuella systemet samman med huvudprogrammet.
    // Istället för att använda programmets ursprungliga render-funktion
    // ersätts den med en ny funktion som ansvarar för samtliga visuella lager.
    //
    // Detta gör att den befintliga fysiksimuleringen kan behållas samtidigt
    // som presentationen av partiklarna och miljön förändras.
  
  
    window.render = function (now, dt) {
  
      // Initierar canvaslagren första gången render() körs.
      // Kontrollen förhindrar att samma lager skapas flera gånger.
      if (!pc) init();
  
      // Startar ljudanalysen om den inte redan är aktiv.
      // Därefter uppdateras ljudvärdena inför den aktuella bildrutan.
      audioInit();
      audioUpdate(now, dt);
  
      // Varje lager ritas i en bestämd ordning.
      // Ordningen är viktig eftersom vissa effekter ska visas bakom
      // andra och andra ska ligga ovanpå partikelgrafiken.
  
      Fog.draw(now, A);       // Ritar dimman bakom ljuset och partiklarna.
      Lights.draw(now, A);    // Ritar ljusstrålar och ljuskällor.
      Parts.draw(now, dt, A); // Ritar partiklar och deras effekter.
      Floor.draw(now, A);     // Ritar golv, reflektioner och markdimma.
      Post.draw(A);           // Lägger till den avslutande bloom-effekten.
  
      // Finalens gemensamma nedtoning av samtliga visuella lager.
      const fadeProgress = finaleFadeAt === null
        ? 0
        : Math.max(0, Math.min(1,
            (now - finaleFadeAt) / FINAL_FADE_SECS
          ));
  
      const { c, g } = L.finalFade;
  
      g.clearRect(0, 0, c.width, c.height);
  
      if (fadeProgress > 0) {
        g.fillStyle = `rgba(0, 0, 0, ${fadeProgress})`;
        g.fillRect(0, 0, c.width, c.height);
      }
    };
  
  
    // Sparar en referens till programmets ursprungliga build-funktion.
    // Det är viktigt eftersom den funktionen fortfarande behövs för
    // att uppdatera huvudprogrammets egna komponenter.
  
    const origBuild = window.build;
  
  
    // Ersätter build-funktionen med en utökad version.
    // Först körs originalfunktionen och därefter anpassas de nya
    // visuella canvaslagren till den aktuella skärmstorleken.
  
    window.build = function () {
  
      origBuild();
  
      if (L.env) resize();
    };
  
  
    // Sparar den ursprungliga tangentbordsfunktionen.
    // Detta gör det möjligt att behålla huvudprogrammets befintliga
    // tangentbordsfunktioner även efter att nya kontroller har lagts till.
  
    const origKey = window.keyPressed;
  
  
    window.keyPressed = function () {
  
      // Hämtar den aktuella tangenten och omvandlar den till gemener.
      // Detta gör att både stora och små bokstäver hanteras på samma sätt.
      const k =
        (typeof key === 'string')
          ? key.toLowerCase()
          : '';
  
      // Kopplar tangenterna till respektive visuellt lager.
      const map = {
        e: 'env',
        f: 'fog',
        l: 'lights',
        g: 'floor',
        b: 'post'
      };
  
      // Om en tangent finns i map växlas motsvarande lagers enabled-värde.
      if (map[k]) {
  
        VIS[map[k]].enabled = !VIS[map[k]].enabled;
  
        // Om bakgrunden ändras måste den ritas om direkt
        // eftersom miljön inte uppdateras varje bildruta.
        if (k === 'e') Env.draw();
  
        // false används för att markera att tangenttryckningen
        // har hanterats av denna funktion.
        return false;
      }
  
  
      // Tangenten Q växlar mellan kvalitetsinställningarna.
      if (k === 'q') {
  
        // Hämtar kvalitetsalternativen från QUAL.
        const o = Object.keys(QUAL);
  
        // Hittar nuvarande kvalitetsnivå och flyttar till nästa.
        // Modulo gör att listan börjar om när sista alternativet nås.
        VIS.quality =
          o[(o.indexOf(VIS.quality) + 1) % o.length];
  
        return false;
      }
  
  
      // Om tangenten inte används av det nya visuella systemet
      // skickas anropet vidare till programmets ursprungliga funktion.
      // På så sätt behålls befintliga tangentbordsfunktioner.
      return origKey.apply(this, arguments);
    };
  
  
    // Avslutar det omedelbart anropade funktionsuttrycket.
    // Alla interna variabler och funktioner förblir lokala,
    // förutom de funktioner och objekt som uttryckligen har kopplats
    // till window och därmed gjorts tillgängliga globalt.
  
  })();