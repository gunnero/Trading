export function earningsComparison(row){
 const available=Number.isFinite(row.actual)&&Number.isFinite(row.estimate);
 const difference=available?row.actual-row.estimate:null;
 const supplied=Number.isFinite(row.surprisePercent);
 const percent=supplied?row.surprisePercent:available&&row.estimate!==0?difference/Math.abs(row.estimate)*100:null;
 return {difference,percent,derived:!supplied&&percent!==null,result:!Number.isFinite(row.actual)?'Pending':!available?'Reported':difference>0?'Beat':difference<0?'Miss':'Met',tone:!available?'muted':difference>0?'green':difference<0?'red':'muted'};
}
