# Contributing

Use Node.js 22.13 or newer and npm. Open an issue with the Obsidian version, Marginalia MD version, active view mode, and a minimal Markdown example when reporting a bug. Remove personal information from examples and screenshots.

```sh
npm ci
npm run lint
npm run lint:css
npm test
npm run build
npm run install:vault -- /absolute/path/to/a/test-vault
```

Enable Marginalia MD in the test vault's Community plugins settings and reload it after installing changes. Use a disposable vault for development.

`npm run build` is the production build scanned by Obsidian. `npm run build:dev` adds source maps for development. `npm run check:build` verifies byte-identical default and release output.

The runtime uses Obsidian and its own CodeMirror dependencies as externals. Do not bundle another copy of Obsidian or CodeMirror, rewrite the article to render annotations, or store saved comments outside the Markdown note.

## Release

1. Update `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` together.
2. Add the changes to `CHANGELOG.md` and `docs/releases/<version>.md`.
3. Run `npm ci`, `npm run lint`, `npm run lint:css`, `npm test`, `npm run package`, and `npm run check:build`.
4. Verify annotations, native editing, standard Reading view, and compact panes in a test vault. Check `THIRD_PARTY_NOTICES.md` for dependency changes.
5. Commit the release, create a tag matching the manifest version exactly (for example `0.3.4`, without `v`), and push the branch and tag.

The Release workflow builds and validates the tagged source, attests the three plugin assets, then publishes only `main.js`, `manifest.json`, and `styles.css` as release attachments. The optional manual-install ZIP, licenses, and checksums are stored as workflow artifacts for 90 days. The ZIP and individual files are written locally to `dist/<version>/` by `npm run package`. Built assets, local vaults, and backups do not belong in Git.

The first Community Plugins submission is a separate step; see [the submission guide](docs/community-submission.md). After acceptance, later releases use the same GitHub release mechanism.
