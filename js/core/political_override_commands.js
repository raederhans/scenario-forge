import { normalizeCountryCodeAlias as canonicalCountryCode } from "./country_code_aliases.js";
import { markDirty } from "./dirty_state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { isPoliticalDisplayModeActive } from "./political_display_mode.js";
import {
  listAllianceOptions, listIdeologyOptions, MAX_CUSTOM_ALLIANCES, normalizeCustomAlliance,
} from "./political_overrides.js";
import { state, callRuntimeHook } from "./state.js";
import { commitChange } from "./state/changes.js";

const scope = { politicalOverrides: true };
const issuedAllianceIds = new WeakMap();

function commitPoliticalEdit(kind, patch) {
  const wasActive = isPoliticalDisplayModeActive(state);
  const before = captureHistoryState(scope);
  Object.assign(state, patch);
  pushHistoryEntry({ kind, before, after: captureHistoryState(scope), meta: { scenarioId: state.activeScenarioId } });
  markDirty(kind);
  if (wasActive || isPoliticalDisplayModeActive(state)) callRuntimeHook(state, "refreshColorStateFn", { renderNow: true });
  commitChange({ domains: ["inspector", "appearance", "legend"], reason: kind });
  return true;
}

function setCountryField(rawTag, field, value) {
  const tag = canonicalCountryCode(rawTag);
  if (!Object.hasOwn(state.scenarioCountriesByTag || {}, tag)) return false;
  const entry = Object.hasOwn(state.politicalOverrides, tag) ? state.politicalOverrides[tag] : undefined;
  if (entry?.[field] === value) return false;
  return commitPoliticalEdit(`set-country-${field}`, {
    politicalOverrides: { ...state.politicalOverrides, [tag]: { ...entry, [field]: value } },
  });
}

export function setCountryAlliance(tag, id) {
  if (id !== null && !listAllianceOptions(state).some(option => option.id === id)) return false;
  return setCountryField(tag, "alliance", id);
}

export function setCountryIdeology(tag, id) {
  if (!listIdeologyOptions(state, tag).some(option => option.id === id)) return false;
  return setCountryField(tag, "ideology", id);
}

export function resetCountryPolitical(rawTag, field) {
  const tag = canonicalCountryCode(rawTag);
  if (!Object.hasOwn(state.politicalOverrides, tag)) return false;
  const { [tag]: entry, ...politicalOverrides } = state.politicalOverrides;
  if (field !== undefined) {
    if ((field !== "alliance" && field !== "ideology") || !Object.hasOwn(entry, field)) return false;
    const { [field]: removed, ...remaining } = entry;
    if (Object.keys(remaining).length) politicalOverrides[tag] = remaining;
  }
  return commitPoliticalEdit("reset-country-political", { politicalOverrides });
}

function getIssuedIds(alliances) {
  if (!issuedAllianceIds.has(alliances)) {
    issuedAllianceIds.set(alliances, new Set([...listAllianceOptions(state).map(option => option.id),
      ...Object.values(state.politicalOverrides).map(entry => entry.alliance)]));
  }
  return issuedAllianceIds.get(alliances);
}

export function createCustomAlliance(details) {
  const alliances = state.politicalAlliances;
  if (!state.activeScenarioId || Object.keys(alliances).length >= MAX_CUSTOM_ALLIANCES) return false;
  const entry = normalizeCustomAlliance(details, alliances);
  if (!entry) return false;
  const issued = getIssuedIds(alliances);
  for (let n = 1; n <= 99; n++) {
    const id = `custom_${n}`;
    if (issued.has(id)) continue;
    const politicalAlliances = { ...alliances, [id]: entry };
    issued.add(id);
    issuedAllianceIds.set(politicalAlliances, issued);
    commitPoliticalEdit("create-custom-alliance", { politicalAlliances });
    return id;
  }
  return false;
}

export function deleteCustomAlliance(id) {
  if (!Object.hasOwn(state.politicalAlliances, id)) return false;
  if (!listAllianceOptions(state).some(option => option.id === id && option.custom)) return false;
  const { [id]: removed, ...politicalAlliances } = state.politicalAlliances;
  issuedAllianceIds.set(politicalAlliances, getIssuedIds(state.politicalAlliances));
  const politicalOverrides = { ...state.politicalOverrides };
  for (const [tag, entry] of Object.entries(politicalOverrides)) {
    if (entry.alliance === id) politicalOverrides[tag] = { ...entry, alliance: null };
  }
  return commitPoliticalEdit("delete-custom-alliance", { politicalAlliances, politicalOverrides });
}
