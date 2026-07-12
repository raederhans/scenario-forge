# Lessons Learned

### Williams 周期采样同时约束节拍、归属与证据体积
- 周期遥测按单调时钟的绝对 deadline 调度，并在查询开始前记录样本时间，避免查询耗时累加到采样间隔。
- Job Object 证据负责判定任务进程清理；系统中其他浏览器变化单独记录为环境失效。长任务 stdout/stderr 直接流式落盘，系统进程快照只保留判定所需的 PID、父 PID 和名称。

只保留跨任务会反复复用的长期规则、项目级合同和长期决策。重复口径合并到单处；一次性修补过程、已收口的窄问题、纯执行快照直接移除。

## 构建、发布与真相源

### canonical 输入只能有一份
- internal partial 才能当主输入，公开诊断文件和组合产物默认都当输出。
- 不要从最终组合产物反提取主输入，也不要让 local mirror 反向支配 canonical。
- 审核重构进度时，同时看代码、测试、checked-in 产物。

### materialize 和 publish 必须分开
- `materialize` 只生成产物，`publish` 只发布现有产物。
- UI 需要“保存后立即可见”时，显式串联 `materialize + publish`。
- 编辑器输出、bundle publish、startup supporting file publish 要分清边界。

### Windows 发布包先缩短路径再上传
- Vercel CLI 在 Windows 长 worktree 路径上传大型 `dist/` 时，先把发布产物镜像到 `%TEMP%` 下短路径，并使用 archive 上传；发布元数据用最终 commit sha 对齐。

### 多 scenario 能力必须整链 scenario-aware
- builder 一旦支持多个 scenario，默认输入、域规则、display 文案、bookmark、authoring input contract 都要一起切换。
- startup supporting file 进入 scenario 链路后，要直接正式化到 checkpoint artifact 和 scenario publish contract。
- delta / rule 文件只表达差量规则，full-pack 默认值继续放在 canonical 主输入。

### 发布链和审计链共享一套枚举
- 数据目录、健康检查、strict checker、catalog、audit 共用同一套 manifest 枚举规则。
- source recipe、build audit、签名和 checked-in 产物都做 repo-relative 真源校验。
- checked-in snapshot 只记录稳定事实，approval log 放在 strict 复验通过之后。

## 编辑器、状态与运行时边界

### 重逻辑先按事务边界拆
- 先找一笔完整 transaction 的输入输出，再抽 service / materializer。
- 入口函数理想状态只剩校验、锁、调用、提交、响应整形。
- service 下沉后，测试也切到真实写口。

### 锁语义覆盖真实并发模型
- owner-aware 锁至少建模 pid、thread、transaction。
- builder、dev server、checkpoint 等写链共用 scenario 级锁。
- 长流程开始前先看日志、退出码、锁文件。

### merged state 区分“缺失”和“明确为空”
- 回写 merged layer 前先判 `hasOwnProperty(layerKey)`。
- fallback layer 继续走既有 bundle/topology 路径。

### pending / settled 真状态先于保存与可见性
- optional asset 允许先编辑时，保存链先抓 pending canonical payload。
- per-scenario asset 的加载哨兵绑定 `activeScenarioId`，空对象不代表已加载。
- 打开面板先触发真实加载；保存前如果尚未 settled，就先加载并提示。

### 共享能力切换要整波次完成
- shared-variant cutover 同时切 preview、inspector、validator、builder 和 checked-in 产物。
- family toggle、master toggle、tab selection、active 项和 runtime capability 描述同一件事。
- loader 白名单、发布 allowlist、生成源、fetch 前路径校验一起收口。

## 渲染、性能与可见性

### render pass 维护单一生命周期
- 依赖场景 mask、atlas、canvas 尺寸、DPR、baseline 的 pass，在对应输入变化时统一失效。
- partial repaint 基线跟画布生命周期一起失效。
- 视觉资源未就绪时，可见 fallback 和交互目标保持一致。

### 边界样式参数覆盖所有绘制路径
- 边界面板的颜色、透明度、宽度要同时接入 normal pass、interactive snapshot 和 scenario coastal accent 等可见路径；只接一条路径会让拖动、缩放或场景叠加时看起来像参数失效。

### 性能优化先减阻塞边界
- startup 是 bundle-first 时，先缩 bundle 边界。
- coarse preload、非关键 metadata、focus detail prewarm 这类高成本工作优先移出首屏阻塞链。
- exact pass、mesh、contour、hit canvas 这类大成本路径先缓存可见集和 clean frame。
- 首屏政治填色 gate 只等待政治首帧所需 chunk。

### 调度与刷新语义必须精确
- `flushPending` 表达“只冲刷待处理工作”。
- exact-after-settle、defer、post-ready 只冲刷真实 pending；退出 defer 后补一次受控 flush。
- chunk promotion、视觉刷新、spatial、hit canvas 作为同一世代提交。
- chunked 场景首个可见帧要等真实 promotion 提交到 `selectionVersion`、`landData` 和 `colors`。

### 性能验证基于真实 idle
- benchmark idle 包含 runtime chunk work、post-commit replay、post-ready 基础设施任务。
- perf gate 变红时先在同机同环境重跑 HEAD，区分补丁回归和环境漂移。
- post-ready task 可能晚于 startup benchmark 快照；渲染 warmup 必须先确认指标能进入采样窗口，再判断是否有优化价值。
- full hit canvas 从 startup/recovery 同步路径移到 idle 后，先结合 `mode`、`reason` 和 `hitCanvasViewportProfile.profile` 判断它是否还压在启动热路径上。
- editor performance benchmark 默认使用当前 worktree 的 runtime root 和 active server URL；显式复用 server 时同步校验 `active_server.json` 里的 `pid`、`cwd` 和 URL，避免命中旧 worktree 服务或默认端口漂移页。
- perf runner 等待 ready 状态时读取应用集中诊断快照；每个 warmup/run 前探测自管 dev server，可避免动态 import 轮询在服务抖动时变成新的失败源。
- 黑帧、长任务、wheel idle、最终 sharpness、真正首屏完成时间分别记录。

## UI、交互与文案

### UI 改动先锁真实可见行为
- 对首屏、滚动、点击、summary、toolbar 这类可见路径，先保静态可见性，再做 reveal、defer 和批处理。
- Inspector 的批量动作默认绑定当前可见过滤结果，并先给影响数量预览。
- ready 文案、禁用态、可编辑性、真实 runtime capability 共用同一份 contract。
- 侧栏折叠这类布局变化最终由 `ResizeObserver` 锁住。
- 把 layout 刷新从 `resize` 切到自定义事件时，同步接上 toolbar / dock / context bar 等所有原 `resize` 订阅者。
- 拆 UI tab 到独立栏目时，同步更新默认 tab、`aria-labelledby` 和静态合同；只移动控件节点会留下空白首屏或悬空无障碍引用。

