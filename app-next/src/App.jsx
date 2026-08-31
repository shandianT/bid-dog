import React, { useEffect, useState } from 'react'
import {
  Badge, Button, Card, Tag, Tabs, Steps, Alert, Drawer, List, Progress,
  Input, Tooltip, Segmented, Space, Divider, Timeline, App as AntApp,
} from 'antd'
import {
  PlusOutlined, FolderOutlined, SettingOutlined, ArrowUpOutlined,
  FileWordOutlined, FolderOpenOutlined, RightOutlined, ReloadOutlined,
  CheckCircleFilled, WarningFilled, CloseCircleFilled, FileTextOutlined,
} from '@ant-design/icons'
import { JOBS, PHASES, NODES, GAPS, COVERAGE, FEED } from './fixtures.js'

const STATE_META = {
  running:   { color: 'processing', label: '生成中' },
  attention: { color: 'warning',    label: '待处理' },
  done:      { color: 'success',    label: '已完成' },
}
const GAP_DOT = { error: '#d4380d', warning: '#d48806' }

function Sider({ engineOK }) {
  const { message } = AntApp.useApp()
  return (
    <aside className="sider">
      <div className="brand">
        <span className="logo">狗</span><b>中标狗</b>
        <span style={{ flex: 1 }} />
        <Tooltip title="当前版本,点击检查更新">
          <Tag style={{ cursor: 'pointer', marginRight: 0 }} bordered
               onClick={() => message.success('已经是最新版本 v0.21.0')}>v0.21.0</Tag>
        </Tooltip>
      </div>
      <Button type="primary" size="large" icon={<PlusOutlined />} block
              style={{ height: 46, fontWeight: 600 }}>
        新建任务<span style={{ fontWeight: 400, opacity: .75, fontSize: 12, marginLeft: 6 }}>选择或拖入招标文件</span>
      </Button>
      <Segmented block options={['当前任务', '已归档']} />
      <nav className="tasklist">
        <div className="tgroup">生成中 · 1</div>
        {JOBS.filter(j => j.state === 'running').map(j => <TaskRow key={j.id} job={j} />)}
        <div className="tgroup">待处理 · 1</div>
        {JOBS.filter(j => j.state === 'attention').map(j => <TaskRow key={j.id} job={j} />)}
        <div className="tgroup">已完成 · 1</div>
        {JOBS.filter(j => j.state === 'done').map(j => <TaskRow key={j.id} job={j} />)}
      </nav>
      <div className="sfoot">
        <div className="sl"><FolderOutlined /> 素材库</div>
        <div className="sl"><SettingOutlined /> 设置 · 模型接入</div>
        <div className="sl" style={{ cursor: 'default' }}>
          <Badge status={engineOK ? 'success' : 'default'} />
          {engineOK ? '本地服务已连接' : '本地服务未连接(演示数据)'}
        </div>
        <div className="proto">路线一原型 · Ant Design 5 · 布局重构评估用</div>
      </div>
    </aside>
  )
}

function TaskRow({ job }) {
  const m = STATE_META[job.state]
  return (
    <div className={'trow' + (job.active ? ' on' : '')}>
      <div className="tn"><i className={'sdot ' + job.state} /><span>{job.name}</span></div>
      <div className="ts">{job.sub}</div>
      {job.state === 'running' &&
        <Progress percent={job.pct} size={[null, 4]} showInfo={false} style={{ margin: '0 0 0 16px', width: 'auto' }} />}
    </div>
  )
}

