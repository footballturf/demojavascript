#!/usr/bin/env node
/**
 * Check OpenSpec freshness by comparing enforced anchors against git history.
 *
 * For each spec file under <root>/openspec/, parses <!-- enforced: --> anchors
 * and checks if the referenced file has changed since the spec's last verification.
 *
 * Output: single JSON line to stdout {specs[], staleCount, totalCount}
 * Diagnostics: all prose/logs to stderr
 * Exit: 0 = success, 1 = stale specs found, 2 = config/input errors
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── CLI args & env ──────────────────────────────────────────────

function resolveProjectRoot() {
  const rootIdx = process.argv.indexOf('--project-root');
  if (rootIdx !== -1 && rootIdx + 1 < process.argv.length) {
    return process.argv[rootIdx + 1];
  }
  if (process.env.ECC_SPEC_PROJECT_ROOT) {
    return process.env.ECC_SPEC_PROJECT_ROOT;
  }
  return process.cwd();
}

function resolveStaleDays() {
  const envVal = process.env.ECC_SPEC_STALE_DAYS;
  if (envVal === undefined || envVal === '') {
    return 30; // Default
  }
  const days = parseInt(envVal, 10);
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    console.error(`FATAL: ECC_SPEC_STALE_DAYS must be an integer 1-365, got: "${envVal}"`);
    process.exit(2);
  }
  return days;
}

const projectRoot = resolveProjectRoot();
const staleDays = resolveStaleDays();

// ── Input validation ────────────────────────────────────────────

function die(message, exitCode) {
  console.error(`FATAL: ${message}`);
  process.exit(exitCode);
}

try {
  const stat = fs.statSync(projectRoot);
  if (!stat.isDirectory()) {
    die(`--project-root is not a directory: ${projectRoot}`, 2);
  }
} catch (err) {
  die(`Cannot access --project-root: ${projectRoot} (${err.message})`, 2);
}

const openspecDir = path.join(projectRoot, 'openspec');

// ── Regex patterns ──────────────────────────────────────────────

const ENFORCED_RE = /<!--\s*enforced:\s*(.+?)\s*-->/;
const ENFORCED_ANCHOR_RE = /^([^\s:]+)::(.+)$/;
const LAST_VERIFIED_RE = /last\s+verified:\s*(.+)$/im;

// ── Git helpers ─────────────────────────────────────────────────

let gitAvailable = null;

function isGitAvailable() {
  if (gitAvailable !== null) return gitAvailable;
  try {
    execSync('git --version', { stdio: 'ignore', cwd: projectRoot });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

function isGitRepo() {
  if (!isGitAvailable()) return false;
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore', cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file has been modified since a given date.
 * Uses `git log -1 --format=%H --before="<date>" -- <file>` to get
 * the commit hash at that date, then checks if there are later commits.
 *
 * Returns { status, enforcedFile, lastVerified, latestCommit? }
 */
