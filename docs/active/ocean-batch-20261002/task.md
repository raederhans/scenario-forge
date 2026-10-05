# 批次状态

## 2026-10-03 Pages 在线示例启动后续修复（进行中）

预算修复 PR #204 已按六项必需检查合并至 `3470fdfc`。部署 run37120067391 的源构建、产物检查和 Pages 发布成功，但最后线上 sample deeplink smoke 在 importing 状态超时，不能算整体部署验收通过。六个已发布启动 gzip 下载后与产物逐字节一致：HOI36 EN/ZH 4,962,999/4,963,000bytes，HOI39 4,961,158/4,961,158bytes，TNO 4,801,326/4,801,326bytes。Pages 重序列化使分发字节略大于源码 gzip；原5,000,000byte预算不变，线上最小余量37,000bytes。

后续分支 `codex/pages-sample-startup-20261003` 基于该合并点，保留主目录WIP。调度状态没有证明死锁，本地限速可完成导入。实际CPU profile定位国家标签投影环分组的逐边嵌套检测热点；增加保守包围框剔除，保留原精确边界与奇偶判定。43项标签行为检查和12项release smoke helper检查通过。相同2倍CPU限速+网络配置单次前后采样：groupProjectedRings约2323→705ms，ringContains约2198→597ms；整页约61.9→63.2秒，网络/调度有波动，不宣称整页提速。补充线上失败日志的startupReadonly和project import phase，未改30秒断言、重试或allowlist。

最终产物769.80MiB，localhost发布入口PASS（case39.5s），示例导入/Guide/导出/Project流程均成功；import graph生成并核对PASS，窄diff审查无material finding。所有本地server/profile已结束。工作树和runtime证据为复核保留；最终PR、必需检查、合并和线上smoke以GitHub回执为准。

## 2026-10-03 启动预算与部署失败修复（进行中）

用户授权继续修复启动包预算和失败的部署，完成后合并推送。复用本工作树，新分支`codex/startup-budget-20261003`从已合并主线`14234669`开始；主工作区WIP保持原样。root唯一负责构建、测试、端口和Git交付。

部署run37017933735实际在Pages示例项目deeplink的pending状态失败，并非5MB断言。夜间性能run37071699138在旧代码+新版场景数据的合成baseline启动失败。localhost旧产物发布测试已复现另一处后续陈旧断言：Project按钮已使用aria-pressed，测试仍检查aria-selected。分别处理真实失败，不放宽时间、状态断言或体积预算。

正式v7采用闭合环末点精确预测、弧引用差分/方向位和二进制流内层gzip，保留标准JSON+gzip资源路径。实际六包为HOI36 EN/ZH 4,939,592/4,939,597bytes、HOI39 4,938,597/4,938,600bytes、TNO 4,784,035/4,784,036bytes；全部通过未修改的5,000,000byte门槛。HOI最小余量约60KB。三场景全部base/runtime拓扑和非版本字段在Python/JS逐项相等，119新增海域及几何精度保留。

目标验证49项codec/gzip/真实Worker、38项启动资产/catalog、额外六包预算断言、45项旧性能基线投影/工作流检查通过，六场景strict全部OK。更新三个场景的snapshot和audit以匹配新生成字节，catalog重建后无内容变化。旧faabcf81 Worker通过投影消费真实四包，未移植candidate runtime或放宽性能门槛。

本地Pages产物`.runtime/pages-startup-budget/dist`为769.79MiB，65项Pages检查、发布入口1项和项目保存读取/拒绝无效导入2项通过。CI原pending超时未在本地复现，已增加scheduler诊断字段，最终部署需以远端run为准。最终整合若改变渲染代码，由相应检查及CI进一步验证。

局部解压+解析+恢复三轮测试中，v7比v6增加约40–60ms（测试期间存在其他任务，不能作为独占性能基准）；收益是每包减少1.36–1.46MB传输量，不宣称整页启动固定比例提速。首次完整child-safe选择运行在路由golden case停止，原因是新增helper路线扩大workflow单文件的精确集合；已收窄到helper及测试并通过该断言，其余已通过检查和后续执行结果分别记录，不能把未执行项当通过。

