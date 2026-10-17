const labels = {
  en:{search:'Search countries',none:'No countries match',choose:'Select a country',states:'States',overrides:'Paint overrides',empty:'This country owns no states. Transfer is unavailable.',base:'Country base color',keep:'Set base color; keep paint overrides',unify:'Set base color; replace paint overrides',cores:'Search core candidates',noCores:'No core candidates match',preview:'Transfer preview',parent:'Parent',remaining:'Parent states remaining',target:'Target',before:'Target states before',after:'Target states after',affected:'Affected paint overrides',tiny:'Tiny states',other:'States with other core claims',color:'Target color',name:'Target name',override:'Replace paint overrides on transferred states',existing:'Existing active country: its base color and name are kept.',stale:'The document changed. Refresh the preview before confirming.',refresh:'Refresh preview',confirm:'Confirm transfer',locate:'Locate transferred state',missing:'Select a core candidate to preview its states.'},
  zh:{search:'搜索国家',none:'没有匹配的国家',choose:'请选择国家',states:'州数',overrides:'涂色覆盖',empty:'该国家目前没有所属州，无法转移。',base:'国家基础色',keep:'修改基础色，保留涂色覆盖',unify:'修改基础色，统一涂色覆盖',cores:'搜索核心候选国家',noCores:'没有匹配的核心候选',preview:'转移预览',parent:'母国',remaining:'母国剩余州数',target:'目标国家',before:'目标原有州数',after:'目标转移后州数',affected:'受影响的涂色覆盖',tiny:'微小州数',other:'含其他核心声明的州数',color:'目标颜色',name:'目标名称',override:'替换转移州的涂色覆盖',existing:'目标为已有国家，保留其全境基础色和名称。',stale:'项目已变化，请更新预览后再确认。',refresh:'更新预览',confirm:'确认转移',locate:'定位转移州',missing:'选择核心候选后预览其州列表。'},
};
Object.assign(labels.en,{showEmpty:'Show countries with no states',coreNotice:'Edit map ownership by core relationships. This does not represent in-game release conditions.',parentBefore:'Parent states before',other:'Target core states in other countries (not transferred)',createPreview:'New-country preview',create:'Create country and transfer states',conflict:'The suggested color is close to nearby countries. Choose another color if needed.'});
Object.assign(labels.zh,{showEmpty:'显示没有所属州的国家',coreNotice:'按核心关系编辑地图归属，不代表游戏可释放条件。',parentBefore:'母国原有州数',other:'其他国家的目标核心州（不转交）',createPreview:'创建国家预览',create:'创建国家并转交州',conflict:'建议颜色与邻近国家较接近，可手动选择其他颜色。'});
labels.en.completed='Transfer completed. Undo restores the whole step.';
labels.zh.completed='已完成，整步可撤销。';
Object.assign(labels.en,{listHeading:'Countries & core territories',backCountries:'Back to countries',backDetails:'Back to country details',coreHeading:'Transfer core territories',coreHelp:'About core relationships',fullPreview:'Full counts & state locator'});
Object.assign(labels.zh,{listHeading:'国家与核心领土',backCountries:'返回国家列表',backDetails:'返回国家详情',coreHeading:'转交核心领土',coreHelp:'核心关系说明',fullPreview:'完整统计与州定位'});

