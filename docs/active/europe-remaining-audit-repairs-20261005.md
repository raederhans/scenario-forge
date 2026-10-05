# 欧洲其余区域陆地接缝审计与恢复 — 2026-10-05

本轮对西北欧、北欧与波罗的海北部、欧洲俄罗斯及北大西洋岛屿完成差集审计和来源筛选，已在独立工作区恢复 3,733 个显式缺口，涉及 1,398 个现有政治 ID，新增覆盖 29,309.0024196444 km²。54 个重建资源已接入本地 canonical，尚未提交、推送或部署。保留待调查的范围包括海岸、真实水域、缺少可靠分配依据的卢森堡邻界，以及俄罗斯城市、历史拆分和 shell helper 相关区域。

**下文区分初筛候选与最终恢复结果。** 本轮继承此前完成的共享 LOD 与 29 ID 修复，没有重做该批工作。审计基线为此前修复后的本地 `tno_1962` canonical；不代表其他剧本或线上版本已经验收。全部写入位于 `C:/Users/raede/.codex/worktrees/europe-land-gaps/mapcreator`，主 checkout 的未归属改动未被修改。

## 审计范围与统计

差集为 `land_mask - scenario_water - scenario_atlantropa - political_union`。西北欧、冰岛、法罗与欧洲俄罗斯以 0.1 km² 为报告阈值；北欧、Svalbard、Jan Mayen 原扫描阈值为 0.001 km²，下表直接筛选其中 ≥0.1 km² 项，没有重复扫描。

| 窗口，经度/纬度 | 相交政治 ID | ≥0.1 km² 差集 | 封闭分类 | 表面边界差异 | 窗口截断 | 无政治面接触 | 边界不一致对 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 西北欧：−11–8，47.5–61 | 547 | 774 | 255 | 510 | 1 | 8 | 68 |
| 冰岛：−25–−12，62–68 | 2 | 103 | 4 | 90 | 0 | 9 | 0 |
| 法罗：−8–−6，61–63 | 1 | 25 | 0 | 23 | 0 | 2 | 0 |
| 北欧及波罗的海北部：4–32，57–72 | 128 | 977 | 231 | 709 | 15 | 22 | 44 |
| Svalbard：8–36，74–81 | 9 | 177 | 9 | 160 | 0 | 8 | 0 |
| Jan Mayen：−10–−7，70–72 | 1 | 3 | 0 | 3 | 0 | 0 | 0 |
| 欧洲俄罗斯：32–60，44–72 | 1,709 | 5,399 | 5,001 | 335 | 53 | 9 | 158 |

欧洲俄罗斯另有 1 个 helper-only 边界缺口，未计入表内封闭/无接触列。各列使用审计工具的几何分诊类别，并非确认缺陷的数量。

这些窗口含邻区上下文，**计数和面积不可直接相加**：西北欧与北欧在 4–8°E、57–61°N 重叠；欧洲俄罗斯与此前东欧窗口在 32–36°E、44–57°N 重叠。西北欧南界从 47° 提高至 47.5°，避免与此前南欧 34–47.5°N 的窗口发生面积重叠。跨窗口恢复还需按实际新增几何去重，不能把每窗候选简单拼成总数。

## 差集为什么不能全部补为陆地

审计中的“封闭政治面缺口”只表示当前政治面没有覆盖该片允许面，不证明该片是陆地、不决定其历史归属，也不证明是渲染加载故障。岸线与掩膜分辨率、湖泊轮廓、源行政边界、历史裁切都可能形成差集；窗口截断项还缺少完整边界。

恢复仅使用可追溯的**同 ID 原来源独占部分**：固定现有 ID 和 `owners.by_feature.json` 中的 TNO owner，扣除真实 polygon 水域，不分配竞争来源区域，也不把未支持残余顺带补齐。`cntr_code` 是接触标签，不能替代 owner；现代国家或行政面联集覆盖只支持地表参考，不能成为剧本归属证据。例如北欧 FI/RU 候选中的多个 `RU_RAY_*` 现有 owner 仍是 `FIN`，恢复不能按现代国家代码改写这些归属。

