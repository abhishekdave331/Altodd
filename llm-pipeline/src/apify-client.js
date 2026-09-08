export async function fetchLatestJobs({ token, actorId }) {
    const url = `https://api.apify.com/v2/acts/${actorId}/runs/last/dataset/items`
        + `?token=${token}&status=SUCCEEDED`;

    const response = await fetch(url);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to fetch dataset from Apify (${response.status}): ${body}`);
    }

    return response.json();
}

// Task 7.4: fetches items from an EXPLICIT dataset, rather than "the actor's
// last run" (fetchLatestJobs above). Needed because personalized
// orchestration (scraper-orchestration) can trigger multiple runs - primary
// and secondary query runs - in one cycle; "last run" can only ever surface
// one of them. scraper_runs (scraper-orchestration's own table) is the
// source of truth for which dataset IDs succeeded in a given cycle.
export async function fetchDatasetItems({ token, datasetId }) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;

    const response = await fetch(url);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to fetch dataset ${datasetId} from Apify (${response.status}): ${body}`);
    }

    return response.json();
}
