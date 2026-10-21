const SCREEN_CELL = 40, GAP = 2, EDGE_PADDING = 2, MAX_DISPLACEMENT = 30;
const RESOURCE_COLORS = Object.freeze({resource_steel:'#526f88',resource_oil:'#784f91',
  resource_aluminium:'#337c91',resource_tungsten:'#9b682e',resource_chromium:'#788138',resource_rubber:'#347a59'});
const compareIds = (a,b) => Number(a.stateId)-Number(b.stateId) || a.stateId.localeCompare(b.stateId);
export const resourceSymbolColor = metricId => RESOURCE_COLORS[metricId] || '#526f88';

/** Native atlas scale, CSS pixels. All values share this coefficient. */
export function resourceSymbolMaxRadius(scale) {
  if (!Number.isFinite(scale) || scale<=0) return 0;
  return 10+8*Math.max(0,Math.min(1,Math.log2(scale/.25)/2));
}

/** Filled circle area is proportional to value, including arbitrarily small values. */
export function resourceSymbolRadius(value,maxValue,scale) {
  if (!Number.isFinite(value) || value<=0 || !Number.isFinite(maxValue) || maxValue<=0) return 0;
  return resourceSymbolMaxRadius(scale)*Math.sqrt(value/maxValue);
}

function cells(entry,visit) {
  const r=entry.radius+GAP/2;
  for(let y=Math.floor((entry.y-r)/SCREEN_CELL);y<=Math.floor((entry.y+r)/SCREEN_CELL);y++) {
    for(let x=Math.floor((entry.x-r)/SCREEN_CELL);x<=Math.floor((entry.x+r)/SCREEN_CELL);x++)visit(`${x},${y}`);
  }
}
function insert(grid,entry) {
  cells(entry,key=>{if(!grid.has(key))grid.set(key,new Set());grid.get(key).add(entry);});
}
function remove(grid,entry) {
  cells(entry,key=>{const bucket=grid.get(key);bucket?.delete(entry);if(bucket?.size===0)grid.delete(key);});
}
function collides(grid,entry,diagnostics) {
  const extent=entry.radius+GAP/2;
  const left=Math.floor((entry.x-extent)/SCREEN_CELL),right=Math.floor((entry.x+extent)/SCREEN_CELL);
  const top=Math.floor((entry.y-extent)/SCREEN_CELL),bottom=Math.floor((entry.y+extent)/SCREEN_CELL);
  // A candidate only needs one blocking neighbour. A few repeated comparisons
  // across cells cost less than allocating a deduplication Set for every probe.
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++) {
    const bucket=grid.get(`${x},${y}`);
    if(!bucket)continue;
    for(const other of bucket) {
      if(other===entry)continue;
      diagnostics.collisionChecks++;
      const radius=entry.radius+other.radius+GAP;
      if((entry.x-other.x)**2+(entry.y-other.y)**2<radius*radius)return true;
    }
  }
  return false;
}
function offsets(stateId) {
  // The same 65 candidates cover the disk instead of four coarse radial rings.
  // Increasing radius tries shorter leaders first; the ID phase stays stable.
  const phase=(Number(stateId)%16)*Math.PI/8,result=[[0,0]],goldenAngle=Math.PI*(3-Math.sqrt(5));
  for(let step=1;step<=64;step++) {
    const distance=MAX_DISPLACEMENT*Math.sqrt(step/64),angle=phase+step*goldenAngle;
    result.push([Math.cos(angle)*distance,Math.sin(angle)*distance]);
  }
  return result;
}
function box(entry) {
  const r=entry.radius+EDGE_PADDING;
  return [entry.x-r,entry.y-r,entry.x+r,entry.y+r];
}
function fits(entry,width,height) {
  const bounds=box(entry);
  return bounds[0]>=0&&bounds[1]>=0&&bounds[2]<=width&&bounds[3]<=height;
}

/** Resource markers use state anchors, never inferred mine or deposit locations.
 * Payloads and dataset metadata are immutable inputs; replacing a payload rebuilds its index.
 */
