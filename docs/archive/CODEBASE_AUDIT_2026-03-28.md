# Map Creator 全库宏观审计

日期：2026-03-28

## 1. 仓库现状摘要

这个仓库当前不是单一类型项目，而是四类东西叠在一起：

- 静态前端应用：`index.html` + `js/` + `css/`
- Python 数据构建链：`init_map_data.py`、`map_builder/`、`scenario_builder/`、`tools/`
- 本地开发后端：`tools/dev_server.py`
- 真实运行资产与构建产物：`data/`

从 Git 已跟踪文件体积分布看，仓库主体已经明显偏向“代码 + 大量资产”的混合形态，而不是普通源码仓库：

| 顶层路径 | 约体积 |
| --- | ---: |
| `data/` | 656.86 MB |
| `qa/` | 10.28 MB |
| `js/` | 2.44 MB |
| `tools/` | 1.03 MB |
| `map_builder/` | 0.33 MB |
| `tests/` | 0.34 MB |

其中 `data/` 共有 `613` 个已跟踪文件，已经远大于代码本体的体积。这说明这个仓库的核心工程问题，不会只是“某个函数写得差”，而更可能是资产边界、职责边界和验证边界没有被正式建模。

当前显式入口如下：

- 开发启动：`start_dev.bat`（现统一承载 full / fast / fresh 模式）、`run_server.bat`
- 数据构建：`init_map_data.py`
- 前端回归：`package.json` 中的 Playwright 脚本
- GitHub Pages 发布：`.github/workflows/deploy.yml`

## 2. 审计方法与证据范围

本次审计只做只读检查，不改代码、不移动文件、不清理产物。证据来源包括：

- 本地仓库代码与目录结构
- 实际命令执行结果
- 现有测试与运行产物
- 官方文档

本次已经实际完成的关键验证包括：

```text
python -m unittest discover -s tests -q
=> Ran 81 tests in 24.800s
=> OK

npm run test:e2e -- --list
=> Total: 36 tests in 18 files

npm run test:e2e -- tests/e2e/main_shell_i18n.spec.js
=> 失败
=> page.goto("http://127.0.0.1:8003/") 超时
=> trace 写入 .runtime/tests/playwright/...
```

本次还确认了 `.runtime/dev/active_server.json` 当前记录为：

```json
{
  "url": "http://127.0.0.1:8003",
  "pid": 39228,
  "open_path": "/--help"
}
```

随后校验到：

```text
pid_alive False
url http://127.0.0.1:8003
open_path /--help
```

这说明当前开发服务器元数据可以陈旧，而且没有被统一做活性校验。

## 3. 已证实事实

### 3.1 前端结构明显超重

关键前端文件当前规模如下：

| 文件 | 行数 |
| --- | ---: |
| `js/core/map_renderer.js` | 18577 |
| `js/ui/sidebar.js` | 8613 |
| `js/ui/toolbar.js` | 4373 |
| `js/core/scenario_manager.js` | 4333 |
| `js/main.js` | 1692 |
| `js/core/state.js` | 1596 |

`js/core/state.js` 中导出的 `state` 对象本体约 `738` 行，约 `679` 个顶层字段。

五个核心前端文件中的 `state.` 直接访问次数如下：

| 文件 | `state.` 次数 |
| --- | ---: |
| `js/core/map_renderer.js` | 2274 |
| `js/ui/sidebar.js` | 733 |
| `js/ui/toolbar.js` | 734 |
| `js/core/scenario_manager.js` | 839 |
| `js/main.js` | 392 |

合计约 `4409` 次。

这已经足够说明：当前前端不是通过清晰接口协作，而是多个子系统直接共享并修改同一块运行态。

### 3.2 Python 构建链是“超级总控入口”

关键 Python 文件当前规模如下：

| 文件 | 行数 |
| --- | ---: |
| `init_map_data.py` | 3723 |
| `tools/dev_server.py` | 2349 |
| `tools/patch_tno_1962_bundle.py` | 8685 |

从代码路径看：

- `init_map_data.py` 不只是“启动构建”，而是同时知道 primary/detail/i18n/palette/scenario 产物如何生成和串联。
- `tools/dev_server.py` 不只是“本地静态服务”，而是静态服务、场景写入、规则保存、本地后端都在一个文件内。
- `tools/patch_tno_1962_bundle.py` 已经承担 checkpoint、publish、manual drift、runtime topology 等平台级职责。

这三处都表现出同一种问题：入口本应负责编排，但现在同时知道了太多子系统细节。

### 3.3 `data/` 的生命周期边界不清

仓库当前把多种生命周期不同的内容同时放在 `data/` 下：

