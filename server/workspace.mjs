import {validateDisplayTime} from '../src/data/display-time.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevels, parseWatchlist } from '../src/data/market.js';
import { TIMEFRAMES } from '../src/data/candles.js';
import {isEquityKey,SETUP_INTERVALS} from '../src/data/instruments.mjs';
import {validateDrawings} from '../src/data/drawings.mjs';
import {validateChartSettings} from '../src/data/chart-settings.mjs';
import {validateLevelHistory} from '../src/data/level-history.mjs';
import {validateJournal} from '../src/data/journal.mjs';
import {validateSessionReviews} from '../src/data/session-review.mjs';

export const defaultDirectory = fileURLToPath(new URL('../.data/', import.meta.url));
export function initialWorkspace() {
  return { schemaVersion:1, levelText:readFileSync(new URL('./seed/levels.txt',import.meta.url),'utf8'), watchText:readFileSync(new URL('./seed/watchlist.txt',import.meta.url),'utf8'), plans:[], manualSentiment:null, preferences:{symbol:'QQQ',timeframe:'4h'} };
}
const bad = message => Object.assign(new Error(message),{status:400});
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
function bounded(value,name,max=10000) { if(typeof value!=='string'||value.length>max)throw bad(`Invalid ${name}.`);return value; }
export function validateWorkspace(value) {
  if(!value || value.schemaVersion!==1 || !Array.isArray(value.plans) || value.plans.length>500)throw bad('Invalid workspace format.');
  const levelText=bounded(value.levelText,'level sheet',200000),watchText=bounded(value.watchText,'watchlist',100000);
  let levelSourceDates,levelHistory;
  try {
    const sheet=parseLevels(levelText,value.levelSourceDates);
    if(value.levelHistory!==undefined)levelHistory=validateLevelHistory(value.levelHistory,sheet.date);
    if(value.levelSourceDates!==undefined)levelSourceDates=Object.fromEntries(Object.values(sheet.instruments).map(item=>[item.symbol,item.sourceDate]));
    parseWatchlist(watchText,{allowEmpty:true});
  }catch(e){throw bad(e.message);}
  if(!['QQQ','SPY'].includes(value.preferences?.symbol)||!TIMEFRAMES.includes(value.preferences?.timeframe))throw bad('Invalid chart preferences.');
  const preferences={symbol:value.preferences.symbol,timeframe:value.preferences.timeframe};
  if(value.preferences.focus!==undefined){if(!['QQQ','SPY','hot','custom'].includes(value.preferences.focus))throw bad('Invalid focus tab.');preferences.focus=value.preferences.focus;}
  if(value.preferences.customSymbol!==undefined){if(value.preferences.customSymbol!==''&&!isEquityKey(value.preferences.customSymbol))throw bad('Invalid custom listing.');preferences.customSymbol=value.preferences.customSymbol;}
  if(value.preferences.setupInterval!==undefined){if(!SETUP_INTERVALS.includes(value.preferences.setupInterval))throw bad('Invalid setup interval.');preferences.setupInterval=value.preferences.setupInterval;}
  let displayTime;
  if(value.displayTime!==undefined){try{displayTime=validateDisplayTime(value.displayTime);}catch(e){throw bad(e.message);}}
  const ids=new Set();
  const plans=value.plans.map(plan=>{
    if(!plan||typeof plan.id!=='string'||plan.id.length>80||!plan.id||ids.has(plan.id))throw bad('Invalid or duplicate plan identifier.');
    ids.add(plan.id);
    if(!/^[A-Z][A-Z0-9.]{0,9}$/.test(plan.symbol)||!['rejection','continuation'].includes(plan.scenario)||!['Long call','Long put','Call debit spread','Put debit spread'].includes(plan.strategy)||!validDate(plan.expiration)||!validDate(plan.sessionDate)||!['sample','yahoo'].includes(plan.priceMode))throw bad('Invalid plan details.');
    if((!['QQQ','SPY'].includes(plan.symbol)||plan.marketKey!==undefined)&&(!isEquityKey(plan.marketKey)||plan.marketKey.split(':').at(-1)!==plan.symbol))throw bad('A verified listing is required for a stock plan.');
    if(typeof plan.budget!=='string'||plan.budget.length>20||(plan.budget!==''&&(!Number.isFinite(Number(plan.budget))||Number(plan.budget)<=0)))throw bad('Invalid premium loss budget.');
    let marketQuote;
    if(plan.priceMode==='yahoo'){const q=plan.marketQuote;if(!q||q.provider!=='Yahoo Finance'||typeof q.price!=='number'||!Number.isFinite(q.price)||q.price<=0||typeof q.observedAt!=='string'||!Number.isFinite(Date.parse(q.observedAt)))throw bad('Invalid plan reference quote.');marketQuote={price:q.price,observedAt:new Date(q.observedAt).toISOString(),provider:'Yahoo Finance'};}
    return {id:plan.id,symbol:plan.symbol,scenario:plan.scenario,scenarioTitle:bounded(plan.scenarioTitle,'scenario title',100),strategy:plan.strategy,expiration:plan.expiration,budget:plan.budget,thesis:bounded(plan.thesis,'thesis'),notes:bounded(plan.notes,'notes'),sessionDate:plan.sessionDate,priceMode:plan.priceMode,...(marketQuote?{marketQuote}:{}),...(plan.marketKey?{marketKey:plan.marketKey}:{})};
  });
  let manualSentiment=null;
  if(value.manualSentiment!==null){const r=value.manualSentiment;if(!r||typeof r.score!=='number'||!Number.isFinite(r.score)||r.score<0||r.score>100||!['Extreme fear','Fear','Neutral','Greed','Extreme greed'].includes(r.rating)||!validDate(r.date)||r.date>new Date().toISOString().slice(0,10))throw bad('Invalid manual sentiment reading.');manualSentiment={score:r.score,rating:r.rating,date:r.date,observedAt:`${r.date}T12:00:00.000Z`,manual:true};}
  let chartDrawings;
  if(value.chartDrawings!==undefined){try{chartDrawings=validateDrawings(value.chartDrawings);}catch(e){throw bad(e.message);}}
  let chartSettings;
  if(value.chartSettings!==undefined){try{chartSettings=validateChartSettings(value.chartSettings);}catch(e){throw bad(e.message);}}
  let journal;
  if(value.journal!==undefined){try{journal=validateJournal(value.journal);}catch(e){throw bad(e.message);}}
  let sessionReviews;
  if(value.sessionReviews!==undefined){try{sessionReviews=validateSessionReviews(value.sessionReviews);}catch(e){throw bad(e.message);}}
  return {schemaVersion:1,levelText,watchText,plans,manualSentiment,preferences,...(displayTime?{displayTime}:{}),...(levelSourceDates?{levelSourceDates}:{}),...(levelHistory?{levelHistory}:{}),...(chartDrawings?{chartDrawings}:{}),...(chartSettings?{chartSettings}:{}),...(journal?{journal}:{}),...(sessionReviews?{sessionReviews}:{})};
}
export function openWorkspaceStore({directory=process.env.OPENING_BELL_DATA_DIR || defaultDirectory}={}) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=join(directory,'workspace.sqlite');
  const db=new DatabaseSync(filename);chmodSync(filename,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>1){db.close();throw new Error('This workspace was created by a newer app version.');}
  db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL); PRAGMA user_version=1;');
  db.prepare('INSERT OR IGNORE INTO workspace (id,revision,document,updated_at) VALUES (1,0,?,?)').run(JSON.stringify(initialWorkspace()),new Date().toISOString());
  function read(){const row=db.prepare('SELECT revision,document,updated_at FROM workspace WHERE id=1').get();return {revision:row.revision,updatedAt:row.updated_at,data:JSON.parse(row.document)};}
  function save(input,revision){
    if(!Number.isSafeInteger(revision)||revision<0)throw bad('A valid workspace revision is required.');
    const data=validateWorkspace(input),updatedAt=new Date().toISOString();
    const result=db.prepare('UPDATE workspace SET revision=revision+1,document=?,updated_at=? WHERE id=1 AND revision=?').run(JSON.stringify(data),updatedAt,revision);
    if(!result.changes)throw Object.assign(new Error('This workspace changed in another tab. Back up your edits, then load the saved version.'),{status:409});
    return {revision:revision+1,updatedAt,data};
  }
  return {read,save,close:()=>db.close(),filename};
}
export function workspaceMiddleware(store) {
  return async (req,res,next)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path!=='/api/workspace')return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      if(req.method==='GET'){res.end(JSON.stringify(store.read()));return;}
      if(req.method!=='PUT'){res.setHeader('Allow','GET, PUT');throw Object.assign(new Error('Use GET or PUT.'),{status:405});}
      const origin=req.headers.origin;
      const configured=(process.env.OPENING_BELL_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      let sameOrigin=!origin;
      if(origin){try{const parsed=new URL(origin);sameOrigin=['http:','https:'].includes(parsed.protocol)&&parsed.host===req.headers.host;}catch{sameOrigin=false;}}
      if((!sameOrigin&&!configured.includes(origin))||req.headers['sec-fetch-site']==='cross-site')throw Object.assign(new Error('Workspace saves must come from this app.'),{status:403});
      if(req.headers['x-opening-bell-client']!=='web'||req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw Object.assign(new Error('A JSON app request is required.'),{status:415});
      if(Number(req.headers['content-length'])>3_000_000)throw Object.assign(new Error('Workspace exceeds the 3 MB limit.'),{status:413});
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>3_000_000)throw Object.assign(new Error('Workspace exceeds the 3 MB limit.'),{status:413});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw bad('Invalid JSON.');}
      const result=store.save(body?.data,body?.revision);res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status || 500;res.end(JSON.stringify({message:error.status?error.message:'The workspace could not be saved. Your edits remain in this tab.'}));}
  };
}