本轮没有 buffer、make_valid、独立吸附或修改原始坐标来消除异常。差集与分区面积使用保留原顶点的测量副本，按最长 0.001° 线性加密后投影；洞面积来自局部 LAEA，部分来源恢复面积来自 EPSG3035。不同测量口径不能混加成为正式恢复面积。测量副本无效时保留 `measurement_valid=false` 与宽度 `null`，不把 `null` 当作零宽度。

## 已审阅的最小恢复范围

以下为统一生成前的来源筛选池；预计 ID 和来源支持面积用于候选审阅，最终实际结果见“正式恢复与验收”。

| 范围 | 显式候选 | 预计涉及现有 ID | 原来源独占支持 | 保护与限制 |
|---|---:|---:|---:|---|
| 北欧/波罗的海内陆 | 36 洞 | 26 | 370.136297 km² | 竞争 2.262200 km²、湖泊 1.291537 km²及未支持残余 4.318174 km²不分配 |
| 北欧窗口内纯 RU 接缝 | 103 洞 | 51 | 744.268964 km² | 从 124 洞原池继续排除跨 owner、水面、河流线与城市/helper 接触，与俄罗斯主池无重复 |
| 欧洲俄罗斯窗口内同 owner、未拆分 RU 接缝 | 3,612 洞 | 1,347 个来源 ID | 28,468.686764 km² | 排除城市、split、helper、跨 owner、缺源、海岸接触、湖泊及河流线相交项 |
| 巴塞尔邻界 CH032 / FR_ARR_68004 | 1 洞 | 来源恢复指向 CH032 | 0.149053 km² | 原洞 0.159984 km²；法国来源实质支持0，残余 0.010930 km²保留 |

北欧严格候选要求：至少两个普通互动接触 ID、完整有效同 ID 原来源、完整封闭边界、无 allowed-surface 接触，连点接触也排除。纯 RU 北欧候选应交统一范围去重，不形成另一套独立归属规则。

上述来源筛选池合计 3,752 项。统一生成前继续逐项重算局部缺口，没有直接将池数量当作最终修复数。第一轮局部保护检查排除了 18 项：2 项俄罗斯接缝与 16 项北欧接缝出现边界、窗口或接触 ID 不一致；其中 RU-00549 新增 KAZ-3201 接触，RU-02643 新增莫斯科城市接触。随后严格检查任何表面接触，又排除了 RU-03205：其与 land-mask 边界有两处点接触。因此最终固定清单为 **3,733 项**。这 19 项整洞保留供后续复查，没有调宽 bounds、面积或接触阈值，也没有按新接触对象重分归属。完整原因和原几何保存在 `spec-preflight/all-spec-guards.json` 与 `all-spec-strict-guards.json`。

欧洲俄罗斯候选还要求接触 owner 一致；原始 source guard 核对全部接触 ID 存在、未拆分、可交互并有同 ID 来源，8,489 份来源独占 addition 均有效，没有异常非接触来源支持。补查城市/helper 的任何相交后，另外剔除了 6 个仅点接触的洞。最大 addition 超出匹配原来源的残差约 1.75e−15 deg²，为明确保留的数值诊断。这个检查支持来源血缘和范围，并不认证每个旧洞的历史意图，也不证明较小未收录水体不存在。

巴塞尔候选固定 `CH032→SWI`、`FR_ARR_68004→GER`。同 ID GISCO Basel-Landschaft 支持 93.17% 的原平面面积，法国 Mulhouse master没有实质面积支持，竞争来源重叠为0。0.001°/0.0005° EPSG3035 独占测量为 0.149053271/0.149053324 km²，原几何及测量副本均有效。该洞距离最近 land-mask 边界约357 km；当前湖泊、scenario_water和已收录河流交集为0，最近已收录 Rhin约8.009 km。距离是最近经纬度边界点经本地等距投影得到的估计，足以支持内陆分类；较小未收录溪流仍未单独核对。

