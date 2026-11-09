#!/usr/bin/env node
/** 3-step Connect Database wizard — inject into main dashboard script only. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes("/* __DB_WIZARD__ */")) {
  console.log("wizard already present");
  process.exit(0);
}

const css = `
/* __DB_WIZARD_CSS__ */
.db-wiz-steps{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}
.db-wiz-step{display:inline-flex;align-items:center;gap:.4rem;border:1px solid rgb(51 65 85);background:rgb(15 23 42);color:rgb(148 163 184);font-size:11px;font-weight:600;padding:.35rem .65rem;border-radius:999px;cursor:pointer}
.db-wiz-step .db-wiz-num{width:1.15rem;height:1.15rem;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgb(30 41 59);font-size:10px}
.db-wiz-step.is-on{border-color:rgba(34,197,94,.55);background:rgba(34,197,94,.12);color:rgb(167 243 208)}
.db-wiz-step.is-on .db-wiz-num{background:rgb(22 163 74);color:#fff}
.db-wiz-step.is-done{border-color:rgba(34,197,94,.25);color:rgb(167 243 208)}
.db-wiz-panel{animation:dbWizIn .18s ease-out}
@keyframes dbWizIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`;

const js = `
/* __DB_WIZARD__ */
(function(){
  function $(id){return document.getElementById(id)}
  var step=1,max=3,built=false;

  function findScroll(){
    var title=$('db-modal-title');
    if(!title) return null;
    var root=title.closest('.fixed')||title.parentElement;
    while(root && !root.querySelector('.overflow-y-auto')) root=root.parentElement;
    return root?root.querySelector('.overflow-y-auto'):null;
  }

  function buildPanels(){
    if(built&&document.querySelector("[data-db-step='1']")) return true;
    var scroll=findScroll();
    if(!scroll) return false;
    var kids=Array.prototype.slice.call(scroll.children);
    if(!kids.length) return false;
    var groups=[[],[],[]], idx=0;
    kids.forEach(function(el){
      var t=((el.innerText||el.textContent||'')).toLowerCase().replace(/\\s+/g,' ').trim();
      if(t.indexOf('step 2')>=0||t.indexOf('2 · backup')>=0||t.indexOf('2 · backup')>=0||t.indexOf('backup plan')===0||t.indexOf('step 2 · backup')>=0) idx=1;
      if(t.indexOf('step 3')>=0||t.indexOf('3 · retention')>=0||t.indexOf('retention')===0||t.indexOf('step 3 · retention')>=0) idx=2;
      // section headers only on first line
      var first=(t.split('\\n')[0]||'');
      if(first.indexOf('backup plan')>=0&&first.indexOf('step')>=0) idx=1;
      if(first.indexOf('retention')>=0&&first.indexOf('step')>=0) idx=2;
      if(first.indexOf('connection')>=0&&(first.indexOf('1')>=0||first.indexOf('step')>=0)) idx=0;
      groups[idx].push(el);
    });
    // fallback split: before "add a backup" roughly half
    if(!groups[1].length&&!groups[2].length&&kids.length>3){
      groups=[[],[],[]]; idx=0;
      kids.forEach(function(el){
        var t=((el.innerText||'')+'').toLowerCase();
        if(t.indexOf('backup plan')>=0||t.indexOf('add a backup job')>=0) idx=1;
        if(t.indexOf('retention')>=0&&t.indexOf('day')>=0) idx=2;
        if(t.indexOf('step 2')>=0) idx=1;
        if(t.indexOf('step 3')>=0) idx=2;
        groups[idx].push(el);
      });
    }
    scroll.innerHTML='';
    for(var i=0;i<3;i++){
      var panel=document.createElement('div');
      panel.setAttribute('data-db-step',String(i+1));
      panel.className='db-wiz-panel space-y-4';
      (groups[i]||[]).forEach(function(el){panel.appendChild(el)});
      if(!(groups[i]&&groups[i].length)) panel.innerHTML="<p class='text-xs text-slate-500'>Configure this step, then continue.</p>";
      scroll.appendChild(panel);
    }
    built=true;
    return true;
  }

  function renderBar(){
    var el=$('db-modal-steps');
    if(!el) return;
    var labels=['Connection','Backup plan','Retention'];
    el.className='db-wiz-steps';
    el.innerHTML=labels.map(function(label,i){
      var n=i+1;
      var cls='db-wiz-step'+(step===n?' is-on':'')+(n<step?' is-done':'');
      return '<button type="button" class="'+cls+'" data-goto="'+n+'"><span class="db-wiz-num">'+n+'</span>'+label+'</button>';
    }).join('');
    el.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.onclick=function(){ step=parseInt(btn.getAttribute('data-goto'),10)||1; show(); };
    });
  }

  function ensureNav(){
    if($('btn-db-next')) return;
    var test=$('btn-test-db');
    if(!test||!test.parentElement) return;
    var parent=test.parentElement;
    var back=document.createElement('button');
    back.id='btn-db-back'; back.type='button';
    back.className='px-4 py-2.5 bg-slate-800/80 hover:bg-slate-800 text-xs font-medium rounded-xl text-slate-300 border border-slate-700/80 transition';
    back.textContent='Back';
    back.onclick=function(){ if(step>1){ step--; show(); } };
    var next=document.createElement('button');
    next.id='btn-db-next'; next.type='button';
    next.className='px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-xs font-semibold rounded-xl text-white transition';
    next.textContent='Continue';
    next.onclick=function(){
      if(step===1){
        var name=$('new-db-name');
        if(name&&!String(name.value||'').trim()){ name.focus(); return; }
      }
      if(step<max){ step++; show(); }
    };
    parent.insertBefore(back,test);
    parent.insertBefore(next,test);
  }

  function show(){
    if(!buildPanels()) return;
    for(var i=1;i<=max;i++){
      var p=document.querySelector("[data-db-step='"+i+"']");
      if(p) p.style.display=i===step?'block':'none';
    }
    renderBar();
    ensureNav();
    var back=$('btn-db-back'), next=$('btn-db-next'), test=$('btn-test-db'), save=$('btn-save-db');
    if(back) back.style.display=step===1?'none':'inline-flex';
    if(next) next.style.display=step===max?'none':'inline-flex';
    if(test) test.style.display=step===1?'inline-flex':'none';
    if(save) save.style.display=step===max?'inline-flex':'none';
  }

  function openWizard(){ built=false; step=1; setTimeout(show,30); }

  document.addEventListener('click',function(e){
    var t=e.target&&e.target.closest&&e.target.closest('button,a');
    if(!t) return;
    var label=(t.textContent||'').toLowerCase();
    if(label.indexOf('connect database')>=0||label.indexOf('add database')>=0||label.indexOf('new database')>=0) openWizard();
  });

  var tries=0;
  var timer=setInterval(function(){
    tries++;
    if($('db-modal-title')||tries>40){ clearInterval(timer); if($('db-modal-title')) openWizard(); }
  },250);
})();
`;

if (s.includes("</style>") && !s.includes("__DB_WIZARD_CSS__")) {
  s = s.replace("</style>", css + "\n</style>");
  console.log("css ok");
}

const anchor = "var TOKEN = null;";
const start = s.indexOf(anchor);
if (start < 0) {
  console.error("main app script anchor not found");
  process.exit(1);
}
const end = s.indexOf("</script>", start);
if (end < 0) {
  console.error("script end not found after TOKEN");
  process.exit(1);
}
s = s.slice(0, end) + "\n" + js + "\n" + s.slice(end);
console.log("js injected into main app script");

fs.writeFileSync(file, s);
console.log("done", s.length);