export function createCountryPanel({root,session,active=true,onError=()=>{},getLanguage=()=>root.ownerDocument.documentElement?.lang||'en'}) {
  const doc=root.ownerDocument, listeners=[], translated=[];
  let disposed=false, vm={ready:false}, generation, selected=null, preview=null, previewRevision;
  let lastRevision, lastReady, lastLanguage, needsRows=true;
  let baseDirty=false,completed=false,step='list',listScroll=0,detailScroll=0;
  const text=key=>labels[String(getLanguage()).startsWith('zh')?'zh':'en'][key]||key;
  const make=(tag,id,className)=>{const node=doc.createElement(tag);if(id)node.id=id;if(className)node.className=className;return node;};
  const caption=(node,key)=>{translated.push([node,key]);return node;};
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  const attempt=fn=>{if(disposed||!vm.ready)return;try{return fn();}catch(error){onError(error);}};
  const search=make('input','country-search','country-search');search.type='search';
  const emptyToggleLabel=make('label',null,'country-checkbox'),showEmpty=make('input','country-show-empty'),emptyToggleText=caption(make('span'),'showEmpty');showEmpty.type='checkbox';emptyToggleLabel.append(showEmpty,emptyToggleText);
  const list=make('div','country-list','country-list'),empty=caption(make('p','country-empty','country-hint'),'none');
  const selectedTitle=make('h3','country-selected','country-selected');
  const baseLabel=caption(make('label',null,'country-field'),'base'),baseColor=make('input','country-base-color');baseColor.type='color';baseColor.value='#808080';baseLabel.htmlFor=baseColor.id;
  const keep=caption(make('button','country-keep-overrides'),'keep'),unify=caption(make('button','country-unify-overrides'),'unify');
  const zero=caption(make('p','country-zero-state','country-hint'),'empty');
  const coreSearch=make('input','country-core-search','country-search');coreSearch.type='search';
  const coreNotice=caption(make('p','country-core-notice','country-hint'),'coreNotice');
  const coreList=make('div','country-core-list','country-core-list'),coreEmpty=caption(make('p',null,'country-hint'),'noCores');
  const section=make('section','country-preview','country-step country-preview'),heading=caption(make('h3'),'preview');heading.tabIndex=-1;
  const summary=make('dl','country-preview-summary','country-preview-summary');
  const overview=make('dl','country-preview-overview','country-preview-summary');
  const stateLabel=caption(make('label'),'locate'),stateList=make('select','country-state-list','country-state-list');stateLabel.htmlFor=stateList.id;
  const focus=caption(make('button','country-focus-state'),'locate');
  const colorLabel=caption(make('label'),'color'),targetColor=make('input','country-target-color');targetColor.type='color';targetColor.value='#808080';colorLabel.htmlFor=targetColor.id;
  const nameLabel=caption(make('label'),'name'),targetName=make('input','country-target-name');targetName.type='text';targetName.maxLength=200;nameLabel.htmlFor=targetName.id;
  const overrideLabel=make('label',null,'country-checkbox'),override=make('input','country-override-paint'),overrideText=caption(make('span'),'override');override.type='checkbox';override.checked=true;overrideLabel.append(override,overrideText);
  const existing=caption(make('p',null,'country-hint'),'existing'),stale=caption(make('p','country-stale','country-warning'),'stale');stale.setAttribute('role','status');
  const conflict=caption(make('p','country-color-conflict','country-warning'),'conflict');
  const completedHint=caption(make('p','country-completed','country-hint'),'completed');completedHint.setAttribute('role','status');
  const refresh=caption(make('button','country-refresh-preview'),'refresh'),confirm=caption(make('button','country-confirm-transfer'),'confirm');
  const listStep=make('section','country-browse','country-step'),listHead=make('div',null,'country-step-head'),listBody=make('div',null,'country-step-body');
  const listHeading=caption(make('h2'),'listHeading');
  listHead.append(listHeading,search,emptyToggleLabel);listBody.append(list,empty);listStep.append(listHead,listBody);
  const detailStep=make('section','country-detail','country-step'),detailHead=make('div',null,'country-step-head'),detailBody=make('div',null,'country-step-body');
  const backCountries=caption(make('button','country-back-list','country-back'),'backCountries'),backDetails=caption(make('button','country-back-detail','country-back'),'backDetails');
  selectedTitle.tabIndex=-1;detailHead.append(backCountries,selectedTitle);
  const coreHeading=caption(make('h4',null,'country-core-heading'),'coreHeading'),coreHelp=make('details',null,'inline-help'),coreHelpSummary=caption(make('summary'),'coreHelp');coreHelp.append(coreHelpSummary,coreNotice);
  detailBody.append(baseLabel,baseColor,keep,unify,zero,coreHeading,coreHelp,coreSearch,coreList,coreEmpty);detailStep.append(detailHead,detailBody);
  const previewHead=make('div',null,'country-step-head'),previewBody=make('div',null,'country-step-body'),previewActions=make('div',null,'country-step-actions');
  const fullPreview=make('details',null,'inline-help'),fullPreviewHeading=caption(make('summary'),'fullPreview');fullPreview.append(fullPreviewHeading,summary,stateLabel,stateList,focus);
  const identity=make('div',null,'country-preview-identity'),colorField=make('div'),nameField=make('div');colorField.append(colorLabel,targetColor);nameField.append(nameLabel,targetName);identity.append(colorField,nameField);
  previewHead.append(backDetails,heading);previewBody.append(overview,identity,overrideLabel,existing,conflict,stale,completedHint,fullPreview);previewActions.append(refresh,confirm);section.append(previewHead,previewBody,previewActions);
  for(const button of [keep,unify,refresh,confirm,focus,backCountries,backDetails])button.type='button';
  root.replaceChildren(listStep,detailStep,section);
  function showStep(next,focusNode){
    step=next;listStep.hidden=step!=='list';detailStep.hidden=step!=='detail';section.hidden=step!=='preview'||!preview;
    focusNode?.focus?.({preventScroll:true});
  }
  listen(backCountries,'click',()=>{
    showStep('list');listBody.scrollTop=listScroll;
    ([...list.children].find(row=>row.dataset.country===selected?.tag)||search).focus?.({preventScroll:true});
  });
  listen(backDetails,'click',()=>{
    showStep('detail');detailBody.scrollTop=detailScroll;
    ([...coreList.children].find(row=>row.dataset.target===preview?.target)||selectedTitle).focus?.({preventScroll:true});
  });

  function localize(){
    for(const [node,key]of translated)node.textContent=text(key);
    for(const [node,key]of [[search,'search'],[coreSearch,'cores']]){node.placeholder=text(key);node.setAttribute('aria-label',text(key));}
  }
  function countryRows(){
    if(!vm.ready)return;
    const countries=session.listCountries(search.value||'',{includeEmpty:showEmpty.checked});
    list.replaceChildren();
    for(const country of countries.slice(0,100)){
      const button=make('button',null,'country-row');button.type='button';button.dataset.country=country.tag;
      button.setAttribute('aria-pressed',String(selected?.tag===country.tag));
      const swatch=make('span',null,'country-swatch');
      if(/^#[0-9a-f]{6}$/i.test(country.color||''))swatch.style.backgroundColor=country.color;
      const title=make('span');title.textContent=`${country.tag} · ${country.name||country.tag}`;
      const counts=make('span',null,'country-counts');counts.textContent=`${text('states')}: ${country.stateCount} · ${text('overrides')}: ${country.overrideCount} · ${country.color}`;
      button.append(swatch,title,counts);list.append(button);
    }
    empty.hidden=countries.length>0&&countries.length<=100;
    empty.textContent=countries.length>100?(String(getLanguage()).startsWith('zh')?`显示前 100 / ${countries.length} 个国家，请搜索缩小范围。`:`Showing 100 of ${countries.length} countries. Search to narrow the list.`):text('none');
  }
  function coreRows(){
    coreList.replaceChildren();
    if(!vm.ready||!selected||!selected.stateCount){coreEmpty.hidden=true;return;}
    const candidates=session.listCoreCandidates(selected.tag,coreSearch.value||'');
    for(const candidate of candidates.slice(0,100)){
      const button=make('button',null,'country-core-row');button.type='button';button.dataset.target=candidate.target||candidate.tag;
      button.textContent=`${candidate.tag||candidate.target} · ${candidate.name||candidate.tag||candidate.target} · ${text('states')}: ${candidate.stateCount}`;
      coreList.append(button);
    }
    coreEmpty.hidden=candidates.length>0&&candidates.length<=100;
    coreEmpty.textContent=candidates.length>100?(String(getLanguage()).startsWith('zh')?`显示前 100 / ${candidates.length} 个候选，请搜索缩小范围。`:`Showing 100 of ${candidates.length} candidates. Search to narrow the list.`):text('noCores');
  }
  function showSummary(){
    summary.replaceChildren();overview.replaceChildren();
    if(!preview)return;
    for(const [key,value]of [['parent',`${preview.parent} · ${preview.parentBefore} → ${preview.parentRemaining}`],['target',`${preview.target} · ${preview.targetBefore} → ${preview.targetAfter}`],['states',preview.stateIds.length],['affected',preview.overrideCount]]){const term=make('dt'),detail=make('dd');term.textContent=text(key);detail.textContent=String(value);overview.append(term,detail);}
    const fields=[['parent',preview.parent],['parentBefore',preview.parentBefore],['states',preview.stateIds.length],['remaining',preview.parentRemaining],['target',preview.target],['before',preview.targetBefore],['after',preview.targetAfter],['affected',preview.overrideCount],['tiny',preview.tinyCount],['other',preview.otherCoreCount]];
    for(const [key,value]of fields){const term=make('dt'),detail=make('dd');term.textContent=text(key);detail.textContent=String(value);summary.append(term,detail);}
  }
  function updateControls(){
    selectedTitle.textContent=selected?`${selected.tag} · ${selected.name||selected.tag}`:text('choose');
    zero.hidden=!selected||selected.stateCount>0;
    for(const node of [search,baseColor,keep,unify,coreSearch])node.disabled=!vm.ready||node!==search&&!selected;
    showEmpty.disabled=!vm.ready;
    keep.disabled=unify.disabled=!vm.ready||!selected||!selected.stateCount;
    if(selected){
      const zh=String(getLanguage()).startsWith('zh');
      keep.textContent=zh?`修改 ${selected.stateCount} 州基础色，保留 ${selected.overrideCount} 州手工色`:`Set base color for ${selected.stateCount} states; keep ${selected.overrideCount} paint overrides`;
      unify.textContent=zh?`统一 ${selected.stateCount} 州，覆盖 ${selected.overrideCount} 州手工色`:`Unify ${selected.stateCount} states; replace ${selected.overrideCount} paint overrides`;
    }
    coreSearch.disabled=!vm.ready||!selected||!selected.stateCount;
    for(const node of [...list.children,...coreList.children])node.disabled=!vm.ready;
    showStep(step);
    const changed=!!preview&&previewRevision!==vm.countryRevision;
    stale.hidden=completed||!changed;
    completedHint.hidden=!completed;
    existing.hidden=!preview||preview.targetBefore===0;
    conflict.hidden=!preview?.colorConflict;
    heading.textContent=text(preview?.isNew?'createPreview':'preview');
    confirm.textContent=text(preview?.isNew?'create':'confirm');
    targetColor.disabled=!vm.ready||!preview||preview.targetBefore>0||completed;
    targetName.disabled=!vm.ready||!preview||!preview.isNew||completed;
    stateList.disabled=focus.disabled=!vm.ready||!preview;
    override.disabled=!vm.ready||!preview||completed;
    refresh.hidden=completed;refresh.disabled=!vm.ready||!preview||completed;
    confirm.disabled=!vm.ready||!preview||changed||completed;
  }
  function chooseCountry(tag){
    const country=session.listCountries('',{includeEmpty:true}).find(entry=>entry.tag===tag);if(!country)return;
    listScroll=listBody.scrollTop||0;detailScroll=0;
    selected=country;preview=null;previewRevision=undefined;completed=false;baseColor.value=country.color;baseDirty=false;coreSearch.value='';
    session.selectCountry(tag);countryRows();coreRows();updateControls();
    detailBody.scrollTop=0;showStep('detail',selectedTitle);
  }
  function chooseTarget(target,retainDraft=false){
    if(!selected)return;
    const next=session.previewTransfer(selected.tag,target);
    preview=next;previewRevision=next.revision;completed=false;
    if(!retainDraft)detailScroll=detailBody.scrollTop||0;
    if(!retainDraft||next.targetBefore>0){targetColor.value=next.suggestedColor;targetName.value=next.targetName||next.target;}
    if(!retainDraft)override.checked=true;
    stateList.replaceChildren();
    const names=new Map((next.states||[]).map(state=>[String(state.id),state.name]));
    for(const id of next.stateIds){const option=make('option');option.value=String(id);option.textContent=names.get(String(id))?`${names.get(String(id))} · ${id}`:String(id);stateList.append(option);}
    showSummary();updateControls();
    if(!retainDraft){fullPreview.open=false;previewBody.scrollTop=0;showStep('preview',heading);}
  }
  function taggedTarget(event,attribute,container){
    for(let node=event.target;node&&node!==container;node=node.parentNode)if(node.dataset?.[attribute])return node.dataset[attribute];
  }
  listen(search,'input',()=>attempt(()=>countryRows()));
  listen(showEmpty,'change',()=>attempt(()=>countryRows()));
  listen(baseColor,'input',()=>{baseDirty=true;});
  listen(coreSearch,'input',()=>attempt(()=>coreRows()));
  listen(list,'click',event=>attempt(()=>{const tag=taggedTarget(event,'country',list);if(tag)chooseCountry(tag);}));
  listen(coreList,'click',event=>attempt(()=>{const target=taggedTarget(event,'target',coreList);if(target)chooseTarget(target);}));
  const applyColor=overridePaint=>{session.setCountryColor(selected.tag,baseColor.value,{overridePaint});baseDirty=false;render(vm,true);};
  listen(keep,'click',()=>attempt(()=>applyColor(false)));
  listen(unify,'click',()=>attempt(()=>applyColor(true)));
  listen(refresh,'click',()=>attempt(()=>chooseTarget(preview.target,true)));
  listen(confirm,'click',()=>attempt(()=>{
    if(!preview||previewRevision!==vm.countryRevision||completed)return;
    session.commitTransfer(preview,{color:targetColor.value,name:targetName.value,overridePaint:override.checked});
    // Keep a read-only result, without offering to repeat the completed step.
    completed=true;updateControls();
  }));
  listen(stateList,'change',()=>attempt(()=>{if(stateList.value)session.focusState(stateList.value);}));
  listen(focus,'click',()=>attempt(()=>{if(stateList.value)session.focusState(stateList.value);}));
  function render(next,force=false){
    if(disposed)return;
    const changedProject=generation!==undefined&&next.projectGeneration!==generation;
    if(changedProject){selected=null;preview=null;previewRevision=undefined;completed=false;baseDirty=false;search.value='';coreSearch.value='';step='list';listScroll=detailScroll=0;listBody.scrollTop=0;}
    const language=String(getLanguage());
    const changed=force||changedProject||lastRevision!==next.countryRevision||lastReady!==next.ready||lastLanguage!==language;
    generation=next.projectGeneration;vm=next;
    if(!changed)return;
    needsRows=true;lastRevision=vm.countryRevision;lastReady=vm.ready;lastLanguage=language;
    localize();
    if(vm.ready&&active){
      if(selected)selected=session.listCountries('',{includeEmpty:true}).find(entry=>entry.tag===selected.tag)||null;
      if(selected&&!baseDirty)baseColor.value=selected.color;
      countryRows();coreRows();needsRows=false;
    }
    showSummary();updateControls();
  }
  render(vm);
  return {render,setActive(value){active=!!value;if(active&&needsRows)render(vm,true);},dispose(){if(disposed)return;disposed=true;for(const off of listeners)off();root.replaceChildren();}};
}
