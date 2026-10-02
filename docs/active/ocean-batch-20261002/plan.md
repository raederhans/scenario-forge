# 普通海洋批量细化

## 目标与范围

用户要求先研究批量推进方法，随后分派子代理快速实施。延续普通外海范围：同步基础地图与 TNO 的有来源命名海、海湾、海峡；采用 SeaVoX v19 和经过逐 ID 核验的 Marine Regions World Bay/Gulf 真实面。保留既有 ID、湖泊、TNO 地中海/Atlantropa 及非水对象；不涉及水深、发布或其他任务 WIP。

## 批次与实施顺序

1. 核对现有 173/166 个 base/TNO 水域、公开来源及完整构建链。
2. 按大西洋/美洲、印太/大洋洲划分独立来源批次；每个候选必须有真实多边形、唯一来源标识和中文名称。来源不足的候选记录延期。
3. 子代理各自交付独立候选数据和契约检查；主代理统一接入共享定义、裁切关系、来源及派生资产，串行 staging/promotion。
4. 使用目标数据和运行时检查、全部受影响 scenario 契约验证同步结果，记录实际完成批次。

## 验收

- 新面有效、非空、双语、可追溯；base/TNO 覆盖一致。
- 互斥分区、父子关系及物理岸线正确；新增几何不会造成球面反转或日期线溢出。
- 原有 ID 不删除，保护水域与非水对象保持解码几何；不以误差阈值放宽掩盖失败。
- 来源快照保持离线可重建，更新必要元数据、目录与加载资产。
- 未完成验证或无可靠面数据的候选明确保留为缺口，不计为完成。

## 风险

SeaVoX 层级索引并不等于所有地名都有独立面；公开来源可能重叠。主工作区已有无关 WIP，所有实现留在独立工作树。只由主代理运行写入型构建和共享检查。

## 第七批：三方向命名海湾扩展（2026-10-02）

三个可见研究对话交付50项原始候选，root最终准入46项World Bay/Gulf公开面；地理分布为大西洋及邻近水域20、印度洋8、太平洋18。Garretts Bight虽然由印度洋研究对话找到，实际位于塔斯马尼亚，按太平洋/Tasman路由计入。4项Paradise Creek、Bhatanro Creek、Kilifi、Anse Boileau没有可用于base/TNO共同覆盖的物理水面，未接入；Hawke来源换号后精确WFS返回空、Geelvink范围不明等继续延期。

七个海域Part of关系均由Gazetteer核实，detail采用.004度；Cape Cod→Massachusetts是语义层级，两个源面无面积交叠，不将child裁到父的残余面。Strangford Lough、Rhode Island Sound有多parent关系，暂保留独立macro。Repulse保留World图层名称并记录Gazetteer别名；Batabano规范显示名对应同一MRGID。中文均为编辑译名。

Mida、Gharo、Tudor、Korangi、Khawr al Hajar、Minnie、Ao Tang Khen、Bootless采用.0005度来源简化。原始面与简化面对比表明，前七项若用.005会丢失约20%–51%的对称差面积，Bootless约14%；细化后八项均不超过约2.6%。这是保留公开源轮廓，不表示上游测绘精度经过认证。其他macro仍.005，不改physical masks、grid或验证容差。

Hauraki合并5条同ID面，Saint Vincent合并4条，Magdalena合并15条；全部原始记录逐条验证MRGID。正式ocean routing按完整TNO loader恢复的洋区源面、source_ids union与supplement bbox逐项检查，不从父关系推测路由。Campeche同时影响NW/WestCentral Atlantic，Repulse保留NWAtlantic/WesternArctic接缝路由，其余见共同fixture。

