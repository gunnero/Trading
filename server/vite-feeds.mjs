import { defaultMarketService, marketDataMiddleware } from './market-data.mjs';
import {defaultCompanyService,companyMiddleware} from './company-data.mjs';
import {createEarningsService,earningsMiddleware} from './earnings.mjs';
import { feedMiddleware } from './feeds.mjs';
import { cachedFeedService } from './briefing-cache.mjs';
import { openWorkspaceStore, workspaceMiddleware } from './workspace.mjs';
import {openAuthStore,authMiddleware,authConfig} from './auth.mjs';
import {createSentimentConnection} from './sentiment-connection.mjs';
import {dirname} from 'node:path';
import {createNlbConnection} from './nlb-connection.mjs';
import {createIbkrJournal} from './ibkr-journal.mjs';
import {journalDraftsMiddleware} from './journal-drafts.mjs';
import {createPortfolioService} from './portfolio.mjs';
import {createDeskAssistant} from './desk-assistant.mjs';
export function marketFeeds() {
  function attach(server){
    if(authConfig().secure)throw Error('Use the built standalone server for public mode; Vite is local development only.');
    const account=globalThis[Symbol.for('opening-bell.auth-store')] ||= openAuthStore();
    server.middlewares.use(authMiddleware(account,{development:true}));
    const sentiment=globalThis[Symbol.for('opening-bell.sentiment-connection')] ||= createSentimentConnection(account);
    server.middlewares.use(sentiment.middleware);
    const feedKey=Symbol.for('opening-bell.feed-service');
    const storeKey=Symbol.for('opening-bell.workspace-store');
    const service=globalThis[feedKey] ||= cachedFeedService({sentimentApi:sentiment.get});
    const store=globalThis[storeKey] ||= openWorkspaceStore();
    const earnings=globalThis[Symbol.for('opening-bell.earnings-service')] ||= createEarningsService({cachePath:new URL('../.cache/earnings.json',import.meta.url).pathname});
    const market=defaultMarketService();
    server.middlewares.use(workspaceMiddleware(store));
    const nlb=globalThis[Symbol.for('opening-bell.nlb-connection')] ||= createNlbConnection(dirname(store.filename));
    server.middlewares.use(nlb.middleware);
    const portfolios=globalThis[Symbol.for('opening-bell.portfolios')] ||= createPortfolioService(account,dirname(store.filename),{background:process.env.NODE_ENV!=='test',workspace:()=>store.read().data});
    server.middlewares.use(globalThis[Symbol.for('opening-bell.desk-assistant')] ||= createDeskAssistant({workspace:()=>store.read().data,feeds:service,earnings,market,accounts:()=>portfolios.read().data.accounts,db:account.db}));
    server.middlewares.use(portfolios.middleware);
    const ibkr=globalThis[Symbol.for('opening-bell.ibkr-journal')] ||= createIbkrJournal(account,{background:process.env.NODE_ENV!=='test'});
    server.middlewares.use(ibkr.middleware);
    server.middlewares.use(journalDraftsMiddleware(dirname(store.filename)));
    server.middlewares.use(marketDataMiddleware(market));
    server.middlewares.use(companyMiddleware(defaultCompanyService()));
    server.middlewares.use(earningsMiddleware(earnings));
    server.middlewares.use(feedMiddleware(service));
  }
  return {name:'opening-bell-api',configureServer:attach,configurePreviewServer:attach};
}
