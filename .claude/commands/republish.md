
Republish lilylet packages and update lilylet-live-editor dependencies.

Note: npm publish for lilylet and lilylet-markdown is handled automatically by GitHub Actions when version changes are pushed to main.

**Why the order matters:** lilylet-markdown BUNDLES lilylet into its dist (esbuild, `scripts/build.mjs`), and pins it as an EXACT devDependency (`"@k-l-lambda/lilylet": "0.1.xx"`, since 0.1.61). Bumping only lilylet-markdown's own version republishes it with the OLD lilylet inside. This happened for 0.1.63-0.1.67, which all shipped lilylet 0.1.90. So lilylet must be on npm first, then lilylet-markdown's pin is raised to it, then lilylet-markdown is published.

Steps:
1. Publish lilylet:
   - `npm version patch --no-git-tag-version` in /home/camus/work/lilylet
   - `git add package.json`, commit "chore: bump version to X.Y.Z", push to main
   - Wait until `npm view @k-l-lambda/lilylet version` shows X.Y.Z (and the "Publish to npm" run succeeds)
2. Point lilylet-markdown at the new lilylet (do NOT skip):
   - In /home/camus/work/lilylet-markdown, set devDependencies `@k-l-lambda/lilylet` to the exact new version: `npm install --save-dev --save-exact @k-l-lambda/lilylet@X.Y.Z`
   - Check: `node -p 'require("./package.json").devDependencies["@k-l-lambda/lilylet"]'` and the lockfile entry `packages["node_modules/@k-l-lambda/lilylet"].version` both equal X.Y.Z
3. Publish lilylet-markdown:
   - `npm version patch --no-git-tag-version`
   - Run `node --test tests/lockfile.test.mjs` (CI runs it too: lockfile version must equal package.json version, and the lockfile's lilylet must equal the pinned devDependency)
   - `git add package.json package-lock.json` (BOTH; the lockfile is tracked and tested in CI), commit e.g. "chore: bump lilylet to X.Y.Z; version A.B.C", push to main
   - Wait until `npm view @k-l-lambda/lilylet-markdown version` shows A.B.C
   - Verify it really carries the new lilylet: `npm view @k-l-lambda/lilylet-markdown@A.B.C devDependencies` must list `@k-l-lambda/lilylet: X.Y.Z`
4. Update lilylet-live-editor dependencies:
   - Run `npm update @k-l-lambda/lilylet @k-l-lambda/lilylet-markdown` in /home/camus/work/lilylet-live-editor
   - Check the lockfile resolved both new versions (X.Y.Z and A.B.C)
   - Bump version: `npm version patch --no-git-tag-version`
   - Commit: `git add package.json package-lock.json && git commit -m "chore: bump version"`
   - Push to main branch (this triggers GitHub Pages deploy automatically)
5. Monitor github action of lilylet-live-editor (Deploy to GitHub Pages), and make sure it succeeds
6. Report the new versions published, including which lilylet version lilylet-markdown bundles