| 区域 | 水域 | MRGID | 层级 / 来源简化度 |
| --- | --- | --- | --- |
| 大西洋及邻近水域 | 弗罗比舍湾 / Frobisher Bay | 23370 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 里帕尔斯湾 / Repulse Bay | 17823 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 韦斯特峡湾 / Vestfjorden | 18664 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 瓦朗厄尔峡湾 / Varangerfjorden | 32695 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 鲁姆斯达尔峡湾 / Romsdalsfjord | 32914 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 斯托尔峡湾 / Storfjorden | 33048 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 斯特兰福德湾 / Strangford Lough | 7932 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 科德角湾 / Cape Cod Bay | 17487 | massachusetts_bay / 0.004 |
| 大西洋及邻近水域 | 马萨诸塞湾 / Massachusetts Bay | 18882 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 纽约湾曲 / New York Bight | 24648 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 罗得岛湾 / Rhode Island Sound | 18947 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 加斯佩湾 / Gaspe Bay | 24627 | gulf_of_st_lawrence / 0.004 |
| 大西洋及邻近水域 | 坎佩切湾 / Bay of Campeche | 18005 | gulf_of_mexico / 0.004 |
| 大西洋及邻近水域 | 洪都拉斯湾 / Gulf of Honduras | 19265 | caribbean_sea / 0.004 |
| 大西洋及邻近水域 | 委内瑞拉湾 / Gulf of Venezuela | 17610 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 帕里亚湾 / Gulf of Paria | 19269 | caribbean_sea / 0.004 |
| 大西洋及邻近水域 | 乌拉巴湾 / Gulf of Uraba | 21433 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 巴塔瓦诺湾 / Gulf of Batabano | 8901 | caribbean_sea / 0.004 |
| 大西洋及邻近水域 | 大岛湾 / Bay of Ilha Grande | 19521 | 独立macro / 0.005 |
| 大西洋及邻近水域 | 瓜纳巴拉湾 / Guanabara Bay | 19046 | 独立macro / 0.005 |
| 太平洋 | 加勒特湾 / Garretts Bight | 32374 | 独立macro / 0.005 |
| 印度洋 | 米达溪 / Mida Creek | 15203 | 独立macro / 0.0005 |
| 印度洋 | 加罗溪 / Gharo Creek | 22585 | 独立macro / 0.0005 |
| 印度洋 | 都铎溪 / Tudor Creek | 20572 | 独立macro / 0.0005 |
| 印度洋 | 科兰吉溪 / Korangi Creek | 22486 | 独立macro / 0.0005 |
| 印度洋 | 哈贾尔湾 / Khawr al Hajar | 21149 | 独立macro / 0.0005 |
| 印度洋 | 米妮湾 / Minnie Bay | 22477 | 独立macro / 0.0005 |
| 印度洋 | 唐肯湾 / Ao Tang Khen | 32987 | 独立macro / 0.0005 |
| 印度洋 | 特鲁欧比什湾 / Trou-aux-Biches | 20571 | 独立macro / 0.005 |
| 太平洋 | 阿希帕拉湾 / Ahipara Bay | 32666 | 独立macro / 0.005 |
| 太平洋 | 布特利斯湾 / Bootless Inlet | 19885 | 独立macro / 0.0005 |
| 太平洋 | 丰塞卡湾 / Gulf of Fonseca | 21633 | 独立macro / 0.005 |
| 太平洋 | 豪拉基湾 / Hauraki Gulf | 16473 | 独立macro / 0.005 |
| 太平洋 | 凯马纳湾 / Kaimana Bay | 33867 | 独立macro / 0.005 |
| 太平洋 | 马格达莱纳湾 / Magdalena Bay | 18526 | 独立macro / 0.005 |
| 太平洋 | 松岛湾 / Matsushima-wan | 32777 | 独立macro / 0.005 |
| 太平洋 | 奥罗科洛湾 / Orokolo Bay | 33865 | 独立macro / 0.005 |
| 太平洋 | 佩加瑟斯湾 / Pegasus Bay | 32406 | 独立macro / 0.005 |
| 太平洋 | 圣文森特湾 / Baie de Saint-Vincent | 32395 | coral_sea / 0.004 |
| 太平洋 | 圣迭戈湾 / San Diego Bay | 19179 | 独立macro / 0.005 |
| 太平洋 | 圣莫尼卡湾 / Santa Monica Bay | 32749 | 独立macro / 0.005 |
| 太平洋 | 塞瓦斯蒂安比斯凯诺湾 / Bahía Sebastián Vizcaíno | 32393 | 独立macro / 0.005 |
| 太平洋 | 特纳卡蒂塔湾 / Bahia Tenacatita | 21526 | 独立macro / 0.005 |
| 太平洋 | 托多斯桑托斯湾 / Todos os Santos Bay | 18585 | 独立macro / 0.005 |
| 太平洋 | 托马利斯湾 / Tomales Bay | 19238 | 独立macro / 0.005 |
| 太平洋 | 旺达门湾 / Teluk Wandamen | 33449 | 独立macro / 0.005 |

