// 模型接入 / 生成引擎 / 快速接入:经典 3694–4155 行的逐字移植。
// 经典从 el('pXxx')/el('agXxx')/el('qkXxx') 读写表单,这里表单值就存在 P/AG/QK 上,
// 由 SettingsSheet.jsx 双向绑定;所有措辞、校验路径、回读校验原样保留。
import { S, ui, bump, api } from '../core/index.js';
import { modeFromModel, modeSwitchBlocked, engineConnectionGate } from '../core/gen/pure.js';

export const P = { name:'senseaudio', url:'https://api.senseaudio.cn/v1', key:'', model:'', vision:'', insecure:false, msg:'' };
export const AG = { kind:'s2', mode:'agents', cmd:'', cmdPh:'命令模板,占位符 {tender} {out} {materials} {jobid} {skill}',
  cli:'', cliHint:'', cliHintColor:'var(--dim)', env:'', envPh:'附加环境变量(选填,每行 KEY=VALUE)',
  loginShell:true, soworkAgent:'', think:'off',
  s2Base:'', s2Model:'', s2Key:'', s2Hint:'', s2HintColor:'var(--dim)', s2BasePh:'网关地址(默认 https://api.senseaudio.cn/v1)', s2ModelPh:'生成用哪个模型(点这里选)',
  shellSt:'', shellStColor:'var(--dim)', shellInstall:false, shellInstallText:'一键修复生成组件(下载约 60MB)', shellBusy:false,
  engSum:'生成方式:加载中…(点开切换/高级设置)', msg:'', testMsg:'', extraKinds:[] };
export const QK = { mode:'fast', now:'', nowColor:'var(--sub)', msg:'', busy:false, key:'' };
export const PROV = { list: [] };

function pmsg(t){ P.msg = t; bump(); }
export function engineHint(e, what){
  const m = String(e && e.message || e);
  if(/ 404$/.test(m)) return '✗ '+what+'失败:当前连接的本地引擎版本过旧(缺该接口)。多为旧版应用/旧引擎仍占用端口——退出旧版后重开本应用;也可先手填模型 ID 直接「添加并测试」。';
  if(/ 5\d\d$/.test(m)) return '✗ '+what+'失败:本地引擎内部错误,详见 ~/Documents/中标狗/engine.log';
  return '✗ '+what+'失败:连不上本地引擎(应用刚启动时引擎需几秒)。仍不行请看 ~/Documents/中标狗/engine.log';
}

