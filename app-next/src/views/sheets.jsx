// 视图 B 的弹层组:出件前检查 / 评分点覆盖 / 单章重写(预演 diff)/ 修改结果 / 产物预览。
// 数据路径逐字对应经典 renderCheck/repairJob/openCoverage/submitRewrite/doRedo/openPreview。
import React, { useEffect, useState } from 'react';
import { Modal, Input, Checkbox, Button } from 'antd';
import { S, ui, bump, api, select, errAction, presentProblem, refreshArts, loadPipeline, loadCoverage,
         covReasonHint, _friendlyText, _friendlyActionLabel } from '../core/index.js';
import { IS_WEB } from '../core/env.js';
import { net } from '../core/env.js';
import { mdHtml } from '../lib.js';
import { _chapterNodes, _fmtWords } from './Outline.jsx';

const DOT = { red: 'var(--red)', yellow: 'var(--amber)', green: 'var(--green)' };

/* ---------- 出件前检查(经典 renderCheck + repairJob) ---------- */
export function CheckSheet(){
  const open = !!(S.sheet && S.sheet.name === 'check');
  const [fixMsg, setFixMsg] = useState('');
  useEffect(() => { if(open) setFixMsg(''); }, [open]);
  const h = S.active ? S.health[S.active] : null;
  const gaps = h ? (h.gaps || []) : [];
  const canRepair = gaps.some(g => (g.actions || []).some(a => a.act === 'repair'));
  async function repairJob(){
    if(!S.active) return;
    setFixMsg('清洗中…');
    try{
      const r = await api('/v1/jobs/' + S.active + '/repair', { method: 'POST' });
      setFixMsg(r.fixed && r.fixed.length ? '✓ 已生成:' + r.fixed.join('、') : '未发现需要清洗的内容异常');
      await refreshArts(S.active); ui.render('rail');
    }catch(e){ setFixMsg('✗ 修复失败,请查看 engine.log'); }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={640} centered
      title={!h ? '还没到出件阶段' : (<span>{h.summary} <span className={'cklv ' + (h.level || '')}>{h.level === 'red' ? '不可交付' : '仅可作初稿'}</span></span>)}>
      {/* 每条只在后端给了可执行动作时才画按钮(经典同注释:假按钮比没有更糟) */}
      <div className="ckList">
        {gaps.map((g, i) => (
          <div className="lrow" key={i}>
            <span className="dot" style={{ background: DOT[g.level] || 'var(--amber)' }} />
            <div className="c"><span className="n">{_friendlyText(g.title)}</span><span className="s">{_friendlyText(g.detail)}</span></div>
            {(g.actions || []).length > 0 && (
              <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {(g.actions || []).map((a, ai) => <span key={ai} className="gap-act" data-eact={a.act} data-eparam={a.param || ''}
                  onClick={() => { ui.closeAll(); errAction(a.act, a.file || '', a.param || ''); }}>{_friendlyActionLabel(a.label)}</span>)}
              </span>
            )}
          </div>
        ))}
        {!gaps.length && h && <div className="outline-note">没有待处理项。</div>}
      </div>
      {canRepair && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
          <Button onClick={repairJob}>一键清洗内容异常</Button>
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>{fixMsg}</span>
        </div>
      )}
    </Modal>
  );
}

