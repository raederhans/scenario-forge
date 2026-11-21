import { getParentMergedParents } from './parent_merged_presentation.js';

export function createCountryLabelCoverageOwner({ state, peekSource, resolveBorderIdentity,
  getBorderPaletteRevision = () => state.sovereignBaseColors }) {
  let members = null, countries, parents, paletteRevision;
  const identityById = new Map();
  const countsByCode = new Map();
  const suppressed = new Set();
  let signature = '';

  function update(id, code) {
    const resolved = resolveBorderIdentity(id, members.featureById.get(id));
    const identity = parents.get(resolved) === code ? code : resolved;
    const counts = countsByCode.get(code);
    if (identityById.has(id)) {
      const previous = identityById.get(id);
      if (previous === identity) return;
      const remaining = counts.get(previous) - 1;
      if (remaining) counts.set(previous, remaining);
      else counts.delete(previous);
    }
    identityById.set(id, identity);
    counts.set(identity, (counts.get(identity) || 0) + 1);
    const uniformRecolor = counts.size === 1 && /^color:#[0-9a-f]{6}$/.test(identity);
    const hide = !counts.has(code) && !uniformRecolor;
    if (hide !== suppressed.has(code)) {
      if (hide) suppressed.add(code);
      else suppressed.delete(code);
      signature = null;
    }
  }

  function invalidate() {
    members = null;
    identityById.clear();
    countsByCode.clear();
    suppressed.clear();
    signature = '';
  }

  function getSuppressedCodes() {
    const source = state.activeScenarioId && peekSource();
    const current = source?.status === 'ready' ? source.memberIndex : null;
    const revision = current && getBorderPaletteRevision();
    if (members !== current || countries !== state.scenarioCountriesByTag || paletteRevision !== revision) {
      invalidate();
      members = current;
      countries = state.scenarioCountriesByTag;
      paletteRevision = revision;
      if (members) {
        parents = getParentMergedParents(countries);
        for (const code of members.memberCountByCode.keys()) countsByCode.set(code, new Map());
        for (const [id, code] of members.groupCodeById) update(id, code);
      }
    }
    return suppressed;
  }

  return {
    getSuppressedCodes,
    getSignature() {
      getSuppressedCodes();
      return signature ??= [...suppressed].sort().join(',');
    },
    notifyColorsChanged(ids) {
      if (!members || countries !== state.scenarioCountriesByTag) return;
      if (paletteRevision !== getBorderPaletteRevision()) {
        invalidate();
        return;
      }
      for (const id of ids) {
        const code = members.groupCodeById.get(id);
        if (code) update(id, code);
      }
    },
    invalidate,
  };
}
