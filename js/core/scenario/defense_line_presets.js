import { resolveDataUrl } from "../data_base_url.js";

let payloadPromise;

export function loadDefenseLinePresets({ fetchImpl = globalThis.fetch } = {}) {
  if (!payloadPromise) {
    payloadPromise = Promise.resolve().then(async () => {
      const response = await fetchImpl(resolveDataUrl("data/operational_presets/defense_lines.json"));
      if (!response.ok) throw new Error(`Defense line presets: ${response.status}`);
      return response.json();
    }).catch((error) => {
      payloadPromise = undefined;
      throw error;
    });
  }
  return payloadPromise;
}

export function buildScenarioDefenseLineEntries(payload, scenarioId, existingLines, { language } = {}) {
  const existingIds = new Set(existingLines.map((line) => line.id));
  return (payload?.scenarios?.[scenarioId] || []).filter(
    (line) => !existingIds.has(`preset_${scenarioId}_${line.id}`)
  ).map((line) => ({
    id: `preset_${scenarioId}_${line.id}`,
    kind: "defensive_line",
    stylePreset: "defensive_line",
    label: language === "zh" ? line.label_zh : line.label_en,
    points: line.points.map((point) => [...point]),
    stroke: null,
    width: 0,
    opacity: 1,
    attachedCounterIds: [],
  }));
}
