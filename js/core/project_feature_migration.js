// Only a reviewed, baseline-bound manifest contract may enable geometry-changing migration.
// Area-overlap reports are evidence, not contracts accepted by this adapter.
function fail(code, details) {
  const error = new Error(`Project feature migration requires review: ${code}.`);
  error.code = "PROJECT_FEATURE_MIGRATION_REVIEW_REQUIRED";
  error.migrationDetails = { reason: code, ...details };
  error.userMessage = `${error.message} ${JSON.stringify(details)}`;
  throw error;
}

const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && value.length > 0 && value.trim() === value;

export function planProjectFeatureMigration(data, { manifest, validFeatureIds } = {}) {
  const contract = manifest?.project_feature_migration;
  if (contract == null) return null;
  if (!isRecord(contract) || contract.version !== 1 || !isId(contract.scenario_id)
    || !isId(contract.source_baseline_hash) || !isId(contract.target_baseline_hash)
    || contract.source_baseline_hash === contract.target_baseline_hash
    || !Array.isArray(contract.feature_id_prefixes) || !contract.feature_id_prefixes.length
    || !contract.feature_id_prefixes.every(isId) || !isRecord(contract.crosswalk)
    || !Array.isArray(contract.unresolved_ids) || !contract.unresolved_ids.every(isId)) {
    fail("invalid_contract", {});
  }
  if (contract.scenario_id !== data?.scenario?.id
    || contract.scenario_id !== manifest.scenario_id
    || contract.target_baseline_hash !== manifest.baseline_hash) {
    fail("target_baseline_mismatch", { scenarioId: data?.scenario?.id });
  }
  if (data.scenario.baselineHash === contract.target_baseline_hash) return null;
  if (data.scenario.baselineHash !== contract.source_baseline_hash) {
    fail("source_baseline_mismatch", { baselineHash: data.scenario.baselineHash || "" });
  }
  if (!(validFeatureIds instanceof Set) || !validFeatureIds.size) fail("missing_target_ids", {});
  const inScope = (id) => contract.feature_id_prefixes.some((prefix) => id.startsWith(prefix));
  const unresolved = new Set(contract.unresolved_ids);
  const sourcesByTarget = new Map();
  for (const [id, targets] of Object.entries(contract.crosswalk)) {
    if (!isId(id) || !inScope(id) || unresolved.has(id) || !Array.isArray(targets) || !targets.length
      || new Set(targets).size !== targets.length
      || targets.some((target) => !isId(target) || !inScope(target) || !validFeatureIds.has(target))) {
      fail("invalid_crosswalk", { sourceId: id });
    }
    for (const target of targets) {
      const sources = sourcesByTarget.get(target) || [];
      sources.push(id);
      sourcesByTarget.set(target, sources);
    }
  }
  if ([...unresolved].some((id) => !inScope(id))) fail("invalid_unresolved_ids", {});

  const issues = [];
  function resolveTargets(id, field) {
    if (typeof id !== "string" || !inScope(id)) return [id];
    const targets = Object.hasOwn(contract.crosswalk, id) ? contract.crosswalk[id] : null;
    if (unresolved.has(id) || !targets) {
      issues.push({ field, sourceId: id, reason: unresolved.has(id) ? "unresolved_source" : "unmapped_source" });
      return [];
    }
    return targets;
  }
  function remapMembers(ids, field) {
    return [...new Set(ids.flatMap((id) => resolveTargets(id, field)))];
  }
  function remapAnchor(id, field) {
    const targets = resolveTargets(id, field);
    if (targets.length > 1) {
      issues.push({ field, sourceId: id, targetIds: targets, reason: "ambiguous_spatial_anchor" });
    }
    return targets.length === 1 ? targets[0] : id;
  }
  const auxiliary = {};
  if (isRecord(data.specialZoneLayers)) {
    auxiliary.specialZoneLayers = { ...data.specialZoneLayers,
      topologyFingerprint: contract.target_baseline_hash,
      layers: (data.specialZoneLayers.layers || []).map((layer) => ({ ...layer,
        memberFeatureIds: remapMembers(layer.memberFeatureIds || [], `specialZoneLayers.${layer.id}.memberFeatureIds`),
      })),
      ...(Array.isArray(data.specialZoneLayers.storySteps) ? {
        storySteps: data.specialZoneLayers.storySteps.map((step) => ({ ...step,
          focusFeatureId: remapAnchor(step.focusFeatureId, `specialZoneLayers.storySteps.${step.id}.focusFeatureId`),
        })),
      } : {}),
    };
  }
  if (isRecord(data.customPresets)) {
    auxiliary.customPresets = Object.fromEntries(Object.entries(data.customPresets).map(([country, presets]) => [
      country, Array.isArray(presets) ? presets.map((preset) => ({ ...preset,
        ids: remapMembers(preset.ids || [], `customPresets.${country}.${preset.name}.ids`),
      })) : presets,
    ]));
  }
  if (Array.isArray(data.unitCounters)) {
    auxiliary.unitCounters = data.unitCounters.map((counter) => ({ ...counter,
      ...(counter.anchor ? { anchor: { ...counter.anchor,
        featureId: remapAnchor(counter.anchor.featureId, `unitCounters.${counter.id}.anchor.featureId`),
      } } : {}),
      ...(counter.layoutAnchor?.kind === "feature" ? { layoutAnchor: { ...counter.layoutAnchor,
        key: remapAnchor(counter.layoutAnchor.key, `unitCounters.${counter.id}.layoutAnchor.key`),
      } } : {}),
    }));
  }
  let migratedEntries = 0;
  function remap(entries, field) {
    const result = {};
    const contributors = new Map();
    for (const [id, value] of Object.entries(entries || {})) {
      if (!inScope(id)) {
        Object.defineProperty(result, id, { value, enumerable: true, configurable: true, writable: true });
        continue;
      }
      // A still-existing ID is also remapped: identity cannot establish unchanged geometry.
      const targets = Object.hasOwn(contract.crosswalk, id) ? contract.crosswalk[id] : null;
      if (unresolved.has(id) || !targets) {
        issues.push({ field, sourceId: id, reason: unresolved.has(id) ? "unresolved_source" : "unmapped_source" });
        continue;
      }
      if (typeof value !== "string") {
        issues.push({ field, sourceId: id, reason: "unsupported_value" });
        continue;
      }
      if (targets.length !== 1 || targets[0] !== id) migratedEntries += 1;
      for (const target of targets) {
        const previous = contributors.get(target);
        if (previous && previous.value !== value) {
          issues.push({ field, targetId: target, sourceIds: [...previous.ids, id], reason: "conflicting_values" });
        } else {
          contributors.set(target, { value, ids: [...(previous?.ids || []), id] });
          Object.defineProperty(result, target, { value, enumerable: true, configurable: true, writable: true });
        }
      }
    }
    // Missing paint means the source used its baseline/default, not consent to copy
    // another source's explicit edit across the merged target.
    for (const [target, contribution] of contributors) {
      const absentSources = sourcesByTarget.get(target).filter((id) => !Object.hasOwn(entries || {}, id));
      if (absentSources.length) {
        issues.push({ field, targetId: target, sourceIds: contribution.ids,
          absentSourceIds: absentSources, reason: "partial_merge_requires_review" });
      }
    }
    return result;
  }
  const sovereigntyByFeatureId = remap(data.sovereigntyByFeatureId, "sovereigntyByFeatureId");
  const visualOverrides = remap(data.visualOverrides || data.featureOverrides, "visualOverrides");
  if (issues.length) fail("ambiguous_or_unresolved_entries", { issues });
  return {
    data: { ...data, ...auxiliary, sovereigntyByFeatureId, visualOverrides, featureOverrides: { ...visualOverrides } },
    summary: { migratedEntries },
  };
}
