const terminal=new Set(['FILLED','CANCELLED','REJECTED','REPLACED','EXPIRED']);
const number=new Intl.NumberFormat('en-US',{maximumFractionDigits:8});
const price=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:8});

// Account, listing and currency matching happens before a chart receives these
// read-only references. Never derive an unreported remaining quantity here.
export function chartLimitOrders(lines=[]){
  if(!Array.isArray(lines))return [];
  return lines.filter(line=>line&&['BUY','SELL'].includes(line.side)&&Number.isFinite(line.value)&&line.value>0&&!terminal.has(line.status)).map(line=>({...line,
    color:line.side==='BUY'?'#087a4b':'#bb304a',
    remainingQuantity:Number.isFinite(line.remainingQuantity)&&line.remainingQuantity>=0?line.remainingQuantity:null,
  }));
}

export function limitOrderStatus(line){
  if(line.unconfirmed)return 'Status unconfirmed';
  return ({PARTIALLY_FILLED:'Partially filled',CANCELLING:'Cancelling',REPLACING:'Replacing',LOCAL:'Pending',UNCONFIRMED:'Pending',CONFIRMED:'Pending',NEW:'Pending'})[line.status]||'Status unconfirmed';
}

export function limitOrderLabel(line){
  const status=limitOrderStatus(line).replace('Partially filled','Partial').replace('Status unconfirmed','Unconfirmed');
  return `${line.side} LIMIT ${price.format(line.value)}${line.currency?` ${line.currency}`:''}\n${line.remainingQuantity===null?'Remaining unknown':`${number.format(line.remainingQuantity)} sh left`} · ${status}${line.stale?' · cached':''}`;
}

export function limitOrderDescription(line){
  return `${line.side} limit ${price.format(line.value)}${line.currency?` ${line.currency}`:''}, ${line.remainingQuantity===null?'remaining shares unknown':`${number.format(line.remainingQuantity)} shares remaining`}, ${limitOrderStatus(line)}${line.stale?', cached status':''}`;
}

// Return exact line coordinates and optional label slots. Labels can move to
// avoid one another (and the average-price label); their price lines never do.
// When the plot is full, the accessible order list still describes every line.
export function layoutLimitOrders(lines,{min,max,top,bottom,labelHeight=32,gap=4,reserved=[]}){
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min||bottom<=top)return [];
  const occupied=reserved.filter(band=>Number.isFinite(band.top)&&Number.isFinite(band.bottom)&&band.bottom>band.top).map(band=>({...band}));
  return lines.filter(line=>line.value>=min&&line.value<=max).sort((a,b)=>b.value-a.value||String(a.id).localeCompare(String(b.id))).map(line=>{
    const y=bottom-(line.value-min)/(max-min)*(bottom-top),desired=Math.max(top,Math.min(bottom-labelHeight,y-labelHeight/2));
    const candidates=[desired,top,bottom-labelHeight,...occupied.flatMap(band=>[band.bottom+gap,band.top-gap-labelHeight])];
    const labelTop=candidates.filter(at=>at>=top&&at+labelHeight<=bottom&&occupied.every(band=>at+labelHeight+gap<=band.top||at>=band.bottom+gap)).sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired)||a-b)[0];
    if(labelTop!==undefined)occupied.push({top:labelTop,bottom:labelTop+labelHeight});
    return {...line,y,labelY:labelTop===undefined?null:labelTop+labelHeight/2};
  });
}
