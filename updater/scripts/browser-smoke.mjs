import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('.tmp', `updater-browser-${Date.now()}`);
assert.equal(process.platform, 'win32', 'This integration test requires Windows.');
const edition = process.argv[2] === 'light' ? 'light' : 'full';
const product = edition === 'light' ? 'Asterveil' : 'Asterveil Pro';
mkdirSync(root, { recursive: true });
const directory = join(root, product);
cpSync(resolve('.output', product), directory, { recursive: true });
const screenshots = join(root, 'screenshots');
mkdirSync(screenshots);
mkdirSync(join(root, 'profile/Default'), { recursive: true });
writeFileSync(
  join(root, 'profile/Default/Preferences'),
  JSON.stringify({ extensions: { ui: { developer_mode: true } } }),
);
const registry =
  'HKCU\\Software\\Google\\ChromeForTesting\\NativeMessagingHosts\\cn.asterveil.updater';
const chromeRegistry = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\cn.asterveil.updater';
const edgeRegistry = 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\cn.asterveil.updater';
const readRegistry = (key) => {
  const result = spawnSync('reg.exe', ['query', key, '/ve'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.match(/REG_SZ\s+(.+)$/m)?.[1]?.trim() ?? null;
};
const previous = readRegistry(registry);
const previousChrome = readRegistry(chromeRegistry);
const previousEdge = readRegistry(edgeRegistry);
const restore = (key, value) => {
  if (value === null) spawnSync('reg.exe', ['delete', key, '/f'], { windowsHide: true });
  else
    execFileSync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], {
      windowsHide: true,
    });
};
let context;
try {
  context = await chromium.launchPersistentContext(join(root, 'profile'), {
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    executablePath: chromium.executablePath(),
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
      '--enable-logging',
      '--v=1',
      `--log-file=${join(root, 'chrome.log')}`,
    ],
    viewport: { width: 1280, height: 900 },
  });
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  console.log('Extension loaded:', id);
  const setupPage = await context.newPage();
  await setupPage.goto('chrome://extensions/');
  const devToggle = setupPage.locator('extensions-toolbar #devMode');
  await devToggle.waitFor();
  console.log('Developer mode before:', await devToggle.evaluate((el) => el.checked));
  if (!(await devToggle.evaluate((el) => el.checked))) await devToggle.click();
  console.log('Developer mode after:', await devToggle.evaluate((el) => el.checked));
  await setupPage.close();
  const exe = resolve('updater/target/release/asterveil-updater.exe');
  const installerDirectory = join(root, 'installer');
  mkdirSync(installerDirectory);
  cpSync(exe, join(installerDirectory, 'asterveil-updater.exe'));
  cpSync('updater/install.ps1', join(installerDirectory, 'install.ps1'));
  const installed = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(installerDirectory, 'install.ps1'),
      '-Browser',
      'chrome',
      '-ExtensionId',
      id,
      '-Directory',
      directory,
    ],
    {
      env: { ...process.env, LOCALAPPDATA: join(root, 'localappdata') },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(installed.status, 0, installed.stderr);
  const edgeDirectory = join(root, 'Edge', product);
  cpSync(resolve('.output', product), edgeDirectory, { recursive: true });
  const edgeId = 'a'.repeat(32);
  const edgeInstall = spawnSync(exe, ['--install', 'edge', edgeId, edgeDirectory], {
    env: { ...process.env, LOCALAPPDATA: join(root, 'localappdata') },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(edgeInstall.status, 0, edgeInstall.stderr);
  assert.ok(readRegistry(edgeRegistry)?.endsWith('cn.asterveil.updater.json'));
  const hostPath = join(root, 'localappdata/Asterveil/Updater/cn.asterveil.updater.json');
  execFileSync('reg.exe', ['add', registry, '/ve', '/t', 'REG_SZ', '/d', hostPath, '/f'], {
    windowsHide: true,
  });
  const native = (command) =>
    worker.evaluate(
      async ({ command, edition }) =>
        await chrome.runtime.sendNativeMessage('cn.asterveil.updater', {
          protocol: 1,
          command,
          edition,
          version: chrome.runtime.getManifest().version,
        }),
      { command, edition },
    );
  const message = Buffer.from(
    JSON.stringify({ protocol: 1, command: 'status', edition, version: '0.1.2' }),
  );
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(message.length);
  const direct = spawnSync(JSON.parse(readFileSync(hostPath)).path, [`chrome-extension://${id}/`], {
    input: Buffer.concat([prefix, message]),
    windowsHide: true,
  });
  assert.equal(direct.status, 0, direct.stderr?.toString());
  assert.equal(JSON.parse(direct.stdout.subarray(4)).ok, true);
  const status = await native('status');
  console.log('Native status:', status);
  assert.equal(status.ok, true);
  const page = await context.newPage();
  await context.route('https://jx.7fa4.cn:8888/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="zh"><head><title>Updater integration fixture</title></head><body><main><h1>7FA4</h1><textarea aria-label="网站输入"></textarea></main></body></html>',
    }),
  );
  await page.goto('https://jx.7fa4.cn:8888/');
  await page.getByRole('button', { name: `打开 ${product} 设置` }).click();
  await page.getByRole('button', { name: '关于', exact: true }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'https://jx.7fa4.cn/*' }))[0].id,
  );
  const guard = (type) =>
    worker.evaluate(
      async ({ tabId, type }) =>
        chrome.tabs.sendMessage(tabId, { channel: 'asterveil:updater', type }),
      { tabId, type },
    );
  assert.equal(await guard('lock'), true);
  assert.equal(await page.evaluate(() => document.body.inert), true);
  await guard('unlock');
  assert.equal(await page.evaluate(() => document.body.inert), false);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '网站输入' }).fill('正在作答');
  assert.equal(await guard('lock'), false);
  await page.getByRole('button', { name: `打开 ${product} 设置` }).click();
  for (const mode of ['light', 'dark']) {
    const background = await page.evaluate((mode) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = mode === 'light' ? '#fff4cf' : '#080c21';
      ctx.fillRect(0, 0, 64, 64);
      return canvas.toDataURL('image/png');
    }, mode);
    await worker.evaluate(async (mode) => {
      const all = await chrome.storage.local.get(null);
      const value = all['asterveil:settings'] ?? {
        schemaVersion: 1,
        enabled: true,
        revision: 0,
        modules: {},
        accentColor: '#3b82c4',
      };
      await chrome.storage.local.set({
        'asterveil:settings': { ...value, colorMode: mode, revision: value.revision + 1 },
      });
    }, mode);
    await worker.evaluate(async (image) => {
      const settings = (await chrome.storage.local.get('asterveil:settings'))['asterveil:settings'];
      await chrome.storage.local.set({
        'asterveil:settings': {
          ...settings,
          revision: settings.revision + 1,
          background: { enabled: true, image, overlay: 5 },
        },
      });
    }, background);
    await page.waitForTimeout(250);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: join(screenshots, `${mode}-${width}.png`), fullPage: true });
      assert.equal(await page.locator('#update-check').isVisible(), true);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
  // Real network preflight: the current public release may predate signed metadata.
  const network = await native('prepare');
  console.log('Real GitHub preflight:', network);
  assert.ok(network.ok === true || typeof network.error === 'string');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-asterveil="settings"]').shadowRoot;
      const status = root.querySelector('#update-status');
      return status.textContent && !status.textContent.includes('正在检测');
    },
    {},
    { timeout: 90000 },
  );
  assert.equal(await page.getByRole('button', { name: '检查更新', exact: true }).isEnabled(), true);
  // Exercise native transaction + real extension reload using a prepared fixture,
  // independently of publishing an otherwise nonexistent new GitHub release.
  const canonical = JSON.parse(
    readFileSync(join(root, 'localappdata/Asterveil/Updater/bindings.json')),
  ).bindings[id].directory;
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const work = join(root, `.asterveil-update-${hash}`);
  mkdirSync(work, { recursive: true });
  const stage = join(work, 'stage');
  cpSync(resolve('.output', product), stage, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(stage, 'manifest.json')));
  const oldVersion = manifest.version;
  const parts = oldVersion.split('.').map(Number);
  parts[2]++;
  const nextVersion = parts.join('.');
  manifest.version = nextVersion;
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest));
  function treeHash(root) {
    const hash = createHash('sha256');
    function visit(path) {
      for (const name of readdirSync(path).sort()) {
        if (path === root && name.toLowerCase() === '_metadata') continue;
        const child = join(path, name);
        const stat = statSync(child);
        if (stat.isDirectory()) visit(child);
        else {
          const rel = Buffer.from(child.slice(root.length + 1).replaceAll('\\', '/'));
          const n = Buffer.alloc(8);
          n.writeBigUInt64LE(BigInt(rel.length));
          hash.update(n);
          hash.update(rel);
          const size = Buffer.alloc(8);
          size.writeBigUInt64LE(BigInt(stat.size));
          hash.update(size);
          hash.update(readFileSync(child));
        }
      }
    }
    visit(root);
    return hash.digest('hex');
  }
  writeFileSync(
    join(work, 'state.json'),
    JSON.stringify({
      phase: 'prepared',
      version: nextVersion,
      previous: oldVersion,
      tree_hash: treeHash(stage),
      deadline: 0,
    }),
  );
  await worker.evaluate(async (nextVersion) => {
    await chrome.storage.local.set({
      'asterveil:test:preserved': 'draft survives',
      'asterveil:updater': {
        enabled: false,
        status: 'installing',
        message: '',
        version: nextVersion,
        checkedAt: Date.now(),
      },
    });
  }, nextVersion);
  const result = await native('apply');
  console.log('Install result:', result);
  assert.equal(result.ok, true);
  const newWorkerPromise = context.waitForEvent('serviceworker', { timeout: 30000 });
  await Promise.race([
    worker.evaluate(() => chrome.runtime.reload()).catch(() => {}),
    new Promise((r) => setTimeout(r, 1000)),
  ]);
  worker = await newWorkerPromise;
  for (let i = 0; i < 40; i++) {
    const journal = JSON.parse(readFileSync(join(work, 'state.json')));
    if (journal.phase === 'confirmed') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(JSON.parse(readFileSync(join(work, 'state.json'))).phase, 'confirmed');
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), nextVersion);
  assert.equal(
    await worker.evaluate(
      async () =>
        (await chrome.storage.local.get('asterveil:test:preserved'))['asterveil:test:preserved'],
    ),
    'draft survives',
  );
  const repair = spawnSync(JSON.parse(readFileSync(hostPath)).path, ['--repair', id], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(repair.status, 0, repair.stderr);
  assert.equal(JSON.parse(readFileSync(join(directory, 'manifest.json'))).version, oldVersion);
  console.log(
    'PASS: Native Messaging, real browser reload acknowledgement, preserved storage, rollback, and four UI sizes/modes. Artifacts:',
    root,
  );
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        id,
        network,
        status,
        installed: true,
        confirmed: true,
        storagePreserved: true,
        rollback: true,
        screenshots,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.race([context?.close(), new Promise((r) => setTimeout(r, 5000))]);
  restore(registry, previous);
  restore(chromeRegistry, previousChrome);
  restore(edgeRegistry, previousEdge);
}
