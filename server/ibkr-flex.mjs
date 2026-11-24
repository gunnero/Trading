import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
import {validateTrade} from '../src/data/journal.mjs';

export const FLEX_BASE='https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/';
export const flexError=message=>Object.assign(new Error(message),{status:400});
const list=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function flexXml(raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>8_000_000||/<!DOCTYPE|<!ENTITY/i.test(raw)||XMLValidator.validate(raw)!==true)throw flexError('IBKR returned invalid or oversized XML. Choose XML output in the Flex query.');
  return new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,parseAttributeValue:false,processEntities:false}).parse(raw);
}
function date(value){const s=String(value||'').replace(/-/g,'');if(!/^\d{8}$/.test(s))throw flexError('Select yyyyMMdd dates in the Flex query.');const result=`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;if(!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result)throw flexError('Invalid execution date in the report.');return result;}
export function flexInstant(value,zone){
  const match=/^(\d{8}|\d{4}-\d{2}-\d{2})[; T](\d{2}):?(\d{2}):?(\d{2})$/.exec(value||'');
  if(!match||+match[2]>23||+match[3]>59||+match[4]>59)throw flexError('Execution timestamps must include seconds. Select yyyyMMdd and HHmmss in IBKR.');
  const wanted=`${date(match[1])}T${match[2]}:${match[3]}:${match[4]}`,approx=Date.parse(wanted+'Z');
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const matches=[];
  for(let offset=-840;offset<=840;offset+=15){const at=approx+offset*60000;if(fmt.format(at).replace(' ','T')===wanted)matches.push(at);}
  if(matches.length!==1)throw flexError('An execution time is ambiguous or nonexistent during a clock change. Check the report timezone.');
  return new Date(matches[0]).toISOString();
}
const required=(value,label,pattern=/^[\w.:-]{1,80}$/)=>{if(typeof value!=='string'||!pattern.test(value))throw flexError(`Include a valid ${label} in the execution report.`);return value;};
const numeric=(value,label)=>{if(typeof value!=='string'||!value.trim()||!Number.isFinite(Number(value)))throw flexError(`Include ${label} in the execution report.`);return Number(value);};
export function parseFlexReport(raw,config,kind='activity'){
  const doc=flexXml(raw),root=doc.FlexQueryResponse;
  if(!root?.FlexStatements||!root.queryName)throw flexError('Expected a complete Flex XML report with an execution section.');
  const statements=list(root.FlexStatements.FlexStatement);
  if(!statements.length||Number(root.FlexStatements.count)!==statements.length)throw flexError('The Flex report is incomplete. No trades were imported.');
  const fills=[],coverage=[];let skipped=0,found=false;
  for(const statement of statements){
    if(statement.accountId!==config.accountId)continue;
    found=true;
    const section=kind==='activity'?statement.Trades:statement.TradeConfirms;
    if(section===undefined)throw flexError(`Include ${kind==='activity'?'Trades':'Trade Confirmations'} at Execution detail in this query.`);
    coverage.push({from:date(statement.fromDate),to:date(statement.toDate)});
    const rows=list(kind==='activity'?section.Trade:section.TradeConfirm);
    if(rows.length>20000)throw flexError('Too many executions. Narrow the query period.');
    for(const row of rows){
      if(row.accountId&&row.accountId!==config.accountId)throw flexError('An execution has a different account ID.');
      if(row.assetCategory!=='OPT'){skipped++;continue;}
      if(row.levelOfDetail!=='EXECUTION')throw flexError('Select only Execution detail for option trades.');
      if(row.currency!=='USD')throw flexError('This options journal supports USD executions only. Filter the query to USD options.');
      const codes=(row.notes||row.code||'').split(/[;,\s]+/).filter(Boolean),original=row.origTradeID||row.originalTradeID;
      if((original&&original!=='0')||(row.transactionType&&!['ExchTrade','Trade'].includes(row.transactionType))||codes.some(c=>['Ca','Co','A','AEx','Ep','Ex','GEA','Adj','Rb'].includes(c))||/cancel|correct|assign|expir|exerc/i.test(row.notes||row.code||''))throw flexError('The report contains a correction, cancellation or option lifecycle event that needs review. No changes were imported.');
      const executionId=required(row.ibExecID||row.execID,'IB Execution ID'),contractId=required(row.conid,'Conid',/^\d{1,20}$/);
      // Trade Confirmations call the open/close field Code; never infer it
      // from the buy/sell side alone (a sell can open a short position).
      const roles=codes.filter(c=>['O','C'].includes(c));
      const openClose=row.openCloseIndicator||(roles.length===1?roles[0]:'');
      if(!['O','C'].includes(openClose)||!['BUY','SELL'].includes(row.buySell))throw flexError('Include Buy/Sell and an unambiguous Open/Close Indicator (O or C).');
      const quantity=Math.abs(numeric(row.quantity,'Quantity')),price=numeric(row.tradePrice??row.price,'Trade Price');
      const at=flexInstant(row.dateTime||`${row.tradeDate};${row.tradeTime}`,config.timeZone);
      const commissionValue=row.ibCommission??row.commission,commissionCurrency=row.ibCommissionCurrency??row.commissionCurrency,taxValue=row.taxes??row.tax;
      let fees=null;
      if(commissionValue!==undefined&&commissionValue!==''&&commissionCurrency==='USD'&&taxValue!==undefined&&taxValue!==''){
        const commission=numeric(commissionValue,'IB Commission'),tax=numeric(taxValue,'Taxes');
        if(commission>0||tax<0)throw flexError('A commission rebate or tax adjustment needs review before importing.');
        fees=-commission+tax;
      }
      const fill={id:hash([config.accountId,executionId]),account:config.accountId,executionId,contractId,symbol:required(row.underlyingSymbol,'Underlying Symbol',/^[A-Z][A-Z0-9.]{0,11}$/),expiration:date(row.expiry),optionType:row.putCall==='C'?'CALL':row.putCall==='P'?'PUT':'',strike:numeric(row.strike,'Strike'),multiplier:numeric(row.multiplier,'Multiplier'),quantity,price,at,side:row.buySell,openClose,orderId:required(row.ibOrderID||row.orderID,'IB Order ID'),fees,kind};
      // Reuse the journal's bounds and precision checks without manufacturing a close.
      validateTrade({id:fill.id,firm:'IBKR',account:fill.account,symbol:fill.symbol,expiration:fill.expiration,optionType:fill.optionType,strike:fill.strike,multiplier:fill.multiplier,quantity,entryPrice:price||0.0001,entryAt:at,exitPrice:null,exitAt:null,position:fill.side==='BUY'?'long':'short',source:'import',tags:[]});
      if(price<0||openClose==='O'&&price===0)throw flexError('Unsupported execution price.');
      fills.push(fill);
    }
  }
  if(!found)throw flexError('The selected account ID is not present in this report. Check the account and query settings.');
  return {fills,coverage,skipped};
}

export function mergeFills(existing,incoming){
  const map=new Map(existing.map(f=>[f.id,f]));
  for(const fill of incoming){
    const old=map.get(fill.id);
    if(old){
      const core=f=>{const {kind,fees,...rest}=f;return rest;};
      if(JSON.stringify(core(old))!==JSON.stringify(core(fill)))throw flexError('IBKR changed a previously saved execution. Sync paused for reconciliation; existing trades are unchanged.');
      // Final activity commissions take precedence over intraday confirmations.
      if(fill.kind==='activity'||old.kind!=='activity')map.set(fill.id,{...fill,fees:fill.fees??old.fees});
    }else map.set(fill.id,fill);
  }
  if(map.size>20000)throw flexError('Saved execution limit reached (20,000). Export the journal before extending history.');
  return [...map.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.executionId.localeCompare(b.executionId));
}

export function matchFills(fills,notes={}){
  const queues=new Map(),trades=[],unmatched=[];
  const keyOf=f=>JSON.stringify([f.account,f.contractId]);
  const balances=new Map(),blocked=new Set(),contracts=new Map();
  // A truncated report can contain some, but not all, opening lots. Matching
  // only the available portion would manufacture a FIFO basis. Withhold that
  // contract until the missing history is supplied.
  for(const f of fills){
    const key=keyOf(f),identity=JSON.stringify([f.symbol,f.expiration,f.optionType,f.strike,f.multiplier]);
    if(contracts.has(key)&&contracts.get(key)!==identity)throw flexError('An IBKR contract changed identity. Reconciliation is required.');
    contracts.set(key,identity);
    const balance=balances.get(key)||{BUY:0,SELL:0},side=f.openClose==='O'?f.side:f.side==='BUY'?'SELL':'BUY';
    balance[side]+=f.openClose==='O'?f.quantity:-f.quantity;
    if(balance[side]<0)blocked.add(key);balances.set(key,balance);
  }
  function record(entry,exit,quantity){
    const id='ibkr-'+hash([entry.id,exit?.id||'open']);
    const note=notes[id]||notes['ibkr-'+hash([entry.id,'open'])]||{};
    const fees=entry.fees===null||exit?.fees===null?null:entry.fees*quantity/entry.quantity+(exit?exit.fees*quantity/exit.quantity:0);
    trades.push(validateTrade({id,firm:'IBKR',account:entry.account,symbol:entry.symbol,expiration:entry.expiration,optionType:entry.optionType,strike:entry.strike,multiplier:entry.multiplier,quantity,position:entry.side==='BUY'?'long':'short',entryPrice:entry.price,entryAt:entry.at,exitPrice:exit?.price??null,exitAt:exit?.at??null,fees:fees===null?null:Math.round(fees*1e8)/1e8,risk:notes[id]?.risk==null?null:notes[id].risk*quantity/(notes[id].quantity||quantity),reportedPnl:null,notes:note.notes||'',tags:note.tags||[],review:note.review||{},source:'import',sourceLabel:'IBKR Flex · FIFO matched executions',entryOrderId:entry.orderId,exitOrderId:exit?.orderId||'',entryExecutionId:entry.executionId,exitExecutionId:exit?.executionId||''}));
  }
  for(const fill of fills){
    const key=keyOf(fill);
    if(blocked.has(key)){if(fill.openClose==='C')unmatched.push({executionId:fill.executionId,symbol:fill.symbol,at:fill.at,quantity:fill.quantity});continue;}
    const queue=queues.get(key)||[];queues.set(key,queue);
    if(fill.openClose==='O'){queue.push({fill,left:fill.quantity});continue;}
    let left=fill.quantity;
    for(const lot of queue){
      if(!left)break;if(!lot.left||lot.fill.side===fill.side)continue;
      const qty=Math.min(left,lot.left);record(lot.fill,fill,qty);lot.left-=qty;left-=qty;
    }
    if(left)unmatched.push({executionId:fill.executionId,symbol:fill.symbol,at:fill.at,quantity:left});
  }
  for(const queue of queues.values())for(const lot of queue)if(lot.left)record(lot.fill,null,lot.left);
  if(trades.length>2000)throw flexError('Journal limit reached (2,000 matched records). Narrow the import range.');
  return {journal:{version:1,trades},unmatched};
}
