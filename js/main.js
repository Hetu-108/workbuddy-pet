// 启动器：装配宠物、连接本地桥（SSE）、暴露控制台 / HTTP 两套控制口子。

import { DEFAULT_CONFIG } from './config.js';
import { Pet } from './pet.js';
import { initDesktop } from './desktop.js';
import { sound, init as initSound, unlock, setEnabled, isEnabled, setVolume, state as soundState } from './sound.js';

const app = Object.assign({}, DEFAULT_CONFIG);

/** 素材清单（表情包名 = 文件名去扩展名）；服务端不可用时退化为空 */
async function loadInfo() {
  try {
    const r = await fetch('api/info', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const info = await r.json();
    app.memeNames = info.memes || [];
    app.version = info.version || '';
  } catch {
    app.memeNames = [];
  }
}

function mount() {
  const layer = document.getElementById('layer');
  const pets = [];
  for (const cfg of app.pets) {
    pets.push(new Pet({ cfg, app, layer }));
  }
  return pets;
}

function currentPet(id) {
  if (!id) return window.__pets[0];
  return window.__pets.find((p) => p.cfg.id === id) || window.__pets[0];
}

// ---------------- 对外控制口 ----------------
const api = {
  pets: () => window.__pets,
  state(state, petId) { currentPet(petId).setWorkStatus(state); },
  say(text, opts = {}) {
    // 兼容两种写法：say('内容', {image, ms}) 或 say('内容', '表情包名')
    const o = typeof opts === 'string' ? { image: opts } : opts;
    currentPet(o.petId).say(text, o.image || null, o.ms);
  },
  anim(name, petId) { currentPet(petId).switchTo(name, true); },
  move(name, petId) { currentPet(petId).tryMove(name); },
  whisper(petId) { currentPet(petId).whisper(); },
  home(petId) { currentPet(petId).goHome(); },
  roam(petId) { currentPet(petId).roam(); },
  sound(on) { setEnabled(on === undefined ? !isEnabled() : !!on); app.soundEnabled = isEnabled(); },
  volume(v) { setVolume(v); },
};
window.wbPet = api;
window.__sound = { state: soundState, enabled: isEnabled, toggle: app.toggleSound };

// ---------------- 本地桥（SSE） ----------------
function connectBridge() {
  let es;
  try {
    es = new EventSource('api/events');
  } catch {
    return;
  }
  es.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleEvent(msg);
  });
  es.addEventListener('open', () => { document.body.dataset.bridge = 'on'; });
  es.addEventListener('error', () => { document.body.dataset.bridge = 'off'; });
}

function handleEvent(msg) {
  if (!msg || !msg.type) return;
  const pet = currentPet(msg.pet);
  switch (msg.type) {
    case 'state':
      window.__pets.forEach((p) => p.setWorkStatus(msg.state));
      break;
    case 'say':
      pet.say(msg.text || '', msg.image || null, msg.ms ?? undefined);
      break;
    case 'anim':
      if (msg.name) pet.switchTo(msg.name, true);
      break;
    case 'move':
      if (msg.name) pet.tryMove(msg.name);
      break;
    case 'whisper':
      pet.whisper();
      break;
    case 'roam':
      pet.roam();
      break;
    case 'home':
      window.__pets.forEach((p) => p.goHome());
      break;
    case 'refresh':
      location.reload();
      break;
    default:
      break;
  }
}

// 嵌在 iframe 里时也支持父窗口 postMessage
window.addEventListener('message', (e) => {
  const d = e.data;
  if (d && typeof d === 'object' && typeof d.wbPetType === 'string') {
    handleEvent({ type: d.wbPetType, ...d });
  }
});

window.addEventListener('resize', () => {
  for (const p of window.__pets || []) p.onResize();
});

// 键盘：H 回家 / W 碎碎念（方便调试）
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') api.home();
  if (e.key === 'w' || e.key === 'W') api.whisper();
});

// 前端异常回报给本地服务（只在出错时发，方便在终端里看）
function reportError(text) {
  try {
    fetch('api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch { /* noop */ }
}
window.addEventListener('error', (e) => {
  reportError((e.message || 'error') + ' @' + (e.filename || '?') + ':' + (e.lineno || 0));
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  reportError('unhandledrejection: ' + (r && r.message ? r.message : String(r)));
});

async function boot() {
  const qs = new URLSearchParams(location.search);
  const desktop = qs.has('desktop');
  if (!desktop && qs.has('bg')) document.body.classList.add('wallpaper');
  initSound(app.sound || {});
  app.soundEnabled = isEnabled();
  app.toggleSound = () => {
    setEnabled(!isEnabled());
    app.soundEnabled = isEnabled();
    if (isEnabled()) { unlock(); sound.click(); }
  };
  const unlockOnce = () => { unlock(); };
  window.addEventListener('pointerdown', unlockOnce, { once: true });
  window.addEventListener('keydown', unlockOnce, { once: true });
  await loadInfo();
  app.desktop = desktop;
  window.__pets = mount();
  for (const p of window.__pets) p.cfg.roamEnabled = desktop; // 只有桌面模式才全屏乱飘
  connectBridge();
  if (desktop) {
    // 桌面模式：整窗透明铺满工作区，只在鱼身上接管鼠标
    initDesktop();
    app.helloText = '我可以在整个屏幕乱跑啦，抓起来随便扔～';
  }
  // 调试：?menu=1 直接展开右键菜单（方便截图/排查样式）
  if (new URLSearchParams(location.search).has('menu')) {
    const p = window.__pets[0];
    const r = p.root.getBoundingClientRect();
    p._openMenu(r.left + 20, Math.max(20, r.top - 40));
  }
  // 打个招呼
  const first = window.__pets[0];
  if (first) {
    window.setTimeout(() => {
      if (!first.anim || first.bubble.classList.contains('is-on')) return;
      first.say(app.helloText || '我在这儿呢～右上角右键可以点播动作哦', null, 6000);
    }, 900);
  }
}

boot().catch((e) => {
  console.error('[wb-pet] 启动失败', e);
});
