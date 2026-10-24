<div align="center">
  <img src="docs/readme/logo-mark.webp" alt="Scenario Forge" width="64">
  <h1>Scenario Forge</h1>
  <p><strong>Make a world your own.</strong></p>
  <p>A political map studio for alternate history and worldbuilding.</p>
  <p>
    <a href="https://raederhans.github.io/scenario-forge/app/?view=guide">Open Scenario Forge ↗</a>
    &nbsp; · &nbsp;
    <a href="https://raederhans.github.io/scenario-forge/hgo/">Open HGO Atlas ↗</a>
    &nbsp; · &nbsp;
    <a href="https://raederhans.github.io/scenario-forge/">Website</a>
    &nbsp; · &nbsp;
    <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

Two browser editors, one project:

| | Scenario Forge | HGO Atlas |
|---|---|---|
| **What it edits** | Vector political maps | The Historic Geographic Overhaul mod's native pixel map |
| **Starting worlds** | Blank Map, Modern World, HOI4 1936, HOI4 1939, TNO 1962 | HGO 1936 — 11,894 states (924 at sea), 20,782 provinces |
| **Open it** | [Editor ↗](https://raederhans.github.io/scenario-forge/app/?view=guide) | [HGO Atlas ↗](https://raederhans.github.io/scenario-forge/hgo/) |

## Scenario Forge

![Scenario Forge editor with a political map canvas and editing tools](landing/assets/product-workspace.webp)

- **Choose a world** and edit ownership, control, frontlines and special regions.
- **Compose the map** with palettes, borders, labels and legends; add cities, roads, rail, terrain, rivers and night lights.
- **Export** PNG or JPG at up to 4×, and save the project to keep editing. English and Chinese interface.

<table>
  <tr>
    <td width="50%"><img src="landing/assets/work-alt-history-med.svg" alt="TNO 1962 Mediterranean with Atlantropa geography"></td>
    <td width="50%"><img src="landing/assets/work-scenario-switch-europe.svg" alt="HOI4 1936 and 1939 political maps of Europe side by side"></td>
  </tr>
  <tr>
    <td>TNO 1962 · Atlantropa — <a href="https://raederhans.github.io/scenario-forge/app/?sample=tno-1962-atlantropa-briefing&view=guide">open sample</a></td>
    <td>HOI4 1936 → 1939 — <a href="https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1936-europe-briefing&view=guide">1936</a> · <a href="https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1939-europe-switch&view=guide">1939</a></td>
  </tr>
</table>

## HGO Atlas

![HGO Atlas editor showing the 1936 world map with state labels and the editing panel](docs/readme/hgo-atlas.webp)

A separate editor for the HGO mod's 1936 world on its native 5120 × 2560 map. Paint land and sea states, transfer ownership and cores between countries, rename regions, and export the full map as PNG. Developer notes: [apps/hgo](apps/hgo/README.md).

## Run locally

On Windows with Python 3:

```powershell
.\start_dev.bat
```

The launcher prints the local editor URL. See [local development](docs/local-development.md) for setup and the optional backend (Cloud Saves and community features). Before opening a PR, run `npm test` and follow [development and delivery](docs/development-and-delivery.md).

## License

Code and documentation are [MIT](LICENSE). Map data keeps its source terms — see the [source ledger](data/source_ledger.json).

[Report an issue](https://github.com/raederhans/scenario-forge/issues)
