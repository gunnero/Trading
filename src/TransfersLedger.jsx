import {Fragment,useState} from 'react';
import {CaretDown,CaretRight,CaretUp} from '@phosphor-icons/react';
import {ACTIVITIES,addMoney,moneyText,validDay} from './data/transfers.mjs';

const dateFormat=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const formatDate=date=>validDay(date)?dateFormat.format(new Date(date+'T12:00:00Z')):'—';

function Amount({value,currency}){
  const tone=value?.startsWith('-')?'red':value&&value!=='0'?'green':'';
  return <span className={'ledger-amount '+tone}>{moneyText(value??null,currency)}</span>;
}

function LedgerRow({row,group,expanded,onExpand,onReview,busy,installment}){
  const category=group?'Purchase':ACTIVITIES[row.review?.activity]||'Unassigned';
  const reviewStatus=item=>!item.review?'Needs review':item.review.activity==='exclude'?'Excluded':'Confirmed';
  const statuses=group?new Set(row.children.map(reviewStatus)):null;
  const status=group?(statuses.has('Needs review')?'Needs review':statuses.size===1?[...statuses][0]:'Mixed'):reviewStatus(row);
  const amountMkd=group?(row.children.every(item=>item.settlementAmount!=null)?row.children.reduce((sum,item)=>addMoney(sum,item.settlementAmount),'0'):null):row.settlementAmount;
  const categoryTone=group?'purchase':row.review?.activity||'unknown';
  const description=row.description||row.recipient||'Description unavailable';
  const installmentNumber=installment&&description.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
  const displayDate=installment&&row.bookingDate?row.bookingDate:row.date;
  const descriptionText=<>{installmentNumber?'Installment '+installmentNumber[1]+' of '+installmentNumber[2]:description}{group&&<small>{row.children.length} of {row.installmentCount} installments imported · purchase counted once</small>}</>;
  return <tr className={group?'transfer-installments':installment?'transfer-row ledger-installment':'transfer-row'}>
    <td data-label="Date"><time dateTime={displayDate||undefined} title={installment&&row.bookingDate?'Booking date · Purchase '+formatDate(row.date):undefined}>{formatDate(displayDate)}</time></td>
    <td data-label="Description" title={description}>{group?<button type="button" className="ledger-group-button" aria-expanded={expanded} onClick={onExpand}>
      {expanded?<CaretDown/>:<CaretRight/>}<span>{descriptionText}</span></button>:<>{descriptionText}
      {row.recipient&&row.recipient!==description&&<small>{row.recipient}</small>}</>}</td>
    <td data-label="Category"><span className={'ledger-category '+categoryTone}>{category}</span></td>
    <td data-label="Source" title={row.review?.platform}>{row.sourceLabel||'NLB Klik'}</td>
    <td data-label="Original amount">{installment?<small title={'Bank purchase amount · '+moneyText(row.amount,row.currency)}>In purchase total</small>:<Amount value={row.amount} currency={row.currency}/>}</td>
    <td data-label="MKD settlement"><Amount value={amountMkd} currency="MKD"/>{!group&&!installment&&row.bookingDate&&row.bookingDate!==row.date&&<small>{formatDate(row.bookingDate)}</small>}</td>
    <td data-label="Review">{group?<span className={'ledger-status '+status.toLowerCase().replace(' ','-')}>{status}</span>:
      <button className={'ledger-status '+status.toLowerCase().replace(' ','-')} aria-label={row.review?'Edit':'Review'} title={(row.review?'Edit category':'Review transaction')+(row.review?.automatic?' · Automatically matched':'')} disabled={busy} onClick={()=>onReview(row)}>{status}</button>}</td>
  </tr>;
}

export function TransfersLedger({rows,ascending,onSort,busy,onReview}){
  const [expanded,setExpanded]=useState(new Set());
  const toggle=id=>setExpanded(current=>{
    const next=new Set(current);
    if(next.has(id))next.delete(id);else next.add(id);
    return next;
  });
  return <table className="ledger-table"><caption className="sr-only">Imported bank transactions</caption><thead><tr>
    <th scope="col" aria-sort={ascending?'ascending':'descending'}><button onClick={onSort}>Date {ascending?<CaretUp/>:<CaretDown/>}</button></th>
    {['Description','Category','Source','Original amount','MKD settlement','Review'].map(label=><th key={label} scope="col">{label}</th>)}
  </tr></thead><tbody>
    {rows.map(row=><Fragment key={row.id}><LedgerRow row={row} group={!!row.children} expanded={expanded.has(row.id)} onExpand={()=>toggle(row.id)} onReview={onReview} busy={busy}/>
      {row.children&&expanded.has(row.id)&&row.children.map(child=><LedgerRow key={child.id} row={child} installment onReview={onReview} busy={busy}/>)}</Fragment>)}
    {!rows.length&&<tr><td colSpan={7} className="transfer-empty">No entries match this view.</td></tr>}
  </tbody></table>;
}
