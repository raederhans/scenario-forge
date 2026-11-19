import {createHgoSession} from '../src/session.js';
import {createCountryPanel} from '../src/ui/countries.js';
import {validateCore} from '../src/data/dataset.js';

export function runCountryPanelContract(){
  const states=[1,2,3].map(id=>({id,name:`State ${id}`,entityTag:'FRA',coreTags:id<3?['COR']:[],anchor:[id-.5,.5],bounds:[id-1,0,id,1],pixelCount:1}));
  const core={schemaVersion:1,states,entities:[{tag:'FRA',name:'France',color:'#25489b'}],provinceIds:[null,1,2,3],provinceStateIds:[null,1,2,3]};
  const dataset={manifest:{id:'country-panel-browser',revision:'1',coordinateSpace:{width:3,height:1}},core,ids:new Uint16Array([1,2,3]),...validateCore(core,3,1)};
  const host=document.createElement('div'),canvas=document.createElement('canvas'),overlayCanvas=document.createElement('canvas'),root=document.createElement('div');
  host.append(canvas,overlayCanvas,root);document.body.append(host);
  const errors=[],checks=[],assert=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
  let panel;
  const session=createHgoSession({canvas,overlayCanvas,dataset,onChange:vm=>panel?.render(vm),onError:error=>errors.push(error.message)});
  const find=id=>root.querySelector(`#${id}`);
  try{
    panel=createCountryPanel({root,session,onError:error=>errors.push(error.message)});
    panel.render(session.getViewModel());
    const parent=root.querySelector('[data-country="FRA"]');parent.click();
    root.querySelector('[data-target="COR"]').click();
    assert(!find('country-confirm-transfer').disabled&&find('country-stale').hidden,'fresh session preview can be confirmed');
    find('country-target-name').value='Corsica';find('country-target-color').value='#abcdef';
    session.setDisplayOption('nameLanguage','zh');
    assert(!find('country-confirm-transfer').disabled,'name language changes keep the ownership preview valid');
    parent.focus();session.paintStates([3],'#112233');
    assert(document.activeElement===parent&&root.querySelector('[data-country="FRA"]')===parent,'paint edits retain country rows and keyboard focus');
    assert(find('country-confirm-transfer').disabled&&!find('country-stale').hidden,'document edits invalidate a preview');
    find('country-refresh-preview').click();
    assert(find('country-target-name').value==='Corsica'&&find('country-target-color').value==='#abcdef','refresh preserves user drafts');
    find('country-confirm-transfer').click();
    const transferred=session.serializeDocument();
    assert(transferred.owners['1']==='COR'&&transferred.owners['2']==='COR','DOM confirmation transfers the previewed states');
    assert(!find('country-completed').hidden&&find('country-confirm-transfer').disabled,'completed transfer cannot be submitted twice');
    session.undo();
    assert(Object.keys(session.serializeDocument().owners).length===0&&session.serializeDocument().paint['3']==='#112233','one undo restores ownership and preserves the earlier paint edit');
    root.querySelector('[data-country="FRA"]').click();root.querySelector('[data-target="COR"]').click();
    assert(!find('country-confirm-transfer').disabled,'a fresh preview works after undo');
    session.loadDocument(session.serializeDocument());
    assert(find('country-preview').hidden,'opening a project clears the previous preview');
    assert(errors.length===0,'country flow has no session or panel errors');
    return {passed:true,checks};
  }finally{panel?.dispose();session.dispose();host.remove();}
}
