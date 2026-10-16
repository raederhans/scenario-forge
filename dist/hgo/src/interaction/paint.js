import {hitTest} from './hit.js';

// Membership follows current document ownership, never fill colours or claims.
export function createPaintScopes(dataset,document) {
  const byOwner=new Map();let revision;
  const owner=id=>document?.owner?document.owner(id):dataset.stateById.get(String(id)).entityTag;
  function refresh(){
    const next=document?.ownerRevision??0;if(revision===next)return;
    byOwner.clear();
    for(const state of dataset.core.states){
      const tag=owner(state.id);
      if(!byOwner.has(tag))byOwner.set(tag,[]);
      byOwner.get(tag).push(String(state.id));
    }
    revision=next;
  }
  return (id,scope='state')=>{
    const state=dataset.stateById.get(String(id));
    if(!state)throw new Error('Unknown state ID');
    if(!['state','country'].includes(scope))throw new Error('Invalid paint scope');
    // WTR is a shared water reference, not one worldwide country.
    if(scope==='state'||owner(id)==='WTR')return [String(id)];
    refresh();return byOwner.get(owner(id)).slice();
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
