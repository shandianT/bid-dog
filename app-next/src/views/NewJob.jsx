// 新建任务向导:第 1 步放文件(多选/整文件夹、主件自动识别),第 2 步要求与项目归属。
// 提交路径在 newjob-core.js(经典 njStart 逐字);模板推荐/派生在视图迁移 C 补全。
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input, Checkbox, Select, Button, Steps, Switch } from 'antd';
import { S, ui, bump } from '../core/index.js';
import { NJ, DOCLIKE, NJ_REQ_SWITCHES, setReqOpt, editReq, resetReq, njAddFiles, njPickTender, njStart, njReset,
         recommendTemplateForTender, deriveTemplateFromFile, saveDerivedTemplate,
         discardDerivedTemplate, saveCurrentTemplate, deleteSelectedTemplate } from './newjob-core.js';
import { fmtSize } from '../lib.js';

// 模板摘要/详情:逐字对应经典 templateSummaryHtml/templateDetailHtml 的信息结构
function TemplateSummary({ item, label }){
  if(!item) return <>模板信息暂不可用</>;
  const p = item.package || {}, outline = p.outline || [], scores = p.scoring_focus || [],
        slots = p.material_slots || [], rules = p.quality_rules || [], tables = p.tables || [];
  if(!p.schema_version && !outline.length && !scores.length && !slots.length && !rules.length && !tables.length){
    return <><b>{label || '模板预览'}:{item.name || ''}</b><div style={{ marginTop: 5 }}>旧版自定义模板，仅保留生成要求；建议基于当前场景模板重新保存。</div></>;
  }
  const titles = outline.slice(0, 5).map(x => x.title).filter(Boolean).join('、');
  return (
    <><b>{label || '模板预览'}:{item.name || ''}</b>
      <div style={{ marginTop: 4 }}>{item.description || ''}</div>
      <div style={{ marginTop: 5 }}>目录 {outline.length} 章{titles ? ':' + titles + (outline.length > 5 ? '…' : '') : ''}</div>
      <div>评分响应 {scores.length} 组 · 表格 {tables.length} 类 · 材料槽位 {slots.length} 类 · 质检规则 {rules.length} 条</div></>
  );
}
function TemplateDetail({ item, open }){
  const p = (item && item.package) || {}, outline = p.outline || [], scores = p.scoring_focus || [],
        tables = p.tables || [], slots = p.material_slots || [], rules = p.quality_rules || [], sources = p.sources || [];
  if(!p.schema_version) return null;
  const Rows = ({ title, items, render }) => items.length
    ? <div style={{ marginTop: 8 }}><b>{title}</b>{items.map((x, i) => <div key={i}>• {render(x)}</div>)}</div> : null;
  return (
    <details open={open} style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--blue)' }}>查看完整设计思路</summary>
      <div style={{ marginTop: 6 }}>
        <Rows title="目录与写作目的" items={outline} render={x => (x.title || '') + (x.purpose ? ':' + x.purpose : '') + (x.evidence && x.evidence.length ? '(依据:' + x.evidence.join('、') + ')' : '')} />
        <Rows title="评分响应" items={scores} render={x => (x.name || '') + ':' + (x.checks || []).join('、')} />
        <Rows title="必备表格" items={tables} render={x => (x.name || '') + ':' + (x.columns || []).join('｜')} />
        <Rows title="材料槽位" items={slots} render={x => (x.name || '') + ':' + (x.evidence || []).join('、') + (x.required ? '(必需)' : '')} />
        <Rows title="质检规则" items={rules} render={x => String(x || '')} />
        <Rows title="设计依据" items={sources} render={x => (x.title || '') + (x.issuer ? ' · ' + x.issuer : '')} />
      </div>
    </details>
  );
}

