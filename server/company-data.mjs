import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {isEquityKey} from '../src/data/instruments.mjs';
import {resolveSymbol} from './market-data.mjs';
import {validDay} from '../src/data/calendar.mjs';
import {companyEarningsSeries} from './company-earnings.mjs';
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const raw=value=>numeric(value?.raw??value);
const clean=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):null;
const day=value=>{
 if(validDay(value?.fmt))return value.fmt;
 const n=raw(value);return n!==null&&n>0&&n<1e11?new Date(n*1000).toISOString().slice(0,10):null;
};
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function parseCompanyPage(html,symbol,now=Date.now()){
 let modules;
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/\bdata-sveltekit-fetched\b/.test(match[1]))continue;
  try{const envelope=JSON.parse(match[2]);if(envelope.status!==200)continue;const body=JSON.parse(envelope.body);const found=body.quoteSummary?.result?.find(r=>r.price?.symbol===symbol);if(found)modules={...modules,...found};}catch{/* Ignore unrelated page data, never execute it. */}
 }
 const p=modules?.price;
 if(!p||!['EQUITY','ETF','MUTUALFUND'].includes(p.quoteType))throw Error('Company snapshot unavailable for this listing.');
 if(!raw(p.regularMarketTime)||raw(p.regularMarketTime)*1000>now+300000)throw Error('Invalid snapshot timestamp.');
 const s=modules.summaryDetail||{},k=modules.defaultKeyStatistics||{},f=modules.financialData||{},profile=modules.summaryProfile||modules.assetProfile||{},calendar=modules.calendarEvents||{},earnings=modules.earnings||{},ec=earnings.earningsChart||{};
 const currency=clean(p.currency,8),fund=p.quoteType!=='EQUITY',financialCurrency=clean(f.financialCurrency||earnings.financialCurrency||(fund?currency:null),8);
 const quarter=day(k.mostRecentQuarter),shortDate=day(k.dateShortInterest),metrics={},groups=[];
 function group(id,title,definitions){const ids=[];for(const [key,label,value,format='number',ccy=null,asOf=null] of definitions){metrics[key]={label,value:raw(value),format,currency:ccy,asOf};ids.push(key);}groups.push({id,title,ids});}
 group('trading','Trading snapshot',[
  ['marketCap',fund?'Net assets':'Market cap',fund?s.totalAssets:(p.marketCap??s.marketCap),'compact',currency],
  ['open','Session open',p.regularMarketOpen,'price',currency],['previousClose','Previous close',p.regularMarketPreviousClose,'price',currency],
  ['dayLow','Session low',p.regularMarketDayLow,'price',currency],['dayHigh','Session high',p.regularMarketDayHigh,'price',currency],
  ['yearLow','52-week low',s.fiftyTwoWeekLow,'price',currency],['yearHigh','52-week high',s.fiftyTwoWeekHigh,'price',currency],
  ['averageVolume','Average daily volume · 3M',p.averageDailyVolume3Month??s.averageVolume,'compact'],['beta','Beta · 5Y monthly',s.beta??k.beta,'number']
 ]);
 if(fund){group('fund','Fund information',[
  ['expenseRatio','Annual expense ratio',modules.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio??k.annualReportExpenseRatio,'percent'],['fundYield','Yield',s.yield??k.yield,'percent'],['ytdReturn','Year-to-date return',k.ytdReturn??s.ytdReturn,'percent'],['threeYearReturn','3-year annualized return',k.threeYearAverageReturn,'percent'],['fiveYearReturn','5-year annualized return',k.fiveYearAverageReturn,'percent']
 ]);}else{
 group('valuation','Valuation',[
  ['enterpriseValue',currency===financialCurrency?'Enterprise value':'Enterprise value · currency not specified',k.enterpriseValue,'compact',currency===financialCurrency?currency:null],['trailingPE','P/E · trailing 12M',s.trailingPE,'number'],['forwardPE','P/E · forward estimate',s.forwardPE??k.forwardPE,'number'],['trailingEps','EPS · trailing 12M',k.trailingEps,'price',currency],['forwardEps','EPS · forward estimate',k.forwardEps,'price',currency],['priceSales','Price / sales · trailing 12M',s.priceToSalesTrailing12Months,'number'],['priceBook','Price / book · latest quarter',k.priceToBook,'number'],['peg','PEG · 5Y expected',k.pegRatio,'number']
 ]);
 group('profit','Revenue & profitability',[
  ['revenue','Revenue · TTM',f.totalRevenue,'compact',financialCurrency,quarter],['netIncome','Net income to common · TTM',k.netIncomeToCommon,'compact',financialCurrency,quarter],['ebitda','EBITDA · TTM',f.ebitda,'compact',financialCurrency,quarter],['profitMargin','Profit margin · TTM',f.profitMargins??k.profitMargins,'percent',null,quarter],['grossMargin','Gross margin · TTM',f.grossMargins,'percent',null,quarter],['operatingMargin','Operating margin · TTM',f.operatingMargins,'percent',null,quarter],['revenueGrowth','Quarterly revenue growth · YoY',f.revenueGrowth,'percent',null,quarter],['earningsGrowth','Quarterly earnings growth · YoY',f.earningsGrowth,'percent',null,quarter],['returnEquity','Return on equity · TTM',f.returnOnEquity,'percent',null,quarter]
 ]);
 group('balance','Balance sheet & cash flow',[
  ['cash','Total cash · latest quarter',f.totalCash,'compact',financialCurrency,quarter],['debt','Total debt · latest quarter',f.totalDebt,'compact',financialCurrency,quarter],['debtEquity','Debt / equity · latest quarter',f.debtToEquity,'percent-points',null,quarter],['currentRatio','Current ratio · latest quarter',f.currentRatio,'number',null,quarter],['operatingCashflow','Operating cash flow · TTM',f.operatingCashflow,'compact',financialCurrency,quarter],['freeCashflow','Free cash flow · TTM',f.freeCashflow,'compact',financialCurrency,quarter]
 ]);
 group('ownership','Float & ownership',[
  ['shares','Shares outstanding',k.sharesOutstanding,'compact'],['float','Float',k.floatShares,'compact'],['shortShares','Shares short',k.sharesShort,'compact',null,shortDate],['shortFloat','Short % of float',k.shortPercentOfFloat,'percent',null,shortDate],['shortRatio','Short ratio · days to cover',k.shortRatio,'number',null,shortDate],['institutions','Held by institutions',k.heldPercentInstitutions,'percent'],['insiders','Held by insiders',k.heldPercentInsiders,'percent']
 ]);
 }
 group('distributions','Dividends',[
  ['dividendRate','Forward annual dividend',s.dividendRate,'price',currency],['dividendYield','Forward dividend yield',s.dividendYield,'percent'],['payout','Payout ratio',s.payoutRatio,'percent']
 ]);
 const history=earnings.financialsChart||{},historyRows=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object').map(r=>({period:clean(String(r.fiscalQuarter||r.date),30),revenue:raw(r.revenue),income:raw(r.earnings)}));
 const dates=[...new Set((calendar.earnings?.earningsDate||ec.earningsDate||[]).map(day).filter(Boolean))].sort();
 return {symbol,name:clean(p.longName||p.shortName||symbol),type:p.quoteType,fund,currency,financialCurrency,quarter,sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,quoteObservedAt:new Date(raw(p.regularMarketTime)*1000).toISOString(),
  profile:{sector:clean(profile.sector),industry:clean(profile.industry),country:clean(profile.country),city:clean(profile.city),employees:raw(profile.fullTimeEmployees),website:safeLink(profile.website),investorRelations:safeLink(profile.irWebsite),description:clean(profile.longBusinessSummary,700),fundFamily:clean(k.fundFamily),category:clean(k.category),inception:day(k.fundInceptionDate)},
  metrics,groups,earnings:{dates,period:clean(ec.currentFiscalQuarter||ec.currentQuarterEstimateDate,30),estimated:typeof calendar.earnings?.isEarningsDateEstimate==='boolean'?calendar.earnings.isEarningsDateEstimate:typeof ec.isEarningsDateEstimate==='boolean'?ec.isEarningsDateEstimate:null,epsEstimate:raw(calendar.earnings?.earningsAverage),revenueEstimate:raw(calendar.earnings?.revenueAverage),...companyEarningsSeries(modules,now)},
  annual:historyRows(history.yearly),quarterly:historyRows(history.quarterly),exDividend:day(calendar.exDividendDate??s.exDividendDate),dividendDate:day(calendar.dividendDate),split:{factor:clean(k.lastSplitFactor,40),date:day(k.lastSplitDate)}};
}
export function createCompanyService({fetcher=fetch,now=()=>Date.now(),cachePath=null,onError=()=>{}}={}){
 const cache=new Map(),failures=new Map(),pending=new Map();let blockedUntil=0,active=0;const queue=[];
 if(cachePath)try{const saved=JSON.parse(readFileSync(cachePath,'utf8'));blockedUntil=Math.min(now()+86400000,Number(saved.blockedUntil)||0);if(saved.version===2){for(const [key,item] of (saved.entries||[]).slice(-100))if(item.data?.symbol===key&&Number.isFinite(item.at)&&now()-item.at<86400000&&item.at<=now())cache.set(key,item);}}catch{}
 function persist(){if(!cachePath)return;try{mkdirSync(dirname(cachePath),{recursive:true});writeFileSync(cachePath+'.tmp',JSON.stringify({version:2,entries:[...cache],blockedUntil}),{mode:0o600});renameSync(cachePath+'.tmp',cachePath);}catch{}}
 async function limited(fn){if(active>=2)await new Promise(r=>queue.push(r));else active++;try{return await fn();}finally{const next=queue.shift();if(next)next();else active--;}}
 async function get(key){
  if(!isEquityKey(key))return {status:'unavailable',symbol:key,message:'Company fundamentals are available for supported U.S. stocks and funds.'};
  const symbol=resolveSymbol(key).symbol,old=cache.get(symbol);
  const response=(item,status='ok')=>({symbol:key,status,data:item.data,fetchedAt:new Date(item.at).toISOString(),...(status==='stale'?{message:'Cached company snapshot; source refresh unavailable.'}:{})});
  if(old&&now()-old.at<1800000)return response(old);
  const fallback=()=>old&&now()-old.at<86400000?response(old,'stale'):{symbol:key,status:'unavailable',message:'Company snapshot unavailable from Yahoo. Chart and levels remain available. Automatic retry is scheduled.'};
  if(blockedUntil>now()||(failures.get(symbol)||0)>now())return fallback();
  if(pending.has(symbol)){const item=await pending.get(symbol);return item?response(item):fallback();}
  const task=limited(async()=>{try{
   if(blockedUntil>now())throw Error('Source backoff');
   const r=await fetcher(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,{headers:{'User-Agent':'OpeningBell/1.0 (personal market dashboard)','Accept':'text/html'},redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!r.ok){if([401,403,429].includes(r.status)){const retry=r.headers.get('retry-after'),seconds=Number(retry),until=retry&&Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry);blockedUntil=Math.max(now()+900000,Math.min(now()+86400000,until||0));}throw Error(`Source unavailable (HTTP ${r.status}).`);}
   if(!r.headers.get('content-type')?.includes('text/html'))throw Error('Unexpected source type');
   const reader=r.body.getReader(),parts=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4_000_000){await reader.cancel();throw Error('Source too large');}parts.push(value);}
   const data=parseCompanyPage(Buffer.concat(parts).toString('utf8'),symbol,now()),item={data,at:now()};cache.delete(symbol);cache.set(symbol,item);while(cache.size>100)cache.delete(cache.keys().next().value);failures.delete(symbol);persist();return item;
  }catch(error){onError(error,symbol);failures.set(symbol,Math.max(now()+300000,blockedUntil));while(failures.size>100)failures.delete(failures.keys().next().value);persist();return null;}}).finally(()=>pending.delete(symbol));
  pending.set(symbol,task);const result=await task;return result?response(result):fallback();
 }
 return {get};
}
export function companyMiddleware(service=createCompanyService({cachePath:new URL('../.cache/company-data.json',import.meta.url).pathname,onError:(error,symbol)=>console.warn(`Company snapshot ${symbol}: ${error.message}`)})){
 return async(req,res,next)=>{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/company')return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.end(JSON.stringify({message:'Use GET.'}));return;}
  const key=url.searchParams.get('symbol');if(!isEquityKey(key)){res.statusCode=400;res.end(JSON.stringify({message:'Choose a verified U.S. listing.'}));return;}
  res.end(JSON.stringify(await service.get(key)));
 };
}