export async function loadProviders(){
  let ps = [];
  if(S.online){ try{ ps = await api('/v1/providers'); }catch(e){} }
  PROV.list = ps; bump();
  loadAgent();
}
export async function fetchModels(){
  if(!S.online){ pmsg('本地引擎未连接:应用刚启动时引擎需几秒,稍候重试'); return; }
  const body = {base_url: P.url.trim(), api_key: P.key.trim(), verify_ssl: !P.insecure};
  if(!body.base_url){ pmsg('先填 Base URL'); return; }
  pmsg('获取模型列表中…');
  try{
    const r = await api('/v1/providers/probe_models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.ok && r.models.length){
      S.models = r.models.slice();          // 真下拉直接读全量,不再受输入文字过滤之害
      if(!P.model) P.model = r.models.find(m=>m.indexOf('s2')>=0) || r.models[0];
      if(!P.vision){ const v = r.models.find(m=>/vl|vision/i.test(m) && !/lite/i.test(m)) || r.models.find(m=>/vl|vision/i.test(m)); if(v) P.vision = v; }
      pmsg('✓ 该网关有 '+r.models.length+' 个模型,点模型输入框查看全部(可输入过滤)'+(r.cached?' · 来自缓存,即时返回':''));
    } else pmsg('该网关不支持列出模型('+(r.error||'')+'),请手填模型 ID,如 senseaudio-s2');
  }catch(e){ pmsg(engineHint(e, '获取模型列表')); }
}
export async function addProvider(){
  if(!S.online){ pmsg('本地引擎未连接:应用启动后引擎需数秒;若一直未连上,看 ~/Documents/中标狗/engine.log'); return; }
  const body = {name:P.name.trim()||'senseaudio', base_url:P.url.trim(), api_key:P.key.trim(), model:P.model.trim(), vision_model:P.vision.trim(), kind:'openai_compatible', verify_ssl: !P.insecure};
  if(!body.base_url){ pmsg('先填 Base URL'); return; }
  pmsg(body.model ? '添加后用「'+body.model+'」发一次真实对话测试…' : '添加并测试通道连通性…');
  try{
    const r = await api('/v1/providers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const t = await api('/v1/providers/'+r.id+'/test',{method:'POST'});
    pmsg(t.ok ? '✓ 测试通过:'+(t.model||'通道连通')+' · '+t.latency_ms+'ms'+(t.reply?' · 模型回复「'+t.reply+'」':'')+(t.note?' · '+t.note:'')
              : '✗ 测试失败:'+(t.error||'未知原因'));
  }catch(e){ pmsg(engineHint(e, '添加/测试')); }
  loadProviders();
}
export async function testProvider(id){
  try{ const r = await api('/v1/providers/'+id+'/test',{method:'POST'});
    pmsg(r.ok ? '✓ 测试通过:'+(r.model||'')+' '+r.latency_ms+'ms'+(r.reply?' · 回复「'+r.reply+'」':'') : '✗ 测试失败:'+(r.error||''));
    return r.ok;
  }catch(e){ pmsg('✗ 测试请求失败'); return false; }
}
export async function delProvider(id){
  if(!await ui.askConfirm('删除这个接入点?', '删除后可随时重新添加并测试。', true)) return;
  try{ await api('/v1/providers/'+id, {method:'DELETE'}); }catch(e){ pmsg('删除失败'); }
  loadProviders();
}

export function onKindChange(){
  // 换了引擎,上一个引擎的 CLI 路径与就绪状态不再适用:按新引擎重取(引擎侧也有同族校验兜底)
  const k = AG.kind;
  const a = S.lastAgent;
  if(a){
    const key0 = (k==='sowork') ? 'sowork' : (k==='s2' ? 'opencode' : k);
    const found = (a.paths||{})[key0] || '';
    AG.cli = '';
    AG.cliHint = found ? '✓ 已自动检测到:'+found : '';
    AG.cliHintColor = found ? 'var(--green)' : 'var(--dim)';
    if(k==='s2'){
      const bundled = a.opencode_bundled;
      const okk = (a.available||{}).opencode;
      AG.shellSt = bundled ? '✓ 生成组件已内置,开箱即用'
        : (okk ? '✓ 生成组件已就绪:'+((a.paths||{}).opencode||'')
               : '✗ 生成组件需要修复(点右侧一键处理,完成后不用登录)');
      AG.shellStColor = (bundled||okk) ? 'var(--green)' : 'var(--amber)';
      AG.shellInstall = !(bundled||okk);
    }
  }
  bump();
}

export async function testAgent(){
  AG.testMsg = '测试中(最多 2 分钟)…'; bump();
  try{
    await saveAgent(true);                       // 先存再测,免得测的是旧配置
    const r = await api('/v1/agent/test', {method:'POST'});
    AG.testMsg = r.ok ? ('✓ 连接成功' + (r.latency_ms ? ' · '+r.latency_ms+'ms' : '')
                            + (r.note ? ' · '+r.note : '') + (r.reply ? ' · 返回「'+r.reply.slice(0,60)+'」' : ''))
                         : ('✗ ' + r.error + (r.reply ? '\n日志尾部:'+r.reply.slice(-200) : ''));
  }catch(e){ AG.testMsg = '✗ 测试请求失败:本地引擎没连上'; }
  bump();
}

export async function loadS2Models(force){
  // 生成用的模型从网关实拉:S2、DeepSeek 等你套餐里有什么就能选什么
  try{
    if(force){ AG.s2Hint = '正在取模型列表…'; bump(); }
    const r = await api('/v1/relay/models');
    const ids = r.models || (r.data||[]).map(x=>x.id).filter(Boolean);
    if(ids && ids.length){
      S.s2Models = ids;
      if(force){ AG.s2Hint = '✓ 网关有 '+ids.length+' 个模型,点模型框选择'; AG.s2HintColor='var(--green)'; bump(); }
      return ids;
    }
    if(force){ AG.s2Hint = '✗ 没取到模型:先填好 Key 再试'; AG.s2HintColor='var(--dim)'; bump(); }
  }catch(e){ if(force){ AG.s2Hint = '✗ 取模型失败:先填好 Key、确认网关地址'; AG.s2HintColor='var(--dim)'; bump(); } }
  return null;
}

export async function provisionShell(){
  // 「自动(默认)」引擎已转正为 OpenCode,这里要装的就是它。(经典同注释)
  const which = 'opencode';
  AG.shellBusy = true; AG.shellInstallText = '安装中…'; bump();
  try{
    let r = await api('/v1/agent/provision', {method:'POST', headers:{'Content-Type':'application/json'},
                       body: JSON.stringify({which})});
    // 轮询进度:OpenCode 压缩包最大约 60MB,解压约 170MB;慢网络可能要几分钟,把百分比一直报给用户
    while(r.state === 'running'){
      AG.shellSt = '⇣ ' + (r.note||'下载中…') + ' ' + (r.pct||0) + '%';
      AG.shellStColor = 'var(--sub)'; bump();
      await new Promise(x=>setTimeout(x, 1200));
      r = await api('/v1/agent/provision');
    }
    if(r.state === 'done'){
      AG.shellSt = '✓ ' + (r.note || '安装完成'); AG.shellStColor = 'var(--green)';
      AG.shellInstall = false; bump();
      setTimeout(loadAgent, 800);
    }else{
      AG.shellSt = '✗ ' + (r.error || '安装失败'); AG.shellStColor = 'var(--red)';
      AG.shellBusy = false; AG.shellInstallText = '重试一键安装'; bump();
    }
  }catch(e){
    AG.shellSt = '✗ 安装请求失败:本地引擎没连上'; AG.shellStColor = 'var(--red)';
    AG.shellBusy = false; AG.shellInstallText = '重试一键安装'; bump();
  }
}

export async function loadAgent(){
  if(!S.online) return;
  try{
    const a = await api('/v1/agent');
    S.lastAgent = a;
    AG.extraKinds = (a.kind==='claude'||a.kind==='codex') ? [a.kind] : [];   // 老配置仍在用本机订阅引擎:补显示,不偷改
    if(a.kind !== 'env') AG.kind = a.kind;
    // 撤下过的/未知的 kind 会让 select 变空白:落到 s2(有 Key)或 mock,绝不留空
    if(!AG.kind) AG.kind = (a.s2_key_set||a.s2_borrowed) ? 's2' : 'mock';
    AG.mode = a.mode || 'agents';
    const kind0 = (a.kind === 'env' ? 'mock' : a.kind) || 'mock';
    const cliKind = kind0 === 'sowork' ? 'sowork' : (kind0 === 's2' ? 'opencode' : kind0);
    const found = (a.paths || {})[cliKind] || '';
    // 自动找到就直接填进来:用户看得见,保存后即固定;路径失效时引擎仍会回落自动查找
    AG.cli = a.cli_path || found || '';
    AG.cliHint = a.cli_path ? '已手动指定路径' : (found ? '✓ 已自动检测到:' + found : '');
    AG.cliHintColor = found || a.cli_path ? 'var(--green)' : 'var(--dim)';
    AG.env = '';
    AG.envPh = a.env_set ? '已保存附加环境变量(留空沿用,输入新值覆盖)' : '附加环境变量(选填,每行 KEY=VALUE)';
    AG.loginShell = a.login_shell !== false;
    AG.soworkAgent = a.sowork_agent || '';
    AG.think = a.thinking || 'off';
    const d = a.s2_defaults || {};
    AG.s2Base = a.s2_base_url || '';
    AG.s2Model = a.s2_model || '';
    AG.s2Key = '';                    // Key 只写不读:引擎从不回传,页面上也不留残影
    AG.s2Hint = a.s2_key_set ? '✓ 已保存 Key(留空即沿用,重填会覆盖)'
      : (a.s2_borrowed ? '↺ 未单独填 Key,将借用上面「模型接入」里已配好的那个'
                       : '✗ 还没 Key:新建任务会先跑内置演示流程;填完 Key 点「测试连接」即产真实标书');
    AG.s2HintColor = (a.s2_key_set || a.s2_borrowed) ? 'var(--green)' : 'var(--dim)';
    AG.s2BasePh = '网关地址(默认 '+(d.base_url||'')+')';
    AG.s2ModelPh = '生成用哪个模型(当前 '+(a.s2_model_effective||d.model||'')+',点这里换)';
    if((a.s2_key_set||a.s2_borrowed) && !S.s2Models) loadS2Models(0);
    // 执行外壳状态:内置(安装包自带)> 已装(路径)> 缺 → 给一键安装按钮
    const bundled = a.opencode_bundled;
    const cxOk = a.available && a.available.opencode;
    AG.shellSt = bundled ? '✓ 生成组件已内置,开箱即用'
      : (cxOk ? '✓ 生成组件已就绪:'+((a.paths||{}).opencode||'')
              : '✗ 生成组件需要修复(点右侧一键处理,完成后不用登录)');
    AG.shellStColor = (bundled || cxOk) ? 'var(--green)' : 'var(--amber)';
    AG.shellInstall = !(bundled || cxOk);
    AG.shellInstallText = '一键修复生成组件(下载约 60MB)';
    // 折叠摘要:平时只看这一行,展开才见全部选项
    const engName = ({mock:'内置演示流程',s2:'自动',sowork:'SoWork(商汤)',claude:'Claude Code',codex:'Codex CLI',custom:'自定义命令'})[a.kind==='env'?'custom':a.kind] || a.kind;
    const engReady = a.kind==='mock' ? '' : (a.kind==='s2'
      ? ((a.s2_key_set||a.s2_borrowed) ? ' · ✓ '+(a.s2_model_effective||'')+' · 产真实标书' : ' · 未填 Key,当前跑演示流程')
      : ((a.available||{})[a.kind==='env'?'codex':a.kind] ? ' · ✓ 已就绪' : ''));
    AG.engSum = '生成方式:' + engName + engReady + '(点开切换/高级设置)';
    // 快速接入卡片上直说「现在真正会跑的是谁」(经典同注释)
    if(a.kind === 's2'){
      const eff = a.s2_model_effective || '';
      const actualMode = a.generation_mode === 'standard' ? 'quality' : (a.generation_mode || modeFromModel(eff));
      if(actualMode) setQkMode(actualMode);
      QK.now = '当前生效:自动 · ' + QK_MODES[QK.mode].name + '模式';
      QK.nowColor = 'var(--sub)';
      const want = QK_MODES[QK.mode];
      if(eff && want && !(eff === want.prefer || want.pick.test(eff)))
        QK.now += ' —— 与所选「' + want.name + '」不一致,点一下模式按钮即可切过去';
    }else{
      QK.now = '⚠ 当前生效的生成引擎是「' + kindName(a.kind) + '」,上面的标准/极速对它不起作用。'
             + '粘 Key 点「一键接入并测试」即可切到「自动」。';
      QK.nowColor = 'var(--amber)';
    }
    AG.cmd = '';
    AG.cmdPh = a.cmd_set ? '已保存命令模板(留空沿用,输入新值覆盖)' : '命令模板,占位符 {tender} {out} {materials} {jobid} {skill}';
    const pth = a.paths||{};
    const kk = AG.kind;
    AG.msg = '标书技能包:'+(a.skill_ok?'✓ 已内置':'✗ 未找到(解压 bidmultiagenttao_v5.3.zip 到 '+a.skill_dir+')')
      +(kk==='sowork' ? ' · SoWork:'+(a.available.sowork?'✓ '+(pth.sowork||'已装'):'✗ 未找到(需安装并登录 SoWork)') : '')
      +(kk==='claude' ? ' · claude CLI:'+(a.available.claude?'✓ 已装':'✗ 未装') : '')
      +(kk==='codex' ? ' · codex CLI:'+(a.available.codex?'✓ 已装':'✗ 未装') : '')
      +(a.kind==='env'?' · 当前由环境变量 AGENT_CMD 接管':'');
    bump();
  }catch(e){}
}

export const QK_MODES = {
  quality: {name:'标准', prefer:'senseaudio-s2', pick:/s2|pro|max|plus/i, avoid:/flash|lite|mini|turbo|nano/i,
            hint:'标准:解析和分章仍用极速模型，最终增加标准模型复核；适合关键项目和定稿。'},
  fast:    {name:'极速', prefer:'deepseek-v4-flash', pick:/flash|lite|turbo|mini|nano/i, avoid:null,
            hint:'极速:本地解析后用极速模型分段生成，优先速度与稳定性；现在为默认。'}
};
let QK_SWITCH_SEQ = 0, QK_SWITCH_QUEUE = Promise.resolve();
export function setQkMode(mode){
  if(!QK_MODES[mode]) return;
  QK.mode = mode; bump();
}
export function queueQkMode(mode){
  if(modeSwitchBlocked(S.jobs)){
    QK.msg = '当前有任务正在运行或暂停，为避免同一任务中途换模型，模式未切换。请先完成、停止或重跑后再切。'; bump();
    return;
  }
  const seq = ++QK_SWITCH_SEQ;
  QK_SWITCH_QUEUE = QK_SWITCH_QUEUE.then(async()=>{
    if(seq !== QK_SWITCH_SEQ) return;             // 尚未开始的旧点击被新点击合并,只执行最后一次
    const previousMode = (S.lastAgent&&S.lastAgent.generation_mode)==='standard' ? 'quality'
      : ((S.lastAgent&&S.lastAgent.generation_mode)||modeFromModel(S.lastAgent&&S.lastAgent.s2_model_effective)||QK.mode);
    setQkMode(mode); QK.busy = true; bump();
    const ok = await qkApplyMode(mode);
    if(!ok){
      setQkMode(previousMode);                     // 请求失败时先恢复一个可信的本地状态
      await loadAgent();                           // 再以服务端回读为最终准绳,不能被旧缓存反向覆盖
    }
    QK.busy = false; bump();
  }).catch(e=>{
    QK.busy = false; QK.msg = '✗ 模式未切换:'+(e&&e.message||'未知错误'); bump();
  });
}
export async function qkApplyMode(mode){
  /* 「标准/极速」是设置,不是待提交的表单选项。(经典同注释) */
  let A = null, liveJobs = null;
  try{
    [A, liveJobs] = await Promise.all([api('/v1/agent'), api('/v1/jobs')]);
    S.jobs = liveJobs; ui.render('tasks');
  }catch(e){ QK.msg = '✗ 模式未切换:无法确认引擎与任务状态'; bump(); return false; }
  if(modeSwitchBlocked(S.jobs)){
    QK.msg = '当前已有任务开跑，为避免中途换模型，模式未切换。'; bump(); return false;
  }
  if(!(A.s2_key_set || A.s2_borrowed)){
    QK.msg = '已选「' + QK_MODES[mode].name + '」。粘上 Key 后点「一键接入并测试」才会生效。'; bump();
    return true;
  }
  QK.msg = '切换到「' + QK_MODES[mode].name + '」并做真实连通测试…'; bump();
  const oldPayload = agentStatusPayload(A); let changed = false;
  try{
    let models = S.s2Models || [];
    if(!models.length){ try{ models = (await api('/v1/relay/models')).models || []; }catch(e){} }
    const gen = qkPick(models, mode);
    await api('/v1/agent', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(
      Object.assign({}, oldPayload, {kind:'s2', s2_model: gen,
        generation_mode:mode==='quality'?'standard':'fast', cli_path:''}))});
    changed = true;
    const v = await qkVerify(gen, mode);
    if(!v.ok) throw new Error(v.why);
    const probe = await api('/v1/agent/test', {method:'POST'});
    if(!probe.ok) throw new Error(probe.error || '新模型连通测试未通过');
    QK.msg = '✓ 已切到「' + QK_MODES[mode].name + '」· 生成模型:' + gen + ' —— 新建任务即生效'; bump();
    S.s2Models = models.length ? models : S.s2Models;
    await loadAgent(); return true;
  }catch(e){
    let restored = false;
    if(changed){
      try{
        await api('/v1/agent', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(oldPayload)});
        restored = true;
      }catch(_){}
    }
    QK.msg = '✗ 模式未切换:' + (e && e.message || '没连上本地引擎') + (restored?' · 已恢复原模式':''); bump();
    return false;
  }
}
export async function qkVerify(gen, mode){
  /* 回读校验:保存接口返回 ok 不等于真的生效(经典同注释) */
  try{
    const a = await api('/v1/agent');
    if(a.kind !== 's2') return {ok:false, why:'当前生效的引擎仍是「' + kindName(a.kind) + '」,请在下面「生成引擎」里手动选「自动(默认)」'};
    if(gen && a.s2_model && a.s2_model !== gen) return {ok:false, why:'模型没写进去(仍是 ' + a.s2_model + ')'};
    const expectedMode = mode==='quality'?'standard':'fast';
    if(mode && a.generation_mode !== expectedMode) return {ok:false, why:'生成模式没有保存成功'};
    if(!(a.s2_key_set || a.s2_borrowed)) return {ok:false, why:'Key 没保存成功'};
    return {ok:true};
  }catch(e){ return {ok:false, why:'读不回引擎状态'}; }
}
export const KIND_NAME = {mock:'内置演示流程', s2:'自动(默认)', sowork:'SoWork(商汤)', claude:'Claude Code',
                   codex:'Codex CLI', custom:'自定义命令', env:'环境变量 AGENT_CMD'};
