// Close-based averages, calculated over all fetched history before the chart is trimmed.
export const SMA_LENGTHS=[20,50,100,200];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function sma(values,length){
  let sum=0,count=0;
  return values.map((value,index)=>{
    if(finite(value)){sum+=value;count++;}
    if(index>=length&&finite(values[index-length])){sum-=values[index-length];count--;}
    return index>=length-1&&count===length?sum/length:null;
  });
}
export function ema(values,length){
  const seeds=sma(values,length),alpha=2/(length+1);let previous=null;
  return values.map((value,index)=>{
    if(!finite(value)){previous=null;return null;}
    previous=previous===null?seeds[index]:alpha*value+(1-alpha)*previous;
    return previous;
  });
}
export function sessionVwap(rows){
  let session=null,numerator=0,volume=0,valid=false,end=null;
  return rows.map(row=>{
    if(row.start!==session){session=row.start;numerator=0;volume=0;valid=finite(session)&&row.timestamp===session;end=null;}
    // An incomplete session or missing volume cannot yield a trustworthy cumulative VWAP.
    if((end!==null&&row.timestamp>end)||!finite(row.volume)||row.volume<0)valid=false;
    end=row.end;
    if(!valid)return null;
    const [,close,low,high]=row.ohlc;
    numerator+=(high+low+close)/3*row.volume;volume+=row.volume;
    return volume>0?numerator/volume:null;
  });
}
export function chartIndicators({rows,sourceRows=rows,dailyRows=[],frame,now=Date.now(),limit=rows.length,dailyStatus='ok',dailyFetchedAt=null,kind='equity'}){
  const intraday=!['D','W','M'].includes(frame),closes=rows.map(r=>r.ohlc[1]);
  const series={ema9:ema(closes,9),ema21:ema(closes,21),vwap:rows.map(()=>null),pdh:[],pdl:[],pdc:[]};
  const dailyCutoff=dailyFetchedAt?Math.min(now,Date.parse(dailyFetchedAt)):now;
  const daily=dailyRows.filter(row=>row.end<=dailyCutoff/1000),averages=Object.fromEntries(SMA_LENGTHS.map(n=>[n,sma(daily.map(r=>r.ohlc[1]),n)]));
  for(const n of SMA_LENGTHS)series[`sma${n}`]=[];
  let previousDay=null;
  for(const row of rows){
    const date=intraday?row.sessionDate:row.lastDate||row.date;
    const prior=daily.findLastIndex(d=>d.date<date&&d.end<=(intraday?row.timestamp:row.end));
    // A daily close becomes usable at the closing intraday bar, never earlier.
    const confirmed=daily.findLastIndex(d=>d.date<=date&&d.end<=row.end);
    const previous=daily[prior];previousDay=previous?.date||null;
    series.pdh.push(previous?.ohlc[3]??null);series.pdl.push(previous?.ohlc[2]??null);series.pdc.push(previous?.ohlc[1]??null);
    for(const n of SMA_LENGTHS)series[`sma${n}`].push(confirmed>=0?averages[n][confirmed]:null);
  }
  if(intraday&&['equity','future'].includes(kind)){
    const values=sessionVwap(sourceRows);let cursor=-1;
    series.vwap=rows.map(row=>{
      while(cursor+1<sourceRows.length&&sourceRows[cursor+1].timestamp<row.end)cursor++;
      return cursor>=0&&sourceRows[cursor].start===row.start?values[cursor]:null;
    });
  }
  const trimmed=Object.fromEntries(Object.entries(series).map(([key,values])=>[key,values.slice(-limit)]));
  return {series:trimmed,sessions:rows.slice(-limit).map(r=>r.start??r.date),previousDay,dailyStatus,dailyFetchedAt,
    vwapStatus:!intraday?'intraday-only':!['equity','future'].includes(kind)?'no-volume':trimmed.vwap.some(finite)?'ok':'incomplete-session'};
}

// Split at EMA crossings so each ribbon polygon has one correct fill color.
export function ribbonSegments(fast,slow){
  const result=[];
  for(let i=1;i<fast.length;i++){
    if(![fast[i-1],slow[i-1],fast[i],slow[i]].every(finite))continue;
    const before=fast[i-1]-slow[i-1],after=fast[i]-slow[i];
    const segment=(x1,f1,s1,x2,f2,s2,bull)=>result.push({points:[[x1,f1],[x2,f2],[x2,s2],[x1,s1]],bull});
    if(before*after<0){const ratio=before/(before-after),x=i-1+ratio,y=fast[i-1]+ratio*(fast[i]-fast[i-1]);segment(i-1,fast[i-1],slow[i-1],x,y,y,before>0);segment(x,y,y,i,fast[i],slow[i],after>0);}
    else segment(i-1,fast[i-1],slow[i-1],i,fast[i],slow[i],(after||before)>=0);
  }
  return result;
}
