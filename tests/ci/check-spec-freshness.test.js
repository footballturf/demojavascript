'use strict';
/**
 * Tests for scripts/ci/check-spec-freshness.js
 *
 * Uses Node.js native test runner (node:test + assert).
 * Creates a mini git repo in the test setup for realistic freshness checks.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');

/**
 * Run the freshness checker against a project root.
 * Returns { exitCode, stdout, stderr }.
 */
function runChecker(projectRoot, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Strip inherited git env vars that could interfere
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
    delete env[key];
  }
  try {
    const result = execSync(
      `node "${SCRIPT}" --project-root "${projectRoot}"`,
      { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { exitCode: 0, stdout: result.stdout || result, stderr: result.stderr || '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

let tempRepo;
let sourceFilePath;
let _initialCommitHash;
let _laterCommitHash;
let _oldDate;

describe('check-spec-freshness', () => {
  // Create a shared git repo for tests
  before(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-spec-freshness-'));
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';

    execSync('git init', { cwd: tempRepo, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempRepo, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: tempRepo, stdio: 'ignore' });

    // Create source file and make initial commit
    fs.mkdirSync(path.join(tempRepo, 'src'), { recursive: true });
    sourceFilePath = path.join(tempRepo, 'src', 'lib.js');
    fs.writeFileSync(sourceFilePath, '// Initial version\nfunction test() { return 1; }\n');

    execSync('git add src/lib.js', { cwd: tempRepo, stdio: 'ignore' });
    execSync('git commit -m "Initial commit" --date="2024-01-01T00:00:00"', {
      cwd: tempRepo,
      env: { ...process.env, GIT_COMMITTER_DATE: '2024-01-01T00:00:00' },
      stdio: 'ignore',
    });
    _initialCommitHash = execSync('git rev-parse HEAD', {
      cwd: tempRepo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Make a later change to the source file
    fs.writeFileSync(sourceFilePath, '// Updated version\nfunction test() { return 2; }\n');
    execSync('git add src/lib.js', { cwd: tempRepo, stdio: 'ignore' });
    execSync('git commit -m "Update lib" --date="2025-06-15T00:00:00"', {
      cwd: tempRepo,
      env: { ...process.env, GIT_COMMITTER_DATE: '2025-06-15T00:00:00' },
      stdio: 'ignore',
    });
    _laterCommitHash = execSync('git rev-parse HEAD', {
      cwd: tempRepo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    _oldDate = '2024-03-01';

    // Create openspec directory structure
    fs.mkdirSync(path.join(tempRepo, 'openspec', 'specs', 'fresh'), { recursive: true });
    fs.mkdirSync(path.join(tempRepo, 'openspec', 'specs', 'stale'), { recursive: true });
    fs.mkdirSync(path.join(tempRepo, 'openspec', 'specs', 'orphaned'), { recursive: true });
    fs.mkdirSync(path.join(tempRepo, 'openspec', 'specs', 'unverified'), { recursive: true });

    // FRESH spec - recently verified (after the last change)
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    fs.writeFileSync(path.join(tempRepo, 'openspec', 'specs', 'fresh', 'spec.md'),
      `---\ntitle: Fresh Spec\n---\n\n` +
      `<!-- id: fresh-spec -->\n` +
      `<!-- status: approved -->\n\n` +
      `Last verified: ${yesterday}\n\n` +
      `### Requirement: Fresh Check\n\n` +
      `#### Scenario: Stays fresh\n\n` +
      `<!-- enforced: src/lib.js::test -->\n`
    );

    // STALE spec - verified before the later change
    fs.writeFileSync(path.join(tempRepo, 'openspec', 'specs', 'stale', 'spec.md'),
      `---\ntitle: Stale Spec\n---\n\n` +
      `<!-- id: stale-spec -->\n` +
      `<!-- status: approved -->\n\n` +
      `Last verified: 2024-03-01\n\n` +
      `### Requirement: Stale Check\n\n` +
      `#### Scenario: Goes stale\n\n` +
      `<!-- enforced: src/lib.js::test -->\n`
    );

    // ORPHANED spec - references a non-existent file (no git history)
    fs.writeFileSync(path.join(tempRepo, 'openspec', 'specs', 'orphaned', 'spec.md'),
      `---\ntitle: Orphaned Spec\n---\n\n` +
      `<!-- id: orphaned-spec -->\n` +
      `<!-- status: approved -->\n\n` +
      `Last verified: 2024-06-01\n\n` +
      `### Requirement: Orphaned Check\n\n` +
      `#### Scenario: Gets orphaned\n\n` +
      `<!-- enforced: src/nonexistent.js::ghost -->\n`
    );

    // UNVERIFIED spec - no Last verified date
    fs.writeFileSync(path.join(tempRepo, 'openspec', 'specs', 'unverified', 'spec.md'),
      `---\ntitle: Unverified Spec\n---\n\n` +
      `<!-- id: unverified-spec -->\n` +
      `<!-- status: draft -->\n\n` +
      `### Requirement: Unverified Check\n\n` +
      `#### Scenario: Remains unverified\n\n` +
      `<!-- enforced: src/lib.js::test -->\n`
    );
  });

  after(() => {
    if (tempRepo) {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  describe('basic functionality', () => {
    it('should produce valid JSON output for empty openspec dir', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-empty-spec-'));
      try {
        fs.mkdirSync(path.join(emptyDir, 'openspec'));
        const result = runChecker(emptyDir);
        assert.strictEqual(result.exitCode, 0);

        const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
        assert.deepStrictEqual(parsed.specs, []);
        assert.strictEqual(parsed.staleCount, 0);
        assert.strictEqual(parsed.totalCount, 0);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('should produce valid JSON output for missing openspec dir', () => {
      const noDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-no-spec-'));
      try {
        const result = runChecker(noDir);
        assert.strictEqual(result.exitCode, 0);

        const parsed = JSON.parse(result.stdout.trim().split('\n').pop());
        assert.deepStrictEqual(parsed.specs, []);
        assert.strictEqual(parsed.staleCount, 0);
        assert.strictEqual(parsed.totalCount, 0);
      } finally {
        fs.rmSync(noDir, { recursive: true, force: true });
      }
    });
  });

  describe('freshness states', () => {
    it('should mark FRESH spec correctly', () => {
      const result = runChecker(tempRepo);

      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());

      const freshSpec = parsed.specs.find(s => s.path.includes('fresh'));
      assert.ok(freshSpec, 'should have a fresh spec');
      assert.strictEqual(freshSpec.status, 'FRESH', `expected FRESH but got ${freshSpec.status}`);
    });

    it('should mark STALE spec when enforced file changed after verification', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '365' });

      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());

      const staleSpec = parsed.specs.find(s => s.path.includes('stale'));
      assert.ok(staleSpec, 'should have a stale spec');
      assert.strictEqual(staleSpec.status, 'STALE', `expected STALE but got ${staleSpec.status}`);
      assert.ok(staleSpec.staleRequirements, 'should have staleRequirements');
    });

    it('should mark UNVERIFIED spec when Last verified is missing', () => {
      const result = runChecker(tempRepo);

      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());

      const unverifiedSpec = parsed.specs.find(s => s.path.includes('unverified'));
      assert.ok(unverifiedSpec, 'should have an unverified spec');
      assert.strictEqual(unverifiedSpec.status, 'UNVERIFIED', `expected UNVERIFIED but got ${unverifiedSpec.status}`);
    });

    it('should output staleCount correctly', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '365' });

      const parsed = JSON.parse(result.stdout.trim().split('\n').pop());

      assert.ok(parsed.staleCount >= 1, `expected staleCount >= 1, got ${parsed.staleCount}`);
      assert.ok(parsed.totalCount >= 4, `expected totalCount >= 4, got ${parsed.totalCount}`);
    });
  });

  describe('exit codes', () => {
    it('should exit 1 when stale specs found', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '365' });
      assert.strictEqual(result.exitCode, 1, `expected exit 1 but got ${result.exitCode}`);
    });

    it('should exit 2 for invalid ECC_SPEC_STALE_DAYS', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '0' });
      assert.strictEqual(result.exitCode, 2, `expected exit 2 for zero, got ${result.exitCode}`);
    });

    it('should exit 2 for negative ECC_SPEC_STALE_DAYS', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '-5' });
      assert.strictEqual(result.exitCode, 2, `expected exit 2 for negative, got ${result.exitCode}`);
    });

    it('should exit 2 for non-integer ECC_SPEC_STALE_DAYS', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: 'abc' });
      assert.strictEqual(result.exitCode, 2, `expected exit 2 for non-integer, got ${result.exitCode}`);
    });

    it('should exit 2 for >365 ECC_SPEC_STALE_DAYS', () => {
      const result = runChecker(tempRepo, { ECC_SPEC_STALE_DAYS: '400' });
      assert.strictEqual(result.exitCode, 2, `expected exit 2 for >365, got ${result.exitCode}`);
    });

    it('should exit 2 for non-existent project root', () => {
      const result = runChecker('/tmp/nonexistent-project-root-' + Date.now());
      assert.strictEqual(result.exitCode, 2);
    });

    it('should exit 0 when no stale specs (with stale day threshold high enough)', () => {
      // With stale days = 1, the "stale" spec from 2024 won't be considered stale by date
      // Actually it will be since the verification is from 2024... but the 'fresh' spec was verified in 2025.
      // Let's use the fresh spec only:
      const freshOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fresh-only-'));
      try {
        fs.mkdirSync(path.join(freshOnlyDir, 'openspec', 'specs', 'fresh'), { recursive: true });
        fs.writeFileSync(path.join(freshOnlyDir, 'openspec', 'specs', 'fresh', 'spec.md'),
          `---\ntitle: Fresh Only\n---\n\n` +
          `<!-- id: fresh-only -->\n` +
          `<!-- status: approved -->\n\n` +
          `Last verified: 2026-08-01\n\n` +
          `### Requirement: Fresh Only\n\n` +
          `#### Scenario: Always fresh\n\n`
        );
        const result = runChecker(freshOnlyDir);
        assert.strictEqual(result.exitCode, 0);
      } finally {
        fs.rmSync(freshOnlyDir, { recursive: true, force: true });
      }
    });
  });

  describe('output format', () => {
    it('should output JSON to stdout only', () => {
      const result = runChecker(tempRepo);

      const lastLine = result.stdout.trim().split('\n').pop();
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(lastLine); });

      assert.ok(Array.isArray(parsed.specs));
      assert.ok(typeof parsed.staleCount === 'number');
      assert.ok(typeof parsed.totalCount === 'number');

      for (const spec of parsed.specs) {
        assert.ok(spec.path);
        assert.ok(spec.status);
        assert.ok(['FRESH', 'STALE', 'ORPHANED', 'UNVERIFIED', 'UNKNOWN'].includes(spec.status),
          `unexpected status: ${spec.status}`);
      }
    });

    it('should send diagnostics to stderr', () => {
      const result = runChecker(tempRepo);

      // There should be some stderr output (info/warnings)
      assert.ok(result.stderr.length > 0, 'stderr should contain diagnostics');
    });
  });

  describe('accepts --project-root flag', () => {
    it('should accept explicit --project-root parameter', () => {
      const result = runChecker(tempRepo);
      assert.ok([0, 1].includes(result.exitCode), 'should complete without config error');
    });
  });
});