function checkFileFreshness(enforcedFile, lastVerifiedDate) {
  if (!isGitAvailable() || !isGitRepo()) {
    return { status: 'UNVERIFIED', reason: 'git unavailable or not a repo' };
  }

  try {
    // Get the commit hash at/before the verification date
    const commitBefore = execSync(
      `git log -1 --format=%H --before="${lastVerifiedDate}" -- "${enforcedFile}"`,
      { encoding: 'utf8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    // Get the latest commit for this file
    const latestCommit = execSync(
      `git log -1 --format=%H -- "${enforcedFile}"`,
      { encoding: 'utf8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!latestCommit) {
      // File has never been committed
      return { status: 'UNVERIFIED', reason: 'file has no git history', latestCommit: null };
    }

    if (!commitBefore) {
      // The commit at the verification date doesn't exist (possibly orphaned)
      // Check if the file existed at all at that date
      return {
        status: 'ORPHANED',
        reason: `no commit found at/before ${lastVerifiedDate}`,
        latestCommit,
        enforcedFile,
      };
    }

    if (commitBefore === latestCommit) {
      return { status: 'FRESH', enforcedFile, lastVerified: lastVerifiedDate, latestCommit };
    }

    // Check if there are commits after the verification date
    const commitsAfter = execSync(
      `git log --format=%H --after="${lastVerifiedDate}" -- "${enforcedFile}"`,
      { encoding: 'utf8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (commitsAfter) {
      return {
        status: 'STALE',
        enforcedFile,
        lastVerified: lastVerifiedDate,
        latestCommit,
        staleCommitCount: commitsAfter.split('\n').length,
      };
    }

    return { status: 'FRESH', enforcedFile, lastVerified: lastVerifiedDate, latestCommit };
  } catch (err) {
    console.error(`WARNING: git error checking ${enforcedFile}: ${err.message}`);
    return { status: 'UNVERIFIED', reason: `git error: ${err.message}` };
  }
}

// ── Spec parsing ────────────────────────────────────────────────

function parseSpecFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { error: 'unreadable' };
  }

  const relativePath = path.relative(openspecDir, filePath);

  // Parse enforced anchors
  const enforced = [];
  const enforcedGlobalRe = new RegExp(ENFORCED_RE.source, 'g');
  let match;
  while ((match = enforcedGlobalRe.exec(content)) !== null) {
    const anchor = match[1].trim();
    const anchorMatch = anchor.match(ENFORCED_ANCHOR_RE);
    if (anchorMatch) {
      enforced.push({
        file: anchorMatch[1],
        symbol: anchorMatch[2],
        raw: anchor,
      });
    } else {
      // Invalid format - report in the spec
      enforced.push({
        file: null,
        symbol: null,
        raw: anchor,
        invalid: true,
      });
    }
  }

  // Parse last verified date
  const lvMatch = content.match(LAST_VERIFIED_RE);
  const lastVerified = lvMatch ? lvMatch[1].trim() : null;

  return { relativePath, enforced, lastVerified, error: null };
}

// ── Walk helpers ────────────────────────────────────────────────

function walkMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  let stat;
  try { stat = fs.statSync(dir); } catch { return results; }
  if (!stat.isDirectory()) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(openspecDir)) {
    console.log(JSON.stringify({ specs: [], staleCount: 0, totalCount: 0 }));
    process.exit(0);
  }

  const mdFiles = walkMdFiles(openspecDir);

  if (mdFiles.length === 0) {
    console.log(JSON.stringify({ specs: [], staleCount: 0, totalCount: 0 }));
    process.exit(0);
  }

  const specs = [];
  let staleCount = 0;

  for (const filePath of mdFiles) {
    const parsed = parseSpecFile(filePath);
    const relativePath = path.relative(openspecDir, filePath);

    if (parsed.error) {
      specs.push({
        path: relativePath,
        status: 'UNKNOWN',
      });
      console.error(`WARNING: Could not parse ${relativePath}: ${parsed.error}`);
      continue;
    }

    if (!parsed.lastVerified) {
      specs.push({
        path: relativePath,
        status: 'UNVERIFIED',
        enforced: parsed.enforced.length > 0 ? parsed.enforced.map(e => e.raw) : undefined,
      });
      console.error(`INFO: ${relativePath}: No Last verified date, marking UNVERIFIED`);
      continue;
    }

    if (parsed.enforced.length === 0) {
      specs.push({
        path: relativePath,
        status: 'FRESH',
        lastVerified: parsed.lastVerified,
      });
      console.error(`INFO: ${relativePath}: No enforced anchors, marking FRESH`);
      continue;
    }

    // Check freshness for each enforced file
    const staleRequirements = [];
    let overallStatus = 'FRESH';

    // Also check if the verification date itself is too old
    const verifiedDate = new Date(parsed.lastVerified);
    if (isNaN(verifiedDate.getTime())) {
      specs.push({
        path: relativePath,
        status: 'UNVERIFIED',
        enforced: parsed.enforced.map(e => e.raw),
        lastVerified: parsed.lastVerified,
      });
      console.error(`WARNING: ${relativePath}: Invalid Last verified date: "${parsed.lastVerified}"`);
      continue;
    }

    const ageMs = Date.now() - verifiedDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays > staleDays) {
      // The verification itself is stale
      overallStatus = 'STALE';
      staleCount++;
      staleRequirements.push({
        reason: `Last verified ${Math.round(ageDays)} days ago (threshold: ${staleDays} days)`,
      });
    }

    for (const anchor of parsed.enforced) {
      if (anchor.invalid) {
        staleRequirements.push({
          anchor: anchor.raw,
          reason: 'Invalid anchor format',
        });
        if (overallStatus === 'FRESH') overallStatus = 'UNKNOWN';
        continue;
      }

      if (!anchor.file) continue;

      // Check file existence
      const enforcedPath = path.join(projectRoot, anchor.file);
      if (!fs.existsSync(enforcedPath)) {
        staleRequirements.push({
          enforced: anchor.raw,
          reason: `File not found: ${anchor.file}`,
        });
        if (overallStatus === 'FRESH') overallStatus = 'ORPHANED';
        continue;
      }

      const freshness = checkFileFreshness(anchor.file, parsed.lastVerified);
      if (freshness.status === 'STALE') {
        staleRequirements.push({
          enforced: anchor.raw,
          reason: `File changed since verification`,
          latestCommit: freshness.latestCommit,
          staleCommitCount: freshness.staleCommitCount,
        });
        overallStatus = 'STALE';
      } else if (freshness.status === 'ORPHANED') {
        staleRequirements.push({
          enforced: anchor.raw,
          reason: freshness.reason,
        });
        if (overallStatus === 'FRESH') overallStatus = 'ORPHANED';
      } else if (freshness.status === 'UNVERIFIED') {
        staleRequirements.push({
          enforced: anchor.raw,
          reason: freshness.reason,
        });
        if (overallStatus === 'FRESH') overallStatus = 'UNVERIFIED';
      }
    }

    specs.push({
      path: relativePath,
      status: overallStatus,
      enforced: parsed.enforced.map(e => e.raw),
      lastVerified: parsed.lastVerified,
      staleRequirements: staleRequirements.length > 0 ? staleRequirements : undefined,
    });
  }

  // Recompute staleCount from specs
  staleCount = specs.filter(s => s.status === 'STALE').length;

  const result = {
    specs,
    staleCount,
    totalCount: specs.length,
  };

  // Diagnostics to stderr
  console.error(`Checked ${specs.length} spec(s): ${staleCount} stale.`);

  // Machine-readable JSON to stdout
  console.log(JSON.stringify(result));

  if (staleCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
