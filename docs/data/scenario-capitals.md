# 剧本首都核查与边界适配

本轮覆盖五个公开剧本：`blank_base`、`modern_world`、`hoi4_1936`、`hoi4_1939`、`tno_1962`。
以仓库当前国家身份和边界为准。MOD 的首都州、城市名和译名是参考依据，不能直接按相同 tag 覆盖。
首都采用稳定城市 ID；境外首都改选境内真实城市，不移动国界，也不把旧首都名字套到替代城市上。

## 可维护的来源

- `map_builder/scenario_capital_rules.py`：经过核对的首都城市及中英文名称。
- `map_builder/scenario_capital_placement.py`：按剧本实际多边形验证点位、绑定 host，以及处理有界的海岸线简化偏差。
- `map_builder/cities.py`：完整城市构建时应用相同规则。明确指定的首都不会再被另一个自动候选覆盖 hint。
- `tools/repair_scenario_capitals.py`：更新已有首都/城市资产、默认输入、公开 hints、gzip 副本和 snapshot 元数据，不修改国家或领土资产。
- 已有 `scenario_mutations.json` 中的显式首都编辑仍优先于默认数据。

维护命令：

```powershell
python tools/repair_scenario_capitals.py --scenario-id tno_1962 --dry-run
python tools/repair_scenario_capitals.py --scenario-id tno_1962
python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962 --strict
```

`--geometry-cache` 只允许只读诊断，不能用于写入；正式修复读取当前 topology。

## 本地 TNO 与原版 HOI4 依据

核对本地 Steam workshop `2438003901`（The New Order: Last Days of Europe，descriptor 1.10.0b）中的
`history/countries`、`history/states`、`localisation/english/TNO_victory_points_l_english.yml` 和
`common/scripted_effects/state_control_*_effects.txt`。
中文名称对照 workshop `2243912940` 的
`localisation/simp_chinese/TNO_victory_points_l_simp_chinese.yml`。
1936/1939 的国家历史和首都州另对照本地原版 Hearts of Iron IV；不把 1962 的名称及迁都套入这两个剧本。

例如 Germania/日耳曼尼亚使用 `VICTORY_POINTS_6521_ger`；Xinjing/新京使用
`VICTORY_POINTS_14633_man`；Kōshū/廣州使用 `VICTORY_POINTS_1047_gng_jap`。
这类剧本命名仅保存为城市覆盖，退出剧本后恢复基础名称。

标签身份例外：项目 `MAG` 是马格尼托哥尔斯克，本地新版 MOD `MAG` 是马加丹；
项目 `GUI` 是贵州，不是本地 MOD 的几内亚。`RGC` 按项目说明是四川军政监。
`KRS` 的国家名称与本轮核对的领土有差异：其当前领土位于克拉斯诺亚尔斯克，故首都落在该城，未扩展修改国家名称。

## 当前边界下的调整

TNO 归属校正后，原版首都位于本国境内的恢复原版选择；其余采用表中明确列出的境内城市。

