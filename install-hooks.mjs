#!/usr/bin/env node
// 把桌宠挂到 WorkBuddy 的钩子上：~/.workbuddy/settings.json 的 hooks 字段
// （格式与 Claude Code 一致：UserPromptSubmit / PreToolUse / PostToolUse / Notification / Stop）
//
//   node install-hooks.mjs         安装（自动备份 settings.json）
//   node install-hooks.mjs --remove 卸载
//
// 挂上之后：你一发消息它开始思考、每次工具调用它忙碌、等待确认时它张望、一轮结束它庆祝。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, 'wb-pet.mjs').replace(/\\/g, '/');
const NODE = process.execPath.replace(/\\/g, '/');
const SETTINGS = path.join(os.homedir(), '.workbuddy', 'settings.json');
const MARK = 'wb-pet.mjs';

const cmd = (event) => `"${NODE}" "${CLI}" hook ${event}`;

const WANTED = {
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('UserPromptSubmit') }] }],
  PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: cmd('PreToolUse') }] }],
  PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: cmd('PostToolUse') }] }],
  Notification: [{ hooks: [{ type: 'command', command: cmd('Notification') }] }],
  Stop: [{ hooks: [{ type: 'command', command: cmd('Stop') }] }],
};

const remove = process.argv.includes('--remove');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error('settings.json 解析失败：' + e.message);
  }
}

function isOurs(group) {
  const arr = group && group.hooks;
  return Array.isArray(arr) && arr.some((h) => typeof h.command === 'string' && h.command.includes(MARK));
}

const settings = readSettings();
settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};

if (remove) {
  for (const key of Object.keys(settings.hooks)) {
    const kept = (settings.hooks[key] || []).filter((g) => !isOurs(g));
    if (kept.length) settings.hooks[key] = kept;
    else delete settings.hooks[key];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
} else {
  for (const [event, groups] of Object.entries(WANTED)) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = list.filter((g) => !isOurs(g)).concat(groups);
  }
}

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
if (fs.existsSync(SETTINGS)) {
  const bak = SETTINGS + '.wbpet-bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
}
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');

console.log(remove ? '[wb-pet] 已卸载钩子' : '[wb-pet] 已挂上钩子');
console.log('  配置文件：' + SETTINGS + (fs.existsSync(SETTINGS + '.wbpet-bak') ? '（首次备份：settings.json.wbpet-bak）' : ''));
if (!remove) {
  console.log('  需要重开 WorkBuddy 会话（或新开一个会话）钩子才生效。');
  console.log('  桌宠服务要先跑起来：node wb-pet.mjs up');
}
