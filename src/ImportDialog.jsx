import {useMemo,useRef,useState} from 'react';
import {ArrowCounterClockwise,CheckCircle,DownloadSimple,FileText,UploadSimple,WarningCircle,X} from '@phosphor-icons/react';
import {Modal} from './DeskModal';
import {mergeLevelSheets,parseWatchlist,zoneName} from './data/market';
import {serializeWatchlist,WATCH_GROUPS} from './data/watchlist.mjs';

const pageSize=10;

function buildPreview(isLevels,initial,text,sourceDates){
  if(!text.trim())return null;
  try{
    if(isLevels){
      const merged=mergeLevelSheets(initial,text,sourceDates);
      const rows=[];
      for(const [items,status] of [[merged.updated,'Updated'],[merged.added,'Added']]){
        for(const item of items){
          for(const zone of item.zones)rows.push({item,zone,status});
        }
      }
      return {merged,rows};
    }
    const rows=[],duplicates=new Set();
    const entries=parseWatchlist(text,{onRow:(entry,duplicate)=>{
      rows.push({entry,duplicate});
      if(duplicate)duplicates.add(entry.id);
    }});
    if(serializeWatchlist(entries).length>100000)throw Error('The watchlist exceeds the 100,000-character workspace limit.');
    return {entries,rows,duplicates:[...duplicates],duplicateCount:rows.length-entries.length};
  }catch(error){return {error:error.message};}
}

