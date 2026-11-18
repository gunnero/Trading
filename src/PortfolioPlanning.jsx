import {useState} from 'react';
import {usePortfolioPrivacy} from './PortfolioPrivacy';
import PortfolioHoldingsCalendar from './PortfolioHoldingsCalendar';
import PortfolioAllocation from './PortfolioAllocation';
import PortfolioPerformance from './PortfolioPerformance';
import PortfolioMonitor from './PortfolioMonitor';
import {usePortfolioResource} from './PortfolioTools';

export default function PortfolioPlanning({tab,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),view=usePortfolioResource('insights/planning'),[selected,setSelected]=useState(privacy.account||'');
  const accounts=view.data?.accounts||[],a=accounts.find(a=>a.id===selected)||accounts[0];
  if(tab==='monitor')return <PortfolioMonitor accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  if(tab==='allocation')return <PortfolioAllocation accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  if(tab==='performance')return <PortfolioPerformance accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  return <PortfolioHoldingsCalendar accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
}
