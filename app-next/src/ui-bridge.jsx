// ui 适配器的 React 宿主:core 里 ui.xxx() 的真实实现。
// 弹层遵循经典约定:同一时刻一层(S.sheet),closeAll() 全关;确认框返回 Promise<boolean>。
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input } from 'antd';
import { S, ui, bump, api } from './core/index.js';
import { applyProjectMoveWith } from './views/project-move.js';
import { esc } from './lib.js';

let confirmResolve = null;

export function installUiBridge(){
  ui.closeAll = () => {
    if(confirmResolve){ confirmResolve(false); confirmResolve = null; }
    S.sheet = null; bump();
  };
  ui.askConfirm = (title, desc, danger) => new Promise(resolve => {
    if(confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
    S.sheet = { name:'confirm', title, desc, danger }; bump();
  });
  ui.openSheet = name => { S.sheet = { name }; bump(); };
  ui.openProjectMove = ids => {
    S.projectTargetIds = (ids||[]).slice();
    S.sheet = { name:'project' }; bump();
  };
  ui.showDiagnosticDetail = detail => { S.sheet = { name:'diagnostic', detail:String(detail||'') }; bump(); };
  ui.runDiagnostics = () => { S.sheet = { name:'diagnostic', detail:(S.problems[S.active||'_global']||S.problems._global||{}).detail||'', run:true }; bump(); };
  ui.openLog = () => { S.sheet = { name:'log' }; bump(); };
  // 视图 B/D 落地前的占位:入口保留、当面说明,不做死按钮。
  const migrating = label => () => { S.sheet = { name:'migrating', label }; bump(); };
  ui.openCheck = migrating('出件前检查');
  ui.openRevision = migrating('修改结果');
  ui.openRedo = migrating('修改结果');
  ui.repairJob = migrating('一键修复');
  ui.downloadDiagnosticBundle = migrating('导出诊断包');
  ui.openUpdatePanel = migrating('更新面板');
  ui.openArtifact = async (name, url) => { ui.toast('文件打开在迁移中:' + (name||'')); };
  ui.openJobFolder = async () => { ui.toast('打开任务文件夹在迁移中'); };
}

function cfDone(v){ const r = confirmResolve; confirmResolve = null; S.sheet = null; bump(); if(r) r(v); }

export function ConfirmModal(){
  const sh = S.sheet;
  const open = !!(sh && sh.name === 'confirm');
  return (
    <Modal open={open} onCancel={() => cfDone(false)} onOk={() => cfDone(true)}
      okText="确认" cancelText="取消" width={430} centered
      okButtonProps={sh && sh.danger ? { danger: true } : undefined}
      title={open ? sh.title : ''} data-sheet="confirm">
      <div style={{ color:'var(--ant-color-text-secondary,#54575f)', whiteSpace:'pre-line' }}>{open ? sh.desc : ''}</div>
    </Modal>
  );
}

export function ProjectSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'project');
  const [name, setName] = useState('');
  useEffect(() => { if(open) setName(''); }, [open]);
  const names = [...new Set((S.jobs||[]).map(j=>j.project_id).filter(Boolean))];
  return (
    <Modal open={open} onCancel={ui.closeAll} onOk={() => applyProjectMoveWith(name)}
      okText="归入项目" cancelText="取消" width={430} centered title="归入项目">
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <Input value={name} onChange={e=>setName(e.target.value)} placeholder="项目名称(新建或选择已有)"
          list="projectChoices" autoFocus onPressEnter={() => applyProjectMoveWith(name)} />
        <datalist id="projectChoices">{names.map(n => <option key={n} value={n} />)}</datalist>
        {names.length ? <div style={{ color:'#8b8f98', font:'400 12px/1.6 inherit' }}>已有项目:{names.join('、')}</div> : null}
      </div>
    </Modal>
  );
}

export function LogSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'log');
  const [state, setState] = useState({ text:'读取中…', skill:null });
  useEffect(() => {
    if(!open || !S.active) return;
    let alive = true;
    setState({ text:'读取中…', skill:null });
    api('/v1/jobs/' + S.active + '/log').then(r => { if(alive) setState({ text:r.log || '(空)', skill:r }); })
      .catch(() => { if(alive) setState({ text:'读取失败', skill:null }); });
    return () => { alive = false; };
  }, [open, open && S.active]);
  const r = state.skill || {};
  const skillLine = !state.skill ? null
    : (r.skill_state==='verified' || (!r.skill_state && r.skill_used))
      ? <span style={{color:'#22a06b'}}>✓ 已核验技能包运行证据:{(r.hits||[]).join('、')}</span>
      : r.skill_state==='unverifiable'
        ? <span style={{color:'#b8860b'}}>△ 技能指令已随任务加载,但本轮无法核验实际读取 — {r.why||''}<br/>这不等于未使用;部分生成方式不会返回完整过程记录。请以响应矩阵、交付检查和 Word 质检结果为准。</span>
        : <span style={{color:'#d4380d'}}>✗ 技能规则未成功加载 — {r.why||''}<br/>请先运行“一键诊断”;如仍未恢复,再到高级设置检查技能包路径和注入状态。</span>;
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={720} centered title="运行日志">
      <div id="logSkill" style={{ font:'400 12px/1.7 inherit', marginBottom:8 }}>{skillLine}</div>
      <pre id="logBody" style={{ font:"400 12px/1.7 'SF Mono',Menlo,Consolas,monospace", whiteSpace:'pre-wrap',
        wordBreak:'break-all', maxHeight:'56vh', overflow:'auto', background:'#f7f8fa',
        border:'1px solid #eceef2', borderRadius:10, padding:'10px 12px' }}>{state.text}</pre>
    </Modal>
  );
}

