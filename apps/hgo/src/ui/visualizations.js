import {METRIC_DEFINITIONS,metricColor,metricDisplayKind,infrastructureColor,INFRASTRUCTURE_LEVELS} from '../data/metrics.js';
import {resourceSymbolRadius,resourceSymbolColor} from '../render/metric_symbols.js';
import {landformLabelsVisible} from '../data/landforms.js';

const copy={
  zh:{heading:'地貌与可视化',appearance:'地名与底图',nameLanguage:'地名语言',zh:'简体中文',en:'English',bilingual:'中文 / English',textureOpacity:'底图纹理',
    baseMapStyle:'底图配色',political:'国家原色',thematic:'专题浅底',baseMapHint:'专题浅底弱化陆地底色和州界，保留水域颜色，便于查看地形和资源；实际填色不变。',
    geography:'自然地理参考',quality:'图层精度',balanced:'均衡（更轻）',fine:'精细',qualityHint:'调整地形与河流的细节及资源占用。',terrain:'地形与地貌',terrainMode:'显示模式',native:'原生地形',geomorphology:'地貌分区',combined:'组合',terrainOpacity:'地貌不透明度',landformLabels:'地貌名称',landformHint:'放大后逐步显示，与其他地名自动避让。',rivers:'河流',riverOpacity:'河流不透明度',riverWidth:'河流粗细',riverWidthHint:'1 为新增河流的默认粗细，随地图缩放；原生水域地块保持原宽度。',geographyHint:'原生地形与现代地貌参考；没有可靠数据的区域保持透明。',terrainLegend:'地貌图例',
    lighting:'灯光与昼夜',nightLights:'夜间灯光',dayNight:'昼夜明暗',lightingHint:'夜光使用标注为 2016 年的卫星夜光衍生数据，按 0.5° 采样，仅作现代视觉参考；原始影像尚未核验。昼夜明暗为近似计算，配准有效域边缘已渐隐；高纬度和配准不足地区仍不保证准确。',lightingSettings:'照明参数',solarMode:'时间模式',manual:'手动时间',utc:'当前 UTC',cycle:'循环演示',solarDate:'太阳日期',utcMinutes:'UTC 时间',cycleSeconds:'循环时长',twilightWidth:'晨昏过渡',nightOpacity:'夜间暗度',nightLightOpacity:'夜光强度',
    metricHeading:'原生资源与建设',metric:'指标',none:'关闭',resources:'资源',buildings:'建设',metricOpacity:'指标不透明度',metricHint:'1936.1.1 原生游戏配置，用于比较资源值与建设等级，并非现实产量或人口统计。',selection:'所选州',choose:'选择一个州查看数值。',missing:'该州没有此项数据；缺失值不视为零。',noData:'此指标没有可用数据。',range:'全图范围',known:'有数据的州',nativeResource:'游戏资源值',nativeLevel:'游戏建设等级',nativeCount:'游戏建设数量',
    overlayColorHint:'图例为图层原色；地图颜色还受底色、叠加图层与不透明度影响。',metricScaleHint:'按全图已记录值线性着色；全图已记录值都相同时使用中间色。缺失值不着色，数值 0 仍参与比较。',
    metricMapHint:'按整州着色，不表示矿点或设施的实际位置。无记录的州保留底图；可用“专题浅底”减少国家颜色干扰。',
    resourceMapHint:'资源显示自动使用浅底。圆面积表示州资源值，线端指向所属州，并非矿点坐标。点击州查看数值，放大可分辨密集符号。',
    levelMapHint:'基础设施按固定 0–10 级着色，优先于地貌和明暗；同级颜色一致。未记录的州保留浅底，关闭指标后恢复所选底图。',
    resourceScaleHint:'同一图面使用全图统一的面积标尺。未记录和已知 0 均不画数量圆，可在州详情中区分。',
    levelScaleHint:'图例覆盖全部原生等级，包括本图尚未出现的等级。0 是已知等级；未记录不是 0。',
    nativeProvinceSum:'省份建设等级合计',nativeConfiguration:'原生建设配置值',symbolVisible:'视野内州符号',symbolMoved:'引线避让',symbolCrowded:'仍有交叠，请放大或按州查看',
    parameters:'参数',source:'数据说明',textureSettings:'底图纹理',ready:'已就绪',loading:'加载中…',error:'暂不可用',idle:'开启后加载',retry:'重试未加载的图层',retrying:'正在重试…',loaded:'已加载',statusHeading:'图层状态',actionError:'无法更新显示设置，请重试。',seconds:'秒',degrees:'°',pixels:'px'},
  en:{heading:'Map visualizations',appearance:'Names & base map',nameLanguage:'Place-name language',zh:'简体中文',en:'English',bilingual:'中文 / English',textureOpacity:'Base texture',
    baseMapStyle:'Base map colors',political:'Country colors',thematic:'Light thematic base',baseMapHint:'A light land base and quieter state borders help terrain and resources stand out. Water and saved paint colors stay unchanged.',
    geography:'Physical reference',quality:'Layer detail',balanced:'Balanced (lighter)',fine:'Fine',qualityHint:'Adjusts terrain and river detail and resource use.',terrain:'Terrain & landforms',terrainMode:'Display mode',native:'Native terrain',geomorphology:'Landform regions',combined:'Combined',terrainOpacity:'Terrain opacity',landformLabels:'Landform names',landformHint:'Names appear as you zoom in and avoid other labels.',rivers:'Rivers',riverOpacity:'River opacity',riverWidth:'River weight',riverWidthHint:'1 is the default overlay weight. Lines scale with the map; native water provinces keep their original width.',geographyHint:'Native terrain and modern landform references. Areas without reliable data remain transparent.',terrainLegend:'Terrain legend',
    lighting:'Lights & daylight',nightLights:'Night lights',dayNight:'Day & night shading',lightingHint:'Night lights use a derivative labeled 2016, sampled at 0.5°, for modern visual reference; the original imagery is not yet verified. Daylight is approximate, with faded domain edges; high latitudes and incomplete registration still limit accuracy.',lightingSettings:'Lighting settings',solarMode:'Time mode',manual:'Manual time',utc:'Current UTC',cycle:'Cycle preview',solarDate:'Solar date',utcMinutes:'UTC time',cycleSeconds:'Cycle duration',twilightWidth:'Twilight transition',nightOpacity:'Night darkness',nightLightOpacity:'Light intensity',
    metricHeading:'Native resources & buildings',metric:'Metric',none:'Off',resources:'Resources',buildings:'Buildings',metricOpacity:'Metric opacity',metricHint:'Native game configuration at 1936.1.1. Compare resource values and building levels; these are not measured production or population statistics.',selection:'Selected state',choose:'Select one state to inspect its value.',missing:'No value for this state. Missing data is not zero.',noData:'No data is available for this metric.',range:'Map range',known:'States with data',nativeResource:'Game resource value',nativeLevel:'Game building level',nativeCount:'Game building count',
    overlayColorHint:'Legend shows layer colors. Map colors also depend on the base, other layers and opacity.',metricScaleHint:'Linear scale across recorded map values. When all recorded values are equal, they use the middle color. Missing values stay transparent; recorded zero is included.',
    metricMapHint:'Colors cover whole states, not individual deposits or facilities. Unrecorded states retain the base; the light thematic base reduces country-color interference.',
    resourceMapHint:'Resources use an automatic light base. Circle area shows the state value; leader ends identify the state, not a deposit. Select a state for its value; zoom in to separate crowded symbols.',
    levelMapHint:'Fixed infrastructure levels 0–10 take priority over terrain and lighting. Equal levels have equal colors; unrecorded states keep a light base. Turning metrics off restores your base style.',
    resourceScaleHint:'One map-wide area scale. Unrecorded values and recorded zero have no quantity circle; state details distinguish them.',
    levelScaleHint:'The legend includes every native level, even those absent from this map. Zero is recorded; missing is not zero.',
    nativeProvinceSum:'Sum of province building levels',nativeConfiguration:'Native building configuration',symbolVisible:'Visible state symbols',symbolMoved:'With leaders',symbolCrowded:'Some symbols overlap; zoom in or inspect states',
    parameters:'Parameters',source:'Data notes',textureSettings:'Base texture',ready:'Ready',loading:'Loading…',error:'Unavailable',idle:'Loads when enabled',retry:'Retry unavailable layers',retrying:'Retrying…',loaded:'Loaded',statusHeading:'Layer status',actionError:'Display settings could not be updated. Please retry.',seconds:'s',degrees:'°',pixels:'px'},
};

