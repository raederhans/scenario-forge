import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNameResolver,validateLocalization} from '../src/data/localization.js';
import {createLabelLayout} from '../src/render/labels.js';

function fixture() {
  const dataset={manifest:{id:'hgo',revision:'r1'}, core:{states:[{id:1,name:'Paris',entityTag:'FRA',
    anchor:[100,100],pixelCount:100000}],entities:[{tag:'FRA',name:'France',anchor:[100,100]}]},
    places:[{id:'vp-1',stateId:1,name:'Paris',x:100,y:100}]};
  dataset.localization={format:'hgo-native-localization',schemaVersion:1,dataset:dataset.manifest,
    states:{1:{en:'Paris',zh:'巴黎',original:'Paris'}},
    entities:{FRA:{en:'France',zh:'法国',original:'France'}},
    places:{'vp-1':{en:'Paris',zh:'巴黎',original:'Paris'}}};
  return dataset;
}

test('three display modes and bilingual search use stable IDs and preserve source data',()=>{
  const dataset=fixture(),before=JSON.stringify(dataset),resolver=createNameResolver(dataset);
  const state=dataset.core.states[0];
  assert.equal(resolver.name('state',state,'en'),'Paris');
  assert.equal(resolver.name('state',state,'zh'),'巴黎');
  assert.equal(resolver.name('state',state,'bilingual'),'巴黎 / Paris');
  assert.deepEqual(resolver.searchNames('state',state),['Paris','巴黎']);
  assert.equal(resolver.name('state',{...state,id:2},'zh'),'Paris','same name with a different ID is never translated');
  assert.equal(resolver.name('state',{...state,name:'User rename'},'zh'),'User rename');
  assert.equal(JSON.stringify(dataset),before);
});

test('custom state labels and country names have precedence in every language',()=>{
  const dataset=fixture(),resolver=createNameResolver(dataset);
  for(const language of ['en','zh','bilingual']){
    assert.equal(resolver.name('state',dataset.core.states[0],language,{customName:'My Paris'}),'My Paris');
    assert.equal(resolver.name('country',{tag:'FRA',name:'My republic'},language),'My republic');
  }
  assert.ok(resolver.searchNames('state',dataset.core.states[0],{customName:'My Paris'}).includes('My Paris'));
  assert.equal(createNameResolver({...dataset,localization:null}).name('state',dataset.core.states[0],'zh'),'Paris');
});

test('existing resolver and label layout adopt asynchronously loaded localization',()=>{
  const dataset=fixture(),overlay=dataset.localization;delete dataset.localization;
  const resolver=createNameResolver(dataset),owner=createLabelLayout(dataset);
  const document={labels:{},countries:()=>[]},view={x:100,y:100,scale:10};
  const layers={labels:true,cities:false,nameLanguage:'zh'};
  assert.equal(owner.layout(document,view,layers,300,300)[0].text,'Paris');
  dataset.localization=overlay;
  assert.equal(resolver.name('state',dataset.core.states[0],'zh'),'巴黎');
  assert.equal(owner.layout(document,view,layers,300,300)[0].text,'巴黎');
  delete dataset.localization;
  assert.equal(owner.layout(document,view,layers,300,300)[0].text,'Paris');
});

test('overlay validation refuses stale revisions, wrong identities and source-name mismatches',()=>{
  const dataset=fixture();
  assert.equal(validateLocalization(dataset.localization,dataset),dataset.localization);
  const stale=structuredClone(dataset.localization);stale.dataset.revision='r2';
  assert.throws(()=>validateLocalization(stale,dataset),/does not match/);
  const badId=structuredClone(dataset.localization);badId.states[2]=badId.states[1];
  assert.throws(()=>validateLocalization(badId,dataset),/identity/);
  const badName=structuredClone(dataset.localization);badName.states[1].original='London';
  assert.throws(()=>validateLocalization(badName,dataset),/identity/);
});

test('label layout honors nameLanguage and measures actual translated label width',()=>{
  const dataset=fixture(),owner=createLabelLayout(dataset),state=dataset.core.states[0];
  const layers={labels:true,cities:false,labelDensity:'high',nameLanguage:'bilingual'};
  let measured='';
  const entries=owner.layout({labels:{},countries:()=>[]},{x:100,y:100,scale:10},layers,300,300,
    text=>{measured=text;return text.length*10;});
  assert.equal(entries[0].text,'巴黎 / Paris');assert.equal(measured,entries[0].text);
  assert.equal(owner.layout({labels:{1:'Custom'},countries:()=>[]},{x:100,y:100,scale:10},layers,300,300)[0].text,'Custom');
  assert.equal(state.name,'Paris');
});