### i18n 和容器绑定尊重 DOM 结构
- 带子节点的 summary / heading 容器不要整块写 `textContent`。
- routine i18n sweep 先 audit 再同步翻译；补 key 优先定点 patch。
- source-of-truth、baseline、runtime locale 一起同步。
- Cloud Saves / community 这类 JS 动态面板新增 copy 时，要同轮补 `data/locales.json` 和 `dist/app/data/locales.json`；数据源品牌名如 `OpenStreetMap`、`Natural Earth` 这类固定来源词要进 audit 的 non-translatable 规则，避免把来源标签误报成 UI 漏翻。
- `canvas` 的回退文本也会进入可见文案审计；给它们加 `data-i18n` 时，同轮补 locale key 和 focused audit test，避免无障碍/降级文本长期漏翻。

## 测试、审计与留档

### review lane 的职责是暴露真实缺口
- 红灯保留为显式风险。
- static contract 从 E2E 拆出后，要接入具名入口和现有路由体系。
- selector explain、列表入口、变更入口、grep 规则、workflow paths 共用同一份真相源。
- source replacement 经公开源复核确认缺少可用几何时，要写入 source-review metadata 并退出 actionable 队列，避免同一个不可替换候选被重复重开。

### 测试锁真实合同
- 新边界优先补 source contract、node contract、targeted Python contract，再决定是否上更重的 E2E。
- static contract 进入具名入口后，route registry 递归展开到真实 leaf test 文件。
- owner boundary 测试锁具体 owner token，必要时把旧实现 token 一起列入禁令，避免整文件级禁令误伤无关 sidebar 或邻近 owner 的改动。
- 隔离 worktree 跑 Playwright E2E 前先确认 `node_modules` 入口；可用被 `.gitignore` 忽略的 junction 指向父 checkout 依赖，让验证使用当前工作树源码并复用既有依赖。
- CSS 视觉合同要检查后置规则的最终层叠结果；只检查共享 token 存在会漏掉后面 selector 把圆角、背景或间距覆盖回旧值。
- 追加可选 E2E gate 失败时，先在同 commit 的 clean baseline 跑同一命令；失败形态一致就登记为既有 gate 漂移，避免把非本轮布局债务混进启动抽取。
- 退休一个 spec 时，同步删除 manifest、test list、allowlist、引用关系。
- data URL harness、import-safe tool、CLI/library mode 这类特殊运行环境单独有合同。
- 交通工作台新增国家资源包时，先确认 family runtime 的 geometry contract；`industrial_zones` 已是显式 `polygon_or_point` 合同，新增点状或面状工业源都要让 capability、descriptor、inspector、Pages dist 合同一起同步。

### 留档要短、准、可清理
- active 目录只保留当前仍在推进的主线。
- 任务已完成、验证已补齐、后续故事转入别的 active 目录时，原目录立刻归档。
- archive 里保留可复用的计划、上下文、任务闭环；空目录和纯残留目录直接清理。
- 删除已合并的远端 recovery branch 时，同步把注册表恢复线索改成 commit hash，避免后续审计依赖已不存在的 branch 名。
- 根目录文档如果声称已有 canonical archive 副本，先验证 archive 目标真实存在。
- 多 worktree 审计中，所有补丁和留档写入都要用目标 worktree 的绝对路径复核一次，避免把执行文档或修复误写到父 checkout。
- 由真实拓扑生成首页静态 SVG 前，先对裁剪目标执行 `make_valid` 这类确定性几何修复；invalid polygon 会让展示资产生成在 intersection 阶段失败。

### 旧 worktree 只移植合同
- 从旧 worktree 抢救功能时，先对照当前 main 的既有回归测试。
- 颜色、数据、policy 这类 checked-in 合同以当前测试和现有数据为准。
- 拆出独立按钮时，payload 只带按钮承诺的字段。

### source/dist 同步先看漂移范围
- 如果源码和 `dist/app` 已有历史漂移，共享大文件优先做 scoped patch。
- Pages dist 生成会按当前源码树同步所有镜像文件；如果某个已提交源码此前没有同步到 `dist/app`，本轮构建会带出相邻 dist 变化，先用 HEAD 源文件确认归属再判断是否越界。
- 重建拓扑产物时先确认非目标 layer 合同是否能过；如果 full builder 被旧 layer 元数据挡住，targeted rebuild 只能替换本轮 owned layer，并要补数据级验收。
- 被 strict 合同按字节 hash 的 scenario JSON 必须在 `.gitattributes` 明确 `eol=lf`，否则 Windows checkout 会让本地 strict 误报指纹漂移。
- `dist/pages-dist-manifest.json`、`data/manifest.json`、根 `dist/assets/*.json` 这类字节合同文件，修改后要同时复核自引用尺寸/hash；生成脚本和 `dist/app` 文本产物都要在 `.gitattributes` 固定 LF。
- Pages manifest 扫描文件时按 repo-relative POSIX path 排序；直接排序 `Path` 对象会让 Windows 和 Linux 对 mixed-case 发布路径产出不同记录顺序。
- Renderer owner extraction 只要改到浏览器会加载的 `js/core/**` 模块，就要在 review 收尾跑 `verify:pages-dist` 或等价 drift gate，确保 `dist/app` import 图和源码一致。
- `js/core/map_renderer.js` 或 `js/core/map_renderer/**` 新增浏览器加载模块时，selector 也要把源码路径路由到 `verify:pages-dist`；只路由已生成的 `dist/app/**` 会让缺失镜像文件在提交前漏掉。
- 覆盖类合同可以用 bbox 作为候选预筛，最终通过条件必须绑定真实 geometry 命中，并用跨 bbox 但不相交的反例测试锁住。
- Marine Regions source snapshot 接近 GitHub 100MiB 限制时，要把简化规则写进 source spec/provenance，比如 `snapshot_simplify_tolerance`；只压最终 water feature 会留下不可推送的大 snapshot。
- 只改 water layer 时，优先在现有 `runtime_topology.topo.json` 上替换 `scenario_water`；从 political/land/context 反提再重建会丢失独立的 `scenario_atlantropa` 对象。
- open-ocean 扣减后沿用既有 `component_min_area` 裁剪合同，避免生成小碎片打破 component 上限。

### 浏览器原生 zoom 是独立渲染输入
- `devicePixelRatio` 可能降到 1 以下且被 runtime DPR 上限/下限钳住；监听到 browser zoom 时仍要强制失效 overlay/texture pass。
- DPR 监听用 `matchMedia("(resolution: ...dppx)")` 后，每次 change 都重新绑定当前 DPR 查询。
- DPR change 和 visualViewport resize 同帧到达时，要保留独立的 DPR 失效标记，再处理布局 resize；只用单一 pending reason 合并会丢掉强制 overlay/texture invalidation。
- 侧栏 resize 期间 `setRenderPhase("interacting")` 可能先更新 canvas size；后续 resize handler 仍要识别这次尺寸变化并继续执行 projection fit / zoom reset。

### 异步闭环和加载状态机要锁真实事务
- Project import / export 这类异步闭环要在事务完成和失败时通知 UI，不能只在按钮点击时写 started 状态。
- observer 只做旁路通知；observer 报错应记录为 observer failure，不能把已经成功的导入事务改判成失败。
- 保存状态类 live region 要接到 `markDirty` / `clearDirty` 共同路径，覆盖 appearance、transport、special zones 等跨入口编辑。
- UI 的“已加载 / 已发布”状态要绑定真实事务完成点；异步导入只启动时，应写 started 状态，把 success/error 留给 callback。
- 公开分享、community download、已登录读取要共用 public DTO / allowlist，避免旁路泄露本地私有字段。

