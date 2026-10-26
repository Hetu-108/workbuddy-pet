// 右键菜单：多级平铺面板（移植自 dsh-pet 0.3.7 的 src/shared/menu.ts 级联交互）
// 每一级都是独立面板，全部平级挂在根容器下，贴边自动翻转，绝不嵌套（避免被父级滚动区裁切）。

const COL_W = 168;
const COL_MAXH = 0.62;

export class PetMenu {
  /**
   * @param {Array} tree 菜单树：[{label, children}|{label, anim}|{label, action}]
   * @param {(node) => void} onPick 叶子被点击
   * @param {() => void} [onClose] 面板真正关闭后回调（用来解除鼠标接管）
   */
  constructor(tree, onPick, onClose) {
    this.tree = tree;
    this.onPick = onPick;
    this.onClose = onClose;
    this.root = null;
    this.columns = [];
    this.hideTimer = null;
  }

  open(x, y) {
    this.close();
    const root = document.createElement('div');
    root.className = 'pet-menu';
    document.body.appendChild(root);
    this.root = root;
    root.addEventListener('mouseleave', () => this.scheduleClose());
    root.addEventListener('mouseenter', () => this.cancelClose());

    this._openColumn(this.tree, 0, x, y, null, null);

    document.addEventListener('pointerdown', this._onDocDown = (e) => {
      if (!this.root || !this.root.contains(e.target)) this.close();
    }, true);
    document.addEventListener('keydown', this._onKey = (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  /** 打开第 level 级面板：parentRect = 上一级被悬停的项，parentCol = 上一级面板 */
  _openColumn(nodes, level, x, y, parentRect, parentCol) {
    // 收起更深的同级面板
    while (this.columns.length > level) {
      const c = this.columns.pop();
      c.el.remove();
    }
    const col = document.createElement('div');
    col.className = 'pet-menu-column';
    col.style.left = '0px';
    col.style.top = '0px';
    this.root.appendChild(col);
    col.style.minWidth = COL_W + 'px';
    col.style.maxHeight = Math.round(window.innerHeight * COL_MAXH) + 'px';

    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = 'pet-menu-item' + (node.children ? ' has-sub' : '');
      const label = document.createElement('span');
      label.textContent = node.label;
      item.appendChild(label);
      if (node.children) {
        const arrow = document.createElement('span');
        arrow.className = 'pet-menu-arrow';
        arrow.textContent = '▸';
        item.appendChild(arrow);
        item.addEventListener('mouseenter', () => {
          const r = item.getBoundingClientRect();
          this._openColumn(node.children, level + 1, r.right - 4, r.top - 4, r, col);
        });
      } else {
        item.addEventListener('mouseenter', () => {
          while (this.columns.length > level + 1) this.columns.pop().el.remove();
        });
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close();
          this.onPick(node);
        });
      }
      col.appendChild(item);
    }

    // ---- 定位 ----
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const EDGE = 6;
    const rect = col.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    let left;
    let top;

    if (!parentRect) {
      // 第一级：贴着鼠标，但右侧至少留出三列宽度，子菜单才能一路向右展开
      left = x;
      const reserve = COL_W * 3 + 12;
      if (left + w + reserve > vw - EDGE) left = Math.max(EDGE, vw - EDGE - w - reserve);
      top = y;
      if (top + h > vh - EDGE) top = Math.max(EDGE, y - h);
    } else {
      // 子级：优先挂在父面板右侧；右边真放不下，就翻到"整个级联最左边那列"的外侧，
      // 绝不压住任何已展开的面板，也不会往下堆叠
      const pr = parentCol.getBoundingClientRect();
      left = pr.right - 2;
      if (left + w > vw - EDGE) {
        const cascadeLeft = Math.min(...this.columns.map((c) => c.el.getBoundingClientRect().left));
        left = cascadeLeft - w - 2;
      }
      if (left < EDGE) left = EDGE;
      // 竖直方向对齐被悬停的项，越界就整体上提
      top = y;
      if (top + h > vh - EDGE) top = Math.max(EDGE, vh - EDGE - h);
    }

    col.style.left = left + 'px';
    col.style.top = top + 'px';

    this.columns.push({ el: col, level });
  }

  scheduleClose() {
    this.cancelClose();
    this.hideTimer = window.setTimeout(() => this.close(), 220);
  }

  cancelClose() {
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  close() {
    this.cancelClose();
    if (this._onDocDown) document.removeEventListener('pointerdown', this._onDocDown, true);
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    this._onDocDown = this._onKey = null;
    const wasOpen = !!this.root;
    if (this.root) this.root.remove();
    this.root = null;
    this.columns = [];
    if (wasOpen && this.onClose) this.onClose();
  }
}

/** 由配置构造菜单树 */
export function buildMenuTree(cfg, extra) {
  const a = cfg.animations;
  const branch = (label, pool) => {
    const names = (pool || []).filter(Boolean);
    if (!names.length) return null;
    return {
      label,
      children: names.map((n) => (typeof n === 'string' ? { label: n, anim: n } : n)),
    };
  };

  const actionKids = [
    branch('待机', a.idle),
    branch('转向', a.turn),
    branch('拖拽', a.drag),
    branch('点击回应', a.clicks),
    branch('移动', (a.moves?.actions || []).map((x) => x.name)),
    ...(a.categories || []).map((c) => branch(c.id, c.actions)),
    branch('工作状态', a.events?.workStatus),
    branch('碎碎念', a.events?.whisper),
  ].filter(Boolean);

  return [
    { label: '陪我唠一句', action: 'whisper' },
    { label: cfg.soundEnabled === false ? '音效：关' : '音效：开', action: 'sound' },
    ...(cfg.desktop ? [{ label: '随便飞一下', action: 'roam' }] : []),
    { label: '回到初始位置', action: 'home' },
    { label: '换张脸（表情包）', children: extra.memeNodes },
    { label: '动作', children: actionKids },
    { label: '重载配置 / 刷新', action: 'reload' },
  ];
}
