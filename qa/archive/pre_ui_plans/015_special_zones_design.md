# Special Status Zones Design Document (015)

Role: Product Designer and Technical Architect
Scope: Eurasia (Europe, Russia, China, South Asia)
Objective: Represent Disputed Territories, DMZs, Wastelands, and Neutral Zones in the map system.

## 1) Inventory of Candidate Zones (Based on current map)

Disputed (territorial claims or contested control):
- China-India
  - Aksai Chin
  - Arunachal Pradesh
- Russia-Ukraine
  - Crimea
  - Donbas (Donetsk, Luhansk areas)
- Japan-Russia
  - Kuril Islands / Northern Territories
- India-Pakistan
  - Kashmir (as scope allows, likely western edge of current map)

Hazard or Wasteland (hazardous or restricted areas):
- Chernobyl Exclusion Zone (Ukraine)
- Fukushima restricted zones (Japan)
- Semipalatinsk Test Site (Kazakhstan)

Buffer or DMZ (demilitarized or buffer):
- Korean DMZ (if map extends far enough east)
- Cyprus Green Line (if visible at current extent)

Notes on scope alignment:
- Current scope centers on Eurasia; Korea and Cyprus are conditional on current bounding box.
- Each zone should be optional and scenario-driven to avoid political assumptions in default view.

## 2) Technical Implementation (Backend and Data)

### Geometry generation
1) Auto-intersection (ideal for disputed zones between two countries)
- Zone = intersect(geometry(countryA), geometry(countryB))
- Use for overlapping claims if the dataset stores alternate claim geometries.
- If only one authoritative geometry exists, auto-intersection will not work. In that case, use manual import.

2) Manual import (for irregular or non-border-aligned zones)
- Load curated GeoJSON polygons for special zones
- Examples:
  - Chernobyl zone boundary polygon
  - Fukushima restricted areas (multiple polygons)
  - Semipalatinsk site boundary
  - Cyprus Green Line (buffer polygon or line with buffer thickness)

### Data structure in TopoJSON
Recommendation: separate layer for special zones, not embedded in country features.

- Layer: `objects.special_zones`
- Geometry: Polygon or MultiPolygon
- Properties example:
  - `id`: stable unique id, snake case
  - `type`: one of `disputed`, `dmz`, `wasteland`, `neutral`
  - `label`: display name
  - `claimants`: array of ISO country codes, when applicable
  - `scenario`: array of scenario keys or default `"all"`
  - `source`: optional, for provenance
  - `priority`: optional integer for draw order

Example:
```
{
  "type": "Feature",
  "id": "disputed_cn_in_aksai_chin",
  "properties": {
    "type": "disputed",
    "label": "Aksai Chin",
    "claimants": ["CN", "IN"],
    "scenario": ["de_jure", "max_claims"],
    "priority": 30
  },
  "geometry": { ... }
}
```

### Identification strategy
- Use deterministic ids: `<type>_<countrycodes>_<localname>`
  - Example: `disputed_ru_ua_crimea`
- If claimants are not the primary definition (wasteland), use geo name:
  - `wasteland_ua_chernobyl`
- Maintain a registry file (json or yaml) that maps ids to metadata to avoid duplication.

### Suggested data pipeline
1) Source or draw polygons in GeoJSON
2) Normalize properties (id, type, label, claimants)
3) Convert to TopoJSON and add as a separate layer
4) Keep zone data small to avoid bloating the base map

## 3) Visual Expression (Frontend)

### Styling strategy
Use SVG patterns in `<defs>` and apply to zone paths. Each zone type should be visually distinct and readable at multiple scales.

Disputed
- Diagonal stripes at 45 degrees
- Options:
  - Neutral stripes (gray with opacity)
  - Mixed colors from claimants (alternating bands)
- Outline: thin neutral border to separate from base fill

Wasteland
- Noise or stipple texture
- Fluorescent outline (to signal hazard) and slight glow
- Optionally overlay a subtle static pattern at high zoom

DMZ
- Cross-hatch pattern (orthogonal lines)
- Option for barbed wire style using dashed stroke with small ticks
- Thin centerline for visual hint of separation

Neutral Zone
- Light dotted pattern
- Desaturated fill with low alpha

### Layering rules
- Draw order: base countries -> borders -> special zones -> labels
- Special zones should sit on top of base fills but below key labels to avoid text collisions
- If a zone overlaps water, ensure the overlay is clipped to land mask

### Example pattern definitions
- `pattern-disputed` (diagonal lines)
- `pattern-dmz` (cross-hatch)
- `pattern-wasteland` (noise texture)
- `pattern-neutral` (dots)

## 4) Interaction Design (UI/UX)

### Creation and management
A) Config-driven (fastest for v1)
- Add a config list in `config.py` or data registry
- Example: `DISPUTED_ZONES = [("CN", "IN", "Aksai Chin")]`
- Good for predictable zones, fast iteration, no UI complexity

B) UI Tool: Zone Creator mode (v2)
- Sidebar mode with steps:
  1) Select zone type
  2) Select one or more regions (claimants)
  3) Draw or import polygon
  4) Save to special_zones layer
- Useful for power users and custom scenarios

C) Preset toggles (recommended for user clarity)
- Scenario dropdown in UI:
  - `Official UN`
  - `De Facto Control`
  - `Max Claims`
- Each special zone includes `scenario` metadata so it can be filtered

### Tooltip and click behavior
- Hover: show zone label and type
- Click: panel with details
  - Zone name
  - Type
  - Claimants (if any)
  - Scenario visibility
  - Optional notes

### Interaction defaults
- Tooltip should prioritize clarity over politics; label should not imply ownership
- If claims overlap, show both claimants in a neutral order (alphabetical or data order)

## Recommendation Summary
- Implement special zones as a separate TopoJSON layer for clean layering and filtering.
- Start with config-driven definitions and scenario toggles (v1), then add Zone Creator UI (v2).
- Use distinct SVG patterns for each zone type to preserve readability across zoom levels.
- Keep ids deterministic and store metadata in a registry for stability and reuse.