### inspector 聚合只放展示层
- Water Region 这类由碎片 feature 组成的列表可以合并显示；selection、history、override 仍保存真实 feature id 数组。
- TNO inspector 的国家分组修正要同时同步 `countries.json`、manual overrides、scenario mutations 和 patcher 规则；只改最终产物会在下次重建时回退。

### 场景颜色要显式声明管理权
- 手工、controller-only、生成型国家颜色需要写入 `color_policy: "locked"`；缺少 policy 的 checked-in 场景色会在重建时被 palette audit 同步回去。
- startup cache key 要包含 `countries_sha256`；只改国家颜色时，runtime topology hash 不变，缺少 countries hash 会让浏览器继续读取旧 IndexedDB 场景启动缓存。

### 局部 UI 类必须有作用域样式
- 新增 `.secondary-btn`、`.danger-btn` 这类局部按钮类时，要同时在对应工作台作用域内定义完整按钮状态；只创建 class 不补 CSS 会回落成浏览器默认控件。

### 交互 SVG 要同时锁滚动、XML 和压缩合同
- 首页、展示页里的 `<object>` SVG 地图默认保留页面滚动；缩放按钮做主交互，滚轮缩放绑定明确修饰键，触摸拖拽只在地图已放大时接管。
- 展示页 SVG 改 layer、动画节点或 `data-*` 属性时，测试直接 XML parse 生成资产，并给缩放、拖拽、复位或 tab 切换补轻量行为覆盖；浏览器 `<object>` 会吞掉部分 XML 结构错误。
- 用 SVGO 压缩可交互 `<object>` SVG 时，显式保留运行时依赖的 stable id、group class、hidden layers、active-layer selector、inline style 边界和 SMIL animation 节点。

### 窄侧栏长文本用 scoped grid
- 右侧栏诊断、审计这类窄面板里，长 id 与状态值不要复用通用 `justify-between` flex 行；用面板专属 grid、固定状态列和 `overflow-wrap:anywhere` 锁住横向宽度。

### 本地后端私有读接口保持同源权限边界
- 同源后端即使只是本地开发框架，私有读接口也要走 dev token / same-origin 边界；GET 读取用户数据时不能弱于 POST。

### 交通工作台数据必须带渲染契约字段
- 非 Japan 交通 pack 不能只满足 manifest 合同；点状 preview 还需要 `clip_bbox` 投影路径，以及工作台筛选会读取的 `airport_type/status_category`、`legal_designation/manager_type_code`、facility subtype/status 等字段。

### HOI4/HGO seed 构建复用显式色源和已验证 parser
- HGO / HOI4 seed builder 要把 HGO palette 和 `hoi4_vanilla.palette.json` 作为有序显式色源，并继续硬失败剩余缺色 tag。
- state 的 owner、controller、core、dated history 继续复用 `scenario_builder.hoi4.parser` 语义，保持和已验证 builder 一致。

### progressive 粗粒度可见性要和细节完整性分开
- chunked/progressive 启动阶段已经提交 coarse prewarm 时，数据健康可以记录 detail 未完整，但用户可见 toast 应表达真实可操作错误；当前视口可用的渐进阶段不应显示成剧本可见性失败。

### 可保存 UI 状态要只有一个真源
- legend labels/config 这类会写入项目文件的 UI 状态应以 `runtimeState` 为真源；manager 可以负责 normalize 和派生计算，渲染路径不能再读静态缓存。
- 多通道可保存状态进入 history 时，要把 touched channel 列表和 payload 一起保存；回放只写本次编辑触达的 channel，避免默认补齐的空 channel 覆盖其他面板数据。
- 网格型可保存状态使用压缩编码时，要把中性值作为显式合同测试；量化 roundtrip 产生的微小漂移也会变成渲染乘数漂移。

### 渐进恢复要同时移出背景缓存和细节绘制
- 大场景启动恢复里，只把 full-pass Path2D cache 延后还会留下细粒度 feature fill loop 成本；progressive 模式要把粗 underlay、细节 loop 跳过、idle full cache 三件事一起设计，并让 `refresh-colors` 继续走精确反馈路径。

### 失败的性能实验也要锁合同
- 渲染链路里被测试并拒绝的 cache 签名收窄、entry 复用等实验，要用合同测试钉住当前边界；只在文档里记录原因，后续容易被同类优化重新引入。

### 投影缓存签名要覆盖反投影输入
- 依赖 `projection.invert()` 或 `transform.invert()` 的 raster/cache key，除了尺寸、DPR、projection 参数和 zoom `k/x/y`，还要记录自定义 transform identity 或明确不可变合同；只记录数值字段会让不同 inverse 映射复用旧 buffer。

### open-ocean 可见性和交互开关要分离
- `showOpenOceanRegions` 只表达视觉可见；`allowOpenOceanSelect` / `allowOpenOceanPaint` 才表达命中与编辑能力。测试或迁移逻辑把 show 当作交互开关时，会让默认场景暴露 open-ocean 列表和点击命中。

### 视觉伪装要统一显示和命中集合
- 对政治图层做 runtime-only geometry pruning 时，普通绘制、hit/spatial index 和 scenario background merge 都要读同一份可视集合；`landDataFull` 只保留给完整数据、边界和诊断用途。

### 大颜色库翻译优先走定向同步
- HGO 这类 palette 只需要补颜色库可见国名时，使用 palette-only locale 同步；完整 `geo` 同步会扫 7 万级地理项，机器翻译阶段会明显拖慢。
- Palette source label 如果是 `USA` 这类短全大写 tag，palette-only 同步会按代码过滤；中文显示层应在缺少独立翻译时复用本行已解析的本地化国家名。

### 大色板分组优先写入导入产物
- HGO 这类千级色板条目需要在 import 阶段写入可审查的地区 metadata，并把少量异常放进 manual map；浏览器面板只消费稳定字段，避免运行时名称猜测导致分组漂移。

### 水域 source、runtime、chunk 要一起验证
- TNO 水域精细化后要同时跑 source 几何、runtime topology、chunk id consistency 和 named/open-ocean seam 合同；只看 source 或只看 chunk 会漏掉视觉存在但无法命中的漂移。
- 发布 water 几何前先让 builder 复用已验证 checkpoint；从旧 checkpoint 全量重建会把非目标 global ocean 拓扑问题提前拉进本轮发布。
- checked-in `water_regions.geojson` 已经通过 D3 几何验证时，水域窄发布应直接替换 runtime topology 的 `scenario_water`，避免再次调用 full water generator 或 source split 步骤引入旧拓扑失败。
- water changed-domain 在 safe repair/startup bundle 之前要从 checked-in `water_regions.geojson` 同步 `manifest.summary` 和 `audit.summary`，否则 bundle subset 会保留旧 water count。

### 主图 transport 恢复不能写死 family 列表
- project import/export 保存的是已 Apply 到主图的 pack 身份；恢复时应从已保存的 family map 读取，并用主图 pack registry 过滤 workbench-only pack。

