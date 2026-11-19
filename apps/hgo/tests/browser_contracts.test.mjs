import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css'};
let server,browser,baseUrl;
before(async()=>{
  server=createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/'){
        res.writeHead(200,{'Content-Type':'text/html'});
        res.end('<!doctype html><html lang="en"><title>HGO browser contracts</title><body></body></html>');return;
      }
      const file=path.resolve(root,`.${pathname}`);
      if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
      const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);
    }catch(error){res.writeHead(error.code==='ENOENT'?404:500);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  // Software WebGL verifies pixels and lifecycle in CI; hardware performance is
  // still measured separately on the target browser/GPU.
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
});
after(async()=>{
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
});

for(const [file,entry] of [
  ['browser_contract.js','runBrowserContract'],
  ['color_browser_contract.js','runColorContract'],
  ['border_browser_contract.js','runBorderContract'],
  ['country_browser_contract.js','runCountryRenderContract'],
  ['country_panel_browser_contract.js','runCountryPanelContract'],
]){
  test(entry,{timeout:90000},async t=>{
    const page=await browser.newPage({viewport:{width:1024,height:700}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(baseUrl);
      const result=await page.evaluate(async({file,entry})=>(await import(`/tests/${file}`))[entry](),{file,entry});
      assert.equal(result.passed,true);
      assert.deepEqual(errors,[]);
      t.diagnostic(`${result.checks.length} browser assertions passed`);
    }finally{await page.close();}
  });
}
