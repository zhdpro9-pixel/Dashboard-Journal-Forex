'use strict';
/* ================= util ================= */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const NS='http://www.w3.org/2000/svg';
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
const MONTHS=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const MONTHS_FULL=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAYS=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const LS_KEY='tjd.trades.v1', LS_SET='tjd.settings.v1';
const EMPTY_CH='<div class="chart-empty">Belum ada trade pada periode ini.</div>';

const pad=n=>String(n).padStart(2,'0');
const parseISO=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)};
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayISO=()=>iso(new Date());
function addDays(s,n){const d=parseISO(s);d.setDate(d.getDate()+n);return iso(d)}
const fmtDate=s=>{if(!s)return'—';const d=parseISO(s);return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`};
const fmtDateLong=s=>{const d=parseISO(s);return `${DAYS[d.getDay()]}, ${fmtDate(s)}`};
const shortDate=s=>{const p=fmtDate(s).split(' ');return p[0]+' '+p[1]};
const nf=(v,min,max)=>new Intl.NumberFormat('id-ID',{minimumFractionDigits:min,maximumFractionDigits:max}).format(v);
function fmtPct(v,dec=2){if(v==null||isNaN(v))return'—';return (v>0?'+':'')+nf(v,dec,dec)+'%'}
function fmtPrice(v){if(v==null||isNaN(v))return'—';const dec=Math.abs(v)<2?5:2;return nf(v,dec,dec)}
const fmtInt=v=>nf(v,0,0);
function fmtAxisPct(v){const d=Math.abs(v)>=10?0:Math.abs(v)>=1?1:2;return (v>0?'+':'')+new Intl.NumberFormat('id-ID',{maximumFractionDigits:d}).format(v)+'%'}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trunc=(s,n)=>s.length>n?s.slice(0,n-1)+'…':s;
const pcls=v=>(v==null||v===0)?'be':(v>0?'pos':'neg');
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

/* ================= data ================= */
function loadTrades(){try{const r=JSON.parse(localStorage.getItem(LS_KEY)||'[]');return Array.isArray(r)?r.filter(t=>t&&t.date&&t.entry>0&&t.exit>0).map(t=>{if(t.lot==null&&t.capital!=null)t.lot=0.10;return t}):[]}catch(e){return[]}}
function saveTrades(){localStorage.setItem(LS_KEY,JSON.stringify(trades))}
function loadSettings(){try{const s=JSON.parse(localStorage.getItem(LS_SET)||'{}');if(s.period)state.period=s.period;if(s.cumMethod)state.cumMethod=s.cumMethod}catch(e){}}
function saveSettings(){try{localStorage.setItem(LS_SET,JSON.stringify({period:state.period,cumMethod:state.cumMethod}))}catch(e){}}
const LS_CUSTOM='tjd.custom_pairs.v1';
function loadCustomPairs(){try{return JSON.parse(localStorage.getItem(LS_CUSTOM)||'[]')}catch(e){return[]}}
function saveCustomPairs(list){localStorage.setItem(LS_CUSTOM,JSON.stringify(list))}
const defaultPairs=['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD','XAUUSD','BTCUSDT'];
function populateAssetSelect(selectedVal=''){
  const sel=$('#fAsset'),custom=loadCustomPairs(),current=selectedVal||sel.value||'EURUSD';
  sel.innerHTML='';
  const og1=document.createElement('optgroup');og1.label='Pair Populer';
  defaultPairs.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;og1.appendChild(o)});
  sel.appendChild(og1);
  if(custom.length){
    const og2=document.createElement('optgroup');og2.label='Pair Kustom';
    custom.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;og2.appendChild(o)});
    sel.appendChild(og2);
  }
  const oC=document.createElement('option');oC.value='__custom__';oC.textContent='+ Tambah Pair Lain...';sel.appendChild(oC);
  if(selectedVal&&!defaultPairs.includes(selectedVal)&&!custom.includes(selectedVal)){
    sel.value='__custom__';$('#fAssetCustom').style.display='block';$('#fAssetCustom').value=selectedVal;
  }else{
    sel.value=current;$('#fAssetCustom').style.display=sel.value==='__custom__'?'block':'none';
  }
}
function getPipMultiplier(asset){
  if(!asset)return 10000;const a=asset.toUpperCase();
  if(a.includes('JPY'))return 100;
  if(a.includes('XAU')||a.includes('GOLD'))return 10;
  if(a.includes('BTC')||a.includes('ETH'))return 1;
  return 10000;
}
function calcPips(asset,pos,entry,exit){
  if(!entry||!exit)return 0;const diff=pos==='LONG'?(exit-entry):(entry-exit);
  return diff*getPipMultiplier(asset);
}
let trades=loadTrades();
const state={page:'overview',period:'all',cFrom:'',cTo:'',cumMethod:'comp',editingId:null,expanded:null,calCursor:null,selDay:null,
  j:{q:'',pos:'ALL',from:'',to:''}};
loadSettings();
let formPos='LONG';

const tradeRet=t=>t.position==='LONG'?(t.exit-t.entry)/t.entry*100:(t.entry-t.exit)/t.entry*100;
const sorted=()=>[...trades].sort((a,b)=>a.date===b.date?((a.createdAt||0)-(b.createdAt||0)):(a.date<b.date?-1:1));
function periodRange(){const t=todayISO();switch(state.period){
  case '7d':return[addDays(t,-6),t];case '30d':return[addDays(t,-29),t];case '90d':return[addDays(t,-89),t];
  case 'custom':return[state.cFrom||null,state.cTo||null];default:return[null,null]}}
const pt=()=>{const[f,t]=periodRange();return sorted().filter(x=>(!f||x.date>=f)&&(!t||x.date<=t))};
function periodLabel(){return{all:'Semua Waktu','7d':'7 Hari Terakhir','30d':'30 Hari Terakhir','90d':'90 Hari Terakhir',
  custom:`${state.cFrom?fmtDate(state.cFrom):'…'} – ${state.cTo?fmtDate(state.cTo):'…'}`}[state.period]}

function metrics(arr){
  const rets=arr.map(tradeRet);
  const wins=rets.filter(r=>r>0).length,losses=rets.filter(r=>r<0).length,be=rets.length-wins-losses;
  const avg=rets.length?rets.reduce((a,b)=>a+b,0)/rets.length:null;
  const simple=rets.reduce((a,b)=>a+b,0);
  let eq=100,peak=100,maxDD=0,ddDate=null;const eqPts=[100],curve=[0],simpleCurve=[];let s=0;
  arr.forEach((t,i)=>{eq*=(1+rets[i]/100);eqPts.push(eq);curve.push(eq-100);s+=rets[i];simpleCurve.push(s);
    if(eq>peak)peak=eq;const dd=(eq/peak-1)*100;if(dd<maxDD){maxDD=dd;ddDate=t.date}});
  return{rets,wins,losses,be,total:arr.length,winRate:rets.length?wins/rets.length*100:null,avg,simple,comp:eq-100,curve,simpleCurve,eqPts,maxDD,ddDate};
}
function drawdownSeries(m){let peak=100;return m.eqPts.map(eq=>{if(eq>peak)peak=eq;return(eq/peak-1)*100})}
function sideStats(arr){const mk=()=>({n:0,w:0,sum:0});const L=mk(),S=mk();
  arr.forEach(t=>{const r=tradeRet(t),o=t.position==='LONG'?L:S;o.n++;o.sum+=r;if(r>0)o.w++});
  [L,S].forEach(o=>{o.avg=o.n?o.sum/o.n:null;o.wr=o.n?o.w/o.n*100:null});return{L,S}}
function streakInfo(arr){let maxW=0,maxL=0,cur=0,type=null;
  arr.forEach(t=>{const r=tradeRet(t);
    if(r>0){cur=type==='W'?cur+1:1;type='W';maxW=Math.max(maxW,cur)}
    else if(r<0){cur=type==='L'?cur+1:1;type='L';maxL=Math.max(maxL,cur)}
    else{type=null;cur=0}});
  return{maxW,maxL,cur,type}}

/* ================= svg helpers & tooltip ================= */
function el(n,a={},parent){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);if(parent)parent.appendChild(e);return e}
function mkSvg(box,w,h){const s=el('svg',{viewBox:`0 0 ${w} ${h}`,class:'chart'});s.setAttribute('width','100%');s.setAttribute('height',h);box.appendChild(s);return s}
function ticks(min,max,n=4){if(min===max){min-=1;max+=1}const span=max-min,step0=span/n;
  const mag=Math.pow(10,Math.floor(Math.log10(step0))),norm=step0/mag;
  const step=(norm<1.5?1:norm<3?2:norm<7?5:10)*mag;const t0=Math.ceil(min/step)*step,out=[];
  for(let v=t0;v<=max+1e-9;v+=step)out.push(+v.toFixed(10));return out}
const tip=$('#tooltip');
const tipRow=(l,v,c='')=>`<div class="tip-row"><span>${l}</span><b class="${c}">${v}</b></div>`;
function showTip(html,e){tip.innerHTML=html;tip.classList.add('on');moveTip(e)}
function moveTip(e){const p=14;let x=e.clientX+p,y=e.clientY+p;const r=tip.getBoundingClientRect();
  if(x+r.width>innerWidth-8)x=e.clientX-r.width-p;if(y+r.height>innerHeight-8)y=e.clientY-r.height-p;
  tip.style.left=x+'px';tip.style.top=y+'px'}
const hideTip=()=>tip.classList.remove('on');

/* ================= toast & modal ================= */
function toast(msg,type='ok'){const d=document.createElement('div');d.className='toast '+type;
  d.innerHTML=`<span>${type==='ok'?'✔':'⚠'}</span><span>${msg}</span>`;
  $('#toasts').appendChild(d);setTimeout(()=>d.classList.add('out'),2600);setTimeout(()=>d.remove(),3050)}
function confirmBox({title,msg,ok='Ya, Lanjutkan',danger=true}){return new Promise(res=>{
  const root=$('#modalRoot');
  root.innerHTML=`<div class="overlay"><div class="modal"><h3>${title}</h3><p class="mmsg">${msg}</p>
    <div class="mact"><button class="btn ghost" id="mNo">Batal</button><button class="btn ${danger?'danger-solid':'primary'}" id="mYes">${ok}</button></div></div></div>`;
  const done=v=>{root.innerHTML='';document.removeEventListener('keydown',esc);res(v)};
  const esc=e=>{if(e.key==='Escape')done(false)};
  document.addEventListener('keydown',esc);
  $('#mNo').onclick=()=>done(false);$('#mYes').onclick=()=>done(true);
  root.querySelector('.overlay').addEventListener('click',e=>{if(e.target.classList.contains('overlay'))done(false)});
})}
function infoBox(title,html){const root=$('#modalRoot');
  root.innerHTML=`<div class="overlay"><div class="modal"><h3>${title}</h3>${html}
    <div class="mact"><button class="btn primary" id="mOk">Mengerti</button></div></div></div>`;
  const done=()=>{root.innerHTML='';document.removeEventListener('keydown',esc)};
  const esc=e=>{if(e.key==='Escape')done()};
  document.addEventListener('keydown',esc);
  $('#mOk').onclick=done;
  root.querySelector('.overlay').addEventListener('click',e=>{if(e.target.classList.contains('overlay'))done()});}

/* ================= tween angka ================= */
function tween(elm,to,fmt){const from=elm._v??0;elm._v=to;
  if(REDUCED||Math.abs(to-from)<1e-9){elm.textContent=fmt(to);return}
  const t0=performance.now(),dur=480;
  (function f(t){const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);
    elm.textContent=fmt(from+(to-from)*e);if(p<1)requestAnimationFrame(f)})(t0)}

/* ================= OVERVIEW ================= */
const statCard=(i,label,val,sub)=>`<div class="card stat reveal" style="--d:${i*35}ms"><div class="stat-label">${label}</div><div class="stat-value">${val}</div><div class="stat-sub">${sub}</div></div>`;
function sparkSVG(series){if(!series||series.length<2)return'';const w=110,h=26;
  const lo=Math.min(...series),hi=Math.max(...series),sp=(hi-lo)||1;
  const pts=series.map((v,i)=>`${(i/(series.length-1)*w).toFixed(1)},${(h-3-(v-lo)/sp*(h-6)).toFixed(1)}`).join(' ');
  const up=series[series.length-1]>=series[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${up?'var(--green)':'var(--red)'}" stroke-width="1.6"/></svg>`}