### no-bundler 依赖要同步 vendor 和 Pages manifest
- 给浏览器端新增 npm 依赖时，要把可直接 import 的 ESM 文件 vendored 到 `vendor/`，再跑 `verify:pages-dist` 确认 `dist/app/vendor` 和 `pages-dist-manifest.json` 同步。

### HGO vector 场景要整体退出基础线层
- 正式 HGO1936 这类 `hgo_vector` 场景有自己的投影和矢量表达；默认 coastline、coastal accent、rivers 等基础线层 owner 要一起识别场景合同并退出，残留线排查优先用 canvas `strokeStyle` trace 区分来源。

### 项目 ZIP 导入要同时锁完整性和预算
- 可编辑项目包的 `manifest.json` 要作为严格合同校验，至少锁所选项目文件路径和 checksum。
- ZIP 导入要同时限制压缩包体积、entry 数和解压后总字节，避免坏包绕过预览路径拖垮浏览器。

### Transport carrier 切换要锁异步代次和数据合同
- carrier / pack 切换会并发触发 manifest、audit、pack、carrier asset 加载；每条异步链路都要带 generation，过期结果不能回写新状态。
- pack manifest 的 `carrier_asset_key` 只解决路由；`extensions.carrier` 还要带 scope/projection/basemap 元数据，并由 builder 统一写入 checked-in 数据。
- carrier rebuild 后要同时跑 manifest 合同、catalog 检查和 `verify:pages-dist`，俄罗斯这类跨境外观数据还要用 provenance 锁住真实行政代码范围。

### runtime registry、catalog、Pages 发布要同链同步
- 资产 manifest 记录 size/hash 时，源生成器、`.gitattributes`、Pages dist 字节处理和发布合同测试要同链更新；二级 manifest 还要逐项比对发布后的真实文件。
- 通过 palette registry 或 runtime asset registry 暴露的新数据入口，要同步写入 artifact contract，并刷新 `data/manifest.json` 的 size/hash。
- 新增浏览器直接读取的 `runtime_asset_registry` key 后，要同步 `tools/build_pages_dist.py` allowlist、`tests.test_pages_dist_startup_shell`，以及 `dist/pages-dist-manifest.json` 里的发布记录。
- runtime manifest 如果继续暴露二级资源 URL，Pages 合同要遍历这些 URL，确认每个发布 URL 都被真正发布。
- Pages 裁掉本地专用资产时，要同步裁 `dist/app/data/manifest.json` 的 outputs 和内嵌 runtime registry，避免在线元数据继续声明未发布文件。

### 子海域拆分要锁 sibling 合同
- 新增 source-backed child waters 时，除了父水域 subtraction，还要给 sibling non-overlap 和 detail `water_type` 加 focused contract，避免相邻子海域或类型语义在后续批次漂移。
- `subtract_named_ids` 关系先进入 non-overlap 合同；只有真实相邻的水域才进入 seam distance 跟踪。最终 named-water 扣减要留极小 buffer，避免发布产物坐标规整后重叠回粘。
- 终端 source review 驳回 broader child candidate 时，要把 candidate id、source query 和驳回原因写成结构化字段；纯文字 evidence 很难被测试锁住。

### 大批量图片目录要有实体合同
- catalog 入口只登记 manifest JSON 时，要另加实体文件合同校验路径、数量、大小和 hash；否则批量 PNG 丢文件也可能绕过 data health。

### 用户编辑层保持 delta/source 分离
- 工作台用户点位编辑应保存为项目级 delta state；preview 只能合成临时 effective pack，不能把用户点写回 source pack、manifest 或 projected pack cache。

### 大体量交通源下载先锁分页、短路径和可复现入口
- FeatureServer GeoJSON 分页优先按“返回行数少于请求页大小”结束，并用独立 count/manifest 复核完整性；不要依赖中段不稳定的 `exceededTransferLimit`。
- Windows 下处理 IGN `.7z`、大型 GeoPackage、国家级 OSM 数据时，优先把目标文件抽到短 `.runtime` 路径，并在源端做子区域、选列、过滤和 cap。
- 直接 HTTP 下载如果要校验落盘大小，请固定 `Accept-Encoding: identity`；需要第三方 API 时，用稳定工具名 User-Agent，并把查询写入 source contract。
- 国家级公开源如果 country 子路径稳定性差，优先使用官方 global 输出再按国家字段过滤，避免把上游 404 变成 builder 常态失败。

### Facility preview 也要算入 Pages 体积
- 新增点状 facility pack 时，full 可以留在仓库数据包，preview 会进入 Pages dist；先按工作台可读性设 preview cap，再用 `verify:pages-dist` 校验体积，不要等发布门槛失败后再回头缩数据。

### worktree 重放后用内容合同判断清理
- cherry-pick 到新 main 后，旧分支 commit id 可能仍显示未合入；清理前要用目标文件 diff、patch 等价和验证结果一起确认，避免误删尚未吸收的工作。
- 同题旧提交和当前 main 只剩 manifest 字节差异时，保留当前 main 的字节合同，单独移植后续有效提交，再用 ancestry-only merge 记录旧分支已吸收。
- 在脏父 checkout 旁边的隔离 worktree 里打 patch 时，优先使用绝对路径或确认 patch cwd；改完立刻分别查父目录和 worktree 的目标文件状态，避免误写父 checkout。

### viewport culling 先验证 chunk 粒度
- 渲染性能优化前先记录 visible/total feature count；如果一个 required chunk 已经包含接近全量 feature，单纯缩小 viewport overscan 只能改善脏交互点探测，启动主路径仍会接近全量绘制。

### deferred infra 用主派生状态信号控重建
- chunk visual 阶段已经完成完整 political `landData` / derived state 时，deferred infra 只做收尾和诊断清理；用 `primaryDerivedStateReady` 控制 full restore，避免把同一批政治图层重建第二次。

### 隐藏开发工具入口前先释放入口拥有状态
- 开发者模式会隐藏 toolbar 入口时，入口 controller 要先关闭自己拥有的 preview/overlay 并触发 renderer restore，再同步按钮可见性，保证画布状态随入口一起恢复。

### manifest 几何字段要来自最终 payload
- 构建器对 chunk payload 做简化、裁剪、rounding 或格式转换后，`feature_bounds`、count 和成本诊断必须从最终写盘 payload 计算；从 source feature 计算会让 contract 与运行时 viewport 选择漂移。

### HGO preview 要绑定 renderer 生命周期
- HGO raster 画到主 canvas 时，必须接入普通 `drawCanvas()` 后补画，并让 hover/click 先走同一套 raster inspect；toolbar 内部单次 render 会被主渲染和 app hit pipeline 覆盖。
- HGO raster 源图和当前 canvas 尺寸可能不同；绘制和 inspect 必须共享 canvas-to-source 映射，避免预览位置和点击命中错位。
- HGO 投影预览要由 renderer 提供当前 projection / zoom / DPR 快照；重采样结果可以缓存，但每次主 canvas 重绘后仍要重新贴回预览像素。
- 改 `drawCanvas()` 内 HGO、last-good、finalize 这类顺序时，同轮跑 runtime hooks 合同；Pages 发布合同只覆盖发布产物，不覆盖主渲染时序。