## 保留待调查的区域

- **卢森堡邻界**：39.416235、23.982694、14.869901 km² 三处大洞的 BE/DE GISCO、LU Natural Earth、FR arrondissement 同 ID 原来源均存在，但实质交集为0。明确区分“有来源但不支持”和“缺少来源”，不通过 `LU000` 等不同层级 ID 或现代国家联集补洞。
- **冰岛与法罗**：冰岛两处单 ID 部分支持项均接触 land-mask 真实边界与源外环，源内环接触为0，保留为岸线/掩膜 review。来源支持面积虽收敛，不能替代岸线验收。其原残余有效，投影测量副本无效，元数据与复现 fixture均保留。法罗全部为表面接触差异或无政治接触项，没有严格内陆 specs。
- **Svalbard 与 Jan Mayen**：前者大项主要为海岸差异，Norway parent参考面不能映射成现有单个岛屿 ID；后者全部 surface-boundary difference。没有新增 `NO0B2`，没有从 helper hint推导归属。
- **真实湖泊和河流**：北欧/俄罗斯审计排除了 Ilmen、Pskov、Peipus、Ladoga 等水面；Syvash提供了大面积封闭差集属于水域的反例。保护现有 global_lakes、原始 Natural Earth湖泊及 polygon河流；LineString不 buffer。欧洲俄罗斯把河流线相交项留待水面 review，不能因线本身没有面积就认定可恢复。
- **历史拆分、城市与 shell helper**：`__tno1962_*` split子面、`RU_CITY_*`、缺失原来源父级、helper接触与跨 owner边界没有自动恢复。来源支持不能解除既有历史分配约束。

## 正式恢复与验收

`repair-summary.json` 记录的最终结果如下。每组 ID 数存在交叉，合计使用去重后的 1,398 个 ID。

| 最终范围 | 显式缺口 | 本组变更 ID | 实际新增 km² | 保留残余 km² |
|---|---:|---:|---:|---:|
| 欧洲俄罗斯 | 3,609 | 1,346 | 28,450.1039182824 | 0.0003262525 |
| 北欧窗口俄罗斯补充 | 103 | 51 | 744.2689641438 | 0.0000000537 |
| 北欧/波罗的海 | 20 | 16 | 114.4804839472 | 2.6932619520 |
| 巴塞尔 | 1 | 1 | 0.1490532710 | 0.0109304083 |
| 去重合计 | **3,733** | **1,398** | **29,309.0024196444** | **2.7045186665** |

残余只针对这批选定缺口，不能理解为欧洲全部剩余差集。其中 19 个缺口仍有超过 0.00001 km² 的残余，来源未支持、竞争区域和受保护水面没有被顺带分配。

生成器将互不接触的目标分成 6 组编码，检查了 4,243 个受影响邻接对；1,416 个原有重叠对保持原状，本轮没有修复这些既有重叠。政治 ID、原属性、owner 及已有归属文件保持，未涉及的政治几何和辅助表面保持。逐 ID 原领土差异均低于 1e−12 deg² 容差，最大数值残差为 3.237047e−13 deg²；全局原领土联集缺失为空。独立面积复测采用 0.001° 与 0.0005° 加密，两者相差约 5.48 m²，支持新增面积统计的收敛性。

暂存构建及接入后的 canonical 均通过 strict 契约检查，错误、警告和 forbidden violations 均为 0。全球混合 LOD 检查使用全部原来源覆盖和 **196 个独立细节分片维度**，验证任意粗/细加载组合；原有陆地、本次新增区域和完整候选来源覆盖的缺失均为空。该结果包含全部受影响分片，不仅限于审计窗口。

本轮实际通过 51 个 Python 恢复测试（共享生成器 23 个、固定清单入口 28 个）、22 个 JS catalog/chunk 行为测试、19 个 data catalog 契约测试；`data_health` 通过，仅有既有的大文件报告提示。构建后 54 个变化或新增的引用资源已接入 canonical，逐文件与暂存构建字节一致。接入记录见 `canonical-integration.json`，旧资源备份位于 `.runtime/tmp/europe-remaining-20261005/canonical-before/`。

