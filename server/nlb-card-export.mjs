import {decimal,validDay} from '../src/data/transfers.mjs';
// nlbcli tab output preserves the bank's six-column card layout; JSON omits domestic amounts.
function date(value){const m=value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);const day=m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:value.trim();if(!validDay(day))throw Error('Invalid card date');return day;}
function money(value){const m=value.trim().replace(/−/g,'-').match(/^([+-]?[\d.,]+)\s+([A-Z]{3})$/);if(!m)throw Error('Missing card amount currency');let text=m[1].replace(/^\+/,'');
 if(/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)||/^-?\d+(?:,\d+)$/.test(text))text=text.replaceAll('.','').replace(',','.');
 else if(/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))text=text.replaceAll(',','');
 return {amount:decimal(text),currency:m[2]};}
export function parseNlbCardTable(output){
 if(!output.trim())return [];
 const lines=output.trimEnd().split(/\r?\n/);if(lines.length>5000)throw Error('Too many card rows');
 return lines.map(line=>{const cells=line.split('\t');if(cells.length!==6)throw Error('Unrecognized full card table');
 const original=money(cells[3]),domestic=money(cells[4]),balance=money(cells[5]);if(domestic.currency!=='MKD'||balance.currency!=='MKD')throw Error('Unexpected domestic currency');
 if(original.amount!=='0'&&domestic.amount!=='0'&&original.amount.startsWith('-')!==domestic.amount.startsWith('-'))throw Error('Conflicting card amount directions');
 return {date:date(cells[0]),bookingDate:date(cells[1]),description:cells[2].trim(),...original,settlementAmount:domestic.amount};});
}
