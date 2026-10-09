import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectEditor,routeHgoProject} from '../js/core/hgo_project_routing.js';

test('dispatch separates native, main and retired HGO before main normalization',async()=>{
  assert.equal(projectEditor({format:'scenario-forge-hgo'}),'hgo');
  assert.equal(projectEditor({scenario:{id:'hgo_1936'}}),'retired-hgo');
  assert.equal(projectEditor({scenario:{id:'tno_1962'}}),'main');
  assert.equal(await routeHgoProject({schemaVersion:21}),null);
  await assert.rejects(()=>routeHgoProject({scenario:{id:'hgo_1936'}}),/Legacy HGO/);
  const source=await readFile(new URL('../js/core/file_manager.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('static async importProjectData'));
  assert.ok(body.indexOf('routeHgoProject(payload)')<body.indexOf('normalizeImportedProjectData(payload)'));
});

test('invalid/native cross-origin handoff never touches storage or navigates',async()=>{
  let navigation=0;
  const options={entryUrl:'https://other.example/hgo/',location:{href:'http://localhost/app/',assign(){navigation++;}},indexedDB:{open(){throw new Error('Unexpected storage access');}}};
  await assert.rejects(()=>routeHgoProject({format:'scenario-forge-hgo'},options),/envelope/);
  await assert.rejects(()=>routeHgoProject({format:'scenario-forge-hgo',schemaVersion:1,coordinateSpace:'hgo-pixel',dataset:{id:'hgo',revision:'r'}},options),/same origin/);
  assert.equal(navigation,0);
});
