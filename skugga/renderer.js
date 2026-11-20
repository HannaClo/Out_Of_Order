
// renderer.js – kalibrering + ritning av skuggan
// Lager (alla billiga): 1 ljuspool, 2 golvreflektion, 3 kontaktskuggor, 4 golvskuggor (platta, lutade),
// 5 två färgade förskjutna skuggor (multiply), 6 kärnskugga: skarp vid fötterna, mjuk uppåt.
// Oskärpa = liten buffert som skalas upp (funkar i Safari). Använder rgba() och fade() från environment.js.

// Här sparar jag namnet på nyckeln som används när kalibreringen lagras i webbläsarens localStorage.
// På så sätt kan jag hitta samma inställningar nästa gång sidan öppnas.
const CAL_KEY = 'skuggvarlden.cal';

class ShadowRenderer {
  constructor(cfg) {
    // Jag sparar konfigurationen som skickas in och skapar en tom buffert för den mjuka skuggan.
    this.cfg = cfg; this.buf = null;

    // Här börjar jag med standardvärden för kalibreringen:
    // ingen förflyttning, normal storlek och samma spegling som anges i konfigurationen.
    this.cal = { offX: 0, offY: 0, scale: 1, mirror: cfg.mirror };

    // Jag försöker läsa tidigare kalibreringsinställningar från webbläsaren.
    // Object.assign skriver över standardvärdena med de värden som har sparats.
    // Om läsningen eller JSON-tolkningen misslyckas fångar catch felet så att programmet kan fortsätta.
    try { Object.assign(this.cal, JSON.parse(localStorage.getItem(CAL_KEY) || '{}')); } catch (e) {}
  }

  // Jag sparar den aktuella kalibreringen som JSON i localStorage.
  // Då finns inställningarna kvar även efter att sidan har stängts eller laddats om.
  save() { try { localStorage.setItem(CAL_KEY, JSON.stringify(this.cal)); } catch (e) {} }

  // Kalibrering: pilar = flytta, +/- = skala, M = spegla, R = nollställ
  calKey(kc, k) {
    const c = this.cal;

    // Pilarna flyttar skuggans position lite i taget.
    // Eftersom värdena är relativa till skärmens bredd och höjd blir förflyttningen proportionell.
    if (kc === LEFT_ARROW) c.offX -= 0.01;
    if (kc === RIGHT_ARROW) c.offX += 0.01;
    if (kc === UP_ARROW) c.offY -= 0.01;
    if (kc === DOWN_ARROW) c.offY += 0.01;

    // Plus och minus ändrar skuggans storlek genom att multiplicera eller dividera skalan med 1.02.
    if (k === '+' || k === '=') c.scale *= 1.02;
    if (k === '-') c.scale /= 1.02;

    // M växlar mellan speglad och ospeglad visning.
    if (k === 'm' || k === 'M') c.mirror = !c.mirror;

    // R återställer position och storlek till standardvärden.
    if (k === 'r' || k === 'R') Object.assign(c, { offX: 0, offY: 0, scale: 1 });

    // Efter varje tangenttryckning sparar jag ändringarna direkt.
    this.save();
  }

  // Kamerapunkt -> skärmpunkt (confidence följer med)
  mapPoint(p, vw, vh) {
    const c = this.cal,

          // Jag räknar ut en grundskala utifrån förhållandet mellan skärmens och videons höjd.
          // Den används för att placera kamerans koordinater i samma skala som canvasen.
          base = height / vh,

          // u är punktens relativa position i sidled.
          // Om spegling är aktiverad vänder jag på x-koordinaten så att rörelsen fungerar som i en spegel.
          u = c.mirror ? 1 - p.x / vw : p.x / vw;

    // Jag räknar om kamerans x- och y-koordinater till skärmkoordinater.
    // Här lägger jag även till kalibreringens skalning och förskjutning.
    // c och miss följer med eftersom de innehåller information om punktens säkerhet och eventuell spårningsförlust.
    return { x: width / 2 + (u - 0.5) * vw * base * c.scale + c.offX * width,
             y: height / 2 + (p.y / vh - 0.5) * vh * base * c.scale + c.offY * height, c: p.c, miss: p.miss };
  }

  // Jag använder mapPoint för varje led i kroppen.
  // Resultatet blir ett nytt objekt där alla leder har koordinater anpassade till skärmen.
  mapPose(J, vw, vh) { const o = {}; for (const n in J) o[n] = this.mapPoint(J[n], vw, vh); return o; }

