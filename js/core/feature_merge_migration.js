// Saved-project migration across political feature merges.
// The lineage lists applied merge plans in order; a plan with "scenarios"
// applies only there. A saved ID may be a source leaf or an earlier merged
// feature, so each resolves through every later merge to its final feature.

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export function resolveFeatureMergeLineage(lineage, scenarioId = "") {
  const next = new Map();
  const leaves = new Map();
  for (const plan of Array.isArray(lineage?.plans) ? lineage.plans : []) {
    if (Array.isArray(plan?.scenarios) && !plan.scenarios.includes(scenarioId)) continue;
    for (const [mergedId, members] of Object.entries(isRecord(plan?.groups) ? plan.groups : {})) {
      if (!Array.isArray(members)) continue;
      leaves.set(mergedId, new Set(members.flatMap((member) => [...(leaves.get(member) || [member])])));
      members.forEach((member) => next.set(member, mergedId));
    }
  }
  const resolve = (id) => {
    let current = id;
    while (next.has(current)) current = next.get(current);
    return current;
  };
  return { isMerged: (id) => next.has(id), resolve, leavesOf: (id) => leaves.get(id) || new Set([id]) };
}

// A merged feature takes a saved value only when the saved IDs cover all of its
// leaves with one identical value; anything else is dropped. Missing paint on a
// member means its default, not consent to copy a neighbour's edit.
export function migrateMergedFeatureProjectData(data, lineage, validFeatureIds) {
  const { isMerged, resolve, leavesOf } = lineage;
  const summary = { migratedEntries: 0, droppedEntries: 0, createdEntries: 0 };
  const targetOf = (id) => {
    if (typeof id !== "string" || validFeatureIds.has(id) || !isMerged(id)) return null;
    const target = resolve(id);
    return validFeatureIds.has(target) ? target : null;
  };
  const covers = (sources, target) => {
    const found = new Set(sources.flatMap((source) => [...leavesOf(source)]));
    return [...leavesOf(target)].every((leaf) => found.has(leaf));
  };
  const groupByTarget = (ids) => {
    const groups = new Map();
    ids.forEach((id) => {
      const target = targetOf(id);
      if (target) groups.set(target, [...(groups.get(target) || []), id]);
    });
    return groups;
  };

  function remapEntries(entries) {
    if (!isRecord(entries)) return entries;
    const groups = groupByTarget(Object.keys(entries));
    const moved = new Set([...groups.values()].flat());
    const result = Object.fromEntries(Object.entries(entries).filter(([id]) => !moved.has(id)));
    for (const [target, sources] of groups) {
      const value = JSON.stringify(entries[sources[0]]);
      if (!Object.hasOwn(result, target) && covers(sources, target)
        && sources.every((source) => JSON.stringify(entries[source]) === value)) {
        result[target] = entries[sources[0]];
        summary.migratedEntries += sources.length;
        summary.createdEntries += 1;
      } else {
        summary.droppedEntries += sources.length;
      }
    }
    return result;
  }
  function remapList(ids) {
    if (!Array.isArray(ids)) return ids;
    const groups = groupByTarget(ids);
    const moved = new Set([...groups.values()].flat());
    const result = ids.filter((id) => !moved.has(id));
    for (const [target, sources] of groups) {
      if (covers(sources, target)) {
        result.push(target);
        summary.migratedEntries += sources.length;
      } else {
        summary.droppedEntries += sources.length;
      }
    }
    return [...new Set(result)];
  }
  // A point anchor inside a member stays inside the merged feature.
  function remapAnchor(id) {
    const target = targetOf(id);
    if (!target) return id;
    summary.migratedEntries += 1;
    return target;
  }

  const result = { ...data, visualOverrides: remapEntries(data.visualOverrides) };
  if (isRecord(data.customPresets)) {
    result.customPresets = Object.fromEntries(Object.entries(data.customPresets).map(([country, presets]) => [
      country, Array.isArray(presets) ? presets.map((preset) => isRecord(preset) ? { ...preset, ids: remapList(preset.ids) } : preset) : presets,
    ]));
  }
  if (isRecord(data.specialZoneLayers)) {
    const zones = data.specialZoneLayers;
    result.specialZoneLayers = {
      ...zones,
      ...(Array.isArray(zones.layers) ? { layers: zones.layers.map((layer) => isRecord(layer)
        ? { ...layer, memberFeatureIds: remapList(layer.memberFeatureIds) } : layer) } : {}),
      ...(Array.isArray(zones.storySteps) ? { storySteps: zones.storySteps.map((step) => isRecord(step)
        ? { ...step, focusFeatureId: remapAnchor(step.focusFeatureId) } : step) } : {}),
    };
  }
  if (Array.isArray(data.unitCounters)) {
    result.unitCounters = data.unitCounters.map((counter) => !isRecord(counter) ? counter : {
      ...counter,
      ...(isRecord(counter.anchor) ? { anchor: { ...counter.anchor, featureId: remapAnchor(counter.anchor.featureId) } } : {}),
      ...(counter.layoutAnchor?.kind === "feature" ? { layoutAnchor: { ...counter.layoutAnchor, key: remapAnchor(counter.layoutAnchor.key) } } : {}),
    });
  }
  return { data: result, summary };
}

// Feature IDs a saved project references, to decide whether the lineage is needed.
export function collectProjectFeatureIds(data) {
  const ids = Object.keys(isRecord(data?.visualOverrides) ? data.visualOverrides : {});
  Object.values(isRecord(data?.customPresets) ? data.customPresets : {}).flat()
    .forEach((preset) => Array.isArray(preset?.ids) && ids.push(...preset.ids));
  (data?.specialZoneLayers?.layers || []).forEach((layer) => Array.isArray(layer?.memberFeatureIds) && ids.push(...layer.memberFeatureIds));
  (data?.specialZoneLayers?.storySteps || []).forEach((step) => ids.push(step?.focusFeatureId));
  (Array.isArray(data?.unitCounters) ? data.unitCounters : []).forEach((counter) => {
    ids.push(counter?.anchor?.featureId);
    if (counter?.layoutAnchor?.kind === "feature") ids.push(counter.layoutAnchor.key);
  });
  return ids.filter((id) => typeof id === "string" && id);
}
