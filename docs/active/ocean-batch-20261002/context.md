## 第七批对话协作与所有权

第七批已本地完成。sync65010、31 Python source/geometry/authority、22 catalog/bootstrap/queue、六场景strict、catalog672及data_health均退出0；health保留13大文件提示。Node按原断言修正稳定probe后7项重跑全PASS（215.6秒），与原未受影响10项合计17项，当前70个不同目标测试全部通过。全部writer已结束，三研究对话均idle，未提交/发布。最终base292/TNO285、supplement144/shared253、9waterchunks、snapshot97,524,150bytes；准确启动体积与审核队列见task.md，既有5MB预算缺口及99.37MiB拓扑约束均保留。

Node首轮17项中13通过、4项因同一个Khawr al Hajar probe的mask边界分类actual:null失败。原点[59.747091759789186,22.534764407538113]距实际land/ocean边界0.000815615度，落在validator既有0.001度不确定带；唯一水域命中与直接D3海陆判断均正确。root只读检查找到新点[59.74649175978919,22.534964407538112]，位于原candidate和两份admitted几何内部，距mask0.001369802度。三拓扑分别检查中心和四向一个base grid diagonal（0.000156137度）共15点，均保持唯一命中、陆地false、base ocean true及mask距离>0.001。仅更新共同fixture坐标，保留全部expectedLand/expectedOcean、生产几何及validator阈值；原失败日志与诊断、稳定点验证保留在wave7报告目录。重跑受点位影响的7项，其他10项原PASS继续有效。

完整staging session86630退出0，三拓扑几何/D3和非水解码保留通过。base范围25个旧面变化，来源外非grid宽残差0；TNO范围通过，最大非grid宽残差远小于1e-8，未放宽检查。promote核对8输入身份、全部原ID、新46集合及51保护对象后晋升5文件，base292/TNO285。root启动sync65010和remaining marine/authority45088，Node owner继续等待sync完成。TNO拓扑当前104,196,293bytes（距离100MiB仅661,307bytes），这是下批扩展需要处理的实际体积约束。

正式来源已采用46项，supplement144/shared253，原98条补充feature逐对象保留。root唯一拥有完整构建，命令`python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-wave7-stage`；日志`.runtime/reports/generated/ocean-wave7/geometry.log`。8个data输入及生产marine定义冻结至构建结束；仅root可晋升五文件和sync。Python测试由root拥有；marine_runtime_tests只拥有两份Node测试和wave7共同fixture，等正式sync完成再运行。三个可见研究对话均已交付收束。

小湾精度经原面比较：Mida/Gharo/Tudor/Korangi/Khawr/Minnie/AoTang/Bootless的默认.005简化损失明显，采用.0005来源精度，其他macro.005/detail.004不变。2项新source/precision回归已通过，覆盖46准确来源合同、多记录5/4/15、七个parent及refresh+named-preparation实际轮廓保留。物理mask、grid和生产容差未改。

source完整检查退出0：46 prepared与既有smooth/normalize操作一致，四个旧prepared面扣除新源，reconcile顺序无关、总覆盖delta=0。首次临时检查用纯simplify/整块面积等价失败，定位到生产normalize_polygonal原有的逐component≤1e-9平方度过滤：Frobisher单碎片9.72e-10；Coral3.33e-10，Caribbean/Mexico合计1.49e-7/9.94e-8但每片均≤1e-9。临时检查改为复现既有normalize及实际subtract_named_ids，仍要求变化不能增加旧面，来源外每片都被既有normalizer完全消除；未修改生产阈值。检查日志prepared-sources.log。

用户直接授权继续增加并分派对话。主对话仍唯一拥有正式code/data、staging/promotion/sync；可见对话只写以下工作树runtime目录：
- 太平洋01a0fbdd-aacc-77a1-a7b2-7ba7538554e4 → .runtime/tmp/ocean-wave7/pacific/
- 印度洋01a0fbdd-b021-7221-a4ed-aeda12e9ae19 → .runtime/tmp/ocean-wave7/indian/
- 大西洋01a0fbdd-b8a1-77f1-9a0a-ec0c35769d74 → .runtime/tmp/ocean-wave7/atlantic/

