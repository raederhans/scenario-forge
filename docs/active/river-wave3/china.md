# Wave 3：中国长江、黄河离线候选准入报告

已实际完成新增 **175 父 / 552 分区**的离线合格清单；保留现有中国 4 父 / 8 分区，得到 **179 父 / 560 分区、11 个轮廓支持邻居**的候选包。12 父 / 65 分区待修，4 个交河父地块未形成完整切割。几何和定向轮廓检查通过，尚未授权或实施 runtime 准入。

- Worktree：`C:/Users/raede/.codex/worktrees/edea/mapcreator`
- 分支：`codex/river-wave3-china`，起点 `2da4db61c3533f621afe2be0fe6ff494d567eb92`（PR #194 合并基线）。
- 跟踪文件仅本报告和 `tools/river_partitions/selections/china.json`。生成器及原始 scenario、两个正式包、loader/manifest、registry/catalog、dist、package、共享策略收据均未修改。
- 候选、检查脚本、审计、图片均在本 worktree 的 `.runtime/river-cn/`；无浏览器、端口、全量构建、远端推送或 PR。

## 源与名称核实

从当前 `data/global_rivers.geojson` 按生成器已有 name/name_en 别名精确选择：

| 河流 | 原始 feature ID | name / name_en | 类型 |
| --- | --- | --- | --- |
| 长江 | river_1037 | Chang Jiang / Yangtze | River |
| 长江 | river_1148 | Yangtze / Yangtze | River |
| 黄河 | river_1158 | Huang / Yellow | River |
| 黄河 | river_1178 | Huang / Huang | Lake Centerline |
| 黄河 | river_1182 | Huang / Yellow | River |

保留 `--include-lake-centerlines`。其它河流仅在图片中以灰色虚线提供交汇位置背景，未参与中国候选分割。

历史 `.runtime/reports/generated/river-next/Yangtze.json` 与 `Huang.json` 来自 `river-paint-integration` worktree。当前 land、river 的源摘要、baselineHash 和选择条件逐项一致；在当前基线重新生成后，**191 个父记录与历史包对应记录完整相等**。历史76/220与115/405合计191/625，无两河父ID重复。

- landDigest：`sha256:917320332f37571d2fa1cca21881e0b5fc2cc9ede4966abe914a1e9259eabf1e`
- riverDigest：`sha256:60dbebd1fc2d4f9ba8b6d5327a99960c6bfcbe9c6df1d5d4508d0b70fa950a04`
- baselineHash：`7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966`
- Shapely 2.1.2 / GEOS 3.13.1。

## 河段与连续走廊

下表是按源线链位置分组的操作走廊，不是新的行政单位或严格水文分界。JSON记录完整的源线段方向、参考分界点、排序方法、父ID清单和待修记录；名称保留原数据英文标签，不作当前行政名称校正。按河段全范围筛查，未人为只选若干城市。

| 走廊 | 新增父 | 新增分区 | 保留父 | 待修父 |
| --- | ---: | ---: | ---: | ---: |
| 长江上游源走廊 | 25 | 65 | 1 | 0 |
| 长江中游源走廊 | 21 | 65 | 1 | 2 |
| 长江下游源走廊 | 24 | 70 | 0 | 2 |
| 黄河上游源走廊 | 41 | 162 | 2 | 5 |
| 黄河中游源走廊 | 33 | 101 | 0 | 0 |
| 黄河下游源走廊 | 31 | 89 | 0 | 3 |

源长江范围 `[103.8507, 28.6126, 119.6063, 32.2395]`；本次别名选择没有覆盖整个金沙江至上海入海口。源黄河范围 `[96.1642, 33.3332, 119.2348, 40.8797]`，湖泊中线及部分命名主线端点存在断开。本次未桥接断点、snap、补线或修源。

候选父域并集覆盖选定长江源线的89.865%、黄河源线的78.879%（源平面角长度，并非实地公里、面积或功能完成率）。未覆盖线段、未切父域和待修父域保留在证据中，不能宣称两河无缺口全覆盖。范围统计见 `corridor-coverage.json` 和 `overview.png`。

## 几何、身份、命中与轮廓证据

逐父检查保留原始 domain；面积容差沿用生成器 `max(1e-14, parentArea*1e-12)`，Hausdorff上限 `1e-9`度。没有删小片、合并跨河面、改变生成器或放宽标准。

