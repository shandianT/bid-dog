// 界面偏好:外观(跟随系统 / 浅色 / 深色)与字号档位。存 localStorage,不进引擎,core 不依赖它。
// 应用方式只有两处:<html data-theme> 给 CSS 令牌换色,--fs-scale 给 5 档字阶整体缩放;
// AntD 那一侧由 main.jsx 读同一份偏好切 darkAlgorithm。
const KEY = 'biddog.prefs';
export const THEMES = ['system', 'light', 'dark'];
export const FONT_SCALES = { sm: 0.92, md: 1, lg: 1.1 };

let prefs = { theme: 'system', fontScale: 'md' };
const listeners = new Set();
try{
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if(raw){ const v = JSON.parse(raw); if(v && typeof v === 'object') prefs = normalize({ ...prefs, ...v }); }
}catch(_){}
const media = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function normalize(p){
  return { theme: THEMES.includes(p.theme) ? p.theme : 'system',
           fontScale: FONT_SCALES[p.fontScale] ? p.fontScale : 'md' };
}
export function getPrefs(){ return prefs; }
export function resolvedTheme(p = prefs){
  return (p.theme === 'dark' || (p.theme === 'system' && media && media.matches)) ? 'dark' : 'light';
}
export function applyPrefs(){
  if(typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.dataset.themePref = prefs.theme;
  root.dataset.fontScale = prefs.fontScale;
  root.style.setProperty('--fs-scale', String(FONT_SCALES[prefs.fontScale] || 1));
  listeners.forEach(f => { try{ f(prefs); }catch(_){} });
}
export function setPrefs(patch){
  prefs = normalize({ ...prefs, ...(patch || {}) });
  try{ localStorage.setItem(KEY, JSON.stringify(prefs)); }catch(_){}
  applyPrefs();
  return prefs;
}
export function onPrefs(f){ listeners.add(f); return () => listeners.delete(f); }
if(media){
  const onChange = () => { if(prefs.theme === 'system') applyPrefs(); };
  if(media.addEventListener) media.addEventListener('change', onChange);
  else if(media.addListener) media.addListener(onChange);
}
