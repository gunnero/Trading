import {spawn} from 'node:child_process';
import {testRuntime} from './qa-runtime.mjs';
const scripts={watchlist:'scripts/watchlist-qa.mjs','chart-settings':'scripts/chart-settings-qa.mjs',drawings:'scripts/drawing-qa.mjs',company:'scripts/company-qa.mjs',hot:'scripts/hot-stock-qa.mjs',interaction:'scripts/chart-interaction-qa.mjs',indicators:'scripts/indicators-qa.mjs',context:'scripts/context-chart-qa.mjs',market:'scripts/market-data-qa.mjs',desk:'scripts/browser-qa.mjs',briefing:'scripts/briefing-qa.mjs',clock:'scripts/market-clock-qa.mjs'};
const target=scripts[process.argv[2]];
if(!target)throw new Error('Choose desk, briefing, clock, market or context.');
const runtime=await testRuntime();
try{const child=spawn(process.execPath,[target],{env:{...process.env,OPENING_BELL_TEST_URL:runtime.url},stdio:'inherit'});const code=await new Promise(r=>child.once('exit',r));if(code!==0)process.exitCode=1;}finally{await runtime.close();}