原始响应、Gazetteer回执及精度/路由/准入证据保存在`.runtime/tmp/ocean-wave7/`；共同回归清单在`tests/fixtures/ocean_wave7_probes.json`。前六批73项保持原ID；本批46项以最终正式构建验证结果为完成依据，完成后累计119项。

## 第五批：北海下级命名水域（2026-10-02）

基线base201/TNO194；本批采用8个官方SeaVoX sub_region面，准确单记录响应、物理裁切和最终D3 probe全部通过后接入。全部官方level3为North Sea（23647），按现有北海detail模式使用marine_detail、明确北海parent与0.004度source/prepared精度；旧macro/ocean保持0.005。父关系负责扣除child，并不把child限制在旧父海域的残余面内。

| 水域 | MRGID | 类型 |
| --- | --- | --- |
| 多诺赫湾 / Dornoch Firth | 24186 | channel |
| 泰湾 / Firth of Tay | 24189 | channel |
| 蒂斯湾 / Tees Bay | 24190 | bay |
| 布里德灵顿湾 / Bridlington Bay | 24191 | bay |
| 韦斯特雷海峡 / Westray Firth | 24180 | channel |
| 斯特朗赛海峡 / Stronsay Firth | 24181 | channel |
| 斯卡帕湾 / Scapa Flow | 24182 | bay |
| 耶尔海峡 / Yell Sound | 24184 | channel |

