# Releasing BetterClaw

How to publish a new version of the CLI (`@betterclaw/cli`) and the OpenClaw plugin (`betterclaw`) to npm.

## Prerequisites (one-time)

1. **npm account.** `npm adduser`, then `npm whoami` should print your handle.
2. **Access to publish.** For `@betterclaw/*` scoped packages, your npm account needs to own or be on the org. `npm org ls betterclaw` confirms membership. For the unscoped `betterclaw` package (the plugin), you need to own it — `npm owner ls betterclaw`.
3. **2FA for publish** enabled on your npm account. `npm profile set auth-and-writes`. All publishes require a one-time password.
4. **Clean git state.** Don't ship with uncommitted work. `git status` should be empty.

## Release flow (per version bump)

### 1. Version bump

Semver, same version across all publishable packages for V1 (cli + plugin-openclaw). Contracts, cloud, plugin-cowork stay `private: true` and don't publish.

```bash
# From repo root. Bump all packages to the new version.
pnpm --filter "@betterclaw/cli" --filter "betterclaw" exec \
  npm version 0.2.1 --no-git-tag-version

# Update the root package.json to match for consistency.
npm version 0.2.1 --no-git-tag-version --prefix .

# Update BETTERCLAW_VERSION constant in packages/cli/bin/betterclaw
# (grep for BETTERCLAW_VERSION and bump the string)

# Update plugin-openclaw/telemetry.mjs PLUGIN_VERSION constant too.
```

### 2. CHANGELOG

Move the `Unreleased` section of `CHANGELOG.md` under a new `## [0.2.1] — YYYY-MM-DD` heading. Ensure migration notes cover any breaking change.

### 3. Local validation

```bash
# Sync LICENSE + NOTICE into each publishable package (copies, not symlinks,
# because npm pack doesn't follow symlinks out of the package boundary).
./scripts/sync-license.sh

# Clean install from scratch
rm -rf node_modules packages/*/node_modules
pnpm install

# Lint (syntax)
node --check packages/cli/bin/betterclaw
for f in packages/plugin-openclaw/*.mjs; do node --check "$f" || exit 1; done

# Dry-run publish for each publishable package
pnpm --filter "@betterclaw/cli" publish --dry-run
pnpm --filter "betterclaw" publish --dry-run

# The dry-run lists every file that will land in the tarball.
# Verify: no source outside the `files` manifest, LICENSE + NOTICE present,
# no secrets, no .env files.
```

### 4. Commit + tag

```bash
git add -A
git commit -m "chore(release): v0.2.1"
git tag -s v0.2.1 -m "v0.2.1 release"   # signed tag; drop -s if no GPG setup
git push origin main
git push origin v0.2.1
```

### 5. Publish

Publish the CLI first (plugin install docs reference it by name):

```bash
pnpm --filter "@betterclaw/cli" publish --otp=XXXXXX
```

Then the plugin:

```bash
pnpm --filter "betterclaw" publish --otp=XXXXXX
```

`--otp` is your 2FA code. If you get `E402 Payment Required`, you hit npm's free-tier scoped-package limit; either upgrade the org to a paid plan or switch scope.

### 6. Post-publish verification

```bash
# Fresh shell, fresh install directory
cd /tmp
mkdir release-test && cd release-test
npm init -y
npm install betterclaw@0.2.1 @betterclaw/cli@0.2.1

# Plugin files land at node_modules/betterclaw/
ls node_modules/betterclaw/*.mjs
cat node_modules/betterclaw/LICENSE | head -3   # verify LICENSE + NOTICE made it in
cat node_modules/betterclaw/NOTICE | head -3

# CLI binary is executable
./node_modules/.bin/betterclaw --version
```

### 7. GitHub release

```bash
gh release create v0.2.1 \
  --title "v0.2.1" \
  --notes-file <(awk '/^## \[0\.2\.1\]/{flag=1;next}/^## \[/{flag=0}flag' CHANGELOG.md)
```

Attach no binaries (npm is the distribution channel). The GitHub release is for a human-readable link in the README and for release-notes RSS.

## Rollback

If a bad release ships:

```bash
# Deprecate, don't unpublish. Unpublishing breaks downstream users who already
# installed the bad version; deprecation just adds a warning on future installs.
npm deprecate betterclaw@0.2.1 "Bad release; install 0.2.0 or wait for 0.2.2"
npm deprecate @betterclaw/cli@0.2.1 "Bad release; install 0.2.0 or wait for 0.2.2"

# Fix the bug, bump to 0.2.2, publish again.
```

npm's [unpublish policy](https://docs.npmjs.com/policies/unpublish) is strict: you can unpublish within 72 hours if zero downloads, otherwise you can only deprecate. Plan accordingly.

## Release cadence

V1 development: release when Track A ships something users can test (currently: daemon + npm publish readiness + plugin install without dangerous flag). After V1 design partners onboard, move to a weekly or bi-weekly cadence. Semver rules:

- **0.x.y → 0.x.(y+1)** for bug fixes, doc updates, non-breaking changes
- **0.x.y → 0.(x+1).0** for new features, schema additions, new subcommands
- **0.x.y → 1.0.0** once the API (plugin↔daemon socket, graph JSON schema, CLI subcommand surface) is committed to ≥1 year of backwards compatibility

We're explicitly not at 1.0.0 yet; the wedge is still validating per the CEO plan.
