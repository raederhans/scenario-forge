# 河流扩容：完整地图验收与交互回归

本交付基于 `b416e2571c1202a4de8ac68e3869dc07c14bb352`，只固化验收工具与 E2E。
当前工作树默认仍是 wave2 的 12 父 / 43 cells。正式 pack、runtime 认证、导航、共享验证路由及 dist 由主对话整合。

## 完整地图命令

在仓库根目录执行。候选从唯一准入清单重建；不拼接区域 pack，不改源面或切分算法。

```powershell
python -X utf8 -B tools/build_river_partitions.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --selection tools/river_partitions/selections/wave3-reviewed.json `
  --include-lake-centerlines --scene-id modern_world `
  --base-commit b416e2571c1202a4de8ac68e3869dc07c14bb352 `
  --baseline-hash 7ee2527fd2eef0f5f50356a3e41089499f08c0573b642be295453389fbdc8966 `
  --max-parents 302 --compare-against data/river_partitions/modern_world_wave2.json `
  --output .runtime/river-wave4-contours/reviewed.json

python -X utf8 -B tools/river_partitions/prepare_contour_inputs.py `
  --land data/scenarios/modern_world/runtime_topology.topo.json `
  --baseline data/river_partitions/modern_world_wave2.json `
  --candidate .runtime/river-wave4-contours/reviewed.json `
  --output .runtime/river-wave4-contours/reviewed-input.json

node tools/river_partitions/verify_contours.mjs `
  --input .runtime/river-wave4-contours/reviewed-input.json `
  --baseline data/river_partitions/modern_world_wave2.json `
  --candidate .runtime/river-wave4-contours/reviewed.json `
  --output .runtime/river-wave4-contours/reviewed-contours.json
