import { useSyncExternalStore } from 'react';
import { subscribe, getVersion } from './core/index.js';

// 订阅整仓:core 每次 bump 触发一轮 React 重渲。界面规模(几百节点)下全量 diff 足够快,
// 与经典「事件驱动全量重绘对应区域」是同一个开销级别,不做过早优化。
export function useS(){ return useSyncExternalStore(subscribe, getVersion, getVersion); }
