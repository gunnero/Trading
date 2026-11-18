import {useEffect,useState} from 'react';
import {activityRequest} from './PortfolioNotifications';
import {usePortfolioResource} from './PortfolioTools';

export function usePortfolioReport(params,valid=true){
  const query=new URLSearchParams(params).toString();
  const [importing,setImporting]=useState(false),[syncError,setSyncError]=useState(''),[reload,setReload]=useState(0);
  const filters=usePortfolioResource('insights/reports?view=filters');
  const view=usePortfolioResource(valid?'insights/reports?'+query:null);
  useEffect(()=>{
    let active=true,running=false;setSyncError('');setImporting(false);
    if(!valid)return;
    async function update(){
      if(document.hidden||running)return;
      running=true;setImporting(true);
      try{await activityRequest('insights/reports/refresh',Object.fromEntries(new URLSearchParams(query)));if(active){setSyncError('');await view.refresh();}}
      catch(e){if(active)setSyncError(e.message);}
      finally{running=false;if(active)setImporting(false);}
    }
    update();const timer=setInterval(update,60000);return()=>{active=false;clearInterval(timer);};
  },[query,reload,valid,view.refresh]);
  function refresh(){filters.refresh();view.refresh();setReload(i=>i+1);}
  return {view,people:filters.data?.people||view.data?.people||[],accounts:filters.data?.accounts||[],
    importing,error:view.error||syncError||filters.error,refresh};
}
