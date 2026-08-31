import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.jsx'
import './app.css'

// 设计令牌集中在这里:品牌蓝沿用现产品(#0a63c9 系),中性色转微冷灰,
// 圆角 10,阴影用「key+ambient」双层。组件观感全部由 AntD 5 承担。
const theme = {
  token: {
    colorPrimary: '#0f62d6', colorInfo: '#0f62d6', colorLink: '#0f62d6',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: "-apple-system,BlinkMacSystemFont,'PingFang SC','HarmonyOS Sans SC','MiSans','Microsoft YaHei UI','Segoe UI',Roboto,sans-serif",
    colorBgLayout: '#f4f6f9',
    colorText: '#181a1f', colorTextSecondary: '#54575f', colorTextTertiary: '#8b8f98',
    colorBorder: '#e2e5ea', colorBorderSecondary: '#eceef2',
    boxShadowTertiary: '0 1px 2px rgba(16,24,40,.05),0 2px 10px rgba(16,24,40,.04)',
  },
  components: {
    Card: { paddingLG: 18, borderRadiusLG: 14 },
    Button: { fontWeight: 550, controlHeight: 34 },
    Tabs: { titleFontSize: 13.5, horizontalMargin: '0 0 14px 0' },
    Steps: { titleLineHeight: 22 },
    Alert: { borderRadiusLG: 12 },
    Drawer: { paddingLG: 22 },
    Segmented: { itemSelectedBg: '#fff' },
  },
}

createRoot(document.getElementById('root')).render(
  <ConfigProvider locale={zhCN} theme={theme}>
    <AntApp><App /></AntApp>
  </ConfigProvider>
)
