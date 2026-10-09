export const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function createDocument(dataset) {
  let paint = {}, labels = {}, past = [], future = [], saved = JSON.stringify({paint, labels});
  const snapshot = () => ({paint:{...paint}, labels:{...labels}});
  const signature = () => JSON.stringify({paint, labels});
  function commit(next) { if (JSON.stringify(next) === signature()) return false; past.push(snapshot()); if (past.length > 200) past.shift(); future = []; ({paint, labels} = next); return true; }
  function ids(values) { if (!Array.isArray(values) || values.some(id => !dataset.stateById.has(String(id)))) throw new Error('Unknown state ID'); return values.map(String); }
  return {
    get paint() { return paint; }, get labels() { return labels; }, get dirty() { return signature() !== saved; },
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    color(id) { const s = dataset.stateById.get(String(id)); return paint[id] || dataset.entityByTag.get(s.entityTag).color; },
    validateIds: ids,
    paintStates(values, color) { const keys = ids(values); if (!validColor(color)) throw new Error('Invalid paint color'); const next = snapshot(); for (const id of keys) next.paint[id] = color.toLowerCase(); return commit(next); },
    label(id, text) { ids([id]); if (typeof text !== 'string' || text.length > 200) throw new Error('Invalid label'); const next = snapshot(); if (text.trim()) next.labels[id] = text.trim(); else delete next.labels[id]; return commit(next); },
    undo() { if (!past.length) return false; future.push(snapshot()); ({paint,labels} = past.pop()); return true; },
    redo() { if (!future.length) return false; past.push(snapshot()); ({paint,labels} = future.pop()); return true; },
    markSaved() { saved = signature(); },
    serialize(view, layers) { return {format:'scenario-forge-hgo', schemaVersion:1, dataset:{id:dataset.manifest.id, revision:dataset.manifest.revision}, coordinateSpace:'hgo-pixel', ...snapshot(), view:{...view}, layers:{...layers}}; },
    load(payload) {
      const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!plain(p) || p.format !== 'scenario-forge-hgo' || p.schemaVersion !== 1 || p.dataset?.id !== dataset.manifest.id || p.dataset?.revision !== dataset.manifest.revision || p.coordinateSpace !== 'hgo-pixel') throw new Error('Project does not match this HGO dataset');
      if (!plain(p.paint) || !plain(p.labels)) throw new Error('Invalid project edits');
      ids(Object.keys(p.paint)); ids(Object.keys(p.labels));
      if (Object.values(p.paint).some(c => !validColor(c)) || Object.values(p.labels).some(t => typeof t !== 'string' || t.length > 200)) throw new Error('Invalid project paint or labels');
      if (!plain(p.view) || !['x','y','scale'].every(k => Number.isFinite(p.view[k])) || p.view.scale <= 0 || p.view.scale > 128 || Math.abs(p.view.x) > dataset.manifest.coordinateSpace.width * 10 || Math.abs(p.view.y) > dataset.manifest.coordinateSpace.height * 10) throw new Error('Invalid project view');
      if (!plain(p.layers) || !['borders','labels','cities'].every(k => typeof p.layers[k] === 'boolean') || Object.keys(p.layers).some(k => !['borders','labels','cities'].includes(k))) throw new Error('Invalid project layers');
      paint = {...p.paint}; labels = {...p.labels}; past = []; future = []; saved = signature();
      return {view:{x:p.view.x,y:p.view.y,scale:p.view.scale},layers:{...p.layers}};
    }
  };
}
