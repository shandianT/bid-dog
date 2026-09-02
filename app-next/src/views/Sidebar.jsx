// 左栏:品牌行(版本徽章=手动检查更新入口)、新建任务、范围页签、项目筛选、
// 分组任务列表(批量管理/归档/行菜单)、素材库/设置/更新入口/连接状态。
// 渲染公式逐字对应经典 renderTasks/taskRow/renderTaskFilters/renderBrandVersion。
import React, { useRef } from 'react';
import { Checkbox, Tooltip, Segmented, Button, Select, Empty, Badge } from 'antd';
import { PlusOutlined, FolderOutlined, SettingOutlined, MoreOutlined,
         InboxOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { S, ui, bump, taskPresentation, publicTaskState, taskGroupOpen, checkForUpdate,
         visibleTaskJobs, setTaskScope, setTaskProjectFilter, setTaskBulkMode,
         toggleTaskSelection, toggleAllTaskSelection, runBulkTaskAction, deleteSelectedJobs,
         archiveJob, restoreJob, runTaskRowAction, select, BUNDLED_ENGINE_VERSION } from '../core/index.js';
import { njAddFiles } from './newjob-core.js';
import Logo from '../Logo.jsx';

const STATE_COLOR = { preparing:'var(--dim)', generating:'var(--blue)', needs_input:'var(--amber)', completed:'var(--green)', failed:'var(--red)' };

function TaskRow({ j, compact }){
  const on = j.job_id === S.active;
  const p = (S.prog[j.job_id] && S.prog[j.job_id].pct) != null ? S.prog[j.job_id].pct : j.pct || 0;
  const live = S.prog[j.job_id] || {}, view = Object.assign({}, j);
  if(!view.current_action && live.stage) view.current_action = live.stage;
  const present = taskPresentation(view);
  const checked = !!(S.taskSelected && S.taskSelected.has(j.job_id));
  const archived = S.taskScope === 'archived' || !!j.archived_at;
  const menuOpen = !S.taskBulkMode && S.taskMore === j.job_id;
  return (
    <div className={'task' + (compact ? ' dn' : '') + (on ? ' on' : '')} data-id={j.job_id}
      onClick={() => { if(S.taskBulkMode) toggleTaskSelection(j.job_id, !S.taskSelected.has(j.job_id)); else select(j.job_id); }}>
      <div className="nm">
        {S.taskBulkMode && <Checkbox className="task-check" checked={checked}
          onClick={e => e.stopPropagation()}
          onChange={e => toggleTaskSelection(j.job_id, e.target.checked)}
          aria-label={'选择任务 ' + (j.name || j.job_id)} />}
        {/* 出了 Word 但没过门禁的「待处理」用独立色阶,不和「需要你确认」的琥珀混 */}
        <span className={'dot' + (present.state === 'failed' && j.has_word ? ' pending' : '')}
          style={{ background: present.state === 'failed' && j.has_word ? 'var(--violet)' : STATE_COLOR[present.state] }} />
        <span className="tn" title={j.name || j.job_id}>{j.name || j.job_id}</span>
        {!S.taskBulkMode && <>
          <button className="task-archive" type="button" title={archived ? '恢复' : '归档'}
            onClick={e => { e.stopPropagation(); archived ? restoreJob(j.job_id) : archiveJob(j.job_id); }}>
            {archived ? '恢复' : '归档'}</button>
          <button className="task-more" type="button" aria-label="更多操作"
            onClick={e => { e.stopPropagation(); S.taskMore = S.taskMore === j.job_id ? null : j.job_id; bump(); }}><MoreOutlined /></button>
        </>}
      </div>
      <div className="st">
        {j.project_id ? <span className="project-tag" title={j.project_id}>{j.project_id}</span> : null}
        {present.currentAction} · {present.lastActivity}{present.eta && present.eta !== '—' ? ' · ' + present.eta : ''}
      </div>
      {!compact && <div className="bar"><b style={{ width: Math.max(0, Math.min(100, p)) + '%' }} /></div>}
      {menuOpen && <div className="task-menu" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={() => runTaskRowAction(archived ? 'restore' : 'archive', j.job_id)}>{archived ? '恢复到当前' : '归档'}</button>
        <button type="button" onClick={() => runTaskRowAction('rerun', j.job_id)}>重新生成</button>
        <button type="button" onClick={() => runTaskRowAction('export', j.job_id)}>导出</button>
        <button type="button" onClick={() => runTaskRowAction('project', j.job_id)}>归入项目</button>
        <button type="button" className="danger" onClick={() => runTaskRowAction('delete', j.job_id)}>删除任务</button>
      </div>}
    </div>
  );
}

function BulkPanel({ visibleJobs }){
  if(!visibleJobs.length) return null;
  if(!S.taskBulkMode) return (
    <div className="taskbulk"><div className="tbrow"><span className="tbsp" />
      <button type="button" onClick={() => setTaskBulkMode(true)}>批量管理</button></div></div>
  );
  const selected = visibleJobs.filter(j => S.taskSelected.has(j.job_id)).length;
  const all = selected === visibleJobs.length;
  const busy = !!(S.taskBulkDeleting || S.taskBulkBusy);
  const dis = !selected || busy;
  return (
    <div className="taskbulk">
      <div className="tbrow"><span className="tbsp">{busy ? '处理中 · ' + selected + ' 项…' : '已选 ' + selected + ' 项'}</span>
        <button type="button" disabled={busy} onClick={() => setTaskBulkMode(false)}>退出批量</button></div>
      <div className="tbrow tbacts">
        <button type="button" disabled={busy} onClick={toggleAllTaskSelection}>{all ? '取消全选' : '全选'}</button>
        {S.taskScope === 'archived'
          ? <button type="button" disabled={dis} onClick={() => runBulkTaskAction('restore')}>恢复</button>
          : <>
              <button type="button" disabled={dis} onClick={() => runBulkTaskAction('archive')}>归档</button>
              <button type="button" disabled={dis} onClick={() => runBulkTaskAction('rerun')}>重新生成</button>
            </>}
      </div>
      <div className="tbrow tbacts">
        <button type="button" disabled={dis} onClick={() => runBulkTaskAction('export')}>导出</button>
        <button type="button" disabled={dis} onClick={() => runBulkTaskAction('project')}>归入项目</button>
        <button type="button" disabled={busy} onClick={() => { S.taskBulkMore = !S.taskBulkMore; bump(); }}>更多操作</button>
      </div>
      {S.taskBulkMore && <div className="tbrow"><span className="tbsp">谨慎操作</span>
        <button type="button" className="danger" disabled={dis} onClick={deleteSelectedJobs}>{busy ? '处理中…' : '删除所选'}</button></div>}
    </div>
  );
}

export default function Sidebar(){
  const fileRef = useRef(null);
  const g = { preparing: [], generating: [], needs_input: [], completed: [], failed: [] };
  const visibleJobs = visibleTaskJobs();
  visibleJobs.forEach(j => { g[publicTaskState(j)].push(j); });
  const projects = [...new Set((S.jobs || []).concat(S.archivedJobs || []).map(j => j.project_id).filter(Boolean))].sort();
  const info = S.updateInfo;
  const IS_WEB_LINK = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/tauri\.localhost$/.test(location.hostname);

  const grp = (key, label, compact) => {
    const list = g[key]; if(!list.length) return null;
    const open = taskGroupOpen(key, S.taskGrpOpen, S.taskBulkMode);
    // 组折叠时,正在看的那一单要单独钉出来(经典同注释:折叠不是把当前位置藏起来)
    const pinned = (!open && S.active) ? list.filter(j => j.job_id === S.active) : [];
    return (
      <React.Fragment key={key}>
        <button type="button" className="tgrp" aria-expanded={open}
          onClick={() => { if(!S.taskBulkMode){ S.taskGrpOpen[key] = !S.taskGrpOpen[key]; bump(); } }}>
          <span>{label} · {list.length}</span><span className="tgx">{open ? '收起' : '展开'}</span>
        </button>
        {(open ? list : pinned).map(j => <TaskRow key={j.job_id} j={j} compact={compact} />)}
      </React.Fragment>
    );
  };

  return (
    <aside className="sider">
      <div className="brand">
        <span className="logo"><Logo size={26} />
          <span className="bd" id="brandDot" style={{ background: S.brandDot === 'ok' ? 'var(--green)' : 'var(--amber)' }} /></span>
        <b>中标狗</b>
        <span className={'ver' + (info ? ' new' : '')} id="brandVer" role="button" tabIndex={0}
          title={info ? '有新版 v' + info.version + ',点这里查看并更新' : '当前版本,点击检查更新'}
          onClick={() => checkForUpdate()}
          onKeyDown={e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); checkForUpdate(); } }}>
          {S.checkingUpdate ? '检查中…' : 'v' + (S.engineVersion || BUNDLED_ENGINE_VERSION)}
        </span>
      </div>

      <div className="newbtn" onClick={() => fileRef.current && fileRef.current.click()}>
        <PlusOutlined style={{ fontSize: 15 }} />
        <div className="nb-t"><b>新建任务</b><i>选择或拖入招标文件 · ⌘N</i></div>
        <input ref={fileRef} type="file" id="filein" multiple style={{ display: 'none' }}
          onChange={e => { njAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
      </div>

      <div className="task-scope" id="taskScope">
        <Segmented block className="scope-tabs" value={S.taskScope}
          onChange={v => setTaskScope(v)}
          options={[{ label: '当前任务', value: 'active' }, { label: '已归档', value: 'archived' }]} />
        {projects.length > 0 && (
          <Select className="project-filter" id="taskProjectFilter" size="small" aria-label="按项目筛选"
            value={S.projectFilter || ''} onChange={v => setTaskProjectFilter(v)}
            options={[{ value: '', label: '全部项目' }, ...projects.map(n => ({ value: n, label: n }))]} />
        )}
      </div>

      <div style={{ flex: 'none' }}>
        <div id="tasks">
          <BulkPanel visibleJobs={visibleJobs} />
          {grp('preparing', '准备中', false)}
          {grp('generating', '生成中', false)}
          {grp('needs_input', '需要你确认', false)}
          {grp('completed', '已完成', true)}
          {grp('failed', '未完成', false)}
          {!visibleJobs.length && <div className="empty-side">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={S.taskScope === 'archived' ? '归档里还没有任务' : '还没有任务'} /></div>}
        </div>
      </div>

      <div className="side-links">
        <span className="sl" onClick={() => ui.openSheet('assets')}><InboxOutlined /> 素材库</span>
        <span className="sl" onClick={() => ui.openSheet('providers')}><SettingOutlined /> 设置 · 模型接入</span>
        {info && <span className="sl" id="updateLink" style={{ color: 'var(--blue)' }} onClick={() => ui.openUpdatePanel()}>
          {IS_WEB_LINK ? '有修复版 v' + info.version + ' → 去下载' : '有新版 v' + info.version + ' → 查看并更新'}</span>}
        <span id="conn">{S.connText || '连接引擎中…'}</span>
      </div>
    </aside>
  );
}