function TemplateDraftCard(){
  const draft = NJ.templateDraft;
  const [name, setName] = useState('');
  const [outline, setOutline] = useState('');
  useEffect(() => {
    if(draft && !draft._loading && !draft._error){
      setName(draft.name || '');
      setOutline((((draft.package || {}).outline) || []).map(x => x.title || '').join('\n'));
    }
  }, [draft]);
  if(!draft) return null;
  if(draft._loading) return <div className="njdraft" id="njTemplateDraft">正在分析目录、表格和场景规则…</div>;
  if(draft._error) return <div className="njdraft" id="njTemplateDraft">{draft._error}</div>;
  const ready = !!(draft.validation || {}).ready;
  return (
    <div className="njdraft" id="njTemplateDraft">
      <TemplateSummary item={draft} label="模板草稿" />
      <TemplateDetail item={draft} open />
      <div className="lbl2" style={{ marginTop: 8 }}>模板名称</div>
      <Input id="njDerivedTemplateName" value={name} onChange={e => setName(e.target.value)} />
      <div className="lbl2" style={{ marginTop: 8 }}>目录(每行一章,可修改)</div>
      <Input.TextArea id="njDerivedOutline" rows={6} value={outline} onChange={e => setOutline(e.target.value)} />
      <div style={{ marginTop: 7, color: ready ? 'var(--amber)' : 'var(--red)', fontSize: 12.5 }}>
        质量评分 {String((draft.validation || {}).score || 0)};{ready ? '保存前请确认目录和材料要求,历史正文不会进入模板。' : '提取到的结构不足,暂不能保存;请换用标题层级更完整的标书。'}</div>
      <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
        <Button type="primary" disabled={!ready} onClick={() => saveDerivedTemplate(name, outline)}>确认并保存模板</Button>
        <Button onClick={discardDerivedTemplate}>放弃</Button>
      </div>
    </div>
  );
}