export function createMetricSymbolLayout(dataset) {
  let cache=new WeakMap(),anchors=null,indexBuildCount=0;
  function index(payload,metricId) {
    if(!Object.hasOwn(RESOURCE_COLORS,metricId))throw new RangeError(`Not a resource metric: ${metricId}`);
    let metrics=payload&&typeof payload==='object'?cache.get(payload):null;
    if(metrics?.has(metricId))return {index:metrics.get(metricId),cacheHit:true};
    if(!anchors)anchors=new Map((dataset?.core?.states||[]).map(state=>[String(state.id),state.anchor]));
    const result={entries:[],sourceCount:0,missingCount:0,zeroCount:0,invalidAnchorCount:0,
      positiveCount:0,maxValue:0,canonical:null};
    for(const [stateId,record] of Object.entries(payload?.states||{})) {
      result.sourceCount++;
      const value=record?.values?.[metricId];
      if(typeof value!=='number'||!Number.isFinite(value)||value<0){result.missingCount++;continue;}
      if(value===0){result.zeroCount++;continue;}
      result.positiveCount++;result.maxValue=Math.max(result.maxValue,value);
      const anchor=anchors.get(stateId);
      if(!Array.isArray(anchor)||anchor.length!==2||!anchor.every(Number.isFinite)){result.invalidAnchorCount++;continue;}
      result.entries.push({stateId,value,worldX:anchor[0],worldY:anchor[1],sourceRecord:record,candidates:offsets(stateId)});
    }
    result.entries.sort(compareIds);
    // Reserve tight native-anchor neighbourhoods before isolated symbols. This
    // small positive-only pair scan runs once per payload/metric, never per frame.
    // Radius-weighted inverse squared distance estimates neighbouring pressure;
    // one native pixel in the denominator also handles coincident anchors.
    const ranked=result.entries.map(entry=>({entry,weight:Math.sqrt(entry.value),density:0}));
    for(let i=0;i<ranked.length;i++)for(let j=i+1;j<ranked.length;j++) {
      const a=ranked[i],b=ranked[j];
      const distance=1+(a.entry.worldX-b.entry.worldX)**2+(a.entry.worldY-b.entry.worldY)**2;
      a.density+=b.weight/distance;b.density+=a.weight/distance;
    }
    ranked.sort((a,b)=>b.density-a.density||b.entry.value-a.entry.value||compareIds(a.entry,b.entry));
    result.entries=ranked.map(row=>row.entry);indexBuildCount++;
    if(payload&&typeof payload==='object') {
      if(!metrics){metrics=new Map();cache.set(payload,metrics);}
      metrics.set(metricId,result);
    }
    return {index:result,cacheHit:false};
  }
  function canonical(source,scale,diagnostics) {
    if(source.canonical?.scale===scale)return source.canonical.entries;
    const grid=new Map(),entries=[];
    for(const row of source.entries) {
      const entry={...row,anchorX:row.worldX*scale,anchorY:row.worldY*scale,
        radius:resourceSymbolRadius(row.value,source.maxValue,scale),x:0,y:0,crowded:false};
      let placed=false;
      for(const [dx,dy] of row.candidates) {
        diagnostics.candidateChecks++;
        entry.x=entry.anchorX+dx;entry.y=entry.anchorY+dy;
        if(!collides(grid,entry,diagnostics)){placed=true;break;}
      }
      if(!placed){entry.x=entry.anchorX;entry.y=entry.anchorY;entry.crowded=true;}
      insert(grid,entry);entries.push(entry);
    }
    source.canonical={scale,entries};return entries;
  }
  function layout(payload,metricId,view,width,height) {
    const {index:source,cacheHit}=index(payload,metricId),scale=view?.scale;
    const diagnostics={candidateChecks:0,collisionChecks:0};
    const valid=Number.isFinite(scale)&&scale>0&&Number.isFinite(view?.x)&&Number.isFinite(view?.y)
      &&Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0;
    const legendRadius=value=>resourceSymbolRadius(value,source.maxValue,valid?scale:0);
    const result={metricId,entries:[],boxes:[],visibleCount:0,displacedCount:0,crowdedCount:0,
      maxValue:source.maxValue,legendValues:source.maxValue?[source.maxValue/16,source.maxValue/4,source.maxValue]:[],
      legendRadius,maxRadius:valid?resourceSymbolMaxRadius(scale):0,scale:valid?scale:0,
      maxDisplacement:MAX_DISPLACEMENT,sourceCount:source.sourceCount,positiveCount:source.positiveCount,
      missingCount:source.missingCount,zeroCount:source.zeroCount,invalidAnchorCount:source.invalidAnchorCount,
      cacheHit,indexBuildCount,diagnostics};
    if(!valid)return result;
    const translateX=width/2-view.x*scale,translateY=height/2-view.y*scale;
    // Every positive row participates in this small grid, including just-offscreen
    // neighbours. Canonical offsets therefore stay unchanged during ordinary pans.
    const entries=canonical(source,scale,diagnostics).map(entry=>({...entry,
      x:entry.x+translateX,y:entry.y+translateY,anchorX:entry.anchorX+translateX,anchorY:entry.anchorY+translateY}));
    const grid=new Map();for(const entry of entries)insert(grid,entry);
    for(const entry of entries) {
      const anchorVisible=entry.anchorX>=0&&entry.anchorX<=width&&entry.anchorY>=0&&entry.anchorY<=height;
      const circleVisible=entry.x+entry.radius>=0&&entry.x-entry.radius<=width&&entry.y+entry.radius>=0&&entry.y-entry.radius<=height;
      if(!anchorVisible&&!circleVisible)continue;
      if(!fits(entry,width,height)) {
        remove(grid,entry);
        let placed=false;
        // Closest feasible alternative to the canonical offset limits edge jumps.
        const preferredX=entry.x,preferredY=entry.y;
        const inset=entry.radius+EDGE_PADDING;
        const candidates=entry.candidates.map(([dx,dy],order)=>{
          // Replace the origin probe with its nearest padded screen position.
          // The disk need not happen to sample the exact inward edge direction.
          if(order===0) {
            dx=Math.max(inset,Math.min(width-inset,entry.anchorX))-entry.anchorX;
            dy=Math.max(inset,Math.min(height-inset,entry.anchorY))-entry.anchorY;
          }
          return {dx,dy,order,distance:(entry.anchorX+dx-preferredX)**2+(entry.anchorY+dy-preferredY)**2};
        })
          .sort((a,b)=>a.distance-b.distance||a.order-b.order);
        for(const {dx,dy} of candidates) {
          diagnostics.candidateChecks++;entry.x=entry.anchorX+dx;entry.y=entry.anchorY+dy;
          if(dx*dx+dy*dy<=MAX_DISPLACEMENT**2+1e-7&&fits(entry,width,height)&&!collides(grid,entry,diagnostics)){placed=true;break;}
        }
        if(!placed){entry.x=entry.anchorX;entry.y=entry.anchorY;entry.crowded=true;}
        insert(grid,entry);
      }
      result.entries.push(entry);
    }
    for(const entry of result.entries) {
      entry.crowded=entry.crowded||collides(grid,entry,diagnostics);
      entry.displaced=Math.hypot(entry.x-entry.anchorX,entry.y-entry.anchorY)>1e-7;
      entry.leader=entry.displaced?[entry.anchorX,entry.anchorY,entry.x,entry.y]:null;
      entry.box=box(entry);
      if(entry.crowded)result.crowdedCount++;
      if(entry.displaced)result.displacedCount++;
      // Internal candidates and source coordinates are not needed by renderers.
      delete entry.candidates;delete entry.worldX;delete entry.worldY;
    }
    // Paint large circles first, leaving small quantities visible on top.
    result.entries.sort((a,b)=>b.radius-a.radius||compareIds(a,b));
    result.boxes=result.entries.map(entry=>entry.box);result.visibleCount=result.entries.length;
    return result;
  }
  function draw(canvas,result,pixelRatio=1,{opacity=1,selectedIds=[]}={}) {
    const ctx=canvas.getContext('2d');if(!ctx)return result;
    const alpha=Number.isFinite(opacity)?Math.max(0,Math.min(1,opacity)):1;
    const selected=new Set([...selectedIds].map(String));
    ctx.save();ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    ctx.strokeStyle='#46576b';ctx.lineWidth=.8;ctx.globalAlpha=alpha*.7;
    for(const entry of result.entries)if(entry.leader) {
      ctx.beginPath();ctx.moveTo(entry.anchorX,entry.anchorY);ctx.lineTo(entry.x,entry.y);ctx.stroke();
    }
    ctx.fillStyle=resourceSymbolColor(result.metricId);
    for(const entry of result.entries) {
      ctx.globalAlpha=alpha*(entry.crowded?.42:.82);
      ctx.beginPath();ctx.arc(entry.x,entry.y,entry.radius,0,Math.PI*2);ctx.fill();
      if(selected.has(entry.stateId)) {
        ctx.globalAlpha=alpha;ctx.strokeStyle='#fff3ad';ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(entry.x,entry.y,entry.radius+2,0,Math.PI*2);ctx.stroke();
      }
    }
    ctx.restore();return result;
  }
  return {layout,draw,release(){cache=new WeakMap();anchors=null;}};
}