实际cwd全部使用C:/Users/raede/.codex/worktrees/ocean-batch-refinement/mapcreator，项目默认primary不写。root已冻结第六批水域、三拓扑、sources、locale、ledger、snapshot、源码及4 startup gzips到wave7/baseline，共17文件。研究先复用今日公开索引，再按真实polygon核验，不复活Oro/Geelvink/Papua重复。候选研究期间无正式构建进程。主对话通过wait_threads读取进展，不要求子对话跨对话发消息。

## 第六批完成记录（2026-10-02）

三路独立调查最终通过37（Atlantic10、Indian/Australia14、Pacific13）。原supplement61 feature对象精确保留，正式补充98/shared207；10 SeaVoX+27WorldBay/Gulf新来源。4个经过Gazetteer Part of核实的detail，33独立macro；Oro Bay在两physical masks均完全消失被拒绝。37正/负D3预检通过。

root唯一source build退出0；prepared检查：37几何准确，6个旧prepared父/重叠面只在新源union内扣除，其他旧源不变，全部接缝联合覆盖delta=0且顺序无关。10项不同source/adapter fixture测试通过。WorldBay dataset/record ID常量、TNO source_datasets merge已补齐，sync fixture11 passed/4subtests。Node测试与37共同fixture已在正式sync后通过。

完整TNO路由只读核实：按实际loader恢复父洋面、source_ids union/bbox以及未减land的全部supplement_bboxes，对37候选核对未配置洋区交集，无>1e-8遗漏。VanDiemen/Darwin原始snapshot只交Timor，Melville只交Arafura；route符合既有分区，而非由行政/语义父关系猜测。base staging scope通过：20旧feature有实质差异（15named+5ocean），全部来源外非grid宽差异为0。

root fullstage49304退出0，base/TNO scope均通过；promote检查8输入、旧ID、新37集合、51保护对象后晋升5文件。sync41226退出0，三topology非水对象保留；canonical base246/TNO239、9waterchunks。其余geometry19通过、Node16通过、catalog/bootstrap/queue22通过，加source10+sync11共78项；六场景strict全OK。catalog672条重建、data_health退出0（13 report-only size warnings，新增shared source25.3MiB提示）。所有root/agent进程已结束。

# 执行上下文

## 第六批执行上下文

Root已保存wave6 baseline，含本轮之前startup gzip，便于准确区分本批体积变化。Root独占正式代码/data、统一physical masks、source/build/promotion/sync；日志.runtime/reports/generated/ocean-wave6/，staging拟用.runtime/tmp/ocean-wave6-stage/。antarctic_admission负责indian/来源研究，pipeline_map负责pacific/来源研究，marine_runtime_tests负责atlantic/十条精确WFS下载和接缝比较；三者只写各自runtime目录，不构建或写正式文件。北大西洋新spawn触发线程总数上限，已复用闲置marine_runtime_tests代理，未新建用户聊天。印度洋/太平洋不把旧SeaVoX terminal视为所有公开来源的穷尽，但避免无证据重复查询；适合的新独立来源可研究。保持Atlantropa/湖泊/非水对象保护。

## 第五批执行上下文

Root已保存base201/TNO194、supplement53/shared162及两base/TNO拓扑和locales至`.runtime/tmp/ocean-wave5/baseline/`。Root独占正式代码/来源/生成数据、构建、晋升及同步；日志`.runtime/reports/generated/ocean-wave5/`，拟用staging`.runtime/tmp/ocean-wave5-stage/`。pipeline_map只写`candidates/`逐ID取8个North Sea来源并比对已有named与兄弟接缝；antarctic_admission只写`detail-contract/`梳理既有detail父子/前缀/全量重建/元数据契约。二者不构建或写正式data，root统一物理准入。延续既有mask/生产精度和staging验证。

