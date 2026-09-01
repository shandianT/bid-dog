// 运行环境判定:逐字对应经典前端 991–1015 行,只加了 typeof 守卫让 core 能在 node 里跑测试。
export const IS_WEB = typeof location !== 'undefined'
  && /^https?:$/.test(location.protocol) && !/tauri\.localhost$/.test(location.hostname);
export const IS_SOURCE_PREVIEW = typeof location !== 'undefined' && location.protocol === 'file:';
/* 公网展示用:?demo=1 强制演示模式——不探测访客本机端口、不连任何引擎,纯前端跑完整流程 */
export const FORCE_DEMO = typeof location !== 'undefined' && /[?&]demo=1/.test(location.search);
export const BUNDLED_ENGINE_VERSION = '0.21.0';
/* 每个安装版只认自己的专属端口和版本。旧 App 覆盖安装后,旧 PyInstaller 进程可能仍驻留;
   若继续探测历史端口,就会把旧引擎误认成新版,甚至在可执行文件被替换后返回 500。 */
export const DESKTOP_ENGINE = 'http://127.0.0.1:18901';
export const API_CANDIDATES = IS_WEB ? [location.origin] : [DESKTOP_ENGINE];
/* 旧版曾把探测成功的端口写进 bid_api;新版不再读取,并在桌面启动时主动废弃它。 */
if(!IS_WEB && typeof localStorage !== 'undefined'){ try{ localStorage.removeItem('bid_api'); }catch(_){} }
/* API 在探测成功后由 findEngine 改写;放在对象里让所有模块看到同一个当前值。 */
export const net = { API: API_CANDIDATES[0] || DESKTOP_ENGINE };
export const NEED_FEATURES = ['probe_models', 'agent_binding', 'attachments', 'artifact_open', 'job_folder_open'];
export const isWin = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win');
export const ASK_SELF = '我来输入';     // 界面自己的自救入口,渲染与点击两处都用它,别写死字面量
