// core 出口:React 视图与测试只从这里拿东西,不直接摸 gen/ 内部路径。
export * from './env.js';
export { S, ui, bump, subscribe, getVersion } from './store.js';
export * from './gen/pure.js';
export { api } from './gen/api.js';
export * from './gen/jobs.js';
export * from './gen/tasks.js';
export * from './gen/actions.js';
export { demoBoot, demoNew, demoRun, DEMO_LOG } from './gen/demo.js';
export { presentProblem, clearProblem } from './problems.js';
export * from './update.js';
export * from './conn.js';
export { installGlobals } from './globals.js';
