# Phase 3.5: France Surgical Refinement & Tree-Based Preset UI

**Document Version:** 2.0
**Phase:** Advanced Refinement + UI Framework
**Objective:** Enable sub-département (Arrondissement) granularity for Vichy France, TNO Burgundy, and Alsace-Lorraine scenarios; implement tree-based preset menu

---

## Executive Summary

This document expands the surgical refinement strategy to support three major historical scenarios:

1. **Treaty of Frankfurt (1871)**: Alsace-Lorraine annexation (existing)
2. **Vichy France (1940-1944)**: The Demarcation Line between Occupied and Free France
3. **TNO Burgundy**: Alternative history scenario following the Seine River

Additionally, this document specifies a **Tree-Based Preset Menu** for the right sidebar, enabling hierarchical organization of historical presets under their parent modern countries.

**Total Départements to Drill-Down**: 26 (up from 8)

---

## Section 1: Complete Data Lists

### 1.1 DRILL_DOWN_DEPTS (Python)

```python
# Départements requiring arrondissement-level granularity
DRILL_DOWN_DEPTS = [
    # === Alsace-Lorraine (Treaty of Frankfurt 1871) ===
    "06",  # Alpes-Maritimes (also Savoy-Nice)
    "54",  # Meurthe-et-Moselle
    "57",  # Moselle
    "67",  # Bas-Rhin
    "68",  # Haut-Rhin
    "73",  # Savoie (Savoy-Nice)
    "74",  # Haute-Savoie (Savoy-Nice)
    "88",  # Vosges

    # === Vichy France Demarcation Line ===
    "01",  # Ain
    "03",  # Allier
    "16",  # Charente
    "18",  # Cher
    "24",  # Dordogne
    "33",  # Gironde
    "37",  # Indre-et-Loire
    "39",  # Jura
    "40",  # Landes
    "41",  # Loir-et-Cher
    "64",  # Pyrénées-Atlantiques
    "71",  # Saône-et-Loire
    "86",  # Vienne

    # === TNO Burgundy (Seine River Line) ===
    "27",  # Eure
    "76",  # Seine-Maritime
    "77",  # Seine-et-Marne
    "78",  # Yvelines
    "95",  # Val-d'Oise
]
```

### 1.2 REMOVE_NUTS_IDS (Python)

```python
# NUTS-3 IDs to remove (replaced by arrondissements)
REMOVE_NUTS_IDS = [
    # === Alsace-Lorraine + Savoy-Nice ===
    "FRL03",  # Alpes-Maritimes (06)
    "FRF31",  # Meurthe-et-Moselle (54)
    "FRF33",  # Moselle (57)
    "FRF11",  # Bas-Rhin (67)
    "FRF12",  # Haut-Rhin (68)
    "FRK27",  # Savoie (73)
    "FRK28",  # Haute-Savoie (74)
    "FRF34",  # Vosges (88)

    # === Vichy France Demarcation Line ===
    "FRK21",  # Ain (01)
    "FRK11",  # Allier (03)
    "FRI31",  # Charente (16)
    "FRB01",  # Cher (18)
    "FRI11",  # Dordogne (24)
    "FRI12",  # Gironde (33)
    "FRB04",  # Indre-et-Loire (37)
    "FRC22",  # Jura (39)
    "FRI13",  # Landes (40)
    "FRB05",  # Loir-et-Cher (41)
    "FRI15",  # Pyrénées-Atlantiques (64)
    "FRC13",  # Saône-et-Loire (71)
    "FRI34",  # Vienne (86)

    # === TNO Burgundy (Seine River Line) ===
    "FRD21",  # Eure (27)
    "FRD22",  # Seine-Maritime (76)
    "FR102",  # Seine-et-Marne (77)
    "FR103",  # Yvelines (78)
    "FR108",  # Val-d'Oise (95)
]
```

### 1.3 Département → NUTS-3 Mapping Reference

