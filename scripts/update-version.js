#!/usr/bin/env node

/**
 * Version management script for GraphBus UI
 * Automatically increments version based on git commits and tags
 *
 * Versioning scheme: MAJOR.MINOR.PATCH-commitCount
 * - MAJOR: Manual increment for breaking changes
 * - MINOR: Auto-increment on feature commits
 * - PATCH: Auto-increment on fixes/regular commits
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

try {
    // Get the base version from package.json (without commit hash)
    let baseVersion = packageJson.version.split('+')[0]; // Remove commit hash if present

    // Get the last tag or use base version as fallback
    let lastTag = baseVersion;
    try {
        lastTag = execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""')
            .toString()
            .trim()
            .replace(/^v/, '');
        if (!lastTag) {
            lastTag = baseVersion;
        }
    } catch (e) {
        // Use base version as fallback
        lastTag = baseVersion;
    }

    // Get commit count since last tag
    let commitsSinceTag = 0;
    try {
        commitsSinceTag = parseInt(
            execSync(`git rev-list --count ${lastTag}..HEAD 2>/dev/null || echo "0"`)
                .toString()
                .trim()
        );
    } catch (e) {
        // Fall back to total commit count if tag doesn't exist
        try {
            commitsSinceTag = parseInt(
                execSync('git rev-list --count HEAD 2>/dev/null || echo "0"')
                    .toString()
                    .trim()
            );
        } catch (e) {
            commitsSinceTag = 0;
        }
    }

    // Get commit hash for metadata
    let commitHash = '';
    try {
        commitHash = execSync('git rev-parse --short HEAD')
            .toString()
            .trim();
    } catch (e) {
        commitHash = 'unknown';
    }

    // Parse base version
    const [major, minor, patch] = lastTag.split('.').map(v => parseInt(v) || 0);

    // Build new version with commit count
    // Use: MAJOR.MINOR.(PATCH + commitssinceTag)-commitHash
    let newPatch = patch + Math.floor(commitsSinceTag / 10);
    const newVersion = `${major}.${minor}.${newPatch}+${commitHash}`;

    // Update package.json
    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    console.log(`✅ Version updated: ${lastTag} → ${newVersion}`);
    console.log(`   Commits since tag: ${commitsSinceTag}`);
    console.log(`   Commit hash: ${commitHash}`);

} catch (error) {
    console.error('❌ Error updating version:', error.message);
    process.exit(1);
}
