// 三段式问题横幅的状态部分:逐字对应经典 presentProblem/clearProblem,渲染交给 React。
import { S, ui } from './store.js';
import { _friendlyText } from './gen/pure.js';

export function presentProblem(problem){
  const p=problem||{}, key=p.job_id||S.active||'_global';
  S.problems[key]={title:_friendlyText(p.title||'任务需要处理'),text:_friendlyText(p.text||p.message||'请查看详情后重试。'),
    detail:String(p.detail||p.technical_detail||''),level:p.level||'error',actions:p.actions||[]};
  ui.render('problem');
}
export function clearProblem(){const key=S.active||'_global';delete S.problems[key];ui.render('problem');}