第五批准入已完成：八项official raw响应均HTTP200/准确单ID，官方分类level3 North Sea 23647；来源与既有细区及兄弟之间无正面积交叠。物理裁切有效，最终D3海上/陆地probe全PASS；Westray首次平面最近land点与球面ocean边界冲突，改选邻近D3确认且四向0.005度仍在共同land的点，记录在global-admission/land-probe-selection.json，未改任何mask/容差。官方父分类不等同于旧残余父面的空间包含，raw覆盖约73–97%，因此不以旧父面裁剪child。

正式实现保持ADDITIONAL_SEAS五元组，新增8项parent映射和detail .004精度helper；source refresh和TNO specs共享precision，snapshot同步转换parent前缀，spec组装按parent追加child subtraction并保留旧列表，明确仅东北大西洋clip route（实际ocean交叠只在该sector）。原45 macro/8 ocean来源仍.005。Root来源构建退出0：supplement61/shared170，原53个feature逐对象不变；check_prepared_sources确认八项实际prepared等于raw两次.004，NorthSea仅扣除8新child，其余全部prepared几何保持不变。

代理执行所有权已更新：antarctic_admission唯一拥有tests/test_marine_refinement.py，7项新增fixture/source/preparer回归+3项原来源测试共10 PASS（2.815s+17.465s）；exact名单在.runtime/tmp/ocean-wave5/source-tests-passed.json，后续runner排除重复。pipeline_map唯一拥有两Node marine/water测试，已编辑完成，等正式几何及chunks同步后才运行；只读下轮候选可写next-candidates.md。Root于source检查通过后启动唯一geometry session29751，命令python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-wave5-stage，geometry.log；输入和生产实现冻结，禁止重复构建。晋升前必须输入身份、51保护feature、三拓扑非水解码和来源/grid范围全部通过；仅NorthSea允许在新增child内部发生真实扣除，其余已有named只允许原边界一个实际grid宽度内的移动。

第五批geometry退出0，三拓扑球面/水域检查和全部非水对象实际decoder比较通过。base范围检查仅Atlantic parent与NorthSea有超过1e-8的变化，TNO仅NorthSea和东北大西洋有该量级变化；两者new-source范围外残差的non_grid_width面积均0。输入身份、原ID及新增集合、51保护feature逐对象检查通过，已晋升outputs.json五文件；base201→209、TNO194→202，31+20保护对象不变。

Root启动sync session20752与剩余只读marine/authority测试session60295；后者13项PASS（39.771s），和代理10项合计23项不同Python来源/几何测试通过。同步包含六场景startup依赖，未结束前不跑读chunks的Node测试和metadata检查。下一轮只读属性库存留下7项线索，见.runtime/tmp/ocean-wave5/next-candidates.md；未取geometry/未准入/不计入当前36项累计新增。

第五批同步退出0。Node独占owner一次运行14/14 PASS（92.31s），三topologies/merged9chunks、新8detail与既有Forth/Moray/Pentland probes全部通过。strict六场景全OK，catalog672条重建成功，data_health退出0（12原有report-only大文件提示）。final-metadata确认UI原文、outputs SHA/size、两source ledger身份、9chunks、snapshot95,927,636bytes、所有变更文件<100MiB及provenance gaps=0。

收尾组合最初22项有3失败：19catalog通过；source-review预期错误地把全部53 additions当macro backlog，实际报告仍45。代理只把该断言按region_group=marine_macro筛选，明确8detail不进macro队列，44terminal/3high不变，单项1.277s PASS。另2项是本轮额外选的StartupBootstrapAssetsTest通用startup budget检查，分别在5,000,000bytes预算处失败；并非此前TNO水域bootstrap/manifest组合。Root核实HEAD f47b36f4的HOI4_1939/TNO EN gzip分别6,648,877/6,397,198bytes，当前7,266,412/7,012,933bytes，故基线即超标，仍保留为当前未解决预算缺口，不改预算、不冒称全绿。marine依赖的test_runtime_bootstrap_water_feature_ids_match_source与test_manifest_and_startup_bundles_reflect_current_water_bootstrap另行2 tests/3.194s PASS。59个不同目标测试最终通过，另2预算失败。

