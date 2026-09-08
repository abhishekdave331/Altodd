import { GUEST_SEARCH_URL, DATE_POSTED_MAP, EXPERIENCE_LEVEL_MAP, JOB_TYPE_MAP, REMOTE_FILTER_MAP } from './constants.js';

export function buildSearchUrl(input, start) {
    const params = new URLSearchParams();
    params.set('keywords', input.keywords ?? '');
    if (input.location) params.set('location', input.location);
    params.set('start', String(start));

    const datePosted = DATE_POSTED_MAP[input.datePosted];
    if (datePosted) params.set('f_TPR', datePosted);

    const experience = (input.experienceLevels ?? [])
        .map((level) => EXPERIENCE_LEVEL_MAP[level])
        .filter(Boolean);
    if (experience.length) params.set('f_E', experience.join(','));

    const jobTypes = (input.jobTypes ?? [])
        .map((type) => JOB_TYPE_MAP[type])
        .filter(Boolean);
    if (jobTypes.length) params.set('f_JT', jobTypes.join(','));

    const remote = (input.remoteFilter ?? [])
        .map((mode) => REMOTE_FILTER_MAP[mode])
        .filter(Boolean);
    if (remote.length) params.set('f_WT', remote.join(','));

    return `${GUEST_SEARCH_URL}?${params.toString()}`;
}
