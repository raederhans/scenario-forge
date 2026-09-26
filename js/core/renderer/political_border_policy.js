export function isPoliticalBorderEnabled(state) {
  const semanticMode = String(state?.mapSemanticMode || '').trim().toLowerCase();
  const scenarioId = String(state?.activeScenarioId || '').trim();
  if (semanticMode === 'blank' || scenarioId === 'blank_base') return false;

  const setting = String(state?.styleConfig?.empireBorders?.political || 'auto').trim().toLowerCase();
  if (setting === 'off') return false;
  if (setting === 'on') return true;
  return !!scenarioId;
}

// Separation is a scene property, not visibility: turning country borders off
// must not reveal the same edges again as different-color paint contours.
export function separatesPoliticalBorders(state) {
  const mode = String(state?.mapSemanticMode || '').trim().toLowerCase();
  const scenario = String(state?.activeScenarioId || '').trim();
  if (mode === 'blank' || scenario === 'blank_base') return false;
  const setting = String(state?.styleConfig?.empireBorders?.political || 'auto').trim().toLowerCase();
  return !!scenario || setting === 'on' || setting === 'off';
}
