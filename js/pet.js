// 单只桌宠：动画链 / 移动 / 拖拽抛掷 / 点击响应 / 气泡 / 右键菜单。
// 行为与几何逐条对齐 dsh-pet 0.3.7 的 src/client/pet.ts（React → 原生 DOM 重写）。

import {
  estimateReleaseVelocity, springStep, throwStep, trimTrail,
  squashScale, landingSquash, SQ_DURATION_MS, SQ_SOFT_SPEED, MAX_STEP_DT,
} from './physics.js';
import { pick, pickSlot, rollKind, pickCategoryAction, randomBetween, clamp } from './util.js';
import { PetMenu, buildMenuTree } from './menu.js';
import { sound, unlock } from './sound.js';
import { maskFor, MASK_W, MASK_H } from './hitmask.js';
import { lockInteractive } from './desktop.js';

// ---- 画布几何（与 640×360 素材强耦合）----
const CANVAS_H = 360;
const FEET_Y = 330;
// 角色在所有动作里的轮廓并集（实测），只用来算贴边余量
const HIT_BOX = { x0: 197, y0: 40, x1: 451, y1: 332 };
const DRAG_THRESHOLD = 5;
const PET_REF_WIDTH = 462;
const ANIM_EXT = '.webm';
const BUBBLE_MS = 9000;
const WORK_STATUS_INDEX = { thinking: 0, working: 1, result: 2, waiting: 3, success: 4, error: 5 };

const now = () => performance.now();

export class Pet {
  /**
   * @param {object} o
   * @param {object} o.cfg 单只宠物配置（id/name/size/fixedEnabled/...）
   * @param {object} o.app 全局配置（physics/animations/animationWeights/...）
   * @param {HTMLElement} o.layer 容器
   */
  constructor({ cfg, app, layer }) {
    this.cfg = cfg;
    this.app = app;
    this.layer = layer;
    this.physics = app.physics;
    this.anims = app.animations;
    this.weights = app.animationWeights;

    this.size = cfg.size || 380;
    this.h = (this.size * 9) / 16;
    this.bottomPad = (this.size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H;
    // 身体相对视频盒左右内缩（透明边），贴边判定用「身体」而不是整个视频盒
    this.sideAllow = (this.size * (1 - (HIT_BOX.x1 - HIT_BOX.x0) / 640)) / 2;

    this.anim = this.anims.idle[0] || '';
    this.once = true;
    this.facing = 'left';
    this.gen = 0;
    this.frontIsA = false;      // 初始由 A 当背景、B 前台
    this.moved = false;         // 是否被用户搬动过（影响 resize 行为）
    this.workState = null;
    this.pos = { x: 0, y: 0 };
    this.dragTrail = [];
    this.dragVel = { vx: 0, vy: 0 };
    this.dragTarget = null;
    this.moveRaf = null;
    this.pendingMove = null;
    this.moveToken = 0;
    this.roamRaf = null;
    this.roamToken = 0;
    this.throwRaf = null;
    this.throwState = null;
    this.squashRaf = null;
    this.whisperTimer = null;
    this.bubbleTimer = null;
    this.dragging = false;
    this._springToken = 0;
    this._springRaf = null;
    this._build();
  }

  // ---------------- DOM ----------------
  _build() {
    const root = document.createElement('div');
    root.className = 'pet-root';
    root.dataset.petId = this.cfg.id;
    root.style.setProperty('--pet-size', this.size + 'px');

    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = `translateY(${this.bottomPad}px)`;

    const va = document.createElement('video');
    const vb = document.createElement('video');
    for (const v of [va, vb]) {
      v.className = 'pet-video';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
    }
    va.classList.add('is-front');

    const bubble = document.createElement('div');
    bubble.className = 'pet-bubble';
    const bubText = document.createElement('div');
    bubText.className = 'pet-bub-text';
    bubble.appendChild(bubText);
    stage.appendChild(bubble);

    const hit = document.createElement('div');
    hit.className = 'pet-hit';
    hit.style.left = (HIT_BOX.x0 / 640) * 100 + '%';
    hit.style.top = (HIT_BOX.y0 / CANVAS_H) * 100 + '%';
    hit.style.width = ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%';
    hit.style.height = ((HIT_BOX.y1 - HIT_BOX.y0) / CANVAS_H) * 100 + '%';
    stage.append(va, vb, hit);
    root.appendChild(stage);
    this.layer.appendChild(root);

    this.root = root;
    this.stage = stage;
    this.hit = hit;
    this.bubble = bubble;
    this.bubText = bubText;
    this.videos = [va, vb];

    this._applyAnchor();
    this._bindPointer();    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._openMenu(e.clientX, e.clientY);
    });

