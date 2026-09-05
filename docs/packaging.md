# Package Manager Distribution

Gitnado is delivered through package managers in addition to the direct
downloads on the [Releases](https://github.com/hegsie/gitnado/releases) page.
The [`publish-packages.yml`](../.github/workflows/publish-packages.yml)
workflow runs automatically whenever a release is published (moved out of
draft) and pushes the new version to each channel. It can also be re-run
manually from the Actions tab (workflow dispatch) with a release tag such as
`v0.8.0`, e.g. after fixing a one-time setup issue.

| Channel | Platform | Automation | One-time setup required |
|---------|----------|------------|-------------------------|
| winget | Windows | PR against `microsoft/winget-pkgs` | `WINGET_TOKEN` secret, fork of winget-pkgs, initial manual submission |
| Homebrew | macOS (Apple Silicon) | Push to `hegsie/homebrew-gitnado` tap | Tap repository, `HOMEBREW_TAP_TOKEN` secret |
| Scoop | Windows | Commit to `packaging/scoop/gitnado.json` on `main` | None |
| AUR | Arch Linux | Community-maintained (`gitnado-bin`) | — |

Jobs whose secret is missing are skipped, not failed, so the workflow works
before every channel is set up.

## winget

The `winget` job uses
[winget-releaser](https://github.com/vedantmgoyal9/winget-releaser) to open a
version-update PR against
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) with the
`.exe` (NSIS) and `.msi` installers. Package identifier: `hegsie.Gitnado`.

One-time setup:

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) under
   the `hegsie` account (the action pushes manifest branches to this fork).
2. Create a **classic** personal access token with the `public_repo` scope
   (fine-grained tokens are not supported by winget-releaser) and add it as
   the `WINGET_TOKEN` repository secret.
3. The package must already exist in winget-pkgs before the action can update
   it, so submit the first version manually with
   [wingetcreate](https://github.com/microsoft/winget-create):

   ```powershell
   wingetcreate new `
     https://github.com/hegsie/gitnado/releases/download/v0.8.0/Gitnado_0.8.0_x64-setup.exe `
     https://github.com/hegsie/gitnado/releases/download/v0.8.0/Gitnado_0.8.0_x64_en-US.msi
   # PackageIdentifier: hegsie.Gitnado — then review and submit the PR
   ```

Once the initial PR is merged, every later release is submitted automatically.
Users install with `winget install hegsie.Gitnado`.

The first submission must be made from a release that ships `Gitnado_*`
installers (0.9.0 or later). The earlier `hegsie.Leviathan` submission
([microsoft/winget-pkgs#428196](https://github.com/microsoft/winget-pkgs/pull/428196))
should be closed rather than merged — a published `hegsie.Leviathan` package
would never receive updates.

## Homebrew

The `homebrew` job downloads the release DMG, computes its SHA-256, renders
[`packaging/homebrew/gitnado.rb.template`](../packaging/homebrew/gitnado.rb.template)
and pushes the result to `Casks/gitnado.rb` in the
`hegsie/homebrew-gitnado` tap. Only Apple Silicon is published because CI
builds `aarch64-apple-darwin` only; the cask declares `depends_on arch: :arm64`.

One-time setup:

1. Create a public repository named `homebrew-gitnado` under the `hegsie`
   account (an empty repository with a README is enough; the workflow creates
   `Casks/gitnado.rb`).
2. Create a personal access token with write access to that repository
   (fine-grained with Contents read/write, or classic with `repo`) and add it
   as the `HOMEBREW_TAP_TOKEN` repository secret in the Gitnado repository.

Users install with `brew install --cask hegsie/gitnado/gitnado`.

## Scoop

[`packaging/scoop/gitnado.json`](../packaging/scoop/gitnado.json) is a
Scoop manifest that installs the MSI by extraction (`extract_dir:
"PFiles/Gitnado"`), the same pattern the Scoop Extras bucket uses for other
Tauri apps. The `scoop` job updates its version, URL, and hash on each release
and commits to `main` with `[skip ci]`. Until the first Gitnado release runs
that job the manifest points at the upcoming version and carries no `hash`
(Scoop installs with a warning); the workflow fills it in. No secret is needed — the default
`GITHUB_TOKEN` has `contents: write`. If branch protection on `main` blocks
pushes from `github-actions[bot]`, either allow it or replace the token with a
PAT.

Users install with:

```powershell
scoop install https://raw.githubusercontent.com/hegsie/gitnado/main/packaging/scoop/gitnado.json
```

Because Scoop extracts the MSI rather than running it, the WebView2 runtime
bootstrap never executes; the manifest's `notes` tell users where to get
WebView2 in the unlikely case it is missing. The manifest also carries
`checkver`/`autoupdate` metadata so it could be adopted into a community
bucket (e.g. Extras) unchanged.

## Release asset naming

The manifests and workflow depend on the Tauri bundle asset names staying
stable:

- `Gitnado_<version>_x64-setup.exe` (NSIS)
- `Gitnado_<version>_x64_en-US.msi` (WiX)
- `Gitnado_<version>_aarch64.dmg` (macOS)

If `productName`, bundle targets, or the Windows installer language in
`src-tauri/tauri.conf.json` change, update `publish-packages.yml`, the Scoop
manifest, and the Homebrew template together. The preflight job verifies these
assets exist on the release and fails early with a clear error if not.

## Future candidates

Not yet automated, in rough order of value: Chocolatey (needs a community
account and moderation), Flathub (needs a flatpak manifest and review), and
Snapcraft (needs a store account).
