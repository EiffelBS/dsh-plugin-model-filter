# DSH 0.1.7-rc2 compatibility

## Status

Plugin `0.3.2` restores the searchable model picker on DSH `0.1.7-rc.2` while
retaining the DSH `0.1.5-rc.2` browser contracts. The fix does not disable or
replace `ui-model-selection`, does not publish another `modelDirectories`
service, and does not modify the DSH frontend or any stock package.

## Root cause

The host row and the plugin row were both present and active. The plugin also
still won the `conversation.input.model` seat at priority `-1`. The regression
occurred later, when the winning component rendered.

DSH `0.1.7-rc.2` replaced the fixed-size primitive icon exports used by this
plugin:

| DSH 0.1.5-rc.2 | DSH 0.1.7-rc.2 |
| --- | --- |
| `IconDataOutline16` | `IconDataOutlineRegular` |
| `IconChevronDownOutline14` | `IconChevronDownOutlineRegular` |
| `IconChevronRightOutline14` | `IconChevronRightOutlineRegular` |
| `IconCheckOutline16` | `IconCheckOutlineRegular` |
| `IconWarningOutline16` | `IconWarningOutlineRegular` |

The old property reads produced undefined React element types. A strict
compatibility test against the pre-fix client fails with
`rendered an invalid element type: undefined`. When the winning entry throws,
the slot error boundary retires that entry and the stock renderer becomes the
remaining single-slot winner. This explains why an active plugin row and a
working native picker could be observed without the search field.

A second contract changed in the same host release:
`ModelDirectory.select()` now resolves `RemoteResult<void>` rather than a bare
`void`. A resolved `{ ok: false }` is a failed operation, not a rejection.
Version `0.3.2` normalizes the legacy and current result shapes before the UI
decides whether to close the menu or show the failure toast.

## Compatibility fix

`lib/client.js` now resolves every required icon at module materialization:

1. Prefer the DSH `0.1.7` `*Regular` export.
2. Fall back to the DSH `0.1.5` fixed-size export.
3. Throw a named compatibility error during materialization if neither exists.

The same client then normalizes selection outcomes as follows:

| Stock result | Plugin result |
| --- | --- |
| `undefined` (DSH 0.1.5 success) | `true` |
| `{ ok: true }` | `true` |
| `{ ok: false, error }` | `false` |
| rejected promise | `false` |

No picker, catalog, command, or service implementation was forked.

## Ownership invariant

The effective profile must always contain both rows when the plugin is enabled:

```text
ui-model-selection   active, priority 0, owns modelDirectories / /model / model locale
ui-model-filter      active, priority -1, renders conversation.input.model only
```

The `cordis.patch.yml` data is exactly one root insert:

```yaml
- insert:
    - id: ui-model-filter
      name: 'dsh-plugin-model-filter'
```

It contains no `disabled` key and no override for `ui-model-selection`.
Bundle order controls composition only. The single-slot registry sorts entries
by ascending priority and renders the first live entry, so priority `-1`
wins even if the stock entry is registered later. A second priority-`0` entry
is rejected by the host rather than silently replacing the first one.

Disabling or removing `ui-model-filter` removes only the priority-`-1`
renderer. The stock priority-`0` entry becomes active again and continues to
provide the native service, command, and locale namespace.

## Tracked automated gate

Run:

```sh
npm install --no-package-lock
npm test
```

The test uses exact development-only pins for DSH `0.1.7-rc.2` and verifies:

- the parsed patch is exactly one plugin insert;
- the target package versions, client metadata, and primitive declarations;
- priority `-1` versus stock-shaped priority `0`, independent of registration
  order;
- same-priority rejection and plugin disposal/remount;
- modern and legacy primitive-shaped module surfaces;
- plain text, regular-expression, invalid-regex, and no-match filtering;
- provider/model identity on selection;
- legacy `void`, current `RemoteResult`, failure, and rejection outcomes.

The VM tests deliberately do not claim to mount the complete stock service or
browser shell. Full service ownership and UI behavior are covered by the
isolated target-runtime checks below.

## Isolated target-runtime validation

All lifecycle checks used a scratch `DSH_HOME` below this repository and test
ports `3099`/`3199`. The session server on port `3080` was never installed,
modified, stopped, or used as a test profile.

| Scenario | Effective profile and browser result |
| --- | --- |
| Fresh `0.3.2` install | Stock and plugin rows present once; browser graph contains both bundles; plugin CSS injected; model slot and search visible; two filtered models in one provider group; selecting the alternate model changed the composer trigger; zero console/page errors. |
| Upgrade `0.3.1` to `0.3.2` | A profile first linked to an exact archived `0.3.1` tree, then re-linked to the current checkout. Bundle count remained one, installed version became `0.3.2`, stock row stayed active, and the browser search/selection smoke passed with zero errors. |
| Plugin disabled | A profile overlay set `ui-model-filter` disabled. Browser graph contained the stock bundle only; plugin CSS was absent; search was absent; the stock list still exposed two models in one provider group; selecting the alternate model changed the composer trigger; zero console/page errors. |
| Plugin re-enabled | Removing the disable overlay restored exactly one plugin row. Search, provider grouping, alternate-model selection, and the zero-error browser result returned. |
| DSH `0.1.5-rc.2` compatibility | An isolated `0.1.5-rc.2` profile composed both rows with plugin `0.3.2`. The tracked modern/legacy-shaped tests cover its primitive names and `void` selection contract. A complete old-host UI run was not used as an acceptance claim because the fresh scratch profile stopped at first-run workspace onboarding. |

The browser used a new Edge context for every run and authenticated only to
the scratch server. Installation, update, disable, and re-enable each required
a new server process and browser session; a page refresh alone was not treated
as proof of a new bundle composition.

## Reproduction outline

Use a disposable home, never the session profile:

```powershell
$env:DSH_HOME = 'C:\path\to\dsh-model-filter-rc2-home'
dsh --profile model-filter --from-default-profile web --dump-config
dsh plugin --profile model-filter add link:C:\path\to\dsh-plugin-model-filter
dsh --profile model-filter --dump-config
dsh web --profile model-filter --port 3099 --no-open
```

In a fresh browser session:

1. Create a session and open the composer model menu.
2. Open the Model pane and confirm the search field is present.
3. Filter the list and confirm provider grouping remains visible.
4. Select a different model and confirm the trigger changes.
5. Disable only `ui-model-filter`, restart the test server, and confirm the
   stock picker still opens and selects a model.
6. Re-enable the plugin, restart again, and confirm search returns.

For an upgrade test, create the profile with an archived prior plugin tree,
then replace only the plugin link and repeat the effective-config and browser
checks.

## Sources

- [DSH 0.1.7-rc.2 primitive icon declarations](https://unpkg.com/@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2/lib/types/icons/index.d.ts)
- [DSH 0.1.7-rc.2 model directory contract](https://unpkg.com/@deepseek-ai/dsh-client-ui-model-selection@0.1.7-rc.2/lib/types/client/directory.d.ts)
- [DSH 0.1.7-rc.2 model-selection client](https://unpkg.com/@deepseek-ai/dsh-client-ui-model-selection@0.1.7-rc.2/lib/client.js)
- [DSH 0.1.7-rc.2 slot core](https://unpkg.com/@deepseek-ai/dsh-client-ui-slots@0.1.7-rc.2/lib/index.js)
