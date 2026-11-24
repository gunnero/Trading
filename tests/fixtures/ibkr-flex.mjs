export const FLEX_TOKEN='123456789012345678901234';
export const FLEX_CONFIG={token:FLEX_TOKEN,activityQueryId:'111',confirmationQueryId:'',accountId:'U1234567',timeZone:'America/New_York'};
export function execution(overrides={}){return {accountId:'U1234567',assetCategory:'OPT',currency:'USD',levelOfDetail:'EXECUTION',conid:'123456',underlyingSymbol:'QQQ',expiry:'20261127',putCall:'C',strike:'530',multiplier:'100',quantity:'3',tradePrice:'2.34',dateTime:'20261124;104615',buySell:'BUY',openCloseIndicator:'O',ibOrderID:'100',ibExecID:'001.01',ibCommission:'-1.50',ibCommissionCurrency:'USD',taxes:'0',transactionType:'ExchTrade',...overrides};}
export function report(rows=[execution()],kind='activity',overrides={}){
  const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const attrs=obj=>Object.entries(obj).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}="${esc(v)}"`).join(' ');
  const section=kind==='activity'?'Trades':'TradeConfirms',item=kind==='activity'?'Trade':'TradeConfirm';
  return `<FlexQueryResponse queryName="Fixture" type="${kind==='activity'?'AF':'TCF'}"><FlexStatements count="1"><FlexStatement ${attrs({accountId:'U1234567',fromDate:'20261101',toDate:'20261124',...overrides})}><${section}>${rows.map(r=>`<${item} ${attrs(r)}/>`).join('')}</${section}></FlexStatement></FlexStatements></FlexQueryResponse>`;
}
export const accepted='<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode><url>https://untrusted.invalid/GetStatement</url></FlexStatementResponse>';