function TemplatePanel(){
  const id = String(NJ.template || 'auto');
  const item = (S.templates || []).find(x => String(x.id) === id);
  const importRef = useRef(null);
  const [tplName, setTplName] = useState('');
  const builtin = !item || item.builtin;
  const r = NJ.recommendation;
  return (
    <div className="njTemplatePreview">
      {id === 'auto'
        ? (r ? <><b>自动推荐:{r.template_name || ''}</b><br />依据:{(r.reasons || []).join('、')} · 置信度 {Math.round(Number(r.confidence || 0) * 100)}%</>
             : <>上传主件后，系统会按采购对象、评标办法和交付类型推荐场景模板。</>)
        : <><TemplateSummary item={item} label="场景模板" /><TemplateDetail item={item} /></>}
      <div style={{ display: 'flex', gap: 7, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input size="small" style={{ width: 150 }} placeholder="另存当前为模板…" value={tplName} onChange={e => setTplName(e.target.value)} />
        <Button size="small" onClick={() => { saveCurrentTemplate(tplName); setTplName(''); }}>保存</Button>
        <Button size="small" onClick={() => importRef.current && importRef.current.click()}>从过往标书生成模板</Button>
        {!builtin && <Button size="small" danger onClick={deleteSelectedTemplate}>删除此模板</Button>}
        <input ref={importRef} type="file" style={{ display: 'none' }} accept=".docx,.doc,.pdf,.md"
          onChange={e => { if(e.target.files[0]) deriveTemplateFromFile(e.target.files[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

export default function NewJob(){
  const fileRef = useRef(null), foldRef = useRef(null);
  if(!NJ.open) return null;
  const docs = njPickTender();
  const rest = NJ.items.filter((_, i) => i !== NJ.tenderIdx);
  const close = () => { NJ.open = false; bump(); };
  return (
    <Modal open={NJ.open} onCancel={close} footer={null} width={620} centered title="新建任务" maskClosable={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Steps size="small" current={NJ.step - 1} items={[{ title: '放入文件' }, { title: '要求与归属' }]} />
        {NJ.step === 1 && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => fileRef.current && fileRef.current.click()}>+ 文件</Button>
              <Button onClick={() => foldRef.current && foldRef.current.click()}>+ 整个文件夹</Button>
              <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
                onChange={e => { njAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
              <input ref={foldRef} type="file" webkitdirectory="" style={{ display: 'none' }}
                onChange={e => { njAddFiles(Array.from(e.target.files), true); e.target.value = ''; }} />
            </div>
            <div>
              <div className="lbl2">招标文件(主件)</div>
              <Select style={{ width: '100%' }} value={NJ.tenderIdx}
                onChange={v => { NJ.tenderIdx = v; bump(); }}
                options={docs.length ? docs.map(x => ({ value: x.i, label: x.n }))
                  : [{ value: -1, label: '(还没有文档,点上面「+ 文件」添加招标文件)' }]} />
            </div>
            <div className="njlist">
              {rest.length ? (
                <>
                  {rest.map((it, i) => <div key={i} className="njrow" title={it.rel}>{it.rel} <span style={{ color: 'var(--faint)' }}>{fmtSize(it.file.size)}</span></div>)}
                  <div style={{ color: 'var(--faint)', marginTop: 4, fontSize: 12 }}>共 {rest.length} 个文件,随本任务保存;任务详情右栏可以看到这份清单</div>
                  <Checkbox checked={NJ.saveAssets} onChange={e => { NJ.saveAssets = e.target.checked; bump(); }} style={{ marginTop: 6 }}>
                    同时存入素材库,下次任务可直接复用(去重,不会堆副本)</Checkbox>
                </>
              ) : <span style={{ color: 'var(--faint)', fontSize: 12.5 }}>没有素材也能生成:会用「素材库」里的公司资料与图片(设置里可查看)</span>}
              <div title="解析完成后先给你看读到的项目名、资质要求、评分办法和否决项,确认后才开始写;读错了当场改,不用跑完才发现">
                <Checkbox checked={NJ.confirmParse} onChange={e => { NJ.confirmParse = e.target.checked; bump(); }} style={{ marginTop: 4 }}>
                  开始撰写前,先让我确认解析出的关键信息(推荐)</Checkbox>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => { njReset(); close(); }}>取消</Button>
              <Button type="primary" disabled={NJ.tenderIdx < 0}
                onClick={() => { NJ.step = 2; bump();
                  // 让「上传主件后会推荐」这句话在开始前就成真(经典只在 njStart 时才发起,预览常常来不及显示)
                  if(String(NJ.template || 'auto') === 'auto' && !NJ.recommendation) recommendTemplateForTender();
                }}>下一步</Button>
            </div>
          </>
        )}
        {NJ.step === 2 && (
          <>
            <div>
              <div className="lbl2">对这份标书的要求</div>
              {/* 20 行专家提示词折成三个开关(默认全开);全文在「高级」里,改了就以改的为准 */}
              <div className="req-switches" id="njReqSwitches">
                {NJ_REQ_SWITCHES.map(sw => (
                  <label className="req-sw" key={sw.key} data-req={sw.key}>
                    <Switch size="small" checked={NJ.reqOpts[sw.key] !== false} disabled={NJ.reqCustom}
                      onChange={v => setReqOpt(sw.key, v)} />
                    <span><b>{sw.label}</b><i>{sw.hint}</i></span>
                  </label>
                ))}
                {NJ.reqCustom && <div className="req-custom">要求已按你在高级框里改的为准,开关暂不生效。
                  <a onClick={resetReq} style={{ marginLeft: 6 }}>恢复为开关生成的版本</a></div>}
              </div>
              <details className="setdet" style={{ marginTop: 8 }} open={NJ.reqCustom || undefined}>
                <summary>高级 · 查看 / 修改完整要求{NJ.reqCustom ? '(已自定义)' : ''}</summary>
                <Input.TextArea id="njReq" rows={9} value={NJ.req} onChange={e => editReq(e.target.value)}
                  style={{ font: "400 12px/1.7 'SF Mono',Menlo,Consolas,monospace", marginTop: 6 }} />
              </details>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="lbl2">场景模板</div>
                {/* 原生 select:经典 spec 与 problemAction 用 el('njTemplate').value 直接驱动 */}
                <select id="njTemplate" className="nsel" value={NJ.template}
                  onChange={e => { NJ.template = e.target.value; bump(); }}>
                  <option value="auto">自动推荐（推荐）</option>
                  {(S.templates || []).filter(x => x && x.id).map(x => (
                    <option key={x.id} value={String(x.id)}>{x.name || x.title || x.id}</option>))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div className="lbl2">归入项目(选填)</div>
                <Input value={NJ.project} onChange={e => { NJ.project = e.target.value; bump(); }} placeholder="如:2026 华南区" />
              </div>
            </div>
            <TemplatePanel />
            <TemplateDraftCard />
            {NJ.msg && <div style={{ color: 'var(--red)', fontSize: 12.5 }}>{NJ.msg}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => { NJ.step = 1; NJ.msg = ''; bump(); }}>上一步</Button>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button disabled={NJ.starting} onClick={() => njStart(false)}>先暂存,稍后跑</Button>
                <Button type="primary" loading={NJ.starting} onClick={() => njStart(true)}>开始生成</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