### tracked runtime state 要单独出提交路径
- `.omx/` 这类已被 ignore 的运行态目录如果历史上仍有 tracked 文件，closeout 时先用 diff 判断是否只有计数和时间戳；这类本地状态用命名 stash 保存，产品提交只保留可复核的项目证据。

### 首页静态预览要公开真实抽样合同
- 从真实数据生成 landing SVG 时，要同时写 metadata，记录 scope、projection、sources、selection policy 和实际渲染 count；文案只引用已渲染数量。
- 物理图层源可能在目标视口内没有要素；这种情况应写入 metadata，并让可见文案描述实际存在的图层，避免展示页承诺空层。

### 空白底图生成要先粗筛再修几何
- runtime topology 可能包含混合维度或大量视口外 feature；Blank 类静态底图先用 bounds 粗筛，再做 `make_valid/intersection/simplify`，并在 metadata 写清 path limit、dropped count 和排序规则。

### 首页展示图背景范围和细节范围要分离
- 展示图需要把周边国家当背景板时，生成器应拆成 context bbox 和 detail bbox；背景国家只进低细节底色层，首都、铁路、河流、城市、标签继续绑定 detail bbox，避免一扩视口就把周边细节带进来。

### 首页夜景展示层要把灯光绑定到夜幕
- 静态 SVG 做日夜循环时，夜区遮罩、纹理、灯带和重点光源应共用同一条动画曲线或 clipPath；只移动分界线会让灯光和昼夜状态脱节。

### HGO 场景发布要分清显式 tag 和派生 id
- 数字开头的 HGO owner tag 只应从显式 `country_code` / owner 数据链路进入；从 `NUTS_ID` 或 feature id 派生国家码时继续按字母前缀解析，避免 `DE1` 变成国家码。
- 生成器支持自定义输出目录时，默认不要更新全局 scenario registry；只有 checked-in `data/scenarios/{id}` 输出才自动登记。
- manifest 声明的可发布 JSON 资产要进入 snapshot input sha；发布入口缺失的 controller 产物应删除或接通，避免生成一个运行时不会读取的伪合同。
- HGO manifest URL、scenario publish scope、system owner 隐藏标记和 strict source hash 要作为同一合同更新；改完用生成器重建 checked-in 场景，再跑 `verify:scenario-contracts:hgo` 与 `verify:pages-dist`。

### deferred full cache 要整体避开恢复窗口
- progressive full cache ready 这类 idle 优化只延后最终 repaint 还不够；slice 构建本身也会挤占 startup/interaction recovery，先等 `isInteractionRecoverySettled()` 再建和发布。

### 渲染 pass 回归要采样 owning canvas
- 多 pass 合成后，最终 canvas 可能被后续政治填色等层压低局部差异；锁单个图层强度时优先采样该 pass 的 owning canvas，再用端到端截图确认可见链路。

### full visual collection 要覆盖 resolved colors
- 渐进渲染场景里 `landDataFull` 可能比 interactive `landData` 更接近最终可见集合；resolved color 表和 owner 刷新要覆盖 full visual collection，空间索引继续服务交互集合。

### 外观预设 apply 要恢复数据依赖链
- 预设恢复图层可见性后，要重放对应 owner 的数据加载前置条件；城市点应先加载 base city data，再加载 scenario optional cities，并同步验证 source 与 `dist/app` 两条交付链。

### 外观预设 apply 要推进强度场 revision
- 预设恢复 `intensityFields` 时要把 channel revision 作为新的应用批次递增；连续应用两个内容不同但 revision 相同的预设会命中旧 render pass。按当前 runtime 和快照 revision 的最大值 + 1 写回。

### 新 scenario manifest URL 要接入发布和覆盖合同
- 新增 scenario JSON 资产时，同步更新 manifest URL、publish scope、snapshot input、bundle checker 和 strict checker；只验证文件存在会漏掉发布包缺资产和 partial feature coverage。
- `GeometryCollection` 没有顶层 `coordinates`；chunk bounds、contract bounds 和生成器预算统计要递归读取 `geometries`，避免空坐标退化成全球 bbox。

### UI 本地化要先修运行时 catalog 再谈大 locale 快照
- `js/ui/i18n.js` 会先读 runtime locales，再回退到 `js/ui/i18n_catalog.js`；审查新增 UI 文案时，先补 catalog 和真实 `t(..., "ui")` 动态格式化链路，用户可见面会更快闭环。
- `tools/translate_manager.py` 扫全量 geo/scenario 时可能长时间静默；这类任务先以可见 UI 入口为 owner 做最小闭环，再把大 locale 快照同步当成后续维护步骤。
- 动态标签改走 `t(..., "ui")` 或运行时填充值后，行为测试和 HTML 合同测试要同步锁“翻译后的输出”与“初始空占位”，避免继续把英文常量或静态默认值当合同。

### 云端合流后验证前再查远端
- 合流和冲突解析过程中 `origin/main` 仍可能新增提交；跑最终验证前再查 `HEAD..origin/main`，确保本地验证的是最新远端基线。

### 昼夜动画要同步时间粒度和灯光缓存
- 循环模式的 pass 签名要用细粒度时间 token；灯光静态底图继续缓存，但缓存 miss 时必须先生成完整精细底图，再让动画帧复用它做重裁剪和合成。

### HOI4 国家显示名要同步全链路指纹
- 修改 `countries.json` 的显示名时，同步 startup bundle/gzip、`locales.startup.json`、`data/locales.json`、`data/manifest.json`、`build_snapshot.json`、`manifest.snapshot_fingerprint` 和 `audit.snapshot_fingerprint`；只改单文件哈希会被 strict contract 抓到聚合指纹过期。

### HOI4 strategic 局部修复要保护 chunked manifest
- 只修 `strategic_values.by_feature.json` 时，基础 HOI4 builder 会顺手重写 manifest/audit/startup；保留 strategic 输出后，把 chunked manifest 字段和 startup bundle 交给完整 Pages/contract 验证链同步。
- 从旧基线 cherry-pick scenario 修复时，manifest/audit/build_snapshot 都要以当前落盘资产重新 `--write-safe` 生成；直接保留 ours/theirs 会让 detail chunk、startup bundle 和 snapshot 指纹互相漂移。

### 渲染刷新 reset 抽 helper 要锁顺序
- `setMapData` 与 scenario apply 可以共享事务清理，但颜色迁移、canvas size、topology revision、pass cache 这类路径专属步骤要保留原顺序，并用 ordered contract 锁住；抽 helper 后先做 diff 级顺序审查再跑测试。

### TNO publish 验证保持只读
- `validate_*` 路径只返回错误列表；需要补 legacy checkpoint 文件时放在外部 checkpoint hydration/publish 准备阶段，避免 checked-in scenario 目录被验证动作生成临时文件。
- 在 `unittest` 入口里新增 pytest 风格模块函数时，要同步加 wrapper method；否则 `python -m unittest ...` 会绿灯但跳过新用例。

### Scenario chunk 合同失败先区分代码与签入数据
- `npm run test:node:scenario-chunk-contracts` 可能因 `hoi4_1939` coarse chunk per-feature bounds 数量漂移失败；若本轮未改 scenario 数据，先把它作为签入数据合同问题单独处理，避免把 renderer/helper refactor 和数据重建混在一个 diff。

