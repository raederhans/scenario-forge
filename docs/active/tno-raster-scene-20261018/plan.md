# TNO raster-first scene renderer

## 当前续轮（2026-10-19，仍在实施）

当前已移除世界地形纹理重采样，改为完整原生 viewport Canvas 和三份以内的精确相机缓存；原 80MiB 共享准入不变。边界使用完整未裁剪路径，按独立 paint 分批，复用专用 Worker 做 GPU 消费。政治与边界来源等待仍和显示场景解耦。已移除 retained TNO 导航开始时的重复边界快照，将边界 policy packet 改为可取消异步准备，并去掉轮廓排序中的临时坐标数组。

v100 证明首轮 250% 的两次边界候选具有完全相同输入，第二次仅因 deferred infra 无条件标脏产生。新保留分支仅在完整派生状态已备好、未恢复 full collection、不需 opening-owner 刷新时请求；动态重建前后须同一已提交画布、clean cache、完整来源/样式/相机/layout/DPR key 一致才保留。31 项边界/infra 测试通过。

当前 v111 的稳定性结论仍是部分完成。三独立 Chrome/DPR2 会话、各三轮130→250→100，共27次完整就绪通过；250%的9次没有≥50ms任务，重复250%的6次最大rAF为91.6–91.7ms，首次250仍为266.7–291.6ms。第三会话首次130出现157/206ms任务，保留慢样本。不能据此宣布总体长任务或帧尖峰已解决。

本次进一步实现私有country sets、普通政治组合循环真实分片、各阶段host任务边界、相同输入revision取消重试metadata delta修复、稳定投影bounds缓存、河流完整Path2D复用，以及保留原PATCH顺序的等价完整轮廓Worker确认。既有完整就绪、取消、原子发布、资源和画质门槛均未放宽。

严格质量仍未通过：世界地形重采样已移除，最终完整复验的原生viewport路径在130/250/100%同页比较为1/0/1个像素差异，跨页130还有1个；完整场景、rawGPU和其他图层零差异。不能把原生对照也出现微小差异当成豁免。空间tile、分批flush、CPU backing、labels预消费和完整disjoint路径合并实验均未获同时满足质量/性能的证据，未进入产品。当前冻结代码的完整编辑、三档held准备期间编辑/undo/redo、导出/context loss、GPU60与构建镜像9项检查均通过。177项目标测试、架构和source graph通过，pr:plan仅为规划；自有服务与浏览器已收尾。历史v58的数字与32MiB world raster不代表当前产品。

## 上一轮执行记录（历史 v58）

政治 collection/source 已使用可取消私有准备并原子切换；政治 GPU 已按 tile 在独立任务上传到私有候选。physicalBase 保留原生完整 pass 顺序，通过 fence 后的私有 32MiB world raster 复用，禁止曾产生像素差异的有限 fill/tile 拆分。预检并行启动政治、水域、地形、边框和国家标签，显示场景始终独立。标签四个按需 worker 自行续队列，完整当前视图只发布一次；不可见 alpha 的严格上界可排除无输出 fit。精确调度器也已预启动 exact/deferred producers，边框 Worker 可先私有计算，commit 仍保留原门槛。

最多三个非政治Canvas纹理私有上传及原子采用已实施，仍使用原80/160MiB预算；旧纹理、overview、政治pending与private候选全部计账。真实GPU60/60像素检查通过。最终v58普通及三档held-worker编辑全部通过，130/250/100%完整就绪2524.2/4686.7/3317.6ms，max long task0/64/0ms、max rAF158.4/208.3/166.5ms。完整smoke6与lifecycle3通过，均无console/network错误。最终仅将准备/排队和布局纯计算移入既有模块，目标行为与Python22、架构预算检查通过；artifact-only构建983.94MiB及9/9源码镜像检查通过。本次浏览器和server48752已关闭，无提交/推送/部署。

保留验收缺口：250%仍有64ms主线程长任务和208ms帧尖峰；v57曾出现130%帧间隔退化，单次改善不证明稳定分布。地形world/native严格RGBA对比186/449/147像素差异，最大1/255，未放宽零容差。完整就绪明显改善，但整体流畅度和byte-exact地形质量目标保持未完成。详见task.md最新结果，旧阶段记录不代表当前状态。

