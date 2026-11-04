import {createContext,useContext,useLayoutEffect,useRef} from 'react';
import {List} from '@phosphor-icons/react';
import './page-header.css';

export const PageNavigation=createContext(null);

export function useSectionNavigation(selected){
  const ref=useRef(null);
  useLayoutEffect(()=>{
    const nav=ref.current;if(!nav)return;
    const reveal=()=>{const tab=nav.querySelector('[aria-current="page"]');if(!tab)return;const row=nav.getBoundingClientRect(),item=tab.getBoundingClientRect();if(item.left<row.left)nav.scrollLeft-=row.left-item.left;else if(item.right>row.right)nav.scrollLeft+=item.right-row.right;};
    reveal();const observer=new ResizeObserver(reveal);observer.observe(nav);return()=>observer.disconnect();
  },[selected]);
  return ref;
}

export function PageHeader({title,description,actions,id}){
  const navigation=useContext(PageNavigation);
  const tabs=useSectionNavigation(navigation?.selected);
  return <><header className="page-header">
    <div className="page-header-copy"><div className="page-header-title">
      {navigation&&<button className="icon-button page-header-menu" aria-label="Open navigation" aria-expanded={navigation.expanded} aria-controls="desk-navigation" onClick={navigation.open}><List size={23}/></button>}
      <h1 id={id}>{title}</h1>
    </div>{description&&<p className="page-header-description">{description}</p>}</div>
    {actions&&<div className="page-header-actions">{actions}</div>}
  </header>{navigation?.sections&&<nav ref={tabs} className="section-tabs" aria-label={navigation.sectionsLabel}>{navigation.sections.map(({id,title,route})=><button key={id} type="button" aria-label={title} aria-current={navigation.selected===id?'page':undefined} onClick={()=>navigation.navigate(route)}>{title}{id==='activity'&&navigation.unread>0&&<span className="pa-badge" aria-label={`${navigation.unread} unread alerts`}>{navigation.unread>99?'99+':navigation.unread}</span>}</button>)}</nav>}</>;
}
