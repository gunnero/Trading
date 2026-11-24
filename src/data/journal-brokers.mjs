export function journalBroker(trade){
  const name=trade.firm.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(['ibkr','interactivebrokers'].includes(name))return 'ibkr';
  if(['trading212','t212'].includes(name))return 'broker';
  if(name.startsWith('vanquish'))return 'trades';
  return 'other';
}
export function brokerWorkspace(workspace,broker){
  const subset=data=>({...data,journal:{version:1,trades:(data.journal?.trades||[]).filter(t=>journalBroker(t)===broker)}});
  return {...workspace,data:subset(workspace.data),update:change=>workspace.update(current=>{
    const next=change(subset(current));
    return {...current,journal:{version:1,trades:[...(current.journal?.trades||[]).filter(t=>journalBroker(t)!==broker),...next.journal.trades]}};
  })};
}
