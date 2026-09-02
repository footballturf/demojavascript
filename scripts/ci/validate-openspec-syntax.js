#!/usr/bin/env node
/**
 * Validate OpenSpec markdown syntax.
 *
 * Parses markdown spec files under <root>/openspec/ and checks:
 * - YAML frontmatter between --- markers
 * - ### Requirement: blocks with mandatory #### Scenario: children
 * - ### Invariant: blocks with mandatory <!-- enforced: --> anchors
 * - Metadata comments (<!-- id: -->, <!-- status: -->, etc.)
 * - Delta files (<!-- ADDED: -->, <!-- MODIFIED: -->, <!-- REMOVED: -->)
 *
 * Output: single JSON line to stdout {valid, errors[]}
 * Diagnostics: all prose/logs to stderr
 * Exit: 0 = valid, 1 = validation errors, 2 = input/config errors
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── CLI args & env ──────────────────────────────────────────────

function resolveOpenspecRoot() {
  // Check for explicit --openspec-root flag
  const rootIdx = process.argv.indexOf('--openspec-root');
  if (rootIdx !== -1 && rootIdx + 1 < process.argv.length) {
    return process.argv[rootIdx + 1];
  }

  // Fall back to env var
  if (process.env.ECC_OPENSPEC_ROOT) {
    return process.env.ECC_OPENSPEC_ROOT;
  }

  // Default to current working directory
  return process.cwd();
}

const openspecRoot = resolveOpenspecRoot();

// ── Input validation ────────────────────────────────────────────

function die(message, exitCode) {
  console.error(`FATAL: ${message}`);
  process.exit(exitCode);
}

// Validate that openspecRoot is a readable directory
try {
  const stat = fs.statSync(openspecRoot);
  if (!stat.isDirectory()) {
    die(`--openspec-root is not a directory: ${openspecRoot}`, 2);
  }
} catch (err) {
  die(`Cannot access --openspec-root: ${openspecRoot} (${err.message})`, 2);
}

const openspecDir = path.join(openspecRoot, 'openspec');

// ── Regex patterns ──────────────────────────────────────────────

const YAML_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
const SCENARIO_RE = /^####\s+Scenario:\s*(.+)$/m;
const ENFORCED_RE = /<!--\s*enforced:\s*(.+?)\s*-->/;
const ANY_COMMENT_WITH_COLON_RE = /<!--\s*(\S+?):\s*(.*?)\s*-->/g;
const METADATA_KEY_RE = /^[a-z_-]+$/;
const ENFORCED_ANCHOR_RE = /^([^\s:]+)::([^\s]+)$/; // path/to/file.ext::symbolName
const DELTA_BLOCKS = {
  ADDED: /<!--\s*ADDED:\s*-->/,
  MODIFIED: /<!--\s*MODIFIED:\s*-->/,
  REMOVED: /<!--\s*REMOVED:\s*-->/,
};

// ── Helpers ─────────────────────────────────────────────────────

function isDeltaFile(content) {
  // A file is a delta file if it contains any delta block markers
  return DELTA_BLOCKS.ADDED.test(content) ||
         DELTA_BLOCKS.MODIFIED.test(content) ||
         DELTA_BLOCKS.REMOVED.test(content);
}

function collectMetadata(content) {
  const meta = {};
  const errors = [];

  // First pass: catch ALL HTML comments with colon to find invalid keys
  const broadRe = new RegExp(ANY_COMMENT_WITH_COLON_RE.source, 'g');
  let match;
  while ((match = broadRe.exec(content)) !== null) {
    const key = match[1];
    const value = match[2];

    // Skip known non-metadata patterns (enforced, ADDED, MODIFIED, REMOVED)
    if (key === 'enforced' || key === 'ADDED' || key === 'MODIFIED' || key === 'REMOVED') {
      continue;
    }

    if (!METADATA_KEY_RE.test(key)) {
      errors.push(`Invalid metadata key: "${key}" (must match [a-z_-]+)`);
    } else {
      meta[key] = value;
    }
  }

  return { meta, errors };
}

/**
 * Walk directory recursively, collect .md files.
 */
function walkMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return results;
  }
  if (!stat.isDirectory()) {
    return results;
  }

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

/**
 * Parse a single spec file and return array of error messages.
 */