function renderStatCards(m,arr){
  const box=$('#statCards');
  const best=arr.length?arr.reduce((a,b)=>tradeRet(b)>tradeRet(a)?b:a):null;
  const days=new Set(arr.map(t=>t.date)).size;
  const cumVal=state.cumMethod==='comp'?m.comp:m.simple;
  const series=state.cumMethod==='comp'?m.curve:[0,...m.simpleCurve];
  const wrW=m.total?m.wins/m.total*100:0,wrL=m.total?m.losses/m.total*100:0;
  box.innerHTML=
    statCard(0,'Total Trades',`<span id="vTotal"></span>`,`${m.wins}W · ${m.losses}L${m.be?` · ${m.be} BE`:''} · ${days} hari aktif`)+
    statCard(1,'Win Rate',`<span id="vWR"></span>`,`<div class="wl-bar" style="width:100%"><i class="w" style="width:${wrW}%"></i><i class="l" style="width:${wrL}%"></i></div>`)+
    statCard(2,'Avg Return / Trade',`<span id="vAvg"></span>`,'Rata-rata aritmetika — hanya trade tercatat')+
    statCard(3,'Cumulative Return',`<span id="vCum"></span>`,`${sparkSVG(series)}<span>${state.cumMethod==='comp'?'Compounded':'Simple'}</span>`)+
    statCard(4,'Best Trade',`<span id="vBest"></span>`,best?`${esc(best.asset)||'—'} · ${fmtDate(best.date)} · ${best.position}`:'—')+
    statCard(5,'Max Drawdown',`<span id="vDD"></span>`,'Compounded · puncak → lembah');
  const set=(id,v,fmt,cls)=>{const n=$('#'+id);if(v==null){n.textContent='—';n._v=0;return}
    if(cls)n.classList.add(cls);tween(n,v,fmt)};
  set('vTotal',m.total,v=>fmtInt(Math.round(v)));
  set('vWR',m.winRate,v=>fmtPct(v,1));
  set('vAvg',m.avg,v=>fmtPct(v),pcls(m.avg));
  set('vCum',m.total?cumVal:null,v=>fmtPct(v),pcls(cumVal));
  set('vBest',best?tradeRet(best):null,v=>fmtPct(v),best?pcls(tradeRet(best)):'');
  set('vDD',m.total?m.maxDD:null,v=>fmtPct(v),pcls(m.maxDD));
}

