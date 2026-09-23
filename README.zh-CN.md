<div align="center">
  <img src="docs/readme/logo-mark.webp" alt="Scenario Forge" width="64">
  <h1>Scenario Forge</h1>
  <p><strong>把世界画成你的版本。</strong></p>
  <p>为架空历史与世界观创作打造的政治地图工作室。</p>
  <p>
    <a href="https://raederhans.github.io/scenario-forge/app/?view=guide">打开编辑器 ↗</a>
    &nbsp; · &nbsp;
    <a href="https://raederhans.github.io/scenario-forge/#sample-runs">浏览地图作品</a>
    &nbsp; · &nbsp;
    <a href="README.md">English</a>
  </p>
</div>

![Scenario Forge 编辑器实景，展示政治地图画布与编辑工具](landing/assets/product-workspace.webp)

## 从一个起点，画出你的地图

- **选择世界。** 从空白地图、现代世界、HOI4 1936、HOI4 1939 或 TNO 1962 开始。
- **改写故事。** 调整归属与控制区，绘制前线，添加文字和战略标记。
- **编排细节。** 设置配色、边界与图例，加入城市、公路、铁路、地形和河流。
- **继续创作。** 使用中英文界面，按目标分辨率绘制并导出 PNG/JPG，保存可编辑的 JSON 工程。可在尺寸和内存限制内选择 1×–4×。

## 地图作品

以下概览图由项目数据生成，用于呈现剧本地理与地图编排，并非样例工程默认导出的截图。HOI4 与 TNO 地图展示的是游戏或架空历史设定。

### 另一种地中海

![TNO 1962 地中海概览，展示政治疆界与亚特兰特罗帕地理](landing/assets/work-alt-history-med.svg)

采用 TNO 1962 的国家归属与剧本配色，完整呈现亚特兰特罗帕陆地、浅滩与水域。

[打开 TNO 示例](https://raederhans.github.io/scenario-forge/app/?sample=tno-1962-atlantropa-briefing&view=guide) · [矢量地图](landing/assets/work-alt-history-med.svg)

### 两个年份之间的欧洲

![在相同地理范围内对照 HOI4 1936 与 1939 的政治地图](landing/assets/work-scenario-switch-europe.svg)

在同一区域，对照两个 HOI4 剧本的疆界。

[打开 1936](https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1936-europe-briefing&view=guide) · [打开 1939](https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1939-europe-switch&view=guide) · [全部样例文件](landing/assets/sample-runs.json)

## 本地运行

在 Windows 上安装 Python 3，并准备好所需运行资源后，运行：

```powershell
.\start_dev.bat
```

启动脚本会显示本地编辑器地址。环境准备、运行资源、后端预览及开发命令见[本地开发文档](docs/local-development.md)。

## 可用范围与数据来源

公开编辑器提供上面的五个底图。HGO 1936 属于开发/本地预览；Cloud Saves 与社区功能需要本地后端预览。公路和铁路是当前最成熟的公开交通图层，其他交通与专题数据的预览覆盖程度不同。

代码与文档采用 [MIT 许可证](LICENSE)。第三方数据及衍生地图保留各自的来源条款；复用数据衍生资产前，请查看[数据来源账本](data/source_ledger.json)和地图元数据（[TNO](landing/assets/work-alt-history-med.json)、[HOI4 对照](landing/assets/work-scenario-switch-europe.json)）。

[反馈问题](https://github.com/raederhans/scenario-forge/issues)
