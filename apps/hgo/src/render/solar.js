const RAD = Math.PI / 180;

// Geographic illumination only. HGO pixel-to-geography registration is supplied
// by the optional geographic pack; no global equirectangular assumption here.
export function solarState(layers, now = new Date()) {
  const live = layers.solarMode === 'utc';
  const date = live ? now : new Date(`${layers.solarDate || '2026-06-21'}T00:00:00Z`);
  const minutes = live ? now.getUTCHours()*60+now.getUTCMinutes()+now.getUTCSeconds()/60
    : layers.solarMode === 'cycle' ? (now.getTime()/1000 % (layers.cycleSeconds||120))/(layers.cycleSeconds||120)*1440
      : layers.utcMinutes??720;
  const day = Math.floor((Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())
    - Date.UTC(date.getUTCFullYear(),0,1))/86400000)+1;
  const gamma = 2*Math.PI/365*(day-1+(minutes/60-12)/24);
  const declination = 0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)
    -0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)
    -0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
  const longitude = (180-minutes/4)*RAD;
  return {minutes, date:date.toISOString().slice(0,10),
    direction:[Math.cos(declination)*Math.cos(longitude),Math.cos(declination)*Math.sin(longitude),Math.sin(declination)]};
}

export function nightCoverage(vector, direction, twilightWidth = 10) {
  const dot = vector.reduce((total,value,index)=>total+value*direction[index],0);
  const t = Math.max(0,Math.min(1,-dot/Math.sin(twilightWidth*RAD)));
  return t*t*(3-2*t);
}