export function kindName(k){ return KIND_NAME[k] || k || '未设置'; }
export function agentStatusPayload(a){
  return {kind:a.kind==='env'?'custom':(a.kind||'s2'), mode:a.mode||'agents', cmd:a.cmd||'',
          generation_mode:a.generation_mode||'fast',
          skill_dir:a.skill_dir||'',
          cli_path:a.cli_path||'', env:a.env||'', login_shell:a.login_shell!==false,
          sowork_agent:a.sowork_agent||'main', thinking:a.thinking||'off', timeout:a.timeout||1800,
          s2_base_url:a.s2_base_url||'', s2_model:a.s2_model||'', s2_key:'',
          s2_wire:a.s2_wire||'auto', s2_verify_ssl:a.s2_verify_ssl!==false};
}
export function agentPayload(){
  /* PUT /v1/agent 是整体覆盖写,漏字段等于把用户的高级设置清空——统一在这里取一次 */
  return {kind: AG.kind, mode: AG.mode, cmd: AG.cmd.trim(),
          generation_mode: QK.mode==='quality'?'standard':'fast',
          cli_path: AG.cli.trim(), env: AG.env.trim(),
          login_shell: AG.loginShell, sowork_agent: (AG.soworkAgent.trim() || 'main'),
          thinking: AG.think, s2_base_url: AG.s2Base.trim(),
          s2_model: AG.s2Model.trim(), s2_key: AG.s2Key.trim()};
}
export function qkPick(models, mode){
  // 先认名字,再认特征,最后兜底第一个——网关里没有指定模型也不至于配不上
  const M = QK_MODES[mode];
  if(models.includes(M.prefer)) return M.prefer;
  const cand = models.filter(x => !/vl|vision|embed|rerank|audio|tts|whisper/i.test(x));
  const hit = cand.find(x => M.pick.test(x) && (!M.avoid || !M.avoid.test(x)));
  return hit || cand.find(x => !M.avoid || !M.avoid.test(x)) || cand[0] || models[0] || M.prefer;
}
export function qkPickVision(models){
  const vs = models.filter(x => /vl|vision|vlm/i.test(x));
  return vs.find(x => !/lite|mini|nano/i.test(x)) || vs[0] || '';
}
export async function quickS2(){
  // 一串 Key 三件事:生成引擎 + 对话 + 识图,模型按所选模式自动定,识图模型自动挑
  const key = QK.key.trim();
  const gate = engineConnectionGate(S.online, S.stale);
  if(!gate.ready){ QK.msg = '✗ ' + gate.message; bump(); return; }
  if(modeSwitchBlocked(S.jobs)){
    QK.msg = '当前有任务正在运行或暂停，为避免中途换模型，接入设置未更改。'; bump(); return;
  }
  const A = await api('/v1/agent').catch(()=>null);
  const liveJobs = await api('/v1/jobs').catch(()=>null);
  if(!liveJobs){ QK.msg = '✗ 无法确认任务状态，接入设置未更改。'; bump(); return; }
  S.jobs = liveJobs; ui.render('tasks');
  if(modeSwitchBlocked(liveJobs)){
    QK.msg = '当前有任务正在运行或暂停，为避免中途换模型，接入设置未更改。'; bump(); return;
  }
  if(!key && !(A && (A.s2_key_set || A.s2_borrowed))){ QK.msg='✗ 先粘贴 Key(sk- 开头那串)'; bump(); return; }
  QK.busy = true; bump();
  const lines = []; const flush = ()=>{ QK.msg = lines.join('\n'); bump(); };
  const d = (A && A.s2_defaults) || {};
  const base = (A && A.s2_base_url) || d.base_url || 'https://api.senseaudio.cn/v1';
  try{
    lines.push('1/4 读取你套餐里的模型…'); flush();
    let models = [];
    try{
      const pr = await api('/v1/providers/probe_models', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({base_url: base, api_key: key, verify_ssl: true})});
      models = pr.models || [];
    }catch(e){}
    const gen = qkPick(models, QK.mode);
    const vis = qkPickVision(models);
    lines[0] = '✓ 1/4 '+(models.length ? ('网关有 '+models.length+' 个模型') : '未取到列表,按默认模型配置');
    flush();

    lines.push('2/4 绑定生成引擎(' + QK_MODES[QK.mode].name + ':' + gen + ')…'); flush();
    AG.kind = 's2'; onKindChange();
    if(key) AG.s2Key = key;
    AG.s2Model = gen;
    AG.cli = '';                    // 上一个引擎(如 SoWork)的 CLI 路径对「自动」无效,顺手清掉
    if(!AG.s2Base.trim() && base) AG.s2Base = base;
    await saveAgent(true);
    // 回读校验:保存接口 ok ≠ 真的换过去了。(经典同注释)
    const v2 = await qkVerify(gen);
    if(!v2.ok){ lines[1] = '✗ 2/4 生成引擎没绑成功:' + v2.why; flush(); QK.busy = false; bump(); return; }
    lines[1] = '✓ 2/4 生成引擎:自动 · ' + gen; flush();

    lines.push('3/4 配置对话与识图…'); flush();
    if(key){
      await api('/v1/providers', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name:'senseaudio', base_url: base, api_key: key, model: gen,
                              vision_model: vis, kind:'openai_compatible', verify_ssl: true})});
      loadProviders();
    }
    lines[2] = '✓ 3/4 对话:' + gen + ' · 识图:' + (vis || '(网关没有识图模型,图片打标改人工)'); flush();

    lines.push('4/4 完整连接测试(最多 2 分钟)…'); flush();
    const r = await api('/v1/agent/test', {method:'POST'});
    lines[3] = r.ok ? ('✓ 4/4 连接已验证'+(r.latency_ms?' · '+r.latency_ms+'ms':'')+' —— 现在拖入招标文件就能产真实标书')
                    : ('✗ 4/4 测试未通过:'+(r.error||''));
    flush();
    QK.key=''; S.s2Models = models.length ? models : S.s2Models;
    loadAgent();
  }catch(e){ lines.push('✗ 出错:'+(e&&e.message||'没连上本地引擎')); flush(); }
  QK.busy = false; bump();
}
export async function saveAgent(quiet){
  // 没连上引擎时必须抛错:静默 return 会让调用方(快速接入)以为存好了,配置里却还是上一个引擎
  if(!S.online){ if(!quiet) pmsg('本地引擎未连接'); throw new Error('本地引擎未连接,设置没能保存'); }
  const kind = AG.kind;
  const mode = AG.mode;
  await api('/v1/agent',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(agentPayload())});
  if(quiet) return;
  AG.msg = '✓ 已保存:'+({mock:'内置演示流程',s2:'自动',sowork:'SoWork(商汤)',claude:'Claude Code',codex:'Codex CLI',custom:'自定义命令'}[kind])
    +' · '+(mode==='workflow'?'Workflow 并行':'多子 agent 逐步')+' —— 新建任务即生效';
  bump();
  setTimeout(loadAgent, 1500);
}