- 规则源
- 下载来的原始资产
- 可重建中间产物
- 运行时直接消费的产物
- 场景专用的手工覆盖与发布物

这不是抽象层面的担忧，而是目录事实：

- `data/` 下同时存在 `geoBoundaries-*.geojson`、`*.zip`、`*.shp` 这类原始/半原始资产
- 同时存在 `europe_topology*.json`、`runtime_topology*.json`、`*.internal.phase1.*` 这类派生产物
- 同时存在 `data/scenario-rules/*.manual.json`、`data/scenarios/*/scenario_manual_overrides.json` 等人工规则文件

这意味着仓库当前没有清楚回答这三个问题：

1. 哪些文件是权威输入？
2. 哪些文件只是可重建输出？
3. 哪些文件必须入库，哪些只应该作为运行时或发布物存在？

### 3.4 测试存在，但默认验证链失真

Python 侧：

- 仓库里有真实单测。
- `python -m unittest discover -s tests -q` 已跑通 `81` 项。
- 但 `README.md` 没有把 Python 单测作为显式入口写清楚。
- 当前默认 `python -m pytest tests -q` 在默认环境下直接失败，因为没有 `pytest`。

前端 E2E 侧：

- Playwright 已经有 `36` 个用例，说明不是没有回归意识。
- 但基础 URL 解析逻辑是分散的，不同 spec 自己维护。
- `tests/e2e/tno_1962_ui_smoke.spec.js` 自己做了候选 URL 探测和回退。
- `tests/e2e/main_shell_i18n.spec.js` 直接信任 `.runtime/dev/active_server.json`。
- 当元数据陈旧时，后者会被死地址带偏，导致和业务无关的失败。

### 3.5 当前 CI 没有把“验证链”放在发布前

`.github/workflows/deploy.yml` 当前流程只有：

1. `pip install -r requirements.txt`
2. `python init_map_data.py`
3. `actions/configure-pages`
4. `actions/upload-pages-artifact`，路径为 `.`
5. `actions/deploy-pages`

它没有显式运行：

- Python 单测
- Playwright 回归
- 任何独立的构建契约检查

这意味着当前发布链把“能生成产物”看得比“产物是否通过基本验证”更重要。

### 3.6 编码约定存在工具链不一致

本次审计中，同一批文档在默认 PowerShell 输出里出现过中文乱码，但在显式 `-Encoding utf8` 读取时恢复正常，例如：

- `docs/PERF_RENDER_INTERACTION_2026-02-24.md`
- `ops/browser-mcp/inspection-profile.toml`

因此，当前更准确的结论不是“文档文件本身已损坏”，而是：

- 仓库中至少有一部分文档/配置依赖隐式 UTF-8 约定
- 默认读取链路并不总是按 UTF-8 处理
- 这会导致终端、脚本或自动化工具在某些环境下得到乱码文本

这属于工程卫生问题，而不是业务逻辑问题。

## 4. 宏观结构问题

### 4.1 前端当前的根因是边界未建模

前端最大的宏观问题不是“文件太大”，而是边界没有被正式定义：

- `state` 既是缓存、也是 UI 状态、也是运行时索引、也是场景状态、也是渲染配置
- `map_renderer` 既做绘制、也做 hit-test、也做缓存、也做 overlay、也做一部分事件与刷新调度
- `sidebar` 和 `toolbar` 不只是视图层，也直接读写核心状态并触发业务流
- `scenario_manager` 不只是场景加载器，还承担快照、恢复、状态回填与 UI 绑定

这种结构的直接后果是：

- 任一改动都容易影响多个子系统
- 很难判断一个字段的权威写入口在哪里
- 回归测试很难只围住一个边界

### 4.2 Python 构建链当前的根因是“编排”和“实现”混在一起

从第一性原理看，主入口应只回答：

- 现在要跑哪些 stage
- 每个 stage 的输入输出是什么
- 失败后如何停止或恢复

但当前 `init_map_data.py` 明显不止做这个。它既像 orchestrator，也像聚合实现文件。

同样的问题在 `tools/dev_server.py` 和 `tools/patch_tno_1962_bundle.py` 上也存在：文件名看似是“工具脚本”，实际已经承担系统边界职责。

### 4.3 `data/` 混放让任何变更都先变成“考古”

当同一目录既装规则源，又装缓存，又装运行产物时，后续维护者在真正改逻辑之前，必须先回答“我面对的到底是什么文件”。

这不是理论风险，而是维护成本的现实来源：

- 改规则时，容易误动派生产物
- 重建产物时，容易覆盖人工输入
- 审查变更时，代码 diff 和资产 diff 会混在一起

### 4.4 当前验证链没有收束成一个统一系统

