# 交接上下文

2026-09-09：用户明确授权按最新计划分派子代理完成改进。已从指定 Edge 用户页读取最新 V0–V3；早期 A–E 和恢复后续计划不是当前执行范围。

所有权：v0_zero_semantics 负责 river_layer_render_owner/city_points_render_owner 与对应行为测试；v1_visual_paths 负责新增 e2e dev spec/helper；v3_name_provenance 负责 city_label_text_model 和对应行为测试。主代理独占 map_renderer.js、pass 注册、合成入口以及浏览器/服务器/长测试。子代理不可启动这些 live process。

当前尚未启动服务器或浏览器测试。源码检查发现已有 reconcileDetailPromotionPoliticalPass 可作为 political 精确重绘入口，V1 优先复用。运行时资源、完整命令、日志和结束条件启动前补充于此。

Live process 契约：owner=/root；cwd=C:/Users/raede/Desktop/dev/mapcreator。服务器命令 `node tools/run_python.mjs tools/dev_server.py --port 8000`，环境 MAPCREATOR_OPEN_BROWSER=0；日志 `.runtime/browser/visual-correctness/server.log`。端口 8000 初始无监听；禁止其他 agent 启停/轮询。成功条件为本地 source /app 可读，失败为进程非零退出/启动失败；所有浏览器用例完成后停止本次进程。Playwright 串行且 retries=0，baseURL=http://127.0.0.1:8000；日志与样本均在 .runtime；只读取已落盘输出可共享。

进度：服务器 exec session=26875 仍运行。V0 browser `visual_owner_semantics.dev.spec.js` 通过，输出 owner-semantics.log/json；真实 Canvas 验证 opacity 0 无像素、rank0低缩放可见、DPR1/1.25/2/3 sprite尺寸。只证明owner装配，不冒充整个高倍导出重绘。

V1初跑捕获加载漂移，report保存在 v1-initial/report.json，不是缓存bug证据。第二跑增加连续1秒clean/resource稳定后仍失败：v1/tno_1962/report.json，政治7→8→9；repeat可见45045，normal/reference政治7406像素、可见4374/max14，其他pass零差异。v1_visual_paths现负责V2政治owner诊断（不能改main）；v0_zero_semantics现负责V1 spec稳定门/有限地理视口/A→B→A，不能运行browser；v3_name_provenance负责新shared_labels_runtime.dev.spec.js，不能运行browser。主代理仍是所有运行时唯一owner。

名称重大分叉：全量新优先级会改TNO约31719个语言级结果，可能包含未绑定历史名。已询问用户，当前安全实现仅 scenarioGeoLocalePatchData.geo 的明确stable/id抢占host；25已审查历史键同步主/en/zh，其余旧行为保持。目标14测试和旧数据不变/分片一致已通过。

标签接线已写：drawContextMarkersPass开始reset候选并invalidate labels；drawLabelsPass fresh occupiedBoxes→city→transport flush；city_points透传occupiedBoxes。transport pending世界坐标留到下次contextMarkers重绘，场景身份校验。signature统一transport显示/配置/语言/context/scene/data用于contextMarkers和labels。Node组合36/36通过，旧设施测试已由作者更新新两阶段入口保留原断言（相关45/45通过）。道路/铁路标签未迁移。浏览器装配尚待新spec。

V2第二轮：第一次用数值geoPath→Path2D修复SVG精度损失后，TNO剩42政治/19最终像素，HOI4剩38最终像素。已统一cache hit/miss均使用数值Path2D，miss临时构建不写持久map、不逐feature校验signature；23目标Node通过，主renderer注入builder已完成。浏览器待复验。

Modern V1首次180s为inconclusive：最后场景idle且warmup排空，但资源tracker等待两个404 response.body并在finally无限等待；v0负责修正tracker，保留网络失败事实。v1只读核实是否为可选fallback。shared-label第二跑warmup首帧3类字形/非重叠/导出0差异，随后waitForFixtureRenderIdle超时；v3正在定位，不算整体浏览器通过。

