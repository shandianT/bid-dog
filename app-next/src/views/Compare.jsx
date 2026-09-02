// 招标对照阅读器:左边招标原文(解析版),右边标书章节;点一个评分点,两边同时定位高亮。
// 评标专家怎么看,你就怎么看——纯前端:解析版 + 覆盖矩阵 + 章节 md,不调模型。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Select, Tag, Empty, Button } from 'antd';
import { S, ui, api } from '../core/index.js';
import { net } from '../core/env.js';
import { _chapterNodes } from './Outline.jsx';

const PARSED = '招标文件_解析版.md';

import { compareTerms, compareHits } from './compare-core.js';

async function fetchText(url){
  const r = await fetch(net.API + url); if(!r.ok) throw new Error('read'); return (await r.text()).slice(0, 400000);
}

function Pane({ title, lines, hits, empty, refEl, side }){
  const top = new Set(hits.slice(0, 6).map(h => h.i));
  const first = hits.length ? hits[0].i : -1;
  return (
    <div className="cmp-pane">
      <div className="cmp-head">{title}</div>
      <div className="cmp-body" ref={refEl} data-side={side}>
        {!lines.length ? <div className="cmp-empty">{empty}</div>
          : lines.map((l, i) => {
            const h = l.match(/^(#{1,6})\s+(.*)$/);
            const cls = 'cmp-line' + (top.has(i) ? ' hit' : '') + (i === first ? ' first' : '') + (h ? ' h' + h[1].length : '');
            return <div key={i} className={cls} data-line={i}>{h ? h[2] : (l || ' ')}</div>;
          })}
      </div>
    </div>
  );
}

export default function CompareSheet(){
  const open = !!(S.sheet && S.sheet.name === 'compare');
  const id = S.active;
  const [left, setLeft] = useState({ lines: [], status: '加载中…' });
  const [right, setRight] = useState({ lines: [], status: '' });
  const [chapter, setChapter] = useState('');
  const [picked, setPicked] = useState(-1);
  const leftRef = useRef(null), rightRef = useRef(null);
  const cov = id ? S.coverage[id] : null;
  const items = (cov && cov.available && cov.items) || [];
  const nodes = id ? _chapterNodes(id) : [];
  const chapters = nodes.length
    ? nodes.filter(n => n.state === 'done').map(n => ({ value: (n.outputs && n.outputs[0]) || '', label: n.title || n.id, node: n.id }))
    : (S.arts[id] || []).filter(a => /^章节_/.test(a.name || '')).map(a => ({ value: a.name, label: a.name.replace(/^章节_\d*_?/, '').replace(/\.md$/i, ''), node: '' }));
  const arts = (id && S.arts[id]) || [];
  const artUrl = name => { const hit = arts.find(a => a.name === name); return (hit && hit.url) || ('/v1/jobs/' + id + '/artifacts/' + encodeURIComponent(name)); };

  useEffect(() => {
    if(!open || !id) return;
    let alive = true;
    setPicked(-1); setLeft({ lines: [], status: '加载中…' });
    if(!S.online){ setLeft({ lines: [], status: '连接本地服务后可对照阅读' }); return; }
    fetchText(artUrl(PARSED)).then(t => { if(alive) setLeft({ lines: t.split('\n'), status: '' }); })
      .catch(() => { if(alive) setLeft({ lines: [], status: '还没有招标文件解析版(解析完成后出现)' }); });
    const initial = (S.sheet && S.sheet.chapter) || (chapters[0] && chapters[0].value) || '';
    setChapter(initial);
    return () => { alive = false; };
  }, [open, id]);
  useEffect(() => {
    if(!open || !chapter){ setRight({ lines: [], status: '' }); return; }
    let alive = true;
    setRight({ lines: [], status: '加载中…' });
    fetchText(artUrl(chapter)).then(t => { if(alive) setRight({ lines: t.split('\n'), status: '' }); })
      .catch(() => { if(alive) setRight({ lines: [], status: '这一章还没写完' }); });
    return () => { alive = false; };
  }, [open, chapter]);

  // 评分项 + 评估标准/证据一起切词:「售后服务承诺」本身太短,证据里的「响应时间」才是正文里真正出现的词
  const terms = useMemo(() => picked >= 0 && items[picked] ? compareTerms(items[picked].requirement + ' ' + (items[picked].evidence || '')) : [], [picked, items]);
  const leftHits = useMemo(() => compareHits(left.lines, terms), [left.lines, terms]);
  const rightHits = useMemo(() => compareHits(right.lines, terms), [right.lines, terms]);
  useEffect(() => {
    const go = (ref, hits) => { const el = ref.current && hits.length ? ref.current.querySelector('[data-line="' + hits[0].i + '"]') : null;
      if(el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); };
    go(leftRef, leftHits); go(rightRef, rightHits);
  }, [leftHits, rightHits]);

  function pick(i){
    setPicked(i);
    const it = items[i];
    // 评分点落到哪一章,右边就翻到哪一章
    if(it && it.node_id){ const c = chapters.find(x => x.node === it.node_id); if(c && c.value !== chapter) setChapter(c.value); }
  }
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width="min(1180px, 96vw)" centered
      title={<span>招标对照阅读 <span className="lx">左:招标原文 · 右:标书章节 · 点评分点两边同时定位</span></span>} className="cmp-modal">
      <div id="compareSheet" className="cmp-wrap">
        <div className="cmp-points" id="cmpPoints">
          {!items.length
            ? <span className="desc2">{cov && cov.available ? '规划里没有评分点' : '响应规划完成后,评分点会列在这里;现在也可以直接左右对照阅读'}</span>
            : items.map((x, i) => (
              <Tag key={i} className={'cmp-pt' + (i === picked ? ' on' : '')} data-pt={i} bordered={false}
                color={i === picked ? 'processing' : (x.covered ? 'success' : 'warning')} onClick={() => pick(i)}>
                {x.requirement}{x.score && x.score !== '未知' ? ' · ' + x.score : ''}</Tag>
            ))}
        </div>
        <div className="cmp-panes">
          <Pane title="招标原文(解析版)" side="left" lines={left.lines} hits={leftHits} refEl={leftRef} empty={left.status || '(空)'} />
          <div className="cmp-pane">
            <div className="cmp-head cmp-sel">
              <Select size="small" style={{ minWidth: 220, flex: 1 }} value={chapter || undefined} placeholder="选一章" options={chapters}
                onChange={v => setChapter(v)} id="cmpChapter" />
              {chapter ? <Button size="small" type="link" onClick={() => ui.openPreview(chapter, artUrl(chapter))}>预览</Button> : null}
            </div>
            <div className="cmp-body" ref={rightRef} data-side="right">
              {!right.lines.length ? <div className="cmp-empty">{right.status || (chapters.length ? '选一章开始对照' : '还没有写完的章节')}</div>
                : right.lines.map((l, i) => {
                  const h = l.match(/^(#{1,6})\s+(.*)$/);
                  const top = new Set(rightHits.slice(0, 6).map(x => x.i));
                  const cls = 'cmp-line' + (top.has(i) ? ' hit' : '') + (rightHits.length && rightHits[0].i === i ? ' first' : '') + (h ? ' h' + h[1].length : '');
                  return <div key={i} className={cls} data-line={i}>{h ? h[2] : (l || ' ')}</div>;
                })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
