import {PageHeader,useSectionNavigation} from './PageHeader';
import {WorkspaceSettings,WorkspaceSaveBadge} from './WorkspaceSettings';
import {ChartLine,PlugsConnected,ShieldCheck,HardDrives,ArrowRight,Tag,ArrowsLeftRight} from '@phosphor-icons/react';
import {AccountSettings} from './AccountSettings';
import {GlobalChartSettings,useChartSettingsStore} from './ChartSettings';
import {DataConnections} from './DataConnections';

import './settings.css';

const categories=[{id:'transfers',label:'Transfers & Costs',icon:ArrowsLeftRight},{id:'watchlist',label:'Watchlist',icon:Tag},{id:'charts',label:'Charts',icon:ChartLine},{id:'connections',label:'Connections',icon:PlugsConnected},{id:'account',label:'Account & security',icon:ShieldCheck},{id:'workspace',label:'Workspace',icon:HardDrives}];
export const settingsCategory=route=>{const id=route.split('/')[1];return categories.some(item=>item.id===id)?id:'charts';};
export function SettingsPage({briefing,connectionSettingsOpen,onConnectionSettings,category,transfersContent,watchlistContent,workspace}){
  const {settings,saveDefaults}=useChartSettingsStore();
  const navigation=useSectionNavigation(category);
  const isWorkspace=category==='workspace';
  const tabs=<nav ref={navigation} className="settings-nav" aria-label="Settings sections">
    {categories.map(({id,label,icon:Icon})=><a key={id} href={`#settings/${id}`} aria-current={category===id?'page':undefined}><Icon size={20}/><span>{label}</span><ArrowRight size={15}/></a>)}
  </nav>;
  return <div className={isWorkspace?'settings-compact-view workspace-view':'settings-compact-view'}>
    <PageHeader title={isWorkspace?'Workspace':'Settings'}
      titleAccessory={isWorkspace&&<WorkspaceSaveBadge status={workspace.status}/>}
      description={isWorkspace?'Display preferences and your saved workspace.':undefined}/>
    <div className={`settings-page${category==='watchlist'?' settings-watchlist-page':category==='connections'?' settings-connections-page':''}`}>
      <div className="settings-layout">
        {isWorkspace?<div className="workspace-navigation"><h2>Settings</h2>{tabs}</div>:tabs}
        <div className="settings-content" key={category}>
          {category==='transfers'&&transfersContent}
          {category==='watchlist'&&watchlistContent}
          {category==='charts'&&<GlobalChartSettings initial={settings.defaults} setups={settings.charts} onSave={saveDefaults} embedded/>}
          {category==='connections'&&<DataConnections briefing={briefing} settingsOpen={connectionSettingsOpen} onSettings={onConnectionSettings}/>}
          {category==='account'&&<AccountSettings workspace={workspace}/>}
          {isWorkspace&&<WorkspaceSettings workspace={workspace}/>}
        </div>
      </div>
    </div>
  </div>;
}