shared_labels_runtime第三次通过（1.1m）：真实preload hooks与post-ready完成后安装fixture，7帧，labels-only markerClears=0、labelClears=1，city-off两设施字形且重新布局，resize与export 0像素差异。准备阶段实际city21338/airport893/port1081，随后受控1/1/1。DPR1通过，v3准备1.25/2补测。

V2第二轮浏览器仍TNO42政治/19可见、HOI4少量、Modern48政治/42可见，同一局部bbox；fine-miss临时Path2D没有收益证据。正常/参考背景均full groups cacheHit=true、pathless0，缓存map12424→参考clear后512；正在核实id-only path cache与背景/精细来源不同geometry的身份问题。v0添加失败局部候选定位，v1只读定位。Modern404已确认startup_data_pipeline.js:671与data_loader.js:1718显式空默认fallback，manifest未声明且不是tracked/sparse遗漏；保留网络缺口。

V2几何身份最终源：缓存entry保存geometryRef，共同isPoliticalFeaturePathEntryCurrent用于读取与warmup，保留同geometry外壳命中；38/38 Node，主renderer两owner注入，相关7个Python边界测试通过。V1 geometry-identity运行完成：HOI4 startup/English Channel两阶段通过（1.3m），Modern startup/dateline两阶段通过（2.7m），政治所有pass/最终/普通repeat差异均0，cacheReused/referenceRedrawn/identityStable均true。TNO此次startup准备20s未完成（dirty三pass），非像素FAIL；v0加入自然准备门与pageerror，之后仅补TNO。

当前唯一浏览器run60665为shared labels DPR1.25/2，日志shared-labels-dpr.log；源码冻结。服务器26875仍由主代理持有。

20:39最新：V3实际DPR2已通过shared-labels-dpr2-configured.log（1.3m），report shared-labels/dpr-2/report.json确认device/effective均2、full、export1920x1280零差异。URL full会被scenario balanced default覆盖；fixture经真实presentation display restore owner配置clone manifest full hint，再真实resize，不写dpr/不改产品cap。DPR1/1.25已过；V0已过。

TNO startup最终源已归零；Europe zoom3剩1pixel/maxdelta1，normal/ref identity/reuse成立，候选是Tyrrhenian四个Atlantropa要素。试验政治精确paint-transform完整key和miss临时Path2D均不消除差异；两者正在撤掉，不保留无收益产品变化，最终保留最早numeric path builder+geometryRef统一校验。root已撤main builder注入/精确paint key/仅对应policy测试，v1负责撤临时builder源+测试后通知source frozen。

V1 normal spec最新由v0冻结：test-owned willReadFrequently scratch复制再读取，不直接读取生产canvas，仍同1pixel。strict像素失败延迟汇总，记录pixelFailures/coverage failed-pixel-difference，但让TNO继续到A→B→A；身份/加载/运行错误仍立即停止。下一次运行TNO将收齐switch证据，不得把soft collection报告成pass。

单独diagnostic spec=tests/e2e/dev/political_pixel_diagnostic.dev.spec.js（临时诊断工具，不是验收）。默认与PIXEL_DIAGNOSTIC_READ_FREQUENTLY=1两次均已完成，固定report政治pixel-diagnostic.json/read-frequently.json在.runtime/browser/visual-correctness（文件实际前缀political-pixel-diagnostic）。4候选单独/组合cachedVsFresh/freshVsDirect/freshRepeat均0，实际8次draw CTM/style/order全同，总3147；生产normal[81,116,102,250] vsref[82,115,103,250]。强制willReadFrequently=true实际attrs确认，差异仍同，不能归因GPU读回策略。v1现在只扩展诊断背景前37fill与4候选前后单像素/paths/CTM，找第一个分歧，不再猜产品补丁。没有浏览器测试正在运行。

服务器仍session26875，监听127.0.0.1:8000，已核实python PID36760 command tools/dev_server.py --port8000，parent py-launcher47360。最终测试后只停止此自建服务器（可核实PID命令再Stop-Process）；不要影响用户浏览器页或其他进程。