root唯一负责构建、服务器与Git；本地4179/4180服务器及浏览器测试已结束。实验、数据对比和验证日志保存在`.runtime/reports/generated/startup-budget/`，工作树保留供复核；主目录WIP未触碰。最终提交、必需检查、合并及部署状态以GitHub PR/run回执为准。

最终本地child-safe组合55组全部通过，42项主线程命令按既有策略单列。修复提交`e8609467`随后无冲突整合主线`068f0b33`，84项启动/渲染交叠检查及依赖图通过；最终产物`.runtime/pages-startup-budget-final/dist`为769.80MiB，发布入口复测通过（39.2s）。Git普通传输连接失败后通过GitHub官方API核对并传输相同Git对象，不重写历史、不绕过必需PR门禁。

## 体积、性能优化与主线整合（提交前验收快照）

用户已明确授权优化后合并推送。继续使用独立工作树，root 是唯一共享构建与 Git 整合负责人；子代理分别研究编码方案、实现无损启动编码及验证真实Worker传输。保留七批累计119个新海域、292/285个水域及全部受保护几何，不通过精度降级或放宽预算换取结果。

- [x] 核对优化前实物与现有加载合同：HOI4_1939 EN gzip 7,657,771 bytes，TNO EN gzip 7,404,790 bytes；TNO完整拓扑104,196,293 bytes。
- [x] 核对远端与保护规则：origin/main已前进34提交至faabcf81，包含政治几何、河流和UI更新；主目录的其他WIP保持原样。
- [x] 保存七批成果为fc878761，61ab07bc按对象整合faabcf81主线并重新生成交叠元数据；TNO非water对象与主线逐对象一致，water与七批检查点一致。
- [x] 实施有测量依据的体积和运行时优化，验证几何/行为保留与实际收益。
- [x] 完成相关数据、契约、启动和性能检查，准备经普通受保护PR交付。

优化前记录和候选实验放在`.runtime/tmp/ocean-performance/`，最终验证输出放在`.runtime/reports/generated/ocean-performance/`。前面七批的验证只证明各批当时状态，不能替代整合提交的检查。

启动包v6仅对base.topology_primary的整数二维弧采用跨弧首点差分、zigzag ULEB128及base64；Worker在任何TopoJSON消费者前还原标准Topology。保留弧顺序、拓扑引用、transform、全部坐标与metadata；不支持的输入维持标准表示，坏descriptor明确拒绝并进入既有恢复路径。另将三个startup READY消息整包接入可转移Float64几何buffer；旧chunk保持v1，startup使用v2，源对象不被detach。

| 实际启动gzip，bytes | 优化前61ab07bc | 优化后 | 减少 |
| --- | ---: | ---: | ---: |
| HOI4 1936 EN / ZH | 7,659,733 / 7,659,734 | 6,394,906 / 6,394,908 | 16.513% |
| HOI4 1939 EN / ZH | 7,657,773 / 7,657,773 | 6,393,344 / 6,393,344 | 16.512% |
| TNO EN / ZH | 7,404,835 / 7,404,835 | 6,142,352 / 6,142,353 | 17.049% |

六包还原后的全部base字段与scenario字段逐项等于61ab07bc；每包296,827弧、1,538,874点、292个基础water对象。JSON末尾换行按既有写入策略不进入gzip，其余字节一致。全量TNO拓扑仍104,193,959bytes（99.37MiB），无损排序/拓扑去重收益不足，未改其精度或引用。

Node新进程各三轮，真实完整启动消息pack+structuredClone transfer+unpack中位数：HOI4 1939为1886.2→733.5ms（-61.1%），TNO为1788.5→579.1ms（-67.6%），12次均全响应deep equality通过。独立同进程三轮的最终生产磁盘decoder基准为313.326→210.726ms（含inflate+parse+恢复）；早期240ms原型不作为最终生产性能证据。这些是局部基准，不能代称浏览器整页启动提速比例。