  // Reservbakgrund om Environment saknas
  drawBackground() {
    // Jag hämtar bakgrundsfärgen från konfigurationen och använder canvasens ritkontext.
    const b = this.cfg.bg, ctx = drawingContext,

          // Här skapar jag en radiell gradient som är ljusare i mitten och mörkare längre ut.
          // Det ger bakgrunden lite djup även om den vanliga miljön inte används.
          g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height);

    // Jag lägger till två färgstopp i gradienten.
    // Det första är ljusare än grundfärgen och det andra är mörkare.
    g.addColorStop(0, `rgb(${b[0] + 22},${b[1] + 22},${b[2] + 22})`);
    g.addColorStop(1, `rgb(${b[0] - 20},${b[1] - 20},${b[2] - 20})`);

    // Till sist fyller jag hela canvasen med gradienten.
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  }

  // Huvudets mitt, robust när huvudet vrids (ett öra döljs): faller tillbaka på näsa/hals
  headCenter(J, S) {
    // Jag hämtar gränsen för hur säker en ledpunkt måste vara för att användas.
    // En punkt godkänns om den har tillräcklig confidence och inte har varit saknad för länge.
    const mc = this.cfg.minConfidence, ok = p => p && (p.c == null || p.c >= mc) && (p.miss == null || p.miss < 30),

          // Den här hjälpfunktionen räknar ut mittpunkten mellan två koordinater.
          mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),

          // Jag hämtar de punkter jag kan använda för att uppskatta huvudets mitt.
          le = J.left_ear, re = J.right_ear, n = J.nose;

    // Om båda öronen är tillförlitliga använder jag mittpunkten mellan dem.
    if (ok(le) && ok(re)) return mid(le, re);

    // Om bara vänster öra och näsan är tillförlitliga använder jag deras mittpunkt.
    if (ok(n) && ok(le)) return mid(n, le);

    // Samma princip gäller om det är höger öra och näsan som är synliga.
    if (ok(n) && ok(re)) return mid(n, re);

    // Om bara näsan går att använda placerar jag huvudets mitt lite ovanför den.
    if (ok(n)) return { x: n.x, y: n.y - 0.05 * S };

    // Om inte heller näsan är tillförlitlig använder jag halsen och mitten av höfterna.
    // Jag räknar ut riktningen från höfterna mot halsen och fortsätter den uppåt
    // för att uppskatta var huvudet borde vara.
    const nk = J.neck, hm = J.hipMid, ul = Math.hypot(nk.x - hm.x, nk.y - hm.y) || 1;
    return { x: nk.x + (nk.x - hm.x) / ul * 0.7 * S, y: nk.y + (nk.y - hm.y) / ul * 0.7 * S };
  }

  // Mjuk buffert (halv upplösning), uppskalning = gratis oskärpa
  _buffer() {
    // Jag skapar bufferten med halva canvasens bredd och höjd.
    // När den senare ritas upp i full storlek blir resultatet mjukare och mindre detaljrikt.
    const w = Math.ceil(width * 0.5), h = Math.ceil(height * 0.5);

    // Om bufferten inte finns eller om skärmens storlek har ändrats skapar jag en ny.
    if (!this.buf || this.buf.width !== w || this.buf.height !== h) { this.buf = createGraphics(w, h); this.buf.pixelDensity(1); }
    return this.buf;
  }

  // Skarp buffert i full upplösning (kontaktskuggan)
  _sharpBuf() {
    // Den här bufferten har samma upplösning som huvudcanvasen.
    // Jag använder den för den skarpare delen av skuggan nära fötterna.
    if (!this.sharp || this.sharp.width !== width || this.sharp.height !== height) { this.sharp = createGraphics(width, height); this.sharp.pixelDensity(1); this._pb = null; }
    return this.sharp;
  }

  // Kroppen i färg col, upplösning k, förskjuten dx px i sidled (+ ev. matris m), i mjuka bufferten
  _soft(J, S, g, k, col, dx, m) {
    // Jag hämtar den mindre bufferten och tömmer den innan jag ritar nästa skugga.
    const b = this._buffer();
    b.drawingContext.clearRect(0, 0, b.width, b.height);

    // Jag förbereder ritningen genom att ändra skalan och eventuellt flytta eller transformera kroppen.
    // Om en matris skickas in används den också för att förändra figurens form eller position.
    // Därefter ritar jag kroppen i den angivna färgen.
    b.push(); b.scale(k); b.translate(dx, 0); if (m) b.applyMatrix(...m); b.noStroke(); this.body(b, J, S, g, col); b.pop();
    return b;
  }

  // Buffert -> huvudcanvas. region = [x0,y0,x1,y1] i skärmpixlar (annars hela), flipY = spegla kring y, mode = blandningsläge
  _blit(b, k, alpha, flipY, mode, region) {
    const ctx = drawingContext, r = region || [0, 0, width, height];

    // Jag sparar ritkontextens inställningar så att ändringarna bara påverkar den här ritningen.
    // Alpha styr genomskinligheten och blandningsläget kan exempelvis vara multiply.
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (mode) ctx.globalCompositeOperation = mode;

    // Om flipY har ett värde speglar jag bufferten kring den angivna y-positionen.
    if (flipY != null) { ctx.translate(0, 2 * flipY); ctx.scale(1, -1); }

    // Jag kopierar sedan hela eller en utvald del av bufferten till huvudcanvasen.
    // k används för att räkna om koordinaterna från buffertens skala till skärmens skala.
    ctx.drawImage(b.elt, r[0] * k, r[1] * k, (r[2] - r[0]) * k, (r[3] - r[1]) * k, r[0], r[1], r[2] - r[0], r[3] - r[1]);
    ctx.restore();
  }

  // Mjuk svart ellips (kontaktskugga)
  _blob(x, y, rx, ry, alpha) {
    const ctx = drawingContext;

    // Jag flyttar ritningens origo till ellipsens position och ändrar dess höjd i förhållande till bredden.
    // På så sätt kan jag använda en cirkulär gradient för att skapa en utdragen, mjuk ellips.
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);

    // Jag skapar en svart radiell gradient som tonas från den angivna opaciteten till helt transparent.
    ctx.fillStyle = fade(ctx.createRadialGradient(0, 0, 0, 0, 0, rx), [0, 0, 0], alpha);
    ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
    ctx.restore();
  }

  // Maskar innehållet i c med gradienten g (destination-in) inom rutan x,y,w,h
  _mask(c, g, x, y, w, h) {
    // destination-in behåller bara de delar av innehållet som täcks av den nya formen.
    // Jag använder det här för att tona eller begränsa en skugga med hjälp av en gradient.
    c.save(); c.globalCompositeOperation = 'destination-in'; c.fillStyle = g; c.fillRect(x, y, w, h); c.restore();
  }

  // En riktig skuggan, inte en svart siluett:
  //  multiply (underlagets struktur syns) | två ljuskällor (rosa vänster => blå kant, blå höger => rosa kant, mörkast där de överlappar)
  //  kontaktskärpa (skarp vid fötterna, mjukare uppåt) | ljuspool (annars syns ingen skugga i mörker) | reflektion + kontaktskuggor
  // J = leder, a = fade 0..1, glow = puls 0..1 från miljön
  drawShadow(J, a, glow = 0.5, floorLine = 0) {
    // Jag samlar skuggans inställningar i sc. Om en inställning saknas i konfigurationen
    // används standardvärdet som står här. ...this.cfg.shadow gör att konfigurationens värden får företräde.
    const sc = { offset: 0.07, reflection: 0.22, contact: 0.5, pool: 0.24, strength: 0.92, hard: 3.2, floorCast: true, floorLean: 0.55, floorFlat: 0.22, ...this.cfg.shadow },

          // Jag gör samma sak för miljöns färger och hämtar färgerna från konfigurationen om de finns.
          en = { rimPink: [255, 40, 200], rimBlue: [40, 130, 255], ...this.cfg.env },

          // S är ett mått på personens storlek i bilden. Jag använder avståndet mellan axlarna,
          // men ser till att värdet aldrig blir mindre än 40 pixlar.
          S = Math.max(40, Math.hypot(J.left_shoulder.x - J.right_shoulder.x, J.left_shoulder.y - J.right_shoulder.y)),

          ctx = drawingContext,

          // Jag uppskattar golvnivån utifrån den fot som ligger lägst i bilden.
          fy = Math.max(J.left_ankle.y, J.right_ankle.y) + 0.1 * S,

          // fw beskriver hur mycket personen har kontakt med golvet.
          // Värdet begränsas till intervallet 0–1.
          fw = Math.max(0, Math.min(1, 1 + (fy - floorLine) / (0.5 * S)));

    // Jag beräknar huvudets mitt en gång och sparar den för användning när kroppen ritas.
    this._head = this.headCenter(J, S);

    // Rutan runt figuren: bara den delen av skärmen behandlas (prestanda)
    // Jag går igenom alla leder för att hitta kroppens yttersta koordinater.
    // På så sätt behöver jag inte bearbeta hela skärmen när jag ritar skuggan.
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n in J) { x0 = Math.min(x0, J[n].x); x1 = Math.max(x1, J[n].x); y0 = Math.min(y0, J[n].y); y1 = Math.max(y1, J[n].y); }

    // Jag lägger till en marginal runt kroppen så att även skuggans förskjutningar får plats.
    const m = 1.4 * S;
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(width, Math.ceil(x1 + m)); y1 = Math.min(height, Math.ceil(y1 + 1.0 * S));
    if (x1 <= x0 || y1 <= y0) return;

    // box innehåller området som ska ritas.
    // k bestämmer upplösningen på den mjuka skuggan och anpassas efter personens storlek.
    const box = [x0, y0, x1, y1], k = Math.min(0.5, Math.max(0.12, 1.5 / (0.08 * S)));

    // Ljuspool bakom figuren (additivt, lampornas färger)
    if (sc.pool > 0) {
      // lighter innebär att färgernas ljus adderas till det som redan finns på canvasen.
      ctx.save(); ctx.globalCompositeOperation = 'lighter';

      // Jag placerar två färgade ljusområden bakom kroppen, ett rosa och ett blått.
      // Deras styrka påverkas av skuggans genomskinlighet och miljöns ljuspuls.
      const p = sc.pool * a * (0.7 + 0.6 * glow), cy = J.neck.y + 1.2 * S, R = 4.5 * S;
      for (const [d, c] of [[-1.3, en.rimPink], [1.3, en.rimBlue]]) {
        const cx = J.neck.x + d * S;
        ctx.fillStyle = fade(ctx.createRadialGradient(cx, cy, 0, cx, cy, R), c, p); ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      }
      ctx.restore();
    }

    // Reflektion i golvet (spegelvänd, tonas ut nedåt)
    {
      // Jag ritar först en kopia av kroppen i den mindre bufferten.
      // Den används sedan som en spegelvänd reflektion under fötterna.
      const kr = 0.5, b = this._soft(J, S, 0, kr, 0, 0), bc = b.drawingContext;

      // Jag använder en gradientmask för att tona reflektionen.
      this._mask(bc, fade(bc.createLinearGradient(0, fy * kr, 0, (fy - 1.8 * S) * kr), [0, 0, 0], 1), 0, 0, b.width, b.height);

      // Reflektionen ritas bara om personen är tillräckligt nära golvet.
      if (fw > 0.01) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, floorLine, width, height - floorLine); ctx.clip(); // bara på golvet
        this._blit(b, kr, sc.reflection * a * fw, fy);
        ctx.restore();
      }
    }

    // Kontaktskuggor under fötterna
    // Jag ritar en bred skugga mellan fötterna och en mindre under varje fot.
    // Det gör att kroppen ser ut att stå på golvet i stället för att sväva.
    this._blob((J.left_ankle.x + J.right_ankle.x) / 2, fy, 1.1 * S, 0.22 * S, sc.contact * 0.6 * a * fw);
    for (const s of ['left', 'right']) this._blob(J[s + '_ankle'].x, fy, 0.5 * S, 0.12 * S, sc.contact * a * fw);

    // Golvskuggor: sidoljuset kastar kroppen platt längs golvet (rosa ljus => lutar åt höger, blått => åt vänster)
    if (fw > 0.02 && sc.floorCast) {
      // Jag använder en mindre upplösning för golvskuggorna och begränsar ritningen till området vid golvet.
      const kf = Math.min(0.5, k * 1.5), box2 = [0, Math.max(0, Math.floor(floorLine)), width, height],

            // sh styr hur långt skuggorna sträcks åt sidan.
            sh = sc.floorLean * (0.8 + 0.4 * glow), ky = sc.floorFlat,

            // Den här matrisen lutar och plattar till kroppen kring golvnivån.
            // s2 bestämmer lutningens riktning och storlek.
            mat = s2 => [1, 0, -s2, ky, s2 * fy, fy * (1 - ky)];

      // Jag ritar två golvskuggor i olika färger och med motsatt lutning.
      // multiply gör att skuggorna mörkar ner bakgrunden samtidigt som dess struktur syns.
      this._blit(this._soft(J, S, 0.02, kf, [45, 60, 255], 0, mat(sh)), kf, 0.7 * a * fw, null, 'multiply', box2);
      this._blit(this._soft(J, S, 0.02, kf, [255, 55, 110], 0, mat(-sh)), kf, 0.7 * a * fw, null, 'multiply', box2);
    }

    // De två ljuskällornas skuggor (multiply), avståndet pulserar svagt med musiken
    // Jag räknar ut hur långt de färgade skuggorna ska ligga från varandra.
    // glow gör att avståndet varierar lite med miljöns ljuspuls.
    const dx = sc.offset * S * (0.6 + 0.8 * glow), st = sc.strength * a;

    // Jag ritar den blå skuggan och den rosa skuggan lite förskjutna från varandra.
    // De representerar skuggor från två olika ljuskällor.
    this._blit(this._soft(J, S, 0.03, k, [45, 60, 255], dx), k, 0.85 * a, null, 'multiply', box);   // skugga av rosa ljus => blå
    this._blit(this._soft(J, S, 0.03, k, [255, 55, 110], -dx), k, 0.85 * a, null, 'multiply', box); // skugga av blått ljus => rosa

    // Kärnskugga med kontaktskärpa: skarp (full upplösning) vid fötterna, mjuk (låg upplösning) högre upp
    // Jag använder en separat buffert i full upplösning för den mörkaste delen av skuggan.
    const sb = this._sharpBuf(), bc = sb.drawingContext, pb = this._pb || box, CORE = [90, 70, 110], hardY = fy - sc.hard * S;

    // Jag tömmer bara det område som den föregående eller nuvarande skuggan täcker.
    // Det är ett sätt att minska mängden grafik som behöver rensas varje bildruta.
    bc.clearRect(Math.min(pb[0], x0), Math.min(pb[1], y0), Math.max(pb[2], x1) - Math.min(pb[0], x0), Math.max(pb[3], y1) - Math.min(pb[1], y0));
    this._pb = box;

    // Jag ritar kroppens kärnskugga i full upplösning.
    sb.noStroke(); this.body(sb, J, S, 0, CORE);

    // Gradientmasken gör att den skarpa skuggan tonas av ovanför hardY.
    this._mask(bc, fade(bc.createLinearGradient(0, fy, 0, hardY), [0, 0, 0], 1), x0, y0, x1 - x0, y1 - y0);

    // Jag skapar också en mjuk version av samma kärnskugga i den mindre bufferten.
    const nb = this._soft(J, S, 0.02, k, CORE, 0), nc = nb.drawingContext, gr = nc.createLinearGradient(0, fy * k, 0, hardY * k);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    this._mask(nc, gr, 0, 0, nb.width, nb.height);

    // 'lighter' adderar alfa: skarp*m + mjuk*(1-m) = 1 inuti figuren, ingen ljusare övergång
    // Jag lägger den mjuka versionen ovanpå den skarpa med additiv blandning.
    // På så sätt får jag en jämn övergång mellan skarp skugga nära golvet och mjukare skugga högre upp.
    bc.save(); bc.globalCompositeOperation = 'lighter';
    bc.drawImage(nb.elt, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, x0, y0, x1 - x0, y1 - y0);
    bc.restore();

    // Till sist ritar jag kärnskuggan på huvudcanvasen med multiply och använder st som genomskinlighet.
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, st)); ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(sb.elt, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  // Ritar kroppen EN gång. P = ritmål (window eller p5.Graphics), g = svällning, col = färg
  body(P, J, S, g, col) {
    // Jag hämtar de centrala punkterna som behövs för att bygga kroppens form.
    const hm = J.hipMid, nk = J.neck, ls = J.left_shoulder, rs = J.right_shoulder;

    // ell ritar en ellips vid en ledpunkt.
    // Jag kan ange bredd, höjd och vinkel, och g används för att göra formen lite större.
    const ell = (p, w, h, ang) => { P.push(); P.translate(p.x, p.y); P.rotate(ang); P.ellipse(0, 0, (w + 2 * g) * S, (h + 2 * g) * S); P.pop(); };

    const seg = (A, B, wa, wb) => { // avsmalnande lem med rundade ändar
      // Jag räknar ut riktningen och längden mellan två leder.
      // Med hjälp av en vinkelrät normalvektor kan jag skapa bredd åt båda sidor om leden.
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L,

            // wa och wb är bredden vid segmentets början respektive slut.
            // g läggs till för att kunna göra segmentet större vid behov.
            ra = (wa / 2 + g) * S, rb = (wb / 2 + g) * S;

      // Jag bygger en fyrhörning mellan punkterna A och B.
      // Den blir bredare eller smalare beroende på ra och rb.
      P.beginShape();
      P.vertex(A.x + nx * ra, A.y + ny * ra); P.vertex(B.x + nx * rb, B.y + ny * rb);
      P.vertex(B.x - nx * rb, B.y - ny * rb); P.vertex(A.x - nx * ra, A.y - ny * ra);
      P.endShape(CLOSE);

      // Cirklar i ändarna gör att segmentet får rundade kanter.
      P.circle(A.x, A.y, 2 * ra); P.circle(B.x, B.y, 2 * rb);
    };

    // Kroppens upp- (u) och höger-riktning (r), punkt = c + r*höger + u*upp (i S-enheter)
    // Jag räknar ut två riktningar utifrån kroppen:
    // u pekar från höfterna mot halsen och r pekar från vänster axel mot höger axel.
    let ux = nk.x - hm.x, uy = nk.y - hm.y, ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    let rx = rs.x - ls.x, ry = rs.y - ls.y, rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;

    // Pt använder dessa riktningar för att skapa en punkt relativt en mittpunkt c.
    // r flyttar punkten i sidled och u flyttar den uppåt eller nedåt.
    const Pt = (c, r, u) => ({ x: c.x + (rx * r + ux * u) * S, y: c.y + (ry * r + uy * u) * S }),

          // wc är en ungefärlig mittpunkt mellan halsen och höfterna.
          wc = { x: nk.x * 0.45 + hm.x * 0.55, y: nk.y * 0.45 + hm.y * 0.55 };

    // Torso (lite rundning via kontur även när g = 0)
    // Jag skapar flera punkter runt överkroppen och bäckenet.
    // Punkterna följer kroppens egna riktningar så att formen kan rotera med personen.
    const pts = [Pt(nk, -0.7, -0.06), Pt(nk, -0.3, 0.1), Pt(nk, 0.3, 0.1), Pt(nk, 0.7, -0.06), Pt(wc, 0.42, 0),
                 Pt(hm, 0.5, 0), Pt(hm, 0.48, -0.25), Pt(hm, -0.48, -0.25), Pt(hm, -0.5, 0), Pt(wc, -0.42, 0)];

    // Jag fyller och ritar konturen med den färg som skickats in.
    // strokeWeight ger konturen en viss tjocklek och hjälper till att runda formen.
    P.fill(col); P.stroke(col); P.strokeWeight((2 * g + 0.06) * S); P.strokeJoin(ROUND);
    P.beginShape(); pts.forEach(p => P.vertex(p.x, p.y)); P.endShape(CLOSE);
    P.noStroke(); P.fill(col);

    // Hals + huvud (huvudets mitt beräknas en gång per bildruta i drawShadow)
    // Jag använder huvudets mittpunkt som redan räknats fram i drawShadow.
    // Halsen ritas som ett segment och huvudet som en ellips som följer halsens riktning.
    const hc = this._head;
    seg(nk, hc, 0.34, 0.3);
    ell(hc, 0.6, 0.78, Math.atan2(hc.y - nk.y, hc.x - nk.x) + HALF_PI);

    // Armar, händer, ben, fötter
    // Jag går igenom både vänster och höger sida och hämtar respektive leds koordinater.
    for (const s of ['left', 'right']) {
      const sh = J[s + '_shoulder'], el = J[s + '_elbow'], wr = J[s + '_wrist'], hp = J[s + '_hip'], kn = J[s + '_knee'], an = J[s + '_ankle'];

      // Armarna byggs av två segment: överarm och underarm.
      seg(sh, el, 0.36, 0.27); seg(el, wr, 0.27, 0.2);

      // Jag räknar ut underarmens vinkel för att placera handen i rätt riktning.
      const fa = Math.atan2(wr.y - el.y, wr.x - el.x);
      ell({ x: wr.x + Math.cos(fa) * 0.12 * S, y: wr.y + Math.sin(fa) * 0.12 * S }, 0.26, 0.36, fa + HALF_PI);

      // Benen byggs på samma sätt med lår och underben.
      seg(hp, kn, 0.52, 0.38); seg(kn, an, 0.38, 0.25);

      // Jag avgör åt vilket håll foten ska peka genom att jämföra fotens x-position med kroppens mitt.
      const out = an.x >= hm.x ? 1 : -1;

      // Foten ritas som en ellips som vinklas lite utåt.
      ell({ x: an.x + out * 0.12 * S, y: an.y + 0.08 * S }, 0.5, 0.22, out * 0.15);
    }
  }
}