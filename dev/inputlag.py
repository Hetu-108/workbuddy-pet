"""测鼠标输入的到达延迟：SetCursorPos 发出 -> WH_MOUSE_LL 钩子收到的时间差。

窗口只覆盖工作区下半部分，所以「在上半屏移动」与「在下半屏移动」
构成天然对照组：
  - 若两者延迟接近  -> 窗口不是原因
  - 若下半屏明显更高 -> 透明置顶窗在吃鼠标输入

用法：python dev/inputlag.py [每轮次数]
"""
import ctypes
import ctypes.wintypes as wt
import statistics
import sys
import time

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WH_MOUSE_LL = 14
WM_MOUSEMOVE = 0x0200
PM_REMOVE = 0x0001

events = []
HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, wt.WPARAM, wt.LPARAM)


def _cb(nCode, wParam, lParam):
    if nCode == 0 and wParam == WM_MOUSEMOVE:
        events.append(time.perf_counter())
    return user32.CallNextHookEx(None, nCode, wParam, lParam)


proc = HOOKPROC(_cb)
hook = user32.SetWindowsHookExW(WH_MOUSE_LL, proc, kernel32.GetModuleHandleW(None), 0)
if not hook:
    print("装不上低级鼠标钩子")
    sys.exit(1)


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def pump(ms=0):
    """把消息队列泵一下，钩子回调才有机会跑。"""
    msg = wt.MSG()
    end = time.perf_counter() + ms / 1000.0
    while True:
        while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_REMOVE):
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        if time.perf_counter() >= end:
            break
        time.sleep(0.0003)


def measure(y, n, label):
    lat = []
    xs = [600 + (i * 37) % 700 for i in range(n)]
    for x in xs:
        pump(1)                    # 排空
        before = len(events)
        t0 = time.perf_counter()
        user32.SetCursorPos(x, y)
        deadline = t0 + 0.25
        got = None
        while time.perf_counter() < deadline:
            pump(0)
            if len(events) > before:
                got = events[before] - t0
                break
            time.sleep(0.0002)
        if got is not None:
            lat.append(got * 1000)
    lat.sort()
    p50 = statistics.median(lat)
    p95 = lat[int(len(lat) * 0.95)] if len(lat) > 3 else lat[-1]
    print(f"{label:<22} n={len(lat):<4} 中位 {p50:6.2f}ms  p95 {p95:6.2f}ms  "
          f"max {lat[-1]:6.2f}ms")
    return p50, p95


n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
orig = POINT()
user32.GetCursorPos(ctypes.byref(orig))

print("预热…")
measure(300, 20, "预热")
print()
a = measure(300, n, "上半屏（无窗口）")
b = measure(1250, n, "下半屏（窗口区）")
a2 = measure(300, n, "上半屏（复测）")
b2 = measure(1250, n, "下半屏（复测）")

user32.SetCursorPos(orig.x, orig.y)
user32.UnhookWindowsHookEx(hook)

print()
up = (a[1] + a2[1]) / 2
dn = (b[1] + b2[1]) / 2
print(f"上/下半屏 p95 比值: {dn / up:.2f}x")
if dn > up * 1.5:
    print(">>> 窗口区明显更慢，透明窗在吃鼠标输入")
else:
    print(">>> 两半接近，窗口不是鼠标延迟的来源")