### Pack path helper 参数顺序要用合同锁住
- 同名 `getPackPath` helper 在 point/industrial preview 中签名可能不同；抽 runtime helper 或修 full-pack 探测时，加静态合同或行为测试锁调用顺序，避免把 `mode` 和 `variantId` 互换后悄悄回退到 preview pack。

### 测试路由目录规则要避开同目录异域文件
- Adaptive selector 处理 `ops/browser-mcp/` 这类混合目录时，static smoke support files 用显式文件集合和具体 route id；perf benchmark 继续走 perf 文件集合，避免静态合同改动误选 live gate。

### profile validator 要接入真实入口
- 配置文件 validator 如果只跑在静态测试里，live 脚本仍可能用默认值吞掉拼写漂移；新增 profile 合同时要把 validator 放到解析入口前，并用 unknown-field 负例锁住隐藏 fallback。
- profile 字段只要会进入 shell 文件名、URL 或退出状态，就要校验语义边界；非空字符串检查不足以保护 localhost-only、路径安全和端口范围。

### 大块抽取脚本要用函数锚点
- 机械拆 owner 时，正则替换必须限定到具体函数名或唯一锚点；用宽泛 `constants -> getters` 这类结构锚点会污染相邻 owner getter，抽取后要用 import 级 smoke 和浏览器 trace 查 pageError。

### 图层不可见断言优先用 owner 证据
- 整张 canvas 像素差会被其他 pass、重绘时机和背景层污染；验证某个子图层在某 zoom 不绘制时，用 owner 行为测试锁 path/stroke 调用，用 render metric 锁 `visibleFeatureCount`。

### 行尾过滤噪音卡住 main 同步时先判定语义差异
- 归档文件的旧 CRLF blob 与当前 `eol=lf` attributes 可能让 `restore` 后仍显示脏；先用 `git diff --ignore-cr-at-eol` 和 `git hash-object --no-filters` 判定是否只有行尾差异，再用临时提交 + rebase skip 让远端清理生效。
- Byte-exact manifest 测试失败时先用 `git ls-files --eol` 比对 index/worktree；若 index/hash 是 LF 而工作树是 CRLF，先恢复工作树 LF 并 `git add` 刷新索引，再重跑 manifest 测试。
- 拖拽这类 UI 会话状态进入 runtime domain 后，临时字段应保存在 domain 私有 session 中；history `before/after` 快照只保存业务模型，避免 undo/redo 恢复内部字段。

### 编辑事务下沉要区分 click 和 drag 语义
- 同一工具的 click 与 drag 可能复用 membership mode 名称但语义不同；Special Zone click 的 multi 是 `toggle`，非 brush drag 的 Shift 是 `add`、Alt 是 `remove`，抽 runtime owner 时要分别建 mode resolver 并补行为测试。

### Ownerless 场景要同时清数据和推断链
- 空归属地图清掉 `cntr_code` 仍可能被 tooltip、locale 或 owner helper 从 feature id 前缀推回国家；恢复 blank/ownerless 场景时要同步锁 feature properties、owner map、hover country context 和渲染色源。

### Landing 资产 metadata 只记录真实渲染输入
- 静态 showcase 图如果从多个候选源试算，metadata 的 `sources` 只能写最终参与渲染的文件；把未使用的 runtime topology 写进去会让以后审计误判数据来源。
- 资源合同除了检查文件存在，还要检查 semantic counts 和 SVG layer class；这样能锁住 TNO dissolved owner、HOI4 split-map、Japan corridor 这类语义资产。

### 政治填色回归要检查同 pass 覆盖链
- 目标 feature 被绘制过仍可能被同一 pass 后续 feature 覆盖；诊断时记录目标像素在 fill/stroke 前后的变化，比只看 renderedCount 更接近真实根因。
- 用户显式填色和 pending 编辑应拥有最终绘制优先级；underlay、普通 detail、foreground edit 的三段排序比单纯阻止 progressive skip 更稳。

### i18n 拆分按纯逻辑和 DOM 行为分界
- 迁移 `i18n` owner 时，catalog、`t()`、tooltip model 适合进 `js/core`，DOM sweep、language toggle、`localStorage` 和 UI runtime hook 调用留在 `js/ui/i18n.js`；工具和测试以 core catalog 为真相源，UI catalog 只做兼容 re-export。
- Thematic 这类新增 UI 文案如果既走 `data/locales.json`，又被 `tools/i18n_audit.py` 视作 `js/core/i18n_catalog.js` 的责任区，就要同轮同步 source/dist catalog 和 locales；只补运行时 locale 文件会让页面可翻译但审计仍保持 `ui_missing`。

### Worktree 注册表当前段只列真实路径
- `Current Worktrees` 只放 `git worktree list` 当前存在的路径；已整合或已清理的分支放到历史整合或恢复记录段，避免后续 integration owner 误以为还有活跃 worktree。
- 并行 worktree 的 WIP 误落入 main 时，先用命名 stash 和 `.runtime/cleanup-backups/` patch 保留，再用 clean detached worktree 验证目标提交，避免把外部 WIP 当成本轮回归。
- 在 Codex App 里对非当前 checkout 使用 `apply_patch` 前，先确认补丁目标路径；补丁若误落入 main，先把自己的 diff 转移到目标 worktree，再恢复 main，最后重新在目标 worktree 跑验证。

### Worker 试验指标要锁失败和迟到路径
- 默认关闭的 worker bitmap 试验要同时测成功、ERROR fallback、迟到 bitmap 拒绝和几何覆盖；只测 happy path 会让不可用环境或超时结果被指标误判为成功。

### 渐进政治缓存要绑定场景代际
- progressive coarse underlay、deferred full cache、worker bitmap、last-good frame 和 partial repaint 共用同一画布时，cache key 里要带 `sceneGeneration` 与 `scenarioDataGeneration`；只看 transform/color/pass signature 会让旧场景结果在新场景恢复期被重新提交。
- 可见 optional chunk 的 `scenarioDataGeneration` 判定要复用 `scenario_resources` 的 visibility helper；在 chunk runtime 复制 layer 白名单会漏掉后续新增层，例如 `strategicvalues`。
- optional chunk 的默认可见语义要和 UI state / chunk selection 保持一致；`undefined` 对 water、special、Atlantropa、relief、cities 是默认可见，对 special zones、strategic markers 是默认隐藏。
- optional-only promotion 的 generation bump 和 refresh 要放在最终 current 检查之后；stale rollback 同时恢复 optional payload、revision 和 generation snapshot。

### FrameGraph descriptor 要进入执行链
- 新增 frame transaction / invalidation descriptor 时，要同时锁住 factory、normalizer 和 runtime consumer；只验证 descriptor shape 会漏掉“计划生成了但执行端丢弃”的问题。

### coverage ledger 要同步发布和稳定 metadata
- checked-in runtime metadata 或 build snapshot 引用新的 ledger/report 时，ledger 文件必须进入 Pages dist 或明确保持 repo-only；metadata 只能写固定合同路径，不能写单次 `--report-path` 运行参数。

