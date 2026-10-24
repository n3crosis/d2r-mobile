# Bounded browser shader compilation

Shader generation overlaps the existing serial translation/reflection/source-proof
pipeline with at most four AIR compiler workers. Each worker owns its own compiler
instance and WASM heap. Verified public code is compiled once as a WebAssembly.Module
and cloned to same-origin workers; private shader sources are never shared memory.
Recycling reuses this verified code without fetching anything after private input.
No SharedArrayBuffer, browser flags, or cross-origin isolation changes are required
by this independent-worker design.

The initial pool width is the minimum of four, reported CPU concurrency, and a
conservative memory-hint cap: four for deviceMemory >= 8 GiB, two for >= 4 GiB,
one below 4 GiB, and two if the hint is absent. Missing CPU hints default to two.
These are coarse device hints, not available/free RAM measurements. Initialization
is sequential and stops adding workers once observed startup heaps total 512 MiB.
If an additional worker cannot be created or reports an allocation/memory-limit
failure, the already initialized pool is kept. Integrity, protocol and other
initialization errors fail closed. The UI reports the actual initialized width.

At most that many translated records are retained in the compilation window; no
catalog-wide source queue is created. A record compiles its base and optional fetch
variant in sequence. Cache reads may overlap, but accepted cache writes serialize
within that bounded window so concurrent results are not silently skipped. Output
retains the existing combined 512 MiB byte/replay budget. Final output sorting and
the complete 6,927-record source-digest proof remain required before publication.

Cancellation, timeout, or a compilation failure terminates all compiler workers
and drains outstanding record tasks before clearing retained bytes. A single
compiler instance never receives concurrent calls. Existing per-worker heap,
source, output and recycling guards remain; the pool also checks observed heaps
against 1 GiB after replies. These post-call guards cannot intercept synchronous
WASM growth or prevent an operating-system/browser renderer OOM kill. They do not
promise any browser-wide memory cap.

Synthetic protocol and production-loop tests cover four simultaneous compiles,
queue bounds, out-of-order replies, recycling, startup fallback/failure races,
cache serialization, proof-first deterministic output and cancellation cleanup.
They do not measure real Chrome throughput, memory usage or speedup. Translation
remains serial, and CPU, RAM, cache and source complexity affect actual performance.

Chrome references: [same-origin WASM module sharing](https://developer.chrome.com/blog/wasm-module-sharing-restricted-to-same-origin)
and [SharedArrayBuffer isolation requirements](https://web.dev/articles/cross-origin-isolation-guide).

## 简体中文

着色器生成保留串行翻译、反射与源码证明流程，同时使用最多四个独立 AIR 工作线程。
每个线程有独立 WASM 堆，仅复用验证过的公开模块；不使用共享内存、特殊浏览器参数或
新的跨源隔离设置，也不会在处理私有输入后重新联网获取代码。

线程数根据 CPU 与粗略内存提示保守选择，缺少内存提示时最多两个；额外线程遇到明确
的创建或内存资源错误时保留已启动线程，完整性或协议错误则中止。界面显示实际线程数。
这些提示不是可用 RAM 测量，运行时检查也无法保证避免浏览器进程被内存不足终止。

仅保留固定窗口内的记录，缓存提交串行执行，仍需完整 6,927 条记录的摘要证明、确定性
输出顺序与现有 512 MiB 输出预算。取消、超时或编译失败会停止所有线程并清理待处理
结果。当前测试仅为合成协议和生产循环模拟，未测量真实 Chrome 性能、内存或加速比。
