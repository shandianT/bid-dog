// 应用更新面板:三步清单(真实字节/无总长不编百分比)+ 运行中任务警告 + 重启遮罩。
// 结构与文案逐字对应经典 #updSheet / #updRestart。
import React from 'react';
import { Modal } from 'antd';
import { S, ui, runningJobsForUpdate, BUNDLED_ENGINE_VERSION } from '../core/index.js';
import { UPD, UPDATE_STEPS, fmtMB, runUpdate } from './update-core.js';

function Steps(){
  const order = UPDATE_STEPS.map(x => x[0]), at = order.indexOf(UPD.stage);
  return (
    <div className="upd-steps" id="updSteps">
      {UPDATE_STEPS.map(([key, label], i) => {
        const cls = at < 0 ? '' : (i < at ? 'done' : i === at ? 'active' : '');
        let right = '', bar = null;
        if(key === 'download' && i === at){
          right = UPD.total > 0 ? Math.floor(UPD.received / UPD.total * 100) + '%' : fmtMB(UPD.received);
          if(UPD.total > 0) bar = <div className="upd-bar"><b style={{ width: Math.min(100, Math.floor(UPD.received / UPD.total * 100)) + '%' }} /></div>;
        } else if(cls === 'done') right = '已完成';
        else if(cls === 'active') right = '进行中';
        return (
          <div key={key}>
            <div className={'upd-step ' + cls}><span className="si">{cls === 'done' ? '✓' : (i + 1)}</span>
              <span className="sn">{label}</span><span className="sr">{right}</span></div>
            {bar}
          </div>
        );
      })}
    </div>
  );
}

export function UpdateRestart(){
  if(!UPD.restart) return null;
  return (
    <div className="upd-restart" id="updRestart" style={{ display: 'flex' }}>
      <div className="box"><i className="spin b" style={{ width: 22, height: 22, borderWidth: 2.5 }} />
        <b>正在重启应用</b>
        <span>新版本已安装完成,正在关闭旧版本并启动新版本。请不要手动关闭窗口。</span></div>
    </div>
  );
}

export default function UpdateSheet(){
  const open = !!(S.sheet && S.sheet.name === 'update');
  if(!open) return null;
  const info = S.updateInfo || {};
  const busy = runningJobsForUpdate();
  const notes = String(info.notes || '').trim();
  return (
    <Modal open={open} onCancel={S.updating ? undefined : ui.closeAll} footer={null} width={500} centered
      closable={!S.updating} maskClosable={false} title={null}>
      <div id="updSheet" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="upd-kicker">应用更新</div>
          <h2 id="updTitle" style={{ margin: 0, fontSize: 16.5 }}>有新版本 v{info.version}</h2>
          <div className="desc2" id="updVersions">当前 v{S.engineVersion || BUNDLED_ENGINE_VERSION} → 新版 v{info.version}</div>
        </div>
        {notes && <div className="upd-notes" id="updNotes">{notes}</div>}
        {busy.length > 0 && (
          <div className="upd-warn" id="updWarn" style={{ display: 'flex' }}>
            <span>⚠</span><div><b>有 {busy.length} 个任务正在生成</b>
              更新需要重启应用,这些任务会停在当前检查点。已写完的章节不会丢,重启后在任务里点「从断点继续」就能接着跑。
              不想中断的话,可以等它跑完再更新。</div>
          </div>
        )}
        <Steps />
        <div className="upd-foot" id="updFoot">{UPD.foot}</div>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }} id="updActions">
          {UPD.showLater && <button className="btn-plain" type="button" id="updLater" onClick={ui.closeAll}>{UPD.laterText}</button>}
          {UPD.showGo && <button className="btn-primary" type="button" id="updGo" onClick={runUpdate}>{UPD.goText}</button>}
        </div>
      </div>
    </Modal>
  );
}
