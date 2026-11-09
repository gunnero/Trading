import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {patchAccountHeading} from './nlb-account-heading.mjs';
const require=createRequire(import.meta.url);
const target=pathToFileURL(join(dirname(require.resolve('nlbcli/package.json')),'dist/index.mjs')).href;
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);
 return url===target?{...result,source:patchAccountHeading(typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8'))}:result;
}});
