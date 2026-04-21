const assert = require('assert');
const {
    buildAiEngineUrlCandidates,
    normalizeServiceBaseUrl
} = require('./utils/aiEngineResolver');

const testSelfReferentialUrlIsExcluded = () => {
    const result = buildAiEngineUrlCandidates({
        isDevelopment: false,
        explicitUrls: [
            'https://sistema-contable-nexus.onrender.com',
            'https://ai-engine.example.com'
        ],
        requestBaseUrl: 'https://sistema-contable-nexus.onrender.com',
        runtimeBaseUrl: 'https://sistema-contable-nexus.onrender.com'
    });

    assert(result.diagnostics.excluded_self_references.includes('https://sistema-contable-nexus.onrender.com'));
    assert.strictEqual(result.candidates[0], 'https://ai-engine.example.com');
};

const testProdFallbackPortsStayAvailable = () => {
    const result = buildAiEngineUrlCandidates({
        isDevelopment: false,
        explicitUrls: [],
        requestBaseUrl: 'https://sistema-contable-nexus.onrender.com',
        runtimeBaseUrl: 'https://sistema-contable-nexus.onrender.com'
    });

    assert(result.candidates.includes('http://localhost:8003'));
    assert(result.candidates.includes('http://localhost:8000'));
};

const testNormalizeServiceBaseUrlStripsApiSuffix = () => {
    assert.strictEqual(
        normalizeServiceBaseUrl('https://example.com/api/'),
        'https://example.com'
    );
    assert.strictEqual(
        normalizeServiceBaseUrl('https://example.com/python/'),
        'https://example.com/python'
    );
};

const run = () => {
    testSelfReferentialUrlIsExcluded();
    testProdFallbackPortsStayAvailable();
    testNormalizeServiceBaseUrlStripsApiSuffix();
    console.log('test_ai_engine_resolver: ok');
};

run();
