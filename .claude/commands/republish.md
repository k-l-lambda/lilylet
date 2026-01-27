
Republish lilylet packages and update lilylet-live-editor dependencies.

Steps:
1. Bump version in /home/camus/work/lilylet/package.json using `npm version patch --no-git-tag-version`
2. Bump version in /home/camus/work/lilylet-markdown/package.json using `npm version patch --no-git-tag-version`
3. Publish lilylet: `npm publish` in /home/camus/work/lilylet
4. Publish lilylet-markdown: `npm publish` in /home/camus/work/lilylet-markdown
5. Update lilylet-live-editor dependencies:
   - Run `npm update @k-l-lambda/lilylet @k-l-lambda/lilylet-markdown` in /home/camus/work/lilylet-live-editor
   - Update package.json with new version numbers
6. Report the new versions published
