'use strict';
/**
 * Tests for scripts/ci/validate-openspec-syntax.js
 *
 * Uses Node.js native test runner (node:test + assert).
 * Fixtures live under tests/fixtures/openspec/specs/.
 * The validator expects <root>/openspec/ directory structure.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-openspec-syntax.js');
const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');

function runValidator(openspecRoot) {
  try {
    const result = execSync(
      `node "${SCRIPT}" --openspec-root "${openspecRoot}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return {
      exitCode: 0,
      stdout: (result.stdout || result).trim(),
      stderr: (result.stderr || '').trim(),
    };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
    };
  }
}

/** Create a temp project root with openspec/specs/ containing given files */
function makeTempProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-'));
  const specsDir = path.join(root, 'openspec', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(specsDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return root;
}

describe('validate-openspec-syntax', () => {
  describe('empty directory', () => {
    it('should return valid for missing openspec directory', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-missing-'));
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
        assert.deepStrictEqual(parsed.errors, []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should return valid for empty openspec directory', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-empty-'));
      try {
        fs.mkdirSync(path.join(root, 'openspec'));
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
        assert.deepStrictEqual(parsed.errors, []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('valid specs', () => {
    it('should pass for a valid spec with Requirement and Scenario', () => {
      // Test against the actual fixture — the fresh spec should pass
      const result = runValidator(FIXTURES_ROOT);
      const parsed = JSON.parse(result.stdout.split('\n').pop());
      const freshErrors = parsed.errors.filter(e => e.includes('fresh/'));
      assert.strictEqual(freshErrors.length, 0, 'fresh spec should have no errors');
    });
  });

  describe('malformed specs', () => {
    it('should detect invalid metadata keys', () => {
      const root = makeTempProject({
        'broken/spec.md':
          '---\ntitle: Broken\n---\n\n' +
          '<!-- id: broken-spec -->\n' +
          '<!-- invalid-key!!!: bad value -->\n\n' +
          '### Requirement: Some Req\n\n' +
          '#### Scenario: Some scenario\n\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);

        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        const hasMetaError = parsed.errors.some(e => e.includes('Invalid metadata key'));
        assert.ok(hasMetaError, 'should flag invalid metadata key');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should detect missing Scenario in Requirement', () => {
      const root = makeTempProject({
        'noscanario/spec.md':
          '---\ntitle: No Scenario\n---\n\n' +
          '<!-- id: noscanario -->\n' +
          '<!-- status: draft -->\n\n' +
          '### Requirement: Missing Scenario Req\n\n' +
          'This requirement has no scenario.\n',
      });
      try {
        const result = runValidator(root);
        const parsed = JSON.parse(result.stdout.split('\n').pop());

        const hasScenarioError = parsed.errors.some(e => e.includes('has no Scenario'));
        assert.ok(hasScenarioError, 'should flag missing Scenario');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('delta files', () => {
    it('should accept valid delta files with ADDED/MODIFIED/REMOVED blocks', () => {
      const root = makeTempProject({
        'deltas/valid.md':
          '---\ntitle: Valid Delta\n---\n\n' +
          '<!-- ADDED: -->\nAdded feature X with full test coverage.\n\n' +
          '<!-- MODIFIED: -->\nUpdated error handler in module Y.\n\n' +
          '<!-- REMOVED: -->\nRemoved deprecated legacy path.\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should reject empty delta files', () => {
      const root = makeTempProject({
        'deltas/empty.md': '',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        const hasEmptyError = parsed.errors.some(e => e.includes('Empty'));
        assert.ok(hasEmptyError, 'should flag empty spec/delta file');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should reject delta files with markers but no content', () => {
      const root = makeTempProject({
        'deltas/no-content.md':
          '---\ntitle: Empty Delta\n---\n\n' +
          '<!-- ADDED: -->\n\n' +
          '<!-- MODIFIED: -->\n\n' +
          '<!-- REMOVED: -->\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        const hasEmptyError = parsed.errors.some(e => e.includes('Empty delta'));
        assert.ok(hasEmptyError, 'should flag empty delta file');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('output format', () => {
    it('should output valid JSON to stdout', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-fmt-'));
      try {
        fs.mkdirSync(path.join(root, 'openspec'));
        const result = runValidator(root);

        const lastLine = result.stdout.split('\n').pop();
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(lastLine); });
        assert.ok('valid' in parsed);
        assert.ok(Array.isArray(parsed.errors));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should send diagnostics to stderr only', () => {
      const root = makeTempProject({
        'bad.md': '',
      });
      try {
        const result = runValidator(root);

        // stderr should have diagnostic messages
        assert.ok(result.stderr.length > 0, 'stderr should contain diagnostics');

        // stdout should only contain JSON
        const stdoutLines = result.stdout.split('\n');
        for (const line of stdoutLines) {
          if (line.trim().length === 0) continue;
          assert.doesNotThrow(() => JSON.parse(line), 'stdout should only contain JSON lines');
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('invariant validation', () => {
    it('should reject Invariant without enforced anchor', () => {
      const root = makeTempProject({
        'inv-broken/spec.md':
          '---\ntitle: Invariant Test\n---\n\n' +
          '### Invariant: Broken Invariant\nThe system must enforce this.\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);

        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        const hasInvariantError = parsed.errors.some(
          e => e.includes('missing') && e.includes('enforced')
        );
        assert.ok(hasInvariantError, 'should flag missing enforced anchor');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should accept Invariant with valid enforced anchor', () => {
      const root = makeTempProject({
        'inv-ok/spec.md':
          '---\ntitle: Invariant OK\n---\n\n' +
          '### Invariant: Good Invariant\nThe system must enforce this.\n\n' +
          '<!-- enforced: src/lib.js::check -->\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);

        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('should reject Invariant with malformed enforced anchor', () => {
      const root = makeTempProject({
        'inv-bad/spec.md':
          '---\ntitle: Bad Anchor\n---\n\n' +
          '### Invariant: Bad Anchor\nThe system must enforce this.\n\n' +
          '<!-- enforced: not a valid anchor -->\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);

        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        const hasFormatError = parsed.errors.some(
          e => e.includes('Invalid enforced anchor format')
        );
        assert.ok(hasFormatError, 'should flag invalid anchor format');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('error exit codes', () => {
    it('should exit 2 for non-existent directory', () => {
      const result = runValidator('/tmp/nonexistent-openspec-root-' + Date.now());
      assert.strictEqual(result.exitCode, 2);
    });
  });

  describe('env var fallback', () => {
    it('should use ECC_OPENSPEC_ROOT env var when no --openspec-root flag', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-env-'));
      try {
        fs.mkdirSync(path.join(root, 'openspec'));
        const result = execSync(
          `node "${SCRIPT}"`,
          {
            encoding: 'utf8',
            cwd: root,
            env: { ...process.env, ECC_OPENSPEC_ROOT: root },
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
        const parsed = JSON.parse(result.stdout ? result.stdout.trim().split('\n').pop() : result.trim().split('\n').pop());
        assert.strictEqual(parsed.valid, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
