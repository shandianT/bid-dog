// 标书大纲主视图:逐章状态/字数/单章重写。渲染公式逐字对应经典 renderOutline。
import React from 'react';
import { List, Button, Tag, Empty, Badge } from 'antd';
import { CheckCircleFilled, LoadingOutlined, CloseCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import { S, ui, publicTaskState, taskCapabilities, resumeJob } from '../core/index.js';
import { startStaged } from './newjob-core.js';

const ChapterIcon = ({ state }) => state === 'done' ? <CheckCircleFilled style={{ color: 'var(--green)' }} />
  : state === 'writing' ? <LoadingOutlined style={{ color: 'var(--blue)' }} />
  : state === 'failed' ? <CloseCircleFilled style={{ color: 'var(--red)' }} />
  : <ClockCircleOutlined style={{ color: 'var(--faint)' }} />;

const OUTLINE_STATE={done:['done','已完成'],running:['writing','正在撰写…'],retry_wait:['writing','写入中断,正在自动重试'],
                     failed:['failed','未完成,可重试'],blocked:['failed','已阻断,需要处理'],pending:['todo','排队等待']};

export function _chapterNodes(id){
  const p=S.pipeline[id];const nodes=(p&&p.pipeline&&p.pipeline.nodes)||[];
  return nodes.filter(n=>String(n.id||'').indexOf('chapter_write:')===0);
}
export function _fmtWords(kb){ if(!kb)return ''; const n=Math.round(kb*1024/3/100)*100; return n>0?('约 '+(n>=10000?((n/10000).toFixed(1)+' 万'):n)+' 字'):''; }

export default function Outline(){
  const id = S.active; if(!id) return null;
  const arts = S.arts[id] || [];
  const nodes = _chapterNodes(id);
  if(nodes.length){
    const done = nodes.filter(n => n.state === 'done').length;
    let totalKb = 0;
    const rows = nodes.map((n, i) => {
      const out = (n.outputs && n.outputs[0]) || '';
      const art = arts.find(a => a.name === out);
      if(art) totalKb += Number(art.size_kb) || 0;
      const [cls, label] = OUTLINE_STATE[n.state] || ['todo', n.state || '等待中'];
      const ver = Number(n.rewrite_serial) || 0;
      const sub = [label, ver ? ('v' + (ver + 1) + ' · 人工重写' + (n.user_note ? '(带补充要求)' : '')) : '',
        (n.state === 'failed' && n.error_code) ? String(n.error_code) : ''].filter(Boolean).join(' · ');
      const canRw = ['done', 'failed', 'blocked'].indexOf(n.state) >= 0;
      return (
        <List.Item className={'outline-row ' + cls} data-pv={out} onClick={() => out && ui.openPreview(out)}
          actions={[
            <span className="outline-w num" key="w">{art ? _fmtWords(art.size_kb) : ''}</span>,
            canRw ? <Button size="small" type="text" className="ol-rw" key="rw" data-rw={n.id} data-rwt={n.title || ''}
              onClick={e => { e.stopPropagation(); ui.openRewrite(n.id, n.title || ''); }}>
              {n.state === 'done' ? '重写本章' : '重试并调整'}</Button> : <span key="rw" />,
          ]}>
          {/* 一行一章:序号 + 标题 + 状态,不再两行;字数与重写按钮靠右 */}
          <List.Item.Meta avatar={<ChapterIcon state={cls} />}
            title={<span className="ol-line"><b>{i + 1}. {n.title || n.id}</b><span className="ol-sub">{sub}</span></span>} />
        </List.Item>
      );
    });
    return (
      <>
        <div className="outline-note" title="点章节看内容;已完成的章节可以只重写这一章">已完成 <b>{done}/{nodes.length}</b> 章{totalKb ? ' · 共' + _fmtWords(totalKb) : ''}</div>
        <List className="outline" split={false} dataSource={rows} renderItem={r => r} />
      </>
    );
  }
  const chapterArts = arts.filter(a => /^章节_/.test(a.name || ''));
  if(!chapterArts.length){
    // 空态给「现在该做什么」和一颗真按钮(经典同注释)
    const job = (S.jobs || []).find(x => x.job_id === id) || {};
    const st = publicTaskState(job), caps = taskCapabilities(job);
    return (
      <div className="outline-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<><b style={{ display: 'block', marginBottom: 6 }}>大纲还没生成出来</b>
            <span>{st === 'preparing' ? '点下面的按钮开始,拆解出章节后这里会逐章亮起:每章的状态、字数,写完的章节可以单独重写。'
              : st === 'generating' ? '正在拆解招标文件,章节确定后会陆续出现在这里。'
              : '这一单还没跑到拆解章节那一步。'}</span></>} />
        {st === 'preparing' ? <Button type="primary" onClick={startStaged}>开始生成</Button>
          : (caps.resume ? <Button type="primary" onClick={resumeJob}>从断点继续</Button> : null)}
      </div>
    );
  }
  return (
    <>
      <div className="outline-note">本任务由智能体模式生成:可逐章预览;「单章重写」需要分段生成模式(新建任务默认使用)。</div>
      <List className="outline" split={false} dataSource={chapterArts}
        renderItem={(a, i) => (
          <List.Item className="outline-row done" data-pv={a.name} onClick={() => ui.openPreview(a.name)}
            actions={[<span className="outline-w num" key="w">{_fmtWords(a.size_kb)}</span>]}>
            <List.Item.Meta avatar={<ChapterIcon state="done" />}
              title={<span className="ol-line"><b>{i + 1}. {a.name.replace(/^章节_\d*_?/, '').replace(/\.md$/i, '')}</b><span className="ol-sub">已生成</span></span>} />
          </List.Item>
        )} />
    </>
  );
}