- 广域191父：每个父的有效性、全部正面积碎片、覆盖、内部重叠、指纹、河线接缝及反向环/反向河线重生成ID检查全部通过。最大覆盖差 `1.6220748702555632e-15`度²，内部重叠均为0；接缝顶点和每条边中点至选定源河线最大距离 `1.1208811430912958e-14`度。
- 前端检查：调用真实 `normalizeRiverPartitionPack` / `verifyRiverPartitionFingerprints`，广域191父和候选179父均通过Python/JavaScript指纹核对、D3面积与有限投影路径检查。
- 候选560个Shapely严格内部点经真实D3 `geoContains` 均唯一命中所属分区。560个分区均至少存在一条同父内部轮廓arc，179个父的实际轮廓图内部总长度与Shapely共享河缝长度差均不超过 `1e-9`度。
- 以438个源面（选定父及直接接触的有效邻面）组成定向实际轮廓图，广域先暴露6条歧义边和2条共享边长度丢失。整体保留问题父为未分割源面，并重新生成支持邻居后，候选图 invalidRings=0、ambiguousSegments=0；无原父间共享边长度损失超过 `1e-9`度。未使用coarse/fine降精度补接。
- 候选11个支持邻居插入47个原边交点；有效性与不变域检查通过。最大覆盖差 `1.2669910354700352e-15`度²，最大Hausdorff差 `7.105427357601002e-15`度，均在现有ULP roundoff契约内。部分待修/未切父作为支持邻居出现，仅提供边交点，不新增可编辑分区。
- 候选739,300 bytes、17,317坐标点（含父几何、分区、支持原域及支持几何），低于现有2,000,000字符loader预算和250,000坐标点模型预算；179父、最大12cells/parent在512父/128cells上限内。

**跨父域的源重叠须单列**：广域源父间有142对正面积重叠，候选保留父间有124对。这些重叠已存在于不可修改的原scenario domain；本次每个父的分区并集完整保留原域，没有制造新的内部覆盖或内部重叠。面积PASS仅证明父内分割契约，不证明整个行政源拓扑无重叠。清单分别在 `source-overlap.json` / `inherited-overlap-candidate.json`。准入仍须由主对话判断这类继承风险是否符合产品要求。

## 待修与排除

| 源名称 | 父ID | 原分区 | 待修原因 |
| --- | --- | ---: | --- |
| Jiuzhixian | `CN_CITY_17275852B2182407224263` | 4 | 轮廓身份边出现歧义 |
| Ruoergaixian | `CN_CITY_17275852B44609154216557` | 5 | 轮廓身份边出现歧义 |
| Jianlixian | `CN_CITY_17275852B4933496009294` | 9 | 轮廓身份边出现歧义 |
| Maquxian | `CN_CITY_17275852B54456354200671` | 13 | 轮廓身份边出现歧义 |
| Jinan | `CN_CITY_17275852B57880389938199` | 3 | 原父间共享轮廓长度丢失 |
| Maanshan | `CN_CITY_17275852B68627257397845` | 2 | 轮廓身份边出现歧义 |
| Hexian | `CN_CITY_17275852B73453477463881` | 3 | 轮廓身份边出现歧义 |
| Dengkouxian | `CN_CITY_17275852B79263520770816` | 4 | 轮廓身份边出现歧义 |
| Hangjinqi | `CN_CITY_17275852B83380661850476` | 12 | 轮廓身份边出现歧义 |
| Yueyang | `CN_CITY_17275852B92071256808581` | 2 | 轮廓身份边出现歧义 |
| Qihexian | `CN_CITY_17275852B95494794157710` | 5 | 原父间共享轮廓长度丢失 |
| Jiyangxian | `CN_CITY_17275852B95991838392275` | 3 | 原父间共享轮廓长度丢失 |

歧义涉及5对父域、6条源线边；按整父暂缓，不通过删碎片解决。济南–济阳县原共享边从0.18565051237203867变成0.10790972264595147度；济南–齐河县从0.1925716915043278变成0.1665124010187841度。三父一起保留原面后丢失消失。具体边、cell ID与两次图诊断见 `ambiguous-edges.json`、`hit-contour.json` 和 `hit-contour-candidate.json`。

