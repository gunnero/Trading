const aliases={briefing:'markets/calendar',earnings:'markets/earnings',news:'markets/news',insights:'portfolio/insights',activity:'portfolio/activity',review:'journal/review',transfers:'settings/transfers',watchlist:'settings/watchlist'};
const roots=new Set(['overview','levels','markets','portfolio','journal','sentiment','settings']);

export function canonicalRoute(value=''){
  const route=value.replace(/^#/,''),root=route.split(/[/?]/)[0];
  if(aliases[root])return aliases[root]+route.slice(root.length);
  if(!roots.has(root))return 'overview';
  if(route==='markets')return 'markets/calendar';
  return route;
}
export function routeView(route){
  const [root,tab]=canonicalRoute(route).split('/');
  if(root==='markets')return ({calendar:'briefing',earnings:'earnings',news:'news'})[tab]||'briefing';
  if(root==='portfolio'&&['insights','activity'].includes(tab))return tab;
  return root;
}
export function routeGroup(route){const root=canonicalRoute(route).split('/')[0];return root==='levels'?'overview':root;}
export const marketTabs=[{id:'briefing',title:'Economic Calendar',route:'markets/calendar'},{id:'earnings',title:'Earnings',route:'markets/earnings'},{id:'news',title:'News',route:'markets/news'}];
export const portfolioTabs=[{id:'portfolio',title:'Accounts',route:'portfolio'},{id:'insights',title:'Insights',route:'portfolio/insights'},{id:'activity',title:'Activity & alerts',route:'portfolio/activity'}];
