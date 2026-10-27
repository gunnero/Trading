export async function mockBriefing(page){
  await page.route(/\/api\/(sentiment|news|calendar|earnings)(\?|$)/,route=>{
    const url=new URL(route.request().url()),kind=url.pathname.slice(5),now='2026-10-25T12:00:00Z';
    const data=kind==='sentiment'?{score:21,rating:'extreme fear',observedAt:now,previousClose:25}:kind==='news'?{articles:[{id:'news',title:'Technology earnings and the Fed lead the week ahead',url:'https://finance.yahoo.com/',publisher:'Yahoo Finance',publishedAt:now}]}:kind==='earnings'?{events:[{id:'2026-10-27:NVDA',symbol:'NVDA',name:'NVIDIA Corporation',date:'2026-10-27',window:'after',epsForecast:'$1.20',lastYearEPS:'$0.80',status:'expected'}],missingDates:[],cachedDates:[]}:{events:[{id:'fed',title:'FOMC decision',country:'US',date:'2026-10-28T18:00:00Z',impact:'High'}],planning:true};
    return route.fulfill({json:{status:'ok',source:{name:kind==='earnings'?'Nasdaq':'Source fixture',url:'https://example.com/'},fetchedAt:now,data}});
  });
}
