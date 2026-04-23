const facadeState = {
  getBorderMeshOwner: null,
};

function readBorderOwner() {
  const getter = facadeState.getBorderMeshOwner;
  if (typeof getter !== 'function') {
    throw new Error('[facade_border_runtime] Missing getBorderMeshOwner runtime getter.');
  }
  return getter();
}

export function configureBorderRuntimeFacade(nextState = {}) {
  Object.assign(facadeState, nextState);
}

export function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {
  return readBorderOwner().buildOwnerBorderMesh(runtimeTopology, ownershipContext, { excludeSea });
}

export function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {
  return readBorderOwner().buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext);
}

export function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {
  return readBorderOwner().countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext);
}

export function buildDetailAdmBorderMesh(topology, includedCountries) {
  return readBorderOwner().buildDetailAdmBorderMesh(topology, includedCountries);
}

export function buildCountryParentBorderMeshes(countryCode) {
  return readBorderOwner().buildCountryParentBorderMeshes(countryCode);
}

export function getSourceCountrySets() {
  return readBorderOwner().getSourceCountrySets();
}

export function buildSourceBorderMeshes(topology, includedCountries) {
  return readBorderOwner().buildSourceBorderMeshes(topology, includedCountries);
}

export function buildGlobalCountryBorderMesh(primaryTopology) {
  return readBorderOwner().buildGlobalCountryBorderMesh(primaryTopology);
}

export function resolveCoastlineTopologySource() {
  return readBorderOwner().resolveCoastlineTopologySource();
}

export function buildGlobalCoastlineMesh(primaryTopology) {
  return readBorderOwner().buildGlobalCoastlineMesh(primaryTopology);
}

export function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {
  return readBorderOwner().simplifyCoastlineMesh(mesh, { epsilon, minLength });
}