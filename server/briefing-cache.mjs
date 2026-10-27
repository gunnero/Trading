import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFeedService } from './feeds.mjs';
const directory=fileURLToPath(new URL('../.cache/',import.meta.url));
const filename=`${directory}briefing-feeds.json`;
export function cachedFeedService({sentimentApi}={}) {
  let cache;try{cache=new Map(JSON.parse(readFileSync(filename,'utf8')).filter(([,v])=>v?.result?.status&&Number.isFinite(v.retryAt)));}catch{cache=new Map();}
  return createFeedService({cache,sentimentApi,onCache(map){try{mkdirSync(directory,{recursive:true});const temp=`${filename}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify([...map]));renameSync(temp,filename);}catch{/* Optional public-source disk cache. */}}});
}
