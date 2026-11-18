import {PortfolioPrivacyControls} from './PortfolioPrivacy';
import PortfolioMonthlyReport from './PortfolioMonthlyReport';
import PortfolioPriceAlerts from './PortfolioPriceAlerts';
import PortfolioExposure from './PortfolioExposure';
import {PageHeader,useSectionNavigation} from './PageHeader';
import './portfolio-insights.css';
import PortfolioPlanning,{AnnualReport} from './PortfolioPlanning';

export default function PortfolioInsights({watchlist,tab='exposure',onTab,onPortfolios,onJournal}){
  const exposure=tab==='exposure';
  const planning=['monitor','allocation','performance','calendar'].includes(tab);
  const tabNav=useSectionNavigation(tab);
  const tabs=<nav ref={tabNav} className="pi-tabs" aria-label="Portfolio insight sections">{[['exposure','Combined exposure'],['monitor','Monitor'],['allocation','Target allocations'],['performance','Performance'],['calendar','Holdings calendar'],['alerts','Price alerts'],['reports','Monthly reports'],['annual','Annual export']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>onTab(id)}>{label}</button>)}</nav>;
  if(tab==='alerts')return <div className="pi-page compact-planning-page"><PortfolioPriceAlerts navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  if(tab==='reports')return <div className="pi-page compact-planning-page"><PortfolioMonthlyReport navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  const navigation=planning?tabs:<><PageHeader title={exposure?'Portfolio Manager':'Portfolio insights'}
    description={exposure?undefined:'Account monitoring, allocation plans, performance and reports.'}
    actions={!exposure&&<><button className="button outline" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button className="button outline" onClick={onPortfolios}>Portfolios</button>}</>}/>
    {!exposure&&<PortfolioPrivacyControls/>}{tabs}</>;
  return <div className={'pi-page'+(exposure?' pi-exposure-page':planning?' compact-planning-page':'')}>
    {planning?<PortfolioPlanning tab={tab} navigation={navigation} onJournal={onJournal}/>:<>{navigation}
      {tab==='annual'?<AnnualReport/>:<PortfolioExposure watchlist={watchlist} onJournal={onJournal} onPortfolios={onPortfolios}/>}</>}
  </div>;
}
