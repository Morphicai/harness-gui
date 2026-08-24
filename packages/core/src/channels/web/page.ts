import { resolveMessages, type Messages } from '../../i18n.js'

/**
 * web channel 的页面 —— 完全自包含，不引任何外部资源
 *
 * 不引 CDN 有两个硬理由：离线可用，以及不把交互内容（可能含公司数据）泄给第三方域名。
 */

/**
 * @param head 额外注入 <head> 的原始 HTML（探针脚本等）。默认空 —— 页面自包含是常态，
 *             注入是显式开启的例外，见 WebChannelOptions.instrument
 * @param msgs 库自己的文案。整份序列化进页面脚本（见下面的 `var M=`）——
 *             页面是自包含的，运行时没有第二次机会去取文案。
 */
export function renderPage(
  token: string,
  title: string,
  head = '',
  msgs: Messages = resolveMessages(),
): string {
  return `<!doctype html>
<html lang="${escapeHtml(msgs.lang)}"><head>
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
.msg{color:var(--muted);margin:0 0 20px}
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
/* markdown 输出的排版。只作用在 md() 的产物上 —— T1 的表格/图表还归上面那几条管 */
.md>:first-child{margin-top:0}
.md>:last-child{margin-bottom:0}
.md p{margin:.55em 0}
.md h2,.md h3,.md h4,.md h5,.md h6{line-height:1.35;margin:1.1em 0 .45em;color:var(--fg)}
.md h2{font-size:1.18em}.md h3{font-size:1.06em}.md h4,.md h5,.md h6{font-size:1em}
.md a{color:var(--accent)}
.md ul,.md ol{margin:.55em 0;padding-left:1.5em}
.md li{margin:.22em 0}
.md li input{margin-right:.3em}
.md blockquote{margin:.7em 0;padding:.1em 0 .1em 12px;border-left:3px solid var(--line)}
.md hr{border:0;border-top:1px solid var(--line);margin:1.2em 0}
/* 半透明灰：.msg 铺在页面底色上、.card 里铺在卡片底色上，同一条规则两处都看得见 */
.md code{background:rgba(127,127,127,.16);padding:.12em .35em;border-radius:4px}
.md pre{position:relative}
.md pre code{background:none;padding:0}
.md pre .lang{position:absolute;top:6px;right:10px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.md table{margin:.7em 0}
.md th,.md td{white-space:normal}
.md .noimg{color:var(--muted);font-size:.9em}
</style></head>
<body><div class="wrap" id="root">
  <div class="idle"><span class="dot"></span>${escapeHtml(msgs.waiting)}</div>
</div>
<script>
/* 库自己的文案。调用方给的 title/message/选项标签不在这里 —— 那些原样透传 */
var M=${JSON.stringify(msgs)};
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
  var body=i.message||(i.kind==='confirm'?M.needConfirm:i.kind==='select'?M.needSelect:i.kind==='form'?M.needFill:'');
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
es.addEventListener('bye',function(){root.innerHTML='<div class="done">'+esc(M.sessionEnded)+'</div>';es.close()});

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

/*
 * markdown 渲染。和 src/markdown.ts 是同一个子集的两份实现 —— 那边渲染进 sandbox
 * iframe 的 T2 文档，这边渲染页面自己的 message 与 T1 markdown。改一处要想到另一处。
 *
 * 两处刻意的不同：
 *  - 标题整体降一级（页面自己占着 h1），且段落内的单个换行渲染成 <br> —— message
 *    大量是「顺手写的多行纯文本」，按标准 markdown 把软换行吃掉会挤成一坨。
 *  - 链接只放行安全协议：这个页面手里有 token，javascript: 链接点下去就是在本页
 *    origin 上执行调用方给的代码。
 */

/*
 * 调用方偶尔把换行写成字面的反斜杠 + n（JSON 里多转义了一层），显示出来就是正文里
 * 一个个可见的 \\n。只在整段找不到任何真换行时才当成这种情况修回来 —— 有真换行的
 * 文本里出现 \\n，更可能是在讲这个转义符本身，那是内容不是格式。
 */
function unslash(s){return /\\n/.test(s)?s:s.replace(/\\\\n/g,'\\n')}

function mdInline(t){
  var codes=[];
  // 行内码先抽成占位符：代码片段里出现 * ~ [ 是家常便饭，不能让它们被当成格式
  var s=String(t==null?'':t).replace(/\`([^\`]+)\`/g,function(_,c){codes.push(c);return '\\u0000'+(codes.length-1)+'\\u0000'});
  s=esc(s);
  s=s.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)/g,function(_,alt,u){
    return /^(data:image\\/|https?:)/i.test(u)
      ?'<img src="'+esc(u)+'" alt="'+esc(alt)+'">'
      :'<span class="noimg">'+esc(M.imagePlaceholder.replace('{alt}',alt?': '+alt:'').replace('{src}',u))+'</span>'});
  s=s.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g,function(_,txt,u){
    return /^(https?:|mailto:|#|\\/)/i.test(u)
      ?'<a href="'+esc(u)+'" target="_blank" rel="noreferrer noopener">'+txt+'</a>'
      :txt});
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
  s=s.replace(/(^|[^*])\\*([^*]+)\\*/g,'$1<em>$2</em>');
  s=s.replace(/~~([^~]+)~~/g,'<del>$1</del>');
  return s.replace(/\\u0000(\\d+)\\u0000/g,function(_,i){return '<code>'+esc(codes[Number(i)])+'</code>'})
}

var MD_LIST=/^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$/;
var MD_RULE=/^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/;
var MD_QUOTE=/^\\s*>\\s?/;
function mdRow(l){return /^\\s*\\|.*\\|\\s*$/.test(l)}
function mdSep(l){return /^\\s*\\|(\\s*:?-{2,}:?\\s*\\|)+\\s*$/.test(l)}
function mdCells(l){return l.trim().replace(/^\\||\\|$/g,'').split('|').map(function(s){return s.trim()})}
function mdAlign(s){return s.slice(-1)===':'?(s.charAt(0)===':'?'center':'right'):'left'}
function mdBlockStart(l){
  return /^\\s*(\`\`\`|~~~)/.test(l)||/^#{1,6}\\s/.test(l)||MD_QUOTE.test(l)||MD_RULE.test(l)||MD_LIST.test(l)||mdRow(l)
}

/** 列表。返回 [html, 下一行行号]，更深的缩进递归成子列表 */
function mdList(lines,start){
  var first=lines[start].match(MD_LIST),base=first[1].length,tag=/\\d/.test(first[2])?'ol':'ul';
  var items=[],i=start;
  while(i<lines.length){
    var m=lines[i].match(MD_LIST);
    if(!m||m[1].length<base)break;
    if(m[1].length>base){
      var sub=mdList(lines,i);
      if(items.length)items[items.length-1]+=sub[0];else items.push(sub[0]);
      i=sub[1];continue
    }
    var body=m[3],task=body.match(/^\\[([ xX])\\]\\s+(.*)$/);
    // 任务项渲染成禁用的复选框，「做完了没」这个信息不该丢
    var box=task?'<input type="checkbox" disabled'+(task[1]===' '?'':' checked')+'> ':'';
    if(task)body=task[2];
    items.push('<li>'+box+mdInline(body));
    i++
  }
  return ['<'+tag+'>'+items.map(function(s){return s+'</li>'}).join('')+'</'+tag+'>',i]
}

function md(src){
  var lines=unslash(String(src==null?'':src)).split('\\n'),out=[],i=0;
  while(i<lines.length){
    var l=lines[i];

    // 围栏代码块。没人认识的语言就显示成带标记的代码块，人还能读
    var fence=l.match(/^\\s*(\`\`\`|~~~)\\s*([^\\s\`]*)/);
    if(fence){
      var buf=[],mark=fence[1];i++;
      while(i<lines.length&&lines[i].trim().indexOf(mark)!==0)buf.push(lines[i++]);
      i++;
      out.push('<pre>'+(fence[2]?'<div class="lang">'+esc(fence[2])+'</div>':'')+'<code>'+esc(buf.join('\\n'))+'</code></pre>');
      continue
    }

    if(MD_RULE.test(l)){out.push('<hr>');i++;continue}

    var h=l.match(/^(#{1,6})\\s+(.*)$/);
    if(h){var lv=Math.min(6,h[1].length+1);out.push('<h'+lv+'>'+mdInline(h[2])+'</h'+lv+'>');i++;continue}

    // 表格：表头 + 分隔行才算，否则当普通段落
    if(mdRow(l)&&i+1<lines.length&&mdSep(lines[i+1])){
      var head=mdCells(l),al=mdCells(lines[i+1]).map(mdAlign),rows=[];
      i+=2;
      while(i<lines.length&&mdRow(lines[i]))rows.push(mdCells(lines[i++]));
      out.push('<table><thead><tr>'+head.map(function(c,ix){
        return '<th style="text-align:'+(al[ix]||'left')+'">'+mdInline(c)+'</th>'}).join('')+
        '</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c,ix){
          return '<td style="text-align:'+(al[ix]||'left')+'">'+mdInline(c)+'</td>'}).join('')+'</tr>'}).join('')+
        '</tbody></table>');
      continue
    }

    if(MD_QUOTE.test(l)){
      var q=[];
      while(i<lines.length&&MD_QUOTE.test(lines[i]))q.push(lines[i++].replace(MD_QUOTE,''));
      out.push('<blockquote>'+md(q.join('\\n'))+'</blockquote>');continue
    }

    if(MD_LIST.test(l)){var r=mdList(lines,i);out.push(r[0]);i=r[1];continue}

    if(l.trim()===''){i++;continue}

    /*
     * 段落：连续非空行合并，行间保留 <br>。
     *
     * 第一行**无条件**吃掉，这是防死循环的关键：走到这里的行仍可能满足
     * mdBlockStart（比如一行 \`| 看着像表格 |\` 而下一行不是分隔行，上面的表格分支
     * 没接住它），若循环条件对第一行也生效，就会一行都不消费、i 永不前进。
     */
    var para=[lines[i++]];
    while(i<lines.length&&lines[i].trim()!==''&&!mdBlockStart(lines[i]))para.push(lines[i++]);
    out.push('<p>'+mdInline(para.join('\\n')).replace(/\\n/g,'<br>')+'</p>');
  }
  return out.join('')
}

function content(c){
  if(!c)return '';
  switch(c.type){
    case 'markdown':return '<div class="md">'+md(c.text)+'</div>';
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
  root.innerHTML='<div class="idle"><span class="dot"></span>'+esc(M.submitted)+'</div>';
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
  // message 按 markdown 渲染：它是调用方唯一能塞正文的地方，实际拿到的经常是
  // 带标题、列表、行内码的长文，当纯文本铺出来只是一坨（md() 对纯文本仍是保真的）
  if(i.message)h+='<div class="msg md">'+md(i.message)+'</div>';
  var body='',foot='';
  if(i.kind==='notify'||i.kind==='show'){
    if(i.content)body='<div class="card">'+content(i.content)+'</div>';
    foot=i.awaitAck?'<button class="primary" data-a="accept">'+esc(M.ack)+'</button>':'';
  }else if(i.kind==='confirm'){
    foot='<button class="'+(i.danger?'danger':'primary')+'" data-a="accept">'+esc(M.confirm)+'</button><button data-a="cancel">'+esc(M.cancel)+'</button>';
  }else if(i.kind==='select'){
    body='<div class="card">'+i.options.map(function(o,ix){
      return '<label class="opt"><input type="'+(i.multiple?'checkbox':'radio')+'" name="sel" value="'+esc(o.value)+'"'+(!i.multiple&&ix===0?' checked':'')+'><span><b>'+esc(o.label)+'</b>'+(o.description?'<div class="d">'+esc(o.description)+'</div>':'')+'</span></label>'
    }).join('')+'</div>';
    foot='<button class="primary" data-a="accept">'+esc(M.ok)+'</button><button data-a="cancel">'+esc(M.cancel)+'</button>';
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
    foot='<button class="primary" data-a="accept">'+esc(M.submit)+'</button><button data-a="cancel">'+esc(M.cancel)+'</button>';
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
        if(checked.length===0)return fail(M.pickOne);
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
          return fail(M.fillRequired);
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
