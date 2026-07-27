/**
 * Página do /admin. HTML/CSS/JS puro, servido inline — sem build, sem CDN,
 * sem dependência externa. Todo dado do usuário entra na tela via textContent
 * (nunca innerHTML), então e-mail com caractere estranho não vira XSS.
 */
export const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>VozzAI — Painel</title>
<style>
  :root{--bg:#0B0C10;--surface:#15171E;--surface2:#1B1E27;--line:#262A33;--ink:#EFEFEC;--muted:#9CA2AE;--faint:#6D7381;--accent:#7089FF;--good:#3DD68C;--warn:#F5B646;--bad:#FF6B4C}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
  header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
  h1{font-size:20px;letter-spacing:-.02em;margin:0}
  h1 span{color:var(--faint);font-weight:400;font-size:13px;margin-left:8px}
  .btn{font:inherit;font-size:12.5px;background:none;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 12px;cursor:pointer}
  .btn:hover{color:var(--ink);border-color:var(--ink)}
  .tabs{display:flex;gap:6px;margin:20px 0 4px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px}
  .tabs button{font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:1px solid transparent;background:none;color:var(--muted);cursor:pointer}
  .tabs button:hover{color:var(--ink)}
  .tabs button.on{background:var(--accent);color:var(--bg)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:20px}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
  .card .v{font-size:26px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .card .v.hi{color:var(--accent)}.card .v.good{color:var(--good)}.card .v.warn{color:var(--warn)}.card .v.bad{color:var(--bad)}
  .card .l{font-size:12px;color:var(--muted);margin-top:5px}
  .card .sub{font-size:11.5px;color:var(--faint);margin-top:3px}
  h2{font-size:15px;margin:32px 0 2px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  h2 .why{font-size:12px;color:var(--faint);font-weight:400}
  .panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:12px;overflow-x:auto}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;font-size:12.5px;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--faint);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.07em}
  tr:last-child td{border-bottom:0}
  td.num{font-variant-numeric:tabular-nums;text-align:right}
  td.pro{color:var(--accent);font-weight:650}
  .empty{color:var(--faint);font-size:13px;padding:14px 2px}
  .msg{color:var(--muted);margin-top:16px;font-size:13px}
  .pii{color:var(--warn);font-size:12px;margin:10px 0 0}
  form.login{margin-top:28px;display:flex;gap:10px;max-width:460px}
  form.login input{flex:1;font:inherit;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
  form.login button{font:inherit;font-weight:650;padding:11px 18px;border-radius:10px;border:none;background:var(--accent);color:var(--bg);cursor:pointer}
  /* funil */
  .fstep{display:grid;grid-template-columns:200px 1fr 130px;gap:14px;align-items:center;padding:9px 0}
  .fstep .lab{font-size:13px}
  .fstep .lab small{display:block;color:var(--faint);font-size:11px;white-space:normal}
  .fbar{height:26px;background:var(--surface2);border-radius:6px;overflow:hidden}
  .fbar i{display:block;height:100%;background:var(--accent);border-radius:6px}
  .fnum{text-align:right;font-variant-numeric:tabular-nums;font-size:13px}
  .fnum b{font-size:15px}
  .fnum em{font-style:normal;color:var(--faint);font-size:11.5px;display:block}
  .drop{color:var(--bad);font-size:11.5px}
  /* cohort */
  .coh td.c{text-align:center;font-variant-numeric:tabular-nums;border-radius:4px}
  /* chart */
  svg{display:block;width:100%;height:auto}
  .legend{display:flex;gap:16px;font-size:11.5px;color:var(--muted);margin-top:8px}
  .legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle}
  .note{font-size:11.5px;color:var(--faint);margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>VozzAI — Painel <span id="stamp"></span></h1>
    <div>
      <button class="btn" id="refresh" style="display:none">Atualizar</button>
      <button class="btn" id="logout" style="display:none">Sair</button>
    </div>
  </header>

  <form class="login" id="tokenForm" style="display:none">
    <input id="tokenInput" type="password" placeholder="Token de admin" autocomplete="off" />
    <button type="submit">Entrar</button>
  </form>

  <div class="tabs" id="tabs" style="display:none"></div>
  <p class="msg" id="msg"></p>
  <div id="view"></div>
</div>
<script>
(function(){
"use strict";
var KEY='vozzai_admin_token';
var form=document.getElementById('tokenForm'),msg=document.getElementById('msg'),view=document.getElementById('view'),
    tabs=document.getElementById('tabs'),logout=document.getElementById('logout'),refresh=document.getElementById('refresh'),
    stamp=document.getElementById('stamp');
var DATA=null,LEADS=null,current='geral';

/* ---------- helpers de DOM (textContent sempre; nada de innerHTML com dado) ---------- */
function el(tag,text,cls){var n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n;}
function pct(x){return x===null||x===undefined?'—':(x*100).toFixed(x>=0.1?0:1)+'%';}
function num(n){return (n||0).toLocaleString('pt-BR');}
function fmtDate(iso){if(!iso)return '—';var d=new Date(iso);return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'2-digit'});}
function card(value,label,cls,sub){
  var c=el('div',null,'card');
  c.appendChild(el('div',value,'v'+(cls?' '+cls:'')));
  c.appendChild(el('div',label,'l'));
  if(sub)c.appendChild(el('div',sub,'sub'));
  return c;
}
function section(title,why){
  var h=el('h2',title);
  if(why)h.appendChild(el('span',why,'why'));
  return h;
}
function panel(){return el('div',null,'panel');}
function table(headers,rows,aligns){
  var t=el('table'),tr=el('tr');
  headers.forEach(function(h){tr.appendChild(el('th',h));});
  t.appendChild(tr);
  rows.forEach(function(cells){
    var r=el('tr');
    cells.forEach(function(c,i){
      var td=el('td',c&&c.text!==undefined?c.text:c,(c&&c.cls)||(aligns&&aligns[i]==='num'?'num':''));
      r.appendChild(td);
    });
    t.appendChild(r);
  });
  return t;
}
function emptyBox(text){return el('p',text,'empty');}

/* ---------- rede ---------- */
function authed(path){
  return fetch(path,{headers:{'x-admin-token':localStorage.getItem(KEY)||''}}).then(function(res){
    if(res.status===401){localStorage.removeItem(KEY);askToken('Token inválido — tenta de novo.');return null;}
    if(!res.ok){msg.textContent='Erro ao carregar ('+res.status+').';return null;}
    return res.json();
  });
}
function askToken(text){
  form.style.display='flex';tabs.style.display='none';logout.style.display='none';refresh.style.display='none';
  view.textContent='';stamp.textContent='';msg.textContent=text||'';
}

/* ---------- gráfico de linha em SVG (sem lib) ---------- */
function lineChart(points,series,height){
  var W=1000,H=height||160,padL=34,padB=22,padT=10;
  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  var max=1;
  series.forEach(function(s){points.forEach(function(p){if(p[s.key]>max)max=p[s.key];});});
  var stepX=(W-padL-8)/Math.max(1,points.length-1);
  var y=function(v){return padT+(H-padT-padB)*(1-v/max);};
  function add(tag,attrs){var n=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(var k in attrs)n.setAttribute(k,attrs[k]);svg.appendChild(n);return n;}
  // grade horizontal + rótulos do eixo Y
  [0,0.5,1].forEach(function(f){
    var val=Math.round(max*f),yy=y(val);
    add('line',{x1:padL,y1:yy,x2:W-8,y2:yy,stroke:'#262A33','stroke-width':1});
    var t=add('text',{x:4,y:yy+4,fill:'#6D7381','font-size':10});t.textContent=val;
  });
  series.forEach(function(s){
    var d=points.map(function(p,i){return (i?'L':'M')+(padL+i*stepX).toFixed(1)+' '+y(p[s.key]).toFixed(1);}).join(' ');
    add('path',{d:d,fill:'none',stroke:s.color,'stroke-width':2,'stroke-linejoin':'round'});
  });
  // rótulos de data: primeiro, meio e último
  [0,Math.floor(points.length/2),points.length-1].forEach(function(i){
    if(!points[i])return;
    var t=add('text',{x:padL+i*stepX,y:H-6,fill:'#6D7381','font-size':10,'text-anchor':i===0?'start':(i===points.length-1?'end':'middle')});
    t.textContent=points[i].day;
  });
  return svg;
}
function legend(series){
  var d=el('div',null,'legend');
  series.forEach(function(s){
    var span=el('span');
    var i=el('i');i.style.background=s.color;
    span.appendChild(i);span.appendChild(document.createTextNode(s.label));
    d.appendChild(span);
  });
  return d;
}

/* ---------- abas ---------- */
var TABS=[
  {id:'geral',label:'Visão geral'},
  {id:'funil',label:'Funil'},
  {id:'retencao',label:'Retenção'},
  {id:'dinheiro',label:'Dinheiro'},
  {id:'usuarios',label:'Usuários'},
  {id:'produto',label:'Produto'},
  {id:'leads',label:'Leads'}
];

function renderTabs(){
  tabs.textContent='';
  TABS.forEach(function(t){
    var b=el('button',t.label,current===t.id?'on':'');
    b.addEventListener('click',function(){current=t.id;renderTabs();render();});
    tabs.appendChild(b);
  });
}

/* ---------- VISÃO GERAL ---------- */
function viewGeral(){
  var o=DATA.overview,f=document.createDocumentFragment();
  var delta=o.signupsPrev7d>0?((o.signups7d-o.signupsPrev7d)/o.signupsPrev7d):null;

  var g=el('div',null,'grid');
  g.appendChild(card(brlFmt(o.mrrCents),'MRR','hi',brlFmt(o.arrCents)+' por ano'));
  g.appendChild(card(o.proUsers,'Assinantes Pro','hi'));
  g.appendChild(card(o.totalUsers,'Contas criadas',null,o.freeUsers+' no grátis'));
  g.appendChild(card(pct(o.conversionRate),'Conversão p/ Pro',o.conversionRate>0?'good':'warn'));
  g.appendChild(card(pct(o.activationRate),'Ativação',o.activationRate>=0.5?'good':'warn','já ditaram ao menos 1x'));
  g.appendChild(card(o.activeUsers7d,'Ativos (7 dias)',null,o.activeUsers30d+' em 30 dias'));
  g.appendChild(card(o.dictationsPerActiveUser7d.toFixed(1),'Ditados / ativo / semana','hi','North Star'));
  g.appendChild(card(num(o.dictations7d),'Ditados (7 dias)',null,num(o.dictations30d)+' em 30 dias'));
  g.appendChild(card(num(o.signups7d),'Cadastros (7 dias)',
    delta===null?null:(delta>=0?'good':'bad'),
    delta===null?'sem base anterior':(delta>=0?'+':'')+(delta*100).toFixed(0)+'% vs. 7 dias antes'));
  g.appendChild(card(num(o.words7d),'Palavras (7 dias)'));
  g.appendChild(card(brlFmt(o.costCents30d),'Custo de API (30d)',o.costCents30d>o.mrrCents?'bad':null,'estimado'));
  g.appendChild(card(o.waitlistCount,'Lista de espera'));
  f.appendChild(g);

  f.appendChild(section('Movimento dos últimos 30 dias'));
  var p=panel();
  var series=[{key:'dictations',label:'Ditados',color:'#7089FF'},
              {key:'activeUsers',label:'Usuários ativos',color:'#3DD68C'},
              {key:'signups',label:'Cadastros',color:'#F5B646'}];
  p.appendChild(lineChart(DATA.series,series,170));
  p.appendChild(legend(series));
  f.appendChild(p);

  f.appendChild(diagnosisPanel(o));
  return f;
}

/* Leitura automática do que os números estão dizendo — o "e daí?" do painel. */
function diagnosisPanel(o){
  var frag=document.createDocumentFragment();
  frag.appendChild(section('O que isso está dizendo','leitura automática dos números acima'));
  var p=panel(),any=false;
  function line(txt,tone){
    any=true;
    var d=el('div',txt);
    d.style.padding='7px 0';d.style.fontSize='13px';
    d.style.borderLeft='3px solid '+(tone==='bad'?'#FF6B4C':tone==='good'?'#3DD68C':'#F5B646');
    d.style.paddingLeft='12px';d.style.marginBottom='6px';
    p.appendChild(d);
  }
  if(o.totalUsers<20) line('Base pequena ('+o.totalUsers+' contas): trate todo percentual aqui como indício, não como estatística. Antes de investir em anúncio, o objetivo é entender se quem entra volta.','warn');
  if(o.activationRate<0.5&&o.totalUsers>0) line('Só '+pct(o.activationRate)+' das contas chegaram a ditar uma vez. Esse é o maior gargalo: as pessoas criam conta e não conseguem (ou não tentam) usar. Vale olhar a aba Funil e falar com quem está em "Nunca ditou".','bad');
  if(o.activationRate>=0.5) line('Ativação em '+pct(o.activationRate)+': a maioria de quem cria conta consegue ditar. O gargalo está mais à frente no funil.','good');
  if(o.proUsers===0&&o.totalUsers>0) line('Nenhum assinante Pro ainda. Enquanto isso, cada usuário grátis custa API sem receita — o custo estimado dos últimos 30 dias é '+brlFmt(o.costCents30d)+'.','warn');
  if(o.mrrCents>0&&o.costCents30d>o.mrrCents) line('O custo de API dos últimos 30 dias ('+brlFmt(o.costCents30d)+') passou o MRR ('+brlFmt(o.mrrCents)+'). A margem está negativa.','bad');
  if(o.mrrCents>0&&o.grossMarginPct!==null&&o.costCents30d<=o.mrrCents) line('Margem bruta estimada de '+o.grossMarginPct+'% — a receita cobre o custo de API com folga.','good');
  if(o.activeUsers7d>0&&o.dictationsPerActiveUser7d<2) line('Quem usa, usa pouco ('+o.dictationsPerActiveUser7d.toFixed(1)+' ditados por semana). Ou o produto ainda não entrou na rotina, ou está com atrito no uso diário.','warn');
  if(o.dictationsPerActiveUser7d>=5) line('Quem usa, usa muito ('+o.dictationsPerActiveUser7d.toFixed(1)+' ditados/semana). Sinal de que o produto virou hábito para esse grupo — vale entender o que eles têm em comum.','good');
  if(!any) line('Sem dados suficientes para uma leitura ainda.','warn');
  frag.appendChild(p);
  return frag;
}

/* ---------- FUNIL ---------- */
function viewFunil(){
  var f=document.createDocumentFragment();
  f.appendChild(section('Onde as pessoas param','cada barra é quantas contas chegaram até aquele passo'));
  var p=panel();
  DATA.funnel.forEach(function(s,i){
    var row=el('div',null,'fstep');
    var lab=el('div',null,'lab');
    lab.appendChild(document.createTextNode(s.label));
    lab.appendChild(el('small',s.hint));
    row.appendChild(lab);
    var bar=el('div',null,'fbar');
    var fill=el('i');fill.style.width=Math.max(0.5,s.pctOfTop*100)+'%';
    if(i>0&&s.pctOfPrev<0.5)fill.style.background='#FF6B4C';
    bar.appendChild(fill);row.appendChild(bar);
    var n=el('div',null,'fnum');
    n.appendChild(el('b',num(s.count)));
    n.appendChild(el('em',pct(s.pctOfTop)+' do topo'));
    if(i>0){
      var lost=DATA.funnel[i-1].count-s.count;
      if(lost>0)n.appendChild(el('div','−'+num(lost)+' aqui','drop'));
    }
    row.appendChild(n);
    p.appendChild(row);
  });
  f.appendChild(p);

  // maior queda
  var worst=null;
  DATA.funnel.forEach(function(s,i){
    if(i===0)return;
    var lost=DATA.funnel[i-1].count-s.count;
    if(!worst||lost>worst.lost)worst={from:DATA.funnel[i-1],to:s,lost:lost};
  });
  if(worst&&worst.lost>0){
    f.appendChild(section('Maior gargalo'));
    var wp=panel();
    wp.appendChild(el('div','Entre "'+worst.from.label+'" e "'+worst.to.label+'" você perde '+num(worst.lost)+' pessoas ('+pct(1-worst.to.pctOfPrev)+' das que chegaram até ali). É o ponto com maior retorno se você melhorar uma coisa só.'));
    f.appendChild(wp);
  }

  f.appendChild(el('p','Observação: "Abriu o checkout" só passou a ser medido agora que o rastreamento de eventos existe — números antigos aparecem zerados. Os demais passos são calculados do histórico real de uso.','note'));
  return f;
}

/* ---------- RETENÇÃO ---------- */
function viewRetencao(){
  var f=document.createDocumentFragment();
  f.appendChild(section('Coortes semanais','de cada turma que se cadastrou, quantos ainda usavam nas semanas seguintes'));
  var p=panel();
  if(!DATA.retention.length){p.appendChild(emptyBox('Ainda não há coortes com dados.'));f.appendChild(p);return f;}
  var maxW=0;DATA.retention.forEach(function(c){if(c.weeks.length>maxW)maxW=c.weeks.length;});
  maxW=Math.min(maxW,8);
  var headers=['Coorte','Tamanho'];
  for(var i=0;i<maxW;i++)headers.push(i===0?'Semana 0':'S'+i);
  var t=el('table'),trh=el('tr');
  headers.forEach(function(h){trh.appendChild(el('th',h));});
  t.appendChild(trh);
  DATA.retention.forEach(function(c){
    var tr=el('tr');
    tr.appendChild(el('td',c.cohort));
    tr.appendChild(el('td',c.size,'num'));
    for(var i=0;i<maxW;i++){
      var v=c.weeks[i];
      var td=el('td',v===null||v===undefined?'·':pct(v),'c num');
      if(v!==null&&v!==undefined&&v>0){
        td.style.background='rgba(112,137,255,'+(0.10+v*0.55).toFixed(2)+')';
      }
      tr.appendChild(td);
    }
    t.appendChild(tr);
  });
  p.appendChild(t);
  p.appendChild(el('p','Semana 0 é a própria semana do cadastro. O que importa é a coluna S1 em diante: é ela que diz se as pessoas voltam. Retenção baixa aqui significa que trazer mais gente (por anúncio, por exemplo) não vai construir base — só troca quem entra por quem sai.','note'));
  f.appendChild(p);
  return f;
}

/* ---------- DINHEIRO ---------- */
function viewDinheiro(){
  var o=DATA.overview,f=document.createDocumentFragment();
  var g=el('div',null,'grid');
  g.appendChild(card(brlFmt(o.mrrCents),'MRR','hi'));
  g.appendChild(card(brlFmt(o.arrCents),'ARR projetado',null,'MRR × 12'));
  g.appendChild(card(brlFmt(o.costCents30d),'Custo API (30d)','warn','estimado'));
  g.appendChild(card(brlFmt(o.costCents7d),'Custo API (7d)',null,'estimado'));
  g.appendChild(card(o.grossMarginPct===null?'—':o.grossMarginPct+'%','Margem bruta',
    o.grossMarginPct===null?null:(o.grossMarginPct>60?'good':o.grossMarginPct>0?'warn':'bad')));
  var custoPorAtivo=o.activeUsers30d>0?Math.round(o.costCents30d/o.activeUsers30d):0;
  g.appendChild(card(brlFmt(custoPorAtivo),'Custo por ativo (30d)',null,'quanto cada usuário ativo custa'));
  var custoPorDitado=o.dictations30d>0?(o.costCents30d/o.dictations30d):0;
  g.appendChild(card(brlFmt(Math.round(custoPorDitado*100)/100),'Custo por ditado',null,'estimado'));
  g.appendChild(card(brlFmt(DATA.pricing.monthlyCents),'Preço mensal'));
  g.appendChild(card(brlFmt(DATA.pricing.annualCents),'Preço anual',null,'≈30% de desconto'));
  f.appendChild(g);

  f.appendChild(section('Assinantes Pro'));
  var p=panel();
  if(!DATA.subscribers.length){
    p.appendChild(emptyBox('Nenhum assinante ainda.'));
  }else{
    p.appendChild(table(['E-mail','Pro desde','Palavras no mês','% da cota'],
      DATA.subscribers.map(function(s){
        return [{text:s.email},{text:fmtDate(s.since)},{text:num(s.words30d),cls:'num'},{text:pct(s.quotaPct),cls:'num'}];
      })));
  }
  f.appendChild(p);

  f.appendChild(el('p','Como o custo é estimado: o whisper-1 não devolve a duração do áudio, então o tempo de fala é inferido das palavras (≈150 palavras/min) e somado ao custo de tokens do gpt-4o-mini. Serve para ordem de grandeza e margem — não é contabilidade. A cotação do dólar vem da variável USD_BRL_RATE.','note'));
  return f;
}

/* ---------- USUÁRIOS (segmentos acionáveis) ---------- */
function viewUsuarios(){
  var s=DATA.segments,f=document.createDocumentFragment();
  f.appendChild(el('p','Esta aba mostra e-mails — é a lista para você agir. Trate com o cuidado que a LGPD pede.','pii'));

  f.appendChild(segTable('Nunca ditaram','criaram conta e não usaram — o gargalo mais acionável do produto',
    s.neverDictated,['E-mail','Plano','Cadastro'],function(u){
      return [{text:u.email},{text:u.plan==='pro'?'Pro':'Grátis',cls:u.plan==='pro'?'pro':''},{text:fmtDate(u.createdAt)}];
    },'Ninguém nessa situação — ótimo sinal.'));

  f.appendChild(segTable('Perto do limite','candidatos naturais ao Pro: já sentem o valor e estão esbarrando na cota',
    s.nearQuota,['E-mail','% da cota','Palavras 30d','Último ditado'],function(u){
      return [{text:u.email},{text:pct(u.quotaPct),cls:'num'},{text:num(u.words30d),cls:'num'},{text:fmtDate(u.lastDictationAt)}];
    },'Ninguém perto do limite no momento.'));

  f.appendChild(segTable('Sumiram','usavam e pararam há mais de 7 dias — churn silencioso, dá para reativar',
    s.atRisk,['E-mail','Dias parado','Ditados','Último ditado'],function(u){
      return [{text:u.email},{text:u.daysSinceLast===null?'—':u.daysSinceLast,cls:'num'},{text:num(u.dictations),cls:'num'},{text:fmtDate(u.lastDictationAt)}];
    },'Ninguém sumido — todo mundo que usou continua usando.'));

  f.appendChild(segTable('Quem mais usa','entreviste estes: são eles que sabem por que o produto vale',
    s.power,['E-mail','Palavras 30d','Ditados','Plano'],function(u){
      return [{text:u.email},{text:num(u.words30d),cls:'num'},{text:num(u.dictations),cls:'num'},{text:u.plan==='pro'?'Pro':'Grátis',cls:u.plan==='pro'?'pro':''}];
    },'Ainda não há usuários recorrentes.'));

  return f;
}

function segTable(title,why,rows,headers,mapper,emptyText){
  var frag=document.createDocumentFragment();
  var h=section(title+' ('+rows.length+')',why);
  if(rows.length){
    var copy=el('button','Copiar e-mails','btn');
    copy.style.marginLeft='auto';
    copy.addEventListener('click',function(){copyEmails(rows.map(function(r){return r.email;}),copy);});
    h.appendChild(copy);
  }
  frag.appendChild(h);
  var p=panel();
  if(!rows.length)p.appendChild(emptyBox(emptyText));
  else p.appendChild(table(headers,rows.map(mapper)));
  frag.appendChild(p);
  return frag;
}

/* ---------- PRODUTO (eventos, erros, modos) ---------- */
function viewProduto(){
  var f=document.createDocumentFragment();

  f.appendChild(section('Confiabilidade','falhas que o usuário sentiu nos últimos 30 dias'));
  var pe=panel();
  var fr=DATA.errors.failureRate;
  var g=el('div',null,'grid');
  g.appendChild(card(fr===null?'—':pct(fr),'Taxa de falha',fr===null?null:(fr>0.05?'bad':'good'),'ditados que deram erro'));
  pe.appendChild(g);
  if(DATA.errors.rows.length){
    pe.appendChild(table(['Erro','Ocorrências'],DATA.errors.rows.map(function(r){
      return [{text:r.code},{text:num(r.count),cls:'num'}];
    })));
  }else{
    pe.appendChild(emptyBox('Nenhuma falha registrada no período.'));
  }
  f.appendChild(pe);

  f.appendChild(section('Modos de escrita','qual modo as pessoas realmente usam'));
  var pm=panel();
  if(DATA.modes.length){
    var totalM=DATA.modes.reduce(function(a,m){return a+m.count;},0);
    pm.appendChild(table(['Modo','Ditados','Participação'],DATA.modes.map(function(m){
      return [{text:m.mode},{text:num(m.count),cls:'num'},{text:pct(m.count/totalM),cls:'num'}];
    })));
  }else{
    pm.appendChild(emptyBox('Sem ditados registrados com modo ainda.'));
  }
  f.appendChild(pm);

  f.appendChild(section('Eventos (30 dias)','todo passo que o produto registra — quanto mais aparece aqui, mais visibilidade você tem'));
  var pv=panel();
  if(DATA.events.length){
    pv.appendChild(table(['Evento','Ocorrências','Pessoas','Último'],DATA.events.map(function(e){
      return [{text:e.name},{text:num(e.count),cls:'num'},{text:num(e.users),cls:'num'},{text:fmtDate(e.lastAt)}];
    })));
  }else{
    pv.appendChild(emptyBox('Nenhum evento ainda. Os eventos do servidor começam a aparecer no próximo cadastro/ditado; os do app e da extensão, quando as versões novas chegarem aos usuários.'));
  }
  f.appendChild(pv);
  f.appendChild(el('p','Privacidade: eventos guardam só o nome do passo e metadados de lista fechada (código de erro, modo, faixa de palavras). Nunca áudio, nunca o texto ditado.','note'));
  return f;
}

/* ---------- LEADS ---------- */
function viewLeads(){
  var f=document.createDocumentFragment();
  if(!LEADS){
    f.appendChild(emptyBox('Carregando leads…'));
    authed('/admin/leads').then(function(d){if(d){LEADS=d;render();}});
    return f;
  }
  f.appendChild(el('p','Esta aba contém dados pessoais (e-mails) — trate com o cuidado que a LGPD pede.','pii'));

  var uh=section('Contas ('+LEADS.users.length+')');
  var ub=el('button','Copiar e-mails','btn');ub.style.marginLeft='auto';
  ub.addEventListener('click',function(){copyEmails(LEADS.users.map(function(u){return u.email;}),ub);});
  var ucsv=el('button','Baixar CSV','btn');
  ucsv.addEventListener('click',function(){downloadCsv('vozzai-contas.csv',
    ['email','plano','cadastro','ultimo_ditado','palavras_30d'],
    LEADS.users.map(function(u){return [u.email,u.plan,u.createdAt,u.lastDictationAt||'',u.words30d];}));});
  uh.appendChild(ub);uh.appendChild(ucsv);
  f.appendChild(uh);
  var up=panel();
  if(!LEADS.users.length)up.appendChild(emptyBox('Nenhuma conta ainda.'));
  else up.appendChild(table(['E-mail','Plano','Cadastro','Último ditado','Palavras 30d'],
    LEADS.users.map(function(u){
      return [{text:u.email},{text:u.plan==='pro'?'Pro':'Grátis',cls:u.plan==='pro'?'pro':''},
              {text:fmtDate(u.createdAt)},{text:fmtDate(u.lastDictationAt)},{text:num(u.words30d),cls:'num'}];
    })));
  f.appendChild(up);

  var wh=section('Lista de espera ('+LEADS.waitlist.length+')','quem não tem Mac e pediu aviso');
  var wb=el('button','Copiar e-mails','btn');wb.style.marginLeft='auto';
  wb.addEventListener('click',function(){copyEmails(LEADS.waitlist.map(function(w){return w.email;}),wb);});
  var wcsv=el('button','Baixar CSV','btn');
  wcsv.addEventListener('click',function(){downloadCsv('vozzai-lista-espera.csv',['email','entrou_em'],
    LEADS.waitlist.map(function(w){return [w.email,w.createdAt];}));});
  wh.appendChild(wb);wh.appendChild(wcsv);
  f.appendChild(wh);
  var wp=panel();
  if(!LEADS.waitlist.length)wp.appendChild(emptyBox('Ninguém na lista de espera.'));
  else wp.appendChild(table(['E-mail','Entrou em'],LEADS.waitlist.map(function(w){
    return [{text:w.email},{text:fmtDate(w.createdAt)}];
  })));
  f.appendChild(wp);
  return f;
}

/* ---------- utilidades ---------- */
function brlFmt(cents){return (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}

function copyEmails(list,btn){
  var text=list.join(', '),original='Copiar e-mails';
  function done(l){btn.textContent=l;setTimeout(function(){btn.textContent=original;},1600);}
  function fallback(){
    var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    var ok=false;try{ok=document.execCommand('copy');}catch(e){ok=false;}
    document.body.removeChild(ta);done(ok?'Copiado ✓':'Não consegui copiar');
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){done('Copiado ✓');},fallback);
  }else fallback();
}

