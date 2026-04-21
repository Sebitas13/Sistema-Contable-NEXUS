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

const getPreference = () => {
    const raw = String(process.env.AI_ENGINE_PREFER || '').trim().toLowerCase();
    if (raw === 'local' || raw === 'remote' || raw === 'hybrid') return raw;
    return 'hybrid';
};

const scoreCandidate = (candidateUrl, prefer) => {
    const normalized = normalizeServiceBaseUrl(candidateUrl);
    if (!normalized) return 0;

    const isHttps = normalized.startsWith('https://');
    const isLocalhost =
        normalized.startsWith('http://localhost') ||
        normalized.startsWith('http://127.0.0.1') ||
        normalized.includes('host.docker.internal');

    // Base score: keep insertion order as a tie-breaker.
    let score = 0;
    if (prefer === 'remote') {
        if (isHttps) score += 200;
        if (isLocalhost) score -= 50;
    } else if (prefer === 'local') {
        if (isLocalhost) score += 200;
        if (isHttps) score -= 50;
    } else {
        // hybrid: prefer https first, but keep locals as secondary.
        if (isHttps) score += 120;
        if (isLocalhost) score += 40;
    }

    return score;
};

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
    const prefer = getPreference();
    const rawCandidates = [
        ...explicitUrls,
        process.env.AI_ENGINE_INTERNAL_URL || '',
        process.env.AI_ENGINE_INTERNAL_URL_ALT || '',
        process.env.AI_ENGINE_URL || '',
        process.env.AI_ENGINE_URL_ALT || '',
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

    // Ordenar por preferencia (remote/local/hybrid) para evitar que un localhost caído
    // opaque al motor remoto (o viceversa), sin perder fallback.
    const orderedCandidates = rawCandidates
        .map((value, index) => ({ value, index }))
        .sort((a, b) => {
            const scoreA = scoreCandidate(a.value, prefer);
            const scoreB = scoreCandidate(b.value, prefer);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return a.index - b.index;
        })
        .map((item) => item.value);

    for (const rawCandidate of orderedCandidates) {
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
