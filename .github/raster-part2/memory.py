from pathlib import Path
p = Path('js/core/renderer/political_id_raster_display_cache.js')
s = p.read_text()
old = '  let canvas = null, context = null, previous = null, disposed = false;'
assert s.count(old) == 1
s = s.replace(old, '''  let canvas = null, context = null, previous = null, disposed = false;
  // A presentation snapshot must not retain evicted CPU tile buffers. Tokens
  // have no backlink to their tile; the original byte-bounded LRU owns payloads.
  const tileTokens = new WeakMap();
  function tokenFor(tile) {
    let token = tileTokens.get(tile);
    if (!token) { token = {}; tileTokens.set(tile, token); }
    return token;
  }''')
old = '''    const sameTiles = sameGrid && previous.tiles.length === tiles.length
      && tiles.every((tile, index) => tile === previous.tiles[index]);'''
assert s.count(old)==1
s = s.replace(old, '''    const tokens = tiles.map(tokenFor);
    const sameTiles = sameGrid && previous.tokens.length === tokens.length
      && tokens.every((token, index) => token === previous.tokens[index]);''')
old = 'density: plan.density }, tiles: [...tiles], revision, palette: palette.slice()'
assert s.count(old)==1
s=s.replace(old, 'density: plan.density }, tokens, revision, palette: palette.slice()')
p.write_text(s)
p = Path('tests/political_id_raster_display_cache_behavior.test.mjs')
s=p.read_text()+'''

test("presentation tokens do not retain a tile after the authoritative cache releases it", {skip:typeof globalThis.gc!=="function"}, async () => {
  const context = {save(){},restore(){},setTransform(){},clearRect(){},drawImage(){}};
  const cache = createPoliticalIdRasterDisplayCache({createCanvas:(width,height)=>({width,height,getContext:()=>context})});
  let tile = {originX:0,originY:0,width:10,height:10,codes:new Uint32Array(1024)};
  const reference = new WeakRef(tile);
  cache.draw({gpu:{canvas:{},draw(){}},plan:{width:10,height:10,originX:0,originY:0,density:1},
    tiles:[tile],palette:new Uint8Array(8),revision:1,dependencies:()=>Uint32Array.of(1)});
  tile=null;
  for(let attempt=0;attempt<20;attempt++) {
    await new Promise(resolve=>setImmediate(resolve));
    globalThis.gc();
    if(reference.deref()===undefined)break;
  }
  assert.equal(reference.deref(),undefined,"cached presentation must not own old CPU tile payloads");
  assert.ok(cache.getStats().retainedSurfaceBytes>0,"the RGBA frame remains independently reusable");
  cache.dispose();
});
'''
p.write_text(s)
p=Path('docs/active/political-raster-part2-20261012.md')
s=p.read_text()+'''

Presentation identity uses WeakMap tokens rather than retaining tile objects. This prevents the RGBA cache from extending the lifetime of evicted CPU buffers during geometry replacement. An explicit --expose-gc regression verifies that a released tile can be collected while the presentation frame remains cached; ordinary test runs report that GC-specific case as skipped when GC is unavailable, not as passed.
'''
p.write_text(s)
print('Applied non-owning presentation identity and GC regression.')
