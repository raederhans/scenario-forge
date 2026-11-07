export function resolveInspectorDrillStep({ current, hit, findGroup, detail = 1 }) {
  if (detail >= 2) return current;
  const countryCode = hit.countryCode;
  if (!current.countryCode || current.countryCode !== countryCode) {
    return { level: "country", countryCode };
  }
  const group = findGroup(countryCode, hit.featureId);
  if (group && group.children.length > 1
      && (current.level === "country" || current.groupId !== group.id)) {
    return { level: "group", countryCode, group };
  }
  return { level: "feature", countryCode, group, featureId: hit.featureId };
}

export function resolveInspectorStepUp({ current, findGroup }) {
  if (!current.countryCode) return null;
  if (current.level === "feature") {
    const group = findGroup(current.countryCode, current.featureId);
    if (group) return { level: "group", countryCode: current.countryCode, group };
  }
  return { level: "country", countryCode: current.level === "country" || !current.level ? "" : current.countryCode };
}
