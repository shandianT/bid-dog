// 视图 B 的弹层组:出件前检查 / 评分点覆盖 / 单章重写(预演 diff)/ 修改结果 / 产物预览。
// 数据路径逐字对应经典 renderCheck/repairJob/openCoverage/submitRewrite/doRedo/openPreview。
import React, { useEffect, useState } from 'react';
import { Modal, Input, Checkbox, Button, List, Progress, Tag, Alert, Empty, Segmented } from 'antd';
import { S, ui, bump, api, select, errAction, presentProblem, refreshArts, loadPipeline, loadCoverage, jobState,
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
      title={<span id="ckTitle">{!h ? '还没到出件阶段' : h.summary}</span>}>
      {h && <div id="ckLv" className={'cklv ' + (h.level || '')}>{h.level === 'red' ? '不可交付' : '仅可作初稿'}</div>}
      {/* 每条只在后端给了可执行动作时才画按钮(经典同注释:假按钮比没有更糟) */}
      <div className="ckList" id="check"><div id="ckList" style={{display:'contents'}}>
        <List split={false} dataSource={gaps} locale={{ emptyText: h ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待处理项" /> : <span /> }}
          renderItem={g => (
            <List.Item className="lrow"
              actions={(g.actions || []).map((a, ai) => (
                <Button key={ai} size="small" type="link" className="gap-act" data-eact={a.act} data-eparam={a.param || ''}
                  onClick={() => { ui.closeAll(); errAction(a.act, a.file || '', a.param || ''); }}>{_friendlyActionLabel(a.label)}</Button>
              ))}>
              <List.Item.Meta
                avatar={<span className="dot" style={{ background: DOT[g.level] || 'var(--amber)' }} />}
                title={<span className="n">{_friendlyText(g.title)}</span>}
                description={<span className="s">{_friendlyText(g.detail)}</span>} />
            </List.Item>
          )} />
      </div></div>
      {canRepair && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
          <Button onClick={repairJob}>一键清洗内容异常</Button>
          <span style={{ color: 'var(--dim)', fontSize: 12 }}>{fixMsg}</span>
        </div>
      )}
    </Modal>
  );
}

/* ---------- 评分点覆盖(经典 openCoverage + 补写应答派发) ----------
   经典只能一条一条点「补写应答」,而引擎的单章重写会把整单锁成 running:第二次
   点必然被 admission 挡回来。所以一章漏了五条,用户实际只能补一条、等几分钟、
   再补一条——而且后一次重写会覆盖前一次的稿子。这里按章分组,一章一次把该章
   所有漏项拼进同一条补充要求下发,既省事也是唯一正确的批法。 */

// 单条漏项 → 补充要求里的一行。措辞与经典单条派发一致,批量只是把它们列成条目。
export function covGapLine(x){
  return x.requirement
    + (x.score && x.score !== '未知' ? '(分值 ' + x.score + ')' : '')
    + (x.gap ? ';需补齐:' + x.gap : '');
}

// 引擎侧 note 上限 2000(generation_pipeline.REWRITE_NOTE_MAX),超了会被从句子中间
// 截断——截断的补充要求比没有更危险。所以这里按整行装,装不下的明说这次先补几条。
export const COV_NOTE_MAX = 2000;
export function buildCovNote(items){
  const head = '补写以下评分点应答,逐条落位到本章合适位置,按评分办法的口径逐项对应:\n';
  const tail = '\n其余章节不动。';
  const lines = [], budget = COV_NOTE_MAX - head.length - tail.length;
  let used = 0;
  for(const x of items){
    const line = (lines.length + 1) + '. ' + covGapLine(x);
    if(used + line.length + 1 > budget) break;
    lines.push(line); used += line.length + 1;
  }
  return { note: head + lines.join('\n') + tail, fitted: lines.length };
}

