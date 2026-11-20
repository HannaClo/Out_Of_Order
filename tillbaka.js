
/* 
   Jag använder en IIFE (Immediately Invoked Function Expression).
   Det betyder att funktionen körs direkt när skriptet läses in.
   På så sätt kan jag samla variabler och funktioner i ett eget lokalt scope
   utan att alla namn blir globala. De funktioner som andra delar av projektet
   behöver komma åt exponeras i stället uttryckligen via window.
*/
(()=>{
  // Jag sparar sökvägen till projektets kontrollcenter.
  const H="../index.html",

  // Jag hämtar sidans sökväg och gör den till gemener för att kunna jämföra
  // den utan att behöva ta hänsyn till stora och små bokstäver.
  p=location.pathname.toLowerCase(),

  /*
     Jag väljer en accentfärg beroende på vilken värld användaren befinner sig i.
     Jag kontrollerar sökvägen efter respektive världs mappnamn.
     Om ingen av de tre första matchar används gravitationens rosa färg som standard.
  */
  a=p.includes("/vatten/")?"#19e6ff":p.includes("/friktion/")?"#b06bff":p.includes("/skugga/")?"#6f8cff":"#ff3df2",

  // Jag sparar en kort referens till document för att slippa skriva document varje gång.
  d=document,

  // Jag skapar ett nytt länkelement som ska användas som tillbaka-knapp.
  b=d.createElement("a"),

  // Jag skapar en div som ska innehålla varningen vid inaktivitet.
  w=d.createElement("div"),

  // Jag skapar ett style-element där jag lägger in CSS direkt från JavaScript.
  s=d.createElement("style");

  /*
     Här deklarerar jag variabler som används senare:
     i = timeout för den vanliga inaktivitetstimern.
     c = intervallet som uppdaterar nedräkningen.
     r = aktuell tid som återstår i nedräkningen.
     l = markering för att navigering redan har startat.
     z = timeout för den separata säkerhetstimern vid hällning.
     S = markering för att säkerhetstimern har aktiverats.

     Variablerna deklareras här men får sina värden när de behövs.
  */
  let i,c,r,l,z,S;

  /*
     Jag skapar all CSS för tillbaka-knappen och inaktivitetsvarningen
     som en template literal. Det gör att jag kan använda JavaScript-variabeln
     a direkt i CSS-koden och därmed ge båda elementen samma accentfärg
     som den aktuella världen.
  */
  s.textContent=`#tillbaka{
    /* 
       Jag placerar tillbaka-knappen fast uppe till höger.
       clamp() gör att avståndet från högerkanten anpassas efter skärmens bredd,
       men håller sig inom ett minsta och största värde.
    */
    position:fixed;
    right:clamp(20px,3vw,40px);
    top:60px;
    z-index:9999;

    /* Jag använder monospace-typsnitt och extra teckenavstånd för knappens text. */
    font:12px ui-monospace,Menlo,Consolas,monospace;
    letter-spacing:.18em;
    text-decoration:none;
    color:${a};
    opacity:.7;
    padding:10px 16px;
    border:1px solid transparent;
    border-radius:3px;
    background:transparent;
    transition:opacity .25s,border-color .25s
  }

  /*
     När knappen får muspekaren över sig eller hamnar i fokus
     blir den tydligare. Jag visar även en färgad ram och en svag skugga.
  */
  #tillbaka:hover,#tillbaka:focus-visible{
    opacity:1;
    border-color:${a};
    outline:none;
    box-shadow:0 0 12px ${a}44
  }

  /*
     Jag placerar inaktivitetsvarningen mitt på skärmen.
     width:min(...) gör att den aldrig blir bredare än 520px,
     samtidigt som den lämnar 40px marginal på mindre skärmar.
     z-index gör att varningen hamnar ovanför det vanliga sidinnehållet.
  */
  #inactivity-warning{
    position:fixed;
    top:50%;
    left:50%;
    z-index:9998;
    width:min(520px,calc(100vw - 40px));
    box-sizing:border-box;
    padding:36px 40px;
    color:#eee;
    text-align:center;
    background:rgba(5,5,12,.82);
    backdrop-filter:blur(7px);
    -webkit-backdrop-filter:blur(7px);
    border:1px solid ${a};
    border-radius:4px;
    box-shadow:0 0 20px ${a}44,inset 0 0 16px ${a}0d;
    font-family:ui-monospace,Menlo,Consolas,monospace;
    font-size:16px;
    letter-spacing:.18em;
    line-height:1.7;

    /*
       pointer-events:none gör att varningen inte fångar upp mus- eller pekhändelser.
       Användaren kan alltså fortfarande interagera med innehållet bakom den.
    */
    pointer-events:none;

    /*
       Jag börjar med opacity:0 så att varningen är osynlig.
       transform placerar den i mitten och flyttar den dessutom 12px nedåt.
       När klassen visible läggs till ändras dessa värden med en övergång.
    */
    opacity:0;
    transform:translate(-50%,calc(-50% + 12px));
    transition:opacity .8s,transform .8s
  }

  /*
     Klassen visible visar varningen och flyttar den till exakt mitten av skärmen.
     Samtidigt startar animationen warningPulse, som får skuggan att pulsera.
  */
  #inactivity-warning.visible{
    opacity:1;
    transform:translate(-50%,-50%);
    animation:warningPulse 2s ease-in-out infinite
  }

  /* 
     Jag gör rubriken i varningen till ett block så att den hamnar på en egen rad.
     Den får accentfärgen och lite extra avstånd till texten under.
  */
  #inactivity-warning strong{
    display:block;
    color:${a};
    font-size:15px;
    letter-spacing:.18em;
    margin-bottom:14px
  }

  /*
     Nedräkningen får ett större format och accentfärg så att den återstående
     tiden blir tydlig för besökaren.
  */
  #inactivity-countdown{
    display:block;
    margin-top:12px;
    color:${a};
    font-size:40px;
    font-weight:700;
    text-shadow:0 0 10px ${a}88
  }

  /*
     Jag definierar en animation som ändrar skuggans styrka.
     Vid början och slutet är skuggan svag, medan den är starkare i mitten.
     Det skapar en långsam pulserande effekt runt varningen.
  */
  @keyframes warningPulse{
    0%,to{box-shadow:0 0 12px ${a}22}
    50%{box-shadow:0 0 24px ${a}66}
  }

  /*
     När klassen leaving läggs på body tonas hela sidan ut.
     Den här övergången används när besökaren ska tillbaka till kontrollcentret.
  */
  body.leaving{opacity:0;transition:opacity .6s}

  /*
     Jag anpassar knappen och varningsrutan för mindre skärmar.
     env(safe-area-inset-top,0px) tar hänsyn till enhetens säkra område,
     exempelvis runt en skärmutskärning.
  */
  @media (max-width:600px){
    #tillbaka{
      right:16px;
      top:calc(22px + env(safe-area-inset-top,0px));
      font-size:11px;
      padding:8px 10px
    }

    #inactivity-warning{
      width:calc(100vw - 32px);
      padding:28px 20px;
      font-size:14px
    }

    #inactivity-warning strong{font-size:13px}
    #inactivity-countdown{font-size:36px}
  }`;

  /*
     Jag lägger in style-elementet i dokumentets head.
     Då börjar webbläsaren använda CSS-reglerna som jag precis har skapat.
  */
  d.head.append(s);

  /*
     Jag fyller tillbaka-länken med dess egenskaper:
     id används för att CSS ska kunna hitta och styla den,
     href pekar på kontrollcentret,
     textContent bestämmer texten som visas,
     och title ger en beskrivning som bland annat kan visas som hjälptext.
  */
  Object.assign(b,{
    id:"tillbaka",
    href:H,
    textContent:"← TILLBAKA",
    title:"Tillbaka och välj en annan värld"
  });

  // Jag ger varningsrutan ett id så att CSS och JavaScript kan hitta den.
  w.id="inactivity-warning";

  /*
     Jag lägger in varningens innehåll.
     strong-elementet visar själva uppmaningen.
     Span-elementet visar den återstående tiden och får ett eget id
     så att jag kan uppdatera siffran från JavaScript.
  */
  w.innerHTML='<strong>INTERAGERA FÖR ATT STANNA KVAR</strong>Återgång till kontrollcentret om<span id="inactivity-countdown">10</span>';

  /*
     Jag lägger både tillbaka-knappen och varningsrutan i body.
     De skapas alltså dynamiskt av JavaScript och behöver inte finnas
     direkt i sidans ursprungliga HTML.
  */
  d.body.append(b,w);

  /*
     Jag hämtar det sista underordnade elementet i varningsrutan.
     Eftersom nedräkningsspan är det sista elementet blir n en referens
     till just den del av sidan där siffran ska visas.
  */
  const n=w.lastChild,

  /*
     go() är funktionen som skickar besökaren tillbaka till kontrollcentret.

     Jag börjar med att kontrollera l. Om navigeringen redan har startat
     avslutar jag funktionen direkt, så att flera händelser inte startar
     flera samtidiga navigeringar.

     Sedan markerar jag att navigering pågår och stoppar alla timers:
     - i är den vanliga inaktivitetstimern.
     - z är säkerhetstimern.
     - c uppdaterar nedräkningen.

     Till sist lägger jag till leaving-klassen och väntar 600ms innan
     jag ändrar sidans adress. Väntan gör att uttoningsanimationen hinner visas.
  */
  go=()=>{
    if(l)return;
    l=1;
    clearTimeout(i);
    clearTimeout(z);
    clearInterval(c);
    d.body.classList.add("leaving");
    setTimeout(()=>location.href=H,600)
  },

  /*
     show() visar inaktivitetsvarningen och startar en nedräkning från 10 sekunder.

     Först sätter jag texten i nedräkningsfältet till 10 och sparar samma värde
     i variabeln r. Sedan lägger jag till klassen visible så att varningen visas.

     setInterval kör funktionen en gång per sekund.
     Varje gång minskar jag r med 1 och uppdaterar texten på sidan.
     När r når 0 stoppar jag intervallet och anropar go().
  */
  show=()=>{
    n.textContent=r=10;
    w.classList.add("visible");
    c=setInterval(()=>{
      n.textContent=--r;
      r<=0&&(clearInterval(c),go())
    },1e3)
  },

  /*
     Här skapar jag den vanliga inaktivitetsfunktionen och gör den tillgänglig
     globalt via window.resetInactivityTimer.

     Den kan därför anropas även från andra JavaScript-filer i projektet,
     exempelvis när användaren utför en handling som räknas som aktivitet.

     Jag avbryter funktionen om:
     - navigering redan har startat (l),
     - säkerhetstimern för hällning är aktiv (S),
     - startsidans intro fortfarande visas.

     Om inget av detta gäller stoppar jag den tidigare timern, döljer varningen
     och avbryter eventuell pågående nedräkning.

     Därefter väntar jag 15 sekunder innan varningen visas.
     När varningen visas startar jag dessutom en ny timeout på 10 sekunder.
     Om användaren fortfarande inte har interagerat går den tiden ut och
     go() skickar användaren tillbaka till kontrollcentret.

     Jag använder alltså två steg: först 15 sekunders inaktivitet,
     därefter en synlig nedräkning på 10 sekunder.
  */
  R=window.resetInactivityTimer=()=>{
    if(l||S||d.body.classList.contains("intro"))return;
    clearTimeout(i);
    w.classList.remove("visible");
    clearInterval(c);
    i=setTimeout(()=>{
      show();
      i=setTimeout(go,1e4)
    },15e3)
  };

  /*
     Säkerhetstimer (bara världar som anropar resetPourTimer, t.ex. Vattenvärlden):
     räknas från senaste hällningen och avbryts inte av annan aktivitet.

     Jag gör resetPourTimer global så att exempelvis Vattenvärlden kan anropa den
     när användaren häller.

     Om navigeringen redan har startat gör jag ingenting.
     Annars stoppar jag den tidigare säkerhetstimern och återställer S till 0.
     Jag döljer också varningen och stoppar en eventuell nedräkning.

     Sedan anropar jag R() för att återställa den vanliga inaktivitetstimern.
     Slutligen startar jag säkerhetstimern z på 15 sekunder.

     När de 15 sekunderna har gått stoppar jag den vanliga inaktivitetstimern
     och nedräkningsintervallet. Jag sätter S till 1 för att markera att
     säkerhetstimern har aktiverats och visar varningen.

     Eftersom R() kontrollerar S kommer vanlig aktivitet inte att återställa
     den vanliga timern medan säkerhetsläget är aktivt.
  */
  window.resetPourTimer=()=>{
    if(l)return;
    clearTimeout(z);
    S=0;
    w.classList.remove("visible");
    clearInterval(c);
    R();
    z=setTimeout(()=>{
      clearTimeout(i);
      clearInterval(c);
      S=1;
      show()
    },15e3)
  };

  /*
     Jag kopplar ett klick-event till tillbaka-knappen.
     preventDefault() stoppar länkens vanliga navigering så att jag i stället
     kan använda min egen go()-funktion med uttoningsanimationen.
  */
  b.addEventListener("click",e=>{
    e.preventDefault();
    go()
  });

  /*
     Här registrerar jag flera olika typer av händelser på hela dokumentet.
     De räknas som aktivitet och återställer inaktivitetstimern:

     pointerdown = användaren trycker med mus, penna eller pekskärm.
     pointermove = pekaren rör sig.
     keydown = användaren trycker på en tangent.
     wheel = användaren scrollar med mushjulet eller motsvarande.
     touchstart = användaren börjar röra vid skärmen.
     touchmove = användaren drar fingret över skärmen.

     forEach går igenom listan och lägger till samma typ av eventlyssnare
     för varje händelse. Varje gång en sådan händelse inträffar körs R().

     passive:true talar om för webbläsaren att lyssnaren inte kommer att
     anropa preventDefault(). Det kan hjälpa webbläsaren att hantera
     exempelvis scrollning mer effektivt.
  */
  ["pointerdown","pointermove","keydown","wheel","touchstart","touchmove"].forEach(e=>
    d.addEventListener(e,R,{passive:!0})
  );

  /*
     Starta/stoppa timrarna när världens startsida (body.intro) försvinner/återkommer.

     Jag undersöker först om body har klassen intro och sparar resultatet i was.
     Den klassen används av världarnas startsidor för att markera att introduktionen
     fortfarande visas.
  */
  let was=d.body.classList.contains("intro");

  /*
     MutationObserver låter mig bevaka ändringar i DOM:en.
     Här bevakar jag specifikt attributet class på body-elementet.

     När intro-klassen ändras körs funktionen:
     - Om klassen inte har ändrats jämfört med tidigare gör jag ingenting.
     - Om intro visas stoppar jag alla timers, återställer säkerhetsmarkeringen
       och döljer varningen.
     - Om intro försvinner anropar jag R() så att inaktivitetstimern börjar igen.

     Det gör att timrarna inte räknar ner medan besökaren befinner sig på
     världens introduktionsskärm.
  */
  new MutationObserver(()=>{
    const x=d.body.classList.contains("intro");
    if(x===was)return;
    was=x;
    if(x){
      clearTimeout(i);
      clearTimeout(z);
      clearInterval(c);
      S=0;
      w.classList.remove("visible")
    }else R()
  }).observe(d.body,{
    attributes:true,
    attributeFilter:["class"]
  });

  /*
     Till sist anropar jag R() direkt när skriptet har körts.
     Om ingen intro-skärm visas börjar den vanliga inaktivitetstimern.
     Om intro fortfarande är aktivt avslutar R() utan att starta någon timer.
  */
  R()
})();