当前整合验证：17项water运行时通过；26项codec/cancellation/json/cache目标检查、8项真实Worker集成、5项JS磁盘codec、4项Python codec、3项恢复指标行为检查通过。启动/catalog两个完整模块共38项，36项通过，2项失败最终均为现有5,000,000byte预算（6,393,344/6,142,352bytes）。第一次完整检查发现的manifest v5/v6不一致已修复并通过相关fixture及实际清单复测。六场景strict全部OK；catalog677项、data health退出0，保留13条report-only大文件提示；依赖图、700条验证路由及架构边界通过。

五个聚焦浏览器case最终通过：缺失runtime shell回退、owner healthgate失败后legacy重建、mask mismatch清理overlay、TNO默认可见图层、海域标签像素与重复计算。初跑两个失败保留在browser.log：marine测试需等待当前主线的国家标签异步准备，已采用正式导出就绪API；恢复已成功但metric只记rollback包装错误，现同时保留顶层与原healthgate cause，未改变恢复过程或放宽原断言。仅重跑受影响两例并通过。world/渤海各12次标签输出像素一致，geoContains重复调用为0。

最终Pages产物位于`.runtime/pages-ocean-performance-final/dist`，855,286,735bytes（815.66MiB），低于现有1GiB硬上限；对应65项Pages测试全部通过，新增worker codec资源在可达图内。未改tracked dist；采用主线既有artifact构建发布路径。所有本地构建/测试/浏览器服务均已结束。本节为提交前冻结结果，远端提交、required checks与合并状态以本分支GitHub PR及`.runtime/reports/generated/ocean-performance/`中的交付回执为准；工作树及忽略的实验/验证输出保留供复核，主目录WIP未触碰。