| Dept | Name | NUTS-3 | Scenario |
|------|------|--------|----------|
| 01 | Ain | FRK21 | Vichy |
| 03 | Allier | FRK11 | Vichy |
| 06 | Alpes-Maritimes | FRL03 | Savoy-Nice |
| 16 | Charente | FRI31 | Vichy |
| 18 | Cher | FRB01 | Vichy |
| 24 | Dordogne | FRI11 | Vichy |
| 27 | Eure | FRD21 | Burgundy |
| 33 | Gironde | FRI12 | Vichy |
| 37 | Indre-et-Loire | FRB04 | Vichy |
| 39 | Jura | FRC22 | Vichy |
| 40 | Landes | FRI13 | Vichy |
| 41 | Loir-et-Cher | FRB05 | Vichy |
| 54 | Meurthe-et-Moselle | FRF31 | Alsace-Lorraine |
| 57 | Moselle | FRF33 | Alsace-Lorraine |
| 64 | Pyrénées-Atlantiques | FRI15 | Vichy |
| 67 | Bas-Rhin | FRF11 | Alsace-Lorraine |
| 68 | Haut-Rhin | FRF12 | Alsace-Lorraine |
| 71 | Saône-et-Loire | FRC13 | Vichy |
| 73 | Savoie | FRK27 | Savoy-Nice |
| 74 | Haute-Savoie | FRK28 | Savoy-Nice |
| 76 | Seine-Maritime | FRD22 | Burgundy |
| 77 | Seine-et-Marne | FR102 | Burgundy |
| 78 | Yvelines | FR103 | Burgundy |
| 86 | Vienne | FRI34 | Vichy |
| 88 | Vosges | FRF34 | Alsace-Lorraine |
| 95 | Val-d'Oise | FR108 | Burgundy |

---

## Section 2: Historical Scenario Definitions

### 2.1 Treaty of Frankfurt (1871)

**Context**: Germany annexed Alsace and most of Lorraine after the Franco-Prussian War.

**German Territory** (Reichsland Elsaß-Lothringen):
- All of Moselle (57)
- All of Bas-Rhin (67)
- All of Haut-Rhin (68) EXCEPT Belfort area
- Parts of Meurthe-et-Moselle (54) - Château-Salins area
- Small strip of Vosges (88) - Schirmeck/Saales

**Remained French**:
- Territoire de Belfort (carved from Haut-Rhin, now dept 90)
- Most of Meurthe-et-Moselle (merged with remnants of Meurthe)

### 2.2 Vichy France Demarcation Line (1940-1944)

**Context**: After the Fall of France, the country was divided into German-occupied Zone Nord and the nominally independent Zone Libre (Vichy France).

**Demarcation Line Path** (approximate):
```
Atlantic Coast (near Royan) →
Through Charente (16) →
Vienne (86) - split →
Indre-et-Loire (37) - northern tip occupied →
Loir-et-Cher (41) - split along Cher River →
Cher (18) - split →
Allier (03) - split →
Saône-et-Loire (71) - split →
Jura (39) - split →
Ain (01) - split →
Swiss Border
```

**Key Split Départements** (requiring arrondissement granularity):
| Dept | Occupied Arrondissements | Free Arrondissements |
|------|-------------------------|---------------------|
| 16 (Charente) | Confolens (partial) | Angoulême, Cognac |
| 18 (Cher) | Vierzon | Bourges, Saint-Amand |
| 37 (Indre-et-Loire) | Chinon (partial) | Tours, Loches |
| 41 (Loir-et-Cher) | Blois (north) | Vendôme, Romorantin |
| 71 (Saône-et-Loire) | Chalon (north) | Mâcon, Autun |
| 39 (Jura) | Dole | Lons-le-Saunier, Saint-Claude |
| 01 (Ain) | Bourg-en-Bresse (partial) | Belley, Nantua, Gex |

**Fully Occupied** (German Zone):
- Gironde (33) - Atlantic Wall
- Landes (40) - Atlantic Wall
- Pyrénées-Atlantiques (64) - Atlantic Wall
- Dordogne (24) - Occupied zone

