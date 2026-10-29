import {createContext,useContext} from 'react';
import {List} from '@phosphor-icons/react';
import './page-header.css';

export const PageNavigation=createContext(null);

export function PageHeader({title,description,actions,id}){
  const navigation=useContext(PageNavigation);
  return <header className="page-header">
    <div className="page-header-copy"><div className="page-header-title">
      {navigation&&<button className="icon-button page-header-menu" aria-label="Open navigation" aria-expanded={navigation.expanded} aria-controls="desk-navigation" onClick={navigation.open}><List size={23}/></button>}
      <h1 id={id}>{title}</h1>
    </div>{description&&<p className="page-header-description">{description}</p>}</div>
    {actions&&<div className="page-header-actions">{actions}</div>}
  </header>;
}