function FlowCard({ onOpenGaps }) {
  return (
    <Card variant="borderless" style={{ boxShadow: '0 1px 2px rgba(16,24,40,.05),0 2px 10px rgba(16,24,40,.04)' }}>
      <Steps
        size="small" labelPlacement="vertical"
        items={PHASES.map(p => ({
          status: p.warn ? 'wait' : 'finish',
          title: <span style={{ fontSize: 12.5, fontWeight: 550, color: p.warn ? '#d48806' : undefined }}>{p.title}</span>,
          description: <span style={{ fontSize: 11, color: '#9aa0ab' }}>{p.dur}</span>,
          ...(p.warn ? { icon: <WarningFilled style={{ color: '#faad14' }} /> } : {}),
        }))}
      />
      <Divider style={{ margin: '16px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <b style={{ fontSize: 13.5 }}>当前阶段 · 交付质检</b>
        <span className="nodemeta">交付门禁未完成,已停在可恢复检查点 · 已保留全部完成内容</span>
      </div>
      <List
        size="small" split={false}
        dataSource={NODES}
        renderItem={n => (
          <List.Item style={{ padding: '7px 0' }}
            actions={n.action ? [<Button key="a" size="small" icon={<ReloadOutlined />}>{n.action}</Button>] : []}>
            <Space size={9}>
              {n.state === 'done' ? <CheckCircleFilled style={{ color: '#22a06b' }} />
                                  : <CloseCircleFilled style={{ color: '#d4380d' }} />}
              <span style={{ fontWeight: 550, fontSize: 13 }}>{n.name}</span>
              <span className="nodemeta">{n.meta}</span>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  )
}

function Rail({ onOpenGaps }) {
  return (
    <aside className="rail">
      <Card variant="borderless" title="最终交付 · 先看这里"
            styles={{ header: { minHeight: 44, fontSize: 13 } }}
            style={{ boxShadow: '0 1px 2px rgba(16,24,40,.05),0 4px 16px rgba(15,98,214,.08)', border: '1px solid #d4e4fb' }}>
        <div className="wordrow">
          <div className="wordicon"><FileWordOutlined style={{ fontSize: 22 }} /></div>
          <div className="wordmeta">
            <b>投标文件_整册.docx</b>
            <span>可编辑的完整投标文件 · 提交前请人工复核、签字和盖章</span>
          </div>
        </div>
        <Space style={{ marginTop: 14 }}>
          <Button type="primary">打开</Button>
          <Button icon={<FolderOpenOutlined />}>在文件夹显示</Button>
        </Space>
      </Card>

      <Card variant="borderless" title="提交前需处理 · 3 项"
            extra={<Button size="small" type="link" onClick={onOpenGaps}>逐条处理 <RightOutlined /></Button>}
            styles={{ header: { minHeight: 44, fontSize: 13 } }}>
        {GAPS.map((g, i) => (
          <div className="gaprow" key={i}>
            <span className="gd" style={{ background: GAP_DOT[g.level] }} />
            <div className="gc">
              <div className="gt">{g.title}</div>
              <div className="gs">{g.detail}</div>
            </div>
            <Button size="small" type="link" style={{ padding: 0 }}>{g.action}</Button>
          </div>
        ))}
      </Card>

      <Card variant="borderless" title="评分点覆盖"
            extra={<Button size="small" type="link">查看明细 <RightOutlined /></Button>}
            styles={{ header: { minHeight: 44, fontSize: 13 } }}>
        <div className="covrow">
          <Progress type="circle" size={68} percent={Math.round(COVERAGE.covered / COVERAGE.total * 100)}
                    format={() => <span style={{ fontSize: 14, fontWeight: 650 }}>{COVERAGE.covered}/{COVERAGE.total}</span>}
                    status={COVERAGE.covered === 0 ? 'exception' : 'normal'} />
          <div className="covwhy">
            <span><b>{COVERAGE.unlocated} 项</b> 还没落到具体章节 <i>· 可补写应答</i></span>
            <span><b>{COVERAGE.gap} 项</b> 规划里还留着缺口 <i>· 补齐后自动计入</i></span>
          </div>
        </div>
      </Card>

      <Card variant="borderless" title="参考资料"
            extra={<Button size="small" type="link" icon={<PlusOutlined />}>添加</Button>}
            styles={{ header: { minHeight: 44, fontSize: 13 } }}>
        <span style={{ fontSize: 12, color: '#8b8f98' }}>给 AI 的写法参照,如过往标书</span>
      </Card>
    </aside>
  )
}

export default function App() {
  const [gapsOpen, setGapsOpen] = useState(false)
  const [engineOK, setEngineOK] = useState(false)
  useEffect(() => {
    // 探一次本地引擎:连得上就亮绿灯(原型只取连通性,不改动任何任务)
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 800)
    fetch('/v1/health', { signal: ctl.signal }).then(r => setEngineOK(r.ok)).catch(() => {})
      .finally(() => clearTimeout(t))
  }, [])

  return (
    <div className="shell">
      <Sider engineOK={engineOK} />
      <main className="main">
        <div className="mhead">
          <div className="mhrow">
            <h1>深圳市龙华区清湖片区棚户区改造项目</h1>
            <Tag color="warning" style={{ fontWeight: 550 }}>待处理</Tag>
            <span style={{ flex: 1 }} />
            <Button>运行日志</Button>
            <Button type="primary" onClick={() => setGapsOpen(true)}>出件前检查</Button>
          </div>
          <div className="msub">Word 已生成 · 提交前需处理 3 项 · 最后活动 1 小时前</div>
          <Tabs
            items={[
              { key: 'flow', label: '执行过程' },
              { key: 'outline', label: '标书大纲' },
              { key: 'chat', label: '对话与要求' },
            ]}
            activeKey="flow" onChange={() => {}}
          />
        </div>
        <div className="mbody">
          <Alert
            type="warning" showIcon
            message="Word 已生成,但还差 3 项提交前处理"
            description="整册投标文件已经在「最终交付」里,不会丢。右侧列出了每一项该怎么补;也可以对不达标章节一起重做。"
            action={<Button size="small" type="primary" ghost onClick={() => setGapsOpen(true)}>逐条处理</Button>}
          />
          <FlowCard onOpenGaps={() => setGapsOpen(true)} />
          <Card variant="borderless" title="最近动态" styles={{ header: { minHeight: 44, fontSize: 13 } }}
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,.05),0 2px 10px rgba(16,24,40,.04)' }}>
            <Timeline
              items={FEED.map(f => ({
                color: f.color,
                children: (
                  <div style={{ fontSize: 13, lineHeight: 1.65 }}>
                    <span>{f.text}</span>
                    <span style={{ color: '#9aa0ab', marginLeft: 8, fontSize: 12 }}>{f.at}</span>
                  </div>
                ),
              }))}
            />
          </Card>
        </div>
        <div className="composer">
          <div className="quick">
            {['出件前我还差哪几项?', '各章分别写了多少字?', '为什么交付门禁没过?'].map(q =>
              <Tag key={q} style={{ cursor: 'pointer', padding: '5px 12px', fontSize: 12.5, borderRadius: 999 }}>{q}</Tag>)}
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input size="large" placeholder="问问进度、提要求,或把文件拖进来"
                   style={{ borderRadius: '22px 0 0 22px', paddingLeft: 18 }} />
            <Button size="large" type="primary" icon={<ArrowUpOutlined />}
                    style={{ borderRadius: '0 22px 22px 0', width: 52 }} />
          </Space.Compact>
        </div>
      </main>
      <Rail onOpenGaps={() => setGapsOpen(true)} />

      <Drawer title="出件前检查 · 提交前需处理 3 项" width={480}
              open={gapsOpen} onClose={() => setGapsOpen(false)}
              footer={<Button block icon={<FileTextOutlined />}>对整册不达标章节一起重做</Button>}>
        <List
          itemLayout="vertical" split
          dataSource={GAPS}
          renderItem={g => (
            <List.Item actions={[<Button key="a" size="small" type="primary" ghost>{g.action}</Button>]}>
              <List.Item.Meta
                avatar={g.level === 'error'
                  ? <CloseCircleFilled style={{ color: '#d4380d', fontSize: 17 }} />
                  : <WarningFilled style={{ color: '#d48806', fontSize: 17 }} />}
                title={<span style={{ fontSize: 13.5 }}>{g.title}</span>}
                description={<span style={{ fontSize: 12.5 }}>{g.detail}</span>}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  )
}