“多诺赫湾”见[NC500中文路线页面](https://www.northcoast500.com/zh-CN/explore-the-route/?area=5&category=&grid=&keyword=)；“斯卡帕湾”见[海洋能海上试验场进展及其启示的中文图示](https://www.sciengine.com/parse/pdf/1002-3682/5A7915BF265247B6874B9AC2D115C692.pdf?attname=Progress+of+Marine+Energy+Test+Sites+and+Its+Inspiration.pdf)。这些是公开中文用例，未声称国家标准地名；其余六项作为编辑译名。

原面、属性、取得时间、URL及初筛在.runtime/tmp/ocean-wave5/candidates/；正式0.004预处理在selected/；物理与球面准入在global-admission/。八区与旧Moray/Forth/Pentland等细区及新兄弟之间无正面积交叠。实际TNO ocean交叠只涉及东北大西洋分区，八项使用明确相同路由；保留各地图自身物理海陆mask。

全量重建前已补齐source refresh精度、snapshot parent前缀转换、TNO spec层级及NorthSea显式父减子；不用增量重建通过来代替完整prepared链路验证。来源构建后supplement61/shared170，原53条补充feature逐对象保留；新shared NorthSea恰为旧父减新child，其余旧prepared来源几何不变。最终晋升及元数据同步已核实base209/TNO202，累计新增36项；实际通过项及两项既有startup预算缺口详见task.md。

## 第四批候选与来源判定（2026-10-02）

基线base192/TNO185。官方249条属性索引对照全部已采用ID、名称和来源记录，逐项获取八个未接入SeaVoX独立面；另复用Tryoshnikova缓存。前三批全部成果保留。候选上限9项，物理/接缝/D3准入通过后才写正式源，预期上限base201/TNO194。

| 候选 | MRGID | 类别 |
| --- | --- | --- |
| 白海 / White Sea | 24020 | sea |
| 冰岛海 / Iceland Sea | 24021 | sea |
| 林肯海 / Lincoln Sea | 24032 | sea |
| 马纳尔湾 / Gulf of Mannar | 24067 | gulf |
| 保克海峡与保克湾 / Palk Strait and Palk Bay | 24068 | strait，官方联合面只建一个ID |
| 拉卡迪乌海 / Lakshadweep Sea | 24070 | sea |
| 布兰斯菲尔德海峡 / Bransfield Strait | 24158 | strait |
| 德雷克海峡 / Drake Passage | 24160 | strait |
| 特里奥什尼科夫湾 / Tryoshnikova Gulf | 24149 | gulf |

8个新取raw面两两无正面积重叠；独立简化后Mannar/Palk与Bransfield/Drake存在细小接缝，后续明确保护较细海峡。候选与既有命名海域的原面交叠均为有限接缝，不将源码面积统计当作runtime容差。Tryoshnikova已独立通过全部物理/D3准入，与Davis来源内部不重叠；二者同属SeaVoX level1 Davis，但现有Davis24154是sub_region，不设错误parent也不扩大其footprint。

Lakshadweep与Laccadive同义由[Marine Regions IHO4269](https://www.marineregions.org/gazetteer.php?id=4269&p=details)确认；现有已采用源与runtime均无此海，NE未采用原面不另建别名ID。中文“拉卡迪乌海”引用[中科院地理所GeoDOI条目](https://www.geodoi.ac.cn/geodoi.aspx?Id=1161)。Tryoshnikova中文是参考[中国海洋大学报道](https://news.ouc.edu.cn/_t5/2025/0307/c602a118728/page.psp)人名的编辑译名，未声称官方中文地名。9项均按独立marine_macro接入，不依据名称推断parent。

候选与原始来源、取得时间及实际URL分别在`.runtime/tmp/ocean-wave4/global-candidates/`与`tryoshnikova/`；root统一标准props于`selected/`，global完整准入由root计算并保存在`global-admission/`，root独占正式生成资产。

最终9项全部准入通过；global物理计算由root接手完成。试算后所有新面与既有named内部交叠为0；各沿用base ocean/land和TNO land_mask，TNO在base ocean外的少量海岸差异不强行使用另一套mask覆盖。source/prepared/base/TNO有效、非空，8项局部D3唯一海上命中、共同陆地排除及面积方向通过；Tryosh另有独立PASS。确立7条接缝规则保护既有owner及Palk/Bransfield两条较细海峡，语义路由根据实际交叠和现有分区边界明确设置。正式清单9项，目标base201/TNO194、supplement53/shared source162。

第四批输入冻结后，独立库存核查仍发现北海下级候选：Dornoch Firth24186、Firth of Tay24189、Tees Bay24190、Bridlington Bay24191、Westray Firth24180、Stronsay Firth24181、Scapa Flow24182、Yell Sound24184。属性均带North Sea level3=23647，尚未下载几何或证明footprint/physical准入，不计入第四批数量；后续须按现有marine_detail模式明确parent。其他西苏格兰、Dutch delta、Sound Sea与Northwestern Passages线索因层级/范围身份待核验后置。详见`.runtime/tmp/ocean-wave4/next-inventory/report.md`。

## 第二批准入清单（2026-10-02，历史）

官方SeaVoX v19 WFS逐ID查询，每项返回1个有效Polygon。沿用0.005度保拓扑简化，7项均在base物理海洋及TNO自身land_mask裁切后保持有效、非空。候选21对之间、候选与现有Ross/Weddell/Scotia等命名海之间均无正面积交叠，无需新增海域接缝优先级。

| 海域 | MRGID | TNO受影响的南大洋分区 |
| --- | --- | --- |
| 里瑟-拉森海 / Riiser-Larsen Sea | 24151 | 大西洋、印度洋 |
| 合作海 / Cooperation Sea | 24153 | 印度洋 |
| 戴维斯海 / Davis Sea | 24154 | 印度洋 |
| 拉扎列夫海 / Lazarev Sea | 24150 | 大西洋 |
| 宇航员海 / Cosmonauts Sea | 24152 | 印度洋 |
| 别林斯高晋海 / Bellingshausen Sea | 24148 | 大西洋、太平洋 |
| 阿蒙森海 / Amundsen Sea | 24146 | 太平洋 |

戴维斯海与阿蒙森海填补原有命名海洋覆盖空隙，其真实来源面通过物理海洋验证；不使用旧Southern Ocean残面限制新增海域。base与TNO各沿用自己的物理岸线权威，不修改两套mask。来源：[SeaVoX v19](https://doi.org/10.14284/590)；合作海中文名采用[南方海洋实验室研究报道](https://sml-zhuhai.cn/info/351.html)。原始响应、候选及14个物理裁切面留在`.runtime/tmp/ocean-wave2/candidates/`，7个共同海上probe到边界最小距离0.58008度。单一owner生成正式数据。

## 第三批准入计划（用户已要求继续）

接续已完成的第二批base189/TNO182，仅接入以下3项经当前物理准入通过的来源，目标base192/TNO185。保留Ross既有边界归属；Davis Sea更精细来源研究独立进行，未验证的替代源不进入本批。采用与前两批相同的staging、输入身份、保护对象、实际来源/网格范围与runtime检查。

第三批准入结论：三项原始、一次简化、实际prepared以及base/TNO物理裁切面有效且非空；三组共同海上与邻近陆地D3 probes通过。Mawson prepared比一次源有3.26356e-5平方度差异，沿用现有预处理契约；Dumont/Somov差异0。三项与实际prepared命名海域无正面积重叠，因此不新增无实际裁切的exclusion；已编码Mawson/Davis和Somov/Ross微差按既有grid尺度检查。

| 海域 | 共同海上probe `[lon,lat]` | 邻近南极陆地probe |
| --- | --- | --- |
| Mawson Sea / 莫森海 | [108.887110,-65.372187] | [108.8871,-67.3722] |
| Dumont d'Urville Sea / 迪维尔海 | [144.608664,-65.495982] | [144.6087,-67.9960] |
| Somov Sea / 索莫夫海 | [161.289037,-68.067580] | [161.2890,-71.0676] |

并行Davis来源复核发现：24154原始面就是含闭合点5顶点的四边形，81 runtime顶点来自densify，顶点阈值提示不等于边界错误。未找到同footprint的更高精度替代；NE Davis是不同近似标签区域，扩张62.35321平方度并侵入Mawson26.13011平方度，不接入。官方SeaVoX `mrgid_l1='23626'`同时返回Davis Sea24154和Tryoshnikova Gulf24149；后者为独立有效面，与前者内部不重叠。共同来源分类不自动建立runtime父子关系；后续须完整physical准入并明确层级，不直接union覆盖现ID。证据位于`.runtime/tmp/ocean-wave3/davis-source-review/review.md`；本批未改terminal状态。

第三批构建期间完成36项追加海域的官方属性索引核查：249行SeaVoX v19只查询properties，36项均按MRGID各匹配1行，没有发现另一个未研究的下级候选。Tryoshnikova Gulf保留为唯一已知待准入线索；Gulf of Maine同名层级中的Bay of Fundy已接入，其余宽广洋盆祖先关系不作为child证据。详见`.runtime/tmp/ocean-wave3/next-child-candidates/report.md`。另有只读构建效率研究`.runtime/tmp/ocean-wave3/batch-efficiency-review.md`；局部重编译必须先处理完整语义分区及共享弧闭包，再与同输入全量结果核对，本批未实施或宣称提速。

第二批结束时的历史储备：Mawson Sea（24155）、Dumont d'Urville Sea（24156）、Somov Sea（24157）当时仅有独立有效MultiPolygon缓存，未计入第二批正式数量。第三批已按上文完成进一步准入并接入；前两者路由Indian Antarctic，Somov跨Indian/Pacific Antarctic，正式构建继续保护Ross既有边界。

King Haakon VII Sea本次官方WFS在sub_region、region及level_1..4均未找到记录；Gazetteer精确名称检索也未找到可用面。保留“本次未找到独立面”的限制，不以框选、猜测同义关系或重叠宏区代替真实来源。证据缓存为`.runtime/tmp/ocean-wave2/candidates/next-wave-notes.*`。

## 第一批来源记录

2026-10-02 对官方 `https://geo.vliz.be/geoserver/MarineRegions/ows` 的 `MarineRegions:seavox_v19` 执行逐 ID 查询，以下每项返回一个有效 MultiPolygon。CQL 均为 `mrgid_sr='<ID>'`；沿用 0.005 度保拓扑简化。引用：[BODC SeaVoX v19 (2023)](https://doi.org/10.14284/590)。

| 区域 | 名称 | MRGID |
| --- | --- | --- |
| 北大西洋 | Bay of Fundy / 芬迪湾 | 24045 |
| 北大西洋 | Gulf of Maine / 缅因湾 | 63491 |
| 南大西洋 | Rio de la Plata / 拉普拉塔河口 | 24038 |
| 北大西洋与北极交界 | Davis Strait / 戴维斯海峡 | 24019 |
| 东太平洋 | Gulf of Panama / 巴拿马湾 | 24104 |
| 东太平洋 | Gulf of California / 加利福尼亚湾 | 24106 |
| 东北太平洋 | Coastal Waters of Southeast Alaska and British Columbia / 阿拉斯加东南部与不列颠哥伦比亚沿岸水域 | 24117 |
| 西太平洋 | Solomon Sea / 所罗门海 | 24100 |
| 西太平洋 | Bismarck Sea / 俾斯麦海 | 24101 |

Fundy/Maine 原始面互斥。Alaska/BC 广域面必须让出 base Salish Sea；TNO 当前没有独立 Salish Sea，保持既有场景差异。Davis/Hudson、Baffin/Labrador 与 Solomon/Coral 接缝按显式所有权裁切。

后续批次：南极的 Riiser-Larsen24151、Cooperation24153、Davis24154、Lazarev24150、Cosmonauts24152、Bellingshausen24148、Amundsen24146 已发现真实面，但尚未完成极区物理水面与日期线准入；加勒比细湾/通道未找到可在本来源直接采用的独立面，继续待来源，不计作完成。

## 第六批来源与准入（2026-10-02）

用户指定印度洋、太平洋和北大西洋大幅推进。三路调查38候选，37通过共同physical岸线与D3准入；Oro Bay原面在现有两套岸线mask下均无可用水面，不接入。Papua重复、Geelvink范围/别名不确定，未进入正式候选。

北大西洋10使用SeaVoX `mrgid_sr`；印度洋及澳洲周边14、太平洋13使用World Bay/Gulf `mrgid`。后者为公开Gazetteer图层，未声明统一测绘精度或虚构版本。中文为编辑译名。Cockburn同ID两记录union，其余逐ID一记录。

| 方向 | 来源名 / 中文 | MRGID |
| --- | --- | --- |
| 北大西洋 | Kilbrannan Sound / 基尔布兰南海峡 | 24238 |
| 北大西洋 | Firth of Clyde / 克莱德湾 | 24239 |
| 北大西洋 | Inner Seas off the West Coast of Scotland / 苏格兰西岸内海 | 24234 |
| 北大西洋 | Little Minch / 小明奇海峡 | 24242 |
| 北大西洋 | Firth of Lorn / 洛恩湾 | 24240 |
| 北大西洋 | Sea of the Hebrides / 赫布里底海 | 24241 |
| 北大西洋 | Lough Foyle / 福伊尔湾 | 24235 |
| 北大西洋 | Sound of Jura / 朱拉海峡 | 24237 |
| 北大西洋 | Northern Minch / 北明奇海峡 | 24243 |
| 北大西洋 | St. Magnus Bay / 圣马格努斯湾 | 24183 |
| 印度洋及澳洲周边 | Gulf of Kutch / 卡奇湾 | 17457 |
| 印度洋及澳洲周边 | Gulf of Martaban / 莫塔马湾 | 22290 |
| 印度洋及澳洲周边 | Phang Nga Bay / 攀牙湾 | 22447 |
| 印度洋及澳洲周边 | Tambalagam Bay / 坦巴拉加姆湾 | 32543 |
| 印度洋及澳洲周边 | King Sound / 金湾 | 33014 |
| 印度洋及澳洲周边 | Cockburn Sound / 科伯恩湾 | 32380 |
| 印度洋及澳洲周边 | Spencer Gulf / 斯宾塞湾 | 17864 |
| 印度洋及澳洲周边 | Van Diemen Gulf / 范迪门湾 | 14930 |
| 印度洋及澳洲周边 | Melville Bay / 梅尔维尔湾 | 32384 |
| 印度洋及澳洲周边 | Port Darwin / 达尔文港湾 | 32868 |
| 印度洋及澳洲周边 | Champion Bay / 钱皮恩湾 | 32439 |
| 印度洋及澳洲周边 | Two people's Bay / 双人湾 | 21543 |
| 印度洋及澳洲周边 | Ambaro Bay / 安巴鲁湾 | 32959 |
| 印度洋及澳洲周边 | Tarut Bay / 塔鲁特湾 | 32980 |
| 太平洋 | Adventure Bay / 探险湾 | 32462 |
| 太平洋 | Balayan Bay / 巴拉延湾 | 32947 |
| 太平洋 | Cleveland Bay / 克利夫兰湾 | 31575 |
| 太平洋 | Corner Inlet / 科纳湾 | 32722 |
| 太平洋 | Disaster Bay / 迪萨斯特湾 | 32379 |
| 太平洋 | Enshu-nada / 远州滩 | 32816 |
| 太平洋 | Fife Bay / 法伊夫湾 | 33823 |
| 太平洋 | Halifax Bay / 哈利法克斯湾 | 32377 |
| 太平洋 | Kerema Bay / 凯雷马湾 | 33873 |
| 太平洋 | Manila Bay / 马尼拉湾 | 31579 |
| 太平洋 | Bay of Nha Trang / 芽庄湾 | 8902 |
| 太平洋 | Sagami Bay / 相模湾 | 26748 |
| 太平洋 | Tosa Bay / 土佐湾 | 15313 |

仅4组Gazetteer海域Part of作为父关系：Kutch→Arabian、Martaban→Andaman、Melville→Arafura、Tarut→Persian，采用既有detail .004精度；其余33保持独立macro/.005。行政区Part of、Adjacent to和空间相交不充当父关系。苏格兰同层分类23730/23738不等于24234/24239来源包含关系，10个原面保持独立。

新旧命名面接缝按明确所有权扣除，所有37采用显式TNO ocean路由。完整原始记录、查询回执、准入/排除与探针在`.runtime/tmp/ocean-wave6/`，正式来源和契约独立保存于data及marine_refinement.py。Tambalagam、Champion、Disaster、Fife等小湾保留面受当前物理岸线限制；不放宽mask恢复陆上原面。

源文件98条、shared207条已接入。root唯一staging已完成并通过保护性/变化范围检查，5文件晋升及sync均退出0；正式base246/TNO239、9chunks，78项目标测试及六场景strict通过。四个冻结gzip已用于准确本批增量，既有预算缺口见task.md。
