'use strict';
// 一次性脚本：批量采样所有 webm 的 alpha 通道，生成每段动画的命中掩码表（js/hitmask.js）
// 用法：runtime/electron/electron.exe dev/measure.cjs [--all] [--shot]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const OUT_JSON = path.join(__dirname, 'hitmask.json');
const OUT_JS = path.join(__dirname, '..', 'js', 'hitmask.js');
const MASK_W = 64;
const MASK_H = 36;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800, height: 600,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'measure.html'));
  await new Promise((r) => setTimeout(r, 400));

  const webmDir = path.join(__dirname, '..', 'assets', 'webm');
  const all = fs.readdirSync(webmDir).filter((f) => f.endsWith('.webm'))
    .map((f) => f.replace(/\.webm$/, ''));
  const names = process.argv.includes('--all') ? all : all.slice(0, 6);
  console.log('sampling', names.length, 'animations ->', MASK_W + 'x' + MASK_H);

  const res = await win.webContents.executeJavaScript(
    `window.runMask(${JSON.stringify(names)}, ${MASK_W}, ${MASK_H}, 5)`
  );

  const masks = {};
  const boxes = {};
  const failed = [];
  const thin = [];
  for (const r of res) {
    if (r.error) { failed.push(r.name + ': ' + r.error); continue; }
    // 过于稀疏的掩码说明这段动画角色很小/一直在动，留着会让它抓不住 → 丢弃，运行时回退到并集
    const buf = Buffer.from(r.b64, 'base64');
    let on = 0;
    for (const b of buf) on += b.toString(2).split('').filter((c) => c === '1').length;
    if (on < 40) { thin.push(r.name + '(' + on + ')'); continue; }
    masks[r.name] = r.b64;
    boxes[r.name] = [r.x0, r.y0, r.x1, r.y1];
  }
  if (thin.length) console.log('too thin, fallback to union:', thin.join(', '));
  console.log('ok', Object.keys(masks).length, 'failed', failed.length);
  failed.forEach((f) => console.log('  !', f));

  // 统计一下空/异常掩码
  const empty = Object.entries(masks).filter(([, b]) => !/[^A]/.test(b) || b.length < 4);
  if (empty.length) console.log('suspicious empty masks:', empty.map((e) => e[0]).join(', '));

  fs.writeFileSync(OUT_JSON, JSON.stringify({ masks, boxes }, null, 1));

  const lines = Object.entries(masks).map(([k, v]) => `  ${JSON.stringify(k)}: '${v}',`).join('\n');
  const js = `// 由 dev/measure.cjs 自动生成，请勿手改。
// 每段动画在 640x360 画布上的真实不透明轮廓，${MASK_W}x${MASK_H} 网格、每格 ${
    (640 / MASK_W).toFixed(2)}x${(360 / MASK_H).toFixed(2)}px，用于精确命中判定。

export const MASK_W = ${MASK_W};
export const MASK_H = ${MASK_H};

const RAW = {
${lines}
};

const cache = new Map();
let fallback = null;

function decode(b64, w, h) {
  const out = new Uint8Array(w * h);
  let bin;
  try { bin = atob(b64); } catch { return out; }
  for (let i = 0; i < out.length; i++) {
    out[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  }
  return out;
}

/** 全部动画的并集，作为找不到对应掩码时的兜底 */
export function allMask() {
  if (fallback) return fallback;
  const acc = new Uint8Array(MASK_W * MASK_H);
  for (const b64 of Object.values(RAW)) {
    const m = decode(b64, MASK_W, MASK_H);
    for (let i = 0; i < acc.length; i++) if (m[i]) acc[i] = 1;
  }
  fallback = acc;
  return acc;
}

/** 取某段动画的掩码（Uint8Array，1 = 有像素）；未知动画回退到并集 */
export function maskFor(anim) {
  if (cache.has(anim)) return cache.get(anim);
  let m = null;
  if (RAW[anim]) m = decode(RAW[anim], MASK_W, MASK_H);
  else m = allMask();
  cache.set(anim, m);
  return m;
}

export function hasMask(anim) { return !!RAW[anim]; }
`;
  fs.writeFileSync(OUT_JS, js, 'utf8');
  console.log('saved', OUT_JS, (js.length / 1024).toFixed(1) + 'KB');
  app.quit();
});
