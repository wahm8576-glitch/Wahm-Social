"""Password-protected Arabic proxy-management dashboard for TikWahm."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Callable
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse

SESSION_COOKIE = "tikwahm_proxy_admin"
SESSION_TTL_SECONDS = 6 * 60 * 60
_LOGIN_FAILURES: dict[str, list[float]] = {}
_LOGIN_FAILURE_WINDOW = 10 * 60
_LOGIN_FAILURE_LIMIT = 6
_MUTATION_LOCK = asyncio.Lock()
_SESSION_GENERATION = secrets.token_urlsafe(24)
_REVOKED_SESSIONS: dict[str, float] = {}

# Salted scrypt verifier for the owner's saved dashboard password. The password
# itself is never stored in this source file or returned by any API.
DEFAULT_PASSWORD_HASH = (
    "scrypt-hmac$16384$8$1$913bf32b36b223954b33090c2ac512c7$"
    "eed6e772d41766bedf0478d0ec3f9479f4330e61f789d7ff715b2ded0354bb4d"
)

SECURITY_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


PAGE = r'''<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#090d18">
  <title>TikWahm | إدارة البروكسيات</title>
  <style>
    :root{color-scheme:dark;--bg:#090d18;--panel:#111827;--panel2:#151f31;--line:#263247;--text:#edf3ff;--muted:#98a6bd;--teal:#5eead4;--blue:#8aa8ff;--red:#fb7185;--green:#34d399;--amber:#fbbf24;--shadow:0 24px 70px #0006}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% -10%,#1c3850 0,transparent 40%),radial-gradient(ellipse at -10% 20%,#2a1e4b 0,transparent 34%),var(--bg);color:var(--text);font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}
    button,input,textarea{font:inherit}button{cursor:pointer}.hidden{display:none!important}.wrap{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:30px 0 54px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:13px}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:16px;background:linear-gradient(140deg,#62e7d1,#6895ff);color:#07121a;font-weight:900;font-size:18px;box-shadow:0 10px 30px #5eead433}.brand h1{font-size:19px;margin:0;letter-spacing:-.3px}.brand p{margin:2px 0 0;color:var(--muted);font-size:12px}.secure{color:#b9c8dc;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid var(--line);padding:8px 12px;border-radius:999px;background:#0e1522bb}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 12px #34d39988}.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:26px 0 20px}.hero h2{font-size:clamp(25px,4vw,38px);line-height:1.2;margin:0 0 8px;letter-spacing:-1px}.hero p{margin:0;color:var(--muted)}.buttons{display:flex;flex-wrap:wrap;gap:9px}.btn{border:1px solid var(--line);background:#151f30;color:var(--text);padding:10px 15px;border-radius:12px;font-weight:700;transition:.18s;display:inline-flex;align-items:center;justify-content:center;gap:8px}.btn:hover{border-color:#52728f;transform:translateY(-1px)}.btn.primary{background:linear-gradient(120deg,#62e7d1,#73a2ff);color:#07121a;border:0}.btn.danger{color:#ff9aaa;border-color:#74374a;background:#351b29}.btn.small{padding:7px 10px;font-size:12px;border-radius:10px}.btn:disabled{opacity:.55;cursor:wait;transform:none}.alert{border:1px solid #725522;background:#2b2416;color:#f6d68c;padding:12px 15px;border-radius:14px;margin:16px 0 20px;font-size:13px}.alert b{color:#ffe4a3}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0}.metric{background:linear-gradient(145deg,#141e2e,#101725);border:1px solid var(--line);border-radius:18px;padding:18px 20px;box-shadow:0 12px 32px #0002}.metric-label{color:var(--muted);font-size:12px}.metric-value{font-size:29px;font-weight:800;letter-spacing:-1px;margin-top:3px}.metric-note{color:#8595ad;font-size:11px;margin-top:2px}.panel{background:linear-gradient(155deg,#131d2c,#0f1622);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}.panel-head{padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line)}.panel-head h3{font-size:16px;margin:0}.panel-head p{margin:2px 0 0;color:var(--muted);font-size:12px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid #202d40}.search{min-width:190px;flex:1;max-width:350px;border:1px solid var(--line);background:#0c1320;color:var(--text);border-radius:11px;padding:9px 12px;outline:none}.search:focus,input:focus,textarea:focus{border-color:#5aaea5;box-shadow:0 0 0 3px #5eead414}.table-wrap{overflow:auto}.proxy-table{width:100%;border-collapse:collapse;min-width:770px}.proxy-table th{color:#93a2b9;font-size:11px;font-weight:700;text-align:right;padding:12px 17px;background:#0d1420}.proxy-table td{padding:13px 17px;border-top:1px solid #202b3c;font-size:13px;vertical-align:middle}.proxy-table tr:hover td{background:#15203355}.host{font-weight:750;direction:ltr;text-align:right;display:inline-block}.sub{font-size:11px;color:var(--muted);direction:ltr;text-align:right}.badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:750}.badge.on{background:#103a31;color:#8df2d4}.badge.off{background:#382c17;color:#f6d889}.badge.ok{background:#113a30;color:#9cf0c8}.badge.bad{background:#3a1e29;color:#ffa0af}.badge.wait{background:#202a3b;color:#b7c4d8}.row-actions{display:flex;gap:6px;align-items:center}.empty{padding:50px 20px;text-align:center;color:var(--muted)}.empty strong{display:block;font-size:16px;color:#e5edfb;margin-bottom:7px}.foot{color:#718098;font-size:11px;text-align:center;margin-top:18px}.toast{position:fixed;bottom:20px;left:50%;transform:translate(-50%,20px);background:#e4f8f4;color:#10221f;padding:11px 17px;border-radius:12px;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:.2s;z-index:20;font-weight:750;max-width:calc(100% - 30px)}.toast.show{opacity:1;transform:translate(-50%,0)}.modal-backdrop{position:fixed;inset:0;background:#050812cc;backdrop-filter:blur(7px);z-index:10;display:grid;place-items:center;padding:16px}.modal{width:min(540px,100%);background:#121c2b;border:1px solid #344158;border-radius:20px;padding:22px;box-shadow:var(--shadow)}.modal h3{margin:0 0 4px;font-size:19px}.modal>p{color:var(--muted);font-size:12px;margin:0 0 16px}.field{display:grid;gap:6px;margin:12px 0}.field label{font-size:12px;color:#b8c5d8;font-weight:700}.field input,.field textarea{width:100%;color:var(--text);background:#0b1220;border:1px solid var(--line);border-radius:11px;padding:11px 12px;outline:none}.field textarea{min-height:140px;resize:vertical;direction:ltr;text-align:left}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.hint{color:#8493aa;font-size:11px}.modal-actions{display:flex;justify-content:flex-start;gap:8px;margin-top:18px}.login-screen{min-height:70vh;display:grid;place-items:center}.login-card{width:min(440px,100%);padding:30px;background:#121b2a;border:1px solid #2b3a50;border-radius:22px;box-shadow:var(--shadow)}.login-card h2{margin:0 0 7px;font-size:25px}.login-card p{color:var(--muted);margin:0 0 22px}.login-error{color:#ff9aaa;font-size:12px;min-height:22px;margin-top:7px}.spinner{width:14px;height:14px;border:2px solid #ffffff55;border-top-color:white;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:700px){.wrap{width:min(100% - 22px,1180px);padding-top:18px}.top{margin-bottom:18px}.hero{display:block;margin:20px 0}.hero .buttons{margin-top:16px}.cards{gap:8px}.metric{padding:13px 12px;border-radius:15px}.metric-value{font-size:24px}.metric-note{font-size:10px}.panel-head{align-items:flex-start;padding:15px}.toolbar{padding:12px 14px}.secure{font-size:10px;padding:7px 9px}.brand h1{font-size:16px}.brand p{font-size:10px}.mark{width:42px;height:42px;border-radius:14px}.grid2{grid-template-columns:1fr 1fr}.btn{padding:9px 12px;font-size:12px}}
    @media(max-width:390px){.cards{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}.top{align-items:flex-start}.secure{max-width:112px}.buttons .btn{flex:1}}
  </style>
</head>
<body>
  <main class="wrap">
    <header class="top">
      <div class="brand"><div class="mark">TW</div><div><h1>TikWahm</h1><p>لوحة إدارة البروكسيات</p></div></div>
      <div class="secure"><span class="dot"></span><span>اتصال محمي · HTTPS</span></div>
    </header>
    <section id="loginScreen" class="login-screen hidden">
      <div class="login-card">
        <h2>مرحبًا بعودتك</h2><p>أدخل كلمة مرور لوحة التحكم للوصول إلى إعدادات البروكسي.</p>
        <form id="loginForm" autocomplete="on">
          <div class="field"><label for="loginPassword">كلمة المرور</label><input id="loginPassword" type="password" autocomplete="current-password" required maxlength="512" autofocus></div>
          <button class="btn primary" id="loginButton" type="submit" style="width:100%">دخول آمن</button>
          <div id="loginError" class="login-error" role="status"></div>
        </form>
      </div>
    </section>
    <section id="dashboard" class="hidden">
      <div class="hero">
        <div><h2>إدارة البروكسيات</h2><p>تحكم بالقائمة النشطة، اختبر الاتصال، واحتفظ بنسخة من الإعدادات.</p></div>
        <div class="buttons"><button class="btn" id="copyRender">نسخ إعداد Render</button><button class="btn" id="testAll">اختبار الكل</button><button class="btn primary" id="addProxy">＋ إضافة بروكسي</button></div>
      </div>
      <div class="alert"><b>تنبيه التخزين:</b> التعديلات تعمل فورًا على البوت، لكن مساحة الخدمة الحالية مؤقتة عند إعادة النشر. بعد التعديل، اضغط «نسخ إعداد Render» واحفظ القيمة في متغير <code dir="ltr">TIKWAHM_PROXY_LIST_B64</code> لضمان بقائها بعد إعادة النشر. لا تشارك القيمة؛ فهي تتضمن بيانات الدخول.</div>
      <div class="cards">
        <div class="metric"><div class="metric-label">إجمالي البروكسيات</div><div class="metric-value" id="totalCount">—</div><div class="metric-note">المحفوظة في اللوحة</div></div>
        <div class="metric"><div class="metric-label">النشطة</div><div class="metric-value" id="activeCount">—</div><div class="metric-note">يدوّر بينها البوت تلقائيًا</div></div>
        <div class="metric"><div class="metric-label">المتوقفة</div><div class="metric-value" id="disabledCount">—</div><div class="metric-note">تبقى بالقائمة دون استخدامها</div></div>
      </div>
      <section class="panel">
        <div class="panel-head"><div><h3>قائمة البروكسيات</h3><p id="updatedAt">جارٍ تحميل الإعدادات…</p></div><button class="btn small" id="logout">تسجيل الخروج</button></div>
        <div class="toolbar"><input id="search" class="search" type="search" placeholder="ابحث بالمضيف أو المنفذ أو المستخدم…"><button class="btn small" id="importProxy">استيراد قائمة</button><button class="btn small danger" id="clearAll">حذف الكل</button></div>
        <div class="table-wrap"><table class="proxy-table"><thead><tr><th>المضيف</th><th>اسم المستخدم</th><th>الحالة</th><th>آخر فحص</th><th>الإجراءات</th></tr></thead><tbody id="proxyRows"></tbody></table><div id="emptyState" class="empty hidden"><strong>القائمة فارغة حاليًا</strong>أضف بروكسيًا أو استورد قائمة كاملة لبدء الإدارة.</div></div>
      </section>
      <div class="foot">تُخفى كلمات المرور من الشاشة والسجلات. لا تحفظ نسخة إعداد Render في مكان عام.</div>
    </section>
  </main>
  <div id="modalRoot"></div><div id="toast" class="toast" role="status"></div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const apiRoot = '/proxy-admin/api';
  let proxies = [];
  let tests = {};
  let toastTimer;
  const esc = value => String(value ?? '');
  function toast(message){const box=$('toast');box.textContent=message;box.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('show'),2900)}
  async function api(path, options={}){
    const response=await fetch(apiRoot+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    if(response.status===401){showLogin();throw new Error('انتهت الجلسة؛ سجّل الدخول مجددًا.')}
    const type=response.headers.get('content-type')||'';
    const data=type.includes('application/json')?await response.json():await response.text();
    if(!response.ok){const detail=(data&&data.detail)||'تعذر إكمال العملية.';throw new Error(detail)}
    return data;
  }
  function showLogin(){ $('dashboard').classList.add('hidden');$('loginScreen').classList.remove('hidden');setTimeout(()=>$('loginPassword').focus(),50) }
  function showDashboard(){ $('loginScreen').classList.add('hidden');$('dashboard').classList.remove('hidden') }
  function fmtTime(value){if(!value)return '—';try{return new Intl.DateTimeFormat('ar-SA',{hour:'2-digit',minute:'2-digit'}).format(new Date(value*1000))}catch{return '—'}}
  function render(){
    const q=$('search').value.trim().toLowerCase();
    $('totalCount').textContent=proxies.length;
    $('activeCount').textContent=proxies.filter(p=>p.enabled).length;
    $('disabledCount').textContent=proxies.filter(p=>!p.enabled).length;
    const rows=$('proxyRows');rows.replaceChildren();
    const visible=proxies.filter(p=>`${p.host} ${p.port} ${p.username}`.toLowerCase().includes(q));
    $('emptyState').classList.toggle('hidden',visible.length>0);
    for(const p of visible){
      const tr=document.createElement('tr');
      const host=document.createElement('td');host.innerHTML='';
      const hostStrong=document.createElement('span');hostStrong.className='host';hostStrong.textContent=p.host;
      const hostSub=document.createElement('div');hostSub.className='sub';hostSub.textContent='PORT '+p.port;host.append(hostStrong,hostSub);
      const user=document.createElement('td');user.textContent=p.username||'—';
      const state=document.createElement('td');const stateBadge=document.createElement('span');stateBadge.className='badge '+(p.enabled?'on':'off');stateBadge.textContent=p.enabled?'نشط':'متوقف';state.append(stateBadge);
      const test=document.createElement('td');const t=tests[p.id];const testBadge=document.createElement('span');testBadge.className='badge '+(!t?'wait':(t.ok?'ok':'bad'));testBadge.textContent=!t?'لم يُفحص':(t.ok?`يعمل · ${t.ip||''}`:'فشل الاتصال');test.append(testBadge);if(t?.at){const small=document.createElement('div');small.className='sub';small.textContent=fmtTime(t.at);test.append(small)}
      const actions=document.createElement('td');const group=document.createElement('div');group.className='row-actions';
      const toggle=button(p.enabled?'إيقاف':'تفعيل','btn small');toggle.addEventListener('click',()=>changeEnabled(p));
      const check=button('فحص','btn small');check.addEventListener('click',()=>testOne(p));
      const edit=button('تعديل','btn small');edit.addEventListener('click',()=>editProxy(p));
      const up=button('↑','btn small');up.title='رفع';up.addEventListener('click',()=>move(p,-1));
      const down=button('↓','btn small');down.title='خفض';down.addEventListener('click',()=>move(p,1));
      const del=button('حذف','btn small danger');del.addEventListener('click',()=>deleteOne(p));
      group.append(toggle,check,edit,up,down,del);actions.append(group);tr.append(host,user,state,test,actions);rows.append(tr);
    }
    $('updatedAt').textContent=`آخر تحديث: ${new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(new Date())}`;
  }
  function button(text,cls){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;return b}
  async function refresh(){const data=await api('/proxies');proxies=data.proxies||[];tests=data.tests||{};showDashboard();render()}
  function openModal(title,description,content,onSave,saveText='حفظ'){
    const root=$('modalRoot');root.replaceChildren();const back=document.createElement('div');back.className='modal-backdrop';
    const box=document.createElement('section');box.className='modal';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
    const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=description;const body=document.createElement('div');body.append(content);
    const actions=document.createElement('div');actions.className='modal-actions';const close=button('إلغاء','btn');close.addEventListener('click',()=>root.replaceChildren());const save=button(saveText,'btn primary');save.addEventListener('click',onSave);actions.append(close,save);box.append(h,p,body,actions);back.append(box);back.addEventListener('click',e=>{if(e.target===back)root.replaceChildren()});root.append(back);
  }
  function field(labelText,placeholder,type='text',value=''){
    const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.type=type;input.placeholder=placeholder;input.value=value;input.autocomplete='off';wrap.append(label,input);return {wrap,input};
  }
  function addProxy(){
    const area=document.createElement('textarea');area.placeholder='host:port:username:password\nproxy2.example:8080:user:pass';area.autocomplete='off';
    const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label');label.textContent='قائمة البروكسيات';const hint=document.createElement('div');hint.className='hint';hint.textContent='أدخل بروكسيًا في كل سطر بالصيغة host:port:username:password. لن تظهر كلمة المرور بعد الحفظ.';wrap.append(label,area,hint);
    openModal('إضافة بروكسيات','يمكن إضافة سطر واحد أو لصق قائمة كاملة.',wrap,async()=>{try{const data=await api('/proxies',{method:'POST',body:JSON.stringify({lines:area.value})});$('modalRoot').replaceChildren();await refresh();toast(`أُضيف ${data.added} وتُجاوز ${data.skipped} مكرر`)}catch(e){toast(e.message)}},'إضافة وحفظ');
  }
  function editProxy(p){
    const host=field('المضيف','proxy.example.com','text',p.host);const port=field('المنفذ','8080','number',p.port);const user=field('اسم المستخدم','username','text',p.username);const pass=field('كلمة المرور','اتركها فارغة للإبقاء على الحالية','password','');
    const grid=document.createElement('div');grid.className='grid2';grid.append(host.wrap,port.wrap,user.wrap,pass.wrap);
    const note=document.createElement('div');note.className='hint';note.textContent='كلمة المرور الحالية لا تُعرض. اترك الحقل فارغًا إذا لم ترغب بتغييرها.';grid.append(note);
    openModal('تعديل البروكسي','عدّل بيانات الاتصال أو اترك كلمة المرور كما هي.',grid,async()=>{try{await api('/proxies/'+encodeURIComponent(p.id),{method:'PATCH',body:JSON.stringify({host:host.input.value,port:port.input.value,username:user.input.value,password:pass.input.value})});$('modalRoot').replaceChildren();await refresh();toast('تم تحديث البروكسي')}catch(e){toast(e.message)}},'حفظ التعديل');
  }
  async function changeEnabled(p){try{await api('/proxies/'+encodeURIComponent(p.id),{method:'PATCH',body:JSON.stringify({enabled:!p.enabled})});await refresh();toast(p.enabled?'تم إيقاف البروكسي':'تم تفعيل البروكسي')}catch(e){toast(e.message)}}
  async function deleteOne(p){if(!confirm(`حذف البروكسي ${p.host}:${p.port}؟`))return;try{await api('/proxies/'+encodeURIComponent(p.id),{method:'DELETE'});await refresh();toast('تم حذف البروكسي')}catch(e){toast(e.message)}}
  async function move(p,delta){const index=proxies.findIndex(x=>x.id===p.id),to=index+delta;if(to<0||to>=proxies.length)return;const ids=proxies.map(x=>x.id);[ids[index],ids[to]]=[ids[to],ids[index]];try{await api('/reorder',{method:'POST',body:JSON.stringify({ids})});await refresh()}catch(e){toast(e.message)}}
  async function testOne(p){try{toast(`جارٍ اختبار ${p.host}…`);const result=await api('/proxies/'+encodeURIComponent(p.id)+'/test',{method:'POST',body:'{}'});tests[p.id]={...result,at:Date.now()/1000};render();toast(result.ok?`الاتصال يعمل · IP ${result.ip||''}`:'فشل الاختبار؛ راجع المضيف والمنفذ وبيانات الدخول')}catch(e){toast(e.message)}}
  async function testAll(){const all=proxies;if(!all.length){toast('لا توجد بروكسيات في القائمة');return}const b=$('testAll');let checked=0,failed=0,stopped=false;b.disabled=true;for(let i=0;i<all.length;i++){b.textContent=`فحص ${i+1}/${all.length}`;try{const p=all[i];const result=await api('/proxies/'+encodeURIComponent(p.id)+'/test',{method:'POST',body:'{}'});tests[p.id]={...result,at:Date.now()/1000};checked++;if(!result.ok)failed++;render()}catch(e){toast(e.message);stopped=true;break}}b.disabled=false;b.textContent='اختبار الكل';if(stopped)toast(`توقف الفحص بعد ${checked} من ${all.length}؛ أعد المحاولة لإكماله`);else toast(`اكتمل فحص ${checked} بروكسي: ${checked-failed} يعمل، ${failed} فشل`)}
  async function copyRender(){try{const response=await fetch('/proxy-admin/api/render-config',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'}});if(response.status===401){showLogin();throw new Error('انتهت الجلسة؛ سجّل الدخول مجددًا.')}if(!response.ok)throw new Error('تعذر تجهيز إعداد Render.');const value=await response.text();await navigator.clipboard.writeText(value);toast('نُسخت القيمة؛ احفظها في متغير TIKWAHM_PROXY_LIST_B64 على Render')}catch(e){toast(e.message||'تعذر النسخ. تأكد من السماح للحافظة ثم حاول مجددًا.')}}
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('loginButton');button.disabled=true;button.innerHTML='<span class="spinner"></span> جارٍ التحقق';$('loginError').textContent='';try{const response=await fetch('/proxy-admin/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('loginPassword').value})});if(!response.ok)throw new Error(response.status===429?'محاولات كثيرة. انتظر قليلًا ثم حاول.':'كلمة المرور غير صحيحة.');$('loginPassword').value='';await refresh()}catch(err){$('loginError').textContent=err.message;$('loginPassword').select()}finally{button.disabled=false;button.textContent='دخول آمن'}});
  $('addProxy').addEventListener('click',addProxy);$('importProxy').addEventListener('click',addProxy);$('copyRender').addEventListener('click',copyRender);$('testAll').addEventListener('click',testAll);$('search').addEventListener('input',render);
  $('clearAll').addEventListener('click',async()=>{if(!proxies.length)return;if(!confirm('سيتم حذف كل البروكسيات من القائمة النشطة والمحفوظة. هل تريد المتابعة؟'))return;try{await api('/proxies',{method:'DELETE'});await refresh();toast('تم حذف جميع البروكسيات')}catch(e){toast(e.message)}});
  $('logout').addEventListener('click',async()=>{try{await fetch('/proxy-admin/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'})}finally{showLogin();toast('تم تسجيل الخروج')}});
  refresh().catch(()=>showLogin());
})();
</script>
</body>
</html>'''


def _verify_password(password: str, encoded: str, pepper: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = encoded.split("$", 5)
        if algorithm != "scrypt-hmac":
            return False
        n_value, r_value, p_value = int(n), int(r), int(p)
        if n_value < 2**14 or n_value > 2**18 or r_value < 1 or r_value > 16 or p_value < 1 or p_value > 4:
            return False
        expected = bytes.fromhex(digest_hex)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=n_value,
            r=r_value,
            p=p_value,
            dklen=len(expected),
        )
        actual = hmac.new(str(pepper).encode("utf-8"), derived, hashlib.sha256).digest()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, MemoryError):
        return False


def _valid_proxy_fields(host: str, port: object, username: str, password: str) -> dict:
    host = str(host or "").strip().rstrip(".")
    username = str(username or "")
    password = str(password or "")
    try:
        port_number = int(port)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="المنفذ غير صالح.")
    if (
        not host
        or len(host) > 253
        or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
        or host.startswith(".")
        or ".." in host
        or not 1 <= port_number <= 65535
        or not username
        or len(username) > 512
        or not password
        or len(password) > 2048
        or any(ch in username + password for ch in "\r\n\x00")
    ):
        raise HTTPException(status_code=422, detail="بيانات البروكسي غير مكتملة أو غير صالحة.")
    return {"host": host, "port": port_number, "username": username, "password": password}


def _parse_proxy_line(line: str) -> dict:
    parts = str(line).strip().split(":", 3)
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="صيغة السطر غير صحيحة. استخدم host:port:username:password.")
    return _valid_proxy_fields(*parts)


def _same_credentials(left: dict, right: dict) -> bool:
    return all(left.get(key) == right.get(key) for key in ("host", "port", "username", "password"))


def _public_proxy(proxy: dict) -> dict:
    return {
        "id": str(proxy.get("id", "")),
        "host": proxy.get("host", ""),
        "port": proxy.get("port", ""),
        "username": proxy.get("username", ""),
        "enabled": bool(proxy.get("enabled", True)),
    }


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin", "")
    host = request.headers.get("host", "").casefold()
    try:
        parsed = urlsplit(origin)
    except ValueError:
        parsed = None
    local_http = bool(host.startswith(("localhost", "127.0.0.1")) and parsed and parsed.scheme == "http")
    if not parsed or parsed.netloc.casefold() != host or not (parsed.scheme == "https" or local_http):
        raise HTTPException(status_code=403, detail="مصدر الطلب غير مسموح.")


def _remote_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _new_session(secret: str) -> str:
    issued = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    payload = f"tikwahm-proxy-admin:{_SESSION_GENERATION}:{issued}:{nonce}"
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{issued}.{nonce}.{signature}"


def _valid_session(token: str, secret: str) -> bool:
    try:
        issued_text, nonce, supplied_signature = token.split(".", 2)
        issued = int(issued_text)
        age = int(time.time()) - issued
        if age < 0 or age > SESSION_TTL_SECONDS:
            return False
        now = time.time()
        for revoked, expires_at in list(_REVOKED_SESSIONS.items()):
            if expires_at <= now:
                _REVOKED_SESSIONS.pop(revoked, None)
        if supplied_signature in _REVOKED_SESSIONS:
            return False
        payload = f"tikwahm-proxy-admin:{_SESSION_GENERATION}:{issued_text}:{nonce}"
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, supplied_signature)
    except (ValueError, TypeError):
        return False


def build_proxy_admin_router(
    get_entries: Callable[[], list[dict]],
    save_entries: Callable[[list[dict]], object],
    get_session_secret: Callable[[], str],
    test_proxy: Callable[[dict], object],
    password_hash: str = DEFAULT_PASSWORD_HASH,
    password_pepper: Callable[[], str] = lambda: "",
) -> APIRouter:
    router = APIRouter()
    tests: dict[str, dict] = {}

    def require_admin(request: Request) -> None:
        secret = get_session_secret()
        token = request.cookies.get(SESSION_COOKIE, "")
        if not secret or not _valid_session(token, secret):
            raise HTTPException(status_code=401, detail="انتهت الجلسة. سجّل الدخول مجددًا.")

    async def persist(entries: list[dict]) -> None:
        try:
            result = save_entries(entries)
            if asyncio.iscoroutine(result):
                await result
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="تعذر حفظ التغييرات داخل الخدمة.")

    @router.get("/proxy-admin", response_class=HTMLResponse, include_in_schema=False)
    async def dashboard_page():
        return HTMLResponse(PAGE, headers={**SECURITY_HEADERS, "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"})

    @router.post("/proxy-admin/login")
    async def login(request: Request, response: Response):
        _check_origin(request)
        try:
            if int(request.headers.get("content-length", "0") or "0") > 4096:
                raise HTTPException(status_code=413, detail="طلب تسجيل الدخول كبير جدًا.")
        except ValueError:
            raise HTTPException(status_code=400, detail="حجم الطلب غير صالح.")
        key = _remote_key(request)
        now = time.monotonic()
        recent = [t for t in _LOGIN_FAILURES.get(key, []) if now - t < _LOGIN_FAILURE_WINDOW]
        _LOGIN_FAILURES[key] = recent
        if len(recent) >= _LOGIN_FAILURE_LIMIT:
            raise HTTPException(status_code=429, detail="محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.")
        try:
            body = await request.json()
        except Exception:
            body = {}
        password = body.get("password", "") if isinstance(body, dict) else ""
        if not isinstance(password, str) or len(password) > 512 or not _verify_password(password, password_hash, password_pepper()):
            _LOGIN_FAILURES.setdefault(key, []).append(now)
            await asyncio.sleep(0.35)
            raise HTTPException(status_code=401, detail="كلمة المرور غير صحيحة.")
        _LOGIN_FAILURES.pop(key, None)
        secret = get_session_secret()
        if not secret:
            raise HTTPException(status_code=503, detail="إعداد الجلسة غير متاح.")
        response = Response(content=json.dumps({"ok": True}), media_type="application/json", headers=SECURITY_HEADERS)
        response.set_cookie(
            SESSION_COOKIE,
            _new_session(secret),
            max_age=SESSION_TTL_SECONDS,
            path="/proxy-admin",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return response

    @router.post("/proxy-admin/logout")
    async def logout(request: Request):
        _check_origin(request)
        token = request.cookies.get(SESSION_COOKIE, "")
        secret = get_session_secret()
        if token and secret and _valid_session(token, secret):
            signature = token.rsplit(".", 1)[-1]
            _REVOKED_SESSIONS[signature] = time.time() + SESSION_TTL_SECONDS
        response = Response(content=json.dumps({"ok": True}), media_type="application/json", headers=SECURITY_HEADERS)
        response.delete_cookie(SESSION_COOKIE, path="/proxy-admin", secure=True, httponly=True, samesite="strict")
        return response

    @router.get("/proxy-admin/api/proxies")
    async def list_proxies(request: Request):
        require_admin(request)
        entries = get_entries()
        return {
            "proxies": [_public_proxy(entry) for entry in entries],
            "tests": tests,
            "counts": {
                "total": len(entries),
                "active": sum(bool(entry.get("enabled", True)) for entry in entries),
                "disabled": sum(not bool(entry.get("enabled", True)) for entry in entries),
            },
        }

    @router.post("/proxy-admin/api/proxies")
    async def add_proxies(request: Request):
        _check_origin(request)
        require_admin(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="تعذر قراءة البيانات.")
        lines = body.get("lines", "") if isinstance(body, dict) else ""
        if not isinstance(lines, str) or len(lines) > 500_000:
            raise HTTPException(status_code=422, detail="قائمة البروكسيات غير صالحة أو كبيرة جدًا.")
        candidates = []
        for number, raw in enumerate(lines.splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            try:
                candidates.append(_parse_proxy_line(line))
            except HTTPException as exc:
                raise HTTPException(status_code=422, detail=f"السطر {number}: {exc.detail}")
        if not candidates:
            raise HTTPException(status_code=422, detail="أدخل سطرًا واحدًا على الأقل.")
        async with _MUTATION_LOCK:
            entries = get_entries()
            added = 0
            skipped = 0
            for candidate in candidates:
                if any(_same_credentials(candidate, current) for current in entries):
                    skipped += 1
                    continue
                import secrets
                entries.append({**candidate, "id": secrets.token_urlsafe(12), "enabled": True})
                added += 1
            if added:
                await persist(entries)
        return {"ok": True, "added": added, "skipped": skipped}

    @router.patch("/proxy-admin/api/proxies/{proxy_id}")
    async def update_proxy(proxy_id: str, request: Request):
        _check_origin(request)
        require_admin(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="تعذر قراءة البيانات.")
        if not isinstance(body, dict):
            raise HTTPException(status_code=422, detail="بيانات التعديل غير صالحة.")
        async with _MUTATION_LOCK:
            entries = get_entries()
            index = next((i for i, item in enumerate(entries) if item.get("id") == proxy_id), None)
            if index is None:
                raise HTTPException(status_code=404, detail="لم يُعثر على البروكسي.")
            current = entries[index]
            if "enabled" in body:
                if not isinstance(body["enabled"], bool):
                    raise HTTPException(status_code=422, detail="حالة التفعيل غير صالحة.")
                current["enabled"] = body["enabled"]
            elif any(key in body for key in ("host", "port", "username", "password")):
                candidate = _valid_proxy_fields(
                    body.get("host", current["host"]),
                    body.get("port", current["port"]),
                    body.get("username", current["username"]),
                    body.get("password") or current["password"],
                )
                if any(_same_credentials(candidate, entry) for i, entry in enumerate(entries) if i != index):
                    raise HTTPException(status_code=409, detail="يوجد بروكسي مطابق في القائمة.")
                entries[index] = {**current, **candidate}
            else:
                raise HTTPException(status_code=422, detail="لا توجد تغييرات للحفظ.")
            await persist(entries)
        return {"ok": True}

    @router.delete("/proxy-admin/api/proxies/{proxy_id}")
    async def delete_proxy(proxy_id: str, request: Request):
        _check_origin(request)
        require_admin(request)
        async with _MUTATION_LOCK:
            entries = get_entries()
            updated = [entry for entry in entries if entry.get("id") != proxy_id]
            if len(updated) == len(entries):
                raise HTTPException(status_code=404, detail="لم يُعثر على البروكسي.")
            await persist(updated)
            tests.pop(proxy_id, None)
        return {"ok": True}

    @router.delete("/proxy-admin/api/proxies")
    async def delete_all(request: Request):
        _check_origin(request)
        require_admin(request)
        async with _MUTATION_LOCK:
            await persist([])
            tests.clear()
        return {"ok": True}

    @router.post("/proxy-admin/api/reorder")
    async def reorder(request: Request):
        _check_origin(request)
        require_admin(request)
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="تعذر قراءة البيانات.")
        ids = body.get("ids") if isinstance(body, dict) else None
        async with _MUTATION_LOCK:
            entries = get_entries()
            expected = [entry.get("id") for entry in entries]
            if not isinstance(ids, list) or len(ids) != len(expected) or set(ids) != set(expected):
                raise HTTPException(status_code=422, detail="ترتيب البروكسيات غير صالح.")
            by_id = {entry["id"]: entry for entry in entries}
            await persist([by_id[proxy_id] for proxy_id in ids])
        return {"ok": True}

    @router.post("/proxy-admin/api/proxies/{proxy_id}/test")
    async def run_test(proxy_id: str, request: Request):
        _check_origin(request)
        require_admin(request)
        entry = next((item for item in get_entries() if item.get("id") == proxy_id), None)
        if entry is None:
            raise HTTPException(status_code=404, detail="لم يُعثر على البروكسي.")
        try:
            result = test_proxy(dict(entry))
            if asyncio.iscoroutine(result):
                result = await asyncio.wait_for(result, timeout=16)
            ok = bool(result.get("ok")) if isinstance(result, dict) else bool(result)
            data = {"ok": ok, "ip": str(result.get("ip", ""))[:80] if isinstance(result, dict) else ""}
        except Exception:
            data = {"ok": False, "ip": ""}
        data["at"] = time.time()
        tests[proxy_id] = data
        return data

    @router.post("/proxy-admin/api/render-config", response_class=PlainTextResponse)
    async def render_config(request: Request):
        _check_origin(request)
        require_admin(request)
        lines = []
        for entry in get_entries():
            line = f"{entry['host']}:{entry['port']}:{entry['username']}:{entry['password']}"
            lines.append(line if entry.get("enabled", True) else f"# disabled: {line}")
        plain = "\n".join(lines) + ("\n" if lines else "")
        encoded = base64.b64encode(plain.encode("utf-8")).decode("ascii")
        return PlainTextResponse(encoded, headers=SECURITY_HEADERS)

    return router