function renderDailyChart(){
  const box=$('#chDaily');box.innerHTML='';
  const arr=pt();if(!arr.length){box.innerHTML=EMPTY_CH;return}
  const w=Math.max(300,box.clientWidth),h=252,pl=48,pr=12,ptp=16,pb=26;
  const svg=mkSvg(box,w,h);
  const rets=arr.map(tradeRet);
  let lo=Math.min(0,...rets),hi=Math.max(0,...rets);
  if(hi===lo){hi+=1;lo-=1}
  const padV=(hi-lo)*.1;hi+=padV;if(lo<0)lo-=padV;
  const iw=w-pl-pr,ih=h-ptp-pb;
  const Y=v=>ptp+(hi-v)/(hi-lo)*ih,y0=Y(0);
  ticks(lo,hi,4).forEach(v=>{el('line',{x1:pl,x2:w-pr,y1:Y(v),y2:Y(v),class:'grid'},svg);
    el('text',{x:pl-7,y:Y(v)+3.5,'text-anchor':'end'},svg).textContent=fmtAxisPct(v)});
  el('line',{x1:pl,x2:w-pr,y1:y0,y2:y0,class:'zero'},svg);
  const band=iw/arr.length,bw=Math.max(4,Math.min(26,band*.6));
  const le=Math.max(1,Math.ceil(arr.length/Math.max(1,Math.floor(iw/58))));
  arr.forEach((t,i)=>{const r=rets[i],cx=pl+band*i+band/2;
    const rect=el('rect',{x:cx-bw/2,width:bw,rx:2.5,class:'bar '+(r>0?'pos':r<0?'neg':'be')},svg);
    if(r>=0){rect.setAttribute('y',Y(r));rect.setAttribute('height',Math.max(1.5,y0-Y(r)))}
    else{rect.setAttribute('y',y0);rect.setAttribute('height',Math.max(1.5,Y(r)-y0))}
    rect.style.transformOrigin=`${cx}px ${y0}px`;
    rect.style.animation=`barGrow .5s ${i*16}ms cubic-bezier(.2,.7,.3,1) both`;
    rect.addEventListener('mouseenter',e=>{rect.classList.add('hot');
      showTip(`<div class="tip-t">${fmtDate(t.date)}</div>${tipRow('Aset',esc(t.asset)||'—')}${tipRow('Posisi',t.position,t.position==='LONG'?'c-l':'c-s')}${tipRow('Return',fmtPct(r),pcls(r))}`,e)});
    rect.addEventListener('mousemove',moveTip);
    rect.addEventListener('mouseleave',()=>{rect.classList.remove('hot');hideTip()});
    if(i%le===0)el('text',{x:cx,y:h-8,'text-anchor':'middle'},svg).textContent=shortDate(t.date);
  });
}

function renderCumChart(){
  const box=$('#chCum');box.innerHTML='';
  const arr=pt();if(!arr.length){box.innerHTML=EMPTY_CH;return}
  const m=metrics(arr),comp=state.cumMethod==='comp';
  $('#cumHint').textContent=comp?'Compounded: akumulasi perkalian return (1+r)':'Simple: akumulasi penjumlahan return linier';
  const vals=comp?m.curve:[0,...m.simpleCurve];
  const labels=['Mulai',...arr.map(t=>t.date)],n=vals.length;
  const w=Math.max(300,box.clientWidth),h=252,pl=54,pr=58,ptp=14,pb=24;
  const svg=mkSvg(box,w,h);
  let lo=Math.min(0,...vals),hi=Math.max(0,...vals);
  if(hi===lo){hi+=1;lo-=1}
  const padV=(hi-lo)*.12;hi+=padV;if(lo<0)lo-=padV;
  const iw=w-pl-pr,ih=h-ptp-pb;
  const X=i=>n>1?pl+iw*i/(n-1):pl+iw/2, Y=v=>ptp+(hi-v)/(hi-lo)*ih, y0=Y(0);
  ticks(lo,hi,4).forEach(v=>{el('line',{x1:pl,x2:w-pr,y1:Y(v),y2:Y(v),class:'grid'},svg);
    el('text',{x:pl-7,y:Y(v)+3.5,'text-anchor':'end'},svg).textContent=fmtAxisPct(v)});
  el('line',{x1:pl,x2:w-pr,y1:y0,y2:y0,class:'zero'},svg);
  const defs=el('defs',{},svg);
  const g=el('linearGradient',{id:'gCum',x1:0,y1:0,x2:0,y2:1},defs);
  el('stop',{offset:'0%','stop-color':'#e8b84b','stop-opacity':.26},g);
  el('stop',{offset:'100%','stop-color':'#e8b84b','stop-opacity':0},g);
  let d=`M${X(0)},${Y(vals[0])}`;for(let i=1;i<n;i++)d+=`L${X(i)},${Y(vals[i])}`;
  el('path',{d:`${d}L${X(n-1)},${y0}L${X(0)},${y0}Z`,fill:'url(#gCum)'},svg);
  const line=el('path',{d,fill:'none',stroke:'var(--gold)','stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  if(!REDUCED){const len=line.getTotalLength();line.style.strokeDasharray=len;line.style.strokeDashoffset=len;
    line.getBoundingClientRect();line.style.transition='stroke-dashoffset .8s ease';line.style.strokeDashoffset='0'}
  for(let i=0;i<n;i++)el('circle',{cx:X(i),cy:Y(vals[i]),r:2.6,fill:'#0a0e15',stroke:'var(--gold)','stroke-width':1.6},svg);
  const last=vals[n-1];
  el('text',{x:X(n-1)+8,y:Y(last)+4,fill:last>=0?'var(--green)':'var(--red)','font-weight':'600','font-size':'11.5px'},svg).textContent=fmtPct(last);
  const le=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(iw/70))));
  for(let i=0;i<n;i++)if(i%le===0||i===n-1)
    el('text',{x:X(i),y:h-7,'text-anchor':'middle'},svg).textContent=labels[i]==='Mulai'?'Mulai':shortDate(labels[i]);
  const vline=el('line',{y1:ptp,y2:h-pb,class:'zero',opacity:0},svg);
  const focus=el('circle',{r:4.2,fill:'var(--gold)',opacity:0},svg);
  const ov=el('rect',{x:pl,y:ptp,width:iw,height:ih,fill:'transparent'},svg);
  ov.addEventListener('pointermove',e=>{const bx=svg.getBoundingClientRect();
    const i=Math.max(0,Math.min(n-1,Math.round((e.clientX-bx.left-pl)/(iw||1)*(n-1))));
    vline.setAttribute('x1',X(i));vline.setAttribute('x2',X(i));vline.setAttribute('opacity',1);
    focus.setAttribute('cx',X(i));focus.setAttribute('cy',Y(vals[i]));focus.setAttribute('opacity',1);
    showTip(`<div class="tip-t">${labels[i]==='Mulai'?'Titik Awal':fmtDate(labels[i])}</div>${tipRow('Kumulatif ('+(comp?'compounded':'simple')+')',fmtPct(vals[i]),pcls(vals[i]))}`,e)});
  ov.addEventListener('pointerleave',()=>{vline.setAttribute('opacity',0);focus.setAttribute('opacity',0);hideTip()});
}

function renderRecent(){
  const list=sorted().slice(-6).reverse(),box=$('#recentList');
  if(!list.length){box.innerHTML='<p class="hint">Belum ada trade.</p>';return}
  box.innerHTML=list.map(t=>{const r=tradeRet(t),c=pcls(r);
    return `<div class="rrow ${c}" data-id="${t.id}"><div class="rbar"></div>
      <div class="rinfo"><span class="rdate mono">${fmtDate(t.date)}</span>
      <span class="rasset">${esc(t.asset)||'—'} <span class="badge ${t.position.toLowerCase()} sm">${t.position==='LONG'?'▲':'▼'} ${t.position}</span>${t.demo?'<span class="demo-tag">DEMO</span>':''}</span></div>
      <span class="rret mono ${c}">${fmtPct(r)}</span></div>`}).join('');
}

