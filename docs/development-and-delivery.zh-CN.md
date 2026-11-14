# 开发与交付

[English](development-and-delivery.md)

## 本地检查

```sh
npm test                 # 全部 Node 与 Python 单元测试
npm run test:node        # 只跑 Node（tests/*.test.mjs）
npm run test:python      # 只跑 Python（pytest -n auto）
node --test tests/<file>.test.mjs   # 单个文件
npm run test:e2e:golden  # 黄金用户流程（约 20 分钟）
```

浏览器测试入口：

| 入口 | 范围 |
| --- | --- |
| `npm run test:e2e:golden` | `tests/e2e/golden/`：黄金用户流程，只通过 DOM 和 `js/core/app_test_api.js` 访问应用。 |
| `npm run test:e2e` | Playwright 默认范围：`tests/e2e/` 下除 `release/` 外的全部，即黄金流程、样例指南、地图拖拽释放和控件画廊（画廊基线只有 win32）。 |
| `npm run test:e2e:pages-public-release-gate` | `tests/e2e/release/`，针对 `SCENARIO_FORGE_PAGES_URL` 指定的已发布站点；`:deployed` 变体默认指向线上 Pages。 |

TNO 严格数据合约用 `npm run verify:tno-strict-contracts`（一次输出 strict、coverage ledger、Atlantropa 三份报告），`npm run verify:tno-coverage-chain` 在它之后再跑极地覆盖和分块合约测试。

`dist/` 不签入。Pages 产物由 CI 用 `tools/build_pages_dist.py` 从源码构建，其中编辑器 JS 由 `tools/build_editor_bundle.mjs`（esbuild）打包到 `app/js/bundle/`；本地需要时运行 `npm run verify:pages-dist`。

`tests/quarantine.json` 是 PR 上唯一的跳过清单，每一项都必须写明原因，修好或删掉后立即移除。每周运行（`weekly.yml`）用 `--with-slow` 额外运行慢测试，但仍跳过隔离项，只在出现新的破坏时报红；需要完整审计时手动用 `--all`（连隔离项一起跑）。

| 阶段 | 使用方式 |
| --- | --- |
| 编辑反馈 | 运行与改动最相关的测试文件；涉及 UI 行为时跑一个聚焦的浏览器检查。 |
| 提交前 | `npm test`。改了数据、构建或 Pages 入口时，加跑 `npm run verify:pages-dist`。 |
| 推送功能分支 | 在既有授权内推送，不需要额外的验证组合。 |
| PR 合并 | 以最终提交的 `PR Verify Required` 为准。 |
| 发布 | `main` 合并触发部署流程：构建一次产物，在这份产物上跑保存重开与 PNG 导出两条黄金流程，通过后上传并发布，最后确认线上地址可访问。CI、合并和线上成功分别确认。 |

## PR 中的检查

每个 PR 都运行同一组必需检查，不按改动路径分流。作业数量刻意保持很少：这个仓库每个作业光 checkout 就要约两分钟。

| Job | 内容 |
| --- | --- |
| `checks` | 构建一次 Pages 产物并做启动壳检查；Quick Fill 层级数据与审计、数据目录健康检查、Pages 源码引用检查；全部 Node 与 Python 单元测试。 |
| `golden` | 黄金用户流程（2 个分片，每片 2 个 worker）：启动、5 个场景切换与填色、撤销重做、保存后重新打开、PNG 导出、性能预算，以及界面面板（`golden_ui_flows.spec.js`：外观页签、交通工作台、特殊区域、导出工作台图层、语言切换、检查器取色、命令面板）和首页流程。只通过 DOM 和 `js/core/app_test_api.js` 访问应用。 |
| `PR Verify Required` | 汇总以上 job，任一失败即失败；这是唯一的 required check。 |

另外有三个不属于 required check 的工作流：`data-verify.yml`（5 个场景的严格数据合约、交通清单校验、TNO 栅格发布阶段）只在 `data/`、构建器或政治栅格渲染文件变动时运行；`hgo-native.yml` 只在 `apps/hgo/` 变动时运行；`weekly.yml` 每周运行慢测试、其余浏览器 spec 和完整的 `data-verify`。三者都可以从 Actions 手动触发。CI 不测量性能。

交互性能（真实首帧、settled 后 30 s 长帧尾巴、拖拽中最长帧、缩放/平移 settled）用本地探针测量：先运行 `python tools/dev_server.py --port <端口>`，再运行 `MAPCREATOR_DEV_PORT=<端口> npm run perf:interaction -- --scenarios hoi4_1936 --runs 3`；`--url-query political_render_mode=vector` 之类的参数可以做对照。默认用真实 GPU，结果写到 `.runtime/reports/generated/perf-interaction/`。CI 用软件渲染，这几个指标的绝对值在 CI 上没有可比性，所以只在本地对照测量。

保存工作到功能分支无需先追平 `main`。准备合并时再 fetch 目标分支并确认最终提交的 required check；合并后的 Pages 发布独立验收。
