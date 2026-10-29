import {Notebook,CaretRight} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {formatDate,formatPrice} from './data/market';

export default function SavedPlans({workspace,onNewPlan}){
  const {quoteStamp}=useDisplayTime(),plans=workspace.data.plans;
  const edit=(id,notes)=>workspace.update(current=>({...current,plans:current.plans.map(plan=>plan.id===id?{...plan,notes}:plan)}));
  return <section className="panel journal-plans" aria-label="Saved trade plans"><div className="section-heading"><div><h3>Saved plans</h3><p>Your thesis, invalidation and notes before you trade.</p></div><button className="button outline" onClick={onNewPlan}>Plan from Overview<CaretRight size={16}/></button></div>
    {!plans.length?<div className="journal-empty"><Notebook size={30}/><p>Start with a setup on Overview, then save its trade plan here.</p><button className="button primary" onClick={onNewPlan}>Review a setup<CaretRight size={16}/></button></div>:<div className="plan-list">{plans.map(plan=><article className="saved-plan" key={plan.id}><header><div><span className="eyebrow">{plan.symbol} · {plan.priceMode==='sample'?'SAMPLE SESSION':`YAHOO · ${plan.sessionDate}`}</span><h3>{plan.scenarioTitle}</h3></div><span className="status amber">Draft plan</span></header><div className="plan-facts"><span>Structure<strong>{plan.strategy}</strong></span><span>Expiration<strong>{formatDate(plan.expiration)}</strong></span><span>Premium loss budget<strong>{plan.budget?`$${Number(plan.budget).toFixed(2)}`:'Not set'}</strong></span></div><p>{plan.thesis}</p>{plan.marketQuote&&<p className="small-copy muted">Reference quote {formatPrice(plan.marketQuote.price)} · {quoteStamp(plan.marketQuote)}</p>}<label>Plan notes<textarea aria-label={`${plan.symbol} plan notes`} rows={3} maxLength={10000} value={plan.notes} placeholder="What confirmed or changed your view?" onChange={e=>edit(plan.id,e.target.value)}/></label><small>Draft only · no trade or performance recorded. Notes save automatically.</small></article>)}</div>}
  </section>;
}
