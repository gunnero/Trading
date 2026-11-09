// nlbcli 0.1.5 compares the entire bold heading to the account ID. NLB can
// include a label there. Require one complete, exact account ID in both the
// heading and its first bold field; never use a substring or currency-less match.
export function accountHeadingMatches(heading, bold, expected) {
 const pattern=/\b\d{3}-\d{10}-\d{2}[A-Z]{2,3}\b/g;
 const whole=/^\d{3}-\d{10}-\d{2}[A-Z]{2,3}$/;
 if(typeof expected!=='string'||!whole.test(expected))return false;
 const ids=String(heading).match(pattern)||[],boldIds=String(bold).match(pattern)||[];
 return ids.length===1&&boldIds.length===1&&ids[0]===expected&&boldIds[0]===expected;
}
export function patchAccountHeading(source) {
 const original='if (accountTitle.length > 0 && returnedAccount !== expectedAccountId) throw bankResponseError(';
 if(source.split(original).length!==2)throw Error('Unsupported NLB connector account validation.');
 return source.replace(original,`if (accountTitle.length !== 1 || !(${accountHeadingMatches.toString()})(accountTitle.text(), returnedAccount, expectedAccountId)) throw bankResponseError(`);
}
