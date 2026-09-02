// 任务头部:标题/徽章/副题/进度条/动作(暂停·停止·修改·从断点继续·开始·日志·交付结果·覆盖·出件前检查)。
// 全部判定公式逐字对应经典 renderHead(含 PR #10 的「待处理」徽章与「Word 已生成」lead)。
import React from 'react';
import { Tag, Button, Progress, Tooltip, Dropdown } from 'antd';
import { PauseOutlined, CaretRightOutlined, ReloadOutlined, FileTextOutlined,
         SafetyCertificateOutlined, StopOutlined, ColumnWidthOutlined, EllipsisOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { S, ui, jobState, publicTaskState, taskPresentation, taskCapabilities, wordPresence,
         completionGate, deliveryDeadEnd, verdict, timing, fmtDur, knownStep, PUBLIC_TASK_LABELS,
         resumeJob, togglePause, stopJob, deliveryViewModel } from '../core/index.js';
import { startStaged } from './newjob-core.js';

const PauseIcon = ({ paused }) => paused ? <CaretRightOutlined /> : <PauseOutlined />;

export function headModel(){
  const p = S.prog[S.active] || {};
  const j = S.jobs.find(x => x.job_id === S.active);
  const st = j ? jobState(j) : (p.pct >= 100 ? 'done' : 'running');
  const t = timing(S.active);
  const state = j ? publicTaskState(j) : (p.pct >= 100 ? 'completed' : 'generating');
  const present = taskPresentation(Object.assign({}, j || {}, (!j || !j.current_action) && p.stage ? { current_action: p.stage } : {}));
  const caps = taskCapabilities(j || { state: st, can: ['pause', 'stop'] });
  const word = wordPresence(S.arts[S.active], S.artsLoaded[S.active], j && j.has_word);
  const delivery = completionGate(st, p.pct, word);
  const missingWord = delivery.missingWord || (state === 'failed' && word === 'missing' && deliveryDeadEnd(j));
  if(st === 'paused') S.paused[S.active] = true;
  return { p, j, st, t, state, present, caps, word, delivery, missingWord };
}


export default function Head(){
  if(!S.active) return null;
  const { p, j, st, t, state, present, caps, word, delivery, missingWord } = headModel();
  const done = delivery.complete;
  const vd = deliveryViewModel(j || {}, S.arts[S.active] || []);
  const deliverable = !!(j && vd.primary && (state === 'completed' || state === 'needs_input'));
  const showResult = deliverable && S.processView[S.active] !== true;
  const cov = S.coverage[S.active];
  const hasParsed = (S.arts[S.active] || []).some(a => a.name === '招标文件_解析版.md');

  // 徽章:PR #10——出了整册 Word 的 failed 不是失败,是待处理
  let badge;
  const Badge = ({ cls, children }) => (
    <Tag bordered={false} id="hBadge" className={'badge ' + cls} icon={<span className="bdot" />}>{children}</Tag>
  );
  if(missingWord) badge = <Badge cls="bad">没出 Word，未完成</Badge>;
  else if(state === 'failed' && word === 'ready') badge = <Badge cls="warn pending">待处理</Badge>;   // 独立色阶(紫),不和「需要你确认」撞色
  else {
    const cls = { preparing: 'none', generating: 'none', needs_input: 'warn', completed: 'ok', failed: 'bad' }[state] || 'none';
    badge = <Badge cls={cls}>{PUBLIC_TASK_LABELS[state] || '未完成'}</Badge>;
  }

  // 副题只说「接下来该做什么」:状态由徽章说,进度与计时由右栏说,三处不再互相复读或打架。
  // (以前副题直接放引擎的 current_action,重开应用后它还写着「已停止」,徽章却说「需要你确认」。)
  const chip = S.chips[S.active];
  let lead;
  if(state === 'failed' && word === 'ready'){
    // PR #10——出了件先说出了件,再说还差什么
    const open = ((S.health[S.active] || {}).gaps || []).filter(g => g.level !== 'green').length;
    lead = open ? ('Word 已生成 · 提交前需处理 ' + open + ' 项') : 'Word 已生成 · 质检未通过,请看出件前检查';
  }
  else if(state === 'needs_input') lead = (chip && chip.kind === 'confirm_parse') ? '解析结果等你确认,确认后开始撰写'
    : chip ? '有一个问题等你回答,在「对话」里' : '等待你的操作';
  else if(state === 'preparing') lead = '材料已就位,点「开始生成」';
  else if(state === 'completed') lead = 'Word 已生成 · 请人工复核后提交';
  else if(state === 'failed') lead = caps.resume ? '中途停下,已完成的内容都保住了,可从断点继续' : present.currentAction;
  else lead = present.currentAction;   // 生成中:正在做什么
  const parts = [lead];
  if(state === 'generating' || state === 'needs_input') parts.push('最后活动 ' + present.lastActivity);
  if(state === 'generating' && present.eta && present.eta !== '—') parts.push(present.eta);
  if(state === 'generating' && t.elapsed && j && j.elapsed_seconds == null && j.elapsed == null) parts.push('已用 ' + fmtDur(t.elapsed));

  // 顶栏只有一颗蓝色主按钮,按状态选:还没开始 → 开始生成;出了件 → 交付结果;等确认 → 查看待确认项;
  // 停了能续 → 从断点继续;其余 → 出件前检查 / 查看未完成原因。其它按钮一律灰底。
  const primaryKey = (j && (j.staged || state === 'preparing')) ? 'start'
    : (deliverable && !showResult) ? 'result'
    : state === 'needs_input' ? 'act'
    : (state === 'failed' && !missingWord && word !== 'ready' && caps.resume) ? 'resume'
    : (state === 'completed' || state === 'failed') ? 'act' : '';

  // 进度条:重开应用后 SSE 的 pct 是 0,但检查点仍在;取两者较大值,进度条才不会凭空清零。
  const cpPct = Math.round(knownStep(j, p, 12) / 12 * 100);
  const barPct = Math.max(Number(p.pct) || 0, Number(j && j.pct) || 0, delivery.complete ? 0 : cpPct);
  const barW = (missingWord || delivery.checkingWord ? Math.min(barPct, 99) : barPct) + '%';

  return (
    <div className="head" id="head"><div className="hwrap">
      <div className="ht">
        <h1 id="hTitle">{(j && j.name) || S.active}</h1>
        <div className="sub" id="hSub">{parts.join(' · ')}</div>
        <Progress percent={parseFloat(barW)} showInfo={false} size={['100%', 4]}
          strokeColor="var(--blue)" trailColor="var(--line-soft)" className="hbar" id="hBar" />
      </div>
      {badge}
      {state === 'generating' && S.online && (
        <Button shape="circle" id="pauseBtn" className="iconbtn" aria-disabled={caps.pause ? 'false' : 'true'}
          style={{ opacity: caps.pause ? '' : 0.45 }}
          title={caps.pause ? (S.paused[S.active] ? '继续' : '暂停') : caps.pauseReason}
          icon={<PauseIcon paused={S.paused[S.active]} />}
          onClick={caps.pause ? togglePause : () => ui.toast(caps.pauseReason)} />
      )}
      {S.online && caps.stop && (state === 'generating' || st === 'paused') &&
        <Button id="stopBtn" className="pill" icon={<StopOutlined />} onClick={stopJob}>停止</Button>}
      {(state === 'completed' || state === 'failed' || state === 'needs_input') && S.online &&
        <Button id="redoBtn" className="pill" icon={<ReloadOutlined />}
          title="对已生成的结果提修改要求,出一个新版本" onClick={() => ui.openRedo()}>修改结果</Button>}
      {S.online && caps.resume &&
        <Button id="resumeBtn" type={primaryKey === 'resume' ? 'primary' : 'default'}
          className={'pill' + (primaryKey === 'resume' ? ' primary' : '')} icon={<CaretRightOutlined />}
          title="从上次中断的检查点接着往下跑,已完成内容不重写" onClick={resumeJob}>从断点继续</Button>}
      {j && (j.staged || state === 'preparing') && !S._startBusy &&
        <Button type="primary" id="startBtn" className="pill on" icon={<CaretRightOutlined />} onClick={startStaged}>开始生成</Button>}
      {deliverable && !showResult &&
        <Button type="primary" id="resultTabBtn" className="pill primary"
          onClick={() => { S.processView[S.active] = false; ui.render('main'); }}>交付结果</Button>}
      <Button id="hAct" icon={<SafetyCertificateOutlined />}
        type={primaryKey === 'act' ? 'primary' : 'default'}
        className={'pill' + (primaryKey === 'act' ? ' primary' : '')}
        onClick={() => ui.openCheck()}>
        {missingWord ? '查看未完成原因' : (state === 'completed' || state === 'needs_input' ? '查看待确认项' : '出件前检查')}</Button>
      {/* 次要动作收进「···」:顶栏只留当前状态真正要按的那几颗,不再换行 */}
      <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [
          { key: 'log', icon: <FileTextOutlined />, label: <span id="logBtn">运行日志</span> },
          { key: 'compare', icon: <ColumnWidthOutlined />, disabled: !hasParsed,
            label: <span id="compareBtn" title="左招标原文、右标书章节,点评分点两边同时定位">对照阅读</span> },
          { key: 'folder', icon: <FolderOpenOutlined />, label: '任务文件夹' },
        ], onClick: ({ key }) => { if(key === 'log') ui.openLog(); else if(key === 'compare') ui.openSheet('compare'); else ui.openJobFolder(); } }}>
        <Button id="moreBtn" className="pill" icon={<EllipsisOutlined />} title="运行日志 · 对照阅读 · 任务文件夹" />
      </Dropdown>
    </div></div>
  );
}
