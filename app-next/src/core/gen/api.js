// 由 tools/extract-core.mjs 从经典前端自动抽取(基准 main + PR #10)。
// 不要手改本文件:改经典源码或抽取脚本后重跑抽取。
import { net } from '../env.js';
import { presentProblem } from '../problems.js';

export async function api(p, opt){
  const original = opt || {}, requestOpt = Object.assign({}, original);
  const method = String(requestOpt.method || 'GET').toUpperCase();
  const timeoutMs = Number(original.timeoutMs ||
    (p==='/v1/setup/connect' ? 35000 : (p==='/v1/jobs' && method==='POST' ? 600000 : (method==='GET' ? 20000 : 60000))));
  delete requestOpt.timeoutMs;
  const controller = typeof AbortController!=='undefined' ? new AbortController() : null;
  let timer = null;
  if(controller){
    requestOpt.signal = controller.signal;
    if(original.signal){
      if(original.signal.aborted) controller.abort();
      else original.signal.addEventListener('abort', ()=>controller.abort(), {once:true});
    }
    timer = setTimeout(()=>controller.abort(), timeoutMs);
  }
  let r;
  try{ r = await fetch(net.API + p, requestOpt); }
  catch(err){
    const timedOut = !!(controller && controller.signal.aborted && !(original.signal&&original.signal.aborted));
    const e = new Error(timedOut ? '请求等待超时，任务不会丢失；请刷新状态后重试' : '本地服务暂时没有响应，请稍后重试');
    e.code = timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR'; e.cause = err; throw e;
  }finally{ if(timer)clearTimeout(timer); }
  const requestId = r.headers && r.headers.get ? (r.headers.get('X-Request-ID') || '') : '';
  if(!r.ok){
    let body = null; try{ body = await r.json(); }catch(_){}
    const e = new Error((body && (body.error || body.detail)) || (p+' '+r.status));
    e.status = r.status; e.body = body; if(body && body.code) e.code = body.code;
    e.requestId = requestId || (body&&body.request_id) || '';
    if(e.code === 'version_sunset'){
      presentProblem({job_id:'_global', level:'error', title:'当前版本已停止支持',
        text: e.message || '请更新到最新版本后继续生成;已生成的内容与素材库不受影响。',
        actions: [{act:'app_update', label:'立即更新'}, {act:'open_update_page', label:'手动下载'}]});
    }
    throw e;
  }
  const data = await r.json();
  if(data && typeof data==='object' && requestId && !data.request_id) data.request_id = requestId;
  return data;
}
