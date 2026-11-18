import PortfolioAnnualReport from './PortfolioAnnualReport';
import PortfolioMonthlyReport from './PortfolioMonthlyReport';
import PortfolioPriceAlerts from './PortfolioPriceAlerts';
import PortfolioExposure from './PortfolioExposure';
import {PageHeader,useSectionNavigation} from './PageHeader';
import './portfolio-insights.css';
import PortfolioPlanning from './PortfolioPlanning';

export default function PortfolioInsights({watchlist,tab='exposure',onTab,onPortfolios,onJournal}){
  const exposure=tab==='exposure';
  const planning=['monitor','allocation','performance','calendar'].includes(tab);
  const tabNav=useSectionNavigation(tab);
  const tabs=<nav ref={tabNav} className="pi-tabs" aria-label="Portfolio insight sections">{[['exposure','Combined exposure'],['monitor','Monitor'],['allocation','Target allocations'],['performance','Performance'],['calendar','Holdings calendar'],['alerts','Price alerts'],['reports','Monthly reports'],['annual','Annual export']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>onTab(id)}>{label}</button>)}</nav>;
  if(tab==='alerts')return <div className="pi-page compact-planning-page"><PortfolioPriceAlerts navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  if(tab==='reports')return <div className="pi-page compact-planning-page"><PortfolioMonthlyReport navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  if(tab==='annual')return <div className="pi-page compact-planning-page"><PortfolioAnnualReport navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  if(planning)return <div className="pi-page compact-planning-page"><PortfolioPlanning tab={tab} navigation={tabs} onJournal={onJournal}/></div>;
  return <div className={'pi-page'+(exposure?' pi-exposure-page':'')}>
    <PageHeader title="Portfolio Manager"/>{tabs}
    <PortfolioExposure watchlist={watchlist} onJournal={onJournal} onPortfolios={onPortfolios}/>
  </div>;
}