| 剧本/政权 | 原版/参考首都 | 采用的境内城市 | 理由 |
| --- | --- | --- | --- |
| TNO JTWN | 台北 | Taihoku / 台北（`1159151567`） | 点位位于 `TWN-1166` |
| TNO JHAW | 东港（檀香山） | Tōkō / 东港（`1159151221`） | 日占时期名称；点位位于 `US_CNTY_15003` |
| TNO CRI | 狄奥多里希港 | Theoderichshafen / 狄奥多里希港（`CITY::gn::694423`） | 点位位于 `UA_RAY_74538382B3276437105714` |
| TNO BKR | 乌法 | 十月城 | 乌法未通过本轮归属门槛，斯捷尔利塔马克城区面经飞地保护留在原归属；采用境内的巴什基尔城市 |
| TNO VYT | 维亚特卡 | 维亚特卡（基洛夫） | 校正后恢复原版首都 |
| TNO WRS | 阿尔汉格尔斯克 | 阿尔汉格尔斯克 | 校正后恢复原版首都 |
| TNO GOR | 高尔基 | 雷斯科沃 | 高尔基地块未通过门槛；原适配切博克萨雷亦已位于境外 |
| TNO VOL | 沃洛格达 | 沃洛格达 | 校正后恢复原版首都 |
| TNO ALT | 奥伊罗特-图拉 | 奥伊罗特-图拉（戈尔诺-阿尔泰斯克） | 校正后恢复原版首都 |
| TNO ZLT | 兹拉托乌斯特 | 下塔吉尔 | 兹拉托乌斯特仍在境外；采用境内主要城市 |
| TNO OUR | 奥伦堡 | 伊希姆拜 | 奥伦堡属 ORN；采用境内城市 |
| TNO TOM | 托木斯克 | 托木斯克 | 校正后恢复原版首都 |
| TNO PRM | 彼尔姆 | 彼尔姆 | 校正后恢复原版首都 |
| TNO GAY | 盖内 | 切尔登 | 原零领土条目取得领土；采用境内已有聚落 |
| TNO URL | 别洛列茨克 | 别洛列茨克 | 原零领土条目取得领土，补齐原版首都 |
| TNO URA | 汉特-曼西斯克 | 佩列格列布诺耶 | 校正后原首都在境外；采用剩余领土内已有聚落 |
| TNO MGN / MAG | 马格尼托哥尔斯克 / 马加丹 | 马格尼托哥尔斯克 / 马加丹 | 旧 MAG→MGN，旧 RSF→MAG，首都分别随身份迁移 |
| TNO PRC / GUZ | 克孜勒 / 贵阳 | 克孜勒 / 贵阳 | 旧 TAN→PRC、GUI→GUZ，退役旧中国 PRC 占位 |
| TNO AMR | 结雅 | 滕达 | 新增阿穆尔身份；结雅城区面经飞地保护留在原归属，采用境内城市 |
| TNO FAV | 苏尔古特 | 苏尔古特 | 新增自由飞行员身份，首都在境内 |
| TNO NRL / OMO | 诺里尔斯克 / 奥莫隆 | 诺里尔斯克 / 奥莫隆 | 从 RFA 拆分的地理实体采用对应境内聚落 |
| TNO CLL | 通哈 | 约帕尔 | 本轮仅取得卡萨纳雷，通哈仍在境外 |
| TNO TNS | 敖德萨 | 巴尔塔 | 原版首都州为敖德萨；采用本轮获分配的境内城市 |
| TNO LAO | 万象 | 琅勃拉邦 | 万象属于 SIA，使用境内历史王都 |
| TNO XIK | 西昌 | 理塘 | 西昌属于 RGC，理塘位于 XIK 境内 |
| TNO GCE | 布里斯托尔 | 特鲁罗 | 当前只拥有康沃尔地区 |
| HOI4 MEN | 张家口 | 锡林浩特 | 张家口属于当前 CHI 领土 |