/* ---- Kalender ---- */
function renderCalendar(){
  const now=new Date();
  const cur=state.calCursor||(state.calCursor={y:now.getFullYear(),m:now.getMonth()});
  $('#calTitle').textContent=`${MONTHS_FULL[cur.m]} ${cur.y}`;
  const first=new Date(cur.y,cur.m,1),startIdx=(first.getDay()+6)%7,dim=new Date(cur.y,cur.m+1,0).getDate();
  const map=new Map(trades.map(t=>[t.date,t]));
  let cells=['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=>`<div class="cal-hd">${d}</div>`).join('');
  for(let i=0;i<startIdx;i++)cells+='<div class="cal-day empty"></div>';
  let mw=0,ml=0,mt=0;
  for(let d=1;d<=dim;d++){
    const ds=`${cur.y}-${pad(cur.m+1)}-${pad(d)}`,t=map.get(ds);
    let cls='',ttl=fmtDate(ds);
    if(t){const r=tradeRet(t);cls=pcls(r)==='pos'?'win':pcls(r)==='neg'?'loss':'bee';
      ttl+=` · ${t.asset||'—'} ${fmtPct(r)}`;mt++;if(r>0)mw++;else if(r<0)ml++}
    const today=ds===todayISO()?' today':'',sel=ds===state.selDay?' sel':'';
    cells+=`<div class="cal-day ${cls}${today}${sel}" data-d="${ds}" title="${esc(ttl)}">${d}</div>`;
  }
  $('#calGrid').innerHTML=cells;
  $('#calSum').textContent=mt?`${mt} hari trading · ${mw} profit · ${ml} loss`:'Belum ada trade bulan ini';
}
function renderCalDetail(){
  const box=$('#calDetail');
  if(!state.selDay){box.innerHTML='<div class="cd-empty">Pilih tanggal pada kalender untuk melihat detail trade.</div>';return}
  const t=trades.find(x=>x.date===state.selDay);
  if(!t){box.innerHTML=`<div class="cd-empty"><b>${fmtDateLong(state.selDay)}</b><p>Tidak ada trade. Hari tanpa trade adalah istirahat yang sah — bukan pelanggaran aturan.</p></div>`;return}
  const r=tradeRet(t),c=pcls(r);
  box.innerHTML=`<div class="cd-head">
      <div><div class="cd-date">${fmtDateLong(t.date)}${t.demo?' <span class="demo-tag">DEMO</span>':''}</div>
      <div class="cd-asset">${esc(t.asset)||'Tanpa aset'} · <span class="badge ${t.position.toLowerCase()}">${t.position==='LONG'?'▲':'▼'} ${t.position}</span></div></div>
      <div class="cd-ret ${c}">${fmtPct(r)}</div></div>
    <div class="cd-grid mono"><span>Entry <b>${fmtPrice(t.entry)}</b></span><span>Exit <b>${fmtPrice(t.exit)}</b></span>${t.lot!=null?`<span>Lot <b>${Number(t.lot).toFixed(2)}</b></span>`:''}</div>
    ${t.notes?`<p class="cd-notes">${esc(t.notes)}</p>`:'<p class="cd-notes dim">Tidak ada catatan.</p>'}
    <div class="cd-actions"><button class="btn sm" data-act="edit" data-id="${t.id}">✎ Edit</button><button class="btn sm danger" data-act="del" data-id="${t.id}">Hapus</button></div>`;
}

function renderOverview(){
  const has=trades.length>0;
  $('#ovEmpty').hidden=has;$('#ovBody').hidden=!has;
  if(!has)return;
  const arr=pt(),m=metrics(arr);
  renderStatCards(m,arr);renderDailyChart();renderCumChart();renderRecent();renderCalendar();renderCalDetail();
}

/* ================= JOURNAL ================= */
function filteredJournal(){const{q,pos,from,to}=state.j;
  return sorted().filter(t=>(!q||(t.asset||'').toLowerCase().includes(q))&&(pos==='ALL'||t.position===pos)&&(!from||t.date>=from)&&(!to||t.date<=to)).reverse()}

function renderTable(){
  const rows=filteredJournal(),tb=$('#tbody');
  $('#tblCount').textContent=`Menampilkan ${rows.length} dari ${trades.length} trade`;
  if(!rows.length){tb.innerHTML=`<tr><td colspan="9" style="text-align:center;color:var(--dim);padding:34px">${trades.length?'Tidak ada trade yang cocok dengan filter.':'Belum ada trade — catat trade pertamamu melalui formulir, atau muat data DEMO dari sidebar.'}</td></tr>`;return}
  tb.innerHTML=rows.map(t=>{const r=tradeRet(t),c=pcls(r);
    const res=r>0?['win','PROFIT']:r<0?['loss','LOSS']:['bee','BE'];
    const ex=state.expanded===t.id;
    let html=`<tr class="trow ${c}${ex?' open':''}" data-id="${t.id}">
      <td class="mono">${fmtDate(t.date)}${t.demo?'<span class="demo-tag">DEMO</span>':''}</td>
      <td>${esc(t.asset)||'<span class="dim">—</span>'}</td>
      <td><span class="badge ${t.position.toLowerCase()}">${t.position==='LONG'?'▲':'▼'} ${t.position}</span></td>
      <td class="mono r">${t.lot!=null?Number(t.lot).toFixed(2):'<span class="dim">—</span>'}</td>
      <td class="mono r">${fmtPrice(t.entry)}</td>
      <td class="mono r">${fmtPrice(t.exit)}</td>
      <td class="mono r ${c}"><b>${fmtPct(r)}</b></td>
      <td><span class="badge ${res[0]}">${res[1]}</span></td>
      <td class="notes-cell" title="${esc(t.notes||'')}">${t.notes?esc(trunc(t.notes,32)):'<span class="dim">—</span>'} <span class="chev">${ex?'▴':'▾'}</span></td></tr>`;
    if(ex){const mv=t.position==='LONG'?(t.exit-t.entry):(t.entry-t.exit);
      html+=`<tr class="trow-detail"><td colspan="9"><div class="detail-grid">
        <div><label>Catatan / Trading Journal</label><p>${t.notes?esc(t.notes):'<span class="dim">Tidak ada catatan.</span>'}</p></div>
        <div><label>Pergerakan Harga</label><p class="mono">${fmtPrice(t.entry)} → ${fmtPrice(t.exit)}<br><span class="${c}">${mv>=0?'+':''}${fmtPrice(Math.abs(mv)).replace(/^/,'')} ${mv>=0?'▲':'▼'}</span></p></div>
        <div><label>Lot</label><p class="mono">${t.lot!=null?Number(t.lot).toFixed(2):'<span class="dim">—</span>'}</p></div>
      </div>
      <div class="detail-actions"><button class="btn sm" data-act="edit" data-id="${t.id}">✎ Edit</button><button class="btn sm danger" data-act="del" data-id="${t.id}">Hapus</button></div></td></tr>`}
    return html}).join('');
}

/* ---- form ---- */
function syncPosSeg(){$$('#posSeg button').forEach(b=>b.classList.toggle('on',b.dataset.pos===formPos))}
function updatePreview(){
  const e=parseFloat($('#fEntry').value),x=parseFloat($('#fExit').value),box=$('#retPreview');
  const assetVal=$('#fAsset').value==='__custom__'?$('#fAssetCustom').value.trim():$('#fAsset').value;
  const lot=parseFloat($('#fLot').value)||0.01;
  if(isFinite(e)&&e>0&&isFinite(x)&&x>0){
    const r=formPos==='LONG'?(x-e)/e*100:(e-x)/e*100,c=pcls(r);
    const pips=calcPips(assetVal,formPos,e,x);
    box.innerHTML=`<div class="rp-main ${c}">${r>0?'▲':r<0?'▼':'■'} ${fmtPct(r)}</div>
      <div class="rp-sub">Return harga — ${formPos} · ${fmtPrice(e)} → ${fmtPrice(x)} · Lot: ${lot.toFixed(2)} · ${pips>0?'+':''}${pips.toFixed(1)} pips</div>
      <div class="rp-note">Return harga dihitung otomatis dari selisih pergerakan harga entry → exit.</div>`;
  }else{
    box.innerHTML='<div class="rp-main dim">— %</div><div class="rp-sub">Isi posisi, harga entry, dan harga exit — return dihitung otomatis.</div>';
  }
}
function updateFormUI(){
  const ed=!!state.editingId;
  $('#formTitle').textContent=ed?'Edit Trade':'Catat Trade';
  $('#editBadge').hidden=!ed;
  $('#btnSubmit').textContent=ed?'✔ Simpan Perubahan':'+ Simpan Trade';
  $('#btnCancel').hidden=!ed;
  $('#formCard').classList.toggle('editing',ed);
}
function resetForm(){
  $('#tradeForm').reset();$('#fDate').value=todayISO();
  $('#fLot').value='0.01';populateAssetSelect('EURUSD');
  $('#fAssetCustom').value='';$('#fAssetCustom').style.display='none';
  formPos='LONG';syncPosSeg();updatePreview();$('#formErr').hidden=true;
}
function cancelEdit(){state.editingId=null;resetForm();updateFormUI()}
function startEdit(id){const t=trades.find(x=>x.id===id);if(!t)return;
  go('journal');state.editingId=id;
  $('#fDate').value=t.date;populateAssetSelect(t.asset||'EURUSD');formPos=t.position;syncPosSeg();
  $('#fLot').value=(t.lot!=null?Number(t.lot):0.01).toFixed(2);
  $('#fEntry').value=t.entry;$('#fExit').value=t.exit;$('#fNotes').value=t.notes||'';
  updateFormUI();updatePreview();
  $('#formCard').scrollIntoView({behavior:REDUCED?'auto':'smooth',block:'start'});
}
async function deleteTrade(id){const t=trades.find(x=>x.id===id);if(!t)return;
  const ok=await confirmBox({title:'Hapus Trade?',msg:`Trade ${esc(t.asset)||'tanpa aset'} pada <b>${fmtDate(t.date)}</b> (${fmtPct(tradeRet(t))}) akan dihapus permanen.`,ok:'Ya, Hapus'});
  if(!ok)return;
  trades=trades.filter(x=>x.id!==id);
  if(state.editingId===id)cancelEdit();
  if(state.expanded===id)state.expanded=null;
  saveTrades();renderAll();toast('Trade dihapus');
}

$('#tradeForm').addEventListener('submit',e=>{
  e.preventDefault();
  const date=$('#fDate').value;
  let asset=$('#fAsset').value;
  const entry=parseFloat($('#fEntry').value),exit=parseFloat($('#fExit').value);
  const lotRaw=$('#fLot').value,lot=parseFloat(lotRaw);
  const notes=$('#fNotes').value.trim(),errs=[];
  if(!date)errs.push('Tanggal entry wajib diisi.');
  if(asset==='__custom__'){
    asset=$('#fAssetCustom').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!asset){errs.push('Nama pair kustom wajib diisi.');}
    else{
      const custom=loadCustomPairs();
      if(!defaultPairs.includes(asset)&&!custom.includes(asset)){
        custom.push(asset);saveCustomPairs(custom);populateAssetSelect(asset);
      }
    }
  }
  if(!isFinite(lot)||lot<=0)errs.push('Lot harus berupa angka lebih dari 0.');
  if(!isFinite(entry)||entry<=0)errs.push('Harga entry harus berupa angka lebih dari 0.');
  if(!isFinite(exit)||exit<=0)errs.push('Harga exit harus berupa angka lebih dari 0.');
  const dup=trades.find(t=>t.date===date&&t.id!==state.editingId);
  if(dup)errs.push(`Tanggal ${fmtDate(date)} sudah memiliki trade (${dup.asset||'tanpa aset'}, ${fmtPct(tradeRet(dup))}). Aturan: maksimal 1 entry per hari — edit atau hapus trade lama terlebih dahulu.`);
  const errBox=$('#formErr');
  if(errs.length){errBox.hidden=false;errBox.innerHTML='<ul>'+errs.map(x=>`<li>${x}</li>`).join('')+'</ul>';
    $('#formCard').classList.add('shake');setTimeout(()=>$('#formCard').classList.remove('shake'),450);
    toast('Periksa kembali formulir','err');return}
  errBox.hidden=true;
  if(state.editingId){const t=trades.find(x=>x.id===state.editingId);
    Object.assign(t,{date,asset,position:formPos,entry,exit,lot,notes});
    toast('Perubahan trade disimpan');
  }else{
    trades.push({id:uid(),date,asset,position:formPos,entry,exit,lot,notes,demo:false,createdAt:Date.now()});
    toast('Trade berhasil dicatat');
  }
  saveTrades();state.editingId=null;resetForm();updateFormUI();renderAll();
});
$('#btnCancel').onclick=cancelEdit;
$('#posSeg').addEventListener('click',e=>{const b=e.target.closest('[data-pos]');if(!b)return;formPos=b.dataset.pos;syncPosSeg();updatePreview()});
$('#btnLotPlus').onclick=()=>{
  let v=parseFloat($('#fLot').value)||0;v=Math.round((v+0.01)*100)/100;
  $('#fLot').value=v.toFixed(2);updatePreview();
};
$('#btnLotMinus').onclick=()=>{
  let v=parseFloat($('#fLot').value)||0;v=Math.max(0.01,Math.round((v-0.01)*100)/100);
  $('#fLot').value=v.toFixed(2);updatePreview();
};
$('#fAsset').addEventListener('change',e=>{
  const isC=e.target.value==='__custom__';
  $('#fAssetCustom').style.display=isC?'block':'none';
  if(isC)$('#fAssetCustom').focus();
  updatePreview();
});
$('#fAssetCustom').addEventListener('input',updatePreview);
['fEntry','fExit','fLot'].forEach(id=>$('#'+id).addEventListener('input',updatePreview));

