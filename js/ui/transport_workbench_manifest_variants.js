function getNormalizedVariants(manifest) {
  const variants = manifest?.variants;
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    return null;
  }
  return variants;
}

function buildContractError(familyId, reason) {
  const normalizedFamilyId = String(familyId || "transport").trim() || "transport";
  return new Error(`[transport-workbench] ${normalizedFamilyId} manifest ${reason}.`);
}

export function listTransportWorkbenchManifestVariantEntries(manifest) {
  const variants = getNormalizedVariants(manifest);
  return variants ? Object.entries(variants) : [];
}

export function getTransportWorkbenchManifestDefaultVariantId(manifest, familyId = "") {
  const variants = getNormalizedVariants(manifest);
  if (!variants) {
    throw buildContractError(familyId, "is missing shared variants");
  }
  const candidate = String(manifest?.default_variant || "").trim();
  if (candidate && variants[candidate]) {
    return candidate;
  }
  const [firstVariantId] = Object.keys(variants);
  if (firstVariantId) {
    return String(firstVariantId).trim();
  }
  throw buildContractError(familyId, "does not expose any shared variants");
}

export function resolveTransportWorkbenchManifestVariantId(manifest, requestedVariantId, familyId = "") {
  const variants = getNormalizedVariants(manifest);
  if (!variants) {
    throw buildContractError(familyId, "is missing shared variants");
  }
  const requestedId = String(requestedVariantId || "").trim();
  if (requestedId && variants[requestedId]) {
    return requestedId;
  }
  return getTransportWorkbenchManifestDefaultVariantId(manifest, familyId);
}

export function getTransportWorkbenchManifestVariantMeta(manifest, variantId, familyId = "") {
  const variants = getNormalizedVariants(manifest);
  if (!variants) {
    throw buildContractError(familyId, "is missing shared variants");
  }
  const normalizedVariantId = String(variantId || "").trim();
  if (!normalizedVariantId) {
    return null;
  }
  return variants[normalizedVariantId] || null;
}