### 2.3 TNO Burgundy (Alternative History)

**Context**: The New Order: Last Days of Europe mod depicts an SS state called "Burgundy" controlling northeastern France along the Seine River.

**Burgundian Territory** (approximate):
- Seine-Maritime (76) - Rouen area
- Eure (27) - Vernon area
- Yvelines (78) - western Île-de-France
- Val-d'Oise (95) - northern Île-de-France
- Seine-et-Marne (77) - eastern Île-de-France
- Plus parts of Picardy, Champagne, Burgundy proper

**Seine River as Approximate Border**:
The arrondissement boundaries along the Seine allow drawing this fictional border.

---

## Section 3: Tree-Based Preset Menu Architecture

### 3.1 Data Structure (JavaScript)

Add to `js/app.js` after `countryNames`:

```javascript
/**
 * Tree structure for country presets
 * Each country can have multiple historical presets
 * Presets contain region IDs (NUTS-3 or FR_ARR_*) and their colors
 */
const countryPresets = {
  DE: {
    name: "Germany",
    presets: [
      {
        id: "de_prussia",
        name: "Prussia (1871)",
        description: "Kingdom of Prussia borders",
        regions: {}, // TODO: Populate with region IDs
      },
      {
        id: "de_bavaria",
        name: "Bavaria",
        description: "Kingdom of Bavaria borders",
        regions: {},
      },
      {
        id: "de_saxony",
        name: "Saxony",
        description: "Kingdom of Saxony borders",
        regions: {},
      },
      {
        id: "de_alsace_lorraine",
        name: "Alsace-Lorraine (1871-1918)",
        description: "Reichsland Elsaß-Lothringen",
        regions: {
          // Moselle arrondissements
          "FR_ARR_57001": "#1a1a1a",
          "FR_ARR_57002": "#1a1a1a",
          "FR_ARR_57003": "#1a1a1a",
          "FR_ARR_57004": "#1a1a1a",
          "FR_ARR_57005": "#1a1a1a",
          "FR_ARR_57006": "#1a1a1a",
          "FR_ARR_57007": "#1a1a1a",
          "FR_ARR_57008": "#1a1a1a",
          "FR_ARR_57009": "#1a1a1a",
          // Bas-Rhin arrondissements
          "FR_ARR_67001": "#1a1a1a",
          "FR_ARR_67002": "#1a1a1a",
          "FR_ARR_67003": "#1a1a1a",
          "FR_ARR_67004": "#1a1a1a",
          "FR_ARR_67005": "#1a1a1a",
          // Haut-Rhin arrondissements (except Belfort)
          "FR_ARR_68001": "#1a1a1a",
          "FR_ARR_68002": "#1a1a1a",
          "FR_ARR_68003": "#1a1a1a",
          "FR_ARR_68004": "#1a1a1a",
          "FR_ARR_68005": "#1a1a1a",
          // TODO: Add partial Meurthe-et-Moselle, Vosges
        },
      },
    ],
  },
  FR: {
    name: "France",
    presets: [
      {
        id: "fr_vichy",
        name: "Vichy France (1940-1944)",
        description: "Zone Libre - Unoccupied France",
        regions: {}, // TODO: Populate with Free Zone arrondissements
      },
      {
        id: "fr_occupied",
        name: "German-Occupied France (1940-1944)",
        description: "Zone Nord - German Military Administration",
        regions: {}, // TODO: Populate with Occupied Zone arrondissements
      },
      {
        id: "fr_burgundy_tno",
        name: "Burgundy (TNO)",
        description: "SS Ordensstaat Burgund - Alternative History",
        regions: {}, // TODO: Populate with Seine River line regions
      },
      {
        id: "fr_occitania",
        name: "Occitania",
        description: "Historical Occitan cultural region",
        regions: {},
      },
      {
        id: "fr_savoy",
        name: "Savoy (pre-1860)",
        description: "Duchy of Savoy before French annexation",
        regions: {
          "FR_ARR_73001": "#0055A4",
          "FR_ARR_73002": "#0055A4",
          "FR_ARR_73003": "#0055A4",
          "FR_ARR_74001": "#0055A4",
          "FR_ARR_74002": "#0055A4",
          "FR_ARR_74003": "#0055A4",
          "FR_ARR_74004": "#0055A4",
        },
      },
    ],
  },
  IT: {
    name: "Italy",
    presets: [
      {
        id: "it_papal_states",
        name: "Papal States",
        description: "Pre-unification Papal territories",
        regions: {},
      },
      {
        id: "it_two_sicilies",
        name: "Kingdom of Two Sicilies",
        description: "Southern Italian kingdom",
        regions: {},
      },
      {
        id: "it_sardinia",
        name: "Kingdom of Sardinia",
        description: "Piedmont-Sardinia including Savoy/Nice",
        regions: {},
      },
    ],
  },
  PL: {
    name: "Poland",
    presets: [
      {
        id: "pl_congress",
        name: "Congress Poland",
        description: "Russian-controlled Poland (1815-1915)",
        regions: {},
      },
      {
        id: "pl_interwar",
        name: "Interwar Poland (1918-1939)",
        description: "Second Polish Republic",
        regions: {},
      },
    ],
  },
  RU: {
    name: "Russia",
    presets: [
      {
        id: "ru_imperial",
        name: "Imperial Russia",
        description: "Russian Empire European territories",
        regions: {},
      },
    ],
  },
  AT: {
    name: "Austria",
    presets: [
      {
        id: "at_habsburg",
        name: "Habsburg Monarchy",
        description: "Austrian Empire territories",
        regions: {},
      },
    ],
  },
  // Add more countries as needed...
};
```