Root所有source/build/scope/promotion/sync/strict/catalog/health/Python进程已退出，Node代理也退出0；预算只读归因随后已收束：root保留HEAD与当前准确字节证据于.runtime/tmp/ocean-wave5/startup-budget-review.md；没有wave4 gzip snapshot，无法精确分离第五批的增量，不作未验证原因推断。pipeline_map未交付新的证据时已被root中断，无正式写入，root接管并完成该有限报告。diff --check在生产/测试改动结束后通过。全部成果保留原独立工作树，主checkout和无关WIP未触碰。

## 第四批执行上下文

用户要求继续并增加其他海域。Root已保留第三批base192/TNO185及supplement44条的baseline于`.runtime/tmp/ocean-wave4/baseline/`。Root继续独占正式源/数据、构建、晋升、同步；日志`.runtime/reports/generated/ocean-wave4/`，拟用staging`.runtime/tmp/ocean-wave4-stage/`。沿用相同几何、D3、非水对象、保护对象及来源/grid范围验证，不改变mask或生产容差。

antarctic_admission拥有`.runtime/tmp/ocean-wave4/tryoshnikova/`，对24149完整准入并核对层级；pipeline_map拥有`.runtime/tmp/ocean-wave4/global-candidates/`，以249行SeaVoX属性索引对照全部现有水域和来源，逐个下载有限新候选，不重复既有44个terminal家族、不把同义或洋盆祖先当新细区。代理禁止改正式data/代码或启动全量build。准入结果确定前不修改候选定义。

9项全部接受。marine_runtime_tests的global-admission工作在无落盘脚本/输出时已中断，root接管该目录与计算；Tryosh由原代理完成独立PASS。Root脚本`global_admission.py`复用上一批已验证未变的physical mask对象，对8项一次/二次prepared和真实old source/runtime owner差集后裁切，产出admission-report/source-seams与D3上下文。首次D3负probe仅Bransfield失败：平面距岸0.01度的最近点仍被球面ocean覆盖，改选通过原始D3两land及ocean排除的[-58,-64]，不改变mask或阈值；重跑8项全PASS。报告采用最终点，旧计算log保留首次点及诊断。9项独立macro不推断parent；Tryosh编辑译名与Lakshadweep/Laccadive别名证据见plan。

Root写入45项ADDITIONAL_SEAS及7条真实接缝owner规则，正式补充源追加9项前校验raw/feature/query/URL/简化等价；Tryosh抽取与原2记录缓存逐对象相同。源命令`python -B -u .runtime/tmp/ocean-wave4/adopt_sources.py`，日志source-build.log。antarctic_admission接续独占3份marine/water测试，补9项probe、201/194计数、source ID/routes/seam行为；不运行依赖正式数据套件，不构建。后续geometry仍只由root运行。

source-build退出0，53条补充来源保留原44条逐对象一致，共享源162条。Root再次确认9项实际prepared源与准入用二次simplify面拓扑等价。已启动`python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-wave4-stage`（geometry.log），root唯一owner，8个正式输入及marine定义冻结。成功判据exit0+内置几何/非水检查+输入身份一致+额外来源/grid变化范围检查，晋升仅outputs.json五文件。

geometry退出0；base额外检查最初复用上批Weddell/Scotia完全不变断言，Weddell面积微差3.81520508e-8平方度触发失败。独立diagnose_scope显示Weddell与Scotia(7.53503015e-6平方度)差异都严格位于旧边界的实际grid diagonal0.0001561370385度以内；本批Bransfield/Drake相邻源新增shared nodes。调整本批临时scope检查为所有发生变化的既有named海域都必须完全位于原边界一个实际grid宽度内，Ross无相邻新增仍保持原exact-area断言。最终六个既有named变化的outside_existing_boundary_grid面积全部0，所有来源外残差的non_grid_width面积0；未改生产精度/容差或仓库测试阈值。初次日志base-scope-initial.log和base-scope-diagnostic.log保留诊断。

