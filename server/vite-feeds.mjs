import { createMarketService, marketDataMiddleware } from './market-data.mjs';
import {createCompanyService,companyMiddleware} from './company-data.mjs';
import {createEarningsService,earningsMiddleware} from './earnings.mjs';
import { feedMiddleware } from './feeds.mjs';
import { cachedFeedService } from './briefing-cache.mjs';
import { openWorkspaceStore, workspaceMiddleware } from './workspace.mjs';
import {openAuthStore,authMiddleware,authConfig} from './auth.mjs';
import {createSentimentConnection} from './sentiment-connection.mjs';
import {dirname} from 'node:path';
import {journalDraftsMiddleware} from './journal-drafts.mjs';
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
    server.middlewares.use(workspaceMiddleware(store));
    server.middlewares.use(journalDraftsMiddleware(dirname(store.filename)));
    const marketKey=Symbol.for('opening-bell.market-service');
    server.middlewares.use(marketDataMiddleware(globalThis[marketKey] ||= createMarketService()));
    server.middlewares.use(companyMiddleware(globalThis[Symbol.for('opening-bell.company-service')] ||= createCompanyService()));
    server.middlewares.use(earningsMiddleware(globalThis[Symbol.for('opening-bell.earnings-service')] ||= createEarningsService({cachePath:new URL('../.cache/earnings.json',import.meta.url).pathname})));
    server.middlewares.use(feedMiddleware(service));
  }
  return {name:'opening-bell-api',configureServer:attach,configurePreviewServer:attach};
}
