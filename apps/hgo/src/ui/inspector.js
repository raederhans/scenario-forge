// A single active work area keeps long country workflows out of the paint tools.
export function createInspectorTabs({root,panels,onChange=()=>{}}) {
  const tabs=[...root.querySelectorAll('[role="tab"]')],listeners=[];
  let current=tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.dataset.panel||'paint';
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  function select(name,{focus=false}={}){
    const target=tabs.find(tab=>tab.dataset.panel===name);if(!target)return;
    current=name;
    for(const tab of tabs){const active=tab===target;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;panels[tab.dataset.panel].hidden=!active;}
    if(focus)target.focus();
    onChange(current);
  }
  for(const tab of tabs){
    listen(tab,'click',()=>select(tab.dataset.panel));
    listen(tab,'keydown',event=>{
      const index=tabs.indexOf(tab),next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();select(tabs[next].dataset.panel,{focus:true});
    });
  }
  select(current);
  return {select,get current(){return current;},dispose(){for(const off of listeners)off();}};
}