最新续接：背景逐步读回诊断报告已固定political-pixel-diagnostic-background.json，46阶段全部相同且生产末端变为两者[81,116,102,250]；这是观察干预证据，不能宣布源修复。v1新增PIXEL_DIAGNOSTIC_OPERATIONS=1，无阶段读回记录drawImage/clip，尚待运行。

TNO return-diagnostic（session81165）启动阶段45秒失败：所有资源/加载/后台任务均空，但political/context/physical/borders仍dirty。对应trace保存在v1/tno_1962/return-diagnostic-trace.zip。v0定位到startup hydration renderNow:false→suppressRender:true被传入异步infra；full-derived-state restore在外层flush之后invalidate且不render。已在scenario_refresh_runtime.js修复：异步政治几何工作完成后通过正常render消费dirty，同步suppressRender保留；发布前isCurrent重新校验。目标scenario_refresh_plans + scenario_deferred_infra_lifecycle 24/24，回归先红后绿。主代理当前session49746运行v1-tno-deferred-render.log复验。v3已给normal spec补renderScheduling与chunk timer/retry快照，无gate预算变化。

TNO deferred-render复验：startup自然ready约7.95s且普通/参考0像素，Europe仍1pixel。Modern B自然ready248ms，返回TNO仅有8.15s准备时间即总180s截止；最终所有pending/readonly/apply/interaction/lock false，但dirty reason为scenario-apply-detail-prewarm。v3已拆原case为startup+region与独立tno_1962-switch(startup+Modern+TNO)，各自原180s，45s及strict0不变，输出分开。

v0只读定位第二处：chunk_runtime提交时锁仍true便同步flushRenderBoundary，render因此early-return，随后才解锁；pending被消费而dirty留存。主代理授权在原提交边界先恢复锁后flush并补目标回归，暂无完成声明。

无阶段读回operations诊断已完成，固定political-pixel-diagnostic-operations.json：drawImage=0、clip=0，正常与参考仍[81,116,102,250]和[82,115,103,250]。未观察到blit/clip差异。v1被要求最后一个有明确价值的隔离完整命令重放诊断，不允许猜测源补丁。

最新：TNO独立switch已通过（v1/tno_1962-switch/report.json）：startup准备7.68s、Modern301ms、返回TNO5.32s，startup/return normal/reference全0。chunk最终flush先解锁修复已通过新增4/4与现有quick/cancellation66/66。

原TNO startup仍捕获更晚的rebuild-colors三pass dirty；scheduler最后完成post-ready-full-interaction-infra。主代理在buildFullInteractionInfrastructureAfterStartup最终ready前加scenario/request/epoch身份检查，ready后经requestRendererRender正常边界消费晚到颜色失效。v0已写完startup_interaction_lifecycle_behavior增强但其回合触发usage limit，主代理接手实际运行4/4通过。当前主代理session17751正在串行运行normal_visual_paths四case，日志v1-final-source.log。生产源冻结，等待此最终结果。

最终结果：session17751 normal_visual_paths四case共3pass/1fail（6.9m）。TNO startup通过，Europe仍1pixel/maxdelta1；HOI4、Modern、独立TNO→Modern→TNO全部严格0，四case pageErrors0且各对identity/reuse/redraw均true。最后full-infra修复已由实际startup行为验证。未解决1pixel仍是严格FAIL，不调整阈值、不认定原生后端根因。Modern2个可选startup locale/alias404继续明确记录。

临时political diagnostic spec复制到.runtime/browser/visual-correctness/political_pixel_diagnostic.source.js作原路径源码存档，移出常规测试目录；保留全部JSON和差异图。最终浏览器结束后只改任务记录及归档诊断源码，生产源未再变化。主代理已核实自建Python PID36760的dev_server.py --port8000命令并Stop-Process；服务器session26875结束。最终状态见task.md：部分验收通过，任务不标记全完成；未提交/推送/发布。
