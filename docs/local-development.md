# Local development

## Editor

Prerequisites:

- Windows is the supported path for the included `.bat` launchers.
- Python 3 should be available through `py -3` or `python`.
- The runtime assets needed by the selected scenario must already be present in the checkout. The default, `fast`, and `fresh` launch modes skip data rebuilding; they do not create missing assets.

Start the local editor using existing runtime assets:

```bat
start_dev.bat
```

Use the startup worker and cache with readonly startup interaction:

```bat
start_dev.bat fast
```

Use full startup interaction with the startup worker and cache disabled (this still skips data rebuilding):

```bat
start_dev.bat fresh
```

When data rebuilding is required, use the explicit full mode with the data build dependencies and source inputs installed:

```bat
start_dev.bat full
```

Full mode runs `build_data.bat` before starting the server; it is not required for ordinary UI edits when the runtime assets are already available.

For ordinary public-scenario UI or renderer-owner work, an optional sparse source checkout avoids materializing build inputs, large transport payloads, and tracked `dist`. It keeps source files editable and preserves the original runtime metadata. The selection reuses the Pages asset policy and adds direct runtime-registry and public-scenario manifest dependencies, including full topology and audit files that the source metadata still references.

Prepare a plan from a committed source version in a full checkout (PowerShell):

```powershell
$source = git rev-parse HEAD
py -3 tools/editor_checkout_profile.py prepare --source $source --out-root .runtime/editor-checkout/profile
```

Review `profile.json` for the exact commit/tree, selected/excluded files, logical Git bytes and supported scope. `source-presence.json` lists raw-source cache presence, expected checksums, upstream references and existing rebuild commands; presence does not prove checksum validity or that raw data can be regenerated. `prepare` writes these files and literal Git patterns only; it never changes checkout settings.

Apply the reviewed plan **only to a new, unused worktree path**; never run these commands against an existing worktree with work in progress:

```powershell
$target = 'C:\path\to\new-editor-worktree'
git worktree add --detach --no-checkout $target $source
Get-Content -Raw .runtime/editor-checkout/profile/sparse-checkout.txt | git -C $target sparse-checkout set --no-cone --stdin
git -C $target checkout --detach $source
py -3 tools/editor_checkout_profile.py check --source $source --repo $target --out-root .runtime/editor-checkout/profile
```

Stop if any command fails. `check` regenerates the fixed-source plan and verifies that selected files are present and excluded tracked files were not materialized. It reports actual file bytes separately from logical Git bytes; neither is disk allocation or network traffic. Git worktrees share their object database, so this reduces materialized files, not shared history storage or download volume. Create your own branch in the new worktree before editing, then install its Node dependencies with `npm ci` and use `start_dev.bat fast`.

The intended acceptance path is the existing `editing baseline fast` HOI4 1936 / Modern World save-load test. HGO preview, full transport workbench payloads, raw-data rebuilding, Pages release builds and P4 history qualification require a full checkout. Catalog inventories can still list assets outside this profile; their presence in metadata does not make those optional workflows supported. To restore the new worktree to full materialization, first preserve any local edits, then run `git -C $target sparse-checkout disable`. This does not retire tracked `dist` or change another worktree.

Keep formal rebuilding on a fixed full source: `data/manifest.json` records derived outputs and checksums; `data/source_ledger.json` and transport manifests record upstream/cache requirements, recipes and build commands. Some raw inputs are ignored or `frozen_local_only` caches. Use their recorded provenance and existing `tools/check_source_ledger.py` validation when rebuilding data; the lightweight editor profile does not download them or substitute Pages packaging for raw-data regeneration.

## Backend preview

Open the local backend and community preview:

```bat
start_backend_preview.bat
```

This local mode stores preview backend data under `.runtime/backend/` on your machine. It is useful for trying Cloud Saves, public community posts, downloads, comments, reports, and admin moderation flows.
