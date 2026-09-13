# dsh-plugin-model-filter

A DSH plugin that adds a **search / filter box** to the model selection menu in
the DSH chat composer. With many providers and models in your catalog, the
default menu is a long grouped list; this plugin lets you type to filter it
instantly (`Search models…`) without touching the rest of the selection UX.

It is the properly-named, distributable successor to the earlier profile-local
name-shadowing fork (`@deepseek-ai/dsh-client-ui-model-selection` vendored copy).
Instead of shadowing the shipped package name, this plugin is a real
third-party bundle named `dsh-plugin-model-filter` that:

1. disables the shipped `ui-model-selection` client row,
2. inserts its own client row,
3. occupies the public `conversation.input.model` slot with the search-enabled
   picker, and
4. takes over the `/model` command and the `modelDirectories` service, exactly
   as the shipped package did.

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
`dsh.profile.bundles` order (after `dsh-web-app`, so it wins):

```yaml
- id: ui-model-selection    # shipped row — switched off (override without name)
  disabled: true

- insert:                    # our own client row at the root
    - id: ui-model-filter
      name: 'dsh-plugin-model-filter'
```

The node half of `dsh-client-modules` scans the inserted row, resolves the
package by name, serves `exports["./client"]` (`lib/client.js`), and the
browser registers the search-enabled `ModelSelect` on the slot.

> The `disabled` override deliberately carries **no `name`**: a patched entry
> without `name` is applied as an id-targeted override (every non-`id` key is
> copied verbatim), so it is not subject to the package-name equality check
> that would otherwise reject a third-party row targeting a shipped name.

## Requirements

- DSH with the web profile (`@deepseek-ai/dsh-web-app` bundle).
- pnpm available on `PATH` (used by `dsh plugin`).
- React / `@deepseek-ai/cordis` peer dependency (provided by the web bundle).

## Install

From a local checkout (no registry needed):

```sh
dsh plugin --profile web add link:/path/to/dsh-plugin-model-filter
```

From a git URL (once published):

```sh
dsh plugin --profile web add git+https://github.com/<you>/dsh-plugin-model-filter.git
```

`dsh plugin` runs `pnpm add` in the profile directory, then reconciles
`dsh.profile.bundles`: because this package declares `dsh.bundle.patch`, it is
auto-appended as a profile layer. Restart the web server (or open a fresh page
session) for the bundle change to take effect.

Verify installation:

```sh
dsh web --profile web --no-open   # then check the model menu includes the search box
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-plugin-model-filter
```

Reconciliation removes the bundle from `dsh.profile.bundles`; the shipped
`ui-model-selection` row returns to its default active state on the next start.

## Layout

```
package.json          name dsh-plugin-model-filter, dsh.bundle.patch, dsh.client
cordis.patch.yml      disables the shipped row + inserts the client row
lib/index.js          host half (empty apply — pure UI plugin)
lib/client.js         browser half: catalog, search filter, ModelSelect, /model command
```

## Under the hood

- The picker occupies the public slot `conversation.input.model`
  (`kind: "single"`, session scope) — the same seat the shipped package uses.
  Because the shipped row is disabled, the plugin is the only occupant, so
  there is no single-slot priority contest.
- The `/model` popup command and the `modelDirectories` service are also owned
  by this bundle, so no other package needs to stay loaded for the feature.
- `@nanmicoder/dsh-agent-teams` (when installed) consumes the `modelDirectories`
  service; it keeps working because this bundle provides that same service.

## Limitations

- Replaces the shipped model picker entirely (same surface, plus search). If a
  future DSH version changes the `conversation.input.model` slot contract, the
  plugin must be updated to match.
- Search is client-side over the loaded catalog; the catalog itself still comes
  from the Host generation snapshot.

## License

MIT