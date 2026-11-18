import {useState} from 'react';
import {Info} from '@phosphor-icons/react';
import {Modal} from './DeskModal';
import {useDisplayTime} from './DisplayTime';
import {formatPrice,zoneText} from './data/market';
import {quoteChange,quoteTone} from './data/quotes.mjs';
import {marketDay} from './data/calendar.mjs';

export function PlanDialog({ symbol, marketKey, setup, context, quote, onClose, onSave }) {
  const {quoteStamp}=useDisplayTime();
  const [scenario, setScenario] = useState(setup?.direction==='bullish'?'continuation':'rejection');
  const [strategy, setStrategy] = useState('');
  const [expiration, setExpiration] = useState('');
  const [budget, setBudget] = useState('');
  const [thesis, setThesis] = useState('');
  const zone = context.zone || context.supply || context.demand;
  const scenarioTitle = scenario==='rejection'?'Bearish break & retest':'Bullish break & retest';
  function submit(event){
    event.preventDefault();
    onSave({ symbol, marketKey, scenario, scenarioTitle, strategy, expiration, budget,
      setupSnapshot:{zone:{type:zone.type,low:zone.low,high:zone.high},timeframe:setup.timeframe||null,stage:setup.stage,direction:setup.direction||null},
      thesis: thesis || `Wait for a ${setup?.timeframe||'2m'} close ${scenario==='rejection'?'below':'above'} ${formatPrice(scenario==='rejection'?zone.low:zone.high)}, then a later candle touching the zone and closing back on that side. Require ${scenario==='rejection'?'bearish':'bullish'} EMA 9/21 and VWAP alignment. Invalidation reference: ${formatPrice(scenario==='rejection'?zone.high:zone.low)}.` });
  }
  return <Modal title="Save a plan" className="edit-dialog plan-edit-dialog" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="edit-fields">
        <dl className="plan-observation">
          <div><dt>Listing</dt><dd>{symbol}</dd><small>{marketKey?.includes(':')?marketKey:quote.name}</small></div>
          <div><dt>Quote at observation</dt><dd>{formatPrice(quote.price)} <span className={quoteTone(quote)}>{quoteChange(quote)}</span></dd><small>Yahoo · {quoteStamp(quote)}</small></div>
        </dl>
        <label className="edit-field">Setup<select aria-label="Setup" value={scenario} onChange={event=>setScenario(event.target.value)}>
          <option value="rejection">Bearish break &amp; retest</option><option value="continuation">Bullish break &amp; retest</option></select></label>
        <div className="plan-zone"><strong>Decision zone</strong> {zoneText(zone)} <span>· {setup.timeframe||'2m'}</span>
          <p>{scenario==='rejection'?'Break below and retest '+formatPrice(zone.low)+'. Invalidation above '+formatPrice(zone.high)+'.':'Hold and retest above '+formatPrice(zone.high)+'. Invalidation below '+formatPrice(zone.low)+'.'}</p></div>
        <div className="edit-pair"><label className="edit-field">Option structure<select required value={strategy} onChange={event=>setStrategy(event.target.value)}>
          <option value="">Choose your structure</option><option>Long call</option><option>Long put</option><option>Call debit spread</option><option>Put debit spread</option></select></label>
          <label className="edit-field">Planned expiration<input type="date" required min={marketDay(Date.now())} value={expiration} onChange={event=>setExpiration(event.target.value)}/></label></div>
        <p className="edit-help">Proposed expiration. Listed contracts, bid/ask, IV and Greeks are unverified.</p>
        <label className="edit-field">Premium loss budget · optional ($)<input type="number" min="1" step="0.01" placeholder="Planned maximum" value={budget} onChange={event=>setBudget(event.target.value)}/></label>
        <label className="edit-field">Your thesis<textarea rows={2} maxLength={10000} placeholder="What must happen, and what would change your mind?" value={thesis} onChange={event=>setThesis(event.target.value)}/></label>
        <p className="edit-info"><Info size={17}/>Saving a draft does not place a trade.</p>
      </div>
      <div className="edit-footer"><button type="button" className="button outline" onClick={onClose}>Cancel</button><button className="button primary" type="submit">Save plan</button></div>
    </form>
  </Modal>;
}
