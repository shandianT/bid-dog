// 命令面板(⌘K / Ctrl+K):打字就能切任务、开检查、切外观,全程键盘。
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { S, ui, bump, select, publicTaskState, PUBLIC_TASK_LABELS, checkForUpdate, jobState,
         deliveryViewModel } from '../core/index.js';
import { njOpen } from './newjob-core.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { paletteItems } from './palette-items.js';

export function openPalette(on){ S.paletteOpen = on == null ? !S.paletteOpen : !!on; bump(); }

export default function Palette(){
  const open = !!S.paletteOpen;
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { if(open){ setQ(''); setIdx(0); setTimeout(() => inputRef.current && inputRef.current.focus && inputRef.current.focus(), 30); } }, [open]);
  const job = S.active ? (S.jobs || []).find(x => x.job_id === S.active) : null;
  const state = job ? publicTaskState(job) : '';
  const vm = job ? deliveryViewModel(job, S.arts[S.active] || []) : { primary: null };
  const close = () => openPalette(false);
  const wrap = f => () => { close(); f && f(); };
  const ctx = {
    jobs: (S.jobs || []), active: S.active,
    stateLabel: j => PUBLIC_TASK_LABELS[publicTaskState(j)] || '',
    selectJob: id => { close(); select(id); },
    newJob: wrap(() => njOpen()),
    openCheck: wrap(() => ui.openCheck()), openCoverage: wrap(() => ui.openCoverage()),
    openLog: wrap(() => ui.openLog()), openFolder: wrap(() => ui.openJobFolder()),
    canRedo: !!(job && S.online && ['completed', 'failed', 'needs_input'].includes(state)),
    openRedo: wrap(() => ui.openRedo()),
    hasResult: !!(job && vm.primary && (state === 'completed' || state === 'needs_input')),
    showingResult: !!(job && S.processView[S.active] !== true),
    toggleResult: wrap(() => { S.processView[S.active] = S.processView[S.active] !== true; bump(); }),
    canCompare: !!(job && (S.arts[S.active] || []).some(a => a.name === '招标文件_解析版.md')),
    openCompare: wrap(() => ui.openSheet('compare')),
    openAssets: wrap(() => ui.openSheet('assets')), openSettings: wrap(() => ui.openSheet('providers')),
    openUsage: wrap(() => ui.openSheet('usage')),
    openCapability: wrap(() => ui.openSheet('capability')),
    openAb: wrap(() => { ui.openSheet('providers'); setTimeout(() => { const d = document.getElementById('abDetails'); if(d){ d.open = true; d.scrollIntoView({ block: 'center' }); } }, 120); }),
    importZip: wrap(() => { const el = document.getElementById('zipin'); if(el) el.click(); }),
    checkUpdate: wrap(() => checkForUpdate()),
    prefs: getPrefs(), setPrefs: p => { close(); setPrefs(p); bump(); },
  };
  const items = open ? paletteItems(q, ctx) : [];
  const cur = Math.min(idx, Math.max(0, items.length - 1));
  function onKey(e){
    if(e.key === 'ArrowDown'){ e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if(e.key === 'Enter'){ e.preventDefault(); const it = items[cur]; if(it && it.run) it.run(); }
  }
  let lastGroup = '';
  return (
    <Modal open={open} onCancel={close} footer={null} width={560} centered closable={false}
      className="palette" styles={{ body: { padding: '6px 4px 2px' } }} destroyOnHidden>
      <div id="palette" onKeyDown={onKey}>
        <Input ref={inputRef} id="paletteInput" className="pal-input" size="large" variant="borderless"
          prefix={<SearchOutlined style={{ color: 'var(--faint)' }} />}
          placeholder="切换任务、出件前检查、深色模式、字号…" value={q}
          onChange={e => { setQ(e.target.value); setIdx(0); }} allowClear />
        <div className="pal-list" id="paletteList">
          {!items.length && <div className="pal-empty">没有匹配「{q}」的任务或动作</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="pal-group" key={'g' + it.group}>{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <React.Fragment key={it.key}>
                {head}
                <div className={'pal-item' + (i === cur ? ' on' : '')} data-pal={it.key}
                  onMouseEnter={() => setIdx(i)} onClick={() => it.run && it.run()}>
                  <span className="pl">{it.label}</span>
                  {it.hint ? <span className="ph">{it.hint}</span> : null}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>⏎</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span><span><kbd>⌘N</kbd> 新建任务</span><span><kbd>⌘⏎</kbd> 发送 / 提交</span></div>
      </div>
    </Modal>
  );
}