test('committed overlay binds to the real dataset and contains substantial sourced Chinese names',async()=>{
  const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
  const dataset={manifest:await json('../assets/default/manifest.json'),core:await json('../assets/default/core.json'),
    places:(await json('../assets/default/places.json')).places};
  const overlay=await json('../assets/overlays/localization/index.json');
  validateLocalization(overlay,dataset);
  for(const table of ['states','entities','places']){
    const values=Object.values(overlay[table]);
    assert.equal(overlay.stats[table].translated,values.filter(entry=>entry.zh&&!entry.displayFallback).length);
    assert.equal(overlay.stats[table].total,overlay.stats[table].translated+overlay.stats[table].untranslated);
  }
  const resolver=createNameResolver(dataset,overlay);
  assert.equal(resolver.name('entity',dataset.core.entities.find(e=>e.tag==='FRA'),'zh'),'法国');
  const guatemala=dataset.core.entities.find(e=>e.tag==='GUA');
  assert.equal(resolver.name('entity',guatemala,'en'),'Guatemala');
  assert.ok(resolver.searchNames('entity',guatemala).includes('Guatemla'));
  assert.equal(overlay.states['10773'].en,'Unnamed state #10773','missing native names remain explicit');
  assert.equal(overlay.states['10773'].original,'STATE_10773');
  assert.equal(overlay.states['10773'].displayFallback,true);
  assert.equal(overlay.entities.MEN.zh,'蒙疆联合自治政府');
  assert.equal(overlay.entities.PER.zh,'波斯');
  for(const [id,zh] of [['vp-3151','列宁格勒'],['vp-3529','斯大林格勒'],['vp-6332','柯尼斯堡'],['vp-14322','马德拉斯'],['vp-692','慕尼黑']]){
    assert.equal(overlay.places[id].zh,zh);
  }
  for(const [id,zh] of [['335','巴达维亚'],['1499','利奥波德维尔'],['1217','克卢日'],['247','加里宁'],['251','古比雪夫'],['252','高尔基'],['742','斯大林纳巴德'],['718','斯坦利维尔']]){
    assert.equal(overlay.states[id].zh,zh);
  }
  assert.equal(overlay.places['vp-11771'].zh,'奉天');
  assert.equal(overlay.places['vp-3544'].zh,'华沙','reviewed language equivalents stay distinct from historical renames');
  assert.equal(overlay.places['vp-8245'].zh,'洛伦索·马尔克斯');
  assert.equal(overlay.states['11237'].zh,undefined,'She must not inherit Shenyang from airport code SHE');
});

test('every round-two named-place decision binds its original and native parents',async()=>{
  const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
  const reviews=await json('../assets/overlays/localization/place_reviews.json');
  const overlay=await json('../assets/overlays/localization/index.json');
  const native=new Map((await json('../assets/default/places.json')).places.map(place=>[place.id,place]));
  assert.equal(reviews.expectedCount,184);
  assert.equal(reviews.entries.length,reviews.expectedCount);
  assert.equal(new Set(reviews.entries.map(row=>row.id)).size,reviews.expectedCount);
  assert.deepEqual(reviews.dataset,overlay.dataset);
  for(const review of reviews.entries){
    const source=native.get(review.id),entry=overlay.places[review.id];
    assert.ok(source,review.id);
    assert.equal(review.original,source.name,review.id);
    assert.equal(review.stateId,source.stateId,review.id);
    assert.equal(review.entityTag,source.entityTag,review.id);
    assert.ok(review.basis&&review.evidence.length,review.id);
    assert.equal(entry.original,review.original,review.id);
    const evidence=entry.sources.find(item=>item.kind==='reviewed-native-place');
    assert.equal(evidence?.decision,review.decision,review.id);
    if(review.decision==='accepted'){
      assert.equal(entry.zh,review.zh,review.id);
      assert.ok(['translation','normalization','verified'].includes(review.status),review.id);
    }else{
      assert.equal(review.decision,'unresolved',review.id);
      assert.equal(entry.zh,undefined,review.id);
      assert.ok(review.reason,review.id);
    }
  }
  assert.equal(overlay.places['vp-11437'].zh,'第聂伯罗彼得罗夫斯克');
  assert.equal(overlay.places['vp-9461'].zh,'伏罗希洛夫格勒');
  assert.equal(overlay.places['vp-10966'].zh,'新里斯本');
  assert.equal(overlay.places['vp-4098'].zh,undefined,'a street-like native source is not silently corrected to Calp');
  assert.equal(overlay.places['vp-9417'].zh,undefined,'Rostov requires evidence selecting between two cities');
});

