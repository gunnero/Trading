import {Fragment,useId} from 'react';
import {CaretDown,CaretRight,CaretUp,CaretUpDown,CheckCircle,FloppyDisk,NotePencil} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {usePortfolioPrivacy} from './PortfolioPrivacy';

const headers=[['date','Date/time'],['listing','Exact listing'],['side','Action'],['quantity','Quantity'],['price','Price'],['realized','Reported realized P/L']];
export const executionKey=t=>JSON.stringify([t.accountId,t.environment,t.brokerId,t.id]);
const symbol=t=>t.ticker?.replace(/_US_EQ$/,'')||t.name;
const amountFormat=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:8});
function amount(value,currency,signed,hidden){
  if(hidden)return '••••';
  if(!Number.isFinite(value)||!currency)return '—';
  return (signed&&value>0?'+':'')+amountFormat.format(value)+' '+currency;
}
function Side({side}){
  return <span className={'bj-side '+(side==='BUY'?'buy':side==='SELL'?'sell':'')}>{side==='BUY'?'Buy':side==='SELL'?'Sell':side||'—'}</span>;
}
function Detail({trade:t,editor,onChange,onSave,onClose,saving,error}){
  const p=usePortfolioPrivacy(),{clockDate,clockTime,zoneLabel}=useDisplayTime();
  return <div className="bj-detail">
    <section><h3>Execution summary</h3><dl>{[
      ['Person · Account',p.person(t.person)+' · '+p.label(t.accountLabel,t.accountId)+(t.environment==='demo'?' · DEMO':'')],
      ['Exact listing',t.name+' · '+t.ticker],['Date/time',clockDate(t.at)+', '+clockTime(t.at,true)+' '+zoneLabel],
      ['Action',<Side side={t.side}/>],['Quantity',p.number(t.quantity)],['Price',amount(t.price,t.priceCurrency,false,p.hideBalances)],
      ['Reported realized P/L',amount(t.realized,t.currency,true,p.hideBalances)],['Execution ID',t.id]
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    {p.privateMode?<p className="bj-private">Show names and balances to view or edit notes.</p>:
      <form className="bj-note" aria-label="Execution notes" onSubmit={onSave}>
        <label>Your note<textarea aria-label="Review notes" rows={4} maxLength={4000} disabled={saving} value={editor.notes} onChange={e=>onChange('notes',e.target.value)}/></label>
        <details className="bj-reason" open={editor.reasonOpen} onToggle={e=>{if(e.currentTarget.open!==editor.reasonOpen)onChange('reasonOpen',e.currentTarget.open);}}>
          <summary>Reason for the trade</summary><textarea aria-label="Reason for the trade" rows={2} maxLength={500} disabled={saving} value={editor.reason} onChange={e=>onChange('reason',e.target.value)}/>
        </details>
        {error&&<p className="amber" role="alert">{error}</p>}
        <div className="bj-note-actions"><button className="button primary" disabled={saving||editor.reason===t.note.reason&&editor.notes===t.note.notes}><FloppyDisk size={16}/>{saving?'Saving…':'Save note'}</button>
          {(editor.reason!==t.note.reason||editor.notes!==t.note.notes)&&<button type="button" className="text-button" disabled={saving} onClick={onClose}>Cancel</button>}
          {!!t.note.updatedAt&&<small role="status"><CheckCircle/>{'Last saved '+clockTime(t.note.updatedAt)+', '+clockDate(t.note.updatedAt)}</small>}
        </div>
      </form>}
  </div>;
}
export default function BrokerJournalTable({rows,sort,direction,onSort,editor,onSelect,onChange,onSave,onClose,saving,error}){
  const p=usePortfolioPrivacy(),{clockDate,clockTime,zoneLabel}=useDisplayTime(),prefix=useId();
  return <div className="bj-table-scroll"><label className="bj-mobile-sort">Sort by <select value={sort+' '+direction} onChange={e=>onSort(...e.target.value.split(' '))}>
    {headers.filter(([key])=>!p.hideBalances||!['price','quantity','realized'].includes(key)).flatMap(([key,label])=>['asc','desc'].map(dir=><option key={key+dir} value={key+' '+dir}>{label} · {dir==='asc'?'ascending':'descending'}</option>))}
  </select></label><table className="bj-table" aria-label="Broker executions">
    <thead><tr>{headers.map(([field,title])=>{
      const active=field===sort,Icon=active?(direction==='asc'?CaretUp:CaretDown):CaretUpDown;
      return <th key={field} scope="col" aria-sort={active?(direction==='asc'?'ascending':'descending'):undefined}>
        <button onClick={()=>onSort(field)} disabled={p.hideBalances&&['price','quantity','realized'].includes(field)} title={['price','realized'].includes(field)?'Sort by currency, then amount':undefined}>{title}<Icon size={13}/></button>
      </th>;
    })}<th scope="col">Notes</th></tr></thead><tbody>
      {rows.map((t,i)=>{
        const open=editor?.key===executionKey(t),detailId=prefix+'-'+i,toggle=()=>onSelect(t);
        const saved=!!(t.note.notes||t.note.reason),label=(open?'Collapse':'Expand')+' execution '+t.id+' for '+t.ticker;
        return <Fragment key={executionKey(t)}><tr className={'bj-row'+(open?' selected':'')} onClick={toggle}>
          <td data-label="Date/time"><button className="bj-expand" aria-label={label} aria-expanded={open} aria-controls={open?detailId:undefined} onClick={e=>{e.stopPropagation();toggle();}}>
            {open?<CaretDown/>:<CaretRight/>}<time dateTime={new Date(t.at).toISOString()} title={zoneLabel}>{clockDate(t.at)}, {clockTime(t.at)}</time></button></td>
          <td data-label="Exact listing" title={t.ticker}><b>{symbol(t)}</b>{t.name&&t.name!==symbol(t)&&<span> · {t.name}</span>}{t.environment==='demo'&&<small className="amber"> · DEMO</small>}</td>
          <td data-label="Action"><Side side={t.side}/></td><td data-label="Quantity">{p.number(t.quantity)}</td><td data-label="Price">{amount(t.price,t.priceCurrency,false,p.hideBalances)}</td>
          <td data-label="Reported realized P/L" className={p.hideBalances?'':t.realized>0?'green':t.realized<0?'red':''}>{amount(t.realized,t.currency,true,p.hideBalances)}</td>
          <td data-label="Notes"><button className="bj-note-link" disabled={p.privateMode} aria-label={p.privateMode?'Private notes':(saved?'Edit notes':'Add notes')+' for execution '+t.id}
            onClick={e=>{e.stopPropagation();onSelect(t,true);}}>{saved&&!p.privateMode?<NotePencil size={17}/>:'—'}</button></td>
        </tr>{open&&<tr className="bj-expanded" id={detailId}><td colSpan={7}><Detail trade={t} editor={editor} onChange={onChange} onSave={onSave} onClose={onClose} saving={saving} error={error}/></td></tr>}</Fragment>;
      })}
    </tbody></table></div>;
}
