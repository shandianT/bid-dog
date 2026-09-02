// 任务导入:同事导出的 zip(/v1/jobs/export 的产物)→ 本机新任务,接着改、接着交付。
// export 早就有了,协作的另一半一直缺着;导入只收交付物与说明文件,不带 Key、不带日志。
import { S, ui, api, select } from '../core/index.js';

export async function importJobZip(file){
  if(!file) return null;
  if(!S.online){ ui.toast('本地服务未连接,导入需要引擎'); return null; }
  if(!/\.zip$/i.test(file.name || '')){ ui.toast('请选择中标狗导出的 .zip 任务包'); return null; }
  ui.toast('正在导入 ' + file.name + ' …');
  const fd = new FormData(); fd.append('file', file);
  try{
    const r = await api('/v1/jobs/import', { method: 'POST', body: fd, timeoutMs: 120000 });
    if(!r || !r.ok){ ui.toast('导入失败:' + ((r && r.error) || '包里没有可用文件')); return null; }
    S.jobs = await api('/v1/jobs');
    ui.render('tasks');
    select(r.job_id);
    ui.toast('已导入「' + (r.name || r.job_id) + '」:' + r.files + ' 个文件' + (r.skipped ? ',跳过 ' + r.skipped + ' 个' : ''));
    return r;
  }catch(e){ ui.toast('导入失败:' + ((e && e.message) || '请确认是中标狗导出的任务包')); return null; }
}
