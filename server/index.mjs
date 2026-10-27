import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketDataMiddleware } from './market-data.mjs';
import {earningsMiddleware} from './earnings.mjs';
import { companyMiddleware } from './company-data.mjs';
import { feedMiddleware } from './feeds.mjs';
import { cachedFeedService } from './briefing-cache.mjs';
import { openWorkspaceStore, workspaceMiddleware } from './workspace.mjs';
import {openAuthStore,authMiddleware,authConfig} from './auth.mjs';
import {createSentimentConnection} from './sentiment-connection.mjs';
import {journalDraftsMiddleware} from './journal-drafts.mjs';
const root=fileURLToPath(new URL('../dist/client/',import.meta.url));
if(!existsSync(resolve(root,'index.html')))throw new Error('Build the app before starting it: npm run build');
const port=Number(process.env.OPENING_BELL_PORT || 4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('OPENING_BELL_PORT must be 1024–65535.');
const account=openAuthStore(),config=authConfig();
if(config.secure&&(!account.owner().password||!account.owner().totp)){account.close();throw Error('Activate the owner account and enable two-step verification locally before enabling public mode.');}
const auth=authMiddleware(account,{config});
const sentimentConnection=createSentimentConnection(account);
const store=openWorkspaceStore(),workspace=workspaceMiddleware(store),feeds=feedMiddleware(cachedFeedService({sentimentApi:sentimentConnection.get})),markets=marketDataMiddleware(),companies=companyMiddleware(),earnings=earningsMiddleware();
const journalDrafts=journalDraftsMiddleware(dirname(store.filename));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png'};
async function assets(req,res){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  let file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!file.startsWith(resolve(root)+sep)){res.writeHead(404);res.end();return;}
  let info;try{info=await stat(file);if(!info.isFile())throw new Error();}catch{
    if(extname(pathname)||!req.headers.accept?.includes('text/html')){res.writeHead(404);res.end();return;}
    file=resolve(root,'index.html');info=await stat(file);
  }
  if(!(await realpath(file)).startsWith(resolve(root)+sep)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':file.includes(`${sep}assets${sep}`)?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
}
const server=createServer(async(req,res)=>{
  try{
    await auth(req,res,()=>sentimentConnection.middleware(req,res,()=>workspace(req,res,()=>journalDrafts(req,res,()=>markets(req,res,()=>companies(req,res,()=>earnings(req,res,()=>feeds(req,res,()=>assets(req,res)))))))));
  }catch{if(!res.headersSent)res.writeHead(500);res.end('Request failed.');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,'127.0.0.1',()=>console.log(`Opening Bell: http://127.0.0.1:${port} (saved workspace enabled)`));
function close(){server.close(()=>{store.close();account.close();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGINT',close);process.on('SIGTERM',close);
