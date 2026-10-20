# Changelog

## 0.3.4 — 2026-10-20

- Remove duplicate CSS declarations identified by the automated review.
- Reject duplicate properties in the local CSS check.

## 0.3.3 — 2026-10-20

- Make the default build match the production release byte for byte.
- Add GitHub build-provenance attestations for all plugin assets.
- Publish only Obsidian-supported release attachments; keep manual packages in workflow artifacts.
- Remove CSS compatibility warnings and all important declarations.
- Render wide editor margins outside paint-contained widgets while preserving compact layouts.
- Add CSS compatibility and reproducible-build checks to CI.

## 0.3.2 — 2026-10-20

- Rename the repository, plugin ID, release archive, and package to `marginalia-md`, with the display name **Marginalia MD**.
- Update install links and Community Plugins submission details.
- Preserve the Markdown annotation format and document upgrades from the old private plugin ID.

## 0.3.1 — 2026-10-20

First public GitHub release, prepared for the Obsidian Community Plugins directory.

- Add an MIT license, bundled dependency notices, a portable installer, and public examples.
- Add a release ZIP, checksums, version compatibility mapping, and automated build/release workflows.
- Check source against Obsidian's recommended ESLint rules.
- Move fixed widget-containment styling into CSS and use cross-window DOM checks.
- Make the help tab searchable through Obsidian's current settings API.
- Set the minimum app version to the tested Obsidian 1.14.4 release.

## 0.3.0 — 2026-10-19

- Enable marginalia in all ordinary editing views, without tag rules or view switching.
- Add the same marginalia styling and annotation composer to standard Reading view.
- Restore theme-controlled main text and properties styling.
- Carry drafts between editing and Reading view; remove the separate reader.

## 0.2.0 — 2026-10-18

- Add native Live Preview margins and preserve Vim editing and undo.

## 0.1.0 — 2026-10-18

- Introduce paragraph and passage annotations stored as Markdown footnotes.
