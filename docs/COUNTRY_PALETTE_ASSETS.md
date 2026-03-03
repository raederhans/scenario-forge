# Country Palette Assets

## Purpose

Country palette data is now stored as project assets instead of being read at runtime from a local game installation.

This keeps the app portable:

- users do not need a local Hearts of Iron IV install
- palette packs can be versioned in git
- future mods can be added as additional packs without changing runtime logic

## Asset Layout

- `data/palettes/index.json`
  - registry of available palette packs
- `data/palettes/*.palette.json`
  - raw source palette entries keyed by source tag
- `data/palette-maps/*.map.json`
  - explicit crosswalk from source tag to app canonical ISO-2
- `data/palette-maps/*.audit.json`
  - audit report for every source tag, including mapped/unmapped status
- `data/palette-maps/*.manual.json`
  - import-time rules, not consumed by the browser

## Current Default Pack

- `hoi4_vanilla`

Runtime canonical identity remains ISO-2 country code because the map data contract is already built around `cntr_code` and runtime owner identity.

## Import Workflow

Run:

```bash
python3 tools/import_country_palette.py
```

Optional:

```bash
python3 tools/import_country_palette.py --source-root "/mnt/c/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"
```

The importer reads:

- `common/country_tags/00_countries.txt`
- `common/country_tags/zz_dynamic_countries.txt`
- `common/countries/colors.txt`
- `common/countries/*.txt`
- `localisation/english/countries_l_english.yml`

Runtime color priority:

1. `colors.txt:color`
2. country file fallback color
3. `colors.txt:color_ui`

The palette asset keeps all three color slots:

- `map_hex`
- `ui_hex`
- `country_file_hex`

Runtime fixed country colors always use `map_hex`.

## Mapping Rules

The importer never assumes that source tags are the same as app country keys.

- source identity: HOI4 or mod tag
- app identity: canonical ISO-2

Mapping is controlled by `*.manual.json` using an explicit approval model.

Typical outcomes:

- exact verified mapping: `GER -> DE`
- approved alias mapping: `ENG -> GB`
- explicit deny: `RAJ -> colonial_predecessor`
- dynamic deny: `D01 -> dynamic_tag_not_mapped`

If a source tag has no safe ISO-2 target, it stays in `unmapped` with a reason code such as:

- `historical_union_or_predecessor`
- `split_state`
- `warlord_or_regional_tag`
- `unsupported_runtime_country`
- `ambiguous_identity`
- `unreviewed`

## UI Model

The left palette UI now uses:

1. palette source select
2. quick swatches
3. custom color picker
4. expandable searchable full color library

Quick swatches are a curated subset. The full pack remains available through the browser list.

The quick palette is intentionally fixed to a HOI4 big-power-first order and does not reuse `Recent` colors.
