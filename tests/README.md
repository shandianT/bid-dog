# 中标狗回归测试

## 来源说明

派工单提到的 21 份测试和约 380 项断言原本位于一次开发会话的临时
`scratchpad/`。该目录在本机已经不存在；当前仓库、Git 历史、两份
`upload_v56` 压缩包和本机文件索引中也没有找到这些源文件。`ab_run.py` 与
`score3.py` 同样未找到。

因此，本目录不是对旧测试数量的虚假复刻，而是依据派工单中的行为矩阵、现有
公开接口和已复现故障重新建立的质量基线。新增或恢复断言时，应在提交说明中写明
它守住的产品行为，不能继续沿用“已迁移 380 项”的说法。

技能包压缩文件中另有一份 `test_format_roundtrip.py`；它不属于上述遗失清单，
后续应作为技能包自身回归继续保留。

## 本地离线运行

```bash
python3 -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
npm ci --prefix tests
npx --prefix tests playwright install chromium
tests/run_all.sh
```

`run_all.sh` 为每次运行创建独立 `BID_HOME`，默认只运行离线测试。Python 测试
使用临时目录和进程内假响应；浏览器测试只访问脚本启动的 `127.0.0.1` 引擎。
它不会读取用户的 `Documents/中标狗`，不会调用真实模型网关，也不会读取真实 Key。

测试失败时，引擎日志和 Playwright 诊断位于 `tests/.artifacts/`、
`tests/test-results/` 与 `tests/playwright-report/`，这些目录不会提交 Git。

## 红灯纪律

当前派工单采用测试先行。允许新增测试因为产品行为尚未实现而失败，但失败必须落在
清晰的行为断言上；导入失败、依赖缺失、端口冲突和真实网络不可达不算有效红灯。

关键测试约定：

- agent 原始步进写入独立信号文件，经证据校验后才能进入 canonical `events.jsonl`；
- 无 Word、CLI 卡死、升级检查和诊断包按接口行为测试；
- 上游流中断使用假响应，已经输出半截文本或工具参数时不得静默成功；
- 所有密钥测试值在运行时拼接，不把真实或看似真实的长 Key 写进仓库。

## 人工真实验收

`acceptance.py` 不属于 CI，也不会被 `run_all.sh` 调用。它会消耗真实额度，必须同时：

1. 复制 `acceptance_samples.example.json` 为 `acceptance_samples.local.json` 并配置恰好三份本机样本；
2. 用隔离 `BID_HOME` 启动本地引擎；
3. 用 `--prompt-key` 无回显输入 Key（也支持通过环境变量提供），并提供上游地址；
4. 显式设置 `BIDDOG_RUN_ACCEPTANCE=1`。

验收结果只写样本标签与指标，不写 Key，也不把真实文件内容复制进仓库。
