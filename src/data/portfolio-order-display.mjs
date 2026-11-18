export const money=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value):'—';
export const priceMoney=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:8}).format(value):'—';
export const shares=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
export const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
export const tone=value=>value>0?'green':value<0?'red':'';
export const sessionLabel=order=>order.extendedHours===true?'Extended sessions · 24/5 where available':order.extendedHours===false?'Regular hours only':'Session not reported by broker';
