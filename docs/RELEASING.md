# Releasing tktop

How a tktop version gets from `main` to npm, PyPI, and a git tag.

## 0. Prerequisites (one-time, manual browser steps)

The tag-triggered CI publish needs an npm token stored as a GitHub secret.
This can only be done in a browser — the API refuses programmatic writes from
CI tokens.

### Create the npm automation token

1. Log in to [npmjs.com](https://www.npmjs.com).
2. Open the account menu (top right) → **Access Tokens**.
   Direct link: <https://www.npmjs.com/settings/<your-user>/tokens>
3. **Generate New Token** → **Classic Token** → type **Automation**
   (Automation tokens work in CI without 2FA prompts).
4. Set a name like `tktop-github-actions`, confirm, and copy the token.
   It starts with `npm_` — you cannot see it again after leaving the page.

### Add it to the GitHub repository secret

1. Open <https://github.com/AlexKay28/tktop/settings/secrets/actions>
   (repo → **Settings** → **Secrets and variables** → **Actions**).
2. Click **New repository secret**.
3. Name: `NPM_TOKEN` (exact spelling).
4. Secret: paste the `npm_…` token. **Add secret**.

Until this is done, tag pushes still succeed in CI — the publish step
prints a visible notice and skips (`docs: see the gate in
`.github/workflows/publish.yml`), and publishing stays manual (§3).

## 1. Prepare the release

```bash
cd ~/tktop
# bump all three version stamps to the same version
#   package.json                     "version": "0.4.0"
#   python/pyproject.toml             version = "0.4.0"
#   python/tktop_tui/__init__.py      VERSION = "0.4.0"
# add a CHANGELOG.md section for the new version
bun run typecheck          # must pass
bun run test               # full suite green
git add -A && git commit -m "v0.4.0 — <summary>"
git push
```

## 2. Tag (automatic publish once NPM_TOKEN exists)

```bash
git tag v0.4.0
git push origin v0.4.0
```

CI (`.github/workflows/publish.yml`) then typechecks and publishes
`tktop@0.4.0` to npm. Watch it at
<https://github.com/AlexKay28/tktop/actions>. When the secret is absent
the run shows a **notice** "NPM_TOKEN secret is not set — skipping npm
publish", and you fall back to §3 for that release.

## 3. Publish manually (pre-secret fallback)

npm (from a machine with the token in `~/tktop/.env.local`):

```bash
cd ~/tktop
TOKEN=$(grep '^NPM_TOKEN=' .env.local | head -1 | cut -d= -f2- | tr -d '"')
printf '//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > /tmp/npmrc
npm publish --access public --userconfig /tmp/npmrc --registry=https://registry.npmjs.org
rm -f /tmp/npmrc
```

PyPI (`pip` wrapper — always manual; CI does not publish it):

```bash
cd ~/tktop/python
./sync.sh                            # stage TUI sources into the wheel
../venv/bin/python -m build          # or any python -m build
twine upload --repository-url https://upload.pypi.org/legacy/ \
  -u __token__ -p "$PYPI_TOKEN" dist/*<version>*
```

## 4. Verify

```bash
curl -s https://registry.npmjs.org/tktop | grep -o '"latest":"[^"]*"'
curl -s https://pypi.org/pypi/tktop-tui/json | grep -o '"version":"[^"]*"' | head -1
# clean-room: install from the registry in an empty prefix and check it boots
# (exit 124 under `timeout` = TUI launched and ran)
timeout 5 <bin>/tktop --sort recent
```

## Standalone binary (optional)

`npm run compile` produces `dist/tktop`, a self-contained ~130 MB executable
(no Bun install needed at the consumer machine):

```bash
bun install
npm run compile
./dist/tktop --sort recent   # timeout-kills with 124 = fine
```

Attach it to the GitHub release for the tag if you want a download-and-run
artifact.