| 未切源名称 | 父ID | 内部悬垂线角长度 |
| --- | --- | ---: |
| Huarongxian | `CN_CITY_17275852B17844612193988` | 0.115502935154987 |
| Qumalaixian | `CN_CITY_17275852B19636254999944` | 1.00396383781643 |
| Wuhan | `CN_CITY_17275852B52250123531455` | 0.828210186763855 |
| Maduoxian | `CN_CITY_17275852B66695118162266` | 3.05864324451882 |

这些源线与父域相交但不能产生完整新face，未补接断开的命名河线。广域audit还计10965个 `excluded_auxiliary`，这是生成器扫描整个世界的辅助地理排除数，不是中国新增候选失败数；无几何rejected父。

## 新旧ID与兼容合成

新增175个父ID与正式wave2的12父ID交集为空。以下四父明确保留，与正式包完整记录相等：

| 父 | ID | cells |
| --- | --- | ---: |
| Luzhou | `CN_CITY_17275852B1441354643708` | 2 |
| Yichang | `CN_CITY_17275852B17052950603257` | 2 |
| Wuhai | `CN_CITY_17275852B72607841305823` | 2 |
| Lanzhou | `CN_CITY_17275852B84192730453130` | 2 |

中国候选packId：`sha256:4421ebe98f7bba5893f30348c6ad64ba378c3eedd1d875f6ee7c8f6087e43426`。

主对话合成时，将 `newParentIds` 与正式wave2全部12父ID取并集，河名使用正式6河，**调用原生成器共同重建父及support**。本worktree已运行这一演练：**187父/595分区/25支持邻居，855,031 bytes**；正式全部12父记录、中国全部179候选父记录完整相等，联合包187父的模型规范化、指纹、D3路径全部通过。见 `union-check.json` / `union-check.compatibility.json` / `frontend-union.json`。

不要拼接独立pack或support数组。不要替换、删除旧pilot/wave2认证项，也不要静默升级保存项目嵌入的pack。演练包仍仅在runtime；主对话负责正式新pack认证、loader/manifest、registry/catalog、按最终集成head的目标行为和必要浏览器/导出检查。本报告不声称已启用新范围或通过Canvas像素、真实picker按钮、Undo/Redo、离线导入或CI/发布验收。

## 可视叠加

已生成并实际检视15个局部面板及两河总览：

- `admitted.png`：宜宾交汇背景、绥江多次跨岸、公安河弯、铜陵碎片、达拉特长走廊、达日细片。
- `held.png`：玛多湖泊中线、武汉主线/支流交汇及源断点、玛曲和监利待修河弯、济南轮廓失败；另含府谷合格父作为细片对照。
- `micro.png`：甘德、府谷、达日最小片原始坐标局部放大；没有改变几何、面积或画出人为河宽。
- `overview.png`：绿=新增，黄=现有，红=待修。未切父域未染候选色。
- `visual-review.json`：每个面板的父ID、观察和边界。

甘德最小正面积片占原父 `1.7267164090234287e-10`，仍完整保留。数值内部点命中PASS不能证明用户在常用缩放级别能点击该极小片；原始低分辨率行政边与河线尺度不一致也会产生窄楔。叠加检查证明与供应数据相吻合，不证明真实河流精度。

## 重复生成与审计命令

