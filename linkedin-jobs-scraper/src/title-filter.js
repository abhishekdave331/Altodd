function escapeRegExp(term) {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesTitleFilter(title, terms) {
    if (!terms || terms.length === 0) return true;
    if (!title) return false;
    return terms.some((term) => {
        if (!term) return false;
        const pattern = new RegExp(`\\b${escapeRegExp(term.trim())}\\b`, 'i');
        return pattern.test(title);
    });
}