仓库里其实已经有更稳的前置环境管理思路。`ops/browser-mcp/run-smoke-browser-inspection.sh` 会：

- 探测现有 server
- 不存在时自动拉起
- 运行结束后清理

相比之下，E2E 用例各自维护 URL 解析和环境假设，这就是典型的基础设施重复实现。

问题的本质不是“测试写得不够多”，而是“测试框架没有统一接管环境前提”。

## 5. 重大冗余与逻辑漏洞

### 5.1 重大冗余

1. 重复的基础 URL 解析逻辑  
   多个 Playwright spec 各自维护 `resolveBaseUrl` 或硬编码 `18080`，而且鲁棒性还不一致。

2. 场景专用脚本承担平台职责  
   `tools/patch_tno_1962_bundle.py` 的问题不是代码重复多少，而是一个场景脚本反复承担了本该独立的平台边界。

3. 生成资产继续伪装成代码  
   `js/core/city_lights_modern_asset.js` 和 `js/core/city_lights_historical_1930_asset.js` 本质是生成资产，却继续占用 JS 模块、解析和加载路径。

4. 文档/脚本对编码的隐式依赖  
   同一文档在不同读取方式下表现不同，说明读取约定没有收束。

### 5.2 已证实的逻辑漏洞

1. `tools/dev_server.py --help` 会污染运行时元数据  
   这不是单纯的命令行体验差，而是会真实写入 `.runtime/dev/active_server.json`，影响后续 E2E。

2. E2E 依赖陈旧元数据时会直接失败  
   `main_shell_i18n` 已经用本次审计实证证明：当元数据指向失活地址时，用例会在 `page.goto` 阶段超时，而不是在业务断言阶段失败。

3. 发布链没有基本质量闸门  
   当前 CI 能直接构建并部署，但不要求通过 Python 单测或 Playwright 回归。

## 6. 当前是否已接近最优运行状态

结论：不是。

原因不是“系统跑不起来”，而是以下几件事还没有被证明：

- 已有性能监控不等于性能已经最优  
  `main.js` 里已有 `PerformanceObserver` 和 long-animation-frame 观测，说明项目开始做帧级性能感知。但这只能证明“开始监控”，不能证明“瓶颈已经被系统性收敛”。

- 已有 preload 和 `modulepreload` 不等于启动链已经最优  
  `index.html` 已经为 `js/main.js` 和若干关键 JSON 做了预加载，这是对的，但它仍然是在为一个巨型启动路径服务。

- 已有测试不等于验证链健康  
  Python 单测真实可跑，但入口不显式；Playwright 用例数量不少，但环境前提不统一；CI 不把它们当发布前闸门。

因此，当前系统更准确的状态是：

- 已经有不少“止血式”和“局部稳定化”工作
- 但还没有达到“结构上可持续、运行上接近最优、验证上高度可信”的程度

## 7. 可执行优化方案

### 方案一：先做资产分层

目标：

- 把规则源、构建缓存、中间检查点、发布产物四类东西拆清楚

收益：

- 先回答“什么应该进 Git，什么只是可再生输出”
- 后续所有脚本和 CI 才有清晰边界

风险：

- 会碰到大量路径假设和脚本硬编码
- 需要先加一层 manifest 或路径别名，再移动目录

### 方案二：把 `init_map_data.py` 降级成纯编排器

目标：

- 让 `init_map_data.py` 只负责 stage 顺序、输入输出契约、失败策略

收益：

- 降低回归面
- 让增量构建、失败恢复、阶段校验有稳定落点

风险：

- 会暴露当前子链输入输出契约不清的问题

### 方案三：拆 `tools/dev_server.py`

目标：

- 保持 HTTP contract 不变
- 把文件保存、场景校验、场景上下文解析抽到服务层

收益：

- CLI、测试、自动化可以直接打服务层
- HTTP handler 不再是唯一入口

风险：

- 如果服务层边界抽错，会影响现有编辑流

### 方案四：前端先做状态切片和写入口收束

目标：

- 不做框架迁移
- 先把“任意模块可直写任意状态”收束成少数显式写入口

收益：

- 后续再拆渲染、UI、场景管理时风险更低
- 能先把隐式耦合显形

风险：

- 短期会暴露很多隐式依赖

### 方案五：统一验证链

目标：

- 给 Python 单测显式入口
- 让 Playwright 配置统一接管 dev server 和 `baseURL`
- 给 `.runtime/dev/active_server.json` 加活性校验，或停止让 spec 直接信任它

收益：

- 这是最低成本、最高收益的止血项之一

风险：

- 很低，主要是测试基础设施和文档收敛

## 8. 每项方案会如何改变项目