### 资源成本与缓存边界

以下变化以本轮开始时、已包含此前共享 LOD/29 ID 修复的资源为基线；gzip 使用 level 6 测量。

| 资源 | 本轮前 bytes | 本轮后 bytes |
|---|---:|---:|
| runtime topology | 94,510,097 | 106,610,299 |
| 政治粗层原始 JSON | 59,100,483 | 71,262,910 |
| 政治粗层 gzip | 17,876,108 | 22,108,519 |
| 全部分片 gzip 合计 | 69,115,648 | 75,489,169 |
| 政治分片 gzip 合计 | 49,114,295 | 55,487,816 |
| 英文 startup gzip | 6,534,569 | 6,534,673 |
| 中文 startup gzip | 6,534,569 | 6,534,672 |

政治细节分片由 191 个增至 196 个。粗层原始字节增加约 20.58%，gzip 增加约 23.68%，是本轮较大的资源成本。71,262,910 bytes 超过现有 64 MiB（67,108,864 bytes）软缓存保留预算；该预算不是加载硬限制，active/required/in-flight 资源允许超预算，但切换离开剧本后粗层可能被回收，回切时需要重新加载。预算未提高，本轮没有验证剧本切换的实际耗时或浏览器 FPS。

另做了保留平面几何集合的粗层精简实验：移除平面共线点只节省 288,189 bytes，仍超预算，且部分移除点尚未证明满足球面大圆边界等价；仅移除连续相同坐标没有节省。因此没有采用这些实验输出，详见 `collinear-coarse/stats.json`。

完整 runtime topology 还触及普通 Git 的交付限制：106,610,299 bytes 超过 100 MiB（104,857,600 bytes）1,752,699 bytes；当前 `.gitattributes` 未为该文件启用 LFS。[GitHub 官方文件限制](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)明确阻止超过 100 MiB 的普通 Git 文件。因此本轮本地数据验收通过不代表已可推送或上线，发布前仍需解决资产拆分或存储方式与现有加载、构建契约的兼容。

只读体积检查递归扫描全部 topology objects：211,468 个 arcs 全部被引用，没有可删除的 orphan arcs。仅合并坐标完全相同或全弧反向相同的 3,323 个重复 arcs，内存试算仍为 105,847,209 bytes，超过限制 989,609 bytes；未采用该试验输出，也未做有损简化、LFS 迁移或发布路径修改。浏览器使用的分片压缩体积不能替代 Git 对完整源文件的限制。

### 浏览器证据与交付边界

localhost 聚焦检查保留俄罗斯同视图修复前后截图 `russia-before.png` / `russia-after.png`，可见该处兜底露出得到恢复。俄罗斯及北欧两个固定探针在实际加载的运行时几何中均被目标 ID 覆盖。画布点击实际命中附近另一个 ID `RU_RAY_50074027B42300326185831`，上色生成真实历史记录，撤销后 history 回到 0、visualOverrides 清空；这证明该次附近地块的上色/撤销行为，不能证明点击命中了固定探针 ID。

浏览器报告位于 `.runtime/browser/europe-remaining-20261005/after.json`。所捕获 warn/error 日志为空，但网络/异常事件采集标记 `truncated=true`，不能据此宣称完整网络记录零错误。北欧另补充了输入结束后的 `nordic-settled.png`：可见缩放为 3676%，画面清晰且湖泊保留；`nordic-followup.json` 明确记录未检测 renderPhase。较早的 `nordic-after.png` 是缩放过程中的模糊帧，排除于最终视觉证据。整段聚焦检查超过 nominal 120 秒 quick 时间预算，没有进行全页面或性能巡检。本任务浏览器页面已关闭。

当前旧分支没有 `npm run pr:plan` 脚本，直接调用未成功。随后以当前 checkout 的 planner 注入本工作区 catalog、route 和 selector，完成只读 bridge 计划，`pr-plan-current.json` 为 `status=planned`，无覆盖缺口；这不是 npm 脚本通过、测试通过或 CI 结果。尚未提交、推送、合并或部署，线上状态未验收。

