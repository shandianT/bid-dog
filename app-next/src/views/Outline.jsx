// 标书视图:左边章节目录,右边正文——点一章右边直接出正文,可滚可读,「重写本章」就在正文顶上。
// 章节状态/字数公式逐字对应经典 renderOutline;正文取自章节稿 .md(经典 openPreview 的原文视图)。
import React, { useEffect, useState } from 'react';
import { List, Button, Empty, Spin } from 'antd';
import { CheckCircleFilled, LoadingOutlined, CloseCircleFilled, ClockCircleOutlined, PauseCircleFilled, ExportOutlined } from '@ant-design/icons';
import { S, ui, bump, publicTaskState, taskCapabilities, resumeJob } from '../core/index.js';
import { net, IS_WEB } from '../core/env.js';
import { mdHtml } from '../lib.js';
import { startStaged } from './newjob-core.js';
import { openArtifact } from './artifacts.js';

const ChapterIcon = ({ state }) => state === 'done' ? <CheckCircleFilled style={{ color: 'var(--green)' }} />
  : state === 'writing' ? <LoadingOutlined style={{ color: 'var(--blue)' }} />
  : state === 'paused' ? <PauseCircleFilled style={{ color: 'var(--amber)' }} />
  : state === 'failed' ? <CloseCircleFilled style={{ color: 'var(--red)' }} />
  : <ClockCircleOutlined style={{ color: 'var(--faint)' }} />;

const OUTLINE_STATE={done:['done','已完成'],running:['writing','正在撰写…'],retry_wait:['writing','写入中断,正在自动重试'],
                     failed:['failed','未完成,可重试'],blocked:['failed','已阻断,需要处理'],pending:['todo','排队等待']};

// 任务没在跑时,章节的「正在撰写」只是停下那一刻的快照:等确认就说等确认,停了就说停了,
// 别让大纲跟顶栏徽章打架。
function chapterLabel(n, taskState){
  const [cls, label] = OUTLINE_STATE[n.state] || ['todo', n.state || '等待中'];
  if(cls === 'writing' && taskState !== 'generating')
    return ['paused', taskState === 'needs_input' ? '等你确认后接着写' : '已中断 · 继续后接着写'];
  return [cls, label];
}

export function _chapterNodes(id){
  const p=S.pipeline[id];const nodes=(p&&p.pipeline&&p.pipeline.nodes)||[];
  return nodes.filter(n=>String(n.id||'').indexOf('chapter_write:')===0);
}
export function _fmtWords(kb){ if(!kb)return ''; const n=Math.round(kb*1024/3/100)*100; return n>0?('约 '+(n>=10000?((n/10000).toFixed(1)+' 万'):n)+' 字'):''; }

// 章节正文缓存:同一份章节稿(名字 + 大小)只拉一次;重写出新版后大小变了自然刷新
const TEXT_CACHE = new Map();
const MAX_TEXT = 200000;
function useChapterText(id, art){
  const key = art ? (id + '|' + art.name + '|' + (art.size_kb || 0)) : '';
  const [st, setSt] = useState({ key: '', text: '', status: '' });
  useEffect(() => {
    if(!key) return undefined;
    if(TEXT_CACHE.has(key)){ setSt({ key, text: TEXT_CACHE.get(key), status: '' }); return undefined; }
    const url = art.url || '';
    if(!url || !S.online){ setSt({ key, text: '', status: 'nourl' }); return undefined; }
    let alive = true;
    setSt({ key, text: '', status: 'loading' });
    (async () => {
      try{
        const r = await fetch(net.API + url); const t = (await r.text()).slice(0, MAX_TEXT);
        if(!alive) return;
        TEXT_CACHE.set(key, t);
        setSt({ key, text: t, status: t ? '' : 'empty' });
      }catch(e){ if(alive) setSt({ key, text: '', status: 'error' }); }
    })();
    return () => { alive = false; };
  }, [key]);
  return st.key === key ? st : { key, text: '', status: key ? 'loading' : '' };
}

