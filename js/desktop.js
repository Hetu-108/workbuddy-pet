// 桌面模式（Electron 透明置顶窗口）专用：决定什么时候"接管鼠标"，什么时候"穿透给桌面"。
// 整窗铺满屏幕但默认穿透，只有光标真正落在角色的不透明像素上才临时接管，
// 判定用 js/hitmask.js 里逐动画的轮廓掩码（纯算术，不读 DOM 布局）。

const HOLD_MS = 140; // 命中后继续保持接管的时长：避免边缘抖动，也避免"刚碰到就点"丢点击

let interactive = null; // 当前状态（null = 尚未通信）
let raf = 0;
let px = -1;
let py = -1;
let forced = 0;        // 强制接管的引用计数（拖拽、菜单打开）
let holdUntil = 0;     // 保持接管的截止时间
let holdTimer = 0;

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  try { window.wbDesktop.setInteractive(next); } catch { /* noop */ }
}

/** 光标是否在角色真实轮廓上（拖拽/抛掷中一律算命中） */
function petHit(x, y) {
  for (const p of window.__pets || []) {
    if (!p) continue;
    if (p.dragging || p.throwRaf != null) return true;
    if (typeof p.hits === 'function' && p.hits(x, y)) return true;
  }
  return false;
}

/** 右键菜单面板（打开时才查 DOM，平时一条都不查） */
function menuHit(x, y) {
  const cols = document.querySelectorAll('.pet-menu-column');
  for (const el of cols) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

// 气泡故意不算命中：它只是展示，不该在鱼上方挖出一块"吃掉鼠标"的死区。
function hitTest(x, y) {
  if (petHit(x, y)) return true;
  return menuHit(x, y);
}

function flush() {
  raf = 0;
  if (forced > 0) { setInteractive(true); return; }
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  if (hitTest(px, py)) {
    holdUntil = performance.now() + HOLD_MS;
    setInteractive(true);
    return;
  }
  const left = holdUntil - performance.now();
  if (left <= 0) { setInteractive(false); return; }
  holdTimer = window.setTimeout(() => { holdTimer = 0; flush(); }, left + 8);
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(flush);
}

/**
 * @param {() => void} [onReady] 可选：接管状态就绪后的回调
 */
export function initDesktop() {
  if (!window.wbDesktop) return false;
  document.body.classList.add('desktop');

  window.addEventListener('mousemove', (e) => {
    px = e.clientX;
    py = e.clientY;
    schedule();
  }, { passive: true });

  // 光标移出窗口（多屏 / 贴边）立刻放开
  window.addEventListener('mouseout', (e) => {
    if (e.relatedTarget === null) { holdUntil = 0; setInteractive(false); }
  });
  // 切走焦点时别把鼠标锁在窗口里（拖拽中除外，否则手感会断）
  window.addEventListener('blur', () => {
    for (const p of window.__pets || []) {
      if (p && (p.dragging || p.throwRaf != null)) return;
    }
    holdUntil = 0;
    setInteractive(false);
  });

  // 拖拽兜底：万一 pointerup 丢了，250ms 内也能自己解除接管
  setInterval(() => {
    for (const p of window.__pets || []) {
      if (p && p.dragging) { forced = 1; setInteractive(true); return; }
    }
    if (forced === 1) { forced = 0; schedule(); }
  }, 250);

  setInteractive(false);
  return true;
}

/** 菜单打开时锁住接管，关闭时解锁 */
export function lockInteractive(on) {
  forced = on ? 1 : 0;
  if (on) setInteractive(true);
  else schedule();
}
