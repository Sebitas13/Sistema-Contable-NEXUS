const DEFAULT_DEV_AI_ENGINE_URLS = [
    'http://localhost:8003',
    'http://127.0.0.1:8003',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://host.docker.internal:8003',
    'http://host.docker.internal:8000'
];

const DEFAULT_PROD_AI_ENGINE_URLS = [
    'http://localhost:8003',
    'http://127.0.0.1:8003',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
];

const normalizeServiceBaseUrl = (rawValue) => {
    if (!rawValue || typeof rawValue !== 'string') return '';

    let normalized = rawValue.trim();
    if (!normalized) return '';

    normalized = normalized.replace(/\/+$/, '');
    if (normalized.endsWith('/api')) {
        normalized = normalized.slice(0, -4);
    }

    return normalized;
};

const isSelfReferentialAiEngineUrl = (candidateUrl, selfBaseUrls = []) => {
    const normalizedCandidate = normalizeServiceBaseUrl(candidateUrl);
    if (!normalizedCandidate) return false;

    return selfBaseUrls.some((selfBaseUrl) => {
        const normalizedSelf = normalizeServiceBaseUrl(selfBaseUrl);
        if (!normalizedSelf) return false;
        return normalizedCandidate === normalizedSelf;
    });
};

const buildAiEngineUrlCandidates = ({
    isDevelopment = false,
    explicitUrls = [],
    requestBaseUrl = '',
    runtimeBaseUrl = '',
    extraSelfBaseUrls = []
} = {}) => {
    const rawCandidates = [
        ...explicitUrls,
        process.env.AI_ENGINE_INTERNAL_URL || '',
        process.env.AI_ENGINE_INTERNAL_URL_ALT || '',
        ...(isDevelopment ? DEFAULT_DEV_AI_ENGINE_URLS : DEFAULT_PROD_AI_ENGINE_URLS)
    ];

    const selfBaseUrls = [
        requestBaseUrl,
        runtimeBaseUrl,
        process.env.API_BASE_URL || '',
        process.env.RENDER_URL || '',
        process.env.PRODUCTION_URL || '',
        ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
        ...extraSelfBaseUrls
    ];

    const candidates = [];
    const seen = new Set();
    const diagnostics = {
        configured_urls: rawCandidates
            .map((value) => normalizeServiceBaseUrl(value))
            .filter(Boolean),
        self_base_urls: selfBaseUrls
            .map((value) => normalizeServiceBaseUrl(value))
            .filter(Boolean),
        excluded_self_references: [],
        excluded_duplicates: []
    };

    for (const rawCandidate of rawCandidates) {
        const normalizedCandidate = normalizeServiceBaseUrl(rawCandidate);
        if (!normalizedCandidate) continue;

        if (isSelfReferentialAiEngineUrl(normalizedCandidate, selfBaseUrls)) {
            diagnostics.excluded_self_references.push(normalizedCandidate);
            continue;
        }

        if (seen.has(normalizedCandidate)) {
            diagnostics.excluded_duplicates.push(normalizedCandidate);
            continue;
        }

        seen.add(normalizedCandidate);
        candidates.push(normalizedCandidate);
    }

    diagnostics.final_candidates = [...candidates];

    return { candidates, diagnostics };
};

module.exports = {
    buildAiEngineUrlCandidates,
    isSelfReferentialAiEngineUrl,
    normalizeServiceBaseUrl
};
