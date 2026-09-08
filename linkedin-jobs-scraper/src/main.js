import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { createRouter } from './routes.js';
import { buildSearchUrl } from './search-url.js';
import { USER_AGENT } from './constants.js';

await Actor.init();

const input = await Actor.getInput() ?? {};
if (!input.keywords) {
    throw new Error('Input is missing required field "keywords".');
}
input.maxItems ??= 100;
input.datePosted ??= 'any';
input.experienceLevels ??= [];
input.jobTypes ??= [];
input.remoteFilter ??= [];
input.titleKeywordFilter ??= [];
input.fetchFullDescription ??= true;

const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration ?? {
    groups: ['RESIDENTIAL'],
});

const state = {
    nextStart: 0,
    seenJobIds: new Set(),
};
const jobsCollected = { count: 0 };

const router = createRouter({ input, state, jobsCollected });

const crawler = new CheerioCrawler({
    proxyConfiguration,
    requestHandler: router,
    maxConcurrency: 3,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                ...request.headers,
                'user-agent': USER_AGENT,
                'accept-language': 'en-US,en;q=0.9',
            };
        },
    ],
    failedRequestHandler: async ({ request, log }) => {
        log.warning(`Request ${request.url} failed after all retries.`);
    },
});

await crawler.run([{
    url: buildSearchUrl(input, 0),
    label: 'SEARCH',
}]);

await Actor.exit();
