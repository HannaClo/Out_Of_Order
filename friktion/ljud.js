// Ljud (Web Audio): start, update, drop, thud, setFade, fadeIn, reset, toggleMute, muted

// Här skapar jag ett eget ljudsystem som jag samlar i objektet Ljud.
// Funktionen körs direkt och returnerar sedan de metoder som resten av spelet kan använda.
const Ljud=(()=>{"use strict";

    // Grundvärden och hjälpfunktioner som används på flera ställen i ljudsystemet.
    // S är längden på ett musiksteg i sekunder.
    // C begränsar ett värde så att det hamnar mellan ett minsta och största värde.
    // M omvandlar ett MIDI-tonnummer till en frekvens i hertz.
    // P väljer ett slumpmässigt element ur en lista.
    const S=.1171875,C=(v,a,b)=>Math.min(b,Math.max(a,v)),M=m=>440*2**((m-69)/12),P=a=>a[Math.floor(Math.random()*a.length)],
    
    // Här definierar jag musikens tonmaterial.
    // r är grundtonen och p respektive a innehåller toner som används i olika delar av musiken.
    Q={r:33,p:[45,52,57,60],a:[57,60,64,69,72,76]},
    
    // PROG innehåller flera musikuppsättningar som kan växlas mellan under spelets gång.
    // Vissa uppsättningar återanvänder Q, medan andra har andra toner.
    PROG=[Q,{r:29,p:[41,48,53,57],a:[53,57,60,65,69,72]},Q,{r:31,p:[43,50,55,59],a:[55,59,62,67,71,74]}],
    
    // LV innehåller inställningar för spelets fem nivåer.
    // m är en nivåtrim per värld som jämnar ut musikens totala ljudstyrka så att alla fem världar låter lika högt.
    // Värdena är framtagna genom mätning av den färdiga utsignalen (K-vägd nivå) och gäller hela musikblandningen i varje värld.
    // Varje nivå har egna värden för exempelvis ljudstyrka, filterfrekvenser och musikens karaktär.
    // De extra egenskaperna används bara på de nivåer där de finns definierade.
    LV={1:{m:0.55,p:.55,c:520,a:.05,q:.55},
    2:{m:0.61,p:.5,c:700,a:.05,q:.45,d:.14,k:{g:.26,l:105}},
    3:{m:0.34,p:.44,c:900,a:.04,q:.3,d:.35,k:{g:.75,c:.15},b:{c:380,g:.5,n:[[2,0,2],[6,0,2],[10,0,2],[14,0,2]]},h:3},
    4:{m:0.28,p:.4,c:1300,a:.03,q:.15,d:.5,k:{g:.9,c:.5},b:{c:560,g:.58,n:[[2,0,1.5],[3,0,1],[6,0,1.5],[7,12,1],[10,0,1.5],[11,0,1],[14,0,1.5],[15,7,1]]},h:4,l:.22,r:.07},
    5:{m:0.245,p:.36,c:2e3,a:.03,q:.1,d:.62,k:{g:1,c:.7},b:{c:800,g:.66,n:[[1,0,1],[2,0,1],[3,12,1],[5,0,1],[6,0,1],[7,7,1],[9,0,1],[10,0,1],[11,12,1],[13,0,1],[14,3,1],[15,10,1]]},h:5,l:.3,r:.1}},
    
    // Dessa listor bestämmer tonernas ordning i vissa musikmönster på nivå 4 och 5.
    // MV är huvudvolymen för hela ljudet (musik och kulljud tillsammans). 0.45 är cirka 2,5 dB lägre än tidigare 0.6.
    MV=.45,
    
    A4=[0,2,4,2,1,3,5,3],A5=[0,2,4,5,4,2,1,3,0,2,4,5,4,3,1,2];
    
    // Här deklarerar jag variablerna som används av ljudsystemet.
    // X är själva AudioContext-objektet, alltså webbläsarens ljudmotor.
    // mu håller reda på om ljudet är avstängt och fd används för ljudets fade-nivå.
    // De övriga variablerna sparar ljudnoder, filter, oscillatorer och musikens aktuella tillstånd.
    let X,mu=!1,fd=0,MS,SB,MB,SD,DA,RV,W,BR,BP,BK,BB,BH,BC,BA,BG,PF,PV=[],PS,AG,Rm,Rl,Ra,Ro,Rd,Rr,Rc,Rt,Rs,Rz,NS=0,NT=0,CL=1,PL=null,CC=-1,PG=-1,SP=0,LT=0;
    
    // G skapar en GainNode, som jag använder för att styra volymen på olika ljuddelar.
    const G=v=>{const g=X.createGain();g.gain.value=v;return g},
    
    // E skapar en volymkurva för ett ljud.
    // Först sätts volymen nästan till noll, sedan ökar den till k och tonas till sist ner igen.
    // Det gör att ljud kan få en mjuk start och ett kontrollerat avslut.
    E=(g,t,k,a,d)=>{g=g.gain;g.setValueAtTime(1e-4,t);g.linearRampToValueAtTime(k,t+a);g.exponentialRampToValueAtTime(1e-4,t+a+d)},
    
    // N skapar en ljudkälla som spelar upp en buffer i en begränsad tid.
    // Den loopar ljudet och väljer en slumpmässig startpunkt i buffern.
    N=(b,t,d)=>{const s=X.createBufferSource();s.buffer=b;s.loop=!0;s.start(t,Math.random()*(b.duration-.2));s.stop(t+d+.02);return s},
    
    // Lp skapar i stället en ljudkälla som loopar buffern utan att själv bestämma någon sluttid.
    Lp=b=>{const s=X.createBufferSource();s.buffer=b;s.loop=!0;s.start();return s},
    
    // B skapar ett filter. Jag kan ange filtertyp, frekvens och Q-värde.
    // Q påverkar hur kraftigt filtret förstärker eller avgränsar frekvenser nära brytpunkten.
    B=(y,f,q)=>{const n=X.createBiquadFilter();n.type=y;f&&(n.frequency.value=f);q&&(n.Q.value=q);return n},
    
    // O skapar en oscillator, alltså en ljudkälla som genererar en ton.
    // Jag anger frekvensen och kan även välja vågform, exempelvis sinus eller sågtand.
    O=(f,y)=>{const o=X.createOscillator();y&&(o.type=y);o.frequency.value=f;return o},
    
    // build bygger upp hela ljudmiljön när ljudsystemet startas.
    build=()=>{const sr=X.sampleRate;
    
    // Först skapar jag en två sekunder lång buffer med vitt brus.
    // Vitt brus innehåller många olika frekvenser och kan användas för exempelvis friktion och brusljud.
    W=X.createBuffer(1,sr*2,sr);const w=W.getChannelData(0);for(let i=0;i<w.length;i++)w[i]=Math.random()*2-1;
    
    // Här skapar jag en längre buffer med ett mer filtrerat brus.
    // Värdet l uppdateras gradvis, vilket gör att bruset får en mjukare och mindre skarp karaktär.
    BR=X.createBuffer(1,sr*3,sr);const b=BR.getChannelData(0);let l=0;for(let i=0;i<b.length;i++){l=(l+.02*(Math.random()*2-1))/1.02;b[i]=l*3.5}
    
    // Kompressorn jämnar ut ljudets dynamik så att starka ljud inte sticker iväg lika mycket.
    // Tröskelvärde, ratio, attack och release bestämmer hur komprimeringen reagerar.
    const c=X.createDynamicsCompressor();c.threshold.value=-14;c.knee.value=12;c.ratio.value=3;c.attack.value=.005;c.release.value=.2;
    
    // Här bygger jag upp den övergripande ljudkedjan.
    // x tar emot ljudet, skickar det genom kompressorn och vidare till huvudvolymen MS.
    // MS är kopplad till webbläsarens ljudutgång.
    MS=G(1e-4);const x=G(1);x.connect(c);c.connect(MS);MS.connect(X.destination);
    
    // SB och MB fungerar som separata volymgrupper för olika delar av ljudet.
    // SD används för att kunna påverka ljudnivån till MB, bland annat vid vissa ljudeffekter.
    SB=G(0.32);SB.connect(x);MB=G(.55);SD=G(1);MB.connect(SD);SD.connect(x);
    
    // Här bygger jag ett reverb, alltså en effekt som ger ljudet en känsla av rum och efterklang.
    // Jag skapar en impulsrespons med slumpmässigt brus som gradvis klingar av.
    RV=G(1);const cv=X.createConvolver(),n=Math.floor(sr*2.4),ir=X.createBuffer(2,n,sr);
    for(let h=0;h<2;h++){const d=ir.getChannelData(h);let y=0;for(let i=0;i<n;i++){const t=i/sr,a=.12+.88*Math.exp(-t*2.5);y+=(Math.random()*2-1-y)*a;d[i]=y*Math.exp(-t*2.6)*(i<sr*.004?i/(sr*.004):1)*1.6}}
    cv.buffer=ir;const rr=G(.5);RV.connect(cv);cv.connect(rr);rr.connect(x);
    
    // Rm är en central volymkontroll för ljud som hör till den rörliga ljudmiljön.
    // En del av ljudet går direkt till SB och en annan del skickas genom reverbet.
    Rm=G(.56);Rm.connect(SB);const rs=G(.1);Rm.connect(rs);rs.connect(RV);
    
    // Här skapar jag ett brusljud som filtreras med ett lågpassfilter.
    // Ra styr volymen och filtret Rl kan ändra ljudets frekvensinnehåll.
    Rl=B("lowpass",120,.7);Ra=G(0);Lp(BR).connect(Rl);Rl.connect(Ra);Ra.connect(Rm);
    
    // Den här delen skapar ett kontinuerligt ljud som kan påverkas av rörelsen.
    // Oscillatorn Ro skickar en ton genom Rd, vars gain används för att styra hur mycket ljud som hörs.
    const am=G(.85);am.connect(Rm);Ro=O(1,"sine");Rd=G(0);Ro.connect(Rd);Rd.connect(am.gain);Ro.start();
    
    // Rr är en samling av fyra separata bandpassfilter.
    // Varje filter fokuserar på ett visst frekvensområde och har egna värden för frekvens,
    // förändring med rörelse och ljudstyrka.
    Rr=[[210,260,12,3.8],[470,520,12,2.2],[1050,900,14,1.2],[2300,1500,16,.45]].map(([f,d,q,l])=>{const b=B("bandpass",f,q),g=G(0);Lp(W).connect(b);b.connect(g);g.connect(am);return{b,g,f,d,l}});
    
    // Här skapar jag ytterligare ett brusljud som begränsas till ett högre frekvensområde.
    // Rc styr hur mycket av detta ljud som skickas vidare till den rörliga ljudgruppen.
    const hp=B("highpass",4e3),hl=B("lowpass",9e3);Rc=G(0);Lp(W).connect(hp);hp.connect(hl);hl.connect(Rc);Rc.connect(Rm);Rt=Rs=0;Rz=340;
    
    // Dessa GainNodes fungerar som separata ljudkanaler för olika musik- och effektkomponenter.
    // De kopplas vidare till olika delar av ljudkedjan, så att jag kan styra dem var för sig.
    const m1=LV[1].m;BP=G(0);BK=G(m1);BB=G(m1);BH=G(m1);BC=G(m1);BA=G(m1);BG=G(m1);DA=G(1);
    DA.connect(MB);
    [BP,BB,BA].forEach(b=>b.connect(DA));[BK,BH,BC,BG].forEach(b=>b.connect(MB));
    
    // Här skickar jag vissa ljudkanaler till reverbet genom separata volymkontroller.
    // På så sätt får olika ljuddelar olika mycket efterklang.
    for(const[b,v]of[[BP,.35],[BC,.4],[BA,.25],[BG,.6],[BH,.12]]){const s=G(v);b.connect(s);s.connect(RV)}
    
    // Den här delen skapar en delayeffekt, där ljudet skickas tillbaka genom en fördröjning.
    // Lågpassfiltret gör att upprepningarna gradvis får mindre höga frekvenser.
    const fx=X.createDelay(1);fx.delayTime.value=S*3;const fl=B("lowpass",3200),fb=G(.42);fx.connect(fl);fl.connect(fb);fb.connect(fx);
    
    // Här skickas det fördröjda ljudet vidare till musikens ljudkanal.
    const fo=G(.55);fl.connect(fo);fo.connect(MB);const da=G(.5);BA.connect(da);da.connect(fx);const dp=G(.9);BG.connect(dp);dp.connect(fx);
    
    // PF är ett lågpassfilter som påverkar musikkanalen BP.
    // En långsam oscillator ändrar filtrets frekvens och skapar därmed en gradvis förändring i ljudets klang.
    PF=B("lowpass",520,1.2);PF.connect(BP);const lf=O(.06),ld=G(220);lf.connect(ld);ld.connect(PF.frequency);lf.start();
    
    // Här skapar jag fyra toner som tillsammans bildar en ackordliknande ljudbild.
    // Varje ton består av två sågtandsoscillatorer med lite olika stämning.
    // Det ger ljudet en bredare och fylligare karaktär.
    for(let i=0;i<4;i++){const v=G(.16);v.connect(PF);PV.push([-7,7].map(d=>{const o=O(M(Q.p[i]),"sawtooth");o.detune.value=d;o.connect(v);o.start();return o}))}
    
    // PS skapar en låg grundton som också kopplas till musikkanalen.
    PS=O(M(Q.r),"sine");const sg=G(.35);PS.connect(sg);sg.connect(BP);PS.start();
    
    // AG är ytterligare en ljudkanal som får ett brusljud genom ett bandpassfilter.
    // En långsam oscillator påverkar volymen och gör att ljudet kan variera över tid.
    const ab=B("bandpass",3e3,.5);AG=G(0);Lp(W).connect(ab);ab.connect(AG);AG.connect(BP);const al=O(.11),ad=G(.02);al.connect(ad);ad.connect(AG.gain);al.start()},
    
    // K skapar ett kort, slumpmässigt brusljud.
    // Jag använder det bland annat för att ge den rörliga ljudmiljön små variationer.
    // Parametern s påverkar hur starkt ljudet blir.
    K=(t,s)=>{const b=B("bandpass",1800+Math.random()*3e3,3),g=X.createGain();E(g,t,(.02+.06*s)*(.4+Math.random()*.6),8e-4,.006+Math.random()*.01);N(W,t,.03).connect(b);b.connect(g);g.connect(Rm)},
    
    // Z skapar ett mer tydligt ljud med flera toner samtidigt.
    // Tonerna har olika frekvenser och ljudstyrkor, vilket gör att ljudet får flera övertoner.
    // Även här lägger jag till ett kort brusljud för att göra effekten mer sammansatt.
    Z=(t,s)=>{const m=.5*(.25+.75*C(s,0,1))*(.7+Math.random()*.3),f=520+Math.random()*120;
    [[1,.3,.06],[2.4,.16,.035],[4.1,.07,.02]].forEach(([r,a,d])=>{const g=X.createGain();E(g,t,a*m,8e-4,d);const o=O(f*r);o.connect(g);g.connect(Rm);o.start(t);o.stop(t+d+.05)});
    const b=B("bandpass",2400,1),g=X.createGain();E(g,t,.18*m,4e-4,.01);N(W,t,.03).connect(b);b.connect(g);g.connect(Rm)},
    
    // U uppdaterar ljudet utifrån hur kulan rör sig.
    // dt är tidssteget, v är hastigheten, h anger om kulan hålls fast och fr är friktionsvärdet.
    // Jag använder värdena för att förändra ljudstyrka, filter och mängden brus.
    U=(dt,v,h,fr)=>{const t=X.currentTime,g=h?0:C(v/900,0,1.3);
    
    // SP jämnar ut förändringen i hastighet så att ljudet inte reagerar ryckigt.
    // När kulan hålls fast sätts målet till noll.
    SP+=(g-SP)*(1-Math.exp(-dt/(g>SP?.06:.45)));if(SP<5e-4)SP=0;
    const s=SP,f=C(fr,0,1),k=.05;
    
    // Här ändrar jag volymen och filtret för det kontinuerliga rörelseljudet.
    // Ju högre hastighet, desto mer hörs ljudet och desto högre blir filterfrekvensen.
    Ra.gain.setTargetAtTime(.55*s**.8,t,k);Rl.frequency.setTargetAtTime(80+420*s,t,k);
    
    // Varje filter i Rr får en ny frekvens och volym beroende på hastigheten.
    // Friktionen påverkar också ljudstyrkan genom värdet f.
    Rr.forEach(r=>{r.b.frequency.setTargetAtTime(r.f+r.d*s,t,k);r.g.gain.setTargetAtTime(r.l*s**1.15*(1+.5*f),t,k)});
    
    // Här förändras oscillatorns frekvens och volym efter hastigheten.
    Ro.frequency.setTargetAtTime(Math.max(.3,s*900/314.1592653589793),t,.1);Rd.gain.setTargetAtTime(.18*Math.min(1,s*3),t,.1);
    
    // Mer brus läggs till när hastigheten och friktionsvärdet ökar.
    Rc.gain.setTargetAtTime(.05*C((s-.3)/.7,0,1)**1.5,t,k);
    
    // När kulan rör sig tillräckligt snabbt skapas små slumpmässiga ljudhändelser.
    // Rt samlar tid och avgör när nästa korta brusljud ska spelas.
    if(s>.05){Rt+=(2+10*s)*dt;while(Rt>=1){Rt--;K(t+Math.random()*dt,s)}}else Rt=0;
    
    // Om kulan inte hålls fast räknar jag även upp ett värde baserat på hastigheten.
    // När värdet når Rz spelas ett extra ljud genom Z.
    // Rz får sedan ett nytt slumpmässigt tröskelvärde.
    if(!h&&v>40){Rs+=v*dt;if(Rs>=Rz){Rs-=Rz;Rz=340*(.75+.5*Math.random());Z(t+.002,C(v/900,0,1.2))}}},
    
    // I skapar ett sammansatt anslagsljud med flera övertoner och bruskomponenter.
    // Parametrarna styr bland annat tidpunkt, styrka, grundfrekvens och ljudets klang.
    // Funktionen används av flera olika ljudeffekter.
    I=(t,w,f,dc,bd,br)=>{const p=C(w,.05,1.2),out=G((.4+.6*p)*.6);out.connect(SB);const sn=G(.16);out.connect(sn);sn.connect(RV);
    
    // Ett lågpassfilter formar ljudets klang. Filterfrekvensen påverkas av p och br.
    const tilt=B("lowpass",2500+9e3*Math.min(1,p)*br,.3);tilt.connect(out);
    
    // T skapar en enskild ton med en bestämd frekvens och volymkurva.
    // Om frekvensen är för hög hoppar funktionen över tonen.
    const T=(q,k,d)=>{if(q>15e3)return;const g=X.createGain();E(g,t,k,8e-4,Math.max(.015,d));const o=O(q);o.connect(g);g.connect(tilt);o.start(t);o.stop(t+d+.1)},
    
    // Här räknar jag fram grundfrekvensen och hur lång ljudets avklingning ska vara.
    f1=f*(1+(Math.random()-.5)*.05),ring=dc*(.55+.45*p);
    
    // Jag skapar flera övertoner med olika frekvenser och styrkor.
    // Det gör att anslaget låter mer komplext än en enda ren ton.
    [[1,.5,.3],[2.32,.38,.18],[4.18,.24,.11],[6.43,.14,.07],[9.1,.07,.04]].forEach(([r,a,d],i)=>{T(f1*r*(1+(Math.random()-.5)*.01),a*(i>0?br:1),d*ring);if(!i)T(f1*1.006,a*.4,d*ring*1.15)});
    
    // Här lägger jag till ytterligare en högre ton och en lägre komponent.
    T(3600+Math.random()*1200,.09*br,.07*ring);T(f1*.5,.28*bd,.3*ring);
    
    // En oscillator med fallande frekvens ger ljudet en dovare anslagskomponent.
    const th=X.createOscillator(),tg=X.createGain();th.frequency.setValueAtTime(150,t);th.frequency.exponentialRampToValueAtTime(80,t+.06);E(tg,t,.5*bd,.001,.12);th.connect(tg);tg.connect(out);th.start(t);th.stop(t+.2);
    
    // Här lägger jag till två typer av brus som kompletterar tonerna.
    // Det första är ett kortare, ljusare brus och det andra har ett annat frekvensområde.
    const ch=B("highpass",2200),cg=X.createGain();E(cg,t,.5*br,4e-4,.007);N(W,t,.03).connect(ch);ch.connect(cg);cg.connect(out);
    const sb=B("bandpass",1300,1),sg=X.createGain();E(sg,t,.25*br,8e-4,.035);N(W,t,.06).connect(sb);sb.connect(sg);sg.connect(out)},
    
    // D ändrar den tillfälliga ljudnivån genom SD.
    // Det används för att skapa en kort volymsänkning när en effekt spelas.
    D=(t,d)=>{SD.gain.setTargetAtTime(1-d,t,.01);SD.gain.setTargetAtTime(1,t+.12,.22)},
    
    // drop spelar upp ljudet när kulan släpps.
    // Funktionen kontrollerar först att ljudmotorn finns och är igång.
    // Därefter skapas flera anslag efter varandra, med minskande styrka och förändrad frekvens.
    drop=w=>{if(!X||X.state!=="running")return;const p=w===void 0?.8:w,t=X.currentTime+.005,f=560+Math.random()*60;
    [[0,1,1,1,1],[.095,.35,1.05,.5,.3],[.165,.14,1.09,.35,.1],[.21,.06,1.12,.3,.05],[.24,.025,1.15,.25,.02]].forEach(([a,b,c,d,e])=>I(t+a,p*b,f*c,d,e,1));D(t,.35)},
    
    // thud spelar upp ett dovt stötl ljud.
    // LT används för att förhindra att samma effekt spelas för tätt inpå sig själv.
    // Om ljudet spelas används I med en lägre grundfrekvens och andra inställningar.
    thud=w=>{if(!X||X.state!=="running")return;const t=X.currentTime+.003;if(t-LT<.15)return;LT=t;I(t,C(w===void 0?.5:w,.1,1),340,1.3,1.5,.7);D(t,.25)},
    
    // H byter tonmaterial i musiken.
    // Den hämtar rätt musikuppsättning från PROG och ändrar frekvenserna på oscillatorerna.
    // Om im är sant sker ändringen direkt, annars görs den gradvis.
    H=(i,t,im)=>{const c=PROG[i];PV.forEach((os,j)=>os.forEach(o=>im?o.frequency.setValueAtTime(M(c.p[j]),t):o.frequency.setTargetAtTime(M(c.p[j]),t,.5)));im?PS.frequency.setValueAtTime(M(c.r),t):PS.frequency.setTargetAtTime(M(c.r),t,.5);CC=i},
    
    // A ändrar musikens grundinställningar beroende på aktuell nivå.
    // Inställningarna hämtas från LV och används för att ändra volym, filterfrekvens och brusnivå.
    // Parametern f påverkar hur snabbt förändringen sker.
    A=(n,t,f)=>{const L=LV[n],k=f?.15:.8;[BK,BB,BH,BC,BA,BG].forEach(b=>b.gain.setTargetAtTime(L.m,t,k));BP.gain.setTargetAtTime(L.p*L.m,t,k);PF.frequency.setTargetAtTime(L.c,t,k);AG.gain.setTargetAtTime(L.a,t,k)},
    
    // Ki skapar ett dovt slagljud med en oscillator som går från högre till lägre frekvens.
    // Om inställningen innehåller ett filter används det för att forma ljudet.
    // En kort bruskomponent kan också läggas till.
    Ki=(t,k)=>{const o=X.createOscillator(),g=X.createGain();o.frequency.setValueAtTime(160,t);o.frequency.exponentialRampToValueAtTime(46,t+.11);E(g,t,k.g,.003,.42);
    if(k.l){const f=B("lowpass",k.l);o.connect(f);f.connect(g)}else o.connect(g);
    g.connect(BK);o.start(t);o.stop(t+.48);
    if(k.c>0){const h=B("highpass",1800),c=X.createGain();E(c,t,k.c*k.g*.35,5e-4,.012);N(W,t,.03).connect(h);h.connect(c);c.connect(BK)}},
    
    // Bs skapar en bas- eller syntton som används i musikens rytmiska mönster.
    // Den använder två oscillatorer och ett lågpassfilter.
    // Frekvensen på filtret förändras under ljudets gång, vilket formar tonens klang.
    Bs=(t,m,n,c,k,v)=>{const f=M(m+12),l=Math.max(.06,n*S*.85),o=O(f,"sawtooth"),s=O(f/2),fl=B("lowpass",0,v>=5?6:4);
    fl.frequency.setValueAtTime(c*2.6,t);fl.frequency.exponentialRampToValueAtTime(c,t+.12);
    const g=X.createGain(),a=g.gain;a.setValueAtTime(1e-4,t);a.linearRampToValueAtTime(k,t+.006);a.setValueAtTime(k,t+l);a.exponentialRampToValueAtTime(1e-4,t+l+.07);
    const sg=G(.8);o.connect(fl);fl.connect(g);s.connect(sg);sg.connect(g);g.connect(BB);o.start(t);s.start(t);o.stop(t+l+.1);s.stop(t+l+.1)},
    
    // Ha skapar ett kort brusljud som fungerar som en hi-hat-liknande rytmkomponent.
    // Parametern o avgör vilken variant som används och k styr ljudstyrkan.
    Ha=(t,o,k)=>{const h=B("highpass",7200),g=X.createGain();E(g,t,k,.001,o?.16:.035);N(W,t,o?.2:.06).connect(h);h.connect(g);g.connect(BH)},
    
    // Cl skapar ett kort, upprepat brusljud som kan fungera som en rytmisk accent.
    // Volymen pulserar flera gånger innan ljudet klingar av.
    Cl=(t,k)=>{const b=B("bandpass",1400,.9),g=X.createGain(),a=g.gain;a.setValueAtTime(1e-4,t);
    for(const j of[0,.011,.022]){a.setValueAtTime(k,t+j);a.exponentialRampToValueAtTime(k*.2,t+j+.009)}
    a.setValueAtTime(k*.9,t+.033);a.exponentialRampToValueAtTime(1e-4,t+.2);N(W,t,.22).connect(b);b.connect(g);g.connect(BC)},
    
    // Pl skapar en ton som används som en melodisk eller rytmisk accent.
    // Tonen filtreras och volymen tonas ner så att den får ett kort och avgränsat ljud.
    Pl=(t,m,k,c)=>{const o=O(M(m),"sawtooth"),f=B("lowpass",0,3),g=X.createGain();f.frequency.setValueAtTime(c,t);f.frequency.exponentialRampToValueAtTime(c*.25,t+.16);E(g,t,k,.002,.2);o.connect(f);f.connect(g);g.connect(BA);o.start(t);o.stop(t+.26)},
    
    // Pi skapar en ljusare ton genom att kombinera en grundton med en oscillator på dubbla frekvensen.
    // Ljudet får en långsammare avklingning och används som en musikalisk accent.
    Pi=(t,m)=>{const g=X.createGain();E(g,t,.16,.005,1.4);const o=O(M(m)),o2=O(M(m)*2),g2=G(.2);o.connect(g);o2.connect(g2);g2.connect(g);g.connect(BG);o.start(t);o2.start(t);o.stop(t+1.5);o2.stop(t+1.5)},
    
    // Bm skapar ett djupt basljud med fallande frekvens.
    // Det används när musiken byter till en högre nivå eller ett nytt läge.
    Bm=t=>{const o=X.createOscillator(),g=X.createGain();o.frequency.setValueAtTime(70,t);o.frequency.exponentialRampToValueAtTime(30,t+.9);E(g,t,.45,.004,1.1);o.connect(g);g.connect(BK);o.start(t);o.stop(t+1.2)},
    
    // Sw skapar ett svepande brusljud.
    // Filtret går från en lägre till en högre frekvens samtidigt som volymen ökar och sedan klingar av.
    // Det kan användas som en övergångseffekt inför ett musikbyte.
    Sw=(a,b)=>{const p=B("bandpass",0,1.6),g=X.createGain(),n=g.gain;p.frequency.setValueAtTime(350,a);p.frequency.exponentialRampToValueAtTime(6500,b);
    n.setValueAtTime(1e-4,a);n.linearRampToValueAtTime(.14,b-.01);n.exponentialRampToValueAtTime(1e-4,b+.06);N(W,a,b-a+.1).connect(p);p.connect(g);g.connect(BH)},
    
    // Sc är själva musikens schemaläggare.
    // Den tar emot ett musiksteg s och en tidpunkt t och avgör vilka ljud som ska spelas just då.
    // Varje takt består av 16 steg, vilket gör att jag kan placera ljud på bestämda positioner i rytmen.
    Sc=(s,t)=>{const b=s%16;
    
    // När en ny takt börjar kontrollerar jag om spelaren har valt en annan nivå.
    // Om ett nivåbyte väntar uppdateras CL och musikens inställningar ändras.
    // Vid byte till en högre nivå spelas även ett extra basljud.
    if(!b&&PL!==null){const u=PL>CL;CL=PL;PL=null;A(CL,t);if(u)Bm(t)}
    
    // Här hämtar jag inställningarna för den aktuella nivån.
    // i bestämmer vilken musikuppsättning som används och H byter i så fall tonmaterial.
    const L=LV[CL],i=Math.floor(s/32)%4;if(i!==CC)H(i,t);const h=PROG[i];
    
    // På vissa nivåer spelas ett basljud på bestämda steg i takten.
    if(L.k&&[0,4,8,12].includes(b)){Ki(t,L.k);DA.gain.setValueAtTime(1-L.d,t);DA.gain.linearRampToValueAtTime(1,t+.22)}
    
    // Om nivån har ett definierat basmönster kontrollerar jag om något av dess ljud ska spelas på det aktuella steget.
    if(L.b)for(const n of L.b.n)if(n[0]===b)Bs(t,h.r+n[1],n[2],L.b.c,L.b.g,CL);
    
    // Här skapar jag olika rytmiska brusljud beroende på nivå.
    // Nivåerna får olika mönster så att ljudbilden förändras när spelaren går vidare.
    const y=L.h,e=b%4;
    if(y===3){e===2&&Ha(t,1,.1)}
    else if(y===4){e===2?Ha(t,1,.12):e===0?Ha(t,0,.06):b%2&&Ha(t,0,.035)}
    else if(y===5)e===2?Ha(t,1,.14):b%2?Ha(t,0,.07):Ha(t,0,.05);
    
    // Vissa nivåer använder även Cl som en extra rytmisk accent.
    if(L.l&&(b===4||b===12||CL===5&&b===15))Cl(t,b===15?L.l*.35:L.l);
    
    // På nivå 4 och 5 kan jag lägga till melodiska toner enligt mönstren i A4 och A5.
    if(L.r){if(CL===4&&!(b%2))Pl(t,h.a[A4[b/2%8]],L.r,1800);else if(CL===5)Pl(t,h.a[A5[b]]+(b%8===7?12:0),L.r,2600)}
    
    // Här avgör jag om en extra melodisk accent ska spelas.
    // PG får ett slumpmässigt valt steg om sannolikheten i L.q uppfylls.
    if(!b)PG=Math.random()<L.q?P([3,6,7,10,11,14]):-1;if(b===PG)Pi(t,P(h.a)+12)},
    
    // Sh ser till att musiken fortsätter att schemaläggas medan ljudsystemet är igång.
    // Den räknar fram kommande musiksteg utifrån den aktuella ljudtiden.
    // På så sätt kan ljuden planeras lite i förväg och spelas mer exakt i tid.
    Sh=()=>{if(!X||X.state!=="running")return;const n=X.currentTime;for(;NT<n+.25;NT+=S,NS++)if(NT>=n-.05)Sc(NS,NT)},
    
    // Sl hanterar byte av musiknivå.
    // Nivån begränsas till intervallet 1–5 och sparas som ett väntande byte i PL.
    // Själva bytet genomförs sedan vid nästa lämpliga taktstart i Sc.
    Sl=n=>{n=C(Math.round(n),1,5);if(n===(PL??CL))return;if(n===CL){PL=null;return}PL=n;
    
    // Om spelaren går upp en nivå kan ett övergångsljud planeras fram till nästa takt.
    // Om det är för kort tid kvar hoppar jag över svepet.
    const b=(16-NS%16)%16,e=NT+b*S,a=X.currentTime+.03;if(e-a>.35)Sw(a,e)},
    
    // mT räknar ut vilken huvudvolym som ska användas.
    // Om ljudet är avstängt blir volymen nästan noll.
    // Annars påverkas den av fade-värdet fd.
    mT=()=>mu?1e-4:Math.max(1e-4,(1-fd)*MV),
    
    // fadeIn tonar in ljudet från nästan tyst till normal volym.
    // s anger hur lång tid övergången ska ta.
    // Om ljudet är avstängt förblir volymen på nästan noll.
    fadeIn=s=>{fd=0;if(!X)return;const t=X.currentTime;MS.gain.cancelScheduledValues(t);MS.gain.setValueAtTime(1e-4,t);MS.gain.linearRampToValueAtTime(mu?1e-4:MV,t+Math.max(.05,s))};
    
    // Här returnerar jag de funktioner och egenskaper som resten av projektet får tillgång till.
    // Det gör att andra filer kan styra ljudet utan att behöva komma åt alla interna ljudnoder.
    return{
    
    // start initierar ljudsystemet.
    // Om ljudsystemet redan finns försöker jag återuppta det om det är pausat.
    // Annars skapas en AudioContext, ljudmiljön byggs upp och musikens startläge bestäms.
    start:(n,l)=>{if(X){if(X.state==="suspended")X.resume();return!0}
    
    // Webbläsare kan använda olika namn för AudioContext.
    // Om inget av dem finns kan ljudsystemet inte starta och funktionen returnerar false.
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return!1;
    
    // Här skapar jag själva ljudmotorn och bygger alla ljudnoder och ljudbuffrar.
    X=new AC({latencyHint:"interactive"});build();
    
    // Jag räknar ut vilket musiksteg som ska spelas utifrån den tid som spelet redan har gått.
    // CL sätts till den nivå som skickas in, eller nivå 1 om inget värde anges.
    NS=Math.ceil((n+.1)/S);NT=NS*S+(X.currentTime-n);CL=C(l||1,1,5);
    
    // Jag ställer in rätt musik direkt vid start.
    H(Math.floor(NS/32)%4,X.currentTime,1);A(CL,X.currentTime,1);
    
    // Sh körs regelbundet för att schemalägga kommande musiksteg.
    setInterval(Sh,40);
    
    // Om användaren lämnar fliken och sedan kommer tillbaka försöker jag återuppta ljudmotorn.
    // Webbläsare kan pausa ljud när sidan inte är aktiv.
    document.addEventListener("visibilitychange",()=>{if(X&&!document.hidden)X.resume()});X.resume();
    
    // Till sist tonar jag in ljudet så att det inte startar abrupt.
    fadeIn(1.8);return!0},
    
    // update är funktionen som uppdaterar ljudet medan spelet körs.
    // Den tar emot ett objekt med information om nivå, hastighet, om kulan hålls och friktion.
    // Värdena skickas vidare till Sl och U, som ändrar musiken respektive rörelseljudet.
    update:o=>{if(!X||X.state!=="running")return;Sl(o.level);U(Math.min(.05,Math.max(.001,o.dt||.016)),o.speed||0,!!o.held,o.fric||0)},
    
    // Dessa två funktioner gör det möjligt för andra delar av spelet att spela upp
    // ljudet för när kulan släpps respektive stöter emot något.
    drop,thud,
    
    // setFade ändrar hur mycket ljudet ska tonas ner.
    // Värdet begränsas till intervallet 0–1 och används för att räkna ut huvudvolymen.
    setFade:a=>{fd=C(a,0,1);if(X)MS.gain.setTargetAtTime(mT(),X.currentTime,.05)},
    
    // fadeIn görs tillgänglig för resten av projektet så att ljudet kan tonas in igen.
    fadeIn,
    
    // reset återställer ljudsystemets musikläge till nivå 1.
    // Den nollställer även väntande nivåbyte och rörelsens ljudstyrka.
    reset:()=>{if(!X)return;CL=1;PL=null;SP=0;A(1,X.currentTime,1)},
    
    // toggleMute växlar mellan ljud på och ljud av.
    // Den uppdaterar huvudvolymen och returnerar det nya mute-läget.
    toggleMute:()=>{mu=!mu;if(X)MS.gain.setTargetAtTime(mT(),X.currentTime,.05);return mu},
    
    // muted gör det möjligt att läsa av om ljudet är avstängt utan att ändra tillståndet.
    get muted(){return mu}}})();