/* ---- filter tabel ---- */
$('#tSearch').addEventListener('input',e=>{state.j.q=e.target.value.trim().toLowerCase();renderTable()});
$('#tPos').addEventListener('change',e=>{state.j.pos=e.target.value;renderTable()});
$('#tFrom').addEventListener('change',e=>{state.j.from=e.target.value;renderTable()});
$('#tTo').addEventListener('change',e=>{state.j.to=e.target.value;renderTable()});
$('#btnTReset').onclick=()=>{state.j={q:'',pos:'ALL',from:'',to:''};
  $('#tSearch').value='';$('#tPos').value='ALL';$('#tFrom').value='';$('#tTo').value='';renderTable()};

/* ---- CSV ---- */
function exportCSV(list,name){
  if(!list.length){toast('Tidak ada data untuk diekspor','err');return}
  const head=['Tanggal','Aset','Posisi','Harga Entry','Harga Exit','Return (%)','Lot','Catatan','Sumber'];
  const q=v=>{v=v==null?'':String(v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const lines=[head.join(',')];
  list.forEach(t=>lines.push([t.date,t.asset||'',t.position,t.entry,t.exit,tradeRet(t).toFixed(4),t.lot!=null?Number(t.lot).toFixed(2):'',t.notes??'',t.demo?'DEMO':'REAL'].map(q).join(',')));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${name}_${todayISO()}.csv`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(`${list.length} trade diekspor ke CSV`);
}
$('#btnCsv').onclick=()=>exportCSV(filteredJournal(),'trading-journal');
$('#btnExportAll').onclick=()=>exportCSV(sorted(),'trading-journal-semua');

/* ================= ANALYTICS ================= */
function renderVS(arr){const box=$('#vsPanel');
  if(!arr.length){box.innerHTML=EMPTY_CH;return}
  const{L,S}=sideStats(arr);
  const row=(lab,fa,fb,va,vb)=>{const mx=Math.max(Math.abs(va??0),Math.abs(vb??0))||1;
    const wa=Math.abs(va??0)/mx*100,wb=Math.abs(vb??0)/mx*100;
    return `<div class="vs-row"><div class="vs-lab">${lab}</div><div class="vs-bars">
      <div class="vs-half"><span class="vs-val mono ${pcls(va)}">${fa}</span><div class="vs-track"><i class="vs-fill lf" data-w="${wa}%" style="width:0"></i></div></div>
      <div class="vs-half"><div class="vs-track"><i class="vs-fill sf" data-w="${wb}%" style="width:0"></i></div><span class="vs-val mono ${pcls(vb)}">${fb}</span></div>
    </div></div>`};
  box.innerHTML=`<div class="vs-head"><span class="badge long">▲ LONG — ${L.n} trade</span><span class="badge short">▼ SHORT — ${S.n} trade</span></div>`
    +row('Rata-rata Return',fmtPct(L.avg),fmtPct(S.avg),L.avg,S.avg)
    +row('Win Rate',L.n?fmtPct(L.wr,1):'—',S.n?fmtPct(S.wr,1):'—',L.wr,S.wr)
    +row('Total Return (simple)',fmtPct(L.sum),fmtPct(S.sum),L.sum,S.sum);
  requestAnimationFrame(()=>box.querySelectorAll('.vs-fill').forEach(f=>f.style.width=f.dataset.w));
}
function renderHist(){const box=$('#chHist');box.innerHTML='';
  const arr=pt(),rets=arr.map(tradeRet);
  if(rets.length<2){box.innerHTML='<div class="chart-empty">Butuh minimal 2 trade untuk distribusi.</div>';return}
  const lo0=Math.min(...rets),hi0=Math.max(...rets);
  let span=hi0-lo0;if(span<1e-9)span=1;
  const raw=span/Math.min(10,Math.max(4,Math.round(rets.length/2)+1));
  const bw=[0.1,0.2,0.25,0.5,1,1.5,2,2.5,5,10,15,20,25].find(s=>s>=raw)||50;
  const lo=Math.floor(lo0/bw)*bw,nb=Math.max(1,Math.ceil((hi0-lo)/bw-1e-9));
  const bins=Array.from({length:nb},(_,i)=>({lo:lo+i*bw,hi:lo+(i+1)*bw,n:0}));
  rets.forEach(r=>{let i=Math.floor((r-lo)/bw);i=Math.max(0,Math.min(nb-1,i));bins[i].n++});
  const w=Math.max(300,box.clientWidth),h=212,pl=34,pr=10,ptp=12,pb=24;
  const svg=mkSvg(box,w,h),maxN=Math.max(...bins.map(b=>b.n));
  const iw=w-pl-pr,ih=h-ptp-pb,band=iw/bins.length,bwpx=Math.max(6,Math.min(46,band*.72));
  [1,Math.ceil(maxN/2),maxN].filter((v,i,a)=>a.indexOf(v)===i).forEach(v=>{
    const y=ptp+ih-(v/maxN)*ih;
    el('line',{x1:pl,x2:w-pr,y1:y,y2:y,class:'grid'},svg);
    el('text',{x:pl-6,y:y+3.5,'text-anchor':'end'},svg).textContent=v});
  el('line',{x1:pl,x2:w-pr,y1:ptp+ih,y2:ptp+ih,class:'zero'},svg);
  bins.forEach((b,i)=>{if(!b.n)return;
    const bh=(b.n/maxN)*ih,cx=pl+band*i+band/2;
    const mid=(b.lo+b.hi)/2;
    const rect=el('rect',{x:cx-bwpx/2,y:ptp+ih-bh,width:bwpx,height:bh,rx:3,
      class:'bar '+(mid>0?'pos':mid<0?'neg':'be')},svg);
    rect.style.transformOrigin=`${cx}px ${ptp+ih}px`;
    rect.style.animation=`barGrow .5s ${i*30}ms cubic-bezier(.2,.7,.3,1) both`;
    rect.addEventListener('mouseenter',e=>{rect.classList.add('hot');
      showTip(`<div class="tip-t">Rentang ${fmtPct(b.lo)} s/d ${fmtPct(b.hi)}</div>${tipRow('Jumlah trade',b.n+' trade')}`,e)});
    rect.addEventListener('mousemove',moveTip);
    rect.addEventListener('mouseleave',()=>{rect.classList.remove('hot');hideTip()});
  });
  el('text',{x:pl,y:h-6},svg).textContent=fmtAxisPct(lo);
  el('text',{x:w-pr,y:h-6,'text-anchor':'end'},svg).textContent=fmtAxisPct(lo+nb*bw);
}
function renderDDChart(){const box=$('#chDD');box.innerHTML='';
  const arr=pt();if(!arr.length){box.innerHTML=EMPTY_CH;return}
  const dd=drawdownSeries(metrics(arr)),labels=['Mulai',...arr.map(t=>t.date)],n=dd.length;
  const w=Math.max(300,box.clientWidth),h=200,pl=50,pr=56,ptp=12,pb=24;
  const svg=mkSvg(box,w,h);
  let lo=Math.min(...dd,0),hi=0;
  if(lo===0)lo=-1;
  const padV=(hi-lo)*.14;lo-=padV;hi+=Math.max(.2,(hi-lo)*.05);
  const iw=w-pl-pr,ih=h-ptp-pb;
  const X=i=>n>1?pl+iw*i/(n-1):pl+iw/2, Y=v=>ptp+(hi-v)/(hi-lo)*ih, y0=Y(0);
  ticks(lo,hi,3).forEach(v=>{el('line',{x1:pl,x2:w-pr,y1:Y(v),y2:Y(v),class:'grid'},svg);
    el('text',{x:pl-7,y:Y(v)+3.5,'text-anchor':'end'},svg).textContent=fmtAxisPct(v)});
  el('line',{x1:pl,x2:w-pr,y1:y0,y2:y0,class:'zero'},svg);
  const defs=el('defs',{},svg),g=el('linearGradient',{id:'gDD',x1:0,y1:0,x2:0,y2:1},defs);
  el('stop',{offset:'0%','stop-color':'#f6465d','stop-opacity':0},g);
  el('stop',{offset:'100%','stop-color':'#f6465d','stop-opacity':.3},g);
  let d=`M${X(0)},${Y(dd[0])}`;for(let i=1;i<n;i++)d+=`L${X(i)},${Y(dd[i])}`;
  el('path',{d:`${d}L${X(n-1)},${y0}L${X(0)},${y0}Z`,fill:'url(#gDD)'},svg);
  el('path',{d,fill:'none',stroke:'var(--red)','stroke-width':2,'stroke-linejoin':'round'},svg);
  let mi=0;dd.forEach((v,i)=>{if(v<dd[mi])mi=i});
  el('circle',{cx:X(mi),cy:Y(dd[mi]),r:3.6,fill:'var(--red)'},svg);
  el('text',{x:X(mi)+7,y:Y(dd[mi])+4,fill:'var(--red)','font-size':'11px','font-weight':'600'},svg).textContent=fmtPct(dd[mi]);
  const ov=el('rect',{x:pl,y:ptp,width:iw,height:ih,fill:'transparent'},svg);
  ov.addEventListener('pointermove',e=>{const bx=svg.getBoundingClientRect();
    const i=Math.max(0,Math.min(n-1,Math.round((e.clientX-bx.left-pl)/(iw||1)*(n-1))));
    showTip(`<div class="tip-t">${labels[i]==='Mulai'?'Titik Awal':fmtDate(labels[i])}</div>${tipRow('Drawdown',fmtPct(dd[i]),dd[i]<0?'neg':'be')}`,e)});
  ov.addEventListener('pointerleave',hideTip);
}
function renderConsist(arr){
  const box=$('#consistChips');
  if(!arr.length){box.innerHTML='';return}
  const uniq=[...new Set(arr.map(t=>t.date))];
  const span=Math.round((parseISO(arr[arr.length-1].date)-parseISO(arr[0].date))/864e5)+1;
  const st=streakInfo(arr),be=arr.filter(t=>tradeRet(t)===0).length;
  const chips=[
    [uniq.length,'Hari dengan trade'],[Math.max(0,span-uniq.length),'Hari tanpa trade (rentang)'],
    [st.maxW,'Win streak maks.'],[st.maxL,'Loss streak maks.'],[be,'Trade break-even']];
  box.innerHTML=chips.map(([v,l],i)=>`<div class="chip-stat reveal" style="--d:${i*40}ms"><div class="cs-v">${fmtInt(v)}</div><div class="cs-l">${l}</div></div>`).join('');
}
function renderMonthly(arr){const box=$('#monthlyTbl');
  if(!arr.length){box.innerHTML='<p class="hint" style="padding:10px">Belum ada data.</p>';return}
  const map=new Map();
  arr.forEach(t=>{const k=t.date.slice(0,7);if(!map.has(k))map.set(k,[]);map.get(k).push(t)});
  const rows=[...map.entries()].sort((a,b)=>a[0]<b[0]?1:-1).map(([k,ts])=>{
    const m=metrics(ts),lab=`${MONTHS_FULL[+k.slice(5,7)-1]} ${k.slice(0,4)}`;
    return `<tr><td class="mono">${lab}</td><td class="mono c">${m.total}</td>
      <td class="mono c">${fmtPct(m.winRate,1)}</td><td class="mono c ${pcls(m.avg)}">${fmtPct(m.avg)}</td>
      <td class="mono c ${pcls(m.comp)}">${fmtPct(m.comp)}</td><td class="mono c ${pcls(m.simple)}">${fmtPct(m.simple)}</td></tr>`});
  box.innerHTML=`<table class="mini"><thead><tr><th>Bulan</th><th class="c">Trades</th><th class="c">Win Rate</th><th class="c">Avg</th><th class="c">Kumulatif (comp)</th><th class="c">Σ Simple</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function renderInsights(arr,m){const ul=$('#insights');
  if(!arr.length){ul.innerHTML='<li class="dim">Belum ada data pada periode ini.</li>';return}
  const out=[],{L,S}=sideStats(arr);
  if(L.n>0&&S.n>0){
    const bwSide=L.wr>=S.wr?'LONG':'SHORT';
    out.push(`Win rate ${bwSide} lebih tinggi: LONG ${fmtPct(L.wr,1)} vs SHORT ${fmtPct(S.wr,1)}.`);
    const baSide=(L.avg??-1e9)>=(S.avg??-1e9)?'LONG':'SHORT';
    out.push(`Rata-rata return terbesar dari posisi ${baSide} (${fmtPct(baSide==='LONG'?L.avg:S.avg)} per trade).`);
  }else out.push(`Semua trade periode ini di satu sisi (${L.n?'LONG':'SHORT'}) — nilai kedua sisi secara objektif sebelum menyimpulkan.`);
  if(m.maxDD<0)out.push(`Drawdown terdalam ${fmtPct(m.maxDD)} (compounded)${m.ddDate?`, lembah sekitar ${fmtDate(m.ddDate)}`:''}.`);
  const lots=arr.map(t=>Number(t.lot)||0).filter(l=>l>0);
  if(lots.length){
    const avgLot=lots.reduce((a,b)=>a+b,0)/lots.length;
    const minLot=Math.min(...lots),maxLot=Math.max(...lots),totLot=lots.reduce((a,b)=>a+b,0);
    if(Math.abs(maxLot-minLot)<1e-6){
      out.push(`Ukuran posisi konsisten di ${avgLot.toFixed(2)} lot (total akumulasi volume ${totLot.toFixed(2)} lot pada ${lots.length} trade).`);
    }else{
      out.push(`Rata-rata ukuran posisi ${avgLot.toFixed(2)} lot (rentang ${minLot.toFixed(2)} – ${maxLot.toFixed(2)} lot · total akumulasi volume ${totLot.toFixed(2)} lot).`);
    }
  }
  const best=arr.reduce((a,b)=>tradeRet(b)>tradeRet(a)?b:a),worst=arr.reduce((a,b)=>tradeRet(b)<tradeRet(a)?b:a);
  out.push(`Trade terbaik ${fmtPct(tradeRet(best))} (${esc(best.asset)||'—'}, ${fmtDate(best.date)}) · terburuk ${fmtPct(tradeRet(worst))} (${esc(worst.asset)||'—'}, ${fmtDate(worst.date)}).`);
  out.push('Validasi aktif: maksimal 1 trade per tanggal — duplikasi entry otomatis ditolak sistem.');
  ul.innerHTML=out.map(x=>`<li>${x}</li>`).join('');
}
function renderAnalytics(){
  const has=trades.length>0;
  $('#anEmpty').hidden=has;$('#anBody').hidden=!has;
  if(!has)return;
  const arr=pt(),m=metrics(arr);
  renderVS(arr);renderHist();renderDDChart();renderConsist(arr);renderMonthly(arr);renderInsights(arr,m);
}

/* ================= DEMO & kelola data ================= */
const DEMO=[
  [31,'EURUSD','LONG',1.08320,0.85,0.10,'Breakout resistance minor sesi London; momentum berlanjut, exit sesuai plan.'],
  [29,'XAUUSD','SHORT',2687.40,1.20,0.05,'Rejection di supply H4 + DXY menguat. Entry limit, stop ketat di atas wick.'],
  [28,'BTCUSDT','LONG',96150,2.40,0.02,'Reclaim level kunci setelah konsolidasi 3 hari; volume meningkat.'],
  [26,'XAUUSD','LONG',2699.10,-0.85,0.05,'Follow trend setelah koreksi, ternyata false break. Cut loss sesuai aturan.'],
  [24,'EURUSD','SHORT',1.09140,-1.10,0.10,'Fade spike berita; ternyata lebih hawkish dari ekspektasi, keluar cepat.'],
  [23,'GBPUSD','SHORT',1.27480,-1.65,0.08,'Counter-trend tanpa konfirmasi — kesalahan disiplin. Evaluasi: tunggu struktur.'],
  [21,'XAUUSD','LONG',2661.75,0.55,0.05,'Re-entry setelah setup valid; sizing diperkecil pasca loss beruntun.'],
  [20,'BTCUSDT','SHORT',99800,0.00,0.02,'Range bound; entry di tengah range, harga tidak bergerak, exit impas sebelum sesi NY.'],
  [17,'XAUUSD','LONG',2648.90,3.10,0.05,'Setup A+: demand H4 + divergence RSI. Partial 2R, runner sampai target.'],
  [16,'EURUSD','LONG',1.08610,0.95,0.10,'Pullback ke EMA21 H1 dalam uptrend; eksekusi bersih.'],
  [14,'BTCUSDT','LONG',97420,-0.70,0.02,'Long breakout gagal, close manual saat invalidasi.'],
  [13,'XAUUSD','SHORT',2712.30,1.45,0.05,'Double top H4 terkonfirmasi; target tercapai di sesi Asia.'],
  [10,'GBPUSD','LONG',1.26840,2.10,0.08,'Reversal candle di demand mingguan; RR 1:2,2 tercapai.'],
  [8,'EURUSD','SHORT',1.09380,-0.60,0.10,'Scalp news gagal, slippage kecil; terima hasil dan lanjut.'],
  [6,'BTCUSDT','LONG',101250,1.75,0.02,'Higher low di H4; ikuti aliran likuiditas ke resistance berikutnya.'],
  [4,'XAUUSD','LONG',2701.60,1.05,0.05,'Trend continuation sederhana, exit di target 1R.'],
  [1,'XAUUSD','SHORT',2735.80,-0.45,0.05,'Fade all-time-high tanpa konfirmasi kuat — pelajaran: jangan menebak pucuk.'],
];
const rnd=(v,d)=>+v.toFixed(d);
function seedDemo(){
  const t0=Date.now(),dec={EURUSD:5,GBPUSD:5,XAUUSD:2,BTCUSDT:0};
  trades=DEMO.map((d,i)=>{const[off,asset,pos,entry,rt,lot,notes]=d;const dd=dec[asset]??2;
    const exit=pos==='LONG'?rnd(entry*(1+rt/100),dd):rnd(entry*(1-rt/100),dd);
    return{id:uid(),date:addDays(todayISO(),-off),asset,position:pos,entry,exit,lot,notes,demo:true,createdAt:t0-i}});
  saveTrades();state.editingId=null;state.expanded=null;resetForm();updateFormUI();renderAll();
  toast(`${trades.length} trade DEMO dimuat — selalu berlabel DEMO`);
}
$('#btnDelDemo').onclick=$('#btnBannerDelDemo').onclick=async()=>{
  const ok=await confirmBox({title:'Hapus Data DEMO?',msg:'Seluruh trade berlabel DEMO akan dihapus. Trade asli milikmu tetap tersimpan.',ok:'Ya, Hapus'});
  if(!ok)return;trades=trades.filter(t=>!t.demo);saveTrades();renderAll();toast('Data DEMO dihapus');
};
$('#btnClearAll').onclick=async()=>{
  if(!trades.length){toast('Belum ada data untuk dihapus','err');return}
  const ok=await confirmBox({title:'Hapus Semua Data?',msg:`Seluruh ${trades.length} trade akan dihapus permanen dari browser ini. Ekspor CSV terlebih dahulu jika ingin backup.`,ok:'Ya, Hapus Semua'});
  if(!ok)return;trades=[];saveTrades();cancelEdit();renderAll();toast('Semua data dihapus');
};
$('#btnInfo').onclick=()=>infoBox('Metrik & Penyimpanan',`
  <dl>
    <dt>Daily Return</dt><dd>Return satu trade pada tanggal tersebut — perubahan harga entry→exit sesuai arah posisi.</dd>
    <dt>Win Rate</dt><dd>Jumlah trade return positif ÷ total trade × 100%.</dd>
    <dt>Average Return</dt><dd>Rata-rata aritmetika return per trade. Hari tanpa trade <b>tidak</b> dihitung sebagai 0%.</dd>
    <dt>Compounded Cumulative</dt><dd>(1+r₁)×(1+r₂)×…×(1+rₙ)−1, dengan r dalam desimal — tiap return diterapkan pada saldo sebelumnya.</dd>
    <dt>Simple Cumulative</dt><dd>Seluruh return dijumlahkan langsung tanpa compounding.</dd>
    <dt>Drawdown</dt><dd>Penurunan dari puncak kumulatif sebelumnya ke titik kumulatif berikutnya (metode compounded).</dd>
  </dl>
  <p class="mmsg">Return perubahan harga <b>bukan</b> return modal aktual — leverage, ukuran posisi, dan biaya membuat hasil nyata berbeda. Dashboard ini tidak mengklaim profit dalam rupiah.</p>
  <dl><dt>Penyimpanan</dt><dd>Data disimpan di <b>localStorage browser</b>: persisten antar refresh, tetapi hanya di perangkat &amp; browser ini, tidak tersinkron, dan ikut terhapus bila data browsing dibersihkan. Gunakan ekspor CSV sebagai backup. Database server dapat dihubungkan kemudian tanpa mengubah struktur data.</dd></dl>`);

/* ================= navigasi & periode ================= */
function setPageMeta(){
  const t={overview:['Ringkasan Performa',`Pertumbuhan akun & konsistensi — ${periodLabel()}`],
    journal:['Jurnal Trading','Catat, validasi, dan evaluasi setiap trade'],
    analytics:['Analitik',`Pola performa, drawdown & perbandingan posisi — ${periodLabel()}`]}[state.page];
  $('#pageTitle').textContent=t[0];$('#pageSub').textContent=t[1];
  $('#periodWrap').hidden=state.page==='journal';
}
function renderSidebar(){
  $('#navCount').textContent=trades.length;
  const hasDemo=trades.some(t=>t.demo);
  $('#btnSeed').hidden=trades.length>0;
  $('#btnDelDemo').hidden=!hasDemo;
  $('#demoBanner').hidden=!hasDemo;
}
function renderAll(){
  renderSidebar();setPageMeta();renderTable();
  if(state.page==='overview')renderOverview();
  else if(state.page==='analytics')renderAnalytics();
}
function go(page){
  state.page=page;
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));
  window.scrollTo({top:0,behavior:REDUCED?'auto':'smooth'});
  renderAll();
}
function syncPeriodSeg(){$$('#periodSeg [data-p]').forEach(b=>b.classList.toggle('active',b.dataset.p===state.period))}
function syncCumSeg(){$$('#cumSeg [data-m]').forEach(b=>b.classList.toggle('active',b.dataset.m===state.cumMethod))}
function setPeriod(p){
  if(p==='custom'){const pop=$('#customPop');pop.hidden=!pop.hidden;
    if(!pop.hidden){$('#cpFrom').value=state.cFrom||addDays(todayISO(),-29);$('#cpTo').value=state.cTo||todayISO()}return}
  $('#customPop').hidden=true;state.period=p;saveSettings();syncPeriodSeg();renderAll();
}
$('#btnApplyRange').onclick=()=>{
  const f=$('#cpFrom').value,t=$('#cpTo').value;
  if(!f||!t){toast('Isi kedua tanggal rentang','err');return}
  if(f>t){toast('Tanggal awal harus sebelum tanggal akhir','err');return}
  state.cFrom=f;state.cTo=t;state.period='custom';saveSettings();syncPeriodSeg();$('#customPop').hidden=true;renderAll();
};
document.addEventListener('click',e=>{
  const nv=e.target.closest('.nav-item[data-page]');if(nv){go(nv.dataset.page);return}
  const gv=e.target.closest('[data-go]');if(gv){go(gv.dataset.go);return}
  const pb=e.target.closest('#periodSeg [data-p]');if(pb){setPeriod(pb.dataset.p);return}
  const cb=e.target.closest('#cumSeg [data-m]');
  if(cb){
    if(state.cumMethod===cb.dataset.m)return;
    state.cumMethod=cb.dataset.m;
    saveSettings();
    syncCumSeg();
    renderCumChart();
    const arr=pt();
    if(arr.length){
      const m=metrics(arr);
      const cumVal=state.cumMethod==='comp'?m.comp:m.simple;
      const series=state.cumMethod==='comp'?m.curve:[0,...m.simpleCurve];
      const nCum=$('#vCum');
      if(nCum){
        nCum.className=pcls(cumVal);
        tween(nCum,cumVal,v=>fmtPct(v));
        const sub=nCum.closest('.card')?.querySelector('.stat-sub');
        if(sub)sub.innerHTML=`${sparkSVG(series)}<span>${state.cumMethod==='comp'?'Compounded':'Simple'}</span>`;
      }
    }
    return;
  }
  const sd=e.target.closest('.seed-btn');if(sd){seedDemo();return}
  if(!e.target.closest('.period-wrap'))$('#customPop').hidden=true;
});
$('#btnQuickAdd').onclick=()=>{go('journal');setTimeout(()=>$('#fDate').focus(),120)};

/* ---- delegasi tabel, kalender, recent ---- */
$('#tbody').addEventListener('click',e=>{
  const act=e.target.closest('[data-act]');
  if(act){e.stopPropagation();act.dataset.act==='edit'?startEdit(act.dataset.id):deleteTrade(act.dataset.id);return}
  const tr=e.target.closest('tr.trow');
  if(tr){const id=tr.dataset.id;state.expanded=state.expanded===id?null:id;renderTable()}
});
$('#calGrid').addEventListener('click',e=>{
  const c=e.target.closest('.cal-day[data-d]');if(!c)return;
  state.selDay=state.selDay===c.dataset.d?null:c.dataset.d;
  renderCalendar();renderCalDetail();
});
$('#calDetail').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  b.dataset.act==='edit'?startEdit(b.dataset.id):deleteTrade(b.dataset.id);
});
$('#calPrev').onclick=()=>{const c=state.calCursor;c.m--;if(c.m<0){c.m=11;c.y--}renderCalendar()};
$('#calNext').onclick=()=>{const c=state.calCursor;c.m++;if(c.m>11){c.m=0;c.y++}renderCalendar()};
$('#recentList').addEventListener('click',e=>{
  const r=e.target.closest('.rrow');if(!r)return;
  state.expanded=r.dataset.id;go('journal');
});

/* ---- jam & resize ---- */
function tickClock(){const d=new Date();
  $('#clock').textContent=`${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`}
tickClock();setInterval(tickClock,1000);
window.addEventListener('resize',debounce(()=>{if(state.page==='overview')renderOverview();else if(state.page==='analytics')renderAnalytics()},180));

/* ---- init ---- */
$('#fDate').value=todayISO();
populateAssetSelect('EURUSD');
if(!$('#fLot').value)$('#fLot').value='0.01';
syncPeriodSeg();syncCumSeg();syncPosSeg();updatePreview();updateFormUI();
renderAll();
