#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'site', 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const appRedirect = fs.readFileSync(path.join(root, 'site', 'app.html'), 'utf8');

function expect(pattern, message) {
  assert.ok(pattern.test(html), message || `官网缺少 ${pattern}`);
}

function reject(pattern, message) {
  assert.ok(!pattern.test(html), message || `官网不应出现 ${pattern}`);
}

expect(/Apple\s*(?:Silicon|芯片).*M\s*系列/i, 'macOS 下载必须明确只支持 Apple Silicon/M 系列');
expect(/Intel\s*Mac[^<]{0,80}(?:暂不支持|暂无安装包)/i, '必须明确提醒 Intel Mac 当前没有安装包');
expect(/Windows\s*10\s*\/\s*11[^<]{0,80}x64/i, 'Windows 下载必须写清支持范围');
expect(/Windows\s*ARM[^<]{0,60}(?:不支持|暂无安装包)/i, '必须明确提醒 Windows ARM 当前不支持');
expect(/安装包[^<]{0,80}(?:未完成商业签名|未签名)/, '下载区必须诚实展示签名状态');
expect(/\.size\b/, 'GitHub Release 成功时应展示安装包大小');
expect(/browser_download_url/, '官网必须从 Release 资产更新真实下载链接');
expect(/\.catch\(\(\)\s*=>\s*\{\}\)/, 'GitHub API 失败时必须保留静态下载回退');
expect(/\^desktop-v\\d\+\\\.\\d\+\\\.\\d\+\$/, '官网只应接受正式 desktop-vX.Y.Z Release');
expect(/names\.has\('SHA256SUMS'\)/, '官网切换新版本前必须确认校验文件存在');
expect(/names\.has\('bid-dog_'.*_aarch64\.dmg/, '官网切换新版本前必须确认 macOS 包存在');
expect(/names\.has\('bid-dog_'.*_x64-setup\.exe/, '官网切换新版本前必须确认 Windows 包存在');
expect(/a\.state\s*===\s*['"]uploaded['"]/, '官网切换新版本前必须确认资产上传完成');
expect(/Number\(a\.size\)\s*>\s*0/, '官网切换新版本前必须确认资产大小非零');
expect(/String\(a\.browser_download_url[^)]*\)\.startsWith\('https:\/\/'\)/, '官网切换新版本前必须确认下载地址有效');

expect(/200\+\s*项/, '官网应以不过期的方式说明自动化回归规模');
reject(/0\s*上传|文件不上传/, '官网不能误导用户认为模型生成时没有任何数据传输');
expect(/不上传到中标狗自有服务器[^<]{0,120}模型服务/, '官网必须准确说明本机存储与模型服务传输边界');
reject(/质检不过就不出 Word/, '官网不能把“检查失败不宣告完成”误写成不会生成 Word');
assert.ok(appRedirect.includes('/app/index.html?demo=1'), '在线体验入口必须直接进入 demo=1，不能等待公网后端探测');

assert.ok(html.includes('https://github.com/shandianT'), '官网必须提供作者 GitHub 入口');
assert.ok(html.indexOf('id="output"') > 0 && html.indexOf('id="output"') < html.indexOf('id="demo"'), '真实 Word 成品效果必须排在流程演示前');
reject(/\.rv\s*\{[^}]*opacity\s*:\s*0/, '官网正文不能依赖滚动观察器才显示，截图和弱性能设备也必须清晰可见');
expect(/\.win\s*\{[^}]*transform\s*:\s*none/s, '流程演示不能用 3D 旋转导致文字栅格化发虚');
expect(/打开全尺寸(?:在线)?体验/, '缩略流程旁必须提供清晰的全尺寸体验入口');
expect(/copyMacFix/, 'macOS 未公证期间必须提供一键复制首次放行命令');

expect(/发放的\s*Key[^<]{0,140}(?:完整生成|生成标书)/, 'FAQ 应说明发放 Key 可用于完整生成');
expect(/内置\s*OpenCode[^<]{0,120}(?:不用|无需)[^<]{0,40}(?:Node\.js|登录)/, 'FAQ 应说明内置 OpenCode 无需 Node.js/账号登录');
reject(/生成标书本体走你绑定的\s*CLI\s*订阅额度/, '官网仍在错误宣称生成必须走用户 CLI 订阅');

assert.match(readme, /填写 Key[\s\S]{0,300}测试连接[\s\S]{0,300}上传文件/, 'README 必须按首次三步说明上手流程');
for(const label of ['准备中', '生成中', '需要你确认', '已完成', '未完成']) {
  assert.ok(readme.includes(label), `README 缺少用户状态：${label}`);
}
assert.match(readme, /主 Word、目录、技术\/商务偏差表和关键检查/, 'README 必须说明交付优先结果页');
assert.match(readme, /批量管理支持归档、恢复、重新生成、导出和移动项目/, 'README 必须说明归档与批量操作');
assert.doesNotMatch(readme, /「状态不明」和「已完成」默认收起/, 'README 不应继续宣传已移除的“状态不明”分组');
assert.doesNotMatch(readme, /文件不上传/, 'README 不能误导用户认为模型生成时没有任何数据传输');
assert.match(readme, /不经过中标狗自有服务器/, 'README 必须准确说明模型服务的数据边界');

process.stdout.write('✓ 官网下载兼容性、签名状态与 Key 使用说明真实可读\n');
