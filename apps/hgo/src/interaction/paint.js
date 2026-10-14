import {hitTest} from './hit.js';

// Owner is the dataset's original country, not its controller or core claims.
export function createPaintScopes(dataset) {
  const byOwner=new Map();
  for(const state of dataset.core.states){
    if(!byOwner.has(state.entityTag))byOwner.set(state.entityTag,[]);
    byOwner.get(state.entityTag).push(String(state.id));
  }
  return (id,scope='state')=>{
    const state=dataset.stateById.get(String(id));
    if(!state)throw new Error('Unknown state ID');
    if(!['state','country'].includes(scope))throw new Error('Invalid paint scope');
    // WTR is a shared water reference, not one worldwide country.
    return scope==='country'&&state.entityTag!=='WTR'
      ? byOwner.get(state.entityTag) : [String(id)];
  };
}

// Clip and walk only the pointer segment, never scan the map or all states.
export function tracePaintStates(dataset,from,to) {
  const {width,height}=dataset.manifest.coordinateSpace;
  const dx=to[0]-from[0],dy=to[1]-from[1];
  let low=0,high=1;
  for(const [origin,delta,max]of [[from[0],dx,width],[from[1],dy,height]]){
    if(!delta){if(origin<0||origin>=max)return [];continue;}
    const a=(0-origin)/delta,b=(max-1e-6-origin)/delta;
    low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
  }
  if(low>high)return [];
  const start=[from[0]+dx*low,from[1]+dy*low],end=[from[0]+dx*high,from[1]+dy*high];
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(end[0]-start[0]),Math.abs(end[1]-start[1]))));
  const states=new Set();
  for(let i=0;i<=steps;i++){
    const hit=hitTest(dataset,start[0]+(end[0]-start[0])*i/steps,start[1]+(end[1]-start[1])*i/steps);
    if(hit)states.add(hit.stateId);
  }
  return [...states];
}