// 诊断弹层:逐字对应经典 runDiagnostics 的对话流程(检查→逐项结论→技术详情),
// repairMode(引擎离线)下走桌面修复命令。
export function DiagnosticSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'diagnostic');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');
  const ran = useRef(false);
  useEffect(() => { if(open){ setOut(''); setDetail(sh.detail||''); ran.current = false; if(sh.run) runNow(); } }, [open]);
  async function repairFromDesktop(setText){
    const invoke = typeof window!=='undefined' && window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if(typeof invoke !== 'function'){
      setText('当前页面没有桌面修复权限。\n请从“应用程序”启动中标狗,不要直接打开 index.html。'); return false;
    }
    const r = await invoke('repair_local_engine');
    setText((r.ok?'✓ ':'✗ ')+(r.message||'修复已执行'));
    setDetail(r.detail||JSON.stringify(r,null,2));
    return !!r.ok;
  }
  async function runNow(){
    if(busy) return;
    const repairMode = S.engineOffline === true;
    setBusy(true); setOut(repairMode ? '正在检查并修复本地引擎…' : '正在检查连接与当前任务…');
    try{
      if(repairMode){ await repairFromDesktop(setOut); return; }
      const r = await api('/v1/diagnostics', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ job_id: S.active || null }) });
      const checks = Array.isArray(r.checks) ? r.checks : (Array.isArray(r.items) ? r.items : []);
      const sym = x => { const s=String(x.status||x.state||(x.ok===true?'pass':x.ok===false?'fail':'')).toLowerCase();
        return ['pass','passed','ok','ready','success','green'].includes(s)?'✓':['warning','warn','attention','yellow'].includes(s)?'△':['fail','failed','error','red','missing'].includes(s)?'✗':'·'; };
      const lines = checks.map(x => sym(x)+' '+(x.label||x.name||'检查项')+((x.summary||x.message)?':'+(x.summary||x.message):''));
      const verdict = (r.job && r.job.verdict) || {};
      if(verdict.suggestion) lines.push('💡 '+verdict.suggestion);
      const headline = r.ok===false ? '发现需要修复的问题,请按失败项处理。' : '';
      setOut((headline?headline+'\n':'')+(lines.length?lines.join('\n'):(r.summary||r.message||(r.ok===false?'✗ 诊断未通过':'✓ 连接与任务状态正常'))));
      setDetail(r.technical_detail||r.detail||JSON.stringify(r,null,2));
    }catch(e){
      try{
        const h = await api('/v1/health');
        setOut('✓ 本地服务已连接\n△ 完整诊断暂不可用,请更新应用后重试');
        setDetail(JSON.stringify(h,null,2));
      }catch(_){
        S.online = false; setOut('本地服务没有响应,正在尝试安全重启…');
        await repairFromDesktop(setOut);
      }
    }finally{ setBusy(false); }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} width={640} centered title="连接与任务诊断"
      okText={busy ? (S.engineOffline?'修复中…':'诊断中…') : (S.engineOffline?'检查并修复':'开始诊断')}
      okButtonProps={{ loading:busy }} onOk={runNow} cancelText="关闭">
      <pre id="diagnosticStatus" style={{ whiteSpace:'pre-wrap', font:'400 12.5px/1.8 inherit', minHeight:40 }}>{out || '点「开始诊断」检查连接、引擎与当前任务。'}</pre>
      {detail ? <details id="diagnosticDetailWrap"><summary style={{cursor:'pointer',color:'#8b8f98'}}>技术详情</summary>
        <pre id="diagnosticDetail" style={{ whiteSpace:'pre-wrap', wordBreak:'break-all', font:"400 11.5px/1.7 'SF Mono',Menlo,Consolas,monospace", maxHeight:'32vh', overflow:'auto', background:'#f7f8fa', borderRadius:8, padding:'8px 10px' }}>{detail}</pre>
      </details> : null}
    </Modal>
  );
}

export function MigratingSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'migrating');
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={430} centered title={open ? sh.label : ''}>
      <div style={{ color:'#54575f', lineHeight:1.8 }}>
        这个面板正在迁移到新界面(按 PARITY.md 的顺序推进),很快可用。<br/>
        着急的话,当前发布版(经典界面)里此功能完整可用。
      </div>
    </Modal>
  );
}

export function Toast(){
  const [, force] = useState(0);
  const msg = S.toastMsg;
  useEffect(() => {
    if(!msg) return;
    const t = setTimeout(() => { if(S.toastMsg === msg){ S.toastMsg = null; bump(); } }, 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return <div id="toast" className={msg ? 'show' : ''}>{msg ? msg.text : ''}</div>;
}