TNO额外范围检查通过，仅NE/SW Atlantic、W/E Indian、W Arctic、S Atlantic Antarctic六洋区有>1e-8平方度变化，named无实质变化。Root promote再次核对8输入身份、原ID及新增集合；base192→201、TNO185→194，base31+TNO20保护feature逐对象不变，仅晋升5个manifest输出。sync由root唯一执行，同时运行剩余geometry单测；已在构建中通过的3项source-contract不重复，见source-contract-tests.log。

第四批收尾：sync退出0，六场景startup依赖同步完成；source-contract3+remaining marine/authority13+Node runtime13+catalog/bootstrap/source-review22，共51项不同测试全部PASS。六场景strict全OK；catalog重建及data_health退出0，原有12条report-only大文件提示保留。final-metadata.log确认UI原文、global locale/refined/base topology SHA/size及两条source ledger当前身份，9个水域chunks、快照95,903,807bytes、变更文件全<100MiB。family-refinement.json保留106macro、17withchildren、45backlog、44terminal、3high、1low、4simplification review、0provenance gaps；来源review测试原预期无需更改。所有root-owned源构建、geometry、scope、sync和检查进程均退出，无服务器或悬置写入。前三批WIP一并保留，本批无commit/push/merge/deploy或浏览器巡检。

## 第三批执行上下文

沿用当前独立工作树及前两批全部WIP。Root已保存base189/TNO182完成态到`.runtime/tmp/ocean-wave3/baseline/`；正式数据和共享进程唯一owner=root，日志`.runtime/reports/generated/ocean-wave3/`，staging拟用`.runtime/tmp/ocean-wave3-stage/`。预定源构建复用已缓存官方响应；geometry命令为`python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-wave3-stage`。成功要求exit0、三拓扑内置几何/非水对象保留和input identity一致，再跑基于实际prepared/raw source及实际grid的变化范围检查，晋升仅outputs.json五文件。失败不晋升，按具体证据诊断，不更改精度/容差。

antarctic_admission独占`.runtime/tmp/ocean-wave3/candidates/`临时研究，复用wave2 next-wave-notes缓存核查Mawson24155、Dumont d'Urville24156、Somov24157的physical准入、Ross接缝、共同海上probe；pipeline_map仅在`.runtime/tmp/ocean-wave3/davis-source-review/`查Davis Sea是否有更好来源。两者禁止改正式数据或启动正式build。测试代理待准入确定后接续既有三份marine/water测试；主代理持续持有生产定义与所有生成资产写入权。

3项物理与D3准入通过；标准raw/candidate/fetch缓存齐全且沿用原响应bytes，fetch明确request_performed=false、cached_at为上轮文件mtime，不伪造新retrieval。三项raw/prepared来源与既有named来源正面积交叠均0；Mawson对当前encoded Davis有2.82461e-5平方度、Somov对encoded Ross有1.98e-10平方度微接缝，按实际源与serialized grid检查，未添加无实际source裁切的额外exclusion。Mawson、Dumont路由Indian Antarctic，Somov路由Indian+Pacific。Root执行`python -B -u .runtime/tmp/ocean-wave3/adopt_sources.py`（source-build.log），保留原41条supplement；源准备完成后才启动geometry。marine_runtime_tests独占既有3份marine/water目标测试，补192/185及3海上/陆地probe，禁止构建。

源准备退出0：supplement41→44，原41条逐对象完全不变；shared pre-coast150→153。Root已启动上述wave3 geometry命令，输入正式冻结，其他代理只读已完成源/日志。构建结果未经晋升前不改canonical水域文件。

第三批收尾：geometry退出0，三拓扑物理/D3和解码非水对象保留通过。base-change-scope.log仅Southern实质变化108.9971355平方度；TNO-change-scope.log仅Indian/Pacific Antarctic变化34.4311228/74.5659659平方度，来源外残差全部为实际grid宽度，未放宽生产容差。promotion.log确认8个输入身份不变、base189→192、TNO182→185、51个保护feature完全不变，只复制outputs.json的5个文件。随后唯一owner=root完成sync，9个水域分块与六场景启动依赖同步退出0。