### 3.2 UI Rendering (JavaScript)

Replace `setupRightSidebar()` in `js/app.js`:

```javascript
function setupRightSidebar() {
  const list = document.getElementById("countryList");
  if (!list) return;
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");

  // Get all countries (both with and without presets)
  const allCountryCodes = Object.keys(countryNames).sort((a, b) =>
    countryNames[a].localeCompare(countryNames[b])
  );

  const renderList = () => {
    const term = (searchInput?.value || "").trim().toLowerCase();
    list.innerHTML = "";

    allCountryCodes.forEach((code) => {
      const name = countryNames[code];
      const presetData = countryPresets[code];
      const hasPresets = presetData && presetData.presets && presetData.presets.length > 0;

      // Filter by search term
      if (term) {
        const matchesCountry = name.toLowerCase().includes(term) || code.toLowerCase().includes(term);
        const matchesPreset = hasPresets && presetData.presets.some(
          (p) => p.name.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term)
        );
        if (!matchesCountry && !matchesPreset) return;
      }

      // Country container
      const container = document.createElement("div");
      container.className = "country-tree-node rounded-lg border border-slate-200 bg-slate-50 overflow-hidden";

      // Country header row
      const header = document.createElement("div");
      header.className = "flex items-center justify-between gap-2 px-3 py-2 bg-slate-100";

      // Left side: expand button + name
      const leftGroup = document.createElement("div");
      leftGroup.className = "flex items-center gap-2";

      // Expand/collapse button (only if has presets)
      if (hasPresets) {
        const expandBtn = document.createElement("button");
        expandBtn.className = "expand-btn w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-transform duration-200";
        expandBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>`;
        expandBtn.setAttribute("aria-expanded", "false");
        expandBtn.addEventListener("click", () => {
          const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
          expandBtn.setAttribute("aria-expanded", !isExpanded);
          expandBtn.style.transform = isExpanded ? "rotate(0deg)" : "rotate(90deg)";
          presetList.style.display = isExpanded ? "none" : "block";
        });
        leftGroup.appendChild(expandBtn);
      } else {
        // Spacer for alignment
        const spacer = document.createElement("div");
        spacer.className = "w-5";
        leftGroup.appendChild(spacer);
      }

      // Country name
      const label = document.createElement("div");
      label.className = "text-sm font-medium text-slate-700";
      label.textContent = `${name} (${code})`;
      leftGroup.appendChild(label);

      // Right side: color picker
      const input = document.createElement("input");
      input.type = "color";
      input.value = countryPalette[code] || defaultCountryPalette[code] || "#cccccc";
      input.className = "h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white";
      input.title = `Set base color for ${name}`;
      input.addEventListener("change", (event) => {
        const value = event.target.value;
        countryPalette[code] = value;
        applyCountryColor(code, value);
      });

      header.appendChild(leftGroup);
      header.appendChild(input);
      container.appendChild(header);

      // Preset list (hidden by default)
      const presetList = document.createElement("div");
      presetList.className = "preset-list border-t border-slate-200 bg-white";
      presetList.style.display = "none";

      if (hasPresets) {
        presetData.presets.forEach((preset) => {
          const presetRow = document.createElement("div");
          presetRow.className = "flex items-center justify-between gap-2 px-3 py-2 pl-8 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0";

          const presetInfo = document.createElement("div");
          presetInfo.className = "flex-1 min-w-0";

          const presetName = document.createElement("div");
          presetName.className = "text-sm font-medium text-slate-600 truncate";
          presetName.textContent = preset.name;

          const presetDesc = document.createElement("div");
          presetDesc.className = "text-xs text-slate-400 truncate";
          presetDesc.textContent = preset.description || "";

          presetInfo.appendChild(presetName);
          presetInfo.appendChild(presetDesc);

          const applyBtn = document.createElement("button");
          applyBtn.className = "shrink-0 px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200 transition-colors";
          applyBtn.textContent = "Apply";
          applyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            applyPreset(preset);
          });

          presetRow.appendChild(presetInfo);
          presetRow.appendChild(applyBtn);
          presetList.appendChild(presetRow);
        });
      }

      container.appendChild(presetList);
      list.appendChild(container);
    });
  };

  if (searchInput) {
    searchInput.addEventListener("input", renderList);
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      Object.keys(defaultCountryPalette).forEach((code) => {
        countryPalette[code] = defaultCountryPalette[code];
      });
      applyPaletteToMap();
      renderList();
    });
  }

  renderList();
}

