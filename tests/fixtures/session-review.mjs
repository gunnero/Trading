import {fixture} from './journal.mjs';
export const reviewDay='2026-10-26',reviewStart=Date.parse(reviewDay+'T13:30:00Z')/1000;
const bar=(i,close=99.5,low=close-.2,high=close+.2)=>({timestamp:reviewStart+i*120,end:reviewStart+(i+1)*120,start:reviewStart,sessionEnd:reviewStart+23400,sessionDate:reviewDay,date:reviewDay,complete:true,partial:false,volume:100,ohlc:[close-.05,close,low,high]});
export const reviewHistory=()=>({status:'ok',symbol:'NASDAQ:AMD',timeframe:'2m',observedThrough:reviewStart+23400,candles:[...Array.from({length:25},(_,i)=>bar(i)),bar(25,101.4,101.1,101.6),bar(26,101.3,100.8,101.5)]});
export const reviewLevels=`LVLS ${reviewDay}\nAMD|4h|S 100-101\nQQQ|4h|S 700-701`;
export const reviewTrades=()=>[
  fixture({id:'matched',entryAt:reviewDay+'T14:24:23Z',exitAt:reviewDay+'T14:29:00Z',tags:['Followed plan']}),
  fixture({id:'early',entryAt:reviewDay+'T14:22:23Z',exitAt:reviewDay+'T14:28:00Z',tags:['Early entry']}),
  fixture({id:'missing',symbol:'QQQ',entryPrice:2,exitPrice:1.5,reportedPnl:-50,entryAt:reviewDay+'T15:00:00Z',exitAt:reviewDay+'T15:10:00Z'}),
  fixture({id:'premarket',entryAt:reviewDay+'T12:00:00Z',exitAt:null,exitPrice:null,reportedPnl:null}),
  fixture({id:'overnight',account:'Second account',entryPrice:1,exitPrice:1.2,reportedPnl:20,entryAt:'2026-10-23T19:00:00Z',exitAt:reviewDay+'T13:40:00Z'})
];
export const reviewPlan={id:'legacy-plan',symbol:'QQQ',scenario:'rejection',scenarioTitle:'Supply rejection',strategy:'Long put',expiration:'2026-10-30',budget:'150',thesis:'Wait for the retest.',notes:'Keep the original thesis.',sessionDate:'2026-10-23',priceMode:'sample'};
