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
let wheelMuteUntil = 0; // 滚动期间别抢指针：光标停在鱼身上滚页面时，不能一滚一让再抢回去

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  // 暴露到 DOM 上，方便自检和排查时读当前是否占着指针
  try { document.body.dataset.petCapturing = next ? '1' : '0'; } catch { /* noop */ }
  try { window.wbDesktop.setInteractive(next); } catch { /* noop */ }
}

/** 光标是否在角色真实轮廓上（拖拽/抛掷中一律算命中） */
function petHit(x, y) {
  for (const p of window.__pets || []) {
    if (!p) continue;
    if (p.dragging || p.throwRaf != null) return true;
    // 自动移动中（漫游 / 走一段）不接管：鱼一直在动，根本压不准，
    // 而接管会把指针从下面的窗口抢走 —— 鱼满屏飞时滚轮滚不动就是这么来的。
    if (p.roamRaf != null || p.moveRaf != null || p.pendingMove) continue;
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
  // 滚动冷却期内一直让路，冷却结束再自己重测一次（否则要等用户动鼠标才恢复）
  const t = performance.now();
  if (t < wheelMuteUntil) {
    setInteractive(false);
    holdTimer = window.setTimeout(() => { holdTimer = 0; flush(); }, wheelMuteUntil - t + 10);
    return;
  }
  if (hitTest(px, py)) {
    holdUntil = performance.now() + HOLD_MS;
    setInteractive(true);
    // 关键：命中后就再没人来重测了。鱼会自己走开，而鼠标可能一动不动，
    // 没有新的 mousemove 就永远不会重新判定，窗口会一直占着指针（滚轮、点击全被吞）。
    // 所以到期必须自己再跑一次 flush。
    holdTimer = window.setTimeout(() => { holdTimer = 0; flush(); }, HOLD_MS + 8);
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
  // 滚轮永远优先给下面的窗口。命中判定有 140ms 的 hold，用户正好在鱼身上滚页面时
  // 会先被吞一下；收到滚轮就立刻让路，并在连续滚动期间一直保持穿透。
  window.addEventListener('wheel', () => {
    if (forced > 0) return; // 菜单 / 拖拽期间不干预
    wheelMuteUntil = performance.now() + 700;
    holdUntil = 0;
    setInteractive(false);
    schedule();
  }, { passive: true, capture: true });
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

// 自检 / 排查用：把内部状态露出来（不影响正常运行）
window.__desktop = {
  hitTest,
  capturing: () => interactive,
  forced: () => forced,
  holdLeft: () => Math.round(holdUntil - performance.now()),
  probe: (x, y) => { px = x; py = y; schedule(); },
};
