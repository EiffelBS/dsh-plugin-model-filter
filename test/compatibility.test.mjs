import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import yaml from 'js-yaml';

const SLOT = 'conversation.input.model';
const STOCK = '@deepseek-ai/dsh-client-ui-model-selection';
const PLUGIN = 'dsh-plugin-model-filter';
const clientPath = process.env.MODEL_FILTER_CLIENT_PATH ?? new URL('../lib/client.js', import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bundlePatch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const primitivesRoot = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json'));
const modelSelectionRoot = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-model-selection/package.json'));
const slotsRoot = path.dirname(require.resolve('@deepseek-ai/dsh-client-ui-slots/package.json'));

const MODERN_ICONS = [
  'IconDataOutlineRegular',
  'IconChevronDownOutlineRegular',
  'IconChevronRightOutlineRegular',
  'IconCheckOutlineRegular',
  'IconWarningOutlineRegular',
];

const LEGACY_ICONS = [
  'IconDataOutline16',
  'IconChevronDownOutline14',
  'IconChevronRightOutline14',
  'IconCheckOutline16',
  'IconWarningOutline16',
];

function icon(name) {
  return function IconFixture() {
    return null;
  };
}

function primitives(names) {
  return Object.assign(
    Object.fromEntries(names.map((name) => [name, icon(name)])),
    { Toast: function ToastFixture() { return null; } },
  );
}

function hookRuntime() {
  const cells = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], (next) => {
        cells[index] = typeof next === 'function' ? next(cells[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useId: () => 'model-filter-test',
    useMemo: (factory) => factory(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useEffect: () => {},
    useLayoutEffect: () => {},
    Fragment: Symbol.for('react.fragment'),
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key: key ?? null });
  return {
    react,
    jsxRuntime: { jsx, jsxs: jsx, Fragment: react.Fragment },
    reset: () => { cursor = 0; },
  };
}

function materializeClient(iconPrimitives) {
  const hooks = hookRuntime();
  const styles = [];
  let exports;
  const document = {
    body: {},
    head: {
      appendChild(node) {
        styles.push(node);
      },
    },
    createElement(tagName) {
      return { tagName, dataset: {}, textContent: '' };
    },
    querySelector: () => null,
  };
  const window = {
    __ModuleLoader__: {
      load(registration) {
        exports = registration.factory((specifier) => {
          if (specifier === 'react') return hooks.react;
          if (specifier === 'react/jsx-runtime') return hooks.jsxRuntime;
          if (specifier === 'react-dom') return { createPortal: (child) => child };
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return iconPrimitives;
          throw new Error(`Unexpected client import: ${specifier}`);
        });
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 720,
  };
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), {
    window,
    document,
    console,
    queueMicrotask,
    Node: class Node {},
  }, { filename: clientPath.pathname ?? String(clientPath) });
  return { plugin: exports, hooks, styles };
}

function createDirectory(select = async () => ({ ok: true })) {
  let snapshot = {
    current: { provider: 'alpha', model: 'shared' },
    groups: [
      { id: 'alpha', name: 'Alpha', models: [{ id: 'shared', name: 'Shared model' }] },
      {
        id: 'beta',
        name: 'Beta',
        models: [
          { id: 'beta-only', name: 'Beta only' },
          { id: 'other', name: 'Other model' },
        ],
      },
    ],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    routable: true,
  };
  return {
    directory: {
      store: {
        subscribe: () => () => {},
        getSnapshot: () => snapshot,
      },
      load: async () => snapshot,
      select,
      setSnapshot(next) {
        snapshot = { ...snapshot, ...next };
      },
    },
  };
}

function createBench(iconPrimitives, select, { stockFirst = true } = {}) {
  const core = new SlotCore();
  core.register({
    name: 'root',
    children: {
      [SLOT]: { kind: 'single', scope: 'session', owner: { locked: false } },
    },
  }, () => null);
  let stockRegistered = false;
  const registerStock = () => {
    if (stockRegistered) return;
    stockRegistered = true;
    core.register({ name: SLOT, registrant: STOCK }, () => null);
  };
  if (stockFirst) registerStock();

  const { directory } = createDirectory(select);
  let directoryForCalls = 0;
  const modelDirectories = {
    directoryFor(sessionId) {
      directoryForCalls++;
      assert.equal(sessionId, 'fixture-session');
      return directory;
    },
  };
  const sessions = { subagentAddress: () => undefined };
  let registration;
  let component;
  const disposers = [];
  const materialized = materializeClient(iconPrimitives);
  const slots = {
    inject(name, callback) {
      assert.equal(name, SLOT);
      const dispose = callback();
      disposers.push(dispose);
      return dispose;
    },
    register(options, renderer) {
      registration = options;
      component = renderer;
      const dispose = core.register({ ...options, registrant: PLUGIN }, renderer);
      disposers.push(dispose);
      return dispose;
    },
  };
  const context = {
    inject(names, callback) {
      assert.equal(names.join(','), 'slots,modelDirectories');
      return callback({ slots, modelDirectories, sessions });
    },
  };
  materialized.plugin.apply(context);
  if (!stockFirst) registerStock();
  return {
    core,
    directory,
    materialized,
    modelDirectories,
    get directoryForCalls() { return directoryForCalls; },
    get registration() { return registration; },
    get component() { return component; },
    dispose() {
      while (disposers.length > 0) disposers.pop()();
    },
  };
}

function walk(tree, predicate = () => true, result = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return result;
  if (Array.isArray(tree)) {
    for (const child of tree) walk(child, predicate, result);
    return result;
  }
  if (Object.hasOwn(tree, 'type')) {
    if (predicate(tree)) result.push(tree);
    const children = tree.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) walk(child, predicate, result);
  }
  return result;
}

function textOf(tree) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textOf).join('');
  if (typeof tree === 'object' && Object.hasOwn(tree, 'type')) return textOf(tree.props?.children);
  return '';
}

