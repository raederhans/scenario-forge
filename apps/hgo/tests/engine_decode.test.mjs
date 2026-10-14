import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {webcrypto} from 'node:crypto';
import {loadDataset} from '../src/data/dataset.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('ID decoding reuses its owned buffer while preserving little-endian words', async () => {
  const core = {schemaVersion:1, entities:[{tag:'AAA',color:'#123456'}],
    states:[{id:1,name:'Land',entityTag:'AAA',anchor:[0,0]}],
    provinceIds:[null,...Array.from({length:257},(_,i)=>i)],
    provinceStateIds:[null,...Array(257).fill(1)]};
  const decoded = Buffer.from([1,1,1,0,0,0]);
  const bytes = {core:Buffer.from(JSON.stringify(core)),ids:gzipSync(decoded)};
  const assets = {};
  for (const [name,body] of Object.entries(bytes)) assets[name] = {
    url:name,byteLength:body.length,encoding:name==='ids'?'gzip':'json',
    sha256:Buffer.from(await crypto.subtle.digest('SHA-256',body)).toString('hex'),
    ...(name==='ids'?{decodedByteLength:decoded.length}:{}),
  };
  const manifest = {format:'hgo-native-dataset',schemaVersion:1,id:'decode',revision:'r1',
    coordinateSpace:{width:3,height:1,kind:'pixel',origin:'top-left',wrapX:false},assets};
  const NativeBytes = globalThis.Uint8Array;
  let decompressedBuffer;
  class TrackedBytes extends NativeBytes {
    constructor(...args) {
      super(...args);
      if (args[0] === decoded.length) decompressedBuffer = this.buffer;
    }
  }
  let dataset;
  try {
    globalThis.Uint8Array = TrackedBytes;
    dataset = await loadDataset('https://test.local/manifest.json', {fetchImpl:async url =>
      new Response(url.endsWith('manifest.json')?JSON.stringify(manifest):bytes[url.split('/').at(-1)])});
  } finally {
    globalThis.Uint8Array = NativeBytes;
  }
  assert.ok(decompressedBuffer);
  assert.equal(dataset.ids.buffer,decompressedBuffer,'no second full raster allocation');
  assert.deepEqual([...dataset.ids],[257,1,0]);
  assert.equal(dataset.ids.byteLength,decoded.length);
});
