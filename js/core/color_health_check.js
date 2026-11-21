import { ColorManager } from "./color_manager.js";
import { getFeatureId } from "./feature_identity.js";
import { createPaletteOwnerResolver, getPaletteCountryTargets } from "./palette_country_targets.js";

function getNeighborGraph(state) {
  if (state.runtimeFeatureIds?.length && state.runtimeFeatureIds.length === state.runtimeNeighborGraph?.length
      && state.runtimeNeighborGraph.some(row => row?.length)) {
    return { ids: state.runtimeFeatureIds, rows: state.runtimeNeighborGraph };
  }
  const political = (state.runtimePoliticalTopology || state.topology)?.objects?.political;
  const geometries = political?.geometries || [];
  if (!geometries.length) return { ids: state.runtimeFeatureIds || [], rows: state.runtimeNeighborGraph || [] };
  return {
    ids: geometries.map(geometry => getFeatureId(geometry)),
    rows: political?.computed_neighbors || globalThis.topojson?.neighbors(geometries) || [],
  };
}

function collectComponent(start, ids, rows, owners, visited) {
  visited.add(start);
  const component = [];
  const stack = [start];
  while (stack.length) {
    const index = stack.pop();
    component.push(ids[index]);
    for (const j of rows[index] || []) {
      if (owners[j] !== owners[start] || visited.has(j)) continue;
      visited.add(j);
      stack.push(j);
    }
  }
  return component;
}

export function checkColorHealth(state) {
  const resolveOwner = createPaletteOwnerResolver(state);
  const { ids, rows } = getNeighborGraph(state);
  const owners = ids.map(id => resolveOwner(id));
  const anchors = new Map();
  const borders = new Map();
  const components = new Map();
  const visited = new Set();
  for (const members of getPaletteCountryTargets(state).values()) {
    for (const id of members) {
      const owner = resolveOwner(id);
      if (!anchors.has(owner) || (state.landIndex?.has(id) && !state.landIndex.has(anchors.get(owner)))) {
        anchors.set(owner, id);
      }
    }
  }
  for (const [i, owner] of owners.entries()) {
    if (!owner || !rows[i]) continue;
    if (!owner.startsWith("color:")) {
      for (const j of rows[i]) {
        const other = owners[j];
        if (other && other !== owner && !other.startsWith("color:")) {
          const key = [owner, other].sort().join("|");
          if (!borders.has(key)) borders.set(key, [ids[i], ids[j]]);
        }
      }
      continue;
    }
    if (visited.has(i)) continue;
    const component = collectComponent(i, ids, rows, owners, visited);
    if (!components.has(owner)) components.set(owner, []);
    components.get(owner).push(component);
  }

  const countries = [...anchors.keys()].filter(code =>
    ColorManager.normalizeHexColor(state.sovereignBaseColors?.[code]));
  const issues = [];
  for (const [i, a] of countries.entries()) {
    for (const b of countries.slice(i + 1)) {
      const distance = ColorManager.deltaE(state.sovereignBaseColors[a], state.sovereignBaseColors[b]);
      if (distance >= 3) continue;
      const border = borders.get([a, b].sort().join("|"));
      issues.push({ type: "pair", a, b, distance, adjacent: !!border,
        featureIds: border || [anchors.get(a), anchors.get(b)] });
    }
  }
  issues.sort((a, b) => Number(b.adjacent) - Number(a.adjacent) || a.distance - b.distance);
  for (const [owner, parts] of components) {
    parts.sort((a, b) => b.length - a.length);
    for (const featureIds of parts.slice(1)) {
      if (featureIds.length <= 3) issues.push({ type: "fragment", color: owner.slice(6), featureIds });
    }
  }
  return issues;
}