marine-tests.log 14项、runtime-tests.log 13项、catalog-bootstrap-review-tests.log 22项均一次通过，共49项；六场景scenario-contracts.log全部OK。catalog重建672条，data-health.log退出0，保留既有12项report-only大文件提示。final-metadata.log验证全局UI尾块与本批baseline逐字一致、locale/refined/base topology output身份及两条source ledger身份正确、所有变更文件小于100MiB；快照95,449,002bytes。family-refinement.json保留97macro/17withchildren/36backlog/44terminal/3high/1low/0provenance gaps，未改terminal或压掉队列。所有root-owned进程结束，无服务器和悬置写入。本批只本地完成，无commit/push/merge/deploy或浏览器巡检。

并行研究均已交回：Davis复核、36项SeaVoX属性索引和后续构建效率研究只写runtime材料，关键结论已汇入plan.md。下一批可核查Tryoshnikova Gulf独立面及层级设计；构建效率建议尚未实施，需要同输入全量对照，不可直接复制TNO增量流程。

## 第二批执行上下文

用户要求继续推进，沿用当前工作树。Root保存首批完成态到`.runtime/tmp/ocean-wave2/baseline/`，此批不得使用173/166的旧baseline。日志归属`.runtime/reports/generated/ocean-wave2/`；拟建staging为`.runtime/tmp/ocean-wave2-stage/`。Root唯一持有正式数据构建、晋升和同步写入权。

antarctic_admission拥有`.runtime/tmp/ocean-wave2/candidates/`，从官方WFS缓存7个南极候选并给出有效性、真实交集、海上probe和裁切建议；pipeline_map只读分析极区构建契约。已有首批所有WIP保持保留。共享重建和重型测试不由子代理重复启动。

7项准入通过，无新增named海域接缝重叠。Root使用已缓存原响应与候选逐项校验（来源、名称、query、geometry与既有简化算法精确一致）后接入来源；source-build.log退出0，supplement34→41且原34条feature完全不变，shared pre-coast源143→150。正式staging命令为`python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-wave2-stage`，日志geometry.log；owner=root，成功判据exit0且三份拓扑内置物理/D3及非水对象保留校验通过。输入身份改变或校验失败则不晋升。

pipeline_map补充了global locales专用geo原文区间更新，9项夹具PASS，避免重排未涉及UI；仅改sync脚本与tests，所有权已交回。marine_runtime_tests负责既有3份marine/water测试的南极7项探针和189/182数量契约；不写正式data、不重跑共享构建。

三拓扑staging退出0。额外范围检查最初错误采用raw additional而非base实际refined输入，且使用1e-7°余量小于既有base网格[0.000140639063906,0.0000678190865962]°；因此报Southern Ocean源范围外0.001570915平方度。只读诊断证明additional再simplify(.005)与refined七面精确一致：Cooperation预处理增加0.000606479平方度、Bellingshausen增加0.000098853平方度。沿用既有source preparation契约，不更改其简化或精度。按真实输入和序列化网格核对后，范围外只余0.000089916平方度细条，按现有marine分区测试的一个grid diagonal侵蚀后面积严格0。TNO原始严格范围检查已通过。只有base Southern及TNO三个Southern sector发生>1e-8平方度变化；Ross/Weddell/Scotia变化<=1e-8。未放宽任何生产校验或现有测试容差。

Root执行wave2 promote：输入8个身份与staging一致，原ID全部保留，base182→189、TNO175→182，base31+TNO20保护feature逐对象完全不变，仅复制outputs.json列出的5个输出。随后root唯一运行sync（sync.log），并行marine/authority单测只读已冻结geometry（marine-tests.log）；这些单测不读取同步中的启动与元数据文件。其余Node/chunks及全scenario严格检查等待sync退出0。