新增的小聚落只存在于对应剧本，不改写共享世界城市集。
理塘坐标来自 [GeoNames Gaocheng/Litang](https://www.geonames.org/1810604/gaocheng.html)，
经当前理塘县多边形包含检查；切尔登使用 [NOAA 的 Cherdyn 地理记录](https://www.ncei.noaa.gov/nerms/api/document/5B167FD050714B37BBCB7E3D08D8AFB4/download)
中的近似位置（60°24′N，56°31′E），位于当前 Cherdynsky District 内，位置精度为聚落级而非具体政府建筑。

## 现代首都与名称依据

现代剧本统一采用国家首都；多首都国家在当前单首都模型中选择行政首都。
香港、澳门仍沿用项目现有地区条目，标记其行政中心，不改变政治分类。
参考 [日本政府 Tokyo](https://www.japan.go.jp/japan/index.html)、
[菲律宾财政部 Manila](https://www.treasury.gov.ph/wp-content/uploads/2019/12/TAB-1-Profile.pdf)、
[南非政府的多首都说明](https://www.gov.za/south-africa-glance)、
[UN Data 的 Dodoma](https://data.un.org/en/iso/tz.html)、
[联合国统计手册的 Gitega](https://unstats.un.org/unsd/publications/pocketbook/files/world-stats-pocketbook-2024.pdf)、
[非盟驻联合国代表团的 Porto-Novo](https://unmission.au.int/docroot/en/member-states/benin)，以及
[哈萨克斯坦总统府的 Astana](https://www.akorda.kz/en/republic_of_kazakhstan/kazakhstan)。
其余点位沿用仓库 Natural Earth/GeoNames 的真实城市坐标和稳定 ID，修正从省会/人口候选中选错城市的映射。
多多马原有中文误称“松巴万加”同步纠正，内比都与阿斯塔纳采用对应中文名称。
瓜德罗普首府采用 Basse-Terre／巴斯特尔，而非 Pointe-à-Pitre，依据
[INSEE 2026 行政区划](https://www.insee.fr/fr/metadonnees/geographie/commune/97120-pointe-a-pitre)。
斯里兰卡依单一行政首都政策采用 Sri Jayawardenepura Kotte／斯里贾亚瓦德纳普拉科特，依据
[斯里兰卡外交部](https://www.mfa.gov.lk/national-profile-and-geography)。
圣皮埃尔和密克隆的首府采用 Saint-Pierre／圣皮埃尔，依据
[INSEE 行政区划](https://www.insee.fr/fr/information/7929495)，坐标来自
[GeoNames 3424934](https://www.geonames.org/3424934/saint-pierre.html)。
现代拓扑原先漏了圣皮埃尔岛，首都点距剩余领土约 9.47 km；重建器从仓库
`ne_50m_admin_0_countries.zip` 恢复该独立岛组件，并入既有 `PM` 地块。
仅补现有覆盖不足 5% 的独立组件并裁去既有世界覆盖，不扩大首都海岸内移容差。
圣赫勒拿采用 Jamestown／詹姆斯敦，依据
[圣赫勒拿政府驻地](https://www.sainthelena.gov.sh/contact/)，坐标来自
[GeoNames 3370903](https://www.geonames.org/3370903/jamestown.html)。这两座小城作为现代剧本城市补充。

现代 `HM` 没有常住居民行政首府（[澳大利亚南极局](https://www.antarctica.gov.au/antarctic-operations/stations-and-field-locations/heard-island/)）；
`IO` 行政机构位于伦敦（[领地政府](https://www.biot.gov.io/governance/)），
`TF` 行政总部位于留尼汪圣皮埃尔（[法属南方和南极领地政府](https://taaf.fr/collectivites/presentation/)）。
三者按当前“首都标记必须位于本领土内”的模型明确记录 `no_capital`，不虚构境内城市；
它表示不绘制境内首都星标，不表示这些领地没有行政管理机构。

## 历史剧本地名隔离

`scenario_capital_rules.py` 的 `REVIEWED_CITY_NAMES` 以稳定城市 ID 保存非首都历史名，
与首都规则一起由城市构建和首都修复入口应用；它不改共享现代底图，也不覆盖 TNO 的架空设定。
1936/1939 补充 Dihua／迪化、Akmolinsk／阿克莫林斯克、Alma-Ata／阿拉木图、Keijō／京城。
既有 Hsinking／新京、Taihoku／台北、Leningrad／列宁格勒、Stalingrad／斯大林格勒及
Sverdlovsk／斯维尔德洛夫斯克继续保留。Perm 在这两个年份仍为彼尔姆。

- [北京市政府城市沿革](https://www.beijing.gov.cn/renwen/sy/whkb/201907/t20190715_1866582.html)
  记载 1928 年改北平、1937 年日占当局改北京。当前两版地图的北京地块均归 CHI，
  1939 的 `1939_hebei_chahar_owner_chi` 为明确作者规则，因此均采用中华民国命名 Beiping／北平；
  本次命名修复不改变归属，也不把现实日占名称强加到该剧本地块。
- [哈萨克斯坦政府城市沿革](https://www.gov.kz/memleket/entities/vko-altay-polyanskoe/press/events/details/29850)
  说明 Akmolinsk 至 1961 年；现代使用 Astana，不将现代 Nur-Sultan 基础旧名带进历史剧本。
  [政府阿拉木图历史资料](https://kgd.gov.kz/sites/default/files/UIT/kgd-kniga60h90_posledniy_compressed.pdf)
  记录 Alma-Ata 与 Almaty 的年代变化。
- [首尔历史博物馆](https://museum.seoul.go.kr/eng/exhibition/permanent/permExhibit/permExhibit3.jsp)
  记载殖民时期 Gyeongseong；[日本国立国会图书馆 1930 年地图](https://ndlsearch.ndl.go.jp/books/R100000136-I1970023484984750979)
  标为 Keijo。两版 KOR 均为 `Government-General of Korea`、`parent_owner_tag=JAP`，故采用日方拼写 Keijō。
- 迪化于 1954 年改乌鲁木齐，见
  [新疆政府收录的城市沿革资料](https://sthjt.xinjiang.gov.cn/xjepd/hjyxpjsl/201903/9006e595669b4a0aac7654f660e1beb7/files/%E4%B9%8C%E9%B2%81%E6%9C%A8%E9%BD%90%E5%B8%82%E7%B1%B3%E4%B8%9C%E5%8C%BA%E5%A4%A7%E7%94%B0%E9%BB%84%E7%89%9B%E5%85%BB%E6%AE%96%E8%82%B2%E8%82%A5%E5%9F%BA%E5%9C%B0%E6%94%B9%E6%89%A9%E5%BB%BA%E9%A1%B9%E7%9B%AE.pdf)。
  TNO 保留自己既有的 Dihua；它采用架空年代政策，不由现实 1962 年名称反推。

TNO 另按本机模组 `2438003901/localisation/english/TNO_victory_points_l_english.yml`
核对胜利点：`7125` 基准 Keijō、朝鲜变体 Seoul；`10308` 基准 Akmola、俄方变体 Akmolinsk；
`15887` 基准 Taihoku、中国变体 Taipei。
项目 KOR 是日本附属的 `Korean Residency-General`，故城市用 Keijō／京城；
KAZ 独立，用 Akmola／阿克莫拉；台北城市宿主目前归 CHI，采用 Taipei／台北。
最后一项遵循项目现有地图归属，与原模组该州初始归 JAP 的设定有差异，不调整边界。

## 坐标和例外

- 首都 hint 和最终城市标记使用同一套位置及 host；验证要求 host 属于本国且标记位于该多边形内。
- 在海岸线简化导致原始点略落水的情况下，最多 5 km 内移；保存 `source_coordinates` 和 `coordinate_adjustment`。
- 具名例外：阿布扎比岛被粗海岸线省略，允许最多 12 km 的制图内移；澳门 passthrough 与中国粗多边形重叠，允许最多 4 km 的内移。摩纳哥亦只在自己的 passthrough 内进行最多 5 km 的制图内移。
- 真正位于外国领土内的普通城市不会通过此机制跨境移动，必须更换为经过核查的城市。
- TNO `AFA`、`RFA` 为无政府地区，`AQ` 为南极，`ATL` 为填海工程区，明确不自动选首都。
- TNO `FIC` 校正后仅余结雅区，原首都滕达在境外，现有城市数据中没有境内聚落；通过 mutations 显式标记无首都，待补充可信聚落数据。
- TNO `SPR` 当前仅拥有三个 `ATLPRV_*` 和一个 `ATLSHL_*` 填海地块，没有可信的境内聚落，标记为不分配首都；不能把马德里移到填海区。
- 无领土的释放标签不再生成额外首都星标。
- HGO 已迁至 `apps/hgo/` 独立原生像素编辑器。原始国家首都州信息可以保留，但不能等同于可靠的首都城市坐标；原生地点来自可验证的胜利点引用，不接入共底世界城市转换。旧 `hgo_1936` 开发预览与其构建器已退役。

## TNO 1962 第二批

东部行政区沿用占领期名称。阿扎瓦德原首都内马所在地块的采样份额为 0.57，保留原归属，因此采用境内基达尔；不采用原版属 HAU 的廷巴克图。毛里塔尼亚采用特拉扎州内的罗索，达荷美采用莫诺州内的洛科萨。拉多姆城区从华沙分区校正到拉多姆分区。BWA、AOF、MAL 保留边界或采样不足的地块，其首都随剩余领土调整。

| Tag | 首都 | 城市 ID | 点位地块 |
|---|---|---|---|
| OE01 | Reval / 雷瓦尔 | `CITY::ne::1159150877` | `EE001` |
| OE02 | Kauen / 考恩 | `CITY::ne::1159136375` | `LT022` |
| OE03 | Minsk / 明斯克 | `CITY::ne::1159151149` | `BY_CITY_MINSK` |
| OE04 | Pleskau / 普斯科夫 | `CITY::ne::1159149529` | `RU_RAY_50074027B86681375933080` |
| UK01 | Rowno / 罗夫诺 | `CITY::ne::1159134173` | `UA_RAY_74538382B36980255523800` |
| UK02 | Shitomir / 日托米尔 | `CITY::ne::1159149327` | `UA_RAY_74538382B57692221763967` |
| UK03 | Tschernigow / 切尔尼戈夫 | `CITY::ne::1159126717` | `UA_RAY_74538382B44220139144156` |
| UK04 | Reichenaustadt / 赖歇瑙施塔特 | `CITY::ne::1159149329` | `UA_RAY_74538382B23045356862491` |
| UK05 | Nikolajew / 尼古拉耶夫 | `CITY::ne::1159126699` | `UA_RAY_74538382B2161330582129` |
| UK06 | Melitopol / 梅利托波尔 | `CITY::ne::1159134253` | `UA_RAY_74538382B95492559683598` |
| UK07 | Charkow / 哈尔科夫 | `CITY::ne::1159149333` | `UA_RAY_74538382B36501884751905` |
| UK08 | Hughesdorf / 休斯多夫 | `CITY::ne::1159149331` | `UA_RAY_74538382B54113761495064` |
| AYR | Agadez / 阿加德兹 | `CITY::ne::1159150627` | `NE_ADM1_NER-800` |
| AZW | Kidal / 基达尔 | `CITY::gn::2455290` | `ML_ADM1_MLI-2689` |
| CHD | Moussoro / 穆索罗 | `CITY::gn::2427336` | `TD_ADM1_TCD-5581` |
| MAU | Rosso / 罗索 | `CITY::ne::1159148579` | `MR_ADM1_MRT-2788` |
| MLI | Bamako / 巴马科 | `CITY::ne::1159150945` | `ML_ADM1_MLI-2792` |
| GUI | Conakry / 科纳克里 | `CITY::ne::1159150997` | `GN_ADM1_385441B29247776226513` |
| HAU | Niamey / 尼亚美 | `CITY::ne::1159150605` | `NE_ADM1_NER-94` |
| SEN | Dakar / 达喀尔 | `CITY::ne::1159151513` | `SN_ADM1_SEN-759` |
| GHA | Accra / 阿克拉 | `CITY::ne::1159151403` | `GH_ADM1_GHA-2172` |
| DAH | Lokossa / 洛科萨 | `CITY::ne::1159120959` | `BJ_ADM1_BEN-2180` |
| BKF | Ouagadougou / 瓦加杜古 | `CITY::ne::1159151173` | `BF_ADM1_92566538B14190085014946` |
| YOR | Lagos / 拉各斯 | `CITY::ne::1159151591` | `NG_ADM1_NGA-2850` |
| SIE | Freetown / 弗里敦 | `CITY::ne::1159150625` | `SL_ADM1_SLE-761` |
| CAO | Bamenda / 巴门达 | `CITY::ne::1159150315` | `CM_ADM1_CMR-1477` |
| NRB | Kuching / 古晋 | `CITY::ne::1159149803` | `MYS-1187` |
| SHO | Shōnan / 昭南 | `CITY::ne::1159151627` | `SGP-4871` |
| MLY | George Town / 乔治市 | `CITY::ne::1159149765` | `MYS-1139` |
| UPH | Tacloban / 塔克洛班 | `CITY::ne::1159137983` | `PHL-5535` |
| SPH | Tuguegarao / 土格加劳 | `CITY::ne::1159146605` | `PHL-2545` |
| VIC | Cao Bằng / 高平 | `CITY::ne::1159113189` | `VNM-511` |
| MAL | Brunei Town / 文莱城 | `CITY::ne::1159151083` | `BN_ADM1_BRN-1182` |
| BWA | Abeokuta / 阿贝奥库塔 | `CITY::ne::1159138799` | `NG_ADM1_NGA-2852` |
| AOF | Lomé / 洛美 | `CITY::ne::1159150535` | `TG_ADM1_TGO-87` |

## TNO 第三批行政区

新增行政区以当前归属筛选，不改变俄罗斯军阀边界；用户校正到 RKO、RKU、RKM、RKK 的地块随首府区转入对应的 OE00、UK00、MS00、KC00，仍留在原行政体系内。MS06 的五块合并地块包含弗拉基米尔，采用占领期名称 Wladimir；MS02 的斯摩棱斯克点位不在本区，采用境内 Brjansk。莫桑比克作为德属东非的同级行政区 GEAM，首府为 Lourenço Marques。

名称沿用城市覆盖中的占领期名；高加索与莫斯科维恩名称核对本地 TNO 1.10.0b 的 `TNO_victory_points_l_english.yml` 和 `state_names_l_english.yml`，包括 Jekaterinodar、Wladikawkaz、Sankt Petersburg、Platenfurt、Paulusburg、Wladimir、Woronesch 和 Jaroslawl。

| Tag | 地块数 | 首府 | 城市 ID | 点位所在地块 |
| --- | ---: | --- | --- | --- |
| ALB | 21 | Tirana / 地拉那 | `CITY::ne::1159151117` | `AL022` |
| BTS | 15 | Gaborone / 加博罗内 | `CITY::ne::1159151153` | `BW_ADM1_BWA-5501` |
| CGBC | 16 | Brazzastadt / 布拉柴城 | `CITY::ne::1159150993` | `CG_ADM1_COG-4855` |
| CGGA | 9 | Freistadt / 自由城 | `CITY::ne::1159150913` | `GA_ADM1_GAB-2168` |
| CGKT | 1 | Elisabethstadt / 伊丽莎白城 | `CITY::ne::1159150903` | `CD_ADM1_COD-1897` |
| CGKV | 2 | Costermansstadt / 科斯特曼斯城 | `CITY::ne::1159148481` | `CD_ADM1_COD-1894` |
| CGUB | 12 | Bangui / 班吉 | `CITY::ne::1159151111` | `CF_ADM1_CAF-1460` |
| GEAM | 11 | Lourenço Marques / 洛伦索·马贵斯 | `CITY::ne::1159150683` | `MZ_ADM1_MOZ-5854` |
| GEAB | 17 | Usumbura / 乌松布拉 | `CITY::ne::1159150427` | `BI_ADM1_BDI-3364` |
| GEAN | 3 | Zomba / 松巴 | `CITY::ne::1159148499` | `MW_ADM1_82672581B71595037145626` |
| GEAR | 5 | Barthstadt / 巴特城 | `CITY::ne::1159149385` | `RW_ADM1_RWA-3495` |
| GEAS | 10 | Salisbury / 索尔兹伯里 | `CITY::ne::1159150573` | `ZW_ADM1_ZWE-525` |
| GEAT | 30 | Daressalam / 达累斯萨拉姆 | `CITY::ne::1159151305` | `TZ_ADM1_TZA-3378` |
| GEAU | 4 | Kampala / 坎帕拉 | `CITY::ne::1159150593` | `UG_ADM1_17295835B48340970483027` |
| GEAZ | 10 | Lusaka / 卢萨卡 | `CITY::ne::1159150571` | `ZM_ADM1_ZMB-520` |
| ICVE | 22 | Praia / 普拉亚 | `CITY::ne::1159151205` | `CV_ADM1_CPV-5053` |
| IDAL | 40 | Zara / 扎拉 | `CITY::ne::1159140367` | `HR033` |
| IDJI | 6 | Gibuti / 吉布提 | `CITY::ne::1159149869` | `DJ_ADM1_DJI-1567` |
| IERI | 6 | Asmára / 阿斯马拉 | `CITY::ne::1159150873` | `ER_ADM1_ERI-1561` |
| IGUI | 9 | Bissau / 比绍 | `CITY::ne::1159150803` | `GW_ADM1_GNB-769` |
| IKEN | 8 | Nairobi / 内罗毕 | `CITY::ne::1159151597` | `KE_ADM1_KEN-1196` |
| ISOM | 18 | Mogadiscio / 摩加迪沙 | `CITY::ne::1159150715` | `SO_ADM1_83879307B32896531038690` |
| ISTP | 2 | São Tomé / 圣多美 | `CITY::ne::1159151195` | `ST_ADM1_STP-4861` |
| ISUE | 3 | Ismailia / 伊斯梅利亚 | `CITY::ne::1159140377` | `EGY-1531` |
| ITIM | 13 | Dili / 帝力 | `CITY::ne::1159150577` | `TL_ADM1_TLS-541` |
| KC01 | 69 | Baku / 巴库 | `CITY::ne::1159151123` | `AZE-1689` |
| KC02 | 17 | Jekaterinodar / 叶卡捷琳诺达尔 | `CITY::ne::1159149549` | `RU_RAY_50074027B89252490479976` |
| KC03 | 20 | Stawropol / 斯塔夫罗波尔 | `CITY::ne::1159149523` | `RU_MRG_f01d51060a16` |
| KC04 | 37 | Wladikawkaz / 弗拉季高加索 | `CITY::ne::1159137065` | `RU_RAY_50074027B27316284331880` |
| KC05 | 21 | Elista / 埃利斯塔 | `CITY::ne::1159148145` | `RU_MRG_90d3823663be` |
| LTH | 10 | Maseru / 马塞卢 | `CITY::ne::1159150831` | `LS_ADM1_LSO-1203` |
| MS01 | 10 | Sankt Petersburg / 圣彼得堡 | `CITY::ne::1159151291` | `RU_CITY_SAINT_PETERSBURG` |
| MS02 | 9 | Brjansk / 布良斯克 | `CITY::ne::1159149531` | `RU_RAY_50074027B25563950651561` |
| MS03 | 21 | Tula / 图拉 | `CITY::ne::1159146521` | `RU_MRG_e770cd31cdb4` |
| MS04 | 21 | Woronesch / 沃罗涅日 | `CITY::ne::1159149557` | `RU_RAY_50074027B21233041988666` |
| MS05 | 9 | Jaroslawl / 雅罗斯拉夫尔 | `CITY::ne::1159149543` | `RU_RAY_50074027B57358126207690` |
| MS06 | 5 | Wladimir / 弗拉基米尔 | `CITY::ne::1159148121` | `RU_MRG_13fef5f74a14` |
| MS07 | 18 | Platenfurt / 普拉滕富特 | `CITY::ne::1159149575` | `RU_RAY_50074027B39404018386654` |
| MS08 | 36 | Paulusburg / 保卢斯堡 | `CITY::ne::1159150697` | `RU_CITY_VOLGOGRAD` |
| SWAO | 18 | Luanda / 罗安达 | `CITY::ne::1159151469` | `AO_ADM1_AGO-1880` |
| SWZ | 4 | Mbabane / 姆巴巴内 | `CITY::ne::1159149413` | `SZ_ADM1_SWZ-534` |

Zara 的基础城市点距简化海岸约 2.23 公里，首都修复按既有海岸规则吸附至 HR033 内；其余新增首府使用原始城市坐标。第三批首都修复结果 `conflicts=[]`。

## TNO 容器母国与撤回分区

RKO、RKU、RKM、RKK、GEA、GCO、AOI 保留为零领土容器，通过 parent_owner_tag 关联子区，并明确设为无首都。ANG 的剩余领土是德属西南非本体，SAF 的剩余领土是南非本体，仍保留领土与首都。PG01–PG04 的 62 块地块回归 RKP，四个分区及其首都条目退休。

容器子区：RKO → OE00–OE04；RKU → UK00–UK08；RKM → MS00–MS08；RKK → KC00–KC05；GEA → GEAB、GEAM、GEAN、GEAR、GEAS、GEAT、GEAU、GEAZ；GCO → CG00、CGBC、CGGA、CGKT、CGKV、CGUB；AOI → IDJI、IERI、IETH、IKEN、ISOM。

| Tag | 地块数 | 首府 | 城市 ID | 点位所在地块 |
| --- | ---: | --- | --- | --- |
| OE00 | 7 | Riga / 里加 | `CITY::ne::1159150811` | `LV006` |
| UK00 | 33 | Kiew / 基辅 | `CITY::ne::1159151495` | `UA_RAY_74538382B60890943260132` |
| MS00 | 25 | Moskau / 莫斯科 | `CITY::ne::1159151585` | `RU_CITY_MOSCOW` |
| KC00 | 9 | Tiflis / 第比利斯 | `CITY::ne::1159150961` | `GEO-3036` |
| GEAM | 11 | Lourenço Marques / 洛伦索·马贵斯 | `CITY::ne::1159150683` | `MZ_ADM1_MOZ-5854` |
| CG00 | 32 | Leopoldstadt / 利奥波德城 | `CITY::ne::1159151539` | `CD_ADM1_COD-1884` |
| IETH | 11 | Addis Abeba / 亚的斯亚贝巴 | `CITY::ne::1159151549` | `ET_ADM1_ETH-3133` |