export function CoverageSheet(){
  const open = !!(S.sheet && S.sheet.name === 'coverage');
  const [busy, setBusy] = useState('');        // 正在派发的 node_id(或 'i:<下标>' 单条)
  const [sent, setSent] = useState('');        // 本次面板里已派发的章节,给出「已下发」而不是让人重复点
  const [drop, setDrop] = useState(new Set()); // 用户手动摘掉的漏项(默认全选)
  useEffect(() => { if(open){ setBusy(''); setSent(''); setDrop(new Set()); } }, [open]);
  const cov = S.active ? S.coverage[S.active] : null;
  if(open && (!cov || !cov.available)){ /* openCoverage 入口已拦,防御兜底 */ }
  // 本地关键词索引只是候选:没有一条落到章节,派不出补写,也不该显示成「已覆盖 0/N」
  const covLocal = !!(cov && cov.available && cov.plan_source === 'local');
  const planNotes = (cov && cov.plan_notes) || [];
  const un = cov ? (cov.items || []).filter(x => !x.covered) : [];
  const ok = cov ? (cov.items || []).filter(x => x.covered) : [];

  // 按章分组,保持 un 的原始顺序;没落到章节的单独一拨(它们派不出去,只能走对话)
  const groups = [], byNode = new Map(), orphans = [];
  un.forEach((x, i) => {
    const row = { x, i };
    if(!x.node_id){ orphans.push(row); return; }
    let g = byNode.get(x.node_id);
    if(!g){ g = { node_id: x.node_id, chapter: x.chapter || x.location || '本章', rows: [] }; byNode.set(x.node_id, g); groups.push(g); }
    g.rows.push(row);
  });

  const job = S.active ? (S.jobs || []).find(x => x.job_id === S.active) : null;
  const running = !!(job && jobState(job) === 'running');
  // 引擎把整单锁成 running 才重写,所以同一时间只能有一章在补——这一点必须写在脸上,
  // 而不是等用户点了第二章再弹一句「这一单正在生成」。
  const lockedReason = running ? '这一单正在生成,等它停下再补写' : (sent ? '引擎一次只重写一章,等这章跑完再补下一章' : '');

  async function dispatch(key, rows, chapter){
    if(!S.active || !rows.length) return;
    const picked = rows.filter(r => !drop.has(r.i)).map(r => r.x);
    if(!picked.length){ ui.toast('这一章的漏项都被你摘掉了,没有可补写的内容'); return; }
    const node_id = picked[0].node_id;
    const built = picked.length > 1
      ? buildCovNote(picked)
      : { note: '补写评分点应答:' + covGapLine(picked[0]) + '。落位到本章合适位置,逐条对应评分办法。', fitted: 1 };
    setBusy(key);
    try{
      const r = await api('/v1/jobs/' + S.active + '/chapters/' + encodeURIComponent(node_id) + '/rewrite',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: built.note }) });
      if(r && r.ok === false) throw new Error(r.error || '补写没能启动');
      setBusy(''); setSent(node_id);
      const missed = picked.length - built.fitted;
      ui.toast('已开始补写「' + chapter + '」章的 ' + built.fitted + ' 条应答,其余章节不动'
        + (missed > 0 ? ';这一章漏项太多,还剩 ' + missed + ' 条等这轮跑完再补' : ''));
      setTimeout(() => { loadPipeline(S.active); loadCoverage(S.active); }, 800);
    }catch(err){ setBusy(''); ui.toast(err && err.message || '补写没能启动,稍后重试'); }
  }

  const toggle = i => setDrop(prev => { const n = new Set(prev); if(n.has(i)) n.delete(i); else n.add(i); return n; });

  // 一条漏项一行。行本身的结构(.covitem + 「补写应答」按钮)是既有契约钉死的,不动。
  const renderRow = ({ x, i }, groupable) => (
    <List.Item className="covitem" key={i}
      actions={[
        x.score && x.score !== '未知' ? <Tag key="s" color="warning" bordered={false} className="score">{x.score} 分</Tag> : <span key="s" />,
        x.node_id
          ? <Button key="b" size="small" data-cov={i} loading={busy === ('i:' + i)}
              disabled={!!lockedReason || busy !== ''} title={lockedReason}
              onClick={() => dispatch('i:' + i, [{ x, i }], x.chapter || '本章')}>补写应答</Button>
          : <span key="b" style={{ color: 'var(--faint)', fontSize: 11 }}>{covLocal ? '候选项,待模型核对落位' : covReasonHint(x)}</span>,
      ]}>
      <List.Item.Meta
        avatar={groupable ? <Checkbox checked={!drop.has(i)} onChange={() => toggle(i)} /> : null}
        title={<b>{x.requirement}</b>}
        description={[x.gap && ('缺口:' + x.gap), x.location && ('落位:' + x.location)].filter(Boolean).join(' · ') || '待落实'} />
    </List.Item>
  );

  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={680} centered title="评分点覆盖">
      <div id="covSheet">
      {cov && cov.available ? (
        <>
          {covLocal && (
            <Alert type="warning" showIcon className="covlocal" style={{ marginBottom: 10 }}
              message="这份评分点清单来自本地关键词索引,尚未经模型核对"
              description="候选项还没落到章节,暂不能派发补写;模型核对成功后会自动更新。核对为什么没成功,看「运行日志」里「响应规划」那一行。" />
          )}
          {!covLocal && planNotes.length > 0 && (
            <Alert type="info" showIcon className="covnote" style={{ marginBottom: 10 }} message={planNotes.join(';')} />
          )}
          <div className="covHead" id="covHead">{covLocal
            ? <>识别到 <b>{cov.total}</b> 处评分相关条款(候选)。这是按关键词从招标文件里挑出来的原文行,先对一眼评分办法有没有被读到。</>
            : <>评分点是评标专家打分的依据。已覆盖 <b>{cov.covered}/{cov.total}</b> 项——「已覆盖」= 规划无缺口 + 落到具体章节 + 该章节已写完。</>}</div>
          {!covLocal && <Progress className="covBar" percent={cov.total ? Math.round(cov.covered / cov.total * 100) : 0}
            showInfo={false} strokeColor="var(--blue)" trailColor="var(--line-soft)" id="covBarFill" />}
          <div className="covList" id="covList">
            {un.length ? (
              <>
                {groups.map(g => {
                  const many = g.rows.length > 1;
                  const picked = g.rows.filter(r => !drop.has(r.i)).length;
                  const done = sent === g.node_id;
                  return (
                    <div className="covgroup" key={g.node_id} data-covgroup={g.node_id}>
                      <div className="covgroup-head">
                        <span className="cg-name">{g.chapter}</span>
                        <span className="cg-n num">漏 {g.rows.length} 条</span>
                        <span style={{ flex: 1 }} />
                        {done ? <Tag color="processing" bordered={false}>已下发,正在补写</Tag>
                          : many ? (
                            <Button type="primary" size="small" data-covbatch={g.node_id}
                              loading={busy === g.node_id} disabled={!!lockedReason || busy !== '' || !picked}
                              title={lockedReason}
                              onClick={() => dispatch(g.node_id, g.rows, g.chapter)}>
                              一起补写这 {picked} 条
                            </Button>
                          ) : null}
                      </div>
                      <List split={false} dataSource={g.rows} rowKey={r => r.i} renderItem={r => renderRow(r, many)} />
                    </div>
                  );
                })}
                {orphans.length > 0 && (
                  <div className="covgroup" data-covgroup="">
                    {groups.length > 0 && !covLocal && <div className="covgroup-head"><span className="cg-name">还没落到章节</span>
                      <span className="cg-n num">{orphans.length} 条</span></div>}
                    <List split={false} dataSource={orphans} rowKey={r => r.i} renderItem={r => renderRow(r, false)} />
                  </div>
                )}
                {lockedReason && <div className="outline-note" style={{ marginTop: 6 }}>{lockedReason}</div>}
              </>
            ) : <div className="outline-note">全部评分点都已覆盖。</div>}
            {ok.length > 0 && <>
              <div className="outline-note" style={{ marginTop: 4 }}>已覆盖 {ok.length} 项</div>
              <List split={false} dataSource={ok.slice(0, 60)} renderItem={x => (
                <List.Item className="covitem ok" actions={[<span key="c" style={{ color: 'var(--green)' }}>✓</span>]}>
                  <List.Item.Meta title={<b>{x.requirement}</b>} description={x.chapter || x.location || ''} />
                </List.Item>
              )} />
            </>}
          </div>
        </>
      ) : <div className="outline-note">{(cov && cov.note) || '响应规划完成后这里会实时更新'}</div>}
      </div>
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
    <Modal open={open} onCancel={ui.closeAll} width={600} centered
      title={<span id="rwTitle">{'重写本章:' + (sh.title || sh.node)}</span>}
      okText={busy ? '启动中…' : '开始重写'} okButtonProps={{ loading: busy, id: 'rwGo' }} onOk={submit} cancelText="取消">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} id="rwSheet">
        <div style={{ font: '400 12px/1.6 inherit', color: 'var(--dim)' }}>只重做这一章,其余章节锁定不动;旧稿会存入「历史版本」文件夹,可随时找回。汇总和最终 Word 会自动跟着更新。</div>
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
          <Input.TextArea id="rwNote" rows={4} autoFocus value={note} onChange={e => setNote(e.target.value)}
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
          <Segmented size="small" value={word ? 'word' : 'md'}
            onChange={v => { S.pvPref = v; bump(); }}
            options={[{ label: 'Word 视图', value: 'word' }, { label: '原文', value: 'md' }]} />
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