DPR2 验收必须同时等待 atlas、政治/水域/边框精细结果、secondary index、当前 country-label fits 和 labels pass 已绘制。计时与截图/trace 分开，保留慢样本。真实 held-worker 的编辑/undo/redo、save/load、export/context loss 继续验证；root 唯一拥有 live browser/server/build，写入期间不做计时。

## Goal

Replace the TNO interactive display path with direct GPU composition, independent layer refresh, and resident binary display geometry. Validate the complete real editing/navigation loop, not an isolated political fill benchmark. User authorizes implementation in a separate worktree and TNO raster-first display; preserve the primary checkout WIP.

## Scope and sources of truth

Baseline `5fbbfdcff93ae36e24261b0e7f1ae58239fa4cc4`, branch `codex/tno-raster-scene-20261018`. Canonical IDs, paint/history, project files and high-resolution export retain their existing authority. Only derived display data becomes raster-first. Explicit vector selection and observable unavailable-GPU recovery remain available. No production publication is authorized by this implementation request.

## Stages

### Recovery and long-task continuation (2026-10-18, current implementation)

v25 captured the actual renderer exit 0xe0000008 with a V8 young-object-promotion OOM. Compact typed contour storage and main-thread binary streaming reduce diagnostic contour Worker heap from1.722GB to0.463GB. Strict immutable publication acknowledgement removes full12,144-feature resends and a duplicate scan; index UI now coalesces into a separate task after the coarse-frame gate. Final uninstrumented v37 passes normal and all held edit/history/release loops, with strict readiness2.469/3.723/4.071s and max main tasks0/50/104ms, rAF408/258/425ms. Compared with v29's same-oracle2.187/6.218/5.614s,250/100 improve while130 does not. Do not replace final outliers with faster v32 values. Total renderer memory remains high. The ineffective completed-graph cache was removed after v36 recorded zero hits. Final smoke and lifecycle pass; build and process closure are recorded in context.md. No commit, push or publication performed.

The remaining architecture work is concrete: political display filtering/source validation still runs synchronously for about39–43ms in diagnostic zoom samples, including inside render at100%. Moving it requires a private, cancelable candidate and current scene/projection/geometry/color/foreground validation before atomic adoption; adding yields to the mutating publish method is unsafe. Native Canvas GPU raster bursts still cause hundreds-of-ms frame gaps. This iteration does not close the broad smoothness target.

The deterministic lazy-code compression/gutter thrash is fixed: the same smoke path's 100% tile binding fell from 13.7 seconds to about 100 ms, with the same tile/palette upload and resident counts. Water exact-content aliases now retain identical binary geometry and paths across LOD versions. GPU frame publication uses one private plan; selected-mask clip invalidation and obsolete navigation producer retirement remove redundant work. Retained-scene border workers no longer require the native path's extra quiet period; fallback/identity/admission remain intact.

Historical pre-OOM evidence: v18 froze after held100 release and v17 at held250. Fault-only debugger/trace metadata could not establish cause. The Node watchdog fixed diagnostic reachability, not the freeze. v25 later supplied the actual crash evidence above. The final oracle includes border mesh/contour, dirty borders and prepared paths, so older 2–3s numbers are not directly comparable. See task.md for final results and preserved failures.

Historical implementation notes follow:

Preserve the same worktree and previous WIP. Diagnose the original 100% watchdog without treating a passing retry as proof of a fix. Water now prepares on a dedicated resident binary worker with full bitmap publication, cancellation and bounded native fallback. Cold political CPU tile codes compress losslessly under the existing 48 MiB cap; worker paths remain under 16 MiB. City geometry/localization prepares privately in slices with complete atomic publication. Border topology and paint-contour geometry use transferable Float64 buffers. Current final work prepares precise border Path2D in slices before the border pass and clears only painted scratch bounds for water. Preserve pixel, history, export and scene identity contracts. Root alone owns live browser/server/build; no timed browser run overlaps writers, tests or builds. The old watchdog cause remains unproven. See task.md for failed experiments, diagnostics and final measurements as they become available.

### Full readiness continuation (2026-10-18, implemented and locally validated)

