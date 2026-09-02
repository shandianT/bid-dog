// 右栏按状态折叠:6 张卡在 940 高的窗口里要滚,可任何时刻用户真正要看的只有两三张。
// 折叠规则只看任务处于哪个阶段(纯函数,core-smoke 单测);用户手动开合记在
// S.railFold[job][card],优先于规则——但阶段一变(生成 → 出件),规则重新接管。
export const RAIL_KEYS = ['deliver', 'progress', 'coverage', 'files', 'refs', 'check'];

// phase:preparing(还没开始)/ generating(在写)/ waiting(等确认)/ halted(停了)/
//       delivered(出了 Word)/ missing(该出没出)
export function railPhase(v){
  if(v.missingWord) return 'missing';
  // 出了整册 Word 的停止/未完成(PR #10 的「待处理」)对右栏来说就是出了件:交付与检查是主角
  if(v.done100 || (v.hasPrimary && !v.running)) return 'delivered';
  if(v.waiting) return 'waiting';
  if(v.halted) return 'halted';
  if(v.staged || v.preparing) return 'preparing';
  return 'generating';
}

export function railDefaults(phase, v){
  const hasHealth = !!(v && v.hasHealth);
  switch(phase){
    case 'preparing':   // 还没开始:能做的只有补素材
      return { deliver: false, progress: false, coverage: false, files: false, refs: true, check: false };
    case 'generating':  // 在写:看进度、看覆盖、看陆续出的产物
      return { deliver: false, progress: true, coverage: true, files: true, refs: false, check: false };
    case 'waiting':
      return { deliver: false, progress: true, coverage: true, files: false, refs: false, check: false };
    case 'halted':      // 停了:进度说停在哪、产物保住了什么;有质检结论才展开检查
      return { deliver: false, progress: true, coverage: false, files: true, refs: false, check: hasHealth };
    case 'delivered':   // 出了件:交付与检查是主角,进度已经是过去式
      return { deliver: true, progress: false, coverage: true, files: false, refs: false, check: true };
    case 'missing':     // 该出没出:交付卡说清没出,进度说停在哪
      return { deliver: true, progress: true, coverage: false, files: true, refs: false, check: hasHealth };
  }
  return { deliver: false, progress: true, coverage: true, files: true, refs: false, check: false };
}

export function railIsOpen(S, id, key, phase, defaults){
  const fold = (S.railFold && S.railFold[id]) || null;
  // 手动开合只在同一阶段内有效:阶段变了,规则重新接管
  if(fold && fold._phase === phase && fold[key] != null) return !!fold[key];
  return !!defaults[key];
}

export function railToggle(S, id, key, phase, defaults, bump){
  S.railFold = S.railFold || {};
  const cur = S.railFold[id] && S.railFold[id]._phase === phase ? S.railFold[id] : { _phase: phase };
  cur[key] = !railIsOpen(S, id, key, phase, defaults);
  S.railFold[id] = cur;
  if(bump) bump();
}
