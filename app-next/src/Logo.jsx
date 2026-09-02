// 品牌标:一页折了角的标书(dog-ear = 狗耳,也是「中标狗」的狗)加一枚勾——中了标。
// 只用两种颜色,26px 下也认得出;同一份图形出到 public/logo.svg 给 favicon / 官网 / 通知用。
import React from 'react';

export default function Logo({ size = 26, className, title = '中标狗' }){
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
      <rect width="32" height="32" rx="8" fill="#0f62d6" />
      <path d="M9 5h10l6 6v16H9z" fill="#fff" />
      <path d="M19 5v6h6z" fill="#cfe0fa" />
      <path d="M12.5 17.5l3.5 3.5 6-7" fill="none" stroke="#0f62d6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