从本worktree根目录执行，下列检查脚本与所有输出均保留在 `.runtime/river-cn/`。脚本只读使用共享生成器，未加入生产工具。

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python tools/build_river_partitions.py --land data/scenarios/modern_world/runtime_topology.topo.json --river Yangtze --river Huang --include-lake-centerlines --scene-id modern_world --base-commit 2da4db61c3533f621afe2be0fe6ff494d567eb92 --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 --output .runtime/river-cn/broad.json
python .runtime/river-cn/audit.py
node .runtime/river-cn/frontend.mjs .runtime/river-cn/broad.json .runtime/river-cn/frontend-broad.json
node .runtime/river-cn/hit-contour.mjs .runtime/river-cn/broad.json .runtime/river-cn/hit-contour.json
node .runtime/river-cn/ambiguous.mjs
python .runtime/river-cn/overlap.py
python .runtime/river-cn/rebuild.py
node .runtime/river-cn/frontend.mjs .runtime/river-cn/candidate.json .runtime/river-cn/frontend-candidate.json
node .runtime/river-cn/hit-contour.mjs .runtime/river-cn/candidate.json .runtime/river-cn/hit-contour-candidate.json
node .runtime/river-cn/internal_contours.mjs
python .runtime/river-cn/internal_compare.py
python .runtime/river-cn/union_check.py
node .runtime/river-cn/frontend.mjs .runtime/river-cn/union-check.json .runtime/river-cn/frontend-union.json
python .runtime/river-cn/corridor.py
python .runtime/river-cn/render.py
python .runtime/river-cn/visual_notes.py
```

生成器没有selection-file接口。干净检出仅靠两个跟踪文件复现候选时，把以下Python代码保存到 `.runtime/river-cn/rebuild.py` 后运行即可；无需复制历史候选。请保留源摘要检查，源变更须重新审计。

```python
import hashlib, json, subprocess, sys
from pathlib import Path
s = json.loads(Path('tools/river_partitions/selections/china.json').read_text(encoding='utf-8'))
src = s['source']
for pathkey, digestkey in [('landPath', 'landDigest'), ('riverPath', 'riverDigest')]:
    actual = 'sha256:' + hashlib.sha256(Path(src[pathkey]).read_bytes()).hexdigest()
    assert actual == src[digestkey], f'Source changed: {pathkey}'
args = [sys.executable, 'tools/build_river_partitions.py',
        '--land', src['landPath'], '--rivers', src['riverPath'],
        '--include-lake-centerlines', '--scene-id', s['sceneId'],
        '--base-commit', src['baseCommit'], '--baseline-hash', src['baselineHash'],
        '--max-parents', str(len(s['parentIds'])),
        '--output', '.runtime/river-cn/candidate.json']
for name in src['riverNames']:
    args += ['--river', name]
for fid in s['parentIds']:
    args += ['--parent', fid]