交付PR为[#202](https://github.com/raederhans/scenario-forge/pull/202)，优化提交`f8334221`已推送。首轮CI中六场景strict、smoke、Pages产物验证通过，child-safe执行前因wave6/wave7 probe JSON未匹配验证路由而停止；已将两份真实fixture及marine runtime套件接入既有water geometry重检查路线，保持原执行所有权和资源锁。对整个PR文件清单重新选择后unmatched=0，两项路由行为检查通过；既有17项水域检查已证明该组合行为。最终合并和门禁状态以PR实时记录为准。

本地执行同一PR的child-safe选择集，首次在第25个执行组失败后停止，之前24组通过，不能据此认定尚未执行的组已通过。首个失败为sync fixture已列入geo_stack但没有直接地理依赖导入；给既有snapshot更新及新增海域测试补充Shapely零容差几何保留断言，保留独立面积常数断言后，分类检查90项及11项sync fixture测试通过，未改检查器或分组。随后CI执行到验证框架自身测试，发现新增sync路由同时匹配整个TNO builder，改变了既有Stage C精确选择集；将新增路由限定在sync工具及其fixture，保留builder既有验证路线和精确断言。

收窄路由后两个Stage C精确集合检查及700条schema检查通过，真实选择API确认sync工具/fixture分别仍选择同步测试、TNO builder单独变更不扩大该局部集合。重新绑定整个PR清单后unmatched=0，本地完整执行65个child-safe组全部通过（adaptive-v2.json/log）；62条main-thread命令按现有策略单列，不将defer计为通过，相关水域/场景/Pages/浏览器证明见前述实际运行结果。上一提交8f0b0302的远端性能门禁通过；最终提交仍须取得自己的全部必需门禁。

## 第七批：新增海域与可见对话协作（本地完成）

用户继续授权新增，并要求可分派对话共同推进。沿用独立工作树，基线base246/TNO239、supplement98/shared207，累计73新区域全部保留。

- [x] 三个可见对话调查太平洋、印度洋、大西洋候选，独占各自runtime目录；50项来源候选已收束。
- [x] root审查去重、层级与接缝，46项通过physical/D3准入，4项无共同可用物理水面排除。
- [x] root接入通过集合，唯一staging、scope/保护验证后晋升与sync。
- [x] 目标回归、六场景契约、catalog/data health与准确体积增量核对。

正式数据已新增46项：大西洋及邻近水域20、印度洋8、太平洋18；七批累计119项。base246→292、TNO239→285，supplement98→144、shared207→253，新增39 macro/7 detail。完整名称、MRGID、parent及精度见plan.md。三个可见研究对话均已交付并同步采用结果，未继续扩搜。

| 第七批验证 | 结果 |
| --- | --- |
| 来源与层级 | 46来源合同、七parent、Hauraki5/Magdalena15/SaintVincent4记录union保留；原98 supplement对象不变 |
| 小湾精度 | 8项采用.0005；原始面对称差比例从约14%–51%降至0%–2.53%，不代表上游测绘精度认证 |
| 正式构建 | 三拓扑exit0，内置几何/D3与全部非水对象解码保留通过 |
| 变化范围与晋升 | base/TNO各25个旧feature变化；来源外非grid宽残差分别0/最大2.96e-10平方度，低于既有1e-8门槛；8输入一致、原ID保留、51保护对象完全不变 |
| Python source/geometry/authority | 31 passed：2新增回归及29其余检查 |
| Catalog/bootstrap/queue | 22 passed；目录672条已重建 |
| Node运行时 | 17项最终全部通过；首轮13通过、4项同一Khawr近岸probe返回null，修正选点后受影响7项全过；其余10项未重跑 |
| 六场景strict | 全部OK |
| Data health | exit0，13条既有report-only大文件提示 |
| 来源及实际元数据 | 无关UI原文不变、注册输出与账本身份正确；snapshot及两份provenance保留46来源合同，三来源dataset齐全；9waterchunks，provenance gaps=0 |

未放宽mask、grid、validator或预算阈值。Khawr选点问题的原失败日志、实际边界距离、三拓扑15点稳定性验证见context.md及`.runtime/reports/generated/ocean-wave7/`。本批未重复测试未改动的sync fixture，也未重复运行已确认超标的两项5MB预算测试。

实际EN启动gzip：HOI4_1939为7,351,442→7,657,771bytes（+306,329），TNO为7,100,281→7,404,790bytes（+304,509）；ZH分别+306,331/+304,508bytes，仍超过既有5,000,000byte预算。TNO拓扑104,196,293bytes（99.37MiB），距100MiB门槛仅661,307bytes；snapshot97,524,150bytes，全部变更文件仍<100MiB。下一次大批增加前应优先处理启动与拓扑体积。

来源审核队列为178macro/25withchildren/116backlog/44历史terminal/36low/5high-split/5simplification，provenance gaps=0。新增Vestfjorden与Frobisher保留为高复杂度子海域审核候选；低顶点提示仍包括受当前岸线精度限制的小湾，未伪造terminal记录。

本轮70项不同目标测试最终通过（31 Python+17 Node+22 catalog/bootstrap/queue），六场景strict和data health另行通过；不能据此宣称全库/启动体积预算检查全绿。所有本轮构建、同步和测试进程已退出，diff检查通过。成果保留在独立工作树`codex/ocean-batch-refinement-20261002`，未提交、推送、合并、部署或浏览器巡检；primary checkout和其他WIP未触碰。

## 第六批：印度洋、太平洋、北大西洋扩展（本地完成）

用户要求三方向大幅推进。基线base209/TNO202、supplement61/shared170；本批新增37项，完成后base246/TNO239、supplement98/shared207，六批累计新增73项。原有61条补充source feature对象保持一致。

- [x] 三方向并行研究38候选，37完成来源/physical/D3准入，Oro Bay无可用水面排除。
- [x] 接入10 SeaVoX与27 World Bay/Gulf海域，四组真实海域父关系，33个独立macro；37条完整重建ocean路由核实无遗漏。
- [x] 完成来源ID及多记录union适配、TNO来源元数据传播、账本引用及目标回归。
- [x] root唯一staging、范围与保护检查、晋升、sync、catalog及数据/加载验证均完成。

| 方向 | 数量 | 代表区域 |
| --- | ---: | --- |
| 北大西洋（苏格兰西岸及邻近水域） | 10 | 克莱德湾、赫布里底海、北/小明奇海峡、朱拉海峡、福伊尔湾 |
| 印度洋及澳洲周边 | 14 | 卡奇湾、莫塔马湾、攀牙湾、斯宾塞湾、达尔文港湾、范迪门湾、塔鲁特湾 |
| 太平洋 | 13 | 马尼拉湾、芽庄湾、相模湾、土佐湾、远州滩、凯雷马湾及澳洲东岸海湾 |

完整37项与MRGID见plan.md第六批表。只有Kutch→Arabian、Martaban→Andaman、Melville→Arafura、Tarut→Persian采用Gazetteer海域Part of及detail .004；其余独立macro/.005，不把行政归属、相邻、同一SeaVoX分类当成父关系。Cockburn两条同ID原始记录union，实际source_feature_count=2。WorldBay公开图层没有宣称统一测绘质量或虚构版本，中文按编辑译名记录。

| 第六批验证 | 结果 |
| --- | --- |
| 正式来源 | 37 prepared几何匹配；原61 supplement feature精确保留；6个旧prepared面只在新源union内扣除；接缝覆盖delta=0，顺序无关 |
| 三拓扑staging | exit0；几何、D3及非水对象解码保留通过 |
| 晋升与变化范围 | 8输入身份一致；只晋升5水域文件；全部原ID保留；51保护feature逐对象不变；base/TNO来源外非grid宽差异均0 |
| Python来源及几何 | 29 passed（10已完成source/fixture+19其余，不重复） |
| 同步fixture | 11 passed，4 subtests passed；多来源元数据合并、保留扩展、幂等 |
| Node运行时 | 16 passed，37项在3拓扑及merged9chunks海正/陆负/唯一命中；全部chunk ID/props/geometry与runtime一致 |
| Catalog/bootstrap/source-review | 22 passed（19+2+1） |
| 六场景strict | 全部OK |
| Data health | exit0；13条report-only大文件提示，其中shared source现25.3MiB新越过提示阈值 |
| 实际元数据 | UI原文、注册outputs/ledger身份正确；snapshot及两provenance保留37来源合同；IHO/SeaVoX/WorldBay三来源齐全，provenance gaps=0 |
| 文件规模 | snapshot96,359,732bytes；所有变更文件小于100MiB |

本批78项不同目标测试通过，未重复运行第五批已确认失败的两项5MB启动包预算测试；当前准确gzip计量仍超门槛，不能表述为所有检查全绿。HOI4_1939 EN：7,266,412→7,351,442bytes（+85,030）；TNO EN：7,012,933→7,100,281bytes（+87,348）。ZH增量分别85,032/87,349bytes。此处是第六批冻结baseline得到的准确增量，既有超标不归因于本批；没有放宽门槛。

来源复核报告现139macro/21withchildren/78backlog/44terminal/17low/3high-split/5simplification，provenance gaps=0。新增小湾使低顶点提示增加，不把低顶点提示等同于错误，也未自动标成terminal或高精度完成。部分小湾仍受当前岸线分辨率限制；Oro、重复Papua与范围不明Geelvink不计入完成项。

证据在`.runtime/reports/generated/ocean-wave6/`，正式来源清单在plan.md，唯一工作树仍为`codex/ocean-batch-refinement-20261002`。所有构建/同步/测试已退出，无遗留服务器；primary checkout及其他WIP未触及。本轮未提交、推送、部署或浏览器巡检。

## 第五批：北海细区（本地完成，启动包既有预算缺口另列）

用户要求继续推进；基线为第四批完成态base201/TNO194，supplement53/shared162。保留此前全部WIP，沿用独立工作树。

- [x] 八个北海候选逐ID真实来源与中文名称核查。
- [x] source/prepared/physical及D3准入，确认parent与已有细区接缝。
- [x] 最小补齐追加来源的marine_detail与base/TNO parent转换契约，更新目标测试。
- [x] 唯一owner构建、输入/范围/保护检查、晋升及同步，完成数据和运行时验证。

本批新增多诺赫湾、泰湾、蒂斯湾、布里德灵顿湾、韦斯特雷海峡、斯特朗赛海峡、斯卡帕湾、耶尔海峡，均按北海下级marine_detail接入。第五批完成后base209/TNO202，五批累计新增36项；supplement61/shared170。原53条补充feature保持逐对象一致，NorthSea shared父面仅扣除8新child，其他既有prepared几何不变。

| 第五批验证 | 结果 |
| --- | --- |
| 三拓扑几何、D3、非水对象decoder保留 | PASS |
| 输入身份、原ID与新增集合、51保护feature | PASS；base201→209、TNO194→202 |
| 来源/grid变化范围 | PASS；base只涉及NorthSea和Atlantic，TNO只涉及NorthSea和东北大西洋；来源外宽于grid的差异为0 |
| Python来源/几何/authority | 23 passed（10 source/fixture + 13其余，不重复） |
| Node D3及分块 | 14 passed，8区与3个既有北海detail探针，3拓扑与合并9chunks一致性 |
| catalog | 19 passed |
| TNO水域bootstrap/manifest | 2 passed |
| 来源队列 | 1 passed；按macro/detail修正预期后定向重跑，保留45macro backlog、44terminal、3high |
| 六场景严格契约 | 全部OK |
| data health | exit0，原有12条report-only大文件提示 |
| locale/来源/拓扑身份和UI原文 | PASS；来源snapshot95,927,636bytes，所有变更文件<100MiB |
| 额外启动包体积预算检查 | 2 failed，既有5,000,000bytes门槛未放宽；见下文 |

本轮59项不同海洋细化目标测试通过，另2项启动包预算测试仍失败，不能表述为所有检查全绿。额外选中的StartupBootstrapAssetsTest两项在gzip预算断言处失败：hoi4_1939 EN=7,266,412bytes，TNO EN=7,012,933bytes；基线HEAD f47b36f4对应文件已为6,648,877和6,397,198bytes，同样超5MB。该预算缺口在本轮之前存在；当前累计体积有增长，不能据此推断第五批8区独自造成全部增长。此前记录的catalog+bootstrap组合指TNO water bootstrap/manifest目标，不是这两个额外通用budget测试。原失败输出保留在catalog-bootstrap-review-tests.log；修正后的queue单项及真实water bootstrap两项分别在source-review-final.log和water-bootstrap-tests.log。未改预算、断言容差或启动架构。

来源审核报告仍是106macro/17withchildren/45backlog/44terminal/3high/1low/4simplification、provenance gaps=0，没有把detail伪装成macro或将待审核来源标成完成。后续已保留7条英国/爱尔兰邻近来源属性线索，尚未取geometry/准入，不计为新增完成项。本轮未提交、推送、合并、部署或浏览器巡检。

## 第四批：扩展未接入命名水域（本地完成）

用户要求继续并新增其他海域；基线为第三批完成态base192/TNO185。复用独立工作树，保留前三批全部改动。

- [x] Tryoshnikova Gulf官方独立面完整准入、名称与层级核查。
- [x] 全部SeaVoX属性索引对照现有全部水域，筛选8个未接入候选并逐项通过物理/D3准入。
- [x] 确定本批9项清单并接入来源和分区路由：supplement53/shared162，原44条补充feature逐对象不变；目标测试已补齐并通过。
- [x] 唯一owner构建、输入/范围/保护检查后晋升，再同步并完成数据和runtime验证。

本批新增白海、冰岛海、林肯海、马纳尔湾、保克海峡与保克湾、拉卡迪乌海、布兰斯菲尔德海峡、德雷克海峡、特里奥什尼科夫湾。四批累计新增28项，base201/TNO194。Lakshadweep/Laccadive只接入一个ID；Tryoshnikova中文为有据人名音译的编辑译名，并未声称官方中文地名。

| 第四批验证 | 结果 |
| --- | --- |
| 三拓扑staging几何、D3及非水对象保留 | PASS |
| 输入身份、原ID及新增集合、51个保护feature | PASS；base192→201、TNO185→194 |
| 额外来源及实际grid范围 | PASS；既有named变化全部在原边界一个grid宽度内，Ross面积不变；TNO仅六洋区有实质变化 |
| source-contract | 3 passed，接缝互斥/顺序无关/覆盖保留及准确来源路由 |
| marine refinement + authority其余测试 | 13 passed；不重复上述3项 |
| D3 water + marine runtime | 13 passed，九项三拓扑/合并分块海上与陆地probe及9chunks一致性 |
| catalog + bootstrap + source-review | 22 passed |
| 六场景严格契约 | 全部OK |
| data health | exit0，保留原有12条report-only大文件提示 |
| locale/来源/拓扑字节身份和UI原文 | PASS；所有变更文件<100MiB，来源快照95,903,807bytes |

本批51项不同目标测试全部通过。额外范围检查初次Weddell/Scotia完全不变断言及shared-node网格诊断见context；未修改生产精度、mask或测试容差。来源审核仍保留106macro/17withchildren/45backlog/44terminal/3high/1low、provenance gaps=0，没有伪造来源审核完成状态。

下一批已筛出8个北海细区属性线索（Dornoch、Tay、Tees、Bridlington、Westray、Stronsay、Scapa Flow、Yell Sound），还未下载几何或证明准入，需研究marine_detail及明确parent。本批没有提交、推送、合并、部署或浏览器巡检，成果全部位于独立工作树。

## 第三批：东南极三海域（本地完成）

用户再次要求继续推进；基线为第二批完成态base189/TNO182。

- [x] 三项source/prepared/physical裁切有效、共同海上与邻近陆地D3 probe通过；Somov/Ross与Mawson/Davis的实际来源面无正面积重叠。
- [x] 接入3项来源与分区路由，supplement44条/shared source153条；三拓扑海上/陆地probe和来源路由契约已通过正式数据验证。
- [x] 单owner重建、输入身份和变化范围核对后晋升；base192/TNO185，51个保护feature逐对象不变，三拓扑非水对象解码一致。
- [x] 元数据、9个TNO水域分块及六场景启动依赖同步；数据与runtime验证通过。

另行只读核实Davis Sea低顶点数为原始来源自身形状，不能由该提示推断边界错误。已研究的Tryoshnikova Gulf为下一批独立候选，仍需物理准入与层级设计；36项来源属性核查未发现其他未研究下级线索。

本批新增莫森海、迪维尔海和索莫夫海；三批累计新增19项，当前base192/TNO185。所有成果保留在独立工作树，未提交、推送、合并或部署。

| 第三批验证 | 结果 |
| --- | --- |
| staging三拓扑几何、D3及非水对象保留检查 | PASS |
| 输入身份、原ID与51个保护feature | PASS |
| 额外几何范围检查 | PASS；base仅Southern有实质变化，TNO仅Indian/Pacific Antarctic两sector变化，来源外残差均为既有grid宽度；Ross/Weddell/Scotia保留 |
| marine refinement + authority | 14 passed |
| D3 water + marine runtime | 13 passed；三新海域三拓扑唯一命中、南极陆地排除及9分块同一性 |
| catalog + bootstrap + source-review | 22 passed |
| 六个scenario严格契约 | 全部OK |
| data health | exit0，仅既有12条大文件提示 |
| 最终locale/source/topology身份与UI原文 | PASS；所有变更文件<100MiB，来源快照95,449,002bytes |

第三批49项不同目标测试全部通过，无需更新source-review队列预期。当前97个TNO marine macro、17个有children、36个backlog、44个历史terminal记录、3个高复杂度候选、1个低顶点数提示，provenance gaps=0。未运行浏览器巡检、CI或部署检查；未将来源审核队列或低顶点数提示冒充地图完整性结论。

## 第二批：南极海域（本地完成）

用户继续推进授权已确认；接续首批成果，当前基线为base182/TNO175。

- [x] 官方来源准入、物理掩膜及既有海域接缝核查；7项全部通过。
- [x] 接入7项南极命名海域与南大洋分区路由，三拓扑命中、陆地排除及既有南极海域保护探针均已通过正式数据验证。
- [x] 单一owner重建staging并晋升；base189/TNO182，51个保护feature逐对象不变，三份拓扑非水对象解码一致。
- [x] 同步来源、翻译、9个水域分块和启动元数据，执行受影响数据契约检查。

第二批新增里瑟-拉森海、合作海、戴维斯海、拉扎列夫海、宇航员海、别林斯高晋海、阿蒙森海；两批合计新增16项。当前base189/TNO182、supplement41条、shared source150条。全部修改保留在独立工作树，未提交、推送、合并或部署。

| 第二批验证 | 结果 |
| --- | --- |
| staging三拓扑几何、D3及非水对象保留检查 | PASS |
| 输入身份、原ID与51个保护feature | PASS |
| 额外几何范围检查 | PASS；仅base Southern与TNO三个Southern sector有实质变化，实际prepared源外仅既有grid尺度细条，其他named seas保留 |
| marine refinement + authority | 13 passed |
| D3 water + marine runtime | 13 passed，含三拓扑7海域唯一命中、南极陆地排除、旧Ross/Weddell/Scotia和9分块同一性 |
| catalog + bootstrap + source-review | 22项最终通过；首轮21过1失败，更新实际percentile队列预期后仅重跑该1项通过 |
| sync元数据夹具 | 9 passed，新增locale geo原文区间写入保护 |
| 六个scenario严格契约 | 全部OK |
| data health | exit0，仅既有12条大文件提示 |
| 最终locale/source/topology身份与UI原文 | PASS；无关UI文本逐字保留，所有变更文件<100MiB |

本批57项不同目标测试最终通过；未运行浏览器巡检、CI或部署检查。额外范围检查的初次误差及修正依据见context.md，不涉及放宽生产容差。

当前来源审核队列保留事实：94个TNO marine macro，17个已有children，44个历史terminal记录，33个补充海域仍待child-source review，provenance gaps=0。复杂度百分位变化后Davis Strait、Alaska/BC及Kara Sea三项为高复杂度后续审核对象。Davis Sea虽有可追溯、有效的真实面，但当前只有81个编译顶点，被现有audit标记为低精度来源替换/细化候选；没有伪造terminal状态压掉待办。

下一批来源储备：Mawson（24155）、Dumont d'Urville（24156）、Somov（24157）已找到有效面，尚待物理准入和runtime实施；King Haakon VII本次未找到独立官方面。来源详情和边界条件见plan.md。

## 第一批完成态

- [x] 核对现有水域数量与此前流程；建立独立工作树。
- [x] 完成大西洋/美洲、印太/大洋洲来源准入研究，第一批9项。
- [x] 分派独立实施，统一接入9项来源与裁切规则；同步工具与运行时探针由子代理完成。
- [x] staging 重建、输入身份核对与晋升：base182/TNO175，51个受保护水域完全不变；三份拓扑非水对象通过构建内置解码对比。
- [x] 同步派生元数据、数据目录及目标检查。

第一批9项已在独立工作树本地完成，没有推送、合并或部署。未运行浏览器巡检；本轮验收使用实际D3几何命中、物理掩膜、分块及启动资产契约。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 三份拓扑 staging 自带几何及非水对象保留校验 | PASS |
| 晋升前输入身份及受保护水域逐对象比较 | PASS，base31+TNO20完全不变 |
| `pytest tests/test_rebuild_water_geometry.py` | 2 passed |
| `unittest tests.test_sync_marine_refinement` | 7 passed，含compact/pretty格式回归 |
| marine refinement + water authority | 12 passed |
| source-review队列契约 | 1 passed |
| Node water geometry + marine runtime | 13 passed，覆盖9项新海域的三份拓扑唯一命中和分块同一性 |
| catalog + TNO bootstrap/manifest | 21 passed |
| 六个scenario `--strict` | 全部OK |
| data health | exit0；只有现有大文件提示 |
| `git diff --check` | PASS |

已补齐source ledger、来源snapshot/provenance、audit、中文名称与资产哈希。原25条supplement feature全部不变。最终来源快照保持紧凑格式约95.3MB，避免通用pretty写入造成338.2MB膨胀；来源内容等价校验通过。

格式收尾后：locale/source manifest字节身份核对通过，catalog重建一致性定向复查通过，最终diff检查通过；本次变更文件均小于100MiB。56项不同目标测试均通过（格式收尾另复查1项目录测试），所有进程结束。

## 首批结束时的后续候选（历史快照）

南极7项候选已找到真实面，尚未实施极区准入。Davis Strait与Alaska/BC因轮廓复杂保留为后续子海域拆分审核候选。来源审计：87个TNO海域宏区，44个历史terminal记录，26个待细分来源审核的补充海域，2个高复杂度待审核对象，provenance gaps=0。这些队列不是本轮新增面接入失败，也不等于全球海洋已经全部细化完成。
