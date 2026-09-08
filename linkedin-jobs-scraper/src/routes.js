import { createCheerioRouter } from 'crawlee';
import { GUEST_DETAIL_URL, PAGE_SIZE } from './constants.js';
import { buildSearchUrl } from './search-url.js';
import { matchesTitleFilter } from './title-filter.js';

export function createRouter({ input, state, jobsCollected }) {
    const router = createCheerioRouter();

    router.addHandler('SEARCH', async ({ $, crawler, log }) => {
        const cards = $('li > div.base-card, li > div.job-search-card').toArray();

        if (cards.length === 0) {
            log.info(`No more results at offset ${state.nextStart}, stopping pagination.`);
            return;
        }

        for (const card of cards) {
            if (jobsCollected.count >= input.maxItems) break;

            const el = $(card);
            const entityUrn = el.attr('data-entity-urn') ?? '';
            const jobId = entityUrn.split(':').pop();
            if (!jobId) continue;
            if (state.seenJobIds.has(jobId)) continue;
            state.seenJobIds.add(jobId);

            const title = el.find('.base-search-card__title').first().text().trim();
            if (!matchesTitleFilter(title, input.titleKeywordFilter)) continue;

            const company = el.find('.base-search-card__subtitle').first().text().trim();
            const companyUrl = el.find('.base-search-card__subtitle a').first().attr('href')?.split('?')[0];
            const location = el.find('.job-search-card__location').first().text().trim();
            const postedAt = el.find('time').first().attr('datetime');
            const jobUrl = el.find('a.base-card__full-link').first().attr('href')?.split('?')[0]
                ?? `https://www.linkedin.com/jobs/view/${jobId}/`;

            const job = {
                jobId,
                title,
                company,
                companyUrl,
                location,
                postedAt,
                url: jobUrl,
            };

            jobsCollected.count += 1;

            if (input.fetchFullDescription) {
                await crawler.addRequests([{
                    url: `${GUEST_DETAIL_URL}/${jobId}`,
                    label: 'DETAIL',
                    userData: { job },
                }]);
            } else {
                await crawler.pushData(job);
            }
        }

        if (jobsCollected.count >= input.maxItems) {
            log.info(`Reached maxItems (${input.maxItems}), stopping pagination.`);
            return;
        }

        if (cards.length < PAGE_SIZE) {
            log.info('Fetched a partial page, assuming end of results.');
            return;
        }

        state.nextStart += PAGE_SIZE;
        await crawler.addRequests([{
            url: buildSearchUrl(input, state.nextStart),
            label: 'SEARCH',
        }]);
    });

    router.addHandler('DETAIL', async ({ $, request, crawler }) => {
        const { job } = request.userData;

        const description = $('.description__text').first().text().trim()
            || $('.show-more-less-html__markup').first().text().trim();

        const criteria = {};
        $('.description__job-criteria-item').each((_, item) => {
            const label = $(item).find('.description__job-criteria-subheader').first().text().trim();
            const value = $(item).find('.description__job-criteria-text').first().text().trim();
            if (label) criteria[label] = value;
        });

        const applicantsText = $('.num-applicants__caption').first().text().trim();

        await crawler.pushData({
            ...job,
            description,
            seniorityLevel: criteria['Seniority level'],
            employmentType: criteria['Employment type'],
            jobFunction: criteria['Job function'],
            industries: criteria['Industries'],
            applicants: applicantsText || undefined,
        });
    });

    return router;
}
