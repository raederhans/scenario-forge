import {readLayers} from '../render/settings.js';
import {createCountryIndex,isWaterState,validCountryTag,validColor,unionBounds,suggestCountryColor} from './countries.js';
export {validColor};
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function createDocument(dataset) {
  let paint = {}, labels = {}, owners = {}, palette = {}, createdCountries = {}, past = [], future = [], stroke = null, revision = 0, ownerRevision = 0;
  const index = createCountryIndex(dataset);
  let countryCacheRevision = -1, countryCache = [];
  const snapshot = () => ({paint:{...paint}, labels:{...labels},owners:{...owners},palette:{...palette},createdCountries:Object.fromEntries(Object.entries(createdCountries).map(([tag,entry])=>[tag,{...entry}]))});
  const signature = () => JSON.stringify({paint, labels, owners, palette, createdCountries});
  let saved = signature();
  function assign(next) {
    if (JSON.stringify(owners)!==JSON.stringify(next.owners) || JSON.stringify(createdCountries)!==JSON.stringify(next.createdCountries)) ownerRevision++;
    ({paint, labels, owners, palette, createdCountries} = next); revision++;
  }
  function commit(next) { if (JSON.stringify(next) === signature()) return false; remember(snapshot()); assign(next); return true; }
  function ids(values) { if (!Array.isArray(values) || values.some(id => !dataset.stateById.has(String(id)))) throw new Error('Unknown state ID'); return values.map(String); }
  function remember(before) { past.push(before); if (past.length > 200) past.shift(); future = []; }
  function cancelPaintStroke() {
    if (!stroke) return false;
    const changed = !!stroke.before;
    if (changed) assign(stroke.before);
    stroke = null;
    return changed;
  }
  function endPaintStroke() {
    if (!stroke) return false;
    const before = stroke.before;
    stroke = null;
    if (!before) return false;
    remember(before);
    return true;
  }
  function owner(id) { const key=String(id),state=dataset.stateById.get(key); if (!state) throw new Error('Unknown state ID'); return owners[key] ?? state.entityTag; }
  function countryColor(tag) { const color=palette[tag] ?? dataset.entityByTag.get(tag)?.color; if (!color) throw new Error('Unknown country'); return color; }
  function knownCountry(tag) { return dataset.entityByTag.has(tag) || Object.hasOwn(createdCountries,tag); }
  function editableCountry(tag) { if (!knownCountry(tag) || tag==='WTR' || dataset.entityByTag.get(tag)?.kind==='water') throw new Error('Invalid country'); }
  function countryStates(tag) { return [...dataset.stateById.values()].filter(state=>owner(state.id)===tag); }
  function countries() {
    if (countryCacheRevision===revision) return countryCache.map(country=>({...country,stateIds:[...country.stateIds],anchor:country.anchor?[...country.anchor]:null,bounds:country.bounds?[...country.bounds]:null}));
    const groups=new Map([...dataset.entityByTag.keys(),...Object.keys(createdCountries)].map(tag=>[tag,[]]));
    for (const state of dataset.stateById.values()) groups.get(owner(state.id)).push(state);
    countryCache = [...groups].filter(([tag])=>tag!=='WTR' && dataset.entityByTag.get(tag)?.kind!=='water').map(([tag,states])=>{
      const base=dataset.entityByTag.get(tag), biggest=states.reduce((best,state)=>!best || (state.pixelCount||0)>(best.pixelCount||0)?state:best,null);
      return {tag,name:createdCountries[tag]?.name || base?.name || tag,color:countryColor(tag),stateIds:states.map(state=>String(state.id)),stateCount:states.length,
        // Entity anchors are not guaranteed to belong to capitalStateId. Use a
        // verified state anchor that remains owned, without sampling the raster.
        overrideCount:states.filter(state=>Object.hasOwn(paint,String(state.id))).length,anchor:biggest?.anchor?[...biggest.anchor]:null,
        bounds:unionBounds(states),pixelCount:states.reduce((n,state)=>n+(state.pixelCount||0),0)};
    });
    countryCacheRevision=revision;
    return countryCache.map(country=>({...country,stateIds:[...country.stateIds],anchor:country.anchor?[...country.anchor]:null,bounds:country.bounds?[...country.bounds]:null}));
  }
  function previewTransfer(parent,target) {
    if (stroke) throw new Error('Finish the paint stroke before preview');
    editableCountry(parent);
    if (!index.validTarget(target) || target===parent || dataset.entityByTag.get(target)?.kind==='water') throw new Error('Invalid core target');
    const stateIds=(index.cores.get(target)||[]).filter(id=>owner(id)===parent);
    if (!stateIds.length) throw new Error('No eligible core states');
    const states=stateIds.map(id=>dataset.stateById.get(id)), parentBefore=countryStates(parent).length, targetBefore=countryStates(target).length;
    const bounds=unionBounds(states), related=countries().filter(c=>c.bounds && bounds && c.bounds[0]<=bounds[2] && c.bounds[2]>=bounds[0] && c.bounds[1]<=bounds[3] && c.bounds[3]>=bounds[1]);
    const suggestion=knownCountry(target)?{color:countryColor(target),conflict:false,alternatives:[]}:suggestCountryColor(countryColor(parent),target,related.map(c=>c.color));
    return Object.freeze({revision,parent,target,stateIds:Object.freeze([...stateIds]),
      states:Object.freeze(states.map(state=>Object.freeze({id:String(state.id),name:labels[state.id] || state.name}))),
      parentBefore,parentRemaining:parentBefore-stateIds.length,targetBefore,targetAfter:targetBefore+stateIds.length,
      overrideCount:stateIds.filter(id=>Object.hasOwn(paint,id)).length,otherCoreCount:(index.cores.get(target)||[]).filter(id=>owner(id)!==parent && owner(id)!==target).length,
      tinyCount:states.filter(state=>(state.pixelCount||0)<50).length,suggestedColor:suggestion.color,colorConflict:suggestion.conflict,colorAlternatives:Object.freeze([...suggestion.alternatives]),
      targetName:createdCountries[target]?.name || dataset.entityByTag.get(target)?.name || target,isNew:!knownCountry(target),bounds:bounds?Object.freeze(bounds):null});
  }
  function candidates(parent) {
    editableCountry(parent);
    const counts=new Map();
    for (const state of countryStates(parent)) {
      if (isWaterState(dataset,state)) continue;
      for (const tag of new Set(state.coreTags||[])) if (validCountryTag(tag) && tag!==parent) counts.set(tag,(counts.get(tag)||0)+1);
    }
    return [...counts].map(([tag,stateCount])=>({tag,target:tag,name:createdCountries[tag]?.name || dataset.entityByTag.get(tag)?.name || tag,stateCount,isNew:!knownCountry(tag)})).sort((a,b)=>a.tag.localeCompare(b.tag));
  }
  return {
    get paint() { return paint; }, get labels() { return labels; }, get dirty() { return signature() !== saved; },
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    get revision() { return revision; }, get ownerRevision() { return ownerRevision; },
    owner,countryColor,countries,candidates,previewTransfer,
    color(id) { return paint[id] || countryColor(owner(id)); },
    setCountryColor(tag,color,{overridePaint=false}={}) {
      editableCountry(tag); if (!validColor(color)) throw new Error('Invalid paint color');
      if (typeof overridePaint!=='boolean') throw new Error('Invalid override policy');
      cancelPaintStroke(); const next=snapshot(); next.palette[tag]=color.toLowerCase();
      if (next.palette[tag]===dataset.entityByTag.get(tag)?.color.toLowerCase()) delete next.palette[tag];
      if (overridePaint) for (const state of countryStates(tag)) delete next.paint[state.id];
      return commit(next);
    },
    transfer(preview,{color,name,overridePaint=true}={}) {
      if (!plain(preview) || preview.revision!==revision) throw new Error('Stale transfer preview');
      const current=previewTransfer(preview.parent,preview.target);
      if (!Array.isArray(preview.stateIds) || JSON.stringify(preview.stateIds)!==JSON.stringify(current.stateIds)) throw new Error('Transfer scope changed');
      const target=current.target, selectedColor=color ?? current.suggestedColor, selectedName=name ?? current.targetName;
      if (!validColor(selectedColor) || typeof selectedName!=='string' || !selectedName.trim() || selectedName.length>200 || typeof overridePaint!=='boolean') throw new Error('Invalid country edits');
      if (current.targetBefore>0 && selectedColor.toLowerCase()!==countryColor(target).toLowerCase()) throw new Error('Existing target color must be changed separately');
      const next=snapshot();
      if (current.isNew || (Object.hasOwn(createdCountries,target) && name!==undefined)) next.createdCountries[target]={name:selectedName.trim(),source:'core-candidate'};
      if (current.isNew || current.targetBefore===0) next.palette[target]=selectedColor.toLowerCase();
      for (const id of current.stateIds) {
        if (dataset.stateById.get(id).entityTag===target) delete next.owners[id]; else next.owners[id]=target;
        if (overridePaint) delete next.paint[id];
      }
      return commit(next);
    },
    validateIds: ids,
    beginPaintStroke(color) {
      if (!validColor(color)) throw new Error('Invalid paint color');
      if (stroke) throw new Error('Paint stroke already active');
      stroke = {color:color.toLowerCase(), visited:new Set(), before:null};
      return true;
    },
    paintStrokeStates(values) {
      if (!stroke) throw new Error('No active paint stroke');
      const keys = ids(values);
      let changed = false;
      for (const id of keys) {
        if (stroke.visited.has(id)) continue;
        stroke.visited.add(id);
        if (paint[id] === stroke.color) continue;
        if (!stroke.before) stroke.before = snapshot();
        paint[id] = stroke.color;
        changed = true;
      }
      if (changed) revision++;
      return changed;
    },
    endPaintStroke, cancelPaintStroke,
    paintStates(values, color) { const keys = ids(values); if (!validColor(color)) throw new Error('Invalid paint color'); cancelPaintStroke(); const next = snapshot(); for (const id of keys) next.paint[id] = color.toLowerCase(); return commit(next); },
    label(id, text) { ids([id]); if (typeof text !== 'string' || text.length > 200) throw new Error('Invalid label'); cancelPaintStroke(); const next = snapshot(); if (text.trim()) next.labels[id] = text.trim(); else delete next.labels[id]; return commit(next); },
    undo() { cancelPaintStroke(); if (!past.length) return false; future.push(snapshot()); assign(past.pop()); return true; },
    redo() { cancelPaintStroke(); if (!future.length) return false; past.push(snapshot()); assign(future.pop()); return true; },
    markSaved() { endPaintStroke(); saved = signature(); },
    serialize(view, layers) { return {format:'scenario-forge-hgo', schemaVersion:2, dataset:{id:dataset.manifest.id, revision:dataset.manifest.revision}, coordinateSpace:'hgo-pixel', ...snapshot(), view:{...view}, layers:{...layers}}; },
    load(payload) {
      const parsed = typeof payload === 'string';
      const p = parsed ? JSON.parse(payload) : payload;
      if (!plain(p) || p.format !== 'scenario-forge-hgo' || ![1,2].includes(p.schemaVersion) || p.dataset?.id !== dataset.manifest.id || p.dataset?.revision !== dataset.manifest.revision || p.coordinateSpace !== 'hgo-pixel') throw new Error('Project does not match this HGO dataset');
      if (!plain(p.paint) || !plain(p.labels)) throw new Error('Invalid project edits');
      ids(Object.keys(p.paint)); ids(Object.keys(p.labels));
      if (Object.values(p.paint).some(c => !validColor(c)) || Object.values(p.labels).some(t => typeof t !== 'string' || t.length > 200)) throw new Error('Invalid project paint or labels');
      if (!plain(p.view) || !['x','y','scale'].every(k => Number.isFinite(p.view[k])) || p.view.scale <= 0 || p.view.scale > 128 || Math.abs(p.view.x) > dataset.manifest.coordinateSpace.width * 10 || Math.abs(p.view.y) > dataset.manifest.coordinateSpace.height * 10) throw new Error('Invalid project view');
      if (!plain(p.layers)) throw new Error('Invalid project layers');
      const layers = readLayers(p.layers);
      // Parsed JSON is private to this load; only caller-owned objects need copies.
      const next={paint:parsed?p.paint:{...p.paint},labels:parsed?p.labels:{...p.labels},owners:{},palette:{},createdCountries:{}};
      if (p.schemaVersion===2) {
        if (!plain(p.owners) || !plain(p.palette) || !plain(p.createdCountries)) throw new Error('Invalid country edits');
        for (const [tag,entry] of Object.entries(p.createdCountries)) {
          if (!validCountryTag(tag) || dataset.entityByTag.has(tag) || !index.cores.has(tag) || !plain(entry) || entry.source!=='core-candidate' || typeof entry.name!=='string' || !entry.name.trim() || entry.name.length>200 || Object.keys(entry).some(key=>!['name','source'].includes(key))) throw new Error('Invalid created country');
          next.createdCountries[tag]={name:entry.name.trim(),source:'core-candidate'};
        }
        const registered=tag=>tag!=='WTR' && (dataset.entityByTag.has(tag) || Object.hasOwn(next.createdCountries,tag)) && dataset.entityByTag.get(tag)?.kind!=='water';
        for (const [tag,color] of Object.entries(p.palette)) {
          if (!registered(tag) || !validColor(color)) throw new Error('Invalid country palette');
          next.palette[tag]=color.toLowerCase();
        }
        for (const tag of Object.keys(next.createdCountries)) if (!Object.hasOwn(next.palette,tag)) throw new Error('Created country needs a palette color');
        ids(Object.keys(p.owners));
        for (const [id,tag] of Object.entries(p.owners)) {
          if (!registered(tag) || isWaterState(dataset,dataset.stateById.get(id))) throw new Error('Invalid state owner');
          if (tag!==dataset.stateById.get(id).entityTag) next.owners[id]=tag;
        }
      } else if (['owners','palette','createdCountries'].some(key=>Object.hasOwn(p,key))) throw new Error('Schema 1 cannot contain country edits');
      stroke = null; assign(next); ownerRevision++; past = []; future = []; saved = signature();
      return {view:{x:p.view.x,y:p.view.y,scale:p.view.scale},layers};
    }
  };
}
