import {parseLevels,mergeLevelSheets} from './market.js';

export const LEVEL_HISTORY_DAYS=5;

function snapshot(levelText,levelSourceDates){
  if(typeof levelText!=='string'||levelText.length>200000)throw new Error('Invalid archived level sheet.');
  const sheet=parseLevels(levelText,levelSourceDates);
  return {date:sheet.date,levelText,levelSourceDates:Object.fromEntries(Object.values(sheet.instruments).map(item=>[item.symbol,item.sourceDate]))};
}

// Only older lists are stored here; the existing current fields remain authoritative.
export function validateLevelHistory(history,currentDate){
  if(history===undefined)return [];
  if(!Array.isArray(history)||history.length>=LEVEL_HISTORY_DAYS)throw new Error('Keep at most four previous level lists.');
  let newer=currentDate;
  return history.map(item=>{
    if(!item||typeof item!=='object')throw new Error('Invalid archived level list.');
    const result=snapshot(item.levelText,item.levelSourceDates);
    if(item.date!==result.date||result.date>=newer)throw new Error('Archived level lists must have distinct dates, newest first and older than the current list.');
    newer=result.date;
    return result;
  });
}

export function levelSnapshots(workspace){
  const current=snapshot(workspace.levelText,workspace.levelSourceDates);
  return [current,...validateLevelHistory(workspace.levelHistory,current.date)];
}

export function importLevelList(workspace,text){
  const snapshots=levelSnapshots(workspace),merged=mergeLevelSheets(workspace.levelText,text,workspace.levelSourceDates);
  // A correction to today's list replaces that day, rather than consuming a slot.
  const levelHistory=snapshots.filter(item=>item.date<merged.date).slice(0,LEVEL_HISTORY_DAYS-1);
  return {...workspace,levelText:merged.levelText,levelSourceDates:merged.levelSourceDates,levelHistory};
}

const zoneKey=zone=>`${zone.type}:${zone.low}:${zone.high}`;
export function compareLevelInstruments(selected,previous){
  const currentKeys=new Set(selected?.zones.map(zoneKey)),oldKeys=new Set(previous?.zones.map(zoneKey));
  const added=(selected?.zones||[]).filter(zone=>!oldKeys.has(zoneKey(zone)));
  const removed=(previous?.zones||[]).filter(zone=>!currentKeys.has(zoneKey(zone)));
  const metadataChanged=!!selected&&!!previous&&(selected.timeframe!==previous.timeframe||selected.futures!==previous.futures);
  return {status:!previous?'added':!selected?'removed':added.length||removed.length||metadataChanged?'changed':'unchanged',added,removed,metadataChanged};
}
