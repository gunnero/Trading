export const ORDER_STATUS_LABELS={LOCAL:'Pending',UNCONFIRMED:'Pending',CONFIRMED:'Pending',NEW:'Pending',CANCELLING:'Cancelling',CANCELLED:'Cancelled',PARTIALLY_FILLED:'Partially filled',FILLED:'Filled',REJECTED:'Rejected',REPLACING:'Replacing',REPLACED:'Replaced'};
export const orderStatusLabel=status=>ORDER_STATUS_LABELS[status]||status;

// Find the first instant of a calendar day in the selected display zone. This
// handles DST (23/25-hour days) without assuming a fixed UTC offset.
export function activityDateBounds(from,to,timeZone='Europe/Skopje'){
  if(typeof timeZone!=='string'||timeZone.length>80)throw Error('Choose a valid time zone.');
  const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const valid=day=>typeof day==='string'&&/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
  if(from&&!valid(from)||to&&!valid(to)||from&&to&&from>to)throw Error('Choose a valid date range.');
  const start=day=>{
    let low=Date.parse(day+'T00:00:00Z')-36*3600000,high=low+72*3600000;
    while(low<high){const mid=Math.floor((low+high)/2);if(format.format(mid)<day)low=mid+1;else high=mid;}
    return low;
  };
  const following=to?new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10):null;
  return {from:from?start(from):null,to:following?start(following):null};
}

export const portfolioEventLabel=event=>event.kind==='health'?'Connection alert':event.kind==='concentration'?'Concentration alert':event.kind==='price'?'Price alert':orderStatusLabel(event.status);
