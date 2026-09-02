import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { installGlobals } from './core/index.js'
import { installUiBridge } from './ui-bridge.jsx'
import App from './App.jsx'
import Showcase from './Showcase.jsx'
import { getPrefs, setPrefs, applyPrefs, onPrefs, resolvedTheme, FONT_SCALES } from './prefs.js'
import './live.css'

// 设计令牌集中在这里:品牌蓝沿用现产品(#0a63c9 系),中性色转微冷灰,
// 圆角 10,阴影用「key+ambient」双层。组件观感全部由 AntD 6 承担。
// 深色:AntD darkAlgorithm + 同一套令牌换成夜间值;CSS 那侧由 <html data-theme> 换 live.css 的变量。
function buildTheme(dark, scale){
  const light = {
    colorBgLayout: '#f4f6f9', colorBgContainer: '#ffffff', colorBgElevated: '#ffffff',
    colorText: '#181a1f', colorTextSecondary: '#54575f', colorTextTertiary: '#8b8f98',
    colorBorder: '#e2e5ea', colorBorderSecondary: '#eceef2',
    boxShadowTertiary: '0 1px 2px rgba(16,24,40,.05),0 2px 10px rgba(16,24,40,.04)',
  }
  const night = {
    colorBgLayout: '#101318', colorBgContainer: '#181c23', colorBgElevated: '#1f242c',
    colorText: '#e6e8ec', colorTextSecondary: '#aab0bb', colorTextTertiary: '#7c838f',
    colorBorder: '#2b313b', colorBorderSecondary: '#232830',
    boxShadowTertiary: '0 1px 2px rgba(0,0,0,.35),0 2px 10px rgba(0,0,0,.28)',
  }
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#4d8df0' : '#0f62d6', colorInfo: dark ? '#4d8df0' : '#0f62d6', colorLink: dark ? '#4d8df0' : '#0f62d6',
      borderRadius: 10,
      fontSize: Math.round(14 * scale * 10) / 10,
      fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','HarmonyOS Sans SC','MiSans','Microsoft YaHei UI','Segoe UI',Roboto,sans-serif",
      ...(dark ? night : light),
    },
    components: {
      Card: { paddingLG: 18, borderRadiusLG: 14 },
      Button: { fontWeight: 550, controlHeight: 34 },
      Tabs: { titleFontSize: 13.5, horizontalMargin: '0 0 14px 0' },
      Steps: { titleLineHeight: 22 },
      Alert: { borderRadiusLG: 12 },
      Drawer: { paddingLG: 22 },
      Segmented: { itemSelectedBg: dark ? '#2a3038' : '#fff' },
    },
  }
}

function Root({ showcase }){
  const [prefs, setP] = useState(getPrefs())
  useEffect(() => { applyPrefs(); return onPrefs(v => setP({ ...v })) }, [])
  const dark = resolvedTheme(prefs) === 'dark'
  const scale = FONT_SCALES[prefs.fontScale] || 1
  return (
    <ConfigProvider locale={zhCN} theme={buildTheme(dark, scale)}>
      <AntApp>{showcase ? <Showcase /> : <App />}</AntApp>
    </ConfigProvider>
  )
}

// ?showcase=1 保留路线一评估原型(纯假数据);默认进真实应用。
const SHOWCASE = /[?&]showcase=1/.test(location.search)
applyPrefs()
if(!SHOWCASE){
  installGlobals(); installUiBridge()
  // 测试座:外观/字号偏好可由 spec 直接驱动与读回
  window.getPrefs = getPrefs; window.setPrefs = setPrefs
}

createRoot(document.getElementById('root')).render(<Root showcase={SHOWCASE} />)