### Pages manifest 冲突用最终树重算
- rebase 或 merge 时如果 `dist/pages-dist-manifest.json` 和 UI/dist 文件同时变化，先落到最新 main，再跑 `npm run verify:pages-dist` 让生成器按最终 source/dist 树重算发布尺寸。
- 接手已合入 main 的 renderer/Pages 工作时，如果 `verify:pages-dist` 被既有 size gate 挡住，要把 builder size gate、startup shell、landing showcase 和路径级 dist 漂移分开记录，避免把发布体积红灯误判成目标 owner 回归。

### 生成产物回读要成套校验
- 默认 builder 如果需要回读 checked-in generated artifacts，必须把 required output set 当成整体合同：全套存在才 replay，部分缺失要 fail-fast；源 ingest 测试也要接入命名 route，避免只跑外层 catalog 合同。

### 退役渲染合同要显式失败
- FrameGraph descriptor 退役 pass 字段时，旧字段输入要 fail-fast 并补行为测试；静默忽略会把 stale caller 变成空 fan-out，后续更难定位。

### Pages startup shell 内存失败先做 base 对照
- `verify:pages-dist` 的 startup shell 会重新跑 landing asset builder；若 `topojson` 反量化触发 GiB 级 `ArrayMemoryError`，先在干净 main 跑同一 unittest 证明是否为 base gate，再把 Pages builder 和 landing Node view 分开验证本轮改动。

### 渲染诊断默认路径要轻量且保留事务身份
- 可见帧诊断默认只记录 identity、epoch、generation 和 pass 状态；完整 feature/chunk/layer snapshot 放在显式 diagnostics 模式，避免为了查 bug 把 renderer 热路径变重。
- Scenario apply 的 epoch 要按目标 scenario 固定记录，并由异步 post-apply/chunk/visible-frame 快照沿用；只读全局 latest epoch 会让延迟记录漂到下一次 apply。

### Scenario apply 写入权属于最新目标
- queued request 开始 drain 后仍要在 commit 前检查 `latestScenarioApplyTargetId`；只看 active request id 会让中间请求在 later request 到达后抢先写 runtime。

### Exact-after-settle 中断要带本地重排入口
- pre-paint identity 或 phase 中断只 reset controller 会把 `deferExactAfterSettle=true` 留成无 handle 的空转状态；abort helper 要记录原因、窄失效 political pass，并在 defer 仍有效时重新 schedule exact refresh。

### Visual acceptance 探针要逐点失败
- 经纬度像素探针投影到 canvas 外时要显式失败；把坐标 clamp 到边缘会让错误位置被附近像素掩盖。
- 固定探针适合要求每个点通过，运行时 centroid 采样适合要求最小通过数量；两类断言分开能保留证据强度。

### Fixture 资产进入 runtime registry 要写发布边界
- fixture-only 或 catalog-only 数据放进 `runtime_asset_registry.json` 时，要同步写 `publish_scope` 和 `runtime_readiness`，并用合同测试锁住，避免后续运行时代码把 repo-only 合同数据当成可发布渲染资产。

### Review 前确认新增文件已进索引
- `git diff` 看不到 untracked 新文件；新模块被已跟踪文件 import 时，review/commit 前用 `git add -A` 和 `git ls-files --others --exclude-standard` 检查，避免本地能跑但提交缺文件。

### thematic 源 payload 先锁 source 语义和 lookup 完整性
- 接入 WGI 这类 thematic workbook 时先查真实表头；number of sources、standard error 和 90% confidence interval 这类 source metric 要作为合同字段保留下来，project-defined composite 继续明确记录不推导 composite uncertainty。
- 建 runtime lookup 前先校验 feature `join_key` 非空且唯一，并验证每个声明 metric 都有对象值、合法 `source_status`，以及有限且落在合同范围内的 `raw_value` / `normalized_value`；这样坏 payload 会在入口直接暴露，而不是伪装成正常 `source_gap` 或 `unknown_join_key`。

### Chunk promotion readiness 要区分可见子集和完整派生状态
- 视口可见子集可以服务第一帧快速绘制；交互稳定态必须用完整 feature-id 覆盖校验恢复 `landData`、spatial/index 和 colors。颜色表缺口只记录诊断，避免把 palette 数据问题误判成 chunk 派生状态问题。

### Scenario owner 颜色覆盖要从完整 runtime universe 收集
- Chunked 场景的政治 feature 可能使用 `countries.json` 之外的二字母 owner code；owner/base-color map 要从 base topology、runtime topology、owner/controller、shell hint 和 releasable parent/child 一起收集，再按显式色、palette tag、ISO2 bridge、deterministic generated color 的顺序解析。

### Post-edit 颜色要挡住 progressive 粗底图跳过
- Chunk promotion 触发 `rebuild-colors` 后，pending edit 可能已经清空；如果可见 feature 仍有显式 visual/feature override，progressive coarse underlay 不能跳过 fine political loop，否则 state 里的新色会正确、主 canvas 仍停在旧 owner/base 色。

### 水域边界探针要同时看最终画布和命中目标
- Red Sea 这类边界点可能同时落进政治 shell fallback 和水域 region；诊断时要记录 final canvas RGB、water spatial index、selected water hit 和政治 feature 命中，避免把地理重叠误判成最终绘制污染。

### UI shell 也要走完整 i18n 补水
- `ui_shell=1` 这类提前返回的启动分支会绕过 normal boot 的 post-ready hydration；如果动态面板出现“切换语言后才正常”，先检查 full localization load 后是否调用了统一 UI text refresh。

### 原生 select 弹出层要用统一外壳接管
- 浏览器会接管原生 `<select>` 的弹出层，圆角、阴影和选项 hover 很难稳定统一；需要项目级风格时，用轻量 listbox 外壳同步原生 select 的 value/change，保留原 select 作为数据入口。
- 自定义 select 菜单放在滚动/折叠容器内会被父级 overflow 裁切；打开时用 viewport fixed 定位，并在底部空间不足时向上展开。

### UI-shell 调试 seed 要显式绑定 preset lookup
- 调试用 scenario country 同时带 `lookup_iso2` 和 fake `regional_presets` 时，侧栏会优先用 lookup code 读取默认国家 preset；预览数据要显式设置 `preset_lookup_code` 指向调试 tag，避免真实默认 preset 抢占 UI。

### Scenario UI await 后要复核事务归属
- 点击处理器等待 optional scenario asset 后再写 UI 状态时，要同时复核 `activeScenarioId` 和 `currentScenarioApplyRequestId`；数据层挡住 stale payload 后，UI continuation 仍可能把旧 scenario 操作写进新 scenario。

### 抽 owner 时同步旧边界合同
- 从 `main.js` 抽出 bootstrap owner 后，除了新增 owner 合同，还要 grep 旧 Python/Node boundary tests 里的旧 owner token；否则正确的职责迁移会被旧合同当成回归。
- 边界测试如果断言被移走的 `state` / `runtimeState` 写入，不要把完整写语句作为测试源码字面量；state-write 扫描会扫测试文件本身，用片段组合保留合同强度。

### Clean worktree 跑浏览器 smoke 先装依赖
- 新建 clean worktree 可以跑纯 Node source tests，但 Playwright smoke 依赖本地 `node_modules/@playwright/test`；首次浏览器验证前先用 `npm ci` 建立 ignored 依赖树，避免把 `MODULE_NOT_FOUND` 误判成应用启动回归。