/**
 * Apply a historical preset to the map
 * @param {Object} preset - Preset object with regions map
 */
function applyPreset(preset) {
  if (!preset || !preset.regions) {
    console.warn("Preset has no regions defined:", preset?.name);
    return;
  }

  const regionCount = Object.keys(preset.regions).length;
  if (regionCount === 0) {
    console.warn(`Preset "${preset.name}" has empty regions. TODO: Populate region IDs.`);
    alert(`Preset "${preset.name}" is not yet configured.\n\nRegion IDs need to be populated.`);
    return;
  }

  // Apply colors to specified regions
  Object.entries(preset.regions).forEach(([regionId, color]) => {
    colors[regionId] = color;
  });

  invalidateBorderCache();
  renderFull();
  console.log(`Applied preset: ${preset.name} (${regionCount} regions)`);
}
```

### 3.3 Updated HTML (index.html)

Update the right sidebar section:

```html
<aside
  id="rightSidebar"
  class="w-[280px] shrink-0 border-l border-slate-200 bg-white p-6 max-h-screen overflow-y-auto"
>
  <div class="space-y-5">
    <div>
      <label class="text-xs font-semibold uppercase tracking-wide text-slate-500" for="countrySearch">
        Search Countries & Presets
      </label>
      <input
        id="countrySearch"
        type="text"
        placeholder="Search..."
        class="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
      />
    </div>

    <div>
      <div class="flex items-center justify-between">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Countries & Presets</div>
        <div class="group relative">
          <svg class="h-4 w-4 text-slate-400 cursor-help" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"></circle>
            <path d="M12 7.5v.01M11.2 10.5h.8v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
          </svg>
          <div class="absolute right-0 z-10 mt-2 w-56 rounded-md bg-slate-900 px-3 py-2 text-xs text-white opacity-0 transition group-hover:opacity-100 pointer-events-none">
            Click arrow to expand historical presets. Use color picker for base country color.
          </div>
        </div>
      </div>
      <div
        id="countryList"
        class="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1"
      ></div>
    </div>

    <button
      id="resetCountryColors"
      class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
    >
      Reset All Colors
    </button>
  </div>
