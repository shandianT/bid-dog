// 右栏:交付 / 进度 / 评分点覆盖 / 已产出 / 参考资料 / 出件前检查——六张卡按任务阶段折叠
// (rail-fold.js 的纯规则),点标题可手动开合。判定公式逐字对应经典 renderRail
// (含等待确认停表、停止不转圈、PR #10 的检查卡句式)。
import React, { useRef } from 'react';
import { Card, List, Tag, Button, Progress, Collapse, Empty } from 'antd';
import { PlusOutlined, FileWordOutlined, FolderOpenOutlined, DownloadOutlined,
         ExportOutlined, RightOutlined, EyeOutlined } from '@ant-design/icons';
import { S, ui, bump, verdict, timing, fmtDur, DEFAULT_STAGES, _friendlyText, wordPresence,
         completionGate, deliveryDeadEnd, knownStep, jobState, publicTaskState, deliveryViewModel } from '../core/index.js';
import { IS_WEB } from '../core/env.js';
import { addRef } from './newjob-core.js';
import { ART_GROUPS, artGroup, artKind, artPurpose, openArtifact, openJobFolder } from './artifacts.js';
import { railPhase, railDefaults, railIsOpen, railToggle } from './rail-fold.js';

function FoldCard({ id, k, phase, defaults, title, extra, always, summary, className, children, ...rest }){
  const open = railIsOpen(S, id, k, phase, defaults);
  const toggle = e => { if(e) e.stopPropagation(); railToggle(S, id, k, phase, defaults, bump); };
  return (
    <Card variant="borderless" size="small" data-rail={k} data-open={open ? '1' : '0'}
      className={'rcard' + (open ? '' : ' folded') + (className ? ' ' + className : '')}
      title={<span className="rc-title" role="button" aria-expanded={open} onClick={toggle}>
        <RightOutlined className={'rc-caret' + (open ? ' open' : '')} />{title}</span>}
      extra={(always || (open && extra)) ? <>{always}{open ? extra : null}</> : null} {...rest}>
      {open ? children : <div className="rc-summary" onClick={toggle}>{summary}</div>}
    </Card>
  );
}

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
  const reds = openGaps.filter(g => g.level === 'red').length;
  const yellows = openGaps.length - reds;
  const warnD = !hth ? '出 Word 后在这里看结论与补料清单'
    : first ? (_friendlyText(first.title || '') + (first.detail ? ' —— ' + _friendlyText(first.detail) : '')
               + (openGaps.length > 1 ? '(点开看全部 ' + openGaps.length + ' 项)' : '(点开逐条处理)'))
    : '关键检查已通过,可以准备提交';

  const AttRow = ({ a }) => (
    <div className="attrow" title={a.name}><span className="attn">{a.name}</span><span className="as">{a.size_kb || 0} KB</span></div>
  );

  const vm = deliveryViewModel(job || {}, S.arts[id] || []);
  const primary = vm.primary;
  const cov = S.coverage[id];
  const covLocal = !!(cov && cov.available && cov.plan_source === 'local');
  // 仪表的 title 汇总未覆盖原因(PR #10)
  let covTip = '';
  if(covLocal) covTip = '评分点来自本地关键词索引(候选),尚未经模型核对;模型核对成功后这里才是真实覆盖率。点开可看候选清单';
  else if(cov && cov.available){
    const un = (cov.items || []).filter(x => !x.covered);
    const names = { unlocated: '还没落到具体章节', gap: '规划里还留着缺口', chapter_pending: '所在章节还没写完' };
    const tally = {};
    un.forEach(x => { const r = String(x.reason || '') || 'unlocated'; tally[r] = (tally[r] || 0) + 1; });
    covTip = !un.length ? '全部评分点都已覆盖'
      : '未覆盖 ' + un.length + ' 项:' + Object.keys(tally).sort((a, b) => tally[b] - tally[a]).map(r => (names[r] || r) + ' ' + tally[r] + ' 项').join('、') + '。点开逐条查看,可直接补写应答。';
  }

  // 折叠规则:阶段决定默认开合,手动开合只在同一阶段内记忆
  const phase = railPhase({ missingWord, done100, waiting, halted, hasPrimary: !!primary, running: state === 'running',
    staged: !!(job && job.staged), preparing: !!(job && publicTaskState(job) === 'preparing') });
  const defaults = railDefaults(phase, { hasHealth: !!hth });
  const fc = { id, phase, defaults };
  const filesSummary = arts.length
    ? arts.length + ' 个文件 · ' + groups.map(g => g.title.split(' ')[0] + ' ' + g.items.length).join(' · ')
    : '生成过程中陆续出现';
  const refsSummary = (mats.length || refs.length)
    ? [mats.length ? '本单素材 ' + mats.length : '', refs.length ? '参考资料 ' + refs.length : ''].filter(Boolean).join(' · ')
    : '给 AI 的写法参照,如过往标书';
  return (
    <div className="rail" id="rail" data-phase={phase}>
      {/* 交付物永远是右栏第一张卡(原型定的规矩):还没出件时也先告诉用户「将要交付什么」 */}
      <FoldCard {...fc} k="deliver" title={primary ? '最终交付' : '将要交付'}
        extra={primary ? <Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={openJobFolder}>文件夹</Button> : null}
        summary={primary ? <><b>{primary.name || '投标文件.docx'}</b> · 请人工复核后提交</>
          : (terminalDelivery ? '本单尚未生成最终 Word' : '投标文件_整册.docx · 生成完成后出现在这里')}>
        <div className="wordrow">
          <div className={'wordicon' + (primary ? '' : ' dim')}><FileWordOutlined style={{ fontSize: 20 }} /></div>
          <div className="wordcopy">
            <b>{primary ? (primary.name || '投标文件.docx') : '投标文件_整册.docx'}</b>
            <span>{primary
              ? ('Word 文档' + (primary.size_kb ? ' · ' + Math.round(primary.size_kb) + ' KB' : '') + ' · 请人工复核后提交')
              : (terminalDelivery ? '本单尚未生成最终 Word' : '生成完成后出现在这里,过程中随时可看已产出')}</span>
          </div>
        </div>
        {primary && (
          <div className="result-actions" style={{ marginTop: 12 }}>
            <Button type="primary" size="small"
              onClick={() => openArtifact(primary.name || '投标文件.docx', primary.url || '')}>打开</Button>
            <Button size="small" icon={<EyeOutlined />} className="pv-word"
              onClick={() => ui.openPreview(primary.name || '投标文件.docx', primary.url || '')}>预览</Button>
            <Button size="small" onClick={() => ui.openCheck()}>出件前检查</Button>
          </div>
        )}
      </FoldCard>
      <FoldCard {...fc} k="progress"
        title={<span>进度</span>}
        extra={<span className="cr"><span id="etaTop">{etaTop}</span>
          <Button type="link" size="small" id="stepsTgl"
            onClick={() => { S.stepsOpen = !S.stepsOpen; bump(); }}>{S.stepsOpen ? '收起' : '展开'}</Button></span>}
        summary={<><b style={railColor ? { color: railColor } : undefined}>{curName}</b>{cur ? ' · ' + cur + '/' + total : ''}
          {/* 「已停止 · 不计时」与「已停止 · 停在…」开头相同,只保留一次 */}
          {etaTop ? (etaTop.startsWith(curName) ? etaTop.slice(curName.length) : ' · ' + etaTop) : ''}</>}>
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
      </FoldCard>
      {/* 评分点覆盖:比例本身就是结论(覆盖率=得分依据),用环形一眼看出还差多少。
          数据来自 /v1/jobs/{id}/coverage,每写完一章引擎重算一次。
          仪表(#covPill)常驻标题行,折叠也看得见、点得开——以前它挂在顶栏,和这张卡说同一件事。 */}
      {cov && cov.available && (
        <FoldCard {...fc} k="coverage"
          title={covLocal ? '评分点 · 待核对' : '评分点覆盖'}
          always={<Button type="link" size="small" id="covPill" className={'covpill' + (!covLocal && cov.covered >= cov.total ? ' on' : '')}
            title={covTip} onClick={e => { e.stopPropagation(); ui.openCoverage(); }}>
            {covLocal ? (cov.total + ' 项 · 待核对') : <span className="num">{cov.covered}/{cov.total}</span>} <RightOutlined /></Button>}
          summary={covLocal ? <><b>{cov.total} 项</b>候选 · 待模型核对</> : <>已覆盖 <b className="num">{cov.covered}/{cov.total}</b></>}>
          <div className="covrow">
            {/* 本地索引没有一条落到章节:环形图不能画 0%,那是把没意义的数字当结论 */}
            <Progress type="circle" size={68}
              percent={covLocal ? 0 : (cov.total ? Math.round(cov.covered / cov.total * 100) : 0)}
              strokeColor={covLocal ? 'var(--faint)' : (cov.covered >= cov.total ? 'var(--green)' : 'var(--blue)')}
              trailColor="var(--line-soft)"
              format={() => <span className="num" style={{ fontSize: 14, fontWeight: 650 }}>
                {covLocal ? (cov.total + ' 项') : (cov.covered + '/' + cov.total)}</span>} />
            <div className="covwhy">
              {covLocal
                ? <><span>规划来自本地关键词索引(候选)</span>
                    <i>模型核对成功后这里才是真实覆盖率;没核对成功的原因在「运行日志」里</i></>
                : <><span>写完一章,自动核对一章</span>
                    <i>每个评分点都能点开看「原文依据 ↔ 落位章节」</i></>}
            </div>
          </div>
        </FoldCard>
      )}
      {/* 自然高度:产物少时不撑出空白,多了由 .cardlist 自己滚(整列也可滚) */}
      <FoldCard {...fc} k="files"
        title={<span>已产出 <span id="artCount" className="num">{arts.length ? '· ' + arts.length : ''}</span></span>}
        extra={<Button type="link" size="small" onClick={openJobFolder}>任务文件夹</Button>}
        summary={filesSummary}>
        <div className="cardlist" id="files">
          {!arts.length
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成过程中陆续出现" style={{ margin: '6px 0' }} />
            : (
              <Collapse ghost size="small" className="artgrp"
                activeKey={groups.filter(g => S.openGrp[g.key] !== false).map(g => String(g.key))}
                onChange={keys => { groups.forEach(g => { S.openGrp[g.key] = keys.includes(String(g.key)); }); bump(); }}
                items={groups.map(g => ({
                  key: String(g.key),
                  label: <span className="grp"><span className="gt">{g.title}</span><span className="gc num">{g.items.length}</span></span>,
                  children: (
                    <List size="small" split={false} dataSource={g.items}
                      renderItem={a => {
                        const pv = /\.(md|docx)$/i.test(a.name);   // md 看章节稿,docx 看真实 Word 版式
                        return (
                          // 右栏只有 316px:操作用图标按钮,把宽度让给文件名
                          <List.Item className="file"
                            actions={[<Button key="o" type="text" size="small" className="openart"
                              title={IS_WEB ? '下载' : '用默认应用打开'}
                              icon={IS_WEB ? <DownloadOutlined /> : <ExportOutlined />}
                              onClick={() => openArtifact(a.name, a.url || '')} />]}>
                            <div className="fmain">
                              <div className="ftop"><Tag bordered={false} className="tag">{artKind(a)}</Tag>
                                <span className={'fn' + (pv ? ' pv' : '')} title={pv ? '预览 ' + a.name : a.name}
                                  onClick={pv ? () => ui.openPreview(a.name, a.url || '') : undefined}>{a.name}</span></div>
                              <span className="fdesc">{artPurpose(a)}</span>
                            </div>
                          </List.Item>
                        );
                      }} />
                  ),
                }))} />
            )}
        </div>
      </FoldCard>
      <FoldCard {...fc} k="refs" title="参考资料"
        extra={<Button type="link" size="small" icon={<PlusOutlined />} onClick={() => {
            if(!S.active){ ui.toast('先选中一个任务,参考资料是加给具体任务的'); return; }
            if(!S.online){ ui.toast('未连接本地服务'); return; }
            refIn.current && refIn.current.click();
          }}>添加</Button>}
        summary={refsSummary}>
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
      </FoldCard>
      {/* 标题行常驻(结论 + 红黄计数),正文只在展开时给「第一条怎么补」;整卡可点进检查面板 */}
      <FoldCard {...fc} k="check" className="warncard" hoverable onClick={() => ui.openCheck()}
        title={<span className="t"><span className="dot" id="warnDot" style={{ background: hth ? verdict(id).color : 'var(--amber)' }} />
          <span id="warnT">{hth ? '提交前需处理 ' + openGaps.length + ' 项' : '出件前检查'}</span></span>}
        extra={openGaps.length > 0 ? (
          <span className="gapmix">
            {reds > 0 && <Tag color="error" bordered={false}>必办 {reds}</Tag>}
            {yellows > 0 && <Tag color="warning" bordered={false}>建议 {yellows}</Tag>}
          </span>) : null}
        summary={hth ? (openGaps.length ? '必办 ' + reds + ' · 建议 ' + yellows + ' · 点开逐条处理' : '关键检查已通过,可以准备提交') : '出 Word 后在这里看结论与补料清单'}>
        <div className="d" id="warnD">{warnD}</div>
      </FoldCard>
    </div>
  );
}