    this.switchTo(this.anim, true);
    this._scheduleWhisper();
    // 首帧后再锚一次：无头 / 预览面板首次布局的视口尺寸可能与挂载瞬间不同
    requestAnimationFrame(() => this.onResize());
  }

  // ---------------- 位置 ----------------
  _anchorPixel() {
    const W = window.innerWidth, H = window.innerHeight;
    const p = this.cfg.position || { corner: 'bottom-right', marginX: 24, marginY: 24 };
    const mx = p.marginX ?? 24, my = p.marginY ?? 24;
    const left = mx;
    const right = W - this.size - mx;
    const top = my;
    const bottom = H - this.h - my;
    switch (p.corner) {
      case 'top-left': return { x: left, y: top };
      case 'top-right': return { x: right, y: top };
      case 'bottom-left': return { x: left, y: bottom };
      default: return { x: right, y: bottom };
    }
  }

  _applyAnchor() {
    this.pos = this._anchorPixel();
    this._applyPos();
  }

  _applyPos() {
    // 用 transform 而不是 left/top：移动时只走合成器，不触发布局/重绘（漫游和抛掷每帧都在调）
    this.root.style.transform =
      'translate3d(' + Math.round(this.pos.x) + 'px,' + Math.round(this.pos.y) + 'px,0)';
  }

  /**
   * 视口坐标是否落在角色真实轮廓内。
   * 桌面模式靠它决定"接管鼠标"还是"穿透给下面的窗口"，所以必须够快：
   * 纯算术 + 查掩码表，不碰 DOM、不读布局，鼠标每帧调用也没有开销。
   */
  hits(x, y) {
    const vx = x - this.pos.x;
    // 拖拽时 stage 的脚底垫高被取消，视频盒整体上移 bottomPad
    const pad = this.dragging ? 0 : this.bottomPad;
    const vy = y - this.pos.y - pad;
    if (vx < 0 || vy < 0 || vx >= this.size || vy >= this.h) return false;
    const gx = ((vx / this.size) * MASK_W) | 0;
    const gy = ((vy / this.h) * MASK_H) | 0;
    const m = maskFor(this.anim);
    return m[gy * MASK_W + gx] === 1;
  }

  _bounds() {
    const W = window.innerWidth, H = window.innerHeight;
    return {
      minX: -this.sideAllow,
      minY: 0,
      maxX: W - this.size + this.sideAllow,
      maxY: H - this.h,
    };
  }

  onResize() {
    if (this.moved) {
      const b = this._bounds();
      this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
      this.pos.y = clamp(this.pos.y, b.minY, b.maxY);
    } else {
      this.pos = this._anchorPixel();
    }
    this._applyPos();
  }

  // ---------------- 视频双缓冲 ----------------
  _videoForNext() {
    // 前台是 A 就切到 B
    return this.frontIsA ? this.videos[1] : this.videos[0];
  }

  switchTo(anim, once, opts = {}) {
    if (!anim) return;
    this.anim = anim;
    this.once = once;
    const gen = ++this.gen;
    const el = this._videoForNext();
    const url = 'assets/webm/' + encodeURIComponent(anim) + ANIM_EXT;
    const sameSrc = el.dataset.anim === anim && el.readyState >= 2;

    el.loop = !once;
    el.onended = once ? () => this._handleEnded(gen) : null;

    const commit = () => {
      if (gen !== this.gen) return;
      const old = this.frontIsA ? this.videos[0] : this.videos[1];
      el.classList.add('is-front');
      if (old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        try { old.pause(); } catch { /* noop */ }
      }
      this.frontIsA = el === this.videos[0];
      el.style.transformOrigin = '50% 91.7%';
      this._applyFacing();
      el.play().catch(() => {});
      if (opts.squash) this._startSquash(el, opts.squash === true ? undefined : opts.squash);
      if (this.pendingMove) this._startMoveDrive(el);
    };

    if (sameSrc) {
      try { el.currentTime = 0; } catch { /* noop */ }
      commit();
      return;
    }
    el.dataset.anim = anim;
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      commit();
    };
    el.addEventListener('loadeddata', onReady, { once: true });
    el.src = url; // 赋 src 即触发加载；再显式 load() 会丢弃已缓冲的数据，换动画时更卡
  }

  _applyFacing() {
    const el = this.frontIsA ? this.videos[0] : this.videos[1];
    if (el) el.style.transform = (this.facing === 'right' ? 'scaleX(-1)' : 'scaleX(1)');
  }

  setFacing(dir) {
    this.facing = dir;
    this._applyFacing();
  }

  // ---------------- Q 弹挤压 ----------------
  _startSquash(el, squash) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(this.squashRaf);
    const t0 = now();
    const target = el;
    const mirror = this.facing === 'right' ? 'scaleX(-1) ' : 'scaleX(1) ';
    const step = () => {
      const u = clamp((now() - t0) / SQ_DURATION_MS, 0, 1);
      const s = squashScale(u, squash);
      target.style.transform = mirror + 'scaleY(' + s.toFixed(4) + ')';
      if (u < 1) this.squashRaf = requestAnimationFrame(step);
      else target.style.transform = mirror + 'scaleY(1)';
    };
    this.squashRaf = requestAnimationFrame(step);
  }

  // ---------------- 动画链 ----------------
  _handleEnded(gen) {
    if (gen !== this.gen) return; // 只认前台视频的 ended
    if (this._isEventAnim(this.anim)) { this._recover(); return; }
    if (this.anims.turn.includes(this.anim)) {
      this.setFacing(this.facing === 'left' ? 'right' : 'left');
    }
    if (this.anims.drag.includes(this.anim) || this.anims.clicks.includes(this.anim)) {
      this._recover();
      return;
    }
    this.pickNext();
  }

  _isEventAnim(name) {
    const ev = this.anims.events || {};
    return Object.values(ev).some((pool) => (pool || []).some(
      (slot) => (typeof slot === 'string' ? slot === name : slot.includes(name)),
    ));
  }

  /** 事件动画 / 互动动画播完：优先回状态档位，否则回 idle */
  _recover() {
    if (this._resumeWorkStatus()) return;
    this.switchTo(pick(this.anims.idle, this.anim), true);
  }

  pickNext() {
    const roll = Math.random();
    const k = rollKind(roll, this.weights, { fixed: this.cfg.fixedEnabled });
    if (k === 'idle') {
      this.switchTo(pick(this.anims.idle, this.anim), true);
    } else if (k === 'turn') {
      this.switchTo(pick(this.anims.turn, this.anim), true);
    } else if (k === 'move') {
      // 桌面模式下有概率改成"全屏飘一段"，否则在当前位置左右走
      if (this.cfg.roamEnabled !== false && Math.random() < (this.anims.moves?.roamChance ?? 0.5)) {
        if (this.roam()) return;
      }
      const moved = this.tryMove();
      if (moved === false) {
        const act = pickCategoryAction(this.anims.categories, this.anims.idle, this.facing, this.anim);
        this.switchTo(act.name, true);
      }
    } else {
      const act = pickCategoryAction(this.anims.categories, this.anims.idle, this.facing, this.anim);
      this.switchTo(act.name, true);
    }
  }

  // ---------------- 移动 ----------------
  _planMove(dir, mp) {
    const W = window.innerWidth;
    const distScale = this.size / PET_REF_WIDTH;
    const distance = randomBetween(mp.minDist * distScale, mp.maxDist * distScale);
    const cx = this.pos.x + this.size / 2;
    const cy = this.pos.y + this.h / 2;
    const target = cx + dir * distance;
    const halfW = this.size / 2;
    const side = this.sideAllow;
    const bodyHalf = halfW - side;
    if (target - bodyHalf - mp.margin < 0) return null;
    if (target + bodyHalf + mp.margin > W) return null;
    return {
      startX: cx,
      startY: cy,
      targetX: target,
      dir,
      leadSec: mp.leadSec,
      tailSec: mp.tailSec,
    };
  }

  /** 发起一次行走：占用中返回 true，无法移动返回 false，成功返回动作名 */
  tryMove(preferredName) {
    if (this.moveRaf !== null || this.pendingMove || this.throwRaf !== null) return true;
    const moves = this.anims.moves;
    if (!moves || !moves.actions || !moves.actions.length) return false;
    const chosen = preferredName
      ? moves.actions.find((a) => a.name === preferredName)
      : moves.actions[Math.floor(Math.random() * moves.actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.anims.turn.includes(this.anim) ? 1 : -1;
    const plan = this._planMove(dir, mp);
    if (!plan) return false;
    this.pendingMove = plan;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  _startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRaf !== null) return;
    this.pendingMove = null;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10;
    const window0 = Math.max(0.1, duration - pm.leadSec - pm.tailSec);
    const token = ++this.moveToken;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let cx;
      if (t <= pm.leadSec) cx = pm.startX;
      else if (t >= duration - pm.tailSec) cx = pm.targetX;
      else cx = pm.startX + pm.dir * Math.abs(pm.targetX - pm.startX) * ((t - pm.leadSec) / window0);
      this.pos.x = cx - this.size / 2;
      this.pos.y = pm.startY - this.h / 2;
      this.moved = true;
      this._applyPos();
      if (t < duration - pm.tailSec) this.moveRaf = requestAnimationFrame(step);
      else {
        this.moveRaf = null;
        this.pos.x = pm.targetX - this.size / 2;
        this._applyPos();
      }
    };
    this.moveRaf = requestAnimationFrame(step);
  }

  _stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRaf !== null) {
      cancelAnimationFrame(this.moveRaf);
      this.moveRaf = null;
    }
  }

  // ---------------- 全屏漫游（桌面模式） ----------------
  _canRoam() {
    return this.cfg.roamEnabled !== false
      && !this.dragging && this.throwRaf === null
      && this.moveRaf === null && this.roamRaf === null && !this.pendingMove;
  }

  /** 飘到屏幕任意位置（可以悬在半空），落地后回到动画链 */
  roam() {
    if (!this._canRoam()) return false;
    const b = this._bounds();
    const groundY = b.maxY;
    const spanY = Math.max(0, groundY - b.minY);
    // 大多数时候贴着"地面"跑，少数时候飘到半空（默认 30%）
    const flyHigh = spanY > this.h * 0.5 && Math.random() < 0.3;
    const targetY = flyHigh
      ? randomBetween(b.minY + 20, groundY - this.h * 0.45)
      : groundY;
    let targetX = randomBetween(b.minX, b.maxX);
    if (Math.abs(targetX - this.pos.x) < this.size * 0.45) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      targetX = clamp(this.pos.x + dir * this.size * (0.9 + Math.random() * 1.4), b.minX, b.maxX);
    }
    const x0 = this.pos.x, y0 = this.pos.y;
    const dist = Math.hypot(targetX - x0, targetY - y0);
    if (dist < this.size * 0.25) return false;
    const dur = clamp(700 + dist * 2.6, 900, 3600);
    const floatAnim = this.anims.moves?.float || '原地漂浮踏步';

    if (targetX !== x0) this.setFacing(targetX > x0 ? 'right' : 'left');
    this.moved = true;
    this.switchTo(floatAnim, false);

    const token = ++this.roamToken;
    const t0 = now();
    const step = () => {
      if (token !== this.roamToken) return;
      const u = clamp((now() - t0) / dur, 0, 1);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.pos.x = x0 + (targetX - x0) * e;
      this.pos.y = y0 + (targetY - y0) * e;
      this._applyPos();
      if (u < 1) {
        this.roamRaf = requestAnimationFrame(step);
      } else {
        this.roamRaf = null;
        if (targetY < groundY - 6) this._startThrow(0, 40); // 半空的轻轻沉下去
        else this._recover();
      }
    };
    this.roamRaf = requestAnimationFrame(step);
    return true;
  }

  _stopRoam() {
    this.roamToken++;
    if (this.roamRaf !== null) {
      cancelAnimationFrame(this.roamRaf);
      this.roamRaf = null;
    }
  }

  // ---------------- 拖拽 / 抛掷 ----------------
  _bindPointer() {
    const hit = this.hit;
    hit.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._onDown(e);
    });
    hit.addEventListener('pointermove', (e) => this._onMove(e));
    hit.addEventListener('pointerup', (e) => this._onUp(e));
    hit.addEventListener('pointercancel', (e) => this._onUp(e));
    hit.addEventListener('lostpointercapture', (e) => {
      if (this.dragging) this._onUp(e);
    });
  }

  _onDown(e) {
    unlock();
    this._stopMove();
    this._stopRoam();
    this._stopThrow();
    this._downAt = { t: now(), x: e.clientX, y: e.clientY };
    this.dragOffset = { x: e.clientX - this.pos.x, y: e.clientY - this.pos.y };
    this.dragTarget = { x: this.pos.x, y: this.pos.y };
    this.dragVel = { vx: 0, vy: 0 };
    this.dragTrail = [{ t: now(), x: e.clientX, y: e.clientY }];
    this.dragging = true;
    this.dragMoved = false;
    this.hit.classList.add('dragging');
    try { this.hit.setPointerCapture(e.pointerId); } catch { /* noop */ }
    // 拖拽期间取消脚底垫高，命中框跟着手走
    this.stage.style.transform = 'none';
    this.switchTo(pick(this.anims.drag, this.anim), false);
    this._startSpringFollow();
  }

  _onMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this._downAt.x;
    const dy = e.clientY - this._downAt.y;
    if (!this.dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.dragMoved = true;
    this.dragTarget = { x: e.clientX - this.dragOffset.x, y: e.clientY - this.dragOffset.y };
    this.dragTrail.push({ t: now(), x: e.clientX, y: e.clientY });
    this.dragTrail = trimTrail(this.dragTrail, now());
  }

  _startSpringFollow() {
    const token = ++this._springToken;
    let last = now();
    const step = () => {
      if (token !== this._springToken || !this.dragging) return;
      const t = now();
      const dt = clamp((t - last) / 1000, 0, MAX_STEP_DT);
      last = t;
      if (this.dragTarget) {
        const p = this.physics.throwPower ?? 1;
        this.dragVel.vx = springStep(this.dragVel.vx, this.pos.x, this.dragTarget.x, dt, p);
        this.dragVel.vy = springStep(this.dragVel.vy, this.pos.y, this.dragTarget.y, dt, p);
        this.pos.x += this.dragVel.vx * dt;
        this.pos.y += this.dragVel.vy * dt;
        this._applyPos();
      }
      this._springRaf = requestAnimationFrame(step);
    };
    this._springRaf = requestAnimationFrame(step);
  }

  _stopSpring() {
    this._springToken = (this._springToken || 0) + 1;
    if (this._springRaf) cancelAnimationFrame(this._springRaf);
    this._springRaf = null;
    this.dragTarget = null;
  }

  _onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this._stopSpring();
    this.hit.classList.remove('dragging');
    try { this.hit.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // 恢复脚底垫高
    this.stage.style.transform = `translateY(${this.bottomPad}px)`;

    if (!this.dragMoved) {
      this._clickRespond();
      return;
    }
    this.moved = true;
    const vel = estimateReleaseVelocity(this.dragTrail, now(), this.physics);
    if (!vel) {
      // 温柔放下：先夹回屏幕内（拖拽时不限制，可能已拖出边界），再回待机
      const b = this._bounds();
      this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
      this.pos.y = clamp(this.pos.y, b.minY, b.maxY);
      this._applyPos();
      this._recover();
      return;
    }
    this._startThrow(vel.vx, vel.vy);
  }

  _clickRespond() {
    const name = pick(this.anims.clicks, this.anim);
    this._playClickSound(name);
    this.switchTo(name, true, { squash: true });
  }

  /** 点一下的回应不同，音色也跟着换（开心上行 / 害羞上滑 / 傲娇下滑） */
  _playClickSound(name) {
    if (name.includes('开心') || name.includes('挥手') || name.includes('咯咯')) sound.happy();
    else if (name.includes('惊讶') || name.includes('惊吓')) sound.surprise();
    else if (name.includes('生气') || name.includes('傲娇')) sound.annoyed();
    else sound.click();
  }

  _startThrow(vx, vy) {
    this.throwState = { x: this.pos.x, y: this.pos.y, vx, vy };
    if (Math.hypot(vx, vy) > 500) sound.throw();
    const b = this._bounds();
    let last = now();
    const step = () => {
      const t = now();
      const dt = (t - last) / 1000;
      last = t;
      const prevVy = this.throwState.vy;
      const next = throwStep(this.throwState, dt, b, this.physics);
      this.throwState = next;
      this.pos.x = next.x;
      this.pos.y = next.y;
      this._applyPos();
      if (next.bounced) {
        sound.land(clamp(Math.abs(prevVy) / 1400, 0.25, 1));
        if (Math.abs(prevVy) > SQ_SOFT_SPEED) {
          const el = this.frontIsA ? this.videos[0] : this.videos[1];
          this._startSquash(el, landingSquash(prevVy));
        }
      }
      if (!next.atRest) {
        this.throwRaf = requestAnimationFrame(step);
      } else {
        this.throwRaf = null;
        this.throwState = null;
        this._recover();
      }
    };
    this.throwRaf = requestAnimationFrame(step);
  }

  _stopThrow() {
    if (this.throwRaf !== null) cancelAnimationFrame(this.throwRaf);
    this.throwRaf = null;
    this.throwState = null;
  }

  // ---------------- 气泡 ----------------
  say(text, image, ms = BUBBLE_MS) {
    if (!text && !image) return;
    this.bubText.textContent = text || '';
    const old = this.bubble.querySelector('.pet-bub-img');
    if (old) old.remove();
    if (image) {
      const img = document.createElement('img');
      img.className = 'pet-bub-img';
      img.src = 'assets/memes/' + encodeURIComponent(image) + '.png';
      img.alt = '';
      this.bubble.insertBefore(img, this.bubText);
    }
    this.bubble.classList.toggle('has-img', !!image);
    this.bubble.classList.add('is-on');
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    if (ms > 0) this.bubbleTimer = window.setTimeout(() => this.bubble.classList.remove('is-on'), ms);
  }

  hideBubble() {
    this.bubble.classList.remove('is-on');
  }

  whisper() {
    const lines = this.app.whisperLines || [];
    const memes = this.app.memeNames || [];
    const text = lines.length ? pick(lines) : '';
    const image = memes.length && Math.random() < 0.45 ? pick(memes) : null;
    sound.bubble();
    this.say(text, image);
    const pool = this.anims.events?.whisper;
    if (pool && pool.length) this.switchTo(pickSlot(pick(pool), this.anim), true);
  }

  _scheduleWhisper() {
    if (!this.cfg.whisperEnabled) return;
    const sec = this.app.eventRefreshSec?.whisper || 300;
    const tick = () => {
      // 工作中不打扰
      if (!this.workState) this.whisper();
      this.whisperTimer = window.setTimeout(tick, sec * 1000);
    };
    this.whisperTimer = window.setTimeout(tick, sec * 1000);
  }

  // ---------------- 工作状态联动 ----------------
  setWorkStatus(state) {
    const enabled = this.cfg.workStatusEnabled !== false;
    const idx = WORK_STATUS_INDEX[state];
    if (!enabled || idx === undefined) {
      if (!state || state === 'idle') {
        this.workState = null;
        this.hideBubble();
        this._recover();
      }
      return;
    }
    this.workState = state;
    if (state === 'success') sound.success();
    else if (state === 'error') sound.error();
    else if (state === 'waiting') sound.waiting();
    const terminal = state === 'success' || state === 'error';
    const pool = this.anims.events?.workStatus || [];
    const slot = pool[idx];
    if (slot) {
      const name = pickSlot(slot, this.anim);
      this.switchTo(name, terminal);
    }
    const texts = this.app.workStatusTexts?.[idx];
    if (texts && texts.length) this.say(pick(texts), null, terminal ? 6000 : 0);
  }

  _resumeWorkStatus() {
    const s = this.workState;
    if (!s || s === 'success' || s === 'error') return false;
    const pool = this.anims.events?.workStatus || [];
    const slot = pool[WORK_STATUS_INDEX[s]];
    if (!slot) return false;
    this.switchTo(pickSlot(slot, this.anim), false);
    return true;
  }

  /** 回到右下角的初始位置并恢复待机（菜单、快捷键、HTTP 都走这里） */
  goHome() {
    this.moved = false;
    this._applyAnchor();
    this._recover();
  }

  // ---------------- 右键菜单 ----------------
  _openMenu(x, y) {
    if (this._menu) this._menu.close();
    const memeNodes = (this.app.memeNames || []).map((n) => ({ label: n, meme: n }));
    const tree = buildMenuTree(this.app, { memeNodes: memeNodes.length ? memeNodes : [{ label: '（素材缺失）', anim: this.anims.idle[0] }] });
    const menu = new PetMenu(tree, (node) => this._onMenu(node), () => {
      if (this._menu === menu) this._menu = null;
      lockInteractive(false);
    });
    menu.open(x, y);
    this._menu = menu;
    // 菜单开着的时候整块区域都要能点，别让落点判定把菜单边缘判成穿透
    lockInteractive(true);
  }

  _onMenu(node) {
    if (node.action === 'whisper') return this.whisper();
    if (node.action === 'sound') { this.app.toggleSound?.(); return; }
    if (node.action === 'roam') { this._recover(); return this.roam(); }
    if (node.action === 'home') return this.goHome();
    if (node.action === 'reload') return location.reload();
    if (node.anim) {
      const isMove = (this.anims.moves?.actions || []).some((a) => a.name === node.anim);
      if (isMove) {
        this.tryMove(node.anim);
        return;
      }
      this.switchTo(node.anim, true);
      return;
    }
    if (node.meme) return this.say('', node.meme);
  }

  destroy() {
    if (this.whisperTimer) clearTimeout(this.whisperTimer);
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this._stopMove(); this._stopRoam(); this._stopThrow(); this._stopSpring();
    this.root.remove();
  }
}
