// 品牌标:就是桌面应用自己的图标(app/src-tauri/icons 里那只小狗),侧栏、favicon 与桌面统一一份。
import React from 'react';

export default function Logo({ size = 26, className, title = '中标狗' }){
  return <img className={className} src="/logo.png" width={size} height={size} alt={title} draggable={false} />;
}
