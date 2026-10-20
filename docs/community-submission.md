# Community Plugins submission

The repository and GitHub release are prepared for submission. This document does not mean the plugin has been accepted or listed.

| Field | Value |
| --- | --- |
| Repository URL | https://github.com/lucapericlp/marginalia-md |
| Plugin ID | `marginalia-md` |
| Name | Marginalia MD |
| Author | Luca Peric |
| Release tag | `0.3.4` (no `v` prefix) |
| Minimum Obsidian version | `1.14.4` |
| License | MIT |

The release includes separate `main.js`, `manifest.json`, and `styles.css` attachments, as required by Obsidian's installer. There are no extra release attachments. The optional ZIP is stored separately as a workflow artifact for manual installation. GitHub artifact attestations cover all three installer assets. `versions.json` maps releases to their minimum supported app version. `main.js` includes the dependency license notices because Obsidian downloads only the three plugin assets.

## Submit through the directory

Obsidian's current submission process uses its Community website. Follow the [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) and [account setup guide](https://docs.obsidian.md/community-directory/set-up-and-claim).

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account.
2. Connect your GitHub account so the directory can verify ownership of `lucapericlp/marginalia-md`.
3. Open **Plugins → New plugin**, enter the repository URL above, and choose yourself as owner.
4. Review the developer policies and maintenance commitment yourself, then submit.
5. Check the automated manifest, release, source, and build reports. Address any feedback with a new version and release, then publish the listing when eligible.

The account holder must agree to the policies and maintenance commitment. The release can be installed through BRAT or manually while the listing is pending. Avoid advertising an `obsidian://show-plugin?id=marginalia-md` installation link until the entry is actually listed.

## Preparation evidence

- Manifest ID/name were checked against the public plugin list before publication.
- All 28 automated checks pass, including annotation source preservation, selection mapping, native undo, ambiguous anchors, and theme typography.
- Obsidian's recommended ESLint rules pass without warnings.
- Saved notes work in ordinary Markdown and use no proprietary annotation database.
- No account, payment, telemetry, or plugin-initiated network requests are required.
- The runtime uses Obsidian's Vault API and does not read outside the vault.
- Desktop behaviour is tested on Obsidian 1.14.4. Mobile is not yet verified.

Read the [developer policies](https://docs.obsidian.md/community-directory/developer-policies) and [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) before submitting. The directory's checks are authoritative; local validation cannot guarantee acceptance.
