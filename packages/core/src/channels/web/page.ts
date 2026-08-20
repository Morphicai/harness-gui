/**
 * web channel 的页面 —— 完全自包含，不引任何外部资源
 *
 * 不引 CDN 有两个硬理由：离线可用，以及不把交互内容（可能含公司数据）泄给第三方域名。
 */

/**
 * @param head 额外注入 <head> 的原始 HTML（探针脚本等）。默认空 —— 页面自包含是常态，
 *             注入是显式开启的例外，见 WebChannelOptions.instrument
 */
export function renderPage(token: string, title: string, head = ''): string {
  return `<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--accent:#1456f0;--danger:#dc2626;--card:#fafafa}
@media(prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e8eaed;--muted:#9aa0a6;--line:#2c2f36;--accent:#6f9bff;--danger:#f87171;--card:#1d2026}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:32px 20px 64px}
.idle{color:var(--muted);text-align:center;padding:80px 0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;animation:p 1.4s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
h1{font-size:20px;margin:0 0 6px}
.msg{color:var(--muted);margin:0 0 20px;white-space:pre-wrap}
.card{border:1px solid var(--line);border-radius:10px;padding:20px;background:var(--card)}
.row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
button{font:inherit;padding:9px 18px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{background:var(--danger);border-color:var(--danger);color:#fff}
button:hover{opacity:.88}
label{display:block;margin:14px 0 6px;font-size:13px;color:var(--muted)}
input[type=text],input[type=password],input[type=number],select{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.opt{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;cursor:pointer;background:var(--bg)}
.opt:hover{border-color:var(--accent)}
.opt input{margin-top:4px}
.opt .d{color:var(--muted);font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;white-space:nowrap}
th{background:var(--card)}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-size:13px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
.bar{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:13px}
.bar .lab{width:120px;color:var(--muted);text-align:right;flex:none}
.bar .b{height:14px;background:var(--accent);border-radius:3px;min-width:2px}
.diff div{font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap}
.diff .a{color:#16a34a}.diff .r{color:var(--danger)}
iframe{width:100%;min-height:320px;border:1px solid var(--line);border-radius:8px;background:#fff}
img{max-width:100%;border-radius:8px}
.done{text-align:center;color:var(--muted);padding:60px 0}
.req{color:var(--danger)}
.err{color:var(--danger);font-size:13px;margin-top:14px}
input.bad,select.bad{border-color:var(--danger)}
</style></head>
<body><div class="wrap" id="root">
  <div class="idle"><span class="dot"></span>等待交互…</div>
</div>
<script>
(function(){
var T=${JSON.stringify(token)};
var root=document.getElementById('root');

/*
 * 原生外壳里的额外能力：发系统通知。
 *
 * 这是渐进增强 —— 浏览器里 window.zero 不存在，整段自动跳过，页面行为不变。
 * 同一份页面装进 Native SDK 的 WebView 时才多出这一项，宿主给什么就用什么。
 */
var Z=(typeof window!=='undefined'&&window.zero&&window.zero.os)?window.zero:null;
var canNotify=false;
if(Z){
  // 先问这台机器支不支持，别把通知发出去石沉大海。宿主没放行这条命令时也会走 catch
  Z.invoke('native-sdk.platform.supports',{feature:'notifications'})
    .then(function(ok){canNotify=ok===true})
    .catch(function(){canNotify=false});
}
function ping(i){
  if(!Z||!canNotify)return;
  // notify 本身就是通知，一律发；其余交互只在用户没盯着窗口时才打扰
  if(i.kind!=='notify'&&document.hasFocus())return;
  var body=i.message||(i.kind==='confirm'?'需要你确认':i.kind==='select'?'需要你选择':i.kind==='form'?'需要你填写':'');
  // 通知失败不能影响交互本身：页面照常渲染，人在窗口里一样能答
  try{Z.os.showNotification({title:i.title,body:body}).catch(function(){})}catch(e){}
}

/*
 * 上报界面可见性。
 *
 * 常驻宿主里窗口可以被隐藏而页面继续活着 —— 发起方需要知道这件事：
 * 界面看不见时，交互能不能送达要靠通知，而不是指望人正好在看。
 */
function reportVisibility(){
  try{
    fetch('/visibility?t='+encodeURIComponent(T),{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({hidden:!!document.hidden})}).catch(function(){})
  }catch(e){}
}
if(document.addEventListener)document.addEventListener('visibilitychange',reportVisibility);
reportVisibility();

var es=new EventSource('/events?t='+encodeURIComponent(T));
es.addEventListener('interaction',function(e){render(JSON.parse(e.data))});
es.addEventListener('bye',function(){root.innerHTML='<div class="done">会话已结束，可以关闭此页面。</div>';es.close()});

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

// 极简 markdown 子集：标题 / 粗体 / 行内码 / 围栏 / 列表 / 链接。不引第三方库
function md(src){
  var out=[],lines=String(src||'').split('\\n'),i=0;
  function inline(t){return esc(t)
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
    .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>')}
  while(i<lines.length){
    var l=lines[i];
    if(/^\`\`\`/.test(l)){var buf=[];i++;while(i<lines.length&&!/^\`\`\`/.test(lines[i]))buf.push(lines[i++]);i++;
      out.push('<pre><code>'+esc(buf.join('\\n'))+'</code></pre>');continue}
    var h=l.match(/^(#{1,4})\\s+(.*)$/);
    if(h){out.push('<h'+(h[1].length+1)+'>'+inline(h[2])+'</h'+(h[1].length+1)+'>');i++;continue}
    if(/^[-*]\\s+/.test(l)){var items=[];while(i<lines.length&&/^[-*]\\s+/.test(lines[i]))items.push('<li>'+inline(lines[i++].replace(/^[-*]\\s+/,''))+'</li>');
      out.push('<ul>'+items.join('')+'</ul>');continue}
    if(l.trim()===''){i++;continue}
    out.push('<p>'+inline(l)+'</p>');i++;
  }
  return out.join('')
}

function content(c){
  if(!c)return '';
  switch(c.type){
    case 'markdown':return md(c.text);
    case 'table':return '<table><thead><tr>'+c.columns.map(function(x){return '<th>'+esc(x)+'</th>'}).join('')+
      '</tr></thead><tbody>'+c.rows.map(function(r){return '<tr>'+r.map(function(v){return '<td>'+esc(v)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table>';
    case 'chart':
      var mx=Math.max.apply(null,c.values.map(Math.abs).concat([1]));
      return c.labels.map(function(l,i){var v=c.values[i]||0;
        return '<div class="bar"><span class="lab">'+esc(l)+'</span><span class="b" style="width:'+Math.max(2,Math.abs(v)/mx*100)+'%"></span><span>'+v+esc(c.unit||'')+'</span></div>'}).join('');
    case 'diff':
      var a=c.before.split('\\n'),b=c.after.split('\\n'),bs={},as={};
      b.forEach(function(x){bs[x]=1});a.forEach(function(x){as[x]=1});
      var rows=[];if(c.filename)rows.push('<div>--- '+esc(c.filename)+'</div>');
      a.forEach(function(x){if(!bs[x])rows.push('<div class="r">- '+esc(x)+'</div>')});
      b.forEach(function(x){if(!as[x])rows.push('<div class="a">+ '+esc(x)+'</div>')});
      return '<div class="diff">'+rows.join('')+'</div>';
    case 'image':
      return /^(data:|https?:)/.test(c.src)?'<img src="'+esc(c.src)+'" alt="'+esc(c.alt||'')+'">':'<pre>'+esc(c.src)+'</pre>';
    // T2 一律塞进 sandbox iframe：调用方给的 HTML 不该有能力破坏本页面或读走 token
    case 'html':return '<iframe sandbox="allow-scripts" srcdoc="'+esc(c.html)+'"></iframe>';
    case 'url':return '<iframe sandbox="allow-scripts allow-same-origin" src="'+esc(c.url)+'"></iframe>';
    default:return '<pre>'+esc(JSON.stringify(c))+'</pre>'
  }
}

function submit(id,action,value){
  fetch('/submit?t='+encodeURIComponent(T),{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:id,action:action,value:value})});
  root.innerHTML='<div class="idle"><span class="dot"></span>已提交，等待下一次交互…</div>';
  scheduleHide();
}

/*
 * 答完就把窗口收起来 —— 一个常驻客户端不该答完了还赖在最前面。
 *
 * 只挂在 submit 上，所以纯展示（show 不带 awaitAck）不会触发：那种时候人正在读，
 * 把窗口收掉等于把刚渲染出来的文档抢走。带 awaitAck 的展示要人点一下「知道了」，
 * 那是明确的「看完了」，收起来是对的。
 *
 * 延迟 + 可取消是必需的：一次工具调用经常连着两问（先请人填内容、再请人确认），
 * 中间收一次窗口会闪，而且第二问会推给一个隐藏的窗口。
 */
var hideTimer=null;
function scheduleHide(){
  if(!Z)return; // 浏览器里没这回事，标签页归用户自己管
  cancelHide();
  hideTimer=setTimeout(function(){
    hideTimer=null;
    /*
     * 走 app 自己的命令，不用 native-sdk.window.close —— 那条是真关，
     * 会把 WebView 连同 SSE 长连接一起销毁，常驻就不成立了。
     */
    try{Z.invoke('native-sdk.command.invoke',{name:'interact.hide'}).catch(function(){})}catch(e){}
  },600);
}
function cancelHide(){if(hideTimer){clearTimeout(hideTimer);hideTimer=null}}

/** 就地报错。不能只是 return —— 点了没反应的按钮，用户分不清是没填还是程序挂了 */
function fail(msg){
  var el=root.querySelector('.err');
  if(!el){
    el=document.createElement('div');
    el.className='err';
    var row=root.querySelector('.row');
    if(row)row.parentNode.insertBefore(el,row);else root.appendChild(el);
  }
  el.textContent=msg;
}

function render(i){
  // 新交互到了就别收窗口了 —— 一次工具调用常常连着问两轮
  cancelHide();
  ping(i);
  var h='<h1>'+esc(i.title)+'</h1>';
  if(i.message)h+='<p class="msg">'+esc(i.message)+'</p>';
  var body='',foot='';
  if(i.kind==='notify'||i.kind==='show'){
    if(i.content)body='<div class="card">'+content(i.content)+'</div>';
    foot=i.awaitAck?'<button class="primary" data-a="accept">知道了</button>':'';
  }else if(i.kind==='confirm'){
    foot='<button class="'+(i.danger?'danger':'primary')+'" data-a="accept">确认</button><button data-a="cancel">取消</button>';
  }else if(i.kind==='select'){
    body='<div class="card">'+i.options.map(function(o,ix){
      return '<label class="opt"><input type="'+(i.multiple?'checkbox':'radio')+'" name="sel" value="'+esc(o.value)+'"'+(!i.multiple&&ix===0?' checked':'')+'><span><b>'+esc(o.label)+'</b>'+(o.description?'<div class="d">'+esc(o.description)+'</div>':'')+'</span></label>'
    }).join('')+'</div>';
    foot='<button class="primary" data-a="accept">确定</button><button data-a="cancel">取消</button>';
  }else if(i.kind==='form'){
    // 必填项在标签上打 * 并带 data-req，提交前据此校验 —— 声明了 required
    // 却不挡空值，等于让发起方拿着 "" 当成用户填过
    var req=function(f){return f.required?' <span class="req">*</span>':''};
    var rq=function(f){return f.required?' data-req="1"':''};
    body='<div class="card">'+i.fields.map(function(f){
      if(f.type==='select')return '<label>'+esc(f.label)+req(f)+'</label><select data-n="'+esc(f.name)+'"'+rq(f)+'>'+f.options.map(function(o){return '<option value="'+esc(o.value)+'"'+(o.value===f.default?' selected':'')+'>'+esc(o.label)+'</option>'}).join('')+'</select>';
      if(f.type==='boolean')return '<label class="opt"><input type="checkbox" data-n="'+esc(f.name)+'"'+(f.default?' checked':'')+'><span>'+esc(f.label)+'</span></label>';
      return '<label>'+esc(f.label)+req(f)+'</label><input type="'+esc(f.type)+'" data-n="'+esc(f.name)+'"'+rq(f)+' value="'+esc(f.default||'')+'" placeholder="'+esc(f.placeholder||'')+'">';
    }).join('')+'</div>';
    foot='<button class="primary" data-a="accept">提交</button><button data-a="cancel">取消</button>';
  }
  root.innerHTML=h+body+(foot?'<div class="row">'+foot+'</div>':'');

  if(i.kind==='notify'&&!i.awaitAck)return; // 单向：发起方已经不等了，页面只负责展示

  Array.prototype.forEach.call(root.querySelectorAll('button[data-a]'),function(btn){
    btn.onclick=function(){
      var a=btn.getAttribute('data-a');
      if(a!=='accept')return submit(i.id,'cancel');
      var v;
      if(i.kind==='select'){
        var checked=Array.prototype.filter.call(root.querySelectorAll('input[name=sel]'),function(x){return x.checked}).map(function(x){return x.value});
        // 一个点了没反应的按钮比报错更糟：用户不知道是没选、还是程序卡了
        if(checked.length===0)return fail('请先选择一项');
        v=i.multiple?checked:checked[0];
      }else if(i.kind==='form'){
        /*
         * required 必须在这里挡住。
         *
         * 协议里声明了 required，页面却照收空值的话，发起方拿到的是 ""，
         * 而它以为自己拿到了必填项 —— 错误会一路漏到业务逻辑里才暴露。
         * 校验放在提交前，人还在，改起来只要一秒。
         */
        var bad=null;
        v={};Array.prototype.forEach.call(root.querySelectorAll('[data-n]'),function(el){
          var n=el.getAttribute('data-n');
          var val=el.type==='checkbox'?el.checked:(el.type==='number'?Number(el.value):el.value);
          v[n]=val;
          if(el.getAttribute('data-req')==='1'){
            var empty=el.type==='number'?(el.value==='' ||isNaN(val)):String(val).trim()==='';
            if(empty&&!bad)bad=el;
          }
        });
        if(bad){
          bad.classList.add('bad');
          if(bad.focus)bad.focus();
          return fail('请填写标了 * 的必填项');
        }
      }else if(i.kind==='confirm'){v=true}
      submit(i.id,'accept',v);
    }
  });
}
})();
</script></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}
