(async () => {
  const path = require('path');
  const fs = require('fs');

  const profilePath = path.resolve(__dirname, '..', 'client', 'src', 'utils', 'AccountPlanProfile.js');
  if (!fs.existsSync(profilePath)) {
    console.error('AccountPlanProfile.js not found at', profilePath);
    process.exit(2);
  }

  // Dynamic import using file:// URL (works on modern Node)
  const mod = await import('file://' + profilePath.replace(/\\/g, '/'));
  const AccountPlanProfile = mod.AccountPlanProfile;

  const fixturesDir = path.join(__dirname, 'fixtures');
  const fixtures = ['asfi.json', 'puct.json', 'flat.json'];

  for (const f of fixtures) {
    const filePath = path.join(fixturesDir, f);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`\n=== Running fixture ${f} (${content.length} codes) ===`);

    // Build a minimal accounts array for analysis
    const accounts = content.map((c, i) => ({ id: i + 1, code: c.code, name: `Account ${c.code}` }));
    const analysis = AccountPlanProfile.analyze(accounts);
    const config = AccountPlanProfile.toConfigFromAnalysis ? AccountPlanProfile.toConfigFromAnalysis(analysis) : analysis;

    content.forEach(item => {
      const level = AccountPlanProfile.calculateLevel(item.code, config);
      const pass = level === item.expectedLevel;
      console.log(`${item.code} -> detected: ${level} expected: ${item.expectedLevel} ${pass ? 'OK' : 'FAIL'}`);
    });
  }

  console.log('\nTest run completed. To refine expectations, update fixtures in web-app/scripts/fixtures.');
})();
