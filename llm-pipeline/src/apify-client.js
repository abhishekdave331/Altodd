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
