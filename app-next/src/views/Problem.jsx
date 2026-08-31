// 三段式问题横幅:发生了什么 → 内容是否保留 → 主按钮+次按钮,其余收进「更多」。
// 结构与按钮策略逐字对应经典 renderProblem/problemAction。
import React, { useState } from 'react';
import { S, ui, bump, clearProblem, errAction, resumeJob, stopJob, archiveJob, restoreJob,
         exportJobs, setTaskScope, _friendlyActionLabel } from '../core/index.js';
import { applyProjectMoveWith } from './project-move.js';

export function problemAction(act, param){
  const p = S.problems[S.active || '_global'] || S.problems._global || {};
  if(act === 'dismiss'){ clearProblem(); return; }
  if(act === 'show_detail'){ ui.showDiagnosticDetail(p.detail || param || '暂无更多技术信息'); return; }
  if(act === 'diagnose'){ ui.runDiagnostics(); return; }
  if(act === 'continue_saved' || act === 'open_revision'){ ui.openRevision(); return; }
  if(act === 'complete_setup'){ ui.showOnboarding(true); return; }
  if(act === 'reload_archived'){ setTaskScope('archived'); return; }
  if(act === 'retry_archive'){ archiveJob(param); return; }
  if(act === 'retry_restore'){ restoreJob(param); return; }
  if(act === 'retry_export'){ exportJobs(S.lastExportIds || []); return; }
  if(act === 'retry_project'){ S.projectTargetIds = String(param || '').split(',').filter(Boolean); ui.openProjectMove(S.projectTargetIds); return; }
  if(act === 'retry_stop'){ stopJob(); return; }
  if(act === 'retry_revision'){ ui.openRevision(); return; }
  if(act === 'retry_template_save' || act === 'retry_template_delete'){ ui.toast('模板操作在设置面板迁移后可重试(迁移中)'); return; }
  errAction(act, '', param);
}

export default function Problem(){
  const key = S.active || '_global', p = S.problems[key] || S.problems._global;
  const [moreOpen, setMoreOpen] = useState(false);
  if(!p) return null;
  // 诊断弹层在场时横幅退让(经典 dataset.hiddenForDiagnostic 的等价实现):
  // 横幅上点「一键诊断/查看原因」后,不该在弹层后面还压着一条红。
  if(S.sheet && S.sheet.name === 'diagnostic') return null;
  const acts = (p.actions && p.actions.length ? p.actions : [{ act: 'diagnose', label: '一键诊断' }]).slice();
  if(p.detail && !acts.some(a => a.act === 'show_detail')) acts.push({ act: 'show_detail', label: '查看原因' });
  if(!acts.some(a => a.act === 'diagnose')) acts.push({ act: 'diagnose', label: '一键诊断' });
  const primary = acts[0], secondary = acts[1], rest = acts.slice(2);
  const Btn = ({ a, pp }) => <button type="button" className={pp ? 'pp' : ''}
    data-problem-action={a.act} data-param={a.param || ''}
    onClick={() => problemAction(a.act, a.param || '')}>{_friendlyActionLabel(a.label)}</button>;
  return (
    <div className="problem-host" id="problemHost" aria-live="assertive">
      <div className={'problem-card ' + p.level}>
        <span className="pi">{p.level === 'info' ? 'i' : p.level === 'warn' ? '!' : '×'}</span>
        <div className="problem-copy">
          <b>{p.title}</b><span>{p.text}</span>
          <div className="problem-actions">
            <Btn a={primary} pp />
            {secondary && <Btn a={secondary} />}
            {rest.length > 0 && (
              <span className="problem-more">
                <button type="button" onClick={e => { e.stopPropagation(); setMoreOpen(v => !v); }}>更多 ▾</button>
                <span className={'problem-more-menu' + (moreOpen ? ' open' : '')}>{rest.map((a, i) => <Btn key={i} a={a} />)}</span>
              </span>
            )}
          </div>
        </div>
        <button className="problem-close" type="button" aria-label="关闭" data-problem-action="dismiss" onClick={() => problemAction('dismiss')}>×</button>
      </div>
    </div>
  );
}
