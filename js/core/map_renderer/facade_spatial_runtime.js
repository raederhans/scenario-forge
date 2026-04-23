const facadeState = {
  getSpatialIndexRuntimeOwner: null,
};

function readSpatialOwner() {
  const getter = facadeState.getSpatialIndexRuntimeOwner;
  if (typeof getter !== 'function') {
    throw new Error('[facade_spatial_runtime] Missing getSpatialIndexRuntimeOwner runtime getter.');
  }
  return getter();
}

export function configureSpatialRuntimeFacade(nextState = {}) {
  Object.assign(facadeState, nextState);
}

export function buildIndex({ scheduleUiMode = 'immediate' } = {}) {
  return readSpatialOwner().buildIndex({ scheduleUiMode });
}

export function buildSpatialIndex({
  includeSecondary = true,
  allowComputeMissingBounds = true,
} = {}) {
  return readSpatialOwner().buildSpatialIndex({
    includeSecondary,
    allowComputeMissingBounds,
  });
}

export const buildIndexChunked = (...args) => readSpatialOwner().buildIndexChunked(...args);

export const buildSpatialIndexChunked = (...args) =>
  readSpatialOwner().buildSpatialIndexChunked(...args);