The user requested a substantial reduction in the previous DPR 2 full-readiness time of 8–9 seconds and the remaining synchronous political work. Asset reads now use readonly single-key IDB transactions; optional writes run only after a complete scene publication and idle time, with one candidate capped at 8 MiB and cancelled by a new producer. Worker asset I/O and geometry use separate queues. Political collections, primary spatial maps, colors and coverage prepare privately in slices before the render lock, then publish in O(1). Mixed Atlantropa payloads join the candidate; mixed strategic-value changes retain the existing synchronous transaction. City padding policy is read once per batch. Full localization copies/merges privately in 6 ms slices and atomically publishes the complete base plus scenario; apply epoch, request, references and revision changes cancel and redo stale work. Equivalence was checked against the old source on 106,934 real entries.

`readiness-v6-dpr2` passed normal 130/250/100% zoom and actual held-worker paint/undo/redo, including pixels/history after release into the final precise scene. Full readiness was 2620.2/4139.9/2677.5 ms against the earlier same-device/configuration `zoom-atomic-dpr2` 8848.7/8383.7/8608.3 ms. These are single samples, not P95, FPS or INP. `readiness-v5-dpr2` had a 30-second watchdog failure after releasing the held worker at 100%, and its diagnostic page became unresponsive. The same-source complete v6 sequence did not reproduce it; the cause is unproven and remains a risk, not a fixed defect. A separate passing diagnostic held only 130/250% because 100% hit cache, so it cannot close that failure.

Targeted suites, DPR 2 full smoke and `readiness-lifecycle-dpr2` passed. The latter covers default/low-DPR export and context loss/recovery. Architecture boundaries, all 748 verification routes, Pages source graph and diff checks passed; `pr:plan` has no unmatched files or route gaps and remains planning-only. The current-source Pages artifact build passed at `.runtime/reports/generated/tno-ready` (983.74 MiB). The first build used an output path producing 263-character transport paths and failed in Windows CopyFile2; using the shorter output path required no source change. An existing Python action-import whitelist assertion still fails in files unchanged from HEAD. Root closed every browser and verified/stopped its server PID 44044; port 8008 no longer listens. Preserve the primary checkout WIP and all failed/intermediate reports; no commit, push, PR or deployment has occurred. See task.md for measurements and residual risks.

### Zoom continuation (2026-10-18, implemented and locally validated)

Keep the existing worktree and every earlier change. Split the published GPU scene from candidate CPU tiles and mutable pass canvases. Navigation reads published textures only; candidate political data uploads only after all pass slices complete. Retained palettes still respond to edit/undo/redo. Invalidate hard scene/projection/DPR changes, reject stale candidate results, and keep all resource caps. Water rasters and secondary indexes prepare privately in time slices. Normal 130/250/100% zoom and held-worker edit/undo/redo passed at DPR 1 and 2, followed by full smoke/project roundtrip and export/context recovery. See task.md for exact results and failed-run corrections. Full precision still takes seconds; the broad performance targets remain open. Root owns live processes and closes the server at handoff.

1. Direct visible GPU scene composition, reusing ID coverage and ordered existing layer producers; remove political GPU-to-2D presentation on the new backend.
2. Resident binary worker geometry with transfer ownership and bounded lifecycle; tile requests refer to resident IDs/versions.
3. Independent layer navigation/refresh, preserving label correctness without making labels gate the base scene; enable TNO default raster policy.
4. Real TNO first/repeat paint, continuous brush, history, navigation, mode switch, scenario switch, save/load and fallback validation. Compare explicit vector and raster on the same hardware/configuration with timing separate from pixel validation.

## Acceptance

The new visible scene is active, ordered, and current. Warm edits do not rebuild geometry; warm navigation does not upload unchanged layer textures or serialize whole-scene geometry. Preserve holes, small islands, foreground ordering, selected IDs and history semantics. Record actual GPU and unfiltered latency/frame samples; seek materially lower end-to-end response, with the prior discussion's 50% P95 reduction and 33ms navigation P95 as targets, not assumed results. Cold preparation and DPR are separate measurements. Resource accounting, cancellation, context loss, scene changes and backend disposal must be bounded and observable.

## Constraints

Root owns renderer/runtime integration, shared catalogs, browser/server/build and final validation. GPU compositor and worker transport delegates own separate files. Use existing test routes and source proof rules; do not suppress errors or loosen test acceptance. Resource pools use explicit, separately tested limits: 48 MiB resident binary geometry, 16 MiB worker paths, 80 MiB political textures, and 160 MiB combined scene textures including political textures. The combined limit accounts for other layers newly brought into the same GPU context. Avoid a full canonical-format rewrite or additional mesh backend in this slice. All transient output stays in `.runtime/`.
