import {text} from './text.js';

// Navigation belongs to the inspector. It never changes the map or document.
export function createInspector({root,getLanguage=()=>root.ownerDocument.documentElement.lang}) {
  const doc=root.ownerDocument,keys=['edit','layers','countries'];
  const tabs=keys.map(key=>doc.getElementById(`inspector-tab-${key}`));
  const panels=keys.map(key=>doc.getElementById(`inspector-panel-${key}`));
  const countries=doc.getElementById('country-management');
  const summary=doc.getElementById('selection-summary');
  const title=doc.getElementById('selection-summary-title');
  const meta=doc.getElementById('selection-summary-meta');
  const swatch=doc.getElementById('selection-summary-swatch');
  const listeners=[];
  let active='edit',lastSummary;
  function activate(key,{focus=false}={}) {
    if(!keys.includes(key))return;
    const previous=panels[keys.indexOf(active)];
    const moveFocus=focus||previous.contains(doc.activeElement);
    active=key;
    keys.forEach((entry,index)=>{
      const selected=entry===active;
      tabs[index].setAttribute('aria-selected',String(selected));
      tabs[index].tabIndex=selected?0:-1;
      panels[index].hidden=!selected;
    });
    // The existing country panel uses this details element as its lazy query gate.
    countries.open=key==='countries';
    if(moveFocus)tabs[keys.indexOf(active)].focus({preventScroll:true});
  }
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  tabs.forEach((tab,index)=>{
    listen(tab,'click',()=>activate(keys[index]));
    listen(tab,'keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      let target;
      if(event.key==='ArrowRight')target=(index+1)%keys.length;
      else if(event.key==='ArrowLeft')target=(index+keys.length-1)%keys.length;
      else if(event.key==='Home')target=0;
      else if(event.key==='End')target=keys.length-1;
      else return;
      event.preventDefault();event.stopPropagation();
      activate(keys[target],{focus:true});
    });
  });
  function render(vm,language=getLanguage()) {
    const words=text[String(language).startsWith('zh')?'zh':'en'];
    const selection=vm.selection||[],first=selection[0],count=selection.length;
    const name=count===1?first.name:count?`${count} ${words.multiple}`:words.selectionEmpty;
    const owners=[...new Set(selection.map(state=>state.entityTag))].slice(0,4).join(', ');
    const detail=count?`${count===1?`#${first.id} · `:''}${owners} · ${words.selectedCount} ${count}`:words.multiHint;
    const color=first?.color||'';
    const signature=JSON.stringify([name,detail,color]);
    if(signature===lastSummary)return;
    lastSummary=signature;
    title.textContent=name;meta.textContent=detail;
    swatch.hidden=!count;swatch.style.background=color;
    summary.dataset.selected=String(count>0);
  }
  activate(active);
  render({selection:[]});
  return {activate,render,get active(){return active;},dispose(){for(const off of listeners)off();}};
}
