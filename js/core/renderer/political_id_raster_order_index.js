export function orderPoliticalIdRasterEntries(originalEntries, foregroundIds) {
  const layers = [[], [], []];
  for (const entry of originalEntries) {
    layers[foregroundIds.has(entry.id) ? 2 : entry.baseTier].push(entry);
  }
  return layers[0].concat(layers[1], layers[2]);
}

export function createPoliticalIdRasterOrderIndex(original, entryById, foregroundIds) {
  const originalEntries = original.map(({ id }) => entryById.get(id));
  return { originalEntries, entryById, foregroundIds };
}

export function updatePoliticalIdRasterOrder(index, foregroundIds) {
  const changedMembers = new Set();
  for (const id of index.foregroundIds) if (!foregroundIds.has(id)) changedMembers.add(id);
  for (const id of foregroundIds) if (!index.foregroundIds.has(id)) changedMembers.add(id);
  if (!changedMembers.size) return { index, dirtyBounds: [] };
  for (const id of changedMembers) if (!index.entryById.has(id)) return null;

  const entries = orderPoliticalIdRasterEntries(index.originalEntries, foregroundIds);
  const entryById = new Map(), dirtyBounds = [];
  let maxPreviousPosition = -1;
  for (let drawOrder = 0; drawOrder < entries.length; drawOrder++) {
    const previous = index.entryById.get(entries[drawOrder].id);
    // A promotion and demotion can cross a third member that keeps its numeric position.
    if (changedMembers.has(previous.id) && (previous.drawOrder !== drawOrder || maxPreviousPosition > drawOrder)) {
      dirtyBounds.push(Object.freeze({ id: previous.id, oldBounds: previous.bounds, newBounds: previous.bounds,
        previousCoverageUnknown: previous.bounds === null }));
    }
    maxPreviousPosition = Math.max(maxPreviousPosition, previous.drawOrder);
    entries[drawOrder] = previous.drawOrder === drawOrder ? previous : Object.freeze({ ...previous, drawOrder });
    entryById.set(previous.id, entries[drawOrder]);
  }
  if (!dirtyBounds.length) return { index: { ...index, foregroundIds }, dirtyBounds };
  return { index: { ...index, entryById, foregroundIds }, entries: Object.freeze(entries), dirtyBounds };
}