function downloadCsv(filename,headers,rows){
  function cell(v){var s=v===null||v===undefined?'':String(v);
    return /[",\\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
  var csv=[headers.join(';')].concat(rows.map(function(r){return r.map(cell).join(';');})).join('\\n');
  var blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=filename;
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);document.body.removeChild(a);},0);
}

/* ---------- render ---------- */
function render(){
  view.textContent='';
  if(!DATA)return;
  var map={geral:viewGeral,funil:viewFunil,retencao:viewRetencao,dinheiro:viewDinheiro,
           usuarios:viewUsuarios,produto:viewProduto,leads:viewLeads};
  view.appendChild((map[current]||viewGeral)());
}

function load(){
  msg.textContent='Carregando…';
  authed('/admin/dashboard').then(function(d){
    if(!d)return;
    DATA=d;LEADS=null;
    form.style.display='none';tabs.style.display='flex';
    logout.style.display='inline-block';refresh.style.display='inline-block';
    msg.textContent='';
    stamp.textContent='atualizado '+new Date(d.generatedAt).toLocaleTimeString('pt-BR');
    renderTabs();render();
  }).catch(function(){msg.textContent='Não consegui falar com o servidor.';});
}

form.addEventListener('submit',function(e){
  e.preventDefault();
  var v=document.getElementById('tokenInput').value.trim();
  if(!v)return;
  localStorage.setItem(KEY,v);load();
});
logout.addEventListener('click',function(){localStorage.removeItem(KEY);askToken('');});
refresh.addEventListener('click',load);

if(localStorage.getItem(KEY))load();else askToken('');
})();
</script>
</body>
</html>`;
