# GraphBus UI Versioning

## Overview

GraphBus UI uses automatic semantic versioning that increments based on git commits and tags.

## Version Format

The version follows this pattern: `MAJOR.MINOR.PATCH+COMMIT_HASH`

- **MAJOR**: Major version (manual increment for breaking changes)
- **MINOR**: Minor version (features)
- **PATCH**: Patch version (incremented automatically based on commit count)
- **COMMIT_HASH**: Git commit short hash (e.g., `354e025`)

Example: `1.0.0+354e025` means base version 1.0.0 with commit hash 354e025

## How It Works

1. **Pre-commit Hook**: Runs `npm run version:update` before each commit
2. **Automatic Version Update**: Script counts commits since last tag and updates package.json
3. **Git Integration**: Package.json is automatically staged after version update

## Setup (Developers)

The versioning system is automatically configured when you clone the repository. The git hook configuration is stored in `.githooks/` and configured via `git config core.hooksPath .githooks`.

To manually verify setup:
```bash
git config core.hooksPath
# Should output: .githooks
```

## Available Commands

```bash
# Update version immediately
npm run version:update

# Show current version
npm run version:show

# View version in app
# The version displays in the terminal info bar as: 📦 UI: v1.0.0 | CLI: v0.1.1
```

## Manual Version Bumps

To bump versions manually (for releases):

```bash
# Create a git tag for the current commit
git tag v1.1.0

# The next commit will reference this tag and increment from it
npm run version:update
```

## Version in the App

The version is displayed in multiple places:

1. **Terminal Info Bar**: Shows both UI and CLI versions
   - Format: `📦 UI: v1.0.0 | CLI: v0.1.1`
   - Dynamically fetches graphbus CLI version on startup

2. **Package.json**: Updated automatically on each commit

## Best Practices

- Don't manually edit the version in package.json (let the script handle it)
- Use semantic versioning tags (v1.0.0, v1.1.0, etc.) for releases
- The version automatically tracks commit activity, so pushing frequently gives meaningful version numbers
