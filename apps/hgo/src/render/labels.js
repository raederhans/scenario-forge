const WORLD_CELL = 256, SCREEN_CELL = 48;
const BUDGETS = {low:96, medium:180, high:300};
const TEXT_WIDTH_LIMIT = 1024;
const overlaps = (a,b) => a[0]<b[2] && a[2]>b[0] && a[1]<b[3] && a[3]>b[1];
function hash(value) {
  let result = 2166136261;
  for (let i=0;i<value.length;i++) result = Math.imul(result ^ value.charCodeAt(i),16777619);
  return (result >>> 0) / 4294967296;
}
function cells(box,size,visit) {
  for (let y=Math.floor(box[1]/size);y<=Math.floor(box[3]/size);y++) {
    for (let x=Math.floor(box[0]/size);x<=Math.floor(box[2]/size);x++) visit(`${x},${y}`);
  }
}

export function createLabelLayout(dataset) {
  const world = new Map(),countryWorld = new Map();
  const textWidths = new Map();
  let measurementContext = null;
  let previous = new Set();
  let countryDocument=null,countryRevision;
  function add(index,kind,id,source,x,y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = `${kind}:${id}`, cell = `${Math.floor(x/WORLD_CELL)},${Math.floor(y/WORLD_CELL)}`;
    const entry = {id:key,kind,source,x,y,threshold:.05+.9*hash(key)};
    if (!index.has(cell)) index.set(cell,[]);
    index.get(cell).push(entry);
  }
  for (const state of dataset.core.states) add(world,'state',state.id,state,...state.anchor);
  function indexCountries(document) {
    const dynamic=typeof document.countries==='function',revision=document.ownerRevision;
    if(countryDocument===document&&countryRevision===revision&&(!dynamic||Number.isFinite(revision)))return;
    countryWorld.clear();
    const sources=dynamic?document.countries():dataset.core.entities;
    for(const country of sources){
      if(country.anchor&&country.kind!=='water'&&country.tag!=='WTR'&&(!dynamic||country.stateCount>0))add(countryWorld,'country',country.tag,country,...country.anchor);
    }
    countryDocument=document;countryRevision=revision;
  }
  for (const [index,place] of (dataset.places || []).entries()) add(world,'city',`${place.stateId}:${place.name}:${index}`,place,place.x,place.y);

  function layout(document,view,layers,width,height,measureText=(text,size) => text.length*size*.6) {
    indexCountries(document);
    const budget = BUDGETS[layers.labelDensity] || BUDGETS.medium;
    if (!(view.scale>0) || !(width>0) || !(height>0)) { previous = new Set(); return []; }
    const margin = 32/view.scale;
    const bounds = [view.x-width/2/view.scale-margin,view.y-height/2/view.scale-margin,
      view.x+width/2/view.scale+margin,view.y+height/2/view.scale+margin];
    const candidates = [];
    // Query whichever is smaller: visible cells or the occupied index. This keeps
    // very far zoom-out bounded by metadata size, without scanning native pixels.
    const consider = entries => {
      for (const entry of entries) {
        const {source,kind} = entry;
        if (kind === 'city' ? !layers.cities : !layers.labels) continue;
        const x=(entry.x-view.x)*view.scale+width/2, anchorY=(entry.y-view.y)*view.scale+height/2;
        if (x<0 || anchorY<0 || x>width || anchorY>height) continue;
        const custom = kind === 'state' && document.labels[source.id];
        const capital = kind === 'city' && source.isCapital === true;
        const text = String(custom || source.name || '').trim();
        if (!text) continue;
        const area = Math.max(1,source.pixelCount || 1)*view.scale*view.scale;
        const eligibility = custom ? 1 : capital ? .85+.15*view.scale/(view.scale+.7)
          : kind === 'country' ? 1/(1+(view.scale/1.4)**4)
          : kind === 'city' ? view.scale/(view.scale+.7)
          : (area/(area+900))*(view.scale/(view.scale+.3));
        const retained = previous.has(entry.id), threshold = entry.threshold-(retained?.08:0);
        if (eligibility<threshold) continue;
        candidates.push({...entry,text,x,y:anchorY-(kind==='city'?16:0),anchorY,
          size:kind==='country'?13:kind==='city'?11:12,bold:!!custom || capital || kind==='country',
          markerRadius:kind==='city'?(capital?3.5:2.3):0,
          priority:custom?0:capital?1:kind==='country'?2:kind==='city'?3:4,
          alpha:Math.min(1,Math.max(0,(eligibility-entry.threshold+.08)/.18)),retained});
      }
    };
    const cellCount = (Math.floor(bounds[2]/WORLD_CELL)-Math.floor(bounds[0]/WORLD_CELL)+1)
      *(Math.floor(bounds[3]/WORLD_CELL)-Math.floor(bounds[1]/WORLD_CELL)+1);
    for(const index of [world,countryWorld]){
      if(cellCount>index.size){for(const entries of index.values())consider(entries);}
      else cells(bounds,WORLD_CELL,key=>{const entries=index.get(key);if(entries)consider(entries);});
    }
    candidates.sort((a,b) => a.priority-b.priority || Number(b.retained)-Number(a.retained)
      || a.threshold-b.threshold || (a.id<b.id?-1:a.id>b.id?1:0));
    const occupied = new Map(), accepted = [];
    for (const candidate of candidates) {
      if (accepted.length>=budget) break;
      const textWidth = measureText(candidate.text,candidate.size,candidate.bold);
      const boxes = [[candidate.x-textWidth/2-3,candidate.y-candidate.size/2-2,
        candidate.x+textWidth/2+3,candidate.y+candidate.size/2+2]];
      if (candidate.markerRadius) {
        const radius=candidate.markerRadius+2;
        boxes.push([candidate.x-radius,candidate.anchorY-radius,candidate.x+radius,candidate.anchorY+radius]);
      }
      let collision = false;
      for (const box of boxes) cells(box,SCREEN_CELL,key => {
        if ((occupied.get(key)||[]).some(other => overlaps(box,other))) collision=true;
      });
      if (collision) continue;
      for (const box of boxes) cells(box,SCREEN_CELL,key => {
        if (!occupied.has(key)) occupied.set(key,[]);
        occupied.get(key).push(box);
      });
      accepted.push({...candidate,boxes});
    }
    previous = new Set(accepted.map(entry => entry.id));
    return accepted;
  }

  function draw(canvas,document,view,layers,pixelRatio=1,{clear=true}={}) {
    const ctx=canvas.getContext('2d'), width=canvas.width/pixelRatio, height=canvas.height/pixelRatio;
    if (measurementContext!==ctx) { textWidths.clear(); measurementContext=ctx; }
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0); if (clear) ctx.clearRect(0,0,width,height);
    const font = (size,bold) => `${bold?'600':'500'} ${size}px system-ui, sans-serif`;
    const entries=layout(document,view,layers,width,height,(text,size,bold) => {
      // Font sizes stay in CSS pixels during zoom; only anchors move. Reuse
      // widths (including rejected candidates), with bounded storage for edits.
      const face=font(size,bold), key=`${face}\n${text}`;
      let textWidth=textWidths.get(key);
      if (textWidth===undefined) {
        ctx.font=face; textWidth=ctx.measureText(text).width;
        if (textWidths.size>=TEXT_WIDTH_LIMIT) textWidths.delete(textWidths.keys().next().value);
        textWidths.set(key,textWidth);
      }
      return textWidth;
    });
    ctx.textAlign='center'; ctx.textBaseline='middle';
    for (const entry of entries) {
      ctx.globalAlpha=entry.alpha;
      if (entry.markerRadius) {
        ctx.beginPath(); ctx.arc(entry.x,entry.anchorY,entry.markerRadius,0,Math.PI*2);
        ctx.fillStyle='#17232e'; ctx.fill(); ctx.strokeStyle='#fff8df'; ctx.lineWidth=1; ctx.stroke();
      }
      ctx.font=font(entry.size,entry.bold); ctx.lineWidth=3; ctx.strokeStyle='rgba(255,255,245,.86)';
      ctx.strokeText(entry.text,entry.x,entry.y); ctx.fillStyle='#152027'; ctx.fillText(entry.text,entry.x,entry.y);
    }
    ctx.globalAlpha=1;
    return entries;
  }
  return {layout,draw};
}