| 方案 | 会带来的改变 | 主要风险 |
| --- | --- | --- |
| 资产分层 | 仓库从“混合仓”变成“边界明确的代码+资产仓” | 路径迁移和脚本兼容 |
| `init_map_data.py` 降权 | 构建链从单体入口变成阶段化编排 | 需要补阶段契约 |
| `dev_server.py` 拆层 | 本地编辑后端可被测试和自动化直接复用 | 可能触碰现有 UI 编辑流 |
| 前端状态收束 | 回归面缩小，边界更清晰 | 初期改动会揭开很多隐式依赖 |
| 验证链统一 | 从“开发者自己记前提”变成“框架接管前提” | 几乎没有业务风险 |

## 9. 建议治理顺序

1. 先正式留档并固化事实  
   先把已证实问题写成正式基线，不再靠口头印象讨论。

2. 第一优先级治理资产边界和验证链  
   这是收益最大、风险最低的一组工作。

3. 第二优先级治理 `init_map_data.py` 与 `tools/dev_server.py` 的职责收束  
   先把两个单体入口降权，再考虑更细的抽象。

4. 第三优先级治理前端状态边界  
   先收束写入口，再谈更大规模渲染解耦。

5. 最后再讨论 Worker、OffscreenCanvas、场景通用平台  
   这些都不是第一步；在边界未立住之前，过早上大方案只会放大复杂度。

## 10. 已证实 / 合理推断 / 待验证

### 已证实

- 前端主文件体量巨大，`state` 面积巨大，核心模块存在大量 `state.` 直写。
- Python 单测已真实跑通 `81` 项。
- Playwright 已枚举 `36` 项用例。
- `main_shell_i18n` 在信任失活 `active_server.json` 时失败。
- `.runtime/dev/active_server.json` 当前可以残留失活地址。
- `.github/workflows/deploy.yml` 未把单测或 E2E 作为发布前闸门。
- `data/` 已跟踪 `613` 个文件，约 `656.86 MB`。

### 合理推断

- 当前维护成本的主要来源是边界未建模，而不是单点算法问题。
- 如果不做治理，场景专用脚本会继续复制平台职责。
- 前端后续每次功能叠加，都会继续放大共享状态耦合。

### 待验证

- 完整全量构建的 wall time 和失败恢复成本。
- 增量构建命中率是否真实有效。
- `data/` 中所有 tracked 产物是否都必须入库，还是存在可以转移到发布物或缓存层的部分。

## 11. 外部依据

以下资料只用于约束建议方向，不用于替代本地证据：

- Playwright `webServer` 与 `baseURL` 文档  
  [https://playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)  
  该文档明确支持由 Playwright 配置统一拉起本地 server，并统一设置 `baseURL`。这直接支持“不要让每个 spec 自己维护 URL 解析逻辑”的建议。

- MDN Long Animation Frame  
  [https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing)  
  该文档强调 LoAF 是帧级阻塞观测，并且缓冲区上限为 200 条。它支持“当前已有监控，但不等于性能已最优”的判断。

- MDN Web Workers  
  [https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)  
  文档明确 worker 不能直接操作 DOM，通信依赖 `postMessage()`。这约束了后续优化方向：只能迁移纯计算和一部分可隔离任务，不能把现有 UI/DOM 逻辑整体搬走。

- MDN OffscreenCanvas  
  [https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)  
  文档说明 OffscreenCanvas 适合把部分 canvas 渲染从主线程解耦，但它不是 UI 状态系统替代品。

- MDN `modulepreload`  
  [https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload)  
  文档说明 `modulepreload` 能改善模块下载时序，但浏览器是否自动抓取依赖并不完全可控。这支持“当前预加载是有价值的，但不是结构问题的根治方案”。

- MDN HTTP Caching  
  [https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)  
  文档明确 `no-cache` 与 `no-store` 语义不同，且 `no-store` 不会删除旧响应，也可能损失 BFCache 等能力。这支持后续对 dev server 缓存策略的精细化治理，而不是一刀切禁缓存。

- GitHub Pages 自定义 workflow  
  [https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)  
  该文档说明自定义 workflow 的 artifact 上传和 deploy 约束，但它不要求跳过测试。也就是说，当前 CI 不跑测试是仓库自己的选择，不是平台限制。

## 12. 最终判断

这套系统当前最主要的问题，不是“功能没做完”，也不是“某几个点还可以微调”，而是：

1. 边界没有被正式定义。
2. 入口脚本知道太多。
3. 资产生命周期混在一起。
4. 验证链没有收束成统一系统。

因此，当前最值得做的不是继续叠更多功能，而是先把边界和验证链立住。否则后续任何性能优化、架构升级、场景扩展，都会继续建立在一套高耦合、难验证、难审查的基础上。
