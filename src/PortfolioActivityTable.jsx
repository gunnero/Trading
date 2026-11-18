import {Fragment,useId,useState} from 'react';
import {CaretDown,CaretRight} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {portfolioListing} from './data/portfolio-listings.mjs';
import {BrokerStatus} from './BrokerOrderStatus';
import {orderStatusLabel} from './data/portfolio-activity.mjs';

export function ActivityAccount({item}){
  const privacy=usePortfolioPrivacy();
  return <span>{privacy.person(item.person)} · {privacy.label(item.accountLabel,item.accountId)}{item.environment==='demo'&&<b className="amber"> · DEMO</b>}</span>;
}

function ChargeAmounts({charges,amount,detailed=false}){
  if(!Array.isArray(charges))return '—';
  if(!charges.length)return 'None reported';
  if(detailed)return charges.map((fee,i)=><span className="pa-fee" key={i}>{fee.name.replaceAll('_',' ').toLowerCase()} {amount(fee.amount,fee.currency)}</span>);
  const byCurrency=new Map();
  for(const fee of charges)byCurrency.set(fee.currency,(byCurrency.get(fee.currency)??0)+fee.amount);
  return [...byCurrency].map(([currency,value])=><span className="pa-fee" key={currency}>{amount(value,currency)}</span>);
}

export default function PortfolioActivityTable({kind,items,watchlist}){
  const [expanded,setExpanded]=useState(null),prefix=useId();
  const privacy=usePortfolioPrivacy(),{clockDate,clockTime,zoneLabel}=useDisplayTime();
  const trades=kind==='trades',timeLabel=(trades?'Time':'Created')+' ('+zoneLabel+')';
  const headers=[timeLabel,'Account','Instrument','Side',...(trades?['Quantity','Fill price','Charges','Realized result']:['Filled / ordered','Limit price','Status'])];
  function amount(value,currency,signed=false){
    if(privacy.hideBalances)return '••••';
    if(!Number.isFinite(value)||!currency)return '—';
    return new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'code',minimumFractionDigits:2,maximumFractionDigits:8,signDisplay:signed?'exceptZero':'auto'}).format(value);
  }
  return <div className="pa-table-scroll"><table className="pa-table" aria-label={trades?'Trade executions':'Order history'}>
    <thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{items.map(item=>{
      const key=item.accountId+':'+item.id,open=expanded===key,detailId=prefix+key;
      const listing=portfolioListing({ticker:item.ticker,instrumentCurrency:item.priceCurrency},watchlist);
      const symbol=listing?.symbol||item.ticker?.replace(/_US_EQ$/,'')||item.name;
      const at=trades||item.createdAt?item.at:null;
      const shortTime=Number.isFinite(at)?clockDate(at)+', '+clockTime(at):'Time not supplied';
      const toggle=()=>setExpanded(open?null:key);
      return <Fragment key={key}><tr className={'pa-record'+(open?' expanded':'')} onClick={toggle}>
        <td data-label={timeLabel}><button type="button" className="pa-expand" aria-expanded={open} aria-controls={open?detailId:undefined}
          aria-label={(open?'Collapse ':'Expand ')+(trades?'execution ':'order ')+item.id+' for '+symbol}
          onClick={e=>{e.stopPropagation();toggle();}}>{open?<CaretDown size={15}/>:<CaretRight size={15}/>}<time dateTime={Number.isFinite(at)?new Date(at).toISOString():undefined}>{shortTime}</time></button></td>
        <td data-label="Account"><ActivityAccount item={item}/></td>
        <td data-label="Instrument" title={item.name+' · '+item.ticker}><strong>{symbol}</strong>{listing&&' ('+listing.exchange+')'}</td>
        <td data-label="Side"><span className={'pa-side '+(item.side==='BUY'?'buy':'sell')}>{item.side==='BUY'?'Buy':'Sell'}</span></td>
        {trades?<><td data-label="Quantity">{privacy.number(item.quantity)}</td><td data-label="Fill price">{amount(item.price,item.priceCurrency)}</td>
          <td data-label="Charges"><ChargeAmounts charges={item.charges} amount={amount}/></td>
          <td data-label="Realized result" className={privacy.hideBalances?'':item.realized>0?'green':item.realized<0?'red':''}>{amount(item.realized,item.currency,true)}</td></>:
          <><td data-label="Filled / ordered">{privacy.number(item.filledQuantity)} / {privacy.number(item.quantity)}
              {item.quantity==null&&Number.isFinite(item.value)&&<small>Value order · {amount(item.value,item.currency)}</small>}</td>
            <td data-label="Limit price">{amount(item.limitPrice,item.priceCurrency||item.currency)}</td>
            <td data-label="Status"><BrokerStatus label={orderStatusLabel(item.status)}/>{item.awaitingHistory&&<small>Awaiting broker confirmation</small>}</td></>}
      </tr>{open&&<tr className="pa-detail" id={detailId}><td colSpan={headers.length}><dl>
        <div><dt>Broker order reference</dt><dd>{(trades?item.orderId:item.id)??'—'}</dd>
          {trades&&<small>Execution {item.id}</small>}</div>
        <div><dt>{trades?'Supplied fees':'Order type'}</dt><dd>{trades?<ChargeAmounts charges={item.charges} amount={amount} detailed/>:item.type||'—'}</dd>
          {!trades&&typeof item.extendedHours==='boolean'&&<small>{item.extendedHours?'Extended sessions enabled':'Regular session only'}</small>}</div>
        <div><dt>{trades?'Fill time':'Creation time'} ({zoneLabel})</dt><dd>{Number.isFinite(at)?<time dateTime={new Date(at).toISOString()}>{clockDate(at)}, {clockTime(at,true)}</time>:'Time not supplied'}</dd>
          <small>{item.name} · {item.ticker}</small></div>
      </dl></td></tr>}</Fragment>;
    })}</tbody></table></div>;
}
