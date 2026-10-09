#!/usr/bin/env node
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
export async function checkBoundary(directory=path.resolve(here,'..')) {
  const root=await realpath(directory),visited=new Set(),assets=new Set();
  function inside(file){const relative=path.relative(root,file);return relative!==''&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative);}
  async function resolveLocal(reference,from){
    if(!reference.startsWith('./')&&!reference.startsWith('../'))throw new Error(`Non-relative dependency in ${path.relative(root,from)}: ${reference}`);
    const url=new URL(reference,pathToFileURL(from));
    if(url.protocol!=='file:'||url.search||url.hash)throw new Error(`Invalid local dependency: ${reference}`);
    const file=await realpath(fileURLToPath(url));
    if(!inside(file)||(await stat(file)).isDirectory())throw new Error(`Dependency escapes HGO app: ${reference}`);
    return file;
  }
  async function module(file){
    if(visited.has(file))return;visited.add(file);const source=await readFile(file,'utf8');
    if(/\b(?:window|globalThis)\s*\.\s*(?:state|mapRenderer|scenarioManager|__SCENARIO_FORGE_STATE__)\b/.test(source))throw new Error(`Main application global dependency: ${file}`);
    if(/['"`](?:https?:)?\/\/(?!localhost(?:[/:]|['"`]))/i.test(source))throw new Error(`Remote URL in browser module: ${file}`);
    for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]+?\s+from\s*)?['"]([^'"]+)['"]/g))await module(await resolveLocal(match[1],file));
    for(const match of source.matchAll(/\bimport\s*\(([^)]*)\)/g)){
      const literal=match[1].trim().match(/^(['"])([^'"]+)\1$/);
      if(!literal)throw new Error(`Computed module import is outside static boundary policy: ${file}`);
      await module(await resolveLocal(literal[2],file));
    }
    for(const match of source.matchAll(/new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g))assets.add(await resolveLocal(match[1],file));
    for(const match of source.matchAll(/\bfetch\s*\(\s*['"]([^'"]+)['"]/g))assets.add(await resolveLocal(match[1],file));
  }
  async function css(file){
    const source=await readFile(file,'utf8');
    for(const match of source.matchAll(/(?:url\(\s*['"]?([^)'"\s]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"])/g)){
      const target=await resolveLocal(match[1]||match[2],file);assets.add(target);if(target.endsWith('.css'))await css(target);
    }
  }
  const entry=path.join(root,'index.html'),html=await readFile(entry,'utf8');
  for(const match of html.matchAll(/<(script|link|img|source)\b[^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"][^>]*>/gi)){
    const target=await resolveLocal(match[2],entry);
    if(match[1].toLowerCase()==='script')await module(target);else{assets.add(target);if(target.endsWith('.css'))await css(target);}
  }
  async function sourceTree(folder){for(const item of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())await sourceTree(file);else if(item.name.endsWith('.js')){const resolved=await realpath(file);if(!inside(resolved))throw new Error('Source symlink escapes app');await module(resolved);}}}
  await sourceTree(path.join(root,'src'));
  const manifestPath=path.join(root,'assets/default/manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.format!=='hgo-native-dataset'||manifest.schemaVersion!==1)throw new Error('Unsupported dataset manifest');
  for(const asset of Object.values(manifest.assets||{}))assets.add(await resolveLocal(`./${asset.url}`,manifestPath));
  assets.add(await resolveLocal(`./${manifest.source.provenanceUrl}`,manifestPath));
  if(!visited.has(path.join(root,'src/main.js')))throw new Error('Missing independent module entry');
  return {modules:visited.size,assets:assets.size,root};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await checkBoundary(process.argv[2])));}catch(error){console.error(error.message);process.exitCode=1;}
}
