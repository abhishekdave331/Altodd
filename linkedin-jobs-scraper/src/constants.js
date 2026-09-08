export const GUEST_SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
export const GUEST_DETAIL_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
export const PAGE_SIZE = 25;

export const DATE_POSTED_MAP = {
    any: null,
    past24Hours: 'r86400',
    pastWeek: 'r604800',
    pastMonth: 'r2592000',
};

export const EXPERIENCE_LEVEL_MAP = {
    internship: '1',
    entryLevel: '2',
    associate: '3',
    midSeniorLevel: '4',
    director: '5',
    executive: '6',
};

export const JOB_TYPE_MAP = {
    fullTime: 'F',
    partTime: 'P',
    contract: 'C',
    temporary: 'T',
    volunteer: 'V',
    internship: 'I',
    other: 'O',
};

export const REMOTE_FILTER_MAP = {
    onSite: '1',
    remote: '2',
    hybrid: '3',
};

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
