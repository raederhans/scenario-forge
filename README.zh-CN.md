<p align="right">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-2563eb?style=for-the-badge" alt="English"></a>
  <a href="./README.zh-CN.md"><img src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-111111?style=for-the-badge" alt="Chinese"></a>
</p>

# Scenario Forge

一站式地图创作平台。

Scenario Forge 是一个以预设场景为核心的地图工作台，适合架空历史、策略游戏Mod设计和地缘政治叙事创作。你可以在现成世界场景之间切换，重绘从国家到县级的一系列地块，叠加你所能想到的一切地图元素，并导出干净的快照或可继续编辑的项目文件。

**在线体验：** https://raederhans.github.io/scenario-forge/

## 它能做什么

- 在预设场景之间快速切换：**Blank Map**、**Modern World**、**HOI4 1936**、**HOI4 1939**、**TNO 1962**。
- 使用 **ownership**、**controller**、**frontline** 等场景视图。
- 把当前工作保存成**项目文件**，之后再加载回来，保留核心地图状态。
- 将当前可见地图导出为 **PNG** 或 **JPG** 快照。
- 使用内置 **palette packs**，包括 HOI4 Vanilla、Kaiserreich、The New Order、Red Flood 风格。
- 打开额外图层，例如 **physical regions**、**urban areas**、**city points**、**rivers**、**water regions**、**special zones**。
- 添加地图展示元素，例如 **legend**、**operational lines**、**operation graphics** 和 **unit-counter 风格覆盖层**。
- 在 **English** 和 **中文** 界面之间切换。

## 为什么有用

很多地图工作流会把任务拆散到太多工具里：一个负责涂色，一个负责标注，一个负责导出，一个负责场景状态，最后还要再找一个工具做展示修饰。

Scenario Forge 尽量把这些工作放进同一个工作区里。如果你在做架空时间线、策略场景、模组概念图，或者以地图为核心的展示内容，它可以帮你更快从想法走到可用成品。

## 面向谁

- 架空历史创作者
- HOI4、TNO、Kaiserreich 模组作者
- 场景与战役设计者
- 地缘政治叙事创作者
- 以地图为核心的展示、写作与研究用户

## 快速开始

### 在线使用

直接打开在线版本：

- https://raederhans.github.io/scenario-forge/

### 本地运行

1. 先构建数据并启动本地服务：

   ```bat
   start_dev.bat
   ```

2. 如果你只想更快启动，不重新构建：

   ```bat
   start_dev.bat fast
   ```

3. 如果你需要干净复现，禁用缓存和启动 worker：

   ```bat
   start_dev.bat fresh
   ```

## 目前还没做完的部分

有些部分现在就是未完成状态，这里如实说明：

- **transport workbench** 目前只是**部分完成**。
- **Japan road preview** 是当前最成熟的 transport 示例。
- **Rail** 仍然处在壳层 / 基线阶段。
- **Airport**、**Port**、**Mineral Resources**、**Energy Facilities**、**Industrial Zones** 还在等待后续开发。

如果某个功能还没有完整接通，就应该把它视为 **in progress**，而不是现成可用功能。

## 主要数据来源

这里不是完整的数据台账，只列出项目里较重要的上游数据来源。

- Natural Earth: https://www.naturalearthdata.com/
- geoBoundaries: https://www.geoboundaries.org/
- GeoNames: https://www.geonames.org/
- NOAA ETOPO 2022: https://www.ncei.noaa.gov/products/etopo-global-relief-model
- NASA Black Marble: https://blackmarble.gsfc.nasa.gov/
- OpenStreetMap: https://www.openstreetmap.org/
- Geofabrik: https://download.geofabrik.de/
- 日本 MLIT 道路数据（N06）: https://nlftp.mlit.go.jp/ksj/

更详细的溯源信息见：

- `data/source_ledger.json`
- `data/` 目录下的 `.provenance.json` sidecar 文件

## License

项目代码和文档采用 **MIT License**。

仓库中的第三方数据及其衍生资产，仍然保留各自原始来源与溯源记录。这里不展开完整清单，详细追踪信息请以 `data/source_ledger.json` 为准。

## Maintained by

当前维护者：**[@raederhans](https://github.com/raederhans)**。

## Bug 反馈

如果你发现功能异常、显示不对，或者体验上有明显问题，可以直接提 issue：

- https://github.com/raederhans/scenario-forge/issues

比较有帮助的 bug 反馈通常包括：

- 你当时使用的 scenario
- 你的浏览器和操作系统
- 清晰的复现步骤
- 必要时附上截图或导出的项目文件

## 给贡献者

如果你想参与项目开发，最短路径是：

```bat
start_dev.bat
```

常用补充命令：

```bat
build_data.bat
run_server.bat
```

浏览器与回归测试工具：

```bash
npm install
npm run test:e2e
```

CI 浏览器安装策略（`.github/workflows/verify-shared.yml`）：

- CI 设置 `PLAYWRIGHT_BROWSERS_PATH=.runtime/browser/ms-playwright`，并通过 `actions/cache` 缓存该目录。
- 浏览器安装优先使用 `npx playwright install chromium`，对齐 GitHub Hosted Ubuntu runner 的预置系统依赖。
- 安装步骤包含 2 次重试与指数退避（1 秒、2 秒），用于吸收临时下载波动。
- 回退策略：当 runner 镜像依赖发生变化时，在修复提交中切换到 `npx playwright install --with-deps chromium`（或项目脚本 `npm run playwright:install:chromium`），并同步核对 runner 镜像更新日志。
