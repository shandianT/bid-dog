// 右栏:进度(刻度条+当前步语义)/ 已产出(四组分层)/ 参考资料(素材与参考两组)/ 出件前检查。
// 全部判定逐字对应经典 renderRail(含等待确认停表、停止不转圈、PR #10 的检查卡句式)。
import React, { useRef } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { S, ui, bump, verdict, timing, fmtDur, DEFAULT_STAGES, _friendlyText, wordPresence,
         completionGate, deliveryDeadEnd, knownStep, jobState } from '../core/index.js';
import { IS_WEB } from '../core/env.js';
import { addRef } from './newjob-core.js';
import { ART_GROUPS, artGroup, artKind, artPurpose, openArtifact, openJobFolder } from './artifacts.js';

export default function Rail(){
  const id = S.active;
  if(!id) return null;
  const p = S.prog[id] || {}, t = timing(id);
  const names = S.names[id] || {}, st = S.steps[id] || {};
  const job = (S.jobs || []).find(x => x.job_id === id);
  const state = job ? jobState(job) : (p.pct >= 100 ? 'done' : 'running');
  const delivery = completionGate(state, p.pct, wordPresence(S.arts[id], S.artsLoaded[id], job && job.has_word));
  const total = t.total, cur = knownStep(job, p, t.total), done100 = delivery.complete;
  // 等待用户:是暂停等人,不是失败终态(经典同注释)
  const pres = (job && job.presentation && job.presentation.code) || '';
  const waiting = !done100 && (pres === 'needs_input' || !!S.chips[id]) && state !== 'done';
  const missingWord = delivery.missingWord || (!waiting && ['stopped', 'unknown'].indexOf(state) >= 0
    && deliveryDeadEnd(job)
    && wordPresence(S.arts[id], S.artsLoaded[id], job && job.has_word) === 'missing');
  const terminalDelivery = done100 || missingWord || delivery.checkingWord;
  const v = verdict(id);
  const halted = !done100 && !waiting && !terminalDelivery && ['stopped', 'unknown', 'paused'].indexOf(state) >= 0;
  const stageName = names[cur] || DEFAULT_STAGES[cur - 1] || '';
  const curName = missingWord ? '没出 Word，未完成' : (delivery.checkingWord ? '正在核对 Word 交付物'
    : (done100 ? (v.key === 'ok' ? '全部完成 · 内容检查通过' : v.key === 'warn' ? '已完成 · 有待确认项' : v.key === 'bad' ? (v.fix ? '已完成 · 内容异常需修复' : '已完成 · 有必办项') : '全部完成 · 待体检')
      : (waiting ? '等待你确认后继续'
        : (halted ? ((state === 'paused' ? '已暂停' : '已停止') + (stageName ? ' · 停在' + stageName : ''))
          : (stageName || '启动中')))));
  const railColor = missingWord ? 'var(--red)' : (done100 ? v.color : (halted ? 'var(--amber)' : ''));
  const ticks = [];
  for(let i = 1; i <= total; i++) ticks.push(<i key={i} className={(done100 || i < cur) ? 'd' : (!terminalDelivery && i === cur) ? 'a' : ''} />);
  // 估时只给分钟粒度;等待确认/已停止时停表(经典同注释)
  const etaLabel = t.eta >= 120000 ? ('约剩' + (t.rough ? '~' : ' ') + Math.round(t.eta / 60000) + ' 分钟')
    : (t.eta ? (t.rough ? '约剩~' : '约剩 ') + fmtDur(t.eta) : '');
  const etaTop = terminalDelivery
    ? (t.elapsed ? '共用 ' + fmtDur(t.elapsed) + (t.idle ? '(中途等待 ' + fmtDur(t.idle) + ')' : '') : '')
    : (waiting ? '等待你确认 · 不计时'
      : (halted ? '已停止 · 不计时'
        : (etaLabel || (t.elapsed ? '实际已用 ' + fmtDur(t.elapsed) : ''))));

  const seen = new Set(), arts = (S.arts[id] || []).filter(a => !seen.has(a.name) && seen.add(a.name));
  const groups = ART_GROUPS.map(g => ({ ...g, items: arts.filter(a => (a.group == null ? artGroup(a.name) : a.group) === g.key) })).filter(g => g.items.length);

  const atts = S.atts[id] || [];
  const mats = atts.filter(a => a.kind === 'material');
  const refs = atts.filter(a => a.kind !== 'material');
  const refIn = useRef(null);

  const hth = S.health[id];
  const openGaps = hth ? (hth.gaps || []).filter(g => g.level !== 'green') : [];
  const first = openGaps[0];
  const warnD = !hth ? '出 Word 后在这里看结论与补料清单'
    : first ? (_friendlyText(first.title || '') + (first.detail ? ' —— ' + _friendlyText(first.detail) : '')
               + (openGaps.length > 1 ? '(点开看全部 ' + openGaps.length + ' 项)' : '(点开逐条处理)'))
    : '关键检查已通过,可以准备提交';

  const AttRow = ({ a }) => (
    <div className="attrow" title={a.name}><span className="attn">{a.name}</span><span className="as">{a.size_kb || 0} KB</span></div>
  );

  return (
    <div className="rail" id="rail">
      <div className="card" style={{ flex: 'none' }}>
        <div className="ch"><span className="ct">进度
          <span className="tgl" id="stepsTgl" onClick={() => { S.stepsOpen = !S.stepsOpen; bump(); }}>{S.stepsOpen ? '收起' : '展开'}</span></span>
          <span className="cr" id="etaTop">{etaTop}</span></div>
        <div id="miniProg">
          <div className="ticks">{ticks}</div>
          <div className="curstep" style={railColor ? { color: railColor } : undefined}>
            {done100 ? '✓' : (terminalDelivery ? '⚠' : (waiting || halted ? '⏸' : <i className="spin b" />))}
            <span>{curName}</span>
            <span className="cs-r">{cur ? cur + '/' + total : ''}</span>
          </div>
        </div>
        {S.stepsOpen && (
          <div id="phases">
            {Array.from({ length: total }, (_, k) => {
              const i = k + 1;
              const nm = names[i] || DEFAULT_STAGES[i - 1] || ('第 ' + i + ' 步');
              const isDone = done100 || i < cur, isAct = !terminalDelivery && !halted && i === cur;
              const dur = (st[i] && st[i + 1]) ? fmtDur(st[i + 1] - st[i]) : (isAct && st[i] ? fmtDur(Date.now() - st[i]) : '');
              return <div key={i} className={'step' + (isDone ? ' d' : isAct ? ' a' : '')}>
                <span className="si">{isDone ? '✓' : isAct ? <i className="spin" /> : i}</span>
                <span className="sn">{nm}</span><span className="sd">{dur || ''}</span></div>;
            })}
          </div>
        )}
      </div>
      <div className="card" style={{ flex: 1, minHeight: 0 }}>
        <div className="ch"><span className="ct">已产出 <span id="artCount">{arts.length ? '· ' + arts.length : ''}</span></span>
          <span className="addref" onClick={openJobFolder}>打开任务文件夹</span></div>
        <div className="cardlist" id="files">
          {!arts.length ? <span style={{ font: '400 12px/1.6 inherit', color: 'var(--faint)' }}>生成过程中陆续出现</span>
            : groups.map(g => {
              const open = S.openGrp[g.key] !== false;
              return (
                <React.Fragment key={g.key}>
                  <div className={'grp' + (open ? ' on' : '')} onClick={() => { S.openGrp[g.key] = S.openGrp[g.key] === false ? true : false; bump(); }}>
                    <span className="gt">{g.title}</span><span className="gc">{g.items.length}</span><span className="gx">›</span>
                  </div>
                  {open && g.items.map(a => {
                    const md = /\.md$/i.test(a.name);
                    return (
                      <div className="file" key={a.name}>
                        <div className="fmain">
                          <div className="ftop"><span className="tag">{artKind(a)}</span>
                            <span className={'fn' + (md ? ' pv' : '')} title={a.name}
                              onClick={md ? () => ui.openPreview(a.name, a.url || '') : undefined}>{a.name}</span></div>
                          <span className="fdesc">{artPurpose(a)}</span>
                        </div>
                        <span className="openart" onClick={() => openArtifact(a.name, a.url || '')}>{IS_WEB ? '下载' : '打开'}</span>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
        </div>
      </div>
      <div className="card" style={{ flex: 'none' }}>
        <div className="ch"><span className="ct">参考资料</span>
          <span className="addref" onClick={() => {
            if(!S.active){ ui.toast('先选中一个任务,参考资料是加给具体任务的'); return; }
            if(!S.online){ ui.toast('未连接本地服务'); return; }
            refIn.current && refIn.current.click();
          }}><PlusOutlined style={{ fontSize: 12 }} /> 添加</span></div>
        <div id="attsList">
          {mats.length > 0 && <><div className="attgrp">本单导入素材 · {mats.length} 个(生成时与素材库合并,同名以本单为准)</div>
            {mats.map((a, i) => <AttRow key={'m' + i} a={a} />)}</>}
          {refs.length > 0 && <>{mats.length > 0 && <div className="attgrp" style={{ marginTop: 4 }}>参考资料 · {refs.length} 个</div>}
            {refs.map((a, i) => <AttRow key={'r' + i} a={a} />)}</>}
          {!mats.length && !refs.length && <span style={{ font: '400 12px/1.6 inherit', color: 'var(--faint)' }}>给 AI 的写法参照,如过往标书</span>}
        </div>
        <input ref={refIn} type="file" multiple style={{ display: 'none' }}
          accept=".docx,.doc,.pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.webp"
          onChange={e => { const fs = Array.from(e.target.files); (async () => { for(const f of fs) await addRef(f); })(); e.target.value = ''; }} />
      </div>
      <div className="card warncard" onClick={() => ui.openCheck()}>
        <div className="t"><span className="dot" id="warnDot" style={{ background: hth ? verdict(id).color : 'var(--amber)' }} />
          <span id="warnT">{hth ? '提交前需处理 ' + openGaps.length + ' 项' : '出件前检查'}</span></div>
        <div className="d" id="warnD">{warnD}</div>
      </div>
    </div>
  );
}
