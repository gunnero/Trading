import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {accountHeadingMatches as matches,patchAccountHeading} from '../server/nlb-account-heading.mjs';
const id='123-0000000001-01MKD',other='123-0000000002-01MKD';
test('accepts exact identity with heading labels',()=>{
 for(const value of [id,`Account ${id}`,`Transactions: ${id} MKD`])assert.equal(matches(value,value,id),true);
});
test('rejects wrong, ambiguous, missing and partial account identities',()=>{
 for(const [heading,bold] of [[other,other],[id+' '+other,id],[id+' '+id,id],[id,other],[id,''],['',''],['9'+id,'9'+id],[id+'X',id+'X'],[id.replace('MKD','USD'),id.replace('MKD','USD')]])assert.equal(matches(heading,bold,id),false);
});
test('patch requires the pinned guard and executes actual connector validation',()=>{
 const require=createRequire(import.meta.url),cli=join(dirname(require.resolve('nlbcli/package.json')),'dist/index.mjs');
 const source=patchAccountHeading(readFileSync(cli,'utf8'));
 const fn=source.slice(source.indexOf('function validateAccountTitle('),source.indexOf('async function downloadReport('));
 const validate=new Function('bankResponseError',fn+';return validateAccountTitle;')(message=>Error(message));
 const {load}=createRequire(cli)('cheerio');
 validate(load(`<div class="widget-title"><strong>Account ${id} MKD</strong></div>`),id);
 for(const html of ['',`<div class="widget-title"><strong>${other}</strong> ${id}</div>`,`<div class="widget-title"><strong>${id} ${other}</strong></div>`])assert.throws(()=>validate(load(html),id));
 assert.throws(()=>patchAccountHeading('changed upstream source'));
 const output=execFileSync(process.execPath,['--import',new URL('../server/nlb-loader.mjs',import.meta.url).pathname,cli,'--help'],{encoding:'utf8'});
 assert.match(output,/nlbcli/);
});