function PreviewTable({preview,page,onPage}){
  const {rows,merged}=preview;
  const headers=merged?['Listing','Type','Level','Timeframe','Source date','Change']:['Ticker','Exchange','Type','Import'];
  const start=page*pageSize;
  return <>
    <div className="import-table-scroll" role="region" aria-label="Import rows" tabIndex={0}>
      <table className="import-table"><thead><tr>{headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{rows.slice(start,start+pageSize).map((row,index)=>{
          if(merged){
            const {item,zone,status}=row;
            return <tr key={start+index}><th scope="row">{item.symbol}{item.futures?' · FUT':''}</th>
              <td><span className={'zone-type type-'+zone.type}>{zoneName(zone.type)}</span></td>
              <td>{zone.low}–{zone.high}</td><td>{item.timeframe}</td><td>{item.sourceDate}</td><td>{status}</td></tr>;
          }
          const {entry,duplicate}=row;
          return <tr key={start+index} className={duplicate?'duplicate-row':undefined}><th scope="row">{entry.ticker}</th>
            <td>{entry.exchange}</td><td>{WATCH_GROUPS[entry.group]||entry.group}</td><td>{duplicate?'Duplicate':'Keep'}</td></tr>;
        })}</tbody>
      </table>
    </div>
    {rows.length>pageSize&&<div className="import-paging"><span>{start+1}–{Math.min(start+pageSize,rows.length)} of {rows.length}</span>
      <button type="button" disabled={page===0} onClick={()=>onPage(page-1)}>Previous</button>
      <button type="button" disabled={start+pageSize>=rows.length} onClick={()=>onPage(page+1)}>Next</button></div>}
  </>;
}

export function ImportDialog({kind,initial,sourceDates,onClose,onImport}){
  const isLevels=kind==='levels';
  const [text,setText]=useState(isLevels?'':initial);
  const [fileName,setFileName]=useState(''),[reading,setReading]=useState(false);
  const [error,setError]=useState(''),[page,setPage]=useState(0);
  const fileVersion=useRef(0);
  const preview=useMemo(()=>buildPreview(isLevels,initial,text,sourceDates),[isLevels,initial,text,sourceDates]);
  const title=isLevels?'Import levels':'Import watchlist';
  const issue=error||preview?.error;

  function edit(value){
    fileVersion.current++;
    setText(value);setPage(0);setFileName('');setError('');setReading(false);
  }
  async function readFile(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    edit('');setFileName(file.name);
    const version=fileVersion.current;
    if(file.size>200000){setError('Choose a text file smaller than 200 KB.');return;}
    setReading(true);
    try{
      const contents=await file.text();
      if(fileVersion.current===version)setText(contents);
    }catch{
      if(fileVersion.current===version)setError('Could not read this file. Try pasting the text.');
    }finally{
      if(fileVersion.current===version)setReading(false);
    }
  }
  function submit(event){
    event.preventDefault();
    if(error||reading||!preview||preview.error||preview.duplicateCount)return;
    try{onImport(isLevels?preview.merged:preview.entries,text);}catch(cause){setError(cause.message);}
  }
  return <Modal title={title} onClose={onClose} className="edit-dialog import-dialog">
    <form onSubmit={submit}>
      <div className="edit-fields">
        <div className="import-source-actions"><label className="button outline file-picker"><UploadSimple size={16}/>Choose .txt file<input aria-label="Choose .txt file" type="file" accept=".txt,text/plain" onChange={readFile}/></label>
          <a className="text-button" download href={'/data/'+(isLevels?'levels':'watchlist')+'.txt'}><DownloadSimple size={16}/>Original import</a></div>
        {fileName&&<div className="import-file"><FileText size={19}/><strong>{fileName}</strong><button type="button" className="icon-button" aria-label="Remove selected file" onClick={()=>edit('')}><X size={17}/></button></div>}
        <label className="edit-field">{isLevels?'Level sheet':'Watchlist export'}<textarea rows={3} spellCheck={false} value={text} onChange={event=>edit(event.target.value)}
          placeholder={isLevels?'LVLS YYYY-MM-DD\nQQQ|30min|S 708.14-707.23':'###FUND,NASDAQ:QQQ,AMEX:SPY'}/></label>
        <p className="edit-help">{isLevels?'Paste a daily list or choose its text file. Missing listings keep their levels and original dates.':'This export replaces your saved watchlist. Each exchange and ticker pair is kept once, in its original order.'}</p>
        {reading&&<p role="status">Reading file…</p>}
        {issue&&<p className="edit-error" role="alert"><WarningCircle size={18}/>{issue}</p>}
        {preview?.rows&&<section className="import-preview" aria-label={isLevels?'Level import preview':'Watchlist import preview'}>
          <h3>Preview <small>({preview.rows.length} {preview.rows.length===1?'row':'rows'})</small></h3>
          <PreviewTable preview={preview} page={Math.min(page,Math.floor((preview.rows.length-1)/pageSize))} onPage={setPage}/>
          {isLevels?<><p className="import-status" role="status"><CheckCircle size={18}/>{preview.merged.updated.length} updated · {preview.merged.added.length} added · {preview.merged.carried.length} carried forward</p>
            {!!preview.merged.carried.length&&<details className="import-carried"><summary>Instruments kept from earlier lists</summary><ul>{preview.merged.carried.map(item=><li key={item.symbol}><strong>{item.symbol}{item.futures?' · FUT':''}</strong><span>{item.sourceDate} · {item.timeframe} · {item.zones.length} zones</span></li>)}</ul></details>}</>:
            preview.duplicateCount>0?<div className="import-duplicates">
              <p role="status"><WarningCircle size={18}/><span><strong>{preview.duplicateCount} duplicate {preview.duplicateCount===1?'row':'rows'}</strong> · {preview.duplicates.join(', ')}</span></p>
              <button type="button" className="text-button" onClick={()=>edit(serializeWatchlist(preview.entries))}><ArrowCounterClockwise size={16}/>Keep first occurrence of each listing</button></div>:
              <p className="import-status" role="status"><CheckCircle size={18}/>{preview.entries.length} {preview.entries.length===1?'listing':'listings'} ready to import</p>}
        </section>}
      </div>
      <div className="edit-footer"><button type="button" className="button outline" onClick={onClose}>{isLevels?'Cancel':'Keep current'}</button>
        <button type="submit" className="button primary" disabled={reading||!!issue||!preview||!!preview.duplicateCount}>{title}</button></div>
    </form>
  </Modal>;
}