function assertValidElementTypes(tree) {
  for (const node of walk(tree)) {
    assert.ok(
      typeof node.type === 'string' || typeof node.type === 'function' || typeof node.type === 'symbol',
      `rendered an invalid element type: ${String(node.type)}`,
    );
  }
}

function render(bench) {
  bench.materialized.hooks.reset();
  const injected = bench.registration.inject('fixture-session');
  const tree = bench.component({ locked: false, ...injected, t: (key) => key });
  assertValidElementTypes(tree);
  return tree;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('bundle patch preserves the native row and inserts one plugin row', () => {
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(yaml.load(bundlePatch), [{
    insert: [{ id: 'ui-model-filter', name: 'dsh-plugin-model-filter' }],
  }]);
});

test('pinned DSH rc2 packages still expose the tested contracts', () => {
  const primitivesManifest = JSON.parse(fs.readFileSync(path.join(primitivesRoot, 'package.json'), 'utf8'));
  const modelSelectionManifest = JSON.parse(fs.readFileSync(path.join(modelSelectionRoot, 'package.json'), 'utf8'));
  const slotsManifest = JSON.parse(fs.readFileSync(path.join(slotsRoot, 'package.json'), 'utf8'));
  assert.equal(primitivesManifest.version, '0.1.7-rc.2');
  assert.equal(modelSelectionManifest.version, '0.1.7-rc.2');
  assert.equal(slotsManifest.version, '0.1.7-rc.2');
  assert.equal(modelSelectionManifest.dsh.client.platform, 'web');
  assert.deepEqual(packageJson.dsh.client.inject, modelSelectionManifest.dsh.client.inject);
  assert.equal(packageJson.dsh.client.platform, 'web');
  assert.equal(packageJson.exports['./client'].default, './lib/client.js');

  const iconTypes = fs.readFileSync(path.join(primitivesRoot, 'lib/types/icons/index.d.ts'), 'utf8');
  for (const name of MODERN_ICONS) {
    assert.match(iconTypes, new RegExp(`export declare const ${name}:`));
  }
  for (const name of LEGACY_ICONS) assert.doesNotMatch(iconTypes, new RegExp(`export declare const ${name}:`));

  const directoryTypes = fs.readFileSync(path.join(modelSelectionRoot, 'lib/types/client/directory.d.ts'), 'utf8');
  assert.match(directoryTypes, /select\(selection: ModelSelection\): Promise<RemoteResult<void>>/);
});

test('DSH rc2 slot disposal and remount preserve one stock-shaped occupant', () => {
  const bench = createBench(primitives(MODERN_ICONS));
  assert.equal(bench.registration.priority, -1);
  assert.deepEqual(bench.core.snapshot(SLOT)[0].occupants, [
    { registrant: PLUGIN, priority: -1, active: true },
    { registrant: STOCK, priority: 0, active: false },
  ]);

  bench.dispose();
  assert.deepEqual(bench.core.snapshot(SLOT)[0].occupants, [
    { registrant: STOCK, priority: 0, active: true },
  ]);

  const remounted = createBench(primitives(MODERN_ICONS));
  assert.deepEqual(remounted.core.snapshot(SLOT)[0].occupants, [
    { registrant: PLUGIN, priority: -1, active: true },
    { registrant: STOCK, priority: 0, active: false },
  ]);
  assert.equal(remounted.directoryForCalls, 0);
  assert.equal(remounted.modelDirectories.directoryFor('fixture-session'), remounted.directory);
  assert.equal(remounted.directoryForCalls, 1);
  remounted.dispose();

  const reverse = createBench(primitives(MODERN_ICONS), undefined, { stockFirst: false });
  assert.deepEqual(reverse.core.snapshot(SLOT)[0].occupants, [
    { registrant: PLUGIN, priority: -1, active: true },
    { registrant: STOCK, priority: 0, active: false },
  ]);
  reverse.dispose();

  const guard = new SlotCore();
  guard.register({
    name: 'root',
    children: { [SLOT]: { kind: 'single', scope: 'session', owner: { locked: false } } },
  }, () => null);
  guard.register({ name: SLOT }, () => null);
  assert.throws(
    () => guard.register({ name: SLOT }, () => null),
    /single slot .* already has a registration at priority 0 .*lowest renders/,
  );
});

test('modern and legacy primitive-shaped surfaces render every search mode', () => {
  for (const names of [MODERN_ICONS, LEGACY_ICONS]) {
    const bench = createBench(primitives(names));
    const initial = render(bench);
    assert.equal(walk(initial, (node) => node.type === 'button').length, 1);

    walk(render(bench), (node) => node.type === 'button')[0].props.onClick();
    walk(render(bench), (node) => node.props?.role === 'menuitem')[0].props.onClick();
    const menu = render(bench);
    const input = walk(menu, (node) => node.type === 'input')[0];
    assert.match(input.props.placeholder, /^Search models/);

    input.props.onChange({ target: { value: 'Beta' } });
    const filtered = render(bench);
    assert.equal(walk(filtered, (node) => node.props?.role === 'menuitemradio').length, 2);
    assert.deepEqual(
      walk(filtered, (node) => node.props?.role === 'menuitemradio').map((node) => node.key),
      ['beta-only', 'other'],
    );

    for (const scenario of [
      { value: '/^beta/', options: 2 },
      { value: '/^shared/i', options: 1 },
      { value: '/[/', options: 0, empty: /Invalid pattern/ },
      { value: 'no-such-model', options: 0, empty: /No models match/ },
    ]) {
      walk(render(bench), (node) => node.type === 'input')[0].props.onChange({ target: { value: scenario.value } });
      const tree = render(bench);
      assert.equal(walk(tree, (node) => node.props?.role === 'menuitemradio').length, scenario.options, scenario.value);
      if (scenario.empty) assert.match(textOf(tree), scenario.empty);
    }
    bench.dispose();
  }
});

test('model selection accepts legacy void and rc2 RemoteResult success contracts', async () => {
  const cases = [
    { result: undefined, accepted: true },
    { result: true, accepted: true },
    { result: { ok: true }, accepted: true },
    { result: { ok: false, error: { code: 'denied' } }, accepted: false },
  ];
  for (const { result, accepted } of cases) {
    const bench = createBench(primitives(MODERN_ICONS), async () => result);
    const injected = bench.registration.inject('fixture-session');
    assert.equal(await injected.select({ provider: 'beta', model: 'beta-only' }), accepted);
    bench.dispose();
  }
  const rejected = createBench(primitives(MODERN_ICONS), async () => { throw new Error('offline'); });
  assert.equal(await rejected.registration.inject('fixture-session').select({ provider: 'beta', model: 'beta-only' }), false);
  rejected.dispose();
});

test('search result selection keeps provider identity and reports rc2 failures', async () => {
  const calls = [];
  const modern = primitives(MODERN_ICONS);
  let result = { ok: true };
  const bench = createBench(modern, async (selection) => {
    calls.push(selection);
    return result;
  });
  walk(render(bench), (node) => node.type === 'button')[0].props.onClick();
  walk(render(bench), (node) => node.props?.role === 'menuitem')[0].props.onClick();
  walk(render(bench), (node) => node.type === 'input')[0].props.onChange({ target: { value: 'Beta' } });
  walk(render(bench), (node) => node.props?.role === 'menuitemradio')[0].props.onClick();
  await nextTurn();
  assert.deepEqual(calls.map((selection) => ({ ...selection })), [{ provider: 'beta', model: 'beta-only' }]);

  result = { ok: false, error: { code: 'denied' } };
  bench.directory.setSnapshot({ error: 'selection denied' });
  walk(render(bench), (node) => node.props?.role === 'menuitemradio')[0].props.onClick();
  await nextTurn();
  const tree = render(bench);
  const toast = walk(tree, (node) => typeof node.type === 'function' && node.type.name === 'ToastFixture')[0];
  assert.ok(toast, 'selection failure should render the shared toast');
  assert.equal(toast.props.icon.type, modern.IconWarningOutlineRegular);
  assert.deepEqual({ ...calls[1] }, { provider: 'beta', model: 'beta-only' });
  bench.dispose();
});