```

整合正式 pack 后，将后两条命令的 `--candidate` 改为正式资产路径，重新准备输入再验证。
输入准备复用 `build_river_partitions.decode_features`，过滤不可交互、base geography 与 `_FB_` 面，
不遗漏候选外的邻居。Shapely 独立计算每父内部 seam 期望：
`(sum(cell.boundary.length) - parent.boundary.length) / 2`，包括所有碎片及孔洞边界。
同时检查 parentGeometry 与源面精确一致、partition 的覆盖/重叠和 support 覆盖。
覆盖容差继承几何运算的 `max(1e-12, parent.area * 1e-9)`，不修改坐标。

JS 使用真实 `buildPaintContourGraph` 构建全地图 wave2 与候选 composition。
分别把各自的 cell owner 折叠为 parent，再对**两侧邻接对的并集**比较长度；增加、减少及原先不存在的边都失败。
内部 seam 对 Shapely 期望、全部 wave2 父记录及原 seam 稳定性分别检查。
`invalidRings` 必须为 0；歧义按基线比较，不要求全世界 0。
精确身份段的新增歧义另行比较位置与 owner，防止总数相同掩盖新问题；其数量必须与 runtime graph 诊断一致。
跨 LOD 的 `ambiguousQuantizedSegments` 也不能增加；本次全部来自同一 runtime topology，未执行 coarse/fine 跨 LOD 验收。

所有长度单位是**平面坐标度**，阈值 `1e-9` 度，不是米，也不证明真实河道位置或完整河流覆盖。
退出码：`0` 通过、`1` 几何/邻接验收失败、`2` 输入或执行错误。失败报告带父 ID、前后长度和差值；
无效 ring 报 offending feature ID，缺失 scope/expectation、重复 ID、pack fingerprint 错误或两步之间替换 pack 均不能通过。
输入文件记录 pack 字节 digest，用于确保 Shapely 期望与 JS 实际读取的 pack 相同。

## 本次真实候选结果

| 检查 | wave2 基线 | reviewed 候选 | 结果 |
| --- | ---: | ---: | --- |
| 可交互原始面 | 11,983 | 11,983 | 同一完整源范围；解码总面数 22,948 |
| 父 / cells | 12 / 43 | 302 / 905 | 构建 compatibilityPassed=true |
| composition 面数 | 12,014 | 12,586 | 含原始邻居和 108 support |
| 比较邻接对并集 | — | 24,201 | 无长度增减超过阈值 |
| Shapely 内部 seam | 12 父 | 302 父 | 无 mismatch |
| 原有父记录 / seam | 12 父 | 保持全部 12 父 | 无变化 |
| invalidRings | 0 | 0 | 通过 |
| ambiguousSegments | 550 | 550 | 无新增歧义位置 |

`wave3-joint.json` 仅用作必须失败的反例。把构建命令的 selection 换为 joint、`--max-parents` 换为 307，
输出改为 `.runtime/river-wave4-contours/joint.json`；后两条命令同步改用 joint 路径。
本次实际得到 307 父 / 938 cells，退出码 **1**，明确拒绝三对邻接增加：

| 邻接父 ID | 增加长度（度） |
| --- | ---: |
| CN_CITY_17275852B50201707862643 / CN_CITY_17275852B70463469741157 | 0.004221672835697853 |
| CN_CITY_17275852B68283317499250 / CN_CITY_17275852B83584927302596 | 0.06778905941734381 |
| DEA1B / NL226 | 0.032353447539548 |

这五个暂缓候选父不得加回；继承的源面重叠不能成为放过新增邻接的理由。
几何验收通过仍不解决源面重叠、河线或湖泊中心线偏差。

## 小型回归与浏览器命令

```powershell
node --test tests/river_partition_contours.test.mjs
python -X utf8 -B -m unittest tests.test_river_partition_contours -q
```

Node fixture 覆盖新增、消失、部分减少、增加邻接，内部 seam 缺失，旧父身份改变/遗漏，
继承歧义和“总数不变但位置新增”的歧义，缺失/重复/非有限输入，以及 CLI 成功/失败/字节替换退出码。
Python fixture 覆盖独立 Shapely seam（含孔洞和碎片）、覆盖缺口/重叠、源几何改变、完整交互面过滤和重复源 ID。
单测只生成小 fixture，不重建世界。
本次实际运行结果：Node **10 / 10**、Python **3 / 3** 全部通过。

浏览器只运行 `tests/e2e/river_paint.spec.js`，沿用既有 DOM。
依据 `ops/browser-mcp/inspection-profile.toml` 使用 quick 范围：localhost、独占端口、单 worker、每次聚焦运行最多 120 秒，
每轮至多 5 张辅助图；不跑全量 E2E 或 Pages 构建。
临时配置放 `.runtime`，可从下列命令直接生成，端口须先确认未被占用。

```powershell
New-Item -ItemType Directory -Force .runtime/river-wave4-contours | Out-Null
@'
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
process.env.PLAYWRIGHT_TEST_BASE_URL = 'http://127.0.0.1:8009';
module.exports = {
  testDir: path.join(root, 'tests/e2e'), testMatch: 'river_paint.spec.js',
  outputDir: path.join(root, '.runtime/tests/playwright/river-wave4-contours'),
  reporter: [['list']], retries: 0, workers: 1,
  use: { baseURL: 'http://127.0.0.1:8009', screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'off' },
  webServer: {
    command: 'python -X utf8 -B tools/dev_server.py', cwd: root,
    url: 'http://127.0.0.1:8009/app/', timeout: 60000, reuseExistingServer: false,
    env: { ...process.env, MAPCREATOR_DEV_PORT: '8009', MAPCREATOR_OPEN_BROWSER: '0',
      MAPCREATOR_RUNTIME_ROOT: path.join(root, '.runtime/river-wave4-contours/server'),
      MAPCREATOR_DEV_CACHE_MODE: 'revalidate-static' }
  }
};
'@ | Set-Content -Encoding utf8 .runtime/river-wave4-contours/playwright.config.cjs

npx playwright test --config .runtime/river-wave4-contours/playwright.config.cjs `
  --grep 'river pilot UI|native canvas' --global-timeout 120000
npx playwright test --config .runtime/river-wave4-contours/playwright.config.cjs `
  --grep 'representative river picker|historical pilot' `
  --output .runtime/tests/playwright/river-wave4-contours-picker-legacy --global-timeout 120000
```