</aside>
```

### 3.4 CSS Additions (css/style.css)

```css
/* Tree node expansion animation */
.expand-btn {
  transition: transform 0.2s ease-in-out;
}

.country-tree-node {
  transition: box-shadow 0.15s ease;
}

.country-tree-node:hover {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.preset-list {
  max-height: 300px;
  overflow-y: auto;
}

/* Smooth preset list appearance */
.preset-list[style*="block"] {
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

## Section 4: Python Pipeline Updates

### 4.1 Update Constants in `init_map_data.py`

Replace the existing constants:

```python
# France Arrondissements URL
FR_ARR_URL = "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/arrondissements.geojson"

# Départements requiring arrondissement-level granularity
DRILL_DOWN_DEPTS = [
    # Alsace-Lorraine + Savoy-Nice (8)
    "06", "54", "57", "67", "68", "73", "74", "88",
    # Vichy France Demarcation Line (13)
    "01", "03", "16", "18", "24", "33", "37", "39", "40", "41", "64", "71", "86",
    # TNO Burgundy Seine River Line (5)
    "27", "76", "77", "78", "95",
]

# NUTS-3 IDs to remove (replaced by arrondissements)
REMOVE_NUTS_IDS = [
    # Alsace-Lorraine + Savoy-Nice
    "FRL03", "FRF31", "FRF33", "FRF11", "FRF12", "FRK27", "FRK28", "FRF34",
    # Vichy France Demarcation Line
    "FRK21", "FRK11", "FRI31", "FRB01", "FRI11", "FRI12", "FRB04", "FRC22",
    "FRI13", "FRB05", "FRI15", "FRC13", "FRI34",
    # TNO Burgundy Seine River Line
    "FRD21", "FRD22", "FR102", "FR103", "FR108",
]
```

### 4.2 Expected Feature Counts

| Category | NUTS-3 Removed | Arrondissements Added | Net Change |
|----------|----------------|----------------------|------------|
| Alsace-Lorraine | 5 | ~25 | +20 |
| Savoy-Nice | 3 | ~15 | +12 |
| Vichy Line | 13 | ~40 | +27 |
| Burgundy/Seine | 5 | ~15 | +10 |
| **Total** | **26** | **~95** | **+69** |

---

## Section 5: TODO - Preset Region Population

### 5.1 Alsace-Lorraine (1871) - HIGH PRIORITY

**Task**: Map arrondissement codes to German/French control

```javascript
// TODO: Research which arrondissements were in Reichsland
const alsaceLorraineGerman = {
  // Moselle - ALL German
  "FR_ARR_57001": "#1a1a1a", // Boulay-Moselle
  "FR_ARR_57002": "#1a1a1a", // Château-Salins
  "FR_ARR_57003": "#1a1a1a", // Forbach-Bouzonville
  "FR_ARR_57004": "#1a1a1a", // Metz
  "FR_ARR_57005": "#1a1a1a", // Sarrebourg
  "FR_ARR_57006": "#1a1a1a", // Sarreguemines
  "FR_ARR_57007": "#1a1a1a", // Thionville-Est
  "FR_ARR_57008": "#1a1a1a", // Thionville-Ouest
  // Bas-Rhin - ALL German
  // ... to be populated
  // Haut-Rhin - ALL EXCEPT Belfort
  // ... to be populated
  // Meurthe-et-Moselle - PARTIAL
  // ... to be researched
};
```

### 5.2 Vichy Demarcation Line (1940) - HIGH PRIORITY

**Task**: Map arrondissements to Occupied/Free zones

```javascript
// TODO: Research demarcation line at arrondissement level
const vichyOccupied = {
  // Gironde - Occupied (Atlantic Wall)
  // Landes - Occupied (Atlantic Wall)
  // Pyrénées-Atlantiques - Occupied (Atlantic Wall)
  // Charente - Split
  // Cher - Split along Cher River
  // ... to be populated
};

const vichyFree = {
  // Southern portions of split départements
  // ... to be populated
};
```

### 5.3 TNO Burgundy - MEDIUM PRIORITY

**Task**: Define Seine River boundary

```javascript
// TODO: Define fictional Burgundy territory
const tnoBurgundy = {
  // Seine-Maritime - Rouen area
  // Eure - Vernon area
  // Parts of Île-de-France
  // ... to be researched from TNO sources
};
```

---

## Section 6: Testing Checklist

### 6.1 Python Pipeline

- [ ] `init_map_data.py` runs without errors with expanded DRILL_DOWN_DEPTS
- [ ] All 26 NUTS-3 features removed
- [ ] ~95 arrondissement features added
- [ ] TopoJSON file size < 4 MB
- [ ] No ID collisions
- [ ] All features have valid `cntr_code = "FR"`

### 6.2 Frontend UI

- [ ] Tree menu renders all countries
- [ ] Expand/collapse arrows work
- [ ] Search filters both countries and presets
- [ ] Color pickers update country colors
- [ ] "Apply" buttons trigger `applyPreset()`
- [ ] Empty presets show warning alert

### 6.3 Preset Functionality

- [ ] Alsace-Lorraine preset colors correct regions
- [ ] Vichy preset colors demarcation line regions
- [ ] Clear map removes all preset colors
- [ ] Preset application triggers border recalculation

---

## Appendix A: Arrondissement Code Reference

### A.1 Vichy Line Départements

**01 - Ain** (Demarcation Line runs through):
- 01001 Bourg-en-Bresse (split)
- 01002 Gex (Free Zone)
- 01003 Nantua (Free Zone)
- 01004 Belley (Free Zone)

**18 - Cher** (Split along Cher River):
- 18001 Bourges (Free Zone)
- 18002 Saint-Amand-Montrond (Free Zone)
- 18003 Vierzon (Occupied Zone)

**41 - Loir-et-Cher** (Split):
- 41001 Blois (split - north occupied)
- 41002 Romorantin-Lanthenay (Free Zone)
- 41003 Vendôme (Occupied Zone)

### A.2 Seine Line Départements (TNO Burgundy)

**77 - Seine-et-Marne**:
- 77001 Fontainebleau
- 77002 Meaux
- 77003 Melun
- 77004 Provins
- 77005 Torcy

**78 - Yvelines**:
- 78001 Mantes-la-Jolie
- 78002 Rambouillet
- 78003 Saint-Germain-en-Laye
- 78004 Versailles

---

## Appendix B: Quick Verification Commands

```bash
# Count features by type after regeneration
python -c "
import json
t = json.load(open('data/europe_topology.json'))
pol = t['objects']['political']['geometries']
arr = [g for g in pol if str(g['properties'].get('id','')).startswith('FR_ARR_')]
fr_nuts = [g for g in pol if str(g['properties'].get('id','')).startswith('FR') and not str(g['properties'].get('id','')).startswith('FR_ARR_')]
print(f'France NUTS-3: {len(fr_nuts)}')
print(f'France Arrondissements: {len(arr)}')
print(f'Total political: {len(pol)}')
"

# List all arrondissement IDs
python -c "
import json
t = json.load(open('data/europe_topology.json'))
pol = t['objects']['political']['geometries']
arr_ids = sorted([g['properties']['id'] for g in pol if str(g['properties'].get('id','')).startswith('FR_ARR_')])
for aid in arr_ids:
    print(aid)
"
```

---

*End of Phase 3.5 Specification*
