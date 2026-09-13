# dsh-plugin-model-filter

A DSH plugin that adds a **search / filter box** to the model selection menu in
the DSH chat composer. With many providers and models in your catalog, the
default menu is a long grouped list; this plugin lets you type to filter it
instantly (`Search models…`) without touching the rest of the selection UX.

It is the properly-named, distributable successor to the earlier profile-local
name-shadowing fork (`@deepseek-ai/dsh-client-ui-model-selection` vendored copy).
Instead of shadowing the shipped package name, this plugin is a real
third-party bundle named `dsh-plugin-model-filter` that:

1. **coexists** with the shipped `ui-model-selection` row (it is *not*
   disabled), and
2. inserts its own client row which occupies the public
   `conversation.input.model` slot with the search-enabled picker.

Because the stock row is kept active, the shipped package remains the single
source of truth for the `modelDirectories` service (consumed by
`@nanmicoder/dsh-agent-teams`), the `/model` popup command, and the `model`
locale namespace. Disabling or removing this plugin is therefore **safe**: the
stock picker takes the seat back and boot never loses the service provider.

## How it works

The web profile composes its browser module graph from loader rows. A plugin
package that declares `dsh.bundle.patch` in its `package.json` becomes a
*profile layer* when installed through `dsh plugin`:

```jsonc
// package.json
{
  "name": "dsh-plugin-model-filter",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [ /* provider packages */ ] }
  }
}
```

`cordis.patch.yml` is applied as a patch over the composed web profile, in
`dsh.profile.bundles` order (after `dsh-web-app`), and only performs one edit:

```yaml
- insert:                    # our own client row at the root
    - id: ui-model-filter
      name: 'dsh-plugin-model-filter'
```

The node half of `dsh-client-modules` scans the inserted row, resolves the
package by name, serves `exports["./client"]` (`lib/client.js`), and the
browser registers the search-enabled `ModelSelect` on the slot.

### Slot ownership

`conversation.input.model` is a `kind: "single"`, session-scope slot. The stock
`ui-model-selection` row and this bundle's row both register the seat, but the
native slot registry renders the entry with the **lowest priority** (its own
error text: *"register at a different priority to shadow it (lowest
renders)"*). The stock row registers at the default priority `0`; this bundle
registers at `priority: -1`, so the searchable picker renders while the stock
row stays live. When this bundle is disabled or removed, the stock picker (no
search) takes over automatically.

### Rendered vs. owned responsibilities

| Concern | Owner |
| --- | --- |
| `modelDirectories` service (`directoryFor`) | stock `ui-model-selection` |
| `/model` popup command | stock `ui-model-selection` |
| `model` locale namespace dictionaries | stock `ui-model-selection` |
| `conversation.input.model` seat rendering (with search) | this bundle |
| search-only dictionary keys (`menu.searchPlaceholder`, `menu.clear`, `empty.noMatch`) | this bundle, in-render fallback (the stock dictionaries do not define them) |

## Requirements

- DSH with the web profile (`@deepseek-ai/dsh-web-app` bundle).
- pnpm available on `PATH` (used by `dsh plugin`).
- React / `@deepseek-ai/cordis` peer dependency (provided by the web bundle).

## Install

From a local checkout (no registry needed):

```sh
dsh plugin --profile web add link:/path/to/dsh-plugin-model-filter
```

From a git URL:

```sh
dsh plugin --profile web add git+https://github.com/EiffelBS/dsh-plugin-model-filter.git
```

`dsh plugin` runs `pnpm add` in the profile directory, then reconciles
`dsh.profile.bundles`: because this package declares `dsh.bundle.patch`, it is
auto-appended as a profile layer. Restart the web server (or open a fresh page
session) for the bundle change to take effect.

Verify installation:

```sh
dsh web --profile web --no-open   # then check the model menu includes the search box
```

## Update

After pulling a newer revision of this repository (or a published release):

```sh
dsh plugin --profile web update dsh-plugin-model-filter
```

then restart the web instance.

## Uninstall / disable

```sh
dsh plugin --profile web remove dsh-plugin-model-filter
```

Reconciliation removes the bundle from `dsh.profile.bundles`; the stock
`ui-model-selection` row was never disabled, so the model picker and the
`modelDirectories` service are restored untouched on the next start.

> Because the stock row is never disabled by this plugin, a profile-level
> *disable* of the bundle row is also safe: `modelDirectories` stays provided
> by the stock row and boot is unaffected (`@nanmicoder/dsh-agent-teams` keeps
> activating). Only do not disable the *stock* `ui-model-selection` row in
> addition to removing this plugin — that combination would leave the service
> without a provider.

## Layout

```
package.json          name dsh-plugin-model-filter, dsh.bundle.patch, dsh.client
cordis.patch.yml      inserts the client row (stock row left active)
lib/index.js          host half (empty apply — pure UI plugin)
lib/client.js         browser half: search filter, ModelSelect on the slot
```

## Under the hood

- The picker occupies the public slot `conversation.input.model`
  (`kind: "single"`, session scope). This bundle registers it at
  `priority: -1` while the stock row stays at `0`, and the registry renders the
  lowest-priority entry — so the searchable picker wins the single-slot
  election while the stock package keeps providing the service, command, and
  dictionary keys.
- Removing this bundle cannot starve `modelDirectories`: the provider is the
  stock row, not this bundle. This fixes the boot failure seen in the
  first-generation design, where disabling the plugin row left
  `@nanmicoder/dsh-agent-teams` `pending (waiting for service:
  modelDirectories)` and aborted web boot.

## Limitations

- Requires the stock `ui-model-selection` row to stay enabled (its default
  state). This plugin deliberately does not provide the `modelDirectories`
  service, so it cannot replace the stock row entirely.
- Search is client-side over the loaded catalog; the catalog itself still comes
  from the Host generation snapshot.

## License

MIT