第二批收尾：sync退出0；marine13和runtime13通过，六个scenario严格检查全OK；catalog重建与data health退出0。catalog/bootstrap/source-review首轮22项中只有旧高复杂度队列预期失败，实际新总体百分位令既有Kara Sea进入high_precision_split_candidates。根据实际报告更新测试预期至Davis Strait/AlaskaBC/Kara三项，单独重跑source-review-final.log通过，其余21项不重复。来源审核快照在family-refinement.json：94macro、17withchildren、33backlog、44terminal、3highprecision、1lowprecision/source replacement（Davis Sea）、0provenance gaps。

final-metadata.log确认全局UI尾块原文与首批baseline逐字一致、locale/source/topology output身份及ledger身份正确，所有变更文件<100MiB；source snapshot95,405,216bytes。57项不同目标测试最终通过（含代理9项sync夹具），所有root-owned进程结束，无服务器、悬置写入或待晋升staging。当前任务继续保留供后续批次；本批未提交、推送或部署。后续3项候选仅缓存，不在当前正式source/runtime计数内。

工作树：`C:/Users/raede/.codex/worktrees/ocean-batch-refinement/mapcreator`；分支：`codex/ocean-batch-refinement-20261002`；基线：`f47b36f4`。主目录已有 palette、blank_base、south_asia 等 WIP，保留原样。所有共享构建和 Git 操作由 root 负责。

2026-10-02 当前事实：base 173（水域宏区77、细区52、洋区13），TNO 166（宏区78、细区52、洋区20）。原有 SeaVoX supplement 17个命名水域+8洋区。既有来源耗尽结论仅针对已审核父级，不能代表全域完整。

代理：atlantic_candidates 与 pacific_candidates 各自只读查源；pipeline_map 只读核对写入/验证链。研究材料暂存于主工作区 `.runtime/tmp/ocean-batch-research/<region>/`；实现将在本工作树的独立归属文件进行，禁止多个代理同时覆盖生成水域文件。

Python：系统 Python312，Shapely2.1.2/GeoPandas1.1.3。node_modules 使用主目录既有依赖的 junction，不修改依赖。

## 构建与验证所有权

Owner=root，cwd=本工作树；日志 `.runtime/reports/generated/ocean-batch/`；staging `.runtime/tmp/ocean-batch-stage/`。予定命令：`python -B -u -m tools.rebuild_water_geometry --refine-marine --stage-root .runtime/tmp/ocean-batch-stage`，其后输入 SHA 身份核对、仅晋升 outputs.json 列出的文件，再运行 `python -B -u tools/sync_marine_refinement.py`。成功必须退出0且保留性/几何契约通过；失败停止晋升并查日志。所有临时产物在 `.runtime/` 内，其他代理只读已完成日志，不重复启动。

## 下一步

接收候选真实多边形证据，确定本轮可安全完成清单，分派独立实施文件。

实施分工：pipeline_map 接续拥有 `tools/sync_marine_refinement.py`、对应临时夹具测试及必要 heavy 测试登记；marine_runtime_tests 拥有三份现有 marine/water 目标测试。Root 拥有 marine_refinement.py、rebuild_water_geometry.py、回归测试 test_rebuild_water_geometry.py、所有正式生成数据与本记录。研究代理 atlantic_candidates 继续只读精查裁切分区。

源构建 owner=root：`python -B -u tools/build_marine_refinement_sources.py --refresh-missing`，日志 source-build.log。9个新源均已取到，旧快照保留；源生成完成后串行 staging。`python -B -m pytest tests/test_rebuild_water_geometry.py -q -o cache_dir=.runtime/tmp/ocean-batch/pytest-cache` 已2 passed，覆盖既有细海域在新广域面扣除前受保护。

源构建退出0：补充源25→34，原25条feature逐对象比较全部不变；共享pre-coast源143条。Root启动既定staging命令，日志geometry.log。海盆裁切按真实交集核对：当前TNO的`west_central_atlantic_ocean`竟覆盖巴拿马湾2.11994平方度，补充明确裁切该对象，避免仅按Pacific名称遗漏；这轮不重划整个宏洋分区。Davis实际只交NW Atlantic；Solomon/Bismarck交west-central Pacific。TNO缺少独立Salish海是既有差异，因此新增9个ID两端一致不等于所有命名归属完全相同。