function Pane({ id, row, canRewrite }){
  const st = useChapterText(id, row.art);
  const words = row.art ? _fmtWords(row.art.size_kb) : '';
  const meta = [words, row.ver ? 'v' + (row.ver + 1) + ' · 人工重写' + (row.node && row.node.user_note ? '(带补充要求)' : '') : '']
    .filter(Boolean).join(' · ');
  let body;
  if(!row.art){
    body = <div className="doc-wait">{row.cls === 'writing' ? <><LoadingOutlined /> 正在撰写这一章,写完自动出现在这里</>
      : row.cls === 'paused' ? '这一章写到一半停了,任务接着跑时会续上'
      : row.cls === 'failed' ? ('这一章没写成' + (row.node && row.node.error_code ? '(' + row.node.error_code + ')' : '') + ',可以重试并调整要求')
      : '排队等待,前面的章节写完后自动开始'}</div>;
  } else if(st.status === 'loading') body = <div className="doc-wait"><Spin size="small" /> 正在读取章节稿…</div>;
  else if(st.status === 'error') body = <div className="doc-wait">读不到章节稿,点右上角「{IS_WEB ? '下载' : '打开'}」用默认应用看</div>;
  else if(st.status === 'empty') body = <div className="doc-wait">(空文件)</div>;
  else if(st.status === 'nourl') body = <div className="doc-wait">（演示模式：连接本地服务后可看正文）</div>;
  else body = <article className="doc-body md" dangerouslySetInnerHTML={{ __html: mdHtml(st.text) }} />;
  const rw = canRewrite && row.node && ['done', 'failed', 'blocked'].indexOf(row.node.state) >= 0;
  return (
    <section className="doc-pane" id="docPane" data-chapter={row.key}>
      <header className="doc-head">
        <div className="doc-title"><b>{row.index + 1}. {row.title}</b><span className="doc-meta">{meta}</span></div>
        <div className="doc-actions">
          {row.art && <Button size="small" type="text" icon={<ExportOutlined />} title={IS_WEB ? '下载' : '用默认应用打开'}
            onClick={() => openArtifact(row.art.name, row.art.url || '')}>{IS_WEB ? '下载' : '打开'}</Button>}
          {rw && <Button size="small" className="ol-rw" data-rw={row.node.id} data-rwt={row.title}
            onClick={() => ui.openRewrite(row.node.id, row.title)}>{row.node.state === 'done' ? '重写本章' : '重试并调整'}</Button>}
        </div>
      </header>
      {body}
    </section>
  );
}

export default function Outline(){
  const id = S.active; if(!id) return null;
  const job = (S.jobs || []).find(x => x.job_id === id) || {};
  const taskState = publicTaskState(job);
  const arts = S.arts[id] || [];
  const nodes = _chapterNodes(id);
  let rows = [], canRewrite = false, note = '';
  if(nodes.length){
    canRewrite = true;
    rows = nodes.map((n, i) => {
      const out = (n.outputs && n.outputs[0]) || '';
      const art = arts.find(a => a.name === out) || null;
      const [cls, label] = chapterLabel(n, taskState);
      // 目录里已完成的章只留 ✓ 和字数,状态字只给还没写完的章
      const sub = cls === 'done' ? '' : (label + ((n.state === 'failed' && n.error_code) ? ' · ' + String(n.error_code) : ''));
      return { key: n.id, index: i, title: n.title || n.id, cls, label, art, node: n, ver: Number(n.rewrite_serial) || 0, sub };
    });
  } else {
    const chapterArts = arts.filter(a => /^章节_/.test(a.name || ''));
    if(!chapterArts.length){
      // 空态给「现在该做什么」和一颗真按钮(经典同注释)
      const st = taskState, caps = taskCapabilities(job);
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
    note = '智能体模式生成:可逐章阅读;「单章重写」需要分段生成模式(新建任务默认使用)';
    rows = chapterArts.map((a, i) => ({ key: a.name, index: i, title: a.name.replace(/^章节_\d*_?/, '').replace(/\.md$/i, ''),
      cls: 'done', label: '已生成', art: a, node: null, ver: 0, sub: '' }));
  }
  const done = rows.filter(r => r.cls === 'done').length;
  const totalKb = rows.reduce((s, r) => s + (r.art ? (Number(r.art.size_kb) || 0) : 0), 0);
  // 当前看哪一章:用户点过就用;否则第一章写完的;再否则第一章
  const selKey = S.docSel[id];
  const sel = rows.find(r => r.key === selKey) || rows.find(r => r.cls === 'done') || rows[0];
  return (
    <div className="doc">
      <aside className="doc-toc">
        <div className="sec-head"><span className="sec-title">标书大纲</span>
          <span className="sec-meta outline-note" title={note || '点章节看正文;已完成的章节可以只重写这一章'}>已完成 <b>{done}/{rows.length}</b> 章{totalKb ? ' · 共' + _fmtWords(totalKb) : ''}</span></div>
        <List className="outline" split={false} dataSource={rows} renderItem={r => (
          <List.Item className={'outline-row ' + r.cls + (sel && r.key === sel.key ? ' sel' : '')}
            data-pv={r.art ? r.art.name : ''} data-chapter={r.key}
            onClick={() => { S.docSel[id] = r.key; bump(); }}
            actions={[<span className="outline-w num" key="w">{r.art ? _fmtWords(r.art.size_kb) : ''}</span>]}>
            <List.Item.Meta avatar={<ChapterIcon state={r.cls} />}
              title={<span className="ol-line"><b>{r.index + 1}. {r.title}</b>{r.sub ? <span className="ol-sub">{r.sub}</span> : null}</span>} />
          </List.Item>
        )} />
        {note && <div className="doc-note">{note}</div>}
      </aside>
      {sel && <Pane id={id} row={sel} canRewrite={canRewrite} />}
    </div>
  );
}