subprocess.run(args, check=True)
p = json.loads(Path('.runtime/river-cn/candidate.json').read_text(encoding='utf-8'))
assert p['packId'] == s['candidatePackId']
```

详细审计脚本、广域/候选/联合pack和图片是本次本地证据，不随Git提交携带。主对话可直接从上述worktree路径读取或拷贝到自己的 `.runtime/`。无需运行全项目测试、策略历史构建或Pages构建来复现这份离线选择；正式准入路径的验证由整合者按变更另行选择。

## 逐父新增准入清单

每行均通过覆盖、内部0重叠、反向ID稳定、历史记录相等、源河线接缝、前端指纹、D3路径及全部分区内部点唯一命中检查。最小片比例按源平面面积，不是地理面积。完整逐父指标在 `parent-review.json` / `geometry-audit.json`；本文与JSON以父ID作为身份。

<details>
<summary>长江上游源走廊：新增25父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Pingshanxian | `CN_CITY_17275852B27089130196720` | 6 | 0.00022762209 |
| Suijiangxian | `CN_CITY_17275852B67045134559909` | 7 | 8.3699917e-05 |
| Yibinxian | `CN_CITY_17275852B84765963113471` | 2 | 0.17703069 |
| Yibin | `CN_CITY_17275852B38780722063465` | 2 | 0.11941671 |
| Nanxixian | `CN_CITY_17275852B12709041219637` | 2 | 0.42220849 |
| Jianganxian | `CN_CITY_17275852B99445234563649` | 2 | 0.33313166 |
| Naxixian | `CN_CITY_17275852B329525942101` | 2 | 0.064184406 |
| Luxian | `CN_CITY_17275852B4573551783963` | 3 | 0.00010992491 |
| Hejiangxian | `CN_CITY_17275852B46135473164586` | 2 | 0.056634703 |
| Yongchuan | `CN_CITY_17275852B164157278498` | 2 | 0.012940167 |
| Jiangjin | `CN_CITY_17275852B88857247163357` | 4 | 1.6027728e-05 |
| Baxian | `CN_CITY_17275852B17642144241844` | 3 | 0.010649144 |
| Congqing | `CN_CITY_17275852B61145215456285` | 3 | 0.025605298 |
| Jingbeixian | `CN_CITY_17275852B97051310016142` | 3 | 0.00029512982 |
| Changshouxian | `CN_CITY_17275852B20178605301884` | 2 | 0.068241376 |
| Fuling | `CN_CITY_17275852B58072138884557` | 2 | 0.21322837 |
| Fengduxian | `CN_CITY_17275852B99042359000457` | 2 | 0.34944736 |
| Zhongxian | `CN_CITY_17275852B58286340999894` | 2 | 0.20914049 |
| Wanxian | `CN_CITY_17275852B84087342889910` | 2 | 0.49637002 |
| Yunyangxian | `CN_CITY_17275852B28870905079762` | 2 | 0.32656221 |
| Fengjiexian | `CN_CITY_17275852B75915877381439` | 2 | 0.45474109 |
| Wushanxian | `CN_CITY_17275852B70395773762989` | 2 | 0.39772074 |
| Badongxian | `CN_CITY_17275852B83270265823441` | 2 | 0.35317917 |
| Zhiguixian | `CN_CITY_17275852B36390701523517` | 2 | 0.28887158 |
| Yichangxian | `CN_CITY_17275852B18196383175490` | 2 | 0.18514048 |

</details>

<details>
<summary>长江中游源走廊：新增21父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Zhicheng | `CN_CITY_17275852B5530362994921` | 5 | 4.4003102e-06 |
| Songzixian | `CN_CITY_17275852B99938988629184` | 2 | 0.010762216 |
| Zhijiangxian | `CN_CITY_17275852B12593540550492` | 6 | 6.7212159e-05 |
| Sha | `CN_CITY_17275852B92347709937520` | 3 | 0.025629308 |
| Jianglingxian | `CN_CITY_17275852B96624470518596` | 5 | 0.00035253297 |
| Gonganxian | `CN_CITY_17275852B9048397080076` | 3 | 0.00019949582 |
| Shishou | `CN_CITY_17275852B8285619165934` | 3 | 0.0047740159 |
| Yueyangxian | `CN_CITY_17275852B44768888593389` | 5 | 0.0006569456 |
| Honghu | `CN_CITY_17275852B50342463051977` | 3 | 0.011414323 |
| Jiayuxian | `CN_CITY_17275852B32983558612198` | 3 | 0.001658313 |
| Huangpixian | `CN_CITY_17275852B68795699662733` | 2 | 0.015099196 |
| Xinzhouxian | `CN_CITY_17275852B42041968712265` | 2 | 0.051764704 |
| Ezhou | `CN_CITY_17275852B68532057450373` | 4 | 0.00029719034 |
| Huangzhou | `CN_CITY_17275852B47701832659247` | 3 | 0.0067121831 |
| Xishuixian | `CN_CITY_17275852B96835160268267` | 3 | 0.020845796 |
| Huang | `CN_CITY_17275852B56190437260016` | 2 | 0.013696287 |
| Qichunxian | `CN_CITY_17275852B69911371168899` | 3 | 0.00033427732 |
| Yangxinxian | `CN_CITY_17275852B26356208960650` | 2 | 0.00085784511 |
| Wuxue | `CN_CITY_17275852B64934349609422` | 2 | 0.14864053 |
| Huangmeixian | `CN_CITY_17275852B33652089915736` | 2 | 0.042669991 |
| Jiujianxian | `CN_CITY_17275852B69310239774277` | 2 | 0.011280607 |

</details>

<details>
<summary>长江下游源走廊：新增24父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Hukouxian | `CN_CITY_17275852B94641558554685` | 2 | 8.0223797e-05 |
| Susongxian | `CN_CITY_17275852B10535495030528` | 4 | 0.00017205871 |
| Pengzexian | `CN_CITY_17275852B45958961660036` | 3 | 0.0032565985 |
| Wangjiangxian | `CN_CITY_17275852B45581719395514` | 3 | 0.002131849 |
| Dongzhixian | `CN_CITY_17275852B3826775936083` | 5 | 5.0366125e-05 |
| Huainingxian | `CN_CITY_17275852B61181961088318` | 2 | 0.0012394798 |
| Anqing | `CN_CITY_17275852B60218719915669` | 2 | 0.066169463 |
| Guichi | `CN_CITY_17275852B61177414411617` | 5 | 0.00038643181 |
| Zongyangxian | `CN_CITY_17275852B42898496791559` | 4 | 1.0871881e-05 |
| Tongling | `CN_CITY_17275852B71871830431018` | 2 | 0.18615752 |
| Tonglingxian | `CN_CITY_17275852B91286509256855` | 4 | 4.2602932e-06 |
| Wuweixian | `CN_CITY_17275852B23039937395207` | 6 | 2.4453649e-06 |
| Fanchangxian | `CN_CITY_17275852B55776769429507` | 4 | 1.7711198e-06 |
| Wuhuxian | `CN_CITY_17275852B43099606090633` | 2 | 0.0039650371 |
| Wuhu | `CN_CITY_17275852B36737936197596` | 3 | 0.0011557215 |
| Dangtuxian | `CN_CITY_17275852B29905847665822` | 2 | 0.033162595 |
| Jiangpuxian | `CN_CITY_17275852B53672972261894` | 2 | 0.03293042 |
| Nanjing | `CN_CITY_17275852B45149819427590` | 3 | 0.011626654 |
| Liuhexian | `CN_CITY_17275852B59333965008283` | 2 | 0.0091291311 |
| Yizheng | `CN_CITY_17275852B5377550731757` | 2 | 0.0013616096 |
| Jurongxian | `CN_CITY_17275852B49737651735743` | 2 | 0.0045169739 |
| Yangzhou | `CN_CITY_17275852B89230401808313` | 2 | 0.006192194 |
| Dantuxian | `CN_CITY_17275852B56383642585283` | 2 | 0.018633747 |
| Zhenjiang | `CN_CITY_17275852B19859477737164` | 2 | 0.097803457 |

</details>

<details>
<summary>黄河上游源走廊：新增41父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Darixian | `CN_CITY_17275852B28481452848090` | 7 | 5.1569974e-08 |
| Gandexian | `CN_CITY_17275852B1787117911325` | 6 | 1.7267164e-10 |
| Abaxian | `CN_CITY_17275852B47014980073641` | 2 | 0.0065262684 |
| Maqinxian | `CN_CITY_17275852B82919928587081` | 5 | 0.00044066785 |
| Banmaxian | `CN_CITY_17275852B99290886399570` | 5 | 0.00047982637 |
| Tongdexian | `CN_CITY_17275852B73285144447377` | 5 | 0.00033609677 |
| Xinghaixian | `CN_CITY_17275852B81098989654744` | 4 | 0.0043144028 |
| Guinanxian | `CN_CITY_17275852B54009314236158` | 4 | 1.668988e-05 |
| Gonghexian | `CN_CITY_17275852B58957248362912` | 5 | 0.00055360673 |
| Guidexian | `CN_CITY_17275852B8640595389907` | 2 | 0.37351026 |
| Jianzhaxian | `CN_CITY_17275852B71786988816730` | 5 | 0.0023569755 |
| Hualonghuizuzizhixian | `CN_CITY_17275852B64856383532767` | 7 | 0.0013324672 |
| Xunhuasalazuzizhixian | `CN_CITY_17275852B74412727274506` | 3 | 4.3430012e-05 |
| Minhehuizutuzuzizhixian | `CN_CITY_17275852B36383935837338` | 2 | 0.010146378 |
| Jishanbaoanzudongxiangzusalazuzizhixian | `CN_CITY_17275852B93202836369350` | 4 | 5.8517401e-05 |
| Dongxiangzuzizhixian | `CN_CITY_17275852B95018063436847` | 3 | 0.0022025641 |
| Yongjingxian | `CN_CITY_17275852B84815587420543` | 5 | 1.9721839e-05 |
| Gaolanxian | `CN_CITY_17275852B33312172242221` | 2 | 0.082691598 |
| Yuzhongxian | `CN_CITY_17275852B10936165440282` | 2 | 0.00054795963 |
| Baiyin | `CN_CITY_17275852B23253159048949` | 3 | 0.0037813485 |
| Jingyuanxian | `CN_CITY_17275852B29220754353225` | 5 | 0.00031326505 |
| Jingtaixian | `CN_CITY_17275852B76908318938169` | 5 | 0.00014112373 |
| Zhongweixian | `CN_CITY_17275852B52118529676113` | 2 | 0.32836092 |
| Zhongningxian | `CN_CITY_17275852B78958916655376` | 2 | 0.33957382 |
| Qingtongxia | `CN_CITY_17275852B20312470606875` | 2 | 0.23682051 |
| Wuzhong | `CN_CITY_17275852B62782445600014` | 2 | 0.07545899 |
| Yongningxian | `CN_CITY_17275852B80477376222606` | 2 | 0.0075051701 |
| Lingwuxian | `CN_CITY_17275852B89567569086781` | 3 | 0.00050252134 |
| Helanxian | `CN_CITY_17275852B1612458148205` | 2 | 0.007000401 |
| Taolexian | `CN_CITY_17275852B32909465051494` | 5 | 0.0027682998 |
| Pingluoxian | `CN_CITY_17275852B21760145017790` | 3 | 2.5460665e-05 |
| Ertuokeqi | `CN_CITY_17275852B56784937332062` | 4 | 0.00012370411 |
| Alashanzuoqi | `CN_CITY_17275852B45855584289295` | 2 | 2.5314293e-05 |
| Hangjinhouqi | `CN_CITY_17275852B6563591332882` | 2 | 0.0014656172 |
| Linhe | `CN_CITY_17275852B45264822840629` | 4 | 0.00067362198 |
| Wuyuanxian | `CN_CITY_17275852B4230864536687` | 3 | 0.004138252 |
| Wulateqianqi | `CN_CITY_17275852B50024648693467` | 6 | 5.8995779e-06 |
| Dalateqi | `CN_CITY_17275852B68283317499250` | 12 | 1.7378224e-06 |
| Baotou | `CN_CITY_17275852B83584927302596` | 7 | 0.00029627577 |
| Tumuteyouqi | `CN_CITY_17275852B27242410268573` | 6 | 0.0002447455 |
| Tuoketuoqi | `CN_CITY_17275852B20617662043886` | 2 | 0.064865992 |

</details>

<details>
<summary>黄河中游源走廊：新增33父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Qingshuihexian | `CN_CITY_17275852B631335600884` | 2 | 0.049207093 |
| Zungeerqi | `CN_CITY_17275852B50201707862643` | 7 | 5.3322383e-05 |
| Pianguanxian | `CN_CITY_17275852B71449682154252` | 3 | 0.00037504843 |
| Hequxian | `CN_CITY_17275852B70463469741157` | 5 | 0.00027485431 |
| Fuguxian | `CN_CITY_17275852B92543718728466` | 6 | 8.3468085e-09 |
| Baodexian | `CN_CITY_17275852B54112477188231` | 4 | 0.0028270715 |
| Xingxian | `CN_CITY_17275852B28437543476073` | 5 | 0.00080596968 |
| Shenmuxian | `CN_CITY_17275852B71560826208449` | 5 | 6.9195263e-06 |
| Linxian | `CN_CITY_17275852B48866302661843` | 3 | 0.010372624 |
| Jiaxian | `CN_CITY_17275852B2823373927353` | 3 | 1.9910185e-05 |
| Wubaoxian | `CN_CITY_17275852B32624511377382` | 2 | 0.027544695 |
| Liulinxian | `CN_CITY_17275852B57555767391170` | 3 | 0.012548009 |
| Suidexian | `CN_CITY_17275852B75774687226557` | 2 | 0.0002472645 |
| Qingjianxian | `CN_CITY_17275852B50263043640706` | 3 | 0.0045621398 |
| Shilouxian | `CN_CITY_17275852B48166439477713` | 3 | 0.0036626144 |
| Yonghexian | `CN_CITY_17275852B40151722514837` | 3 | 0.049650158 |
| Yanchuanxian | `CN_CITY_17275852B12112577569162` | 2 | 0.0012559182 |
| Dalingxian | `CN_CITY_17275852B94478932575643` | 2 | 0.091757027 |
| Jixian | `CN_CITY_17275852B76734754019055` | 2 | 0.099345324 |
| Xiangningxian | `CN_CITY_17275852B47232398571035` | 2 | 0.041472332 |
| Hejinxian | `CN_CITY_17275852B3102860165847` | 2 | 0.19716185 |
| Wanrongxian | `CN_CITY_17275852B27489011003174` | 2 | 0.085278919 |
| Linqixian | `CN_CITY_17275852B74769488565977` | 2 | 0.015021943 |
| Heyangxian | `CN_CITY_17275852B25141942167639` | 2 | 0.0072022775 |
| Yongji | `CN_CITY_17275852B21670105101896` | 3 | 0.0038121478 |
| Dalixian | `CN_CITY_17275852B10026721053834` | 2 | 0.003791498 |
| Yunchengxian | `CN_CITY_17275852B59649283070943` | 6 | 0.015995372 |
| Lingbao | `CN_CITY_17275852B10682420809377` | 4 | 6.0885064e-07 |
| Pingluxian | `CN_CITY_17275852B99867509318297` | 2 | 0.12542215 |
| Mianchixian | `CN_CITY_17275852B42949182938993` | 3 | 0.00038117622 |
| Xiaxian | `CN_CITY_17275852B28146064538496` | 2 | 0.0087973485 |
| Yuanquxian | `CN_CITY_17275852B69361090867285` | 2 | 0.032774376 |
| Jiyuan | `CN_CITY_17275852B15977137196263` | 2 | 0.055544039 |

</details>

<details>
<summary>黄河下游源走廊：新增31父</summary>

| 源名称 | 父ID | cells | 最小片比例 |
| --- | --- | ---: | ---: |
| Mengxian | `CN_CITY_17275852B91559349232276` | 2 | 0.027069654 |
| Gongxian | `CN_CITY_17275852B75567917484769` | 2 | 0.0018617473 |
| Wenxian | `CN_CITY_17275852B57128594064202` | 3 | 0.0086505587 |
| Xingyangxian | `CN_CITY_17275852B37762337287015` | 2 | 0.0051574505 |
| Wuxian | `CN_CITY_17275852B91173560245297` | 2 | 0.093767084 |
| Zhengzhou | `CN_CITY_17275852B14866353147502` | 3 | 0.00010898511 |
| Zhongmouxian | `CN_CITY_17275852B36068725262944` | 3 | 0.0016115159 |
| Yuanyang | `CN_CITY_17275852B10417338286601` | 5 | 0.00069521006 |
| Fengqiuxian | `CN_CITY_17275852B94560918292835` | 2 | 0.076963478 |
| Lankaoxian | `CN_CITY_17275852B8527290020627` | 2 | 0.019520357 |
| Changyuanxian | `CN_CITY_17275852B42868481826233` | 2 | 0.0013200542 |
| Dongmingxian | `CN_CITY_17275852B55229175832107` | 2 | 0.072956301 |
| Hezhe | `CN_CITY_17275852B17983837223036` | 2 | 0.012583009 |
| Puyangxian | `CN_CITY_17275852B95987945429206` | 4 | 0.00014442181 |
| Zhenchengxian | `CN_CITY_17275852B53595443021236` | 4 | 0.012018654 |
| Fanxian | `CN_CITY_17275852B65261927384665` | 4 | 0.00081165625 |
| Yunchengxian | `CN_CITY_17275852B88468623491072` | 3 | 0.00039635598 |
| Taiqianxian | `CN_CITY_17275852B97099342637573` | 3 | 0.013500986 |
| Liangshanxian | `CN_CITY_17275852B24042887765568` | 3 | 0.021063311 |
| Dongerxian | `CN_CITY_17275852B4676676622807` | 3 | 0.0053118121 |
| Pingyinxian | `CN_CITY_17275852B43935412530745` | 3 | 9.288261e-05 |
| Changqingxian | `CN_CITY_17275852B32700744588338` | 4 | 0.0011532099 |
| Zhangqiu | `CN_CITY_17275852B86044803614271` | 2 | 0.020645879 |
| Zhoupingxian | `CN_CITY_17275852B4626184751480` | 2 | 0.0098184389 |
| Huiminxian | `CN_CITY_17275852B26908210835070` | 3 | 0.00010321322 |
| Gaoqingxian | `CN_CITY_17275852B90661382406168` | 3 | 0.0096706275 |
| Binzhou | `CN_CITY_17275852B43701500747082` | 4 | 0.0023501847 |
| Boxingxian | `CN_CITY_17275852B56050378995261` | 3 | 8.9632217e-05 |
| Kenlixian | `CN_CITY_17275852B44568429811369` | 4 | 0.00074640625 |
| Lijinxian | `CN_CITY_17275852B71120154646141` | 3 | 0.00025426909 |
| Dongying | `CN_CITY_17275852B11809724506440` | 2 | 0.023992347 |

</details>