function validateSpecFile(filePath) {
  const errors = [];
  const relativePath = path.relative(openspecDir, filePath);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return [`${relativePath}: Cannot read file: ${err.message}`];
  }

  // Empty file check
  if (content.trim().length === 0) {
    return [`${relativePath}: Empty spec file`];
  }

  // Check if it's a delta file
  const isDelta = isDeltaFile(content);

  if (isDelta) {
    // Delta files must have at least one ADDED, MODIFIED, or REMOVED block with content
    let hasContent = false;
    // Check sections after each marker for non-empty content
    const markers = [];
    for (const [name, re] of Object.entries(DELTA_BLOCKS)) {
      const m = content.match(new RegExp(re.source, 'g'));
      if (m) {
        markers.push(...m.map(() => name));
      }
    }
    // A delta is "empty" only if NO delta markers at all
    if (markers.length === 0) {
      // This shouldn't happen since isDeltaFile would return false, but be safe
    }
    // But we need to check: if it has markers, look for content after each
    const parts = content.split(/<!--\s*(?:ADDED|MODIFIED|REMOVED):\s*-->/);
    // First part is before first marker, skip it
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].trim().length > 0) {
        hasContent = true;
        break;
      }
    }

    if (!hasContent) {
      errors.push(`${relativePath}: Empty delta file (no content in ADDED/MODIFIED/REMOVED blocks)`);
    }
    // Don't require Requirement/Scenario for delta files
    return errors;
  }

  // Parse YAML frontmatter
  const fmMatch = content.match(YAML_FRONTMATTER_RE);
  if (!fmMatch) {
    errors.push(`${relativePath}: Missing YAML frontmatter (must start with ---)`);
    // Can still check for Requirement/Invariant blocks even without frontmatter
  }

  // Collect metadata comments
  const metaResult = collectMetadata(content);
  if (metaResult.errors.length > 0) {
    for (const metaErr of metaResult.errors) {
      errors.push(`${relativePath}: ${metaErr}`);
    }
  }

  // Check Requirement blocks
  const reqMatches = content.match(/^###\s+Requirement:\s*(.+)$/gm);
  if (reqMatches) {
    // Split content into sections by Requirement headers to check each has a Scenario
    const sections = content.split(/^###\s+Requirement:\s*.+$/m);
    // First section is before the first Requirement, skip it
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      if (!SCENARIO_RE.test(section)) {
        // Find the requirement title
        const reqTitle = reqMatches[i - 1].replace(/^###\s+Requirement:\s*/, '');
        errors.push(`${relativePath}: Requirement "${reqTitle}" has no Scenario`);
      }
    }
  }

  // Check Invariant blocks
  const invMatches = content.match(/^###\s+Invariant:\s*(.+)$/gm);
  if (invMatches) {
    const sections = content.split(/^###\s+Invariant:\s*.+$/m);
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const invTitle = invMatches[i - 1].replace(/^###\s+Invariant:\s*/, '');
      const enforcedMatch = section.match(ENFORCED_RE);
      if (!enforcedMatch) {
        errors.push(`${relativePath}: Invariant "${invTitle}" missing <!-- enforced: --> anchor`);
      } else {
        const anchor = enforcedMatch[1];
        if (!ENFORCED_ANCHOR_RE.test(anchor)) {
          errors.push(
            `${relativePath}: Invalid enforced anchor format: "${anchor}" (expected path/to/file.ext::symbolName)`
          );
        }
      }
    }
  }

  return errors;
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(openspecDir)) {
    // Gracefully handle missing openspec directory
    console.log(JSON.stringify({ valid: true, errors: [] }));
    process.exit(0);
  }

  const mdFiles = walkMdFiles(openspecDir);

  if (mdFiles.length === 0) {
    // Empty openspec directory
    console.log(JSON.stringify({ valid: true, errors: [] }));
    process.exit(0);
  }

  const allErrors = [];
  for (const filePath of mdFiles) {
    const fileErrors = validateSpecFile(filePath);
    allErrors.push(...fileErrors);
  }

  // Emit diagnostics to stderr
  if (allErrors.length > 0) {
    console.error(`Found ${allErrors.length} validation error(s):`);
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
  } else {
    console.error(`Validated ${mdFiles.length} spec file(s): no errors found.`);
  }

  // Emit machine-readable JSON to stdout
  const result = {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
  console.log(JSON.stringify(result));

  if (allErrors.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
