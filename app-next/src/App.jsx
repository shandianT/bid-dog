import React, { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Tag, Tabs, Steps, Alert, Drawer, List, Progress, Modal, Input,
  Tooltip, Segmented, Space, Divider, Timeline, App as AntApp,
} from 'antd'
import {
  PlusOutlined, FolderOutlined, SettingOutlined, FileWordOutlined,
  FolderOpenOutlined, RightOutlined, ReloadOutlined, PauseOutlined,
  CheckCircleFilled, WarningFilled, CloseCircleFilled, FileTextOutlined,
  SearchOutlined, StopOutlined, EnterOutlined,
} from '@ant-design/icons'
import { Sender, Prompts, ThoughtChain } from '@ant-design/x'
import {
  JOBS, PHASES, NODES, GAPS, COVERAGE, FEED,
  RUN_JOB, RUN_PHASES, CHAPTERS, THOUGHTS, RUN_COVERAGE, PALETTE, REDO_DIFF,
} from './fixtures.js'

const GAP_DOT = { error: '#d4380d', warning: '#d48806' }
const CARD_SHADOW = { boxShadow: '0 1px 2px rgba(16,24,40,.05),0 2px 10px rgba(16,24,40,.04)' }
const cardHead = { header: { minHeight: 44, fontSize: 13 } }

/* ───────────────────────── 左栏 ───────────────────────── */
function Sider({ view, setView, engineOK }) {
  const { message } = AntApp.useApp()
  const pick = j => setView(j.state === 'running' ? 'running' : 'attention')
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
      <Button type="primary" size="large" icon={<PlusOutlined />} block style={{ height: 46, fontWeight: 600 }}>
        新建任务<span style={{ fontWeight: 400, opacity: .75, fontSize: 12, marginLeft: 6 }}>选择或拖入招标文件</span>
      </Button>
      <Segmented block options={['当前任务', '已归档']} />
      <nav className="tasklist">
        <div className="tgroup">生成中 · 1</div>
        {JOBS.filter(j => j.state === 'running').map(j =>
          <TaskRow key={j.id} job={j} on={view === 'running'} onClick={() => pick(j)} />)}
        <div className="tgroup">待处理 · 1</div>
        {JOBS.filter(j => j.state === 'attention').map(j =>
          <TaskRow key={j.id} job={j} on={view === 'attention'} onClick={() => pick(j)} />)}
        <div className="tgroup">已完成 · 1</div>
        {JOBS.filter(j => j.state === 'done').map(j => <TaskRow key={j.id} job={j} onClick={() => {}} />)}
      </nav>
      <div className="sfoot">
        <div className="sl"><FolderOutlined /> 素材库</div>
        <div className="sl"><SettingOutlined /> 设置 · 模型接入</div>
        <div className="sl" style={{ cursor: 'default' }}>
          <i className={'sdot ' + (engineOK ? 'done' : '')} />
          {engineOK ? '本地服务已连接' : '本地服务未连接(演示数据)'}
        </div>
        <div className="proto">路线一原型 v2 · antd 6 + Ant Design X · 评估用</div>
      </div>
    </aside>
  )
}

function TaskRow({ job, on, onClick }) {
  return (
    <div className={'trow' + (on ? ' on' : '')} onClick={onClick}>
      <div className="tn"><i className={'sdot ' + job.state} /><span>{job.name}</span></div>
      <div className="ts">{job.sub}</div>
      {job.state === 'running' &&
        <Progress percent={job.pct} size={[null, 4]} showInfo={false} style={{ margin: '0 0 0 16px', width: 'auto' }} />}
    </div>
  )
}

/* ─────────────────── 生成中视图:看着它干活 ─────────────────── */
function RunningView() {
  const done = CHAPTERS.filter(c => c.s === 'done').length
  return (<>
    <Card variant="borderless" style={CARD_SHADOW}>
      <Steps size="small" labelPlacement="vertical"
        items={RUN_PHASES.map((p, i) => ({
          status: p.live ? 'process' : (i < 3 ? 'finish' : 'wait'),
          title: <span style={{ fontSize: 12.5, fontWeight: 550 }}>{p.title}</span>,
          description: <span className="num" style={{ fontSize: 11, color: '#9aa0ab' }}>{p.dur}</span>,
        }))} />
    </Card>

    <Card variant="borderless" style={CARD_SHADOW} styles={cardHead}
          title={<span>章节撰写 <span className="num" style={{ color: '#8b8f98', fontWeight: 450 }}>{done}/12</span></span>}
          extra={<span style={{ fontSize: 12, color: '#8b8f98' }}>每写完一节即存检查点 · 中途停下不丢内容</span>}>
      <div className="chgrid">
        {CHAPTERS.map(c => (
          <div className={'chrow ' + c.s} key={c.n}>
            {c.s === 'done' ? <CheckCircleFilled style={{ color: '#22a06b', fontSize: 13 }} />
              : c.s === 'writing' ? <i className="pulse" />
              : <i className="qdot" />}
            <span className="chname">{c.n}</span>
            <span className="chmeta num">
              {c.s === 'queued' ? '排队中' : c.w.toLocaleString() + ' 字' + (c.s === 'writing' ? ' ↑' : '')}
            </span>
          </div>
        ))}
      </div>
    </Card>

    <Card variant="borderless" style={CARD_SHADOW} styles={cardHead} title="Agent 正在做什么">
      <ThoughtChain items={THOUGHTS.map((t, i) => ({ key: String(i), ...t }))} />
    </Card>
  </>)
}

