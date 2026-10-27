"""物理内存全面盘点：系统总览 + 按进程名聚合的 Top 榜。

为什么要分开看：
  - WorkingSet（工作集）= 真正压在物理内存里的部分
  - PrivateUsage（提交）= 已经向系统"预订"的地址空间，其中一部分被换到 pagefile
  - 系统缓存/内核池/驱动锁定 = 不属于任何进程，但同样吃物理内存
任务管理器那个百分比是「物理内存 - 可用」，可用 = 空闲 + 随时可回收的待机缓存。

用法：python dev/memreport.py [topN]
"""
import ctypes
import ctypes.wintypes as wt
import collections
import sys

psapi = ctypes.windll.psapi
kernel32 = ctypes.windll.kernel32
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010


class PERFORMANCE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD),
        ("CommitTotal", ctypes.c_size_t),
        ("CommitLimit", ctypes.c_size_t),
        ("CommitPeak", ctypes.c_size_t),
        ("PhysicalTotal", ctypes.c_size_t),
        ("PhysicalAvailable", ctypes.c_size_t),
        ("SystemCache", ctypes.c_size_t),
        ("KernelTotal", ctypes.c_size_t),
        ("KernelPaged", ctypes.c_size_t),
        ("KernelNonpaged", ctypes.c_size_t),
        ("PageSize", ctypes.c_size_t),
        ("HandleCount", wt.DWORD),
        ("ProcessCount", wt.DWORD),
        ("ThreadCount", wt.DWORD),
    ]


class PMC_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD),
        ("PageFaultCount", wt.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


pi = PERFORMANCE_INFORMATION()
pi.cb = ctypes.sizeof(pi)
psapi.GetPerformanceInfo(ctypes.byref(pi), pi.cb)
MB = 1024 * 1024
page = pi.PageSize


def mb(v):
    return v * page / MB if v > 10**9 else v / MB


def gb(v):
    return v / (1024 ** 3)


def fmt_bytes(b):
    return f"{b / 1024**3:.2f}GB" if b >= 1024**3 else f"{b / MB:.0f}MB"


total = pi.PhysicalTotal * page
avail = pi.PhysicalAvailable * page
used = total - avail

print("=" * 68)
print("物理内存总览")
print("=" * 68)
print(f"  物理内存      {fmt_bytes(total)}")
print(f"  已用          {fmt_bytes(used)}  ({used * 100 / total:.1f}%)")
print(f"  可用          {fmt_bytes(avail)}   ← 包含随时可回收的待机缓存")
print(f"  系统缓存      {fmt_bytes(pi.SystemCache * page)}")
print(f"  内核合计      {fmt_bytes(pi.KernelTotal * page)}"
      f"  (分页 {fmt_bytes(pi.KernelPaged * page)} / 非分页 {fmt_bytes(pi.KernelNonpaged * page)})")
print(f"  提交          {fmt_bytes(pi.CommitTotal * page)} / 上限 {fmt_bytes(pi.CommitLimit * page)}")
print(f"  进程 {pi.ProcessCount}  线程 {pi.ThreadCount}  句柄 {pi.HandleCount}")

# ---- 进程枚举 ----
arr = (wt.DWORD * 8192)()
needed = wt.DWORD()
psapi.EnumProcesses(ctypes.byref(arr), ctypes.sizeof(arr), ctypes.byref(needed))
n = needed.value // ctypes.sizeof(wt.DWORD)

agg_ws = collections.Counter()
agg_pf = collections.Counter()
cnt = collections.Counter()

for i in range(n):
    pid = arr[i]
    if pid == 0:
        continue
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        continue
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wt.DWORD(512)
        q = kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
        name = buf.value.split("\\")[-1] if q else f"pid{pid}"
        pmc = PMC_EX()
        pmc.cb = ctypes.sizeof(pmc)
        if psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb):
            agg_ws[name] += pmc.WorkingSetSize
            agg_pf[name] += pmc.PrivateUsage
            cnt[name] += 1
    finally:
        kernel32.CloseHandle(h)

topN = int(sys.argv[1]) if len(sys.argv) > 1 else 18

print()
print("=" * 68)
print(f"按进程名聚合 · 物理内存（工作集）Top {topN}")
print("=" * 68)
print(f"  {'进程':<28}{'实例':>5}{'工作集':>10}{'提交':>10}")
sum_ws = 0
for name, ws in agg_ws.most_common(topN):
    print(f"  {name[:27]:<28}{cnt[name]:>5}{ws / MB:>9.0f}M{agg_pf[name] / MB:>9.0f}M")
    sum_ws += ws
all_ws = sum(agg_ws.values())
print(f"  {'—' * 50}")
print(f"  {'所有进程合计':<28}{sum(cnt.values()):>5}{all_ws / MB:>9.0f}M"
      f"{sum(agg_pf.values()) / MB:>9.0f}M")
print()
print(f"  进程合计占物理内存 {all_ws / total * 100:.1f}%  "
      f"内核+缓存+其他 {(used - all_ws) / total * 100:.1f}%")