/* ---------- 评分点覆盖(经典 openCoverage + 补写应答派发) ---------- */
export function CoverageSheet(){
  const open = !!(S.sheet && S.sheet.name === 'coverage');
  const [busyIdx, setBusyIdx] = useState(-1);
  const cov = S.active ? S.coverage[S.active] : null;
  if(open && (!cov || !cov.available)){ /* openCoverage 入口已拦,防御兜底 */ }
  const un = cov ? (cov.items || []).filter(x => !x.covered) : [];
  const ok = cov ? (cov.items || []).filter(x => x.covered) : [];
  async function dispatch(i){
    const item = un[i];
    if(!item || !item.node_id || !S.active) return;
    setBusyIdx(i);
    try{
      const note = '补写评分点应答:' + item.requirement + (item.score && item.score !== '未知' ? '(分值 ' + item.score + ')' : '') + (item.gap ? ';需补齐:' + item.gap : '') + '。落位到本章合适位置,逐条对应评分办法。';
      const r = await api('/v1/jobs/' + S.active + '/chapters/' + encodeURIComponent(item.node_id) + '/rewrite',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      if(r && r.ok === false) throw new Error(r.error || '补写没能启动');
      ui.closeAll(); ui.toast('已开始补写「' + item.chapter + '」章的这条应答,其余章节不动');
      setTimeout(() => { loadPipeline(S.active); loadCoverage(S.active); }, 800);
    }catch(err){ setBusyIdx(-1); ui.toast(err && err.message || '补写没能启动,稍后重试'); }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={680} centered title="评分点覆盖">
      {cov && cov.available ? (
        <>
          <div className="covHead">评分点是评标专家打分的依据。已覆盖 <b>{cov.covered}/{cov.total}</b> 项——「已覆盖」= 规划无缺口 + 落到具体章节 + 该章节已写完。</div>
          <div className="covBar"><b style={{ width: (cov.total ? Math.round(cov.covered / cov.total * 100) : 0) + '%' }} /></div>
          <div className="covList">
            {un.length ? un.map((x, i) => (
              <div className="covitem" key={i}>
                <div className="ci2"><b>{x.requirement}</b>
                  <span>{[x.gap && ('缺口:' + x.gap), x.location && ('落位:' + x.location)].filter(Boolean).join(' · ') || '待落实'}</span></div>
                {x.score && x.score !== '未知' ? <span className="score">{x.score} 分</span> : null}
                {x.node_id
                  ? <button type="button" disabled={busyIdx === i} onClick={() => dispatch(i)}>{busyIdx === i ? '派发中…' : '补写应答'}</button>
                  : <span style={{ color: 'var(--faint)', fontSize: 11 }}>{covReasonHint(x)}</span>}
              </div>
            )) : <div className="outline-note">全部评分点都已覆盖。</div>}
            {ok.length > 0 && <>
              <div className="outline-note" style={{ marginTop: 4 }}>已覆盖 {ok.length} 项</div>
              {ok.slice(0, 60).map((x, i) => (
                <div className="covitem ok" key={'ok' + i}>
                  <div className="ci2"><b>{x.requirement}</b><span>{x.chapter || x.location || ''}</span></div>
                  <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>
                </div>
              ))}
            </>}
          </div>
        </>
      ) : <div className="outline-note">{(cov && cov.note) || '响应规划完成后这里会实时更新'}</div>}
    </Modal>
  );
}

/* ---------- 单章重写:预演 diff + 未覆盖评分点自动带入(生成效果提升①) ----------
   经典是一个「标题+空白输入框”的弹层;这里按路线一原型 v2 升级:先让用户看清
   「批的是具体会发生什么」,再把该章未覆盖的评分点列成可勾选项,勾中的自动
   拼进补充要求(走既有 rewrite note 通道,引擎无改动)。 */
export function RewriteSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'rewrite');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState({});
  useEffect(() => {
    if(open){
      setNote(''); setBusy(false);
      const init = {};
      gapsFor(sh.node).forEach((_, i) => { init[i] = true; });   // 默认全选:漏答的评分点正是重写最该补的
      setPicked(init);
    }
  }, [open]);
  function gapsFor(nodeId){
    const cov = S.active ? S.coverage[S.active] : null;
    return cov ? (cov.items || []).filter(x => !x.covered && x.node_id === nodeId) : [];
  }
  if(!open) return null;
  const nodes = _chapterNodes(S.active);
  const node = nodes.find(n => n.id === sh.node) || {};
  const arts = S.arts[S.active] || [];
  const out = (node.outputs && node.outputs[0]) || '';
  const art = arts.find(a => a.name === out);
  const words = art ? _fmtWords(art.size_kb) : '';
  const gaps = gapsFor(sh.node);
  const chosen = gaps.filter((_, i) => picked[i]);
  async function submit(){
    if(!S.active || !sh.node) return;
    setBusy(true);
    // 勾选的评分点拼成与「补写应答」同款措辞,追加在用户补充要求后面
    const gapLines = chosen.map(x => '补写评分点应答:' + x.requirement
      + (x.score && x.score !== '未知' ? '(分值 ' + x.score + ')' : '') + (x.gap ? ';需补齐:' + x.gap : ''));
    const full = [note.trim(), ...gapLines].filter(Boolean).join('\n');
    try{
      const r = await api('/v1/jobs/' + S.active + '/chapters/' + encodeURIComponent(sh.node) + '/rewrite',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: full }) });
      if(r && r.ok === false) throw new Error(r.error || '重写没能启动');
      ui.closeAll(); ui.toast('已开始重写「' + (sh.title || sh.node) + '」,其余章节不动');
      setTimeout(() => { loadPipeline(S.active); loadCoverage(S.active); }, 800);
    }catch(err){ setBusy(false); ui.toast(err && err.message || '重写没能启动,稍后重试'); }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} width={600} centered title={'重写本章:' + (sh.title || sh.node)}
      okText={busy ? '启动中…' : '开始重写'} okButtonProps={{ loading: busy }} onOk={submit} cancelText="取消">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="rw-diff">
          <div className="drow"><span className="dk">这一章</span><span>{node.title || sh.title || sh.node}{words ? ' · 当前 ' + words : ''} → 依据下方要求整章重写</span></div>
          <div className="drow keep"><span className="dk">其余章节</span><span>原样保留,不重跑</span></div>
          <div className="drow keep"><span className="dk">检查点</span><span>全程保留,重写失败可回退</span></div>
          <div className="drow"><span className="dk">完成后</span><span>自动重新汇总成册并跑质检</span></div>
        </div>
        {gaps.length > 0 && (
          <div className="rw-gaps">
            <div className="lbl2">这一章还有 {gaps.length} 个评分点没覆盖——勾中的会作为重写要求带进去</div>
            {gaps.map((x, i) => (
              <Checkbox key={i} checked={!!picked[i]} onChange={e => setPicked(p => ({ ...p, [i]: e.target.checked }))}>
                {x.requirement}{x.score && x.score !== '未知' ? '(' + x.score + ' 分)' : ''}{x.gap ? ' · 缺口:' + x.gap : ''}
              </Checkbox>
            ))}
          </div>
        )}
        <div>
          <div className="lbl2">补充要求(选填)</div>
          <Input.TextArea rows={4} autoFocus value={note} onChange={e => setNote(e.target.value)}
            placeholder="例:把实施进度改成 90 天;第二节补一段应急预案;引用素材库里的 XX 案例" />
        </div>
      </div>
    </Modal>
  );
}