export function createVisualizationPanel(root,{getSession}) {
  const doc=root.ownerDocument,listeners=[],translated=[],controls=[],groups=[],conditional=[];
  let disposed=false,model={},language='zh',retrying=false;
  let previousPalette,previousPaletteLanguage,previousTerrainMode,previousLanguage;
  const text=key=>copy[language][key]||key;
  const make=(tag,id,className)=>{const node=doc.createElement(tag);if(id)node.id=id;if(className)node.className=className;return node;};
  const caption=(node,key)=>{translated.push([node,key]);return node;};
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  const available=()=>!disposed&&model.ready!==false&&!!getSession();
  const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const hide=(node,value)=>{if(node.hidden!==value)node.hidden=value;};
  const details=make('section','visualization-details','visualization-details');
  const summary=caption(make('h2'),'heading');details.append(summary);
  function group(key){const node=make('div',null,'visualization-group');node.append(caption(make('h3'),key));return node;}
  function note(parent,key){const node=caption(make('p',null,'field-hint'),key);parent.append(node);return node;}
  function fold(parent,id,key,active){
    const node=make('details',id,key==='source'?'visualization-source':'visualization-options');
    node.append(caption(make('summary'),key));parent.append(node);
    if(active)conditional.push({node,active});
    return node;
  }
  const error=caption(make('p','visualization-error','visualization-error'),'actionError');error.hidden=true;error.setAttribute('role','status');
  function action(fn){if(!available())return;try{error.hidden=true;const value=fn(getSession());if(value?.catch)value.catch(()=>{if(!disposed)error.hidden=false;});}catch{error.hidden=false;}}
  function control(parent,key,type,{min,max,step,options,active,unit}={}){
    const wrapper=make('div',null,'visualization-field'),label=caption(make('label'),key);
    const input=make(type==='select'?'select':'input',`vis-${key}`),output=type==='range'?make('output'):null;
    label.htmlFor=input.id;
    if(type!=='select')input.type=type;
    if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);if(step!==undefined)input.step=String(step);
    if(options)for(const [value,labelKey] of options){const option=caption(make('option'),labelKey);option.value=value;input.append(option);}
    wrapper.append(label);
    if(output){const row=make('div',null,'display-range');output.setAttribute('for',input.id);row.append(input,output);wrapper.append(row);}
    else wrapper.append(input);
    parent.append(wrapper);controls.push({key,input,output,type,active,unit,wrapper});
    const update=()=>action(session=>session.setDisplayOption(key,['range','number'].includes(type)?Number(input.value):input.value));
    listen(input,type==='range'?'input':'change',update);
    return input;
  }
  function toggle(parent,key,active){
    const label=make('label',null,'layer-toggle'),title=caption(make('span'),key),input=make('input',`vis-${key}`),sw=make('span',null,'switch');
    input.type='checkbox';sw.setAttribute('aria-hidden','true');label.append(title,input,sw);parent.append(label);
    controls.push({key,input,type:'checkbox',active,wrapper:label});listen(input,'change',()=>action(session=>session.setLayer(key,input.checked)));
  }
  function status(parent,keys,active){
    const node=make('p',null,'visualization-status');node.setAttribute('role','status');parent.append(node);groups.push({node,keys,active});return node;
  }
  const names=group('appearance');
  control(names,'baseMapStyle','select',{options:[['political','political'],['thematic','thematic']]});
  note(names,'baseMapHint');
  control(names,'nameLanguage','select',{options:[['zh','zh'],['en','en'],['bilingual','bilingual']]});
  status(names,['localization'],layers=>layers.nameLanguage!=='en');
  control(fold(names,'vis-texture-settings','textureSettings'),'textureOpacity','range',{min:0,max:1,step:.05,unit:'percent'});
  const physical=group('geography');details.append(physical);
  const physicalSource=fold(physical,'vis-geography-source','source');
  note(physicalSource,'geographyHint');note(physicalSource,'qualityHint');
  toggle(physical,'terrain');status(physical,['terrain','terrainPalette'],layers=>layers.terrain);
  control(physical,'terrainMode','select',{options:[['native','native'],['geomorphology','geomorphology'],['combined','combined']],active:layers=>layers.terrain});
  toggle(physical,'landformLabels',layers=>layers.terrain&&layers.terrainMode!=='native');
  status(physical,['terrainLabels'],landformLabelsVisible);
  const terrainOptions=fold(physical,'vis-terrain-settings','parameters',layers=>layers.terrain);
  control(terrainOptions,'terrainOpacity','range',{min:0,max:1,step:.05,unit:'percent',active:layers=>layers.terrain});
  const landformHint=note(terrainOptions,'landformHint');conditional.push({node:landformHint,active:landformLabelsVisible});
  const legendDetails=make('details',null,'visualization-legend');legendDetails.append(caption(make('summary'),'terrainLegend'));
  const terrainLegend=make('ul','vis-terrain-legend');legendDetails.append(terrainLegend);note(legendDetails,'overlayColorHint');terrainOptions.append(legendDetails);
  toggle(physical,'rivers');status(physical,['rivers'],layers=>layers.rivers);
  control(physical,'riverOpacity','range',{min:0,max:1,step:.05,unit:'percent',active:layers=>layers.rivers});
  const riverOptions=fold(physical,'vis-river-settings','parameters',layers=>layers.rivers);
  control(riverOptions,'riverWidth','range',{min:.5,max:3,step:.1,active:layers=>layers.rivers});
  note(riverOptions,'riverWidthHint');
  control(physical,'quality','select',{options:[['balanced','balanced'],['fine','fine']],active:layers=>layers.terrain||layers.rivers});
  const lighting=group('lighting');details.append(lighting);note(fold(lighting,'vis-lighting-source','source'),'lightingHint');
  toggle(lighting,'nightLights');status(lighting,['nightLights'],layers=>layers.nightLights);
  toggle(lighting,'dayNight');status(lighting,['illumination'],layers=>layers.dayNight);
  const timeSummary=make('p','vis-time-summary','visualization-time-summary');lighting.append(timeSummary);
  const lightDetails=fold(lighting,'vis-lighting-settings','lightingSettings',layers=>layers.dayNight||layers.nightLights);
  control(lightDetails,'solarMode','select',{options:[['manual','manual'],['utc','utc'],['cycle','cycle']],active:layers=>layers.dayNight});
  control(lightDetails,'solarDate','date',{active:layers=>layers.dayNight&&layers.solarMode!=='utc'});
  control(lightDetails,'utcMinutes','range',{min:0,max:1439,step:1,unit:'time',active:layers=>layers.dayNight&&layers.solarMode==='manual'});
  control(lightDetails,'cycleSeconds','range',{min:30,max:600,step:10,unit:'seconds',active:layers=>layers.dayNight&&layers.solarMode==='cycle'});
  control(lightDetails,'twilightWidth','range',{min:2,max:28,step:1,unit:'degrees',active:layers=>layers.dayNight});
  control(lightDetails,'nightOpacity','range',{min:0,max:1,step:.05,unit:'percent',active:layers=>layers.dayNight});
  control(lightDetails,'nightLightOpacity','range',{min:0,max:1,step:.05,unit:'percent',active:layers=>layers.nightLights});
  const metrics=group('metricHeading');details.append(metrics);note(fold(metrics,'vis-metric-source','source'),'metricHint');
  const metricSelect=control(metrics,'metric','select',{options:[['none','none']]});
  const metricMapHint=note(metrics,'metricMapHint');conditional.push({node:metricMapHint,active:layers=>layers.metric&&layers.metric!=='none'});
  const metricOptions=[];
  for(const groupName of ['resources','buildings']){
    const optgroup=make('optgroup');metricOptions.push([optgroup,groupName]);
    for(const definition of METRIC_DEFINITIONS.filter(item=>item.group===groupName)){
      const option=make('option');option.value=definition.id;optgroup.append(option);metricOptions.push([option,definition]);
    }
    metricSelect.append(optgroup);
  }
  status(metrics,['metrics'],layers=>layers.metric&&layers.metric!=='none');
  const metricDetail=make('div','vis-metric-detail','visualization-metric');
  const metricTitle=make('h4'),metricValue=make('p','vis-metric-value'),metricHint=make('p','vis-metric-hint','field-hint'),metricRange=make('p','vis-metric-range','field-hint');
  metricDetail.append(metricTitle,metricRange);metrics.append(metricDetail);
  const metricLegend=make('div','vis-metric-legend','visualization-metric-legend');
  const metricStops=[0,.5,1].map(t=>{
    const row=make('div'),swatch=make('span',null,'visualization-swatch'),value=make('span');
    swatch.setAttribute('aria-hidden','true');swatch.style.backgroundColor=`rgb(${metricColor(t).slice(0,3).join(',')})`;
    row.append(swatch,value);metricLegend.append(row);return {row,value};
  });
  metricDetail.append(metricLegend);
  const resourceLegend=make('div','vis-resource-legend','visualization-symbol-legend');
  const resourceStops=[0,1,2].map(()=>{
    const row=make('div'),swatch=make('span',null,'visualization-resource-symbol'),value=make('span');swatch.setAttribute('aria-hidden','true');row.append(swatch,value);resourceLegend.append(row);return {row,swatch,value};
  });
  const levelLegend=make('div','vis-level-legend','visualization-level-legend');
  for(const level of INFRASTRUCTURE_LEVELS){const row=make('div'),swatch=make('span'),value=make('span');swatch.style.backgroundColor=`rgb(${infrastructureColor(level).slice(0,3).join(',')})`;swatch.setAttribute('aria-hidden','true');value.textContent=String(level);row.append(swatch,value);levelLegend.append(row);}
  metricDetail.append(resourceLegend,levelLegend);
  const scaleHint=note(metricDetail,'metricScaleHint'),blendHint=note(metricDetail,'overlayColorHint');
  const symbolStats=make('p','vis-symbol-stats','field-hint');symbolStats.setAttribute('role','status');
  metricDetail.append(symbolStats,metricValue,metricHint);
  control(fold(metrics,'vis-metric-settings','parameters',layers=>['symbols','fill'].includes(metricDisplayKind(layers.metric))),'metricOpacity','range',{min:0,max:1,step:.05,unit:'percent',active:layers=>['symbols','fill'].includes(metricDisplayKind(layers.metric))});
  // Keep the optional layer switches ahead of the less frequent name/texture settings.
  details.append(names);
  const footer=make('div',null,'visualization-footer'),memory=make('p','vis-memory','field-hint'),retry=caption(make('button','vis-retry'),'retry');retry.type='button';retry.hidden=true;
  listen(retry,'click',()=>action(session=>{
    if(retrying)return;retrying=true;retry.disabled=true;retry.textContent=text('retrying');
    return Promise.resolve().then(()=>session.retryVisualizations()).finally(()=>{retrying=false;if(!disposed){retry.textContent=text('retry');retry.disabled=!available();}});
  }));
  footer.append(error,memory,retry);details.append(footer);root.replaceChildren(details);

  function render(next,uiLanguage='zh'){
    if(disposed)return;model=next||{};language=String(uiLanguage).startsWith('zh')?'zh':'en';
    const layers=model.layers||{},visual=model.visualizations||{},statuses=visual.statuses||{};
    if(previousLanguage!==language){
      previousLanguage=language;
      for(const [node,key] of translated)setText(node,text(key));
      for(const [node,definition] of metricOptions){
        if(typeof definition==='string')node.label=text(definition);
        else setText(node,definition.title[language]);
      }
    }
    for(const {node,active} of conditional)hide(node,!active(layers));
    for(const item of controls){
      const {key,input,output,type,active,unit,wrapper}=item,value=layers[key],inactive=!!active&&!active(layers);
      if(wrapper)hide(wrapper,inactive);
      const disabled=!available()||inactive;if(input.disabled!==disabled)input.disabled=disabled;
      if(type==='checkbox'){if(input.checked!==(value===true))input.checked=value===true;}
      else if(doc.activeElement!==input&&value!==undefined&&input.value!==String(value))input.value=String(value);
      if(output){
        const number=Number(value||0);
        setText(output,unit==='percent'?`${Math.round(number*100)}%`:unit==='time'?`${String(Math.floor(number/60)).padStart(2,'0')}:${String(number%60).padStart(2,'0')}`:unit?`${number} ${text(unit)}`:String(number));
      }
    }
    for(const {node,keys,active} of groups){
      const values=keys.map(key=>statuses[key]?.status||'idle');
      const state=values.includes('error')?'error':values.includes('loading')?'loading':values.every(value=>value==='ready')?'ready':'idle';
      hide(node,!active(layers));setText(node,text(state));if(node.dataset.status!==state)node.dataset.status=state;
      const titleKey={localization:'nameLanguage',terrainLabels:'landformLabels',illumination:'dayNight',metrics:'metric'}[keys[0]]||keys[0];
      const label=`${text(titleKey)} · ${text(state)}`;if(node.getAttribute?.('aria-label')!==label)node.setAttribute('aria-label',label);
    }
    hide(retry,!Object.values(statuses).some(entry=>entry?.status==='error'));
    const retryDisabled=!available()||retrying;if(retry.disabled!==retryDisabled)retry.disabled=retryDisabled;
    if(retrying)setText(retry,text('retrying'));
    const bytes=Number(visual.decodedBytes||0);hide(memory,!(bytes>0));setText(memory,`${text('loaded')} · ${(bytes/1048576).toFixed(1)} MiB`);
    hide(timeSummary,!layers.dayNight);
    const minute=Number(layers.utcMinutes||0),clock=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')} UTC`;
    setText(timeSummary,layers.solarMode==='utc'?text('utc'):`${layers.solarDate||''} · ${layers.solarMode==='cycle'?text('cycle'):clock}`);
    const palette=Array.isArray(visual.terrainPalette)?visual.terrainPalette:visual.terrainPalette?.palette;
    const mode=layers.terrainMode||'combined';
    hide(legendDetails,!layers.terrain||!Array.isArray(palette)||!palette.length);
    if(previousPalette!==palette||previousPaletteLanguage!==language||previousTerrainMode!==mode){
      previousPalette=palette;previousPaletteLanguage=language;previousTerrainMode=mode;
      terrainLegend.replaceChildren();
      const seen=new Set();
      for(const entry of palette||[]){
        const native=mode==='native',modern=mode==='geomorphology';
        const identity=native?entry.nativeClassId:modern?entry.modernClassId:entry.id;
        if(!identity||seen.has(identity))continue;seen.add(identity);
        const row=make('li'),swatch=make('span',null,'visualization-swatch'),label=make('span');swatch.setAttribute('aria-hidden','true');
        const color=native?entry.baseColor:modern?entry.modernColor:entry.color||entry.baseColor||entry.modernColor;
        if(/^#[0-9a-f]{6}$/i.test(color||''))swatch.style.backgroundColor=color;
        const title=native?entry.nativeLabel:modern?entry.modernLabel:entry.label;
        label.textContent=title?.[language]||title?.en||identity;row.append(swatch,label);terrainLegend.append(row);
      }
    }
    const metric=visual.metric||{},definition=METRIC_DEFINITIONS.find(item=>item.id===layers.metric);
    hide(metricDetail,!definition);
    if(definition){
      const display=metricDisplayKind(layers.metric);
      setText(metricMapHint,text(display==='symbols'?'resourceMapHint':display==='levels'?'levelMapHint':'metricMapHint'));
      setText(scaleHint,text(display==='symbols'?'resourceScaleHint':display==='levels'?'levelScaleHint':'metricScaleHint'));
      hide(blendHint,display!=='fill');
      setText(metricTitle,definition.title[language]);
      const finite=Number.isFinite(metric.value),unit=metric.unit||definition.unit;
      const unitLabel=text({'native-resource-value':'nativeResource','native-building-level':'nativeLevel','native-building-count':'nativeCount','native-province-level-sum':'nativeProvinceSum','native-building-configuration':'nativeConfiguration'}[unit]||'nativeConfiguration');
      setText(metricValue,finite?`${text('selection')} · ${metric.value.toLocaleString(language==='zh'?'zh-CN':'en-US')}`:'—');
      setText(metricHint,finite?unitLabel:metric.knownCount===0?text('noData'):['no-selection','none'].includes(metric.status)||!metric.status?text('choose'):text('missing'));
      setText(metricRange,Number.isFinite(metric.min)&&Number.isFinite(metric.max)?`${text('range')} · ${metric.min} – ${metric.max} · ${text('known')} ${metric.knownCount??'—'}`:'');
      const validRange=Number.isFinite(metric.min)&&Number.isFinite(metric.max),constant=metric.min===metric.max;
      hide(metricLegend,!validRange||display!=='fill');
      hide(resourceLegend,display!=='symbols'||!validRange||!(metric.max>0));
      hide(levelLegend,display!=='levels'||!validRange);
      const symbols=metric.symbols;
      hide(symbolStats,display!=='symbols'||!symbols);
      if(symbols)setText(symbolStats,`${text('symbolVisible')} ${symbols.visibleCount} · ${text('symbolMoved')} ${symbols.displacedCount}${symbols.crowdedCount?` · ${text('symbolCrowded')} (${symbols.crowdedCount})`:''}`);
      if(display==='symbols'&&validRange){
        const values=[metric.max/16,metric.max/4,metric.max].map(value=>metric.max>=16?Math.round(value):value);
        for(const [i,{row,swatch,value}]of resourceStops.entries()){
          hide(row,values.indexOf(values[i])!==i);
          const diameter=2*resourceSymbolRadius(values[i],metric.max,Number(model.zoom)||.25);
          swatch.style.width=`${diameter}px`;swatch.style.height=`${diameter}px`;
          swatch.style.backgroundColor=resourceSymbolColor(layers.metric);
          setText(value,values[i].toLocaleString(language==='zh'?'zh-CN':'en-US',{maximumFractionDigits:2}));
        }
      }
      if(validRange)for(const [i,{row,value}] of metricStops.entries()){
        hide(row,constant&&i!==1);
        setText(value,(metric.min+(metric.max-metric.min)*i/2).toLocaleString(language==='zh'?'zh-CN':'en-US',{maximumFractionDigits:2}));
      }
    }
  }
  render({ready:false});
  return {render,dispose(){if(disposed)return;disposed=true;for(const remove of listeners)remove();root.replaceChildren();}};
}