test('selected state reviews preserve native identities, qualifiers and approved historical forms',async()=>{
  const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
  const reviews=await json('../assets/overlays/localization/state_reviews.json');
  const placeReviews=new Map((await json('../assets/overlays/localization/place_reviews.json')).entries.map(row=>[row.id,row]));
  const core=await json('../assets/default/core.json');
  const native=new Map(core.states.map(state=>[state.id,state]));
  const overlay=await json('../assets/overlays/localization/index.json');
  assert.equal(reviews.entries.length,reviews.expectedCount);
  assert.equal(new Set(reviews.entries.map(row=>row.id)).size,reviews.expectedCount);
  assert.deepEqual(reviews.dataset,overlay.dataset);
  for(const review of reviews.entries){
    const source=native.get(review.id),entry=overlay.states[review.id];
    assert.equal(source.name,review.original,String(review.id));
    assert.equal(source.entityTag,review.entityTag,String(review.id));
    assert.ok(review.basis&&review.evidence.length,String(review.id));
    assert.equal(entry.original,review.original,String(review.id));
    assert.equal(entry.sources.find(item=>item.kind==='reviewed-native-state')?.decision,review.decision,String(review.id));
    if(review.decision==='accepted'){
      assert.equal(entry.zh,review.zh,String(review.id));
      assert.ok(!entry.displayFallback,String(review.id));
    }else{
      assert.equal(review.decision,'unresolved',String(review.id));
      assert.equal(entry.zh,undefined,String(review.id));
      assert.ok(review.reason,String(review.id));
    }
    if(review.placeId){
      const place=placeReviews.get(review.placeId);
      assert.equal(place.decision,'accepted');
      assert.equal(place.stateId,review.id);
      assert.equal(place.entityTag,review.entityTag);
      assert.equal(place.zh,review.zh);
    }
  }
  assert.equal(overlay.states['644'].zh,'西伯利亚东北部');
  assert.equal(overlay.states['516'].zh,'西伯利亚西北部');
  assert.equal(overlay.states['989'].zh,'格陵兰内陆东部');
  assert.equal(overlay.states['714'].zh,'黑龙江');
  assert.equal(overlay.states['717'].zh,'松江');
  assert.equal(overlay.states['226'].zh,'第聂伯罗彼得罗夫斯克');
  assert.equal(overlay.states['3958'].zh,'玛丽伯德地（西经87°分区）');
  assert.equal(overlay.states['3987'].zh,'毛德皇后地（东经70°分区）');
  const waterReviews=reviews.entries.filter(row=>row.group==='water-complete');
  assert.equal(waterReviews.length,reviews.baselineNamedUntranslatedWater);
  assert.equal(waterReviews.length,417,'the remaining named-water inventory is completely reviewed');
  for(const review of waterReviews){
    assert.equal(review.entityTag,'WTR');
    for(const record of review.sourceRecords??[]){
      assert.ok(record.ne_id&&record.name&&record.name_zh);
      assert.ok(reviews.sourceArchives.some(archive=>archive.path===record.archivePath&&archive.member===record.member));
    }
  }
  assert.equal(overlay.states['8833'].zh,'哈德森湾中部');
  assert.equal(overlay.states['8756'].zh,'伯特利湾外围');
  assert.equal(overlay.states['8735'].zh,'渤海湾');
  assert.match(overlay.states['9598'].zh,/第3期围垦区$/,'preserve the original phase even when native subdivisions are repeated');
  assert.equal(overlay.states['964'].zh,undefined,'Ha’il must not use the literal hail mistranslation 冰雹');
  assert.equal(overlay.states['253'].zh,undefined,'Ivanovo must not inherit Johannesstadt');
  for(const [id,zh] of [[431,'西孟加拉'],[258,'利佩茨克'],[3097,'曼尼普尔'],[5187,'特里普拉'],
    [3298,'巴特曼'],[7179,'梅尔辛'],[3712,'圣米格尔'],[1860,'北奥塞梯'],[1829,'牛津郡']]){
    assert.equal(overlay.states[id].zh,zh,'reviewed primary names replace contaminated generic/city candidates');
  }
  for(const id of [7032,7364,994,7001]){
    assert.equal(overlay.states[id].zh,undefined,'source-name mismatch or damaged Chinese remains unresolved');
  }
  for(const [id,zh] of [[5844,'潍县'],[3292,'和阗'],[886,'尼亚萨兰'],[1049,'巴苏陀兰'],
    [2352,'英属新赫布里底'],[5130,'林道']]){
    assert.equal(overlay.states[id].zh,zh,'retain the attested historical/source form');
  }
  assert.equal(overlay.states[8229].zh,undefined,'Anhalt Lindau must not inherit the Bodensee name');
});