/* ---------- 修改结果(整册修改,经典 openRevision/doRedo) ---------- */
export function RedoSheet(){
  const open = !!(S.sheet && S.sheet.name === 'redo');
  const [txt, setTxt] = useState('');
  useEffect(() => { if(open) setTxt(''); }, [open]);
  async function doRedo(){
    const t = txt.trim();
    if(!t){ ui.toast('先写清楚要修改哪一部分'); return; }
    ui.closeAll();
    try{
      let r;
      try{ r = await api('/v1/jobs/' + encodeURIComponent(S.active) + '/revisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: t }) }); }
      catch(_){ r = await api('/v1/jobs/' + encodeURIComponent(S.active) + '/redo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: t }) }); }
      if(r && r.job_id){ S.jobs = await api('/v1/jobs'); select(r.job_id); }
      else { S.processView[S.active] = true; ui.render('main'); }
      if(r && r.ok === false){ presentProblem({ level: 'error', title: '新版本没有启动', text: _friendlyText(r.error || '请检查任务状态后重试。'), detail: r.error || '', actions: [{ act: 'retry_revision', label: '重新填写' }] }); ui.toast('无法修改:' + (r.error || '')); }
      else ui.toast('新版本已开始生成');
    }catch(e){
      ui.toast('启动失败:任务可能正在运行,请先停止再试');
      presentProblem({ level: 'error', title: '新版本没有启动', text: '原结果和修改要求都没有被覆盖,请检查任务状态后重试。', detail: e && e.message || '', actions: [{ act: 'retry_revision', label: '重新填写' }, { act: 'diagnose', label: '一键诊断' }] });
    }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} width={540} centered title="修改结果:出一个新版本"
      okText="开始修改" onOk={doRedo} cancelText="取消">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="rw-diff">
          <div className="drow"><span className="dk">会发生什么</span><span>按你的要求出一个新版本任务,原任务与文件全部保留</span></div>
        </div>
        <Input.TextArea rows={5} autoFocus value={txt} onChange={e => setTxt(e.target.value)}
          placeholder="写清楚要修改哪一部分、改成什么样。例:第三章售后响应时间改为 2 小时;整册把公司名统一为 XX 科技" />
      </div>
    </Modal>
  );
}

/* ---------- 产物预览:Word 视图/原文视图(经典 openPreview/renderPvBody) ---------- */
export function PreviewSheet(){
  const sh = S.sheet; const open = !!(sh && sh.name === 'preview');
  const [state, setState] = useState({ text: '', status: '加载中…', md: false });
  useEffect(() => {
    if(!open) return;
    let alive = true;
    (async () => {
      let url = sh.url || '';
      setState({ text: '', status: '加载中…', md: false });
      if(!url && S.online && S.active){          // 事件先到、清单后到:按名字现查一次
        try{ const list = await api('/v1/jobs/' + S.active + '/artifacts');
          const hit = list.find(a => a.name === sh.pv); if(hit) url = hit.url; }catch(e){}
      }
      if(!url){ if(alive) setState({ text: '', status: '（演示模式：连接本地服务后可预览真实产出）', md: false }); return; }
      try{
        const r = await fetch(net.API + url); const t = (await r.text()).slice(0, 60000);
        if(!alive) return;
        if(!t) setState({ text: '', status: '(空文件)', md: false });
        else setState({ text: t, status: '', md: /\.md$/i.test(sh.pv) });
      }catch(e){ if(alive) setState({ text: '', status: '预览失败，请点击右上角“' + (IS_WEB ? '下载' : '打开') + '”查看文件', md: false }); }
    })();
    return () => { alive = false; };
  }, [open, open && sh.pv]);
  const word = (S.pvPref || 'word') === 'word';
  return (
    <Modal open={open} onCancel={ui.closeAll} width={760} centered
      title={open ? sh.pv : ''} footer={null}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {state.md && (
          <div className="midtabs" style={{ marginTop: 0 }}>
            <button type="button" className={word ? 'on' : ''} onClick={() => { S.pvPref = 'word'; bump(); }}>Word 视图</button>
            <button type="button" className={!word ? 'on' : ''} onClick={() => { S.pvPref = 'md'; bump(); }}>原文</button>
          </div>
        )}
        <span style={{ flex: 1 }} />
        <Button size="small" onClick={() => { import('./artifacts.js').then(m => m.openArtifact(sh.pv, sh.url || '')); }}>{IS_WEB ? '下载' : '打开'}</Button>
      </div>
      <div className="pvBody">
        {state.status ? state.status : state.md
          ? (word
            ? <><div className="wordview" dangerouslySetInnerHTML={{ __html: mdHtml(state.text) }} />
                <div style={{ color: 'var(--faint)', font: '400 10.5px/1.6 inherit', padding: '8px 2px 2px' }}>版式为导出同款示意（宋体 · 居中标题 · 实线表格），最终以导出 Word 为准。</div></>
            : <div dangerouslySetInnerHTML={{ __html: mdHtml(state.text) }} />)
          : <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', font: '400 12px/1.7 inherit', margin: 0 }}>{state.text}</pre>}
      </div>
    </Modal>
  );
}