本工作树未安装依赖；本次通过 `NODE_PATH` 只读复用既有 integration 工作树的 `node_modules`，
以该目录的 Playwright CLI 运行同一配置。工具本身不硬编码其他 checkout 路径；整合工作树可直接用本地依赖执行上述命令。

本次在 wave2 默认包上完成以下四个案例，全部通过；Canvas 案例缩小像素抽样后复测。
第一次临时配置仅设置 `baseURL`，辅助函数仍尝试默认 8810，收到 connection refused；
将 `PLAYWRIGHT_TEST_BASE_URL` 固定到独占 8009 后，以下实际行为检查才计为通过。

| 案例 | 最后一次通过耗时 | 当前证明 |
| --- | ---: | --- |
| toolbar、真实两岸点击、undo/redo、保存载入、export | 41.6 秒 | wave2 实际 app |
| 代表父、最小碎片 picker、真实 toolbar undo/redo | 48.2 秒 | wave2 实际 app |
| 代表 cells Canvas 像素与显示关闭稳定性 | 4.2 秒 | wave2 真实 Canvas，隔离 render owner |
| 两个历史包导入、工具开关、再次保存载入 | 39.3 秒 | pilot 6 / 31 与 wave2 12 / 43 原范围 |

完整地图最终命令退出码：reviewed **0**、joint **1**。
报告位于本工作树 `.runtime/river-wave4-contours/{reviewed,joint}-contours.json`；
浏览器附件位于 `.runtime/tests/playwright/river-wave4-contours/` 与 `river-wave4-contours-picker-legacy/`。
未运行 `RIVER_WAVE3_E2E=1`，不宣称扩容默认包或新搜索界面已通过真实 UI 验收。

## 整合后的验收边界

- 真实 toolbar 默认加载、固定两岸真实点击、undo/redo、保存/导入和 export 由第一个测试覆盖；规模跟随认证记录。
- Picker 按十条命名河流各一个已复核父取两个 cells，并额外选择整个活动 pack 最小 cell，
  核对完整的逐父 options、选择不写入 paint、preview 有限路径、独立颜色、真实 toolbar undo/redo 和工具关闭保色。
  当前 wave2 使用五个代表父加最小 cell。完整 905 cells 的数值与几何覆盖由非浏览器工具负责。
- Canvas 仅对代表父中面积较大的两个 cells 做真实像素和工具/河流显示关闭后的 PNG 稳定性检查。
  最小碎片可能在父级地图不可分辨；其可编辑性由真实 picker 覆盖，不能要求它在任意比例下产生一个不透明地图像素。
- 保存导入旧 pilot（6 / 31）与 wave2（12 / 43）走真实 `FileManager` 和 import funnel 认证；
  开关工具、再次保存载入后，pack ID、导航范围和颜色均须保持原范围。
- 主对话合并认证与导航后，设置 `$env:RIVER_WAVE3_E2E='1'` 并重新运行两组测试。
  此模式要求 toolbar 的活动父集合精确等于 reviewed 清单、905 cells 和全部十条河流代表父存在；
  当前 wave2 上不会误报扩容通过。不得替换 fetch 返回或修改认证白名单来让本候选通过。
- 新搜索 UI 的 selector 与筛选接口尚未在此基线落地，不猜 DOM。
  主对话需接上：分别检索十条河流/地区/父名，空结果，清空恢复，无失效 selection，以及旧保存包搜索只返回原范围。
  若搜索会改变 `#riverPaintLocationSelect` 的可见 options，先清空筛选再做全集比对；
  若导航有分页/虚拟化，将定位步骤改为正式搜索行为，并保持 options 与活动 pack 范围的等价断言。
  当前现有 select / picker 契约下的 E2E 不能冒充这些未实现搜索交互已通过。

主对话需为新增工具和两个目标测试注册共享 verification catalog / 路由；本分支没有修改 catalog、package.json、registry 或 dist。
