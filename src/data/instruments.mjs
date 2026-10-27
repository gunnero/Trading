export const isEquityKey=key=>typeof key==='string'&&(['QQQ','SPY'].includes(key)||/^(NASDAQ|NYSE|AMEX|CBOE|NYSEARCA|NYSEAMERICAN|BATS):([A-Z][A-Z0-9.]{0,9})$/.test(key));
export const chartableEntry=entry=>!!entry&&['STOCKS','DEPOSITARY RECEIPT','FUND'].includes(entry.group)&&isEquityKey(entry.id);
export const stockEntry=entry=>chartableEntry(entry)&&entry.group!=='FUND';
export const SETUP_INTERVALS=['2m','5m','15m','30m','source'];