/* ─────────────────── 待处理视图:出了件,差几步 ─────────────────── */
function AttentionView({ openGaps }) {
  return (<>
    <Alert type="warning" showIcon
      message="Word 已生成,但还差 3 项提交前处理"
      description="整册投标文件已经在「最终交付」里,不会丢。右侧列出了每一项该怎么补;也可以对不达标章节一起重做。"
      action={<Button size="small" type="primary" ghost onClick={openGaps}>逐条处理</Button>} />
    <Card variant="borderless" style={CARD_SHADOW}>
      <Steps size="small" labelPlacement="vertical"
        items={PHASES.map(p => ({
          status: p.warn ? 'wait' : 'finish',
          title: <span style={{ fontSize: 12.5, fontWeight: 550, color: p.warn ? '#d48806' : undefined }}>{p.title}</span>,
          description: <span className="num" style={{ fontSize: 11, color: '#9aa0ab' }}>{p.dur}</span>,
          ...(p.warn ? { icon: <WarningFilled style={{ color: '#faad14' }} /> } : {}),
        }))} />
      <Divider style={{ margin: '16px 0 12px' }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <b style={{ fontSize: 13.5 }}>当前阶段 · 交付质检</b>
        <span className="nodemeta">交付门禁未完成,已停在可恢复检查点 · 已保留全部完成内容</span>
      </div>
      <List size="small" split={false} dataSource={NODES}
        renderItem={n => (
          <List.Item style={{ padding: '7px 0' }}
            actions={n.action ? [<Button key="a" size="small" icon={<ReloadOutlined />}>{n.action}</Button>] : []}>
            <Space size={9}>
              {n.state === 'done' ? <CheckCircleFilled style={{ color: '#22a06b' }} />
                                  : <CloseCircleFilled style={{ color: '#d4380d' }} />}
              <span style={{ fontWeight: 550, fontSize: 13 }}>{n.name}</span>
              <span className="nodemeta num">{n.meta}</span>
            </Space>
          </List.Item>
        )} />
    </Card>
    <Card variant="borderless" title="最近动态" styles={cardHead} style={CARD_SHADOW}>
      <Timeline items={FEED.map(f => ({
        color: f.color,
        children: <div style={{ fontSize: 13, lineHeight: 1.65 }}>
          <span>{f.text}</span><span style={{ color: '#9aa0ab', marginLeft: 8, fontSize: 12 }}>{f.at}</span>
        </div>,
      }))} />
    </Card>
  </>)
}

/* ───────────────────────── 右栏 ───────────────────────── */
function Rail({ view, openGaps, openRedo }) {
  if (view === 'running') return (
    <aside className="rail">
      <Card variant="borderless" title="将要交付" styles={cardHead} style={CARD_SHADOW}>
        <div className="wordrow">
          <div className="wordicon dim"><FileWordOutlined style={{ fontSize: 22 }} /></div>
          <div className="wordmeta">
            <b>投标文件_整册.docx</b>
            <span>预计 ~9 分钟后出件 · 出件前自动跑格式与废标检查</span>
          </div>
        </div>
      </Card>
      <Card variant="borderless" title="评分点覆盖 · 实时" styles={cardHead} style={CARD_SHADOW}
            extra={<Button size="small" type="link">查看明细 <RightOutlined /></Button>}>
        <div className="covrow">
          <Progress type="circle" size={68} percent={Math.round(RUN_COVERAGE.covered / RUN_COVERAGE.total * 100)}
                    format={() => <span className="num" style={{ fontSize: 14, fontWeight: 650 }}>{RUN_COVERAGE.covered}/{RUN_COVERAGE.total}</span>} />
          <div className="covwhy">
            <span>写完一章,自动核对一章</span>
            <i>每个评分点都能点开看「原文依据 ↔ 落位章节」</i>
          </div>
        </div>
      </Card>
      <Card variant="borderless" title="参考资料" styles={cardHead} style={CARD_SHADOW}
            extra={<Button size="small" type="link" icon={<PlusOutlined />}>添加</Button>}>
        <span style={{ fontSize: 12, color: '#8b8f98' }}>给 AI 的写法参照,如过往标书</span>
      </Card>
    </aside>
  )
  return (
    <aside className="rail">
      <Card variant="borderless" title="最终交付 · 先看这里" styles={cardHead}
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
      <Card variant="borderless" title="提交前需处理 · 3 项" styles={cardHead} style={CARD_SHADOW}
            extra={<Button size="small" type="link" onClick={openGaps}>逐条处理 <RightOutlined /></Button>}>
        {GAPS.map((g, i) => (
          <div className="gaprow" key={i}>
            <span className="gd" style={{ background: GAP_DOT[g.level] }} />
            <div className="gc"><div className="gt">{g.title}</div><div className="gs">{g.detail}</div></div>
            <Button size="small" type="link" style={{ padding: 0 }}
                    onClick={i === 0 ? openRedo : undefined}>{g.action}</Button>
          </div>
        ))}
      </Card>
      <Card variant="borderless" title="评分点覆盖" styles={cardHead} style={CARD_SHADOW}
            extra={<Button size="small" type="link">查看明细 <RightOutlined /></Button>}>
        <div className="covrow">
          <Progress type="circle" size={68} percent={0} status="exception"
                    format={() => <span className="num" style={{ fontSize: 14, fontWeight: 650 }}>0/19</span>} />
          <div className="covwhy">
            <span><b>15 项</b> 还没落到具体章节 <i>· 可补写应答</i></span>
            <span><b>4 项</b> 规划里还留着缺口 <i>· 补齐后自动计入</i></span>
          </div>
        </div>
      </Card>
    </aside>
  )
}

/* ─────────────── Cmd+K 命令面板:两次击键到任何地方 ─────────────── */
function CommandK({ open, onClose }) {
  const [q, setQ] = useState('')
  const data = useMemo(() => PALETTE.map(g => ({
    ...g, items: g.items.filter(x => !q || x.includes(q)),
  })).filter(g => g.items.length), [q])
  const { message } = AntApp.useApp()
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={560}
           styles={{ content: { padding: 0, overflow: 'hidden' } }} afterClose={() => setQ('')}>
      <Input autoFocus size="large" variant="borderless" prefix={<SearchOutlined style={{ color: '#9aa0ab' }} />}
             placeholder="跳到任务 / 章节,或直接下一个动作…" value={q} onChange={e => setQ(e.target.value)}
             style={{ padding: '14px 18px', borderBottom: '1px solid #eceef2', borderRadius: 0 }} />
      <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 8px 8px' }}>
        {data.map(g => (
          <div key={g.group}>
            <div className="tgroup" style={{ padding: '10px 10px 4px' }}>{g.group}</div>
            {g.items.map(x => (
              <div key={x} className="krow" onClick={() => { onClose(); message.success('已执行:' + x) }}>
                <span>{x}</span><EnterOutlined style={{ color: '#c4c8cf', fontSize: 12 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="khint">↑↓ 选择 · Enter 执行 · Esc 关闭 —— 复核清单里还支持 J/K 上下一项</div>
    </Modal>
  )
}

/* ─────────── 重做确认:批准前先看「会发生什么」(预演 diff)─────────── */
function RedoModal({ open, onClose }) {
  const { message } = AntApp.useApp()
  return (
    <Modal open={open} onCancel={onClose} width={560} title="重做章节「技术方案」"
           okText="确认重做 · 预计 ~8 分钟" cancelText="取消"
           onOk={() => { onClose(); message.success('已开始重做「技术方案」,其余章节保留') }}>
      <div style={{ fontSize: 12.5, color: '#54575f', margin: '2px 0 14px' }}>
        你批准的是下面这些<b>具体会发生的变化</b>,不是一句话的意图。执行由确定性代码完成,AI 只负责重写正文。
      </div>
      <div className="diff">
        {REDO_DIFF.map(d => (
          <div className={'drow' + (d.hot ? ' hot' : '')} key={d.k}>
            <span className="dk">{d.k}</span>
            <span className="dfrom">{d.from}</span>
            <RightOutlined style={{ color: '#c4c8cf', fontSize: 11 }} />
            <span className="dto">{d.to}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#8b8f98', marginTop: 12 }}>
        检查点全程保留:重做途中停下,已完成内容不丢,可从断点继续。
      </div>
    </Modal>
  )
}

/* ───────────────────────── 主框架 ───────────────────────── */
export default function App() {
  const [view, setView] = useState('running')
  const [gapsOpen, setGapsOpen] = useState(false)
  const [redoOpen, setRedoOpen] = useState(false)
  const [kOpen, setKOpen] = useState(false)
  const [engineOK, setEngineOK] = useState(false)
  const { message } = AntApp.useApp()

  useEffect(() => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 800)
    fetch('/v1/health', { signal: ctl.signal }).then(r => setEngineOK(r.ok)).catch(() => {})
      .finally(() => clearTimeout(t))
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setKOpen(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const running = view === 'running'
  return (
    <div className="shell">
      <Sider view={view} setView={setView} engineOK={engineOK} />
      <main className="main">
        <div className="mhead">
          <div className="mhrow">
            <h1>{running ? RUN_JOB.name : '深圳市龙华区清湖片区棚户区改造项目'}</h1>
            {running ? <Tag color="processing" style={{ fontWeight: 550 }}>生成中</Tag>
                     : <Tag color="warning" style={{ fontWeight: 550 }}>待处理</Tag>}
            <span style={{ flex: 1 }} />
            <Tooltip title="命令面板:跳任务、跳章节、下动作">
              <Button onClick={() => setKOpen(true)} icon={<SearchOutlined />}>
                <span className="kbd">⌘K</span>
              </Button>
            </Tooltip>
            {running ? (<>
              <Button icon={<PauseOutlined />}>暂停</Button>
              <Button danger icon={<StopOutlined />}>停止</Button>
            </>) : (<>
              <Button>运行日志</Button>
              <Button type="primary" onClick={() => setGapsOpen(true)}>出件前检查</Button>
            </>)}
          </div>
          <div className="msub">{running ? RUN_JOB.sub : 'Word 已生成 · 提交前需处理 3 项 · 最后活动 1 小时前'}</div>
          <Tabs activeKey="flow" onChange={() => {}}
                items={[{ key: 'flow', label: '执行过程' }, { key: 'outline', label: '标书大纲' }, { key: 'chat', label: '对话与要求' }]} />
        </div>
        <div className="mbody">
          {running ? <RunningView /> : <AttentionView openGaps={() => setGapsOpen(true)} />}
        </div>
        <div className="composer">
          <Prompts wrap onItemClick={i => message.info('已发送:' + i.data.label)}
            items={(running
              ? ['现在到哪了?', '为什么当前不能暂停?', '有哪些废标风险?']
              : ['出件前我还差哪几项?', '各章分别写了多少字?', '为什么交付门禁没过?']
            ).map(x => ({ key: x, label: x }))} />
          <Sender placeholder="问问进度、提要求,或把文件拖进来" onSubmit={v => message.info('已发送:' + v)} />
        </div>
      </main>
      <Rail view={view} openGaps={() => setGapsOpen(true)} openRedo={() => setRedoOpen(true)} />

      <Drawer title="出件前检查 · 提交前需处理 3 项" width={480}
              open={gapsOpen} onClose={() => setGapsOpen(false)}
              footer={<Button block icon={<FileTextOutlined />} onClick={() => { setGapsOpen(false); setRedoOpen(true) }}>对整册不达标章节一起重做</Button>}>
        <div style={{ fontSize: 12, color: '#8b8f98', marginBottom: 10 }}>J/K 上下一项 · Enter 处理当前项 · 每条都能点开定位到报告原文</div>
        <List itemLayout="vertical" split dataSource={GAPS}
          renderItem={(g, i) => (
            <List.Item actions={[<Button key="a" size="small" type="primary" ghost
                                         onClick={i === 0 ? () => { setGapsOpen(false); setRedoOpen(true) } : undefined}>{g.action}</Button>]}>
              <List.Item.Meta
                avatar={g.level === 'error'
                  ? <CloseCircleFilled style={{ color: '#d4380d', fontSize: 17 }} />
                  : <WarningFilled style={{ color: '#d48806', fontSize: 17 }} />}
                title={<span style={{ fontSize: 13.5 }}>{g.title}</span>}
                description={<span style={{ fontSize: 12.5 }}>{g.detail}</span>} />
            </List.Item>
          )} />
      </Drawer>
      <CommandK open={kOpen} onClose={() => setKOpen(false)} />
      <RedoModal open={redoOpen} onClose={() => setRedoOpen(false)} />
    </div>
  )
}
