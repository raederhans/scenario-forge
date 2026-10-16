export const validCountryTag = tag => typeof tag === 'string' && /^[A-Z0-9]{3}$/.test(tag) && tag !== 'WTR';
export const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const isWaterState = (dataset,state) => state.entityTag === 'WTR' || dataset.entityByTag.get(state.entityTag)?.kind === 'water';
export function unionBounds(states) {
  let bounds = null;
  for (const state of states) {
    const box = state.bounds || (state.anchor && [...state.anchor,...state.anchor]);
    if (!box) continue;
    if (!bounds) bounds = [...box];
    else { bounds[0]=Math.min(bounds[0],box[0]); bounds[1]=Math.min(bounds[1],box[1]); bounds[2]=Math.max(bounds[2],box[2]); bounds[3]=Math.max(bounds[3],box[3]); }
  }
  return bounds;
}
export function createCountryIndex(dataset) {
  const cores = new Map();
  for (const state of dataset.stateById.values()) {
    if (isWaterState(dataset,state)) continue;
    for (const tag of new Set(state.coreTags || [])) {
      if (!validCountryTag(tag)) continue;
      if (!cores.has(tag)) cores.set(tag,[]);
      cores.get(tag).push(String(state.id));
    }
  }
  return {cores, validTarget:tag => validCountryTag(tag) && (cores.has(tag) || dataset.entityByTag.has(tag))};
}
function rgb(hex) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255); }
function lab(hex) {
  const [r,g,b]=rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;
  const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.072175*b),z=f((.0193339*r+.119192*g+.9503041*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
export function colorDistance(a,b) { const x=lab(a),y=lab(b); return Math.hypot(...x.map((v,i)=>v-y[i])); }
function hsl(hex) {
  const [r,g,b]=rgb(hex),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  if (!d) return [0,0,l];
  const h=max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4;
  return [h/6,d/(1-Math.abs(2*l-1)),l];
}
function fromHsl(h,s,l) {
  const a=s*Math.min(l,1-l),f=n=>{const k=(n+h*12)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return '#'+[0,8,4].map(n=>Math.round(f(n)*255).toString(16).padStart(2,'0')).join('');
}
// Fixed hue and finite lightness/saturation candidates; Delta E76 is a screening
// heuristic, not a visibility or accessibility guarantee. No random recoloring.
export function suggestCountryColor(parentColor,tag,nearbyColors=[]) {
  const [h,s,l]=hsl(parentColor), variants=[];
  const flip=[...tag].reduce((n,c)=>n+c.charCodeAt(0),0)%2?1:-1;
  for (const delta of [.12*flip,-.12*flip,.22*flip,-.22*flip]) {
    for (const factor of [.9,1]) variants.push(fromHsl(h,s*factor,Math.max(.08,Math.min(.92,l+delta))));
  }
  const colors=[parentColor,...nearbyColors.filter(validColor)], unique=[...new Set(variants)].filter(color=>color!==parentColor.toLowerCase());
  const score=color=>Math.min(...colors.map(other=>colorDistance(color,other)));
  const qualifying=unique.find(color=>score(color)>=12);
  const chosen=qualifying || unique.sort((a,b)=>score(b)-score(a))[0];
  return {color:chosen,conflict:!qualifying,alternatives:unique.slice(0,4)};
}
