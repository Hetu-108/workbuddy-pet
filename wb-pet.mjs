#!/usr/bin/env node
// wb-pet 命令行：给 WorkBuddy 会话 / 脚本 / 钩子调用。
//
//   node wb-pet.mjs up                     启动服务并打开桌宠页面
//   node wb-pet.mjs state working          切换工作状态（thinking|working|result|waiting|success|error|idle）
//   node wb-pet.mjs say "内容" [--image 图名] [--ms 6000]
//   node wb-pet.mjs anim "写代码"           点播一个动画
//   node wb-pet.mjs move "螃蟹走路"         走一段路
//   node wb-pet.mjs whisper                立即碎碎念一句
//   node wb-pet.mjs hook <EventName>       给 WorkBuddy 钩子用：从 stdin 读事件，映射成状态

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WB_PET_PORT || 7715;
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

async function post(endpoint, body, opts = {}) {
  const quiet = opts.quiet === true;
  try {
    const r = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // 钩子场景要快：桌宠没开也不能拖慢工具调用
      signal: AbortSignal.timeout(opts.timeout ?? 1500),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  } catch (e) {
    if (!quiet) console.error(`[wb-pet] 没连上桌宠（${BASE}）。先跑：node wb-pet.mjs up`);
    return false;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(buf);
    };
    const timer = setTimeout(done, 300);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

const HOOK_STATE = {
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'result',
  Notification: 'waiting',
  Stop: 'success',
  SubagentStop: 'result',
  SessionStart: 'thinking',
  SessionEnd: 'idle',
};

async function main() {
  switch (cmd) {
    case 'up': {
      const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--open'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`[wb-pet] 已启动：${BASE}`);
      return;
    }
    case 'state': {
      const s = argv[1];
      if (!s) return usage();
      await post('/api/state', { state: s });
      return;
    }
    case 'say': {
      const text = argv[1];
      if (!text) return usage();
      await post('/api/say', { text, image: flag('--image'), ms: flag('--ms') });
      return;
    }
    case 'anim': {
      const name = argv[1];
      if (!name) return usage();
      await post('/api/anim', { name });
      return;
    }
    case 'move': {
      const name = argv[1];
      if (!name) return usage();
      await post('/api/anim', { name, move: true });
      return;
    }
    case 'whisper':
      await post('/api/whisper', {});
      return;
    case 'roam':
      await post('/api/roam', {});
      return;
    case 'home':
      await post('/api/home', {});
      return;
    case 'hook': {
      const ev = argv[1] || '';
      const raw = await readStdin();
      let payload = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { /* 忽略非 JSON */ }
      const s = HOOK_STATE[ev];
      if (!s) return;
      const tool = payload.tool_name || payload.toolName || '';
      await post('/api/state', { state: s, tool }, { quiet: true, timeout: 400 });
      process.exit(0);
      return;
    }
    default:
      usage();
  }
}

function usage() {
  console.log(`大肥鱼 · WorkBuddy 桌宠

  node wb-pet.mjs up                     启动服务并打开页面
  node wb-pet.mjs state <状态>            thinking|working|result|waiting|success|error|idle
  node wb-pet.mjs say "内容" [--image 名] 让它说一句话（可配表情包）
  node wb-pet.mjs anim "写代码"           点播动画
  node wb-pet.mjs move "螃蟹走路"         走一段
  node wb-pet.mjs whisper                立即碎碎念
  node wb-pet.mjs roam                   全屏随便飞一下
  node wb-pet.mjs home                   叫回右下角
  node wb-pet.mjs hook <EventName>       WorkBuddy 钩子入口`);
}

main();
