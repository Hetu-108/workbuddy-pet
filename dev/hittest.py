"""测命中测试成本：WindowFromPoint 是系统每次鼠标移动都要做的事，
它要按 z 序逐个窗口问"这点是不是你的"。一个覆盖大半屏、带
WS_EX_TRANSPARENT 的置顶窗口，会让每一次询问都多绕一圈。

用 1000Hz 鼠标算，单次多 0.05ms 就是每秒 50ms 的额外开销。

用法：python dev/hittest.py
"""
import ctypes
import ctypes.wintypes as wt
import statistics
import time

user32 = ctypes.windll.user32


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


user32.WindowFromPoint.restype = wt.HWND
user32.WindowFromPoint.argtypes = [POINT]


def cost(x, y, n=4000):
    p = POINT(x, y)
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        user32.WindowFromPoint(p)
        ts.append((time.perf_counter() - t0) * 1e6)   # 微秒
    ts.sort()
    return statistics.median(ts), ts[int(n * 0.95)]


def name_at(x, y):
    h = user32.WindowFromPoint(POINT(x, y))
    if not h:
        return "(none)"
    ln = user32.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(ln + 1)
    user32.GetWindowTextW(h, buf, ln + 1)
    cls = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(h, cls, 256)
    return f"{buf.value or '(无标题)'} [{cls.value}]"


pts = [
    (400, 240, "左上(无窗口)"),
    (1280, 300, "上中(无窗口)"),
    (2200, 300, "右上(无窗口)"),
    (2200, 1100, "下半屏(窗口区·空处)"),
    (2380, 1300, "鱼身上"),
]
print(f"{'位置':<22}{'中位':>9}{'p95':>9}   命中窗口")
for x, y, label in pts:
    med, p95 = cost(x, y)
    print(f"{label:<22}{med:8.2f}us{p95:8.2f}us   {name_at(x, y)}")

print()
print("参考：1000Hz 鼠标每秒移动 1000 次，单次多 1us = 每秒多 1ms")
