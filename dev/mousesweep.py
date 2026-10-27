"""边扫鼠标边测 DWM 合成节奏。

DWM 的帧节奏本身是 165fps 零掉帧的，所以如果"鼠标发卡"是真的，
最可能发生在鼠标划到角色轮廓、触发窗口接管/放开的那个瞬间——
那一下要改窗口扩展样式（WS_EX_TRANSPARENT），Windows 会重新做命中测试。

用法：python dev/mousesweep.py
"""
import ctypes
import statistics
import time

dwmapi = ctypes.windll.dwmapi
user32 = ctypes.windll.user32


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def measure(n, mover=None, label=""):
    gaps = []
    bad = 0
    prev = None
    t_end = time.perf_counter() + 0.25
    while time.perf_counter() < t_end:
        dwmapi.DwmFlush()
    for i in range(n):
        if mover:
            mover(i)
        dwmapi.DwmFlush()
        now = time.perf_counter()
        if prev is not None:
            g = (now - prev) * 1000
            gaps.append(g)
            if g > 9.0:
                bad += 1
        prev = now
    gaps.sort()
    p50 = statistics.median(gaps)
    p95 = gaps[int(len(gaps) * 0.95)]
    p99 = gaps[int(len(gaps) * 0.99)]
    print(f"{label:<28} 中位 {p50:5.2f}ms  p95 {p95:6.2f}  p99 {p99:6.2f}  "
          f"max {gaps[-1]:6.2f}  掉帧 {bad * 100 / len(gaps):4.1f}%")
    return p50, p95, bad * 100 / len(gaps)


orig = POINT()
user32.GetCursorPos(ctypes.byref(orig))

N = 500

base = measure(N, None, "① 鼠标不动")

def sweep_top(i):
    user32.SetCursorPos(1850 + (i * 13) % 650, 300)

def sweep_bottom(i):
    # 右下角：鱼和它的菜单都在这片区域
    user32.SetCursorPos(1850 + (i * 13) % 650, 1300)

up = measure(N, sweep_top, "② 上半屏扫动")
dn = measure(N, sweep_bottom, "③ 下半屏扫动(含鱼)")

user32.SetCursorPos(orig.x, orig.y)

print()
print(f"扫动 vs 静止:  p99 {up[2]:.1f}% -> {dn[2]:.1f}% 掉帧")
if dn[2] > base[2] + 3 or dn[1] > base[1] * 1.5:
    print(">>> 鼠标划过鱼所在的区域会拖慢合成")
else:
    print(">>> 鼠标扫动没有拖慢合成，窗口本身是无辜的")
