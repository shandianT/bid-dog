// 测试座:经典前端所有函数都是 <script> 顶层全局,Playwright 用例靠 page.evaluate 直呼它们。
// 迁移后模块化了,这里按同样的名字挂回 window——既有 spec 只需换选择器,不用换驱动方式。
import * as pure from './gen/pure.js';
import * as jobs from './gen/jobs.js';
import { api } from './gen/api.js';
import * as demo from './gen/demo.js';
import { S, ui, bump } from './store.js';
import { presentProblem, clearProblem } from './problems.js';
import { applyHealthUpdate, checkForUpdate, pollHealthUpdate, openUpdate, runningJobsForUpdate } from './update.js';
import { findEngine, goOnline, showEngineOffline, boot } from './conn.js';
import { IS_WEB, IS_SOURCE_PREVIEW, FORCE_DEMO, BUNDLED_ENGINE_VERSION, ASK_SELF, net, isWin } from './env.js';

export function installGlobals(target){
  const g = target || (typeof window !== 'undefined' ? window : globalThis);
  Object.assign(g, pure, jobs, demo,
    { S, ui, bump, api, presentProblem, clearProblem,
      applyHealthUpdate, checkForUpdate, pollHealthUpdate, openUpdate, runningJobsForUpdate,
      findEngine, goOnline, showEngineOffline, boot,
      IS_WEB, IS_SOURCE_PREVIEW, FORCE_DEMO, BUNDLED_ENGINE_VERSION, ASK_SELF, net, isWin });
  return g;
}