元数据同步代理完成：5项临时夹具测试通过，未写正式数据。sync_review只读核对该脚本新字段语义与顺序，不持有任何构建进程。

staging构建退出0，三个topology几何验证及非水对象解码保留检查通过。Root的`.runtime/tmp/ocean-batch/promote.py`再次核对8个input_sha256，仅复制outputs.json列出的5个文件；base173→182且31个保护feature原样，TNO166→175且20个保护feature原样，promotion.log记录退出0。

Root当前运行`python -B -u tools/sync_marine_refinement.py`（sync.log）；独立并行只读水域源/几何单测`python -B -m unittest tests.test_marine_refinement tests.test_water_region_authority -q`（marine-tests.log），该单测不读sync正在写的metadata/startup文件。sync结束后才运行依赖chunks的Node测试与全部scenario严格契约。成功均需exit0，无条件重试禁止。

同步和验收完成：sync exit0；Python marine12、source-review1、catalog/bootstrap21、Node runtime13及全部6个scenario严格契约通过。data health exit0，仅12条大文件报告提示。后续source-review测试原来的high_precision=0断言因Davis(81,672顶点)和Alaska/BC(32,087顶点)新增而过期；改为明确断言这两个待审ID，保留44条历史terminal和26条backlog，不伪造已完成查源。

收尾修复：`_write_changed`原用通用sort/indent2写入，造成source snapshot90→338MB。代理改用现有atomic writer保留compact/pretty、键顺序和尾换行；7项夹具回归通过。Root使用`.runtime/tmp/ocean-batch/normalize_sources.py`按基线格式/键顺序重序列化5个owned数据文件，逐个断言parsed content等价；snapshot最终95,285,672bytes。locales另原样恢复未改动的UI文本块，因此仅新增9条geo翻译，diff36行。

格式更改不影响几何、分块、startup内容。只有global locales output hash需同步；root单独运行sync_shared_source_metadata并重建catalog。无需重复几何构建或6个scenario检查；收尾仅核对受影响hash及catalog一致性。所有构建/测试进程由root收尾，代理均已交接；无server或待运行代理工作。正式改动在当前工作树保留，主checkout未修改。

最终收尾完成：catalog-layout-final.log复查1项PASS；locales/refined-source manifest哈希和大小相符；snapshot为单行且所有改动文件<100MiB；最终diff --check退出0。所有root-owned进程已结束，无待晋升staging或悬置的代理写入。下一步为用户决定后续批次/提交交付范围，当前不推送、不合并、不部署。

第六批final-metadata：UI原文保留，manifest/ledger来源身份正确，37来源合同实际进入snapshot和两provenance，3 datasets齐全；snapshot96,359,732bytes，变更文件均<100MiB。audit139macro/21withchildren/78backlog/44terminal/17low/3high-split/5simplification/0provenance gaps。Oro无可用面保留拒绝状态。准确wave6 gzip增量HOI4_1939 EN85,030bytes、TNO EN87,348bytes，最终7,351,442/7,100,281bytes仍超原5MB；未重跑已确认失败的预算测试、未改预算。所有78海洋目标测试通过不等于通用预算门槛通过。本轮无commit/push/merge/deploy。

第七批root唯一准入进程：cwd独立工作树，命令python -B -u .runtime/tmp/ocean-wave7/global_admission.py，输出.runtime/tmp/ocean-wave7/global-admission，日志.runtime/reports/generated/ocean-wave7/admission.log。50候选（Atlantic20/Indian研究lane13/Pacific17）；只生成runtime试验，不写正式data。7个root采用的明确海域parent包含CapeCod→Massachusetts（官方Part of，原面互斥允许parent residual语义）；Strangford/Rhode多父与边界疑点保留独立。成功须exit0且后续D3 probes全部过；空面拒绝而不改mask。后续root唯一fullbuild仍未启动。两Sol测试子代理因capacity未启动，无文件修改；Node由原LunaDeep marine_runtime_tests接手等待最终fixture，Python回归root负责。