## 可复查的证据

仓库脚本：[`tools/audit_tno_east_europe_gaps.py`](../../tools/audit_tno_east_europe_gaps.py)、[`map_builder/geo/measurement.py`](../../map_builder/geo/measurement.py)。本轮统一入口复用 [`tools/repair_tno_balkan_anatolia_seams.py`](../../tools/repair_tno_balkan_anatolia_seams.py) 的显式 `build_candidate(..., specs=...)` 保护与编码流程。

以下为本地 scratch证据索引，位于 `.runtime/reports/generated/europe-remaining-20261005/`，不是随文发布的资产：

| 工作面 | 原始扫描与全量分诊 | 显式候选与来源保护 |
|---|---|---|
| 西北欧/冰岛/法罗 | `northwest/{northwest,iceland,faroes}-audit.json`、`full-source-triage.json`、`top15-interior-candidates.json` | `strict-candidate-specs.json`、`strict-candidate-payload.json`、`candidate-sources.json`、`candidate-context.json`；`measurement-anomaly.json`保留测量限制 |
| 北欧/远北岛屿 | `nordic/{nordic,svalbard,janmayen}-window.json`、`source-evidence.json`、`report.md` | `nordic-reviewed-specs.json`、`ru-nordic-reviewed-specs.json`、`rejected-spec-candidates.json` |
| 欧洲俄罗斯 | `european-russia/audit.json`、`enriched.json`、`summary.json`、`excluded.json` | `reviewed-specs.json`、`reviewed-specs-evidence.json`、`sources-map.json`、`batch-summary.json`、`source-guard.json`、`reviewed-source-exclusive-additions.geojson` |

GISCO来源以 NUTS_ID匹配现有稳定 ID，EPSG3035转4326一次；RUS来源以 `RU_RAY_ + shapeID` 匹配未拆分现有父面。完整源 URL、SHA256、byte length、源名称、现有 owner及交集几何保存在上述来源报告。RUS原始字节与 provenance缓存记录相符；GISCO固定源身份与现有来源记录相符。法国 master与Natural Earth完整 ZIP也按当前字节身份绑定。没有通过源国家名称自动重分 TNO归属。

统一入口 [`repair_tno_remaining_europe_seams.py`](../../tools/repair_tno_remaining_europe_seams.py) 与固定的 [`3,733 项清单`](../../tools/repair_specs/tno_remaining_europe_20261005.json) 同时绑定审计基线和六份原来源的完整字节。保护水域采用与清单 bounds 相交的完整原始面，不裁切湖面。原 NE 湖泊文件中两处远端坏面位于加拿大与东西伯利亚，均不与任何清单 bounds 相交；报告保留其身份、位置和无效原因。范围内任何无效水面仍会阻止生成，未使用 `make_valid` 或 `buffer`。回归测试覆盖了这个范围约束，以及同 ID、源字节变更、基线变更、竞争区域和原领土保留。

为使批量恢复可执行，共用生成器对完整 surface components 建空间索引，再对实际相交项求交；不改坐标或水面。首两处真实俄罗斯缺口及一个非空拉多加湖窗口，与旧全局求交的几何集合相等、对称差为空。代表性水域步骤由约 24–25 秒降到约 0.00004–0.00013 秒；这仅是该生成步骤的测量，不代表整批或浏览器的同比加速。另将互不接触的目标合组编码，接触或重叠的目标继续分组，最终保留全部邻接重叠与原领土检查。

最终恢复与保护检查见 `repair-report.json`、`repair-summary.json`；全球混合 LOD 见 `actual-global-mixed-lod.json`；暂存及 canonical 契约见 `staged-contracts.json`、`canonical-contracts.json`；独立面积复测见 `european-russia/final-area-and-probes.json`。浏览器截图及交互记录位于前述 browser 目录，发布状态仍为未部署。
