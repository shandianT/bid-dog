// 新建任务向导:第 1 步放文件(多选/整文件夹、主件自动识别),第 2 步要求与项目归属。
// 提交路径在 newjob-core.js(经典 njStart 逐字);模板推荐/派生在视图迁移 C 补全。
import React, { useRef } from 'react';
import { Modal, Input, Checkbox, Select, Button, Steps } from 'antd';
import { S, ui, bump } from '../core/index.js';
import { NJ, DOCLIKE, njAddFiles, njPickTender, njStart, njReset } from './newjob-core.js';
import { fmtSize } from '../lib.js';

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
              <Button type="primary" disabled={NJ.tenderIdx < 0} onClick={() => { NJ.step = 2; bump(); }}>下一步</Button>
            </div>
          </>
        )}
        {NJ.step === 2 && (
          <>
            <div>
              <div className="lbl2">对这份标书的要求(可改,已预填专家提示词)</div>
              <Input.TextArea rows={9} value={NJ.req} onChange={e => { NJ.req = e.target.value; bump(); }}
                style={{ font: "400 12px/1.7 'SF Mono',Menlo,Consolas,monospace" }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="lbl2">场景模板</div>
                <Select style={{ width: '100%' }} value={NJ.template} onChange={v => { NJ.template = v; bump(); }}
                  options={[{ value: 'auto', label: '自动(按采购对象与评标办法推荐)' }]} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="lbl2">归入项目(选填)</div>
                <Input value={NJ.project} onChange={e => { NJ.project = e.target.value; bump(); }} placeholder="如:2026 华南区" />
              </div>
            </div>
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
