import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkBoundary} from '../tools/check_boundary.mjs';

test('static app boundary accepts a closed app and refuses remote or escaped imports',async()=>{
  const runtime=fileURLToPath(new URL('../../../.runtime/tmp/',import.meta.url));await mkdir(runtime,{recursive:true});const temp=await mkdtemp(path.join(runtime,'hgo-boundary-'));
  try{
    const app=path.join(temp,'app');await mkdir(path.join(app,'src'),{recursive:true});await mkdir(path.join(app,'assets/default'),{recursive:true});
    await writeFile(path.join(app,'index.html'),'<script type="module" src="./src/main.js"></script>');
    await writeFile(path.join(app,'src/main.js'),'import {value} from "./local.js";');await writeFile(path.join(app,'src/local.js'),'export const value=1;');
    await writeFile(path.join(app,'assets/default/manifest.json'),JSON.stringify({format:'hgo-native-dataset',schemaVersion:1,assets:{core:{url:'core.json'}},source:{provenanceUrl:'provenance.json'}}));
    await writeFile(path.join(app,'assets/default/core.json'),'{}');await writeFile(path.join(app,'assets/default/provenance.json'),'{}');
    assert.equal((await checkBoundary(app)).modules,2);
    await writeFile(path.join(app,'src/main.js'),'import "https://example.com/module.js";');await assert.rejects(checkBoundary(app),/Remote URL|Non-relative/);
    await writeFile(path.join(temp,'outside.js'),'export {};');await writeFile(path.join(app,'src/main.js'),'import "../../outside.js";');await assert.rejects(checkBoundary(app),/escapes HGO/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
