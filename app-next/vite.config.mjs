import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// base:'./' —— 构建产物用相对路径,引擎的 BID_WEB_DIR 指到 dist 就能直接服务,
// 与现有单文件前端同一种分发方式,离线可用,不依赖任何 CDN。
export default defineConfig({ base: './', plugins: [react()] })
