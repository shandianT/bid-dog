// 素材库:位置/入库/AI 识图打标/分类列表/清空。数据路径逐字对应经典素材库六函数。
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input, Button } from 'antd';
import { S, ui, api } from '../core/index.js';
import { isWin } from '../core/env.js';
import { esc } from '../lib.js';
import FactsPanel from './FactsPanel.jsx';

export default function AssetsSheet(){
  const open = !!(S.sheet && S.sheet.name === 'assets');
  const [a, setA] = useState(null);
  const [dirRow, setDirRow] = useState(false);
  const [dir, setDir] = useState('');
  const [ingestMsg, setIngestMsg] = useState('');
  const [visionMsg, setVisionMsg] = useState({ text: '', html: null });
  const ingestRef = useRef(null);
  const timerRef = useRef(null);
  const [factsKey, setFactsKey] = useState(0);

  async function loadAssets(){
    if(!S.online){ setA({ folder: isWin ? 'C:\\Users\\me\\Documents\\中标狗\\素材库' : '~/Documents/中标狗/素材库', offline: true, items: [], recent: [] }); return; }
    try{
      const r = await api('/v1/assets');
      setA(r); setDir(r.is_default ? '' : r.folder);
    }catch(e){}
  }
  useEffect(() => { if(open){ setIngestMsg(''); setVisionMsg({ text: '', html: null }); setDirRow(false); loadAssets(); }
    return () => { if(timerRef.current) clearInterval(timerRef.current); }; }, [open]);

  async function saveAssetsDir(reset){
    const d = reset ? '' : dir.trim();
    if(!reset && !d){ ui.toast('先填新位置的完整路径'); return; }
    try{
      await api('/v1/assets/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: d }) });
      ui.toast(reset ? '已恢复默认位置' : '已更换素材库位置(原文件不搬迁,需要的话手动拷过去)');
      setDirRow(false); loadAssets();
    }catch(e){ ui.toast('更换失败:路径建不出来或不可写'); }
  }
  async function openAssetsFolder(){
    try{ const r = await api('/v1/assets/open', { method: 'POST' });
      if(!r.ok) ui.toast('无法自动打开,请手动前往:' + (r.folder || ''));
    }catch(e){ ui.toast('云端模式不支持打开本机文件夹'); }
  }
  async function clearAssets(){
    if(!await ui.askConfirm('清空入库产生的素材?', '将删除:章节模板、图片、原始标书、图片索引与入库流水。你手动放进素材库的其他文件不受影响。', true)) return;
    try{ const r = await api('/v1/assets?scope=ingested', { method: 'DELETE' });
      setIngestMsg('✓ 已清空 ' + r.removed + ' 个文件');
    }catch(e){ ui.toast('清空失败'); }
    loadAssets();
  }
  async function ingestAsset(file){
    if(!file) return;
    if(!S.online){ ui.toast('本地服务未连接'); return; }
    setIngestMsg('整理中:' + file.name + ' …');
    const fd = new FormData(); fd.append('file', file);
    try{
      const r = await api('/v1/assets/ingest', { method: 'POST', body: fd });
      setIngestMsg(r.skipped ? ('· ' + r.note)
        : '✓ 已入库(本地解析,未调用模型):' + r.sections + ' 个章节、' + r.images + ' 张图片'
          + (Object.keys(r.categories || {}).length ? ' · ' + Object.entries(r.categories).map(([k, v]) => k + '×' + v).join(' · ') : '')
          + ' — 存放于 ' + (r.folder || '素材库') + '/章节模板、图片'
          + (r.auto_tagging ? ' · 已自动开始 AI 识图打标' : '')
          + (r.facts ? ' · 正在抽取公司/资质/业绩/人员事实,稍后在下方确认' : ''));
      if(r.facts){ setTimeout(() => setFactsKey(k => k + 1), 1500); setTimeout(() => setFactsKey(k => k + 1), 6000); }
    }catch(e){ setIngestMsg('✗ 入库失败:' + ((e && e.message) || '支持 docx/doc/pdf/md/txt/html 及图片(png/jpg)')); }
    loadAssets();
  }
  async function startVision(force){
    setVisionMsg({ text: '启动中…', html: null });
    try{
      const r = await api('/v1/assets/vision_index' + (force ? '?force=true' : ''), { method: 'POST' });
      if(!r.ok){ setVisionMsg({ text: '✗ ' + r.error, html: null }); return; }
      setVisionMsg({ text: '识图中(模型:' + (r.model || '') + ')…', html: null });
      if(timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(async () => {
        try{
          const s = await api('/v1/assets/vision_index');
          if(s.running){
            setVisionMsg({ text: '识图中:' + s.done + '/' + s.total + ' 张 · 成功打标 ' + s.updated + (s.degraded ? ' · 待重试 ' + s.degraded + ' 张' : ''), html: null });
          } else {
            // 完成态给人话总结,原始异常收进可展开区;失败图有一键重试出路(经典同注释)
            const fails = (s.errors || []).length;
            setVisionMsg({ text: '', html: (
              <>已完成:成功打标 {String(s.updated)} 张
                {s.degraded ? <>,另有 {String(s.degraded)} 张识别失败已降级登记(常见于文字密集的合同截图,是模型返回格式问题,不是图片问题)
                  <Button size="small" style={{ marginLeft: 6 }} onClick={() => startVision(false)}>重试失败图片</Button></> : null}
                {fails ? <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer' }}>技术详情(报障时截图给技术)</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{(s.errors || []).join('\n')}</pre></details> : null}</>
            )});
            clearInterval(timerRef.current); loadAssets();
          }
        }catch(e){ clearInterval(timerRef.current); }
      }, 2000);
    }catch(e){ setVisionMsg({ text: '✗ 启动失败,请先在上方配置模型接入点并填视觉模型', html: null }); }
  }

  if(!open) return null;
  const cats = {}; ((a && a.items) || []).forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
  return (
    <Modal open={open} onCancel={ui.closeAll} footer={null} width={600} centered title="素材库">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, maxHeight: '66vh', overflowY: 'auto', paddingRight: 4 }}>
        <div className="desc2">你的公司资料、资质案例、图片与章节模板都在这,生成标书时全部从这里取材。</div>
        <div className="gcard">
          <span className="dot" style={{ background: 'var(--green)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '500 13px/1.4 inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a ? a.folder : '…'}</div>
            <div style={{ font: '400 11.5px/1.5 inherit', color: 'var(--dim)' }}>{a && !a.offline ? (a.is_default ? '默认位置;所有素材都在这个文件夹里,生成时全部从这里取材' : '自定义位置(已替代默认);生成时全部从这里取材') : '所有素材都存在这个文件夹里,可直接打开查看'}</div>
          </div>
          <span className="a" onClick={openAssetsFolder}>打开文件夹</span>
          <span className="a" style={{ marginLeft: 10 }} onClick={() => setDirRow(v => !v)}>更换位置</span>
        </div>
        {dirRow && (
          <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            <Input style={{ flex: 1 }} value={dir} onChange={e => setDir(e.target.value)}
              placeholder={'新位置完整路径;默认:' + ((a && a.default) || '')} />
            <Button type="primary" onClick={() => saveAssetsDir(false)}>保存</Button>
            <Button onClick={() => saveAssetsDir(true)}>恢复默认</Button>
          </div>
        )}
        <div className="gcard">
          <span className="dot" style={{ background: 'var(--blue)' }} />
          <div style={{ flex: 1 }}><div style={{ font: '500 13px/1.4 inherit' }}>上传过往标书,自动整理成可复用素材</div>
            <div style={{ font: '400 11.5px/1.6 inherit', color: 'var(--dim)' }}>本地解析,不调用模型:抽图片入「图片/」、按标题拆章入「章节模板/」,原件留档;重复上传自动跳过。</div></div>
          <span className="a" onClick={() => ingestRef.current && ingestRef.current.click()}>选文件</span>
        </div>
        {ingestMsg && <div style={{ font: '400 12.5px/1.6 inherit', color: 'var(--sub)' }}>{ingestMsg}</div>}
        <input ref={ingestRef} type="file" multiple style={{ display: 'none' }}
          accept=".docx,.doc,.pdf,.md,.txt,.html,.htm,.png,.jpg,.jpeg,.webp"
          onChange={e => { const fs = Array.from(e.target.files); (async () => { for(const f of fs) await ingestAsset(f); })(); e.target.value = ''; }} />
        <div className="gcard" id="capCard">
          <span className="dot" style={{ background: 'var(--violet)' }} />
          <div style={{ flex: 1 }}><div style={{ font: '500 13px/1.4 inherit' }}>产品能力表 · 应答判定的第一依据</div>
            <div style={{ font: '400 11.5px/1.6 inherit', color: 'var(--dim)' }}>功能 | 支持情况 | 版本要求 | 证明材料 | 可定制 | 配图,表格里直接改;偏离表按它逐条判定满足/部分满足/不满足。</div></div>
          <span className="a" id="capOpen" onClick={() => ui.openSheet('capability')}>编辑</span>
        </div>
        <FactsPanel refreshKey={factsKey + (open ? 1 : 0)} />
        <div className="gcard">
          <span className="dot" style={{ background: 'var(--amber)' }} />
          <div style={{ flex: 1 }}><div style={{ font: '500 13px/1.4 inherit' }}>AI 识图打标(调用你配的视觉模型)</div>
            <div style={{ font: '400 11.5px/1.6 inherit', color: 'var(--dim)' }}>逐张 OCR 读图 → 分类、图注与<b>落位锚点</b>写入图片索引;写标书时按锚点自动插图。</div></div>
          <span className="a" onClick={() => startVision()}>开始打标</span>
        </div>
        {(visionMsg.text || visionMsg.html) && <div style={{ font: '400 12.5px/1.6 inherit', color: 'var(--sub)' }}>{visionMsg.html || visionMsg.text}</div>}
        <div>
          {Object.keys(cats).map(c => (
            <div className="lrow" key={c}><span className="dot" style={{ background: 'var(--blue)' }} />
              <div className="c"><span className="n">{c}</span><span className="s">已整理</span></div>
              <span style={{ font: '400 12px/1 inherit', color: 'var(--faint)' }}>{cats[c]} 项</span></div>
          ))}
          {!Object.keys(cats).length && (
            <div className="lrow" style={{ borderTop: 'none' }}><div className="c">
              <span className="n" style={{ color: 'var(--sub)' }}>文件夹还是空的</span>
              <span className="s">上传一份过往标书试试,或把资质、业绩、图片拖进该文件夹</span></div></div>
          )}
          {((a && a.recent) || []).length > 0 && <>
            <div className="lbl2" style={{ paddingTop: 12 }}>最近入库</div>
            {a.recent.map((r0, i) => (
              <div className="lrow" key={i}><span className="dot" style={{ background: 'var(--amber)' }} />
                <div className="c"><span className="n">{r0.source}</span><span className="s">{r0.ts} · {r0.sections} 个章节 · {r0.images} 张图</span></div></div>
            ))}
          </>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ font: '400 11.5px/1.7 inherit', color: 'var(--faint)' }}>文件始终在你的本地文件夹里,删除应用不影响文件。</span>
          <span className="a" style={{ color: 'var(--red)' }} onClick={clearAssets}>清空入库素材</span>
        </div>
      </div>
    </Modal>
  );
}