### 收尾文档避免记录同提交自哈希
- 如果交付包会被 amend 进同一个功能提交，文档里不要写该提交的精确 hash；先写 branch HEAD 或 recovery branch，等归档/closeout 提交再记录稳定功能 hash。

### Projection/path owner 要保留注册后的调用顺序
- 抽 projection/path handle creation 时，`setProjection` 之后再对 registered projection 调 `clipExtent(null)` 是行为合同；把 `clipExtent` 做成可选或放到注册前会隐藏坏 projection，并改变原有 fail-fast 路径。

### Pages 超限 manifest 要保留可审计事实
- Pages payload 超过发布上限时，builder 可以先写有效 manifest，再用 size gate 退出红灯；测试应校验 `size_gate`、最大文件和目录汇总，避免超限状态被空 manifest 或模糊失败信息遮住。

### Pages release smoke 目标 URL 要显式
- 候选 release gate 必须从 `SCENARIO_FORGE_PAGES_URL` 或 `PLAYWRIGHT_TEST_BASE_URL` 读取显式目标；默认公开 URL 只属于 deployed-site 验证入口。
- GitHub Pages deploy job 要在 `actions/deploy-pages` 后用 `steps.deployment.outputs.page_url` 跑 smoke；独立脚本也要有 workflow owner。

### 场景合同哈希按文本语义收口
- `data/scenarios` 的 JSON/GeoJSON 文本合同要同时用 `.gitattributes eol=lf` 和 checker 端 LF 归一化锁住；gzip/二进制 sidecar 继续 byte-exact，并用跨 chunk 测试覆盖流式归一化边界。

### Playwright 服务元数据要先验活
- E2E 失败后 `.runtime/dev/active_server.json` 可能保留已停止端口；重跑前先 HTTP 探测端口，再清理 stale metadata，可减少 scenario chunk 这类长用例的误判。

### 静态边界 gate 要锁语义分类
- 禁止新增 helper/owner/controller 时，只列当前候选文件名会漏掉改名变体；checker 和 inventory test 要用同一套文件名分类器锁住语义，例如 `reset + transaction + owner/helper/controller`。
- 迁移大文件里的单个 wrapper 时，旧 inline token 的禁止检查要限定到被迁移函数片段；全文件扫描会把其它合法旧路径误报成回归。

### 并行 registry 刷新别无限 rebase
- 如果另一个 owner 持续提交 registry-only 状态快照，功能分支反复 rebase 会形成活锁；确认新提交只改 registry 后，用一次 merge 保留状态历史，并在 merge 冲突里写最终整合事实。

### 分阶段 renderer owner 按附件决定 dist 策略
- 如果当前阶段明确禁止 `dist/app/**` 改动，把 dist parity review 建议转成 `git diff --name-only HEAD -- dist/app` guard；等专门的 Pages dist 同步阶段再生成镜像。

### Guide 内触发确认弹窗要验层级
- 从 popover 内触发全局确认弹窗时，E2E 要覆盖弹窗可见和可点击；`z-index` 低于 Guide popover 会让确认弹窗实际出现在后方，dirty confirm 路径会被误判成逻辑卡住。

### 新增 E2E spec 要同步分层入口
- 新增 `tests/e2e/*.spec.js` 时同步更新 `test-layer-manifest.json`、test list、timeout allowlist 和 selector mapping；仅有 `package.json` 脚本会让分层 gate 与变更选择器漏跑关键浏览器覆盖。

### Sample 派生状态要绑定同一个 sample id
- 导入失败路径保留 previous sample 时，推荐导出、Guide 和 Export Workbench 派生状态要同时校验 sample id，确保 attempted sample 元数据停留在失败上下文，previous committed sample 继续显示自己的推荐。

### 用户可见 deeplink 任务可以穿过 chunk backlog
- `/app/?sample=...&view=guide` 这类入口会直接影响首屏可达性；如果任务本身不依赖 chunk infra 完成，应在 post-ready scheduler 上显式声明可穿过 backlog，并用 E2E 锁住 `pending -> success`。

### Pages 部署 smoke 先区分传播窗口
- GitHub Pages 刚部署后 release smoke 如果停在 shell ready，先用公开 URL、关键资源 HTTP 探测和同 run rerun 验证传播窗口；资源稳定后仍失败，再按产品启动回归处理。

### Selector 路由要覆盖 checked-in dist 镜像
- 新增 source owner 或公开样例入口后，同步检查 `dist/app/**` 和 `dist/pages-dist-manifest.json` 的 selector 路由；只改镜像文件时也要进入 `verify:pages-dist`，并带上 `dist` 与 `.runtime-output` 主线程锁。
- 仓库级配置文件也要有 selector 路由；`.gitignore`、workflow、验证入口这类改动如果 unmatched，`--execute` 会正确红灯，但例行审计会漏掉应跑的 contract。

### 新增 selector domain 要同步 supervisor registry
- `tools/test_route_registry.mjs` 新增 domain 时，同步更新 `tools/ai_test_supervisor/domain_registry.json` 和 supervisor schema test；否则 selector 本身能路由，SF-ATS contract gate 会因未登记 domain 失败。

### 本地 Pages release gate 先生成 dist
- 跑 `/dist/` release gate 前先执行 `verify:pages-dist`，再用 `tools/dev_server.py /dist/` 服务页面；裸 `http.server` 可能缺少项目路由语义，把未生成或未映射的 `dist/app/data/**` 误报成启动回归。

### Owner 迁移后同步源码扫描合同
- Renderer owner extraction 完成后，同步检查 Python source-scan contract 是否仍锚定旧 `js/main.js` 或 `js/core/map_renderer.js` 文本形态；合同应指向当前 owner 文件或升级为行为测试，否则 `verify:core` 会在运行时代码无变更时被旧扫描规则阻塞。

### Full verify:core 要在 clean HEAD 收口
- `verify:core` 里部分 inventory 会要求 checked-in dist 无 staged/unstaged diff，而 `verify:dist-drift` 会要求 builder 输出与 index 一致；生成 dist 同步后先提交，再在 clean HEAD 上跑 full gate，避免两个合同在脏 worktree 中互相卡住。

### 阶段 inventory 的 dist guard 要收窄路径
- 某个 renderer 阶段只想证明自己的镜像没变时，guard 应检查该阶段 owner 和主 renderer mirror 路径；全局锁 `dist/app/**` 会挡住后续阶段由 `verify:dist-drift` 要求的合法新增镜像。

### Python source-scan 合同要有真实入口
- 把 Python boundary contract 放进 verification metadata 的 `sourceRefs` 只能帮助 selector 识别文件；还要同步 package script、route registry 和 verify-core plan 断言，确保该 contract 真实执行。

### Windows 子进程树隔离要先验证当前用户权限
- WMI 进程事件订阅可能在普通用户令牌下直接返回权限错误；Windows 性能实验应在测量前编译并探测 Job Object helper，通过 suspended root、assign-before-resume、kill-on-close 和 fail-closed 清理证据实现可审计的整棵进程树隔离。
