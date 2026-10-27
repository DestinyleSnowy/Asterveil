import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  fixturePassword,
  fixtureGrades as grades,
  fixtureNames as names,
  testUserNameExtension,
} from './fixtures/user-name-database.mjs';

const first = (grade) => Object.keys(grades).find((id) => grades[id] === grade);
const high = first('g1');
const other = first('g2');
const gradeKeys = [
  'x4',
  'x5',
  'x6',
  'c1',
  'c2',
  'c3',
  'g1',
  'g2',
  'g3',
  'd1',
  'd2',
  'd3',
  'd4',
  'by',
  'jl',
  'uk',
];
const classicColors = {
  x4: '#5e6e5e',
  x5: '#8c8c8c',
  x6: '#722ed1',
  c1: '#9254de',
  c2: '#ff4d4f',
  c3: '#fa8c16',
  g1: '#faad14',
  g2: '#ca00ca',
  g3: '#52c41a',
  d1: '#13c2c2',
  d2: '#9254de',
  d3: '#597ef7',
  d4: '#73d13d',
  by: '#8c8c8c',
  jl: '#ff85c0',
  uk: '#5e6e5e',
};
const rgb = (hex) =>
  `rgb(${[1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
const out = resolve('.tmp/user-names-browser');
await mkdir(out, { recursive: true });
const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="4" fill="#ddf3e9"/><path fill="#23806c" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>')}`;
const fixture = `<!doctype html><html lang="zh"><meta charset="utf-8"><style>body{font:16px system-ui}a{color:rgb(90,60,100)}.badge{color:rgb(10,100,30)}#blank-name-list{width:420px;border-collapse:collapse}#blank-name-list td{padding:10px;border-bottom:1px solid #eee}#blank-name-list img{width:24px;height:24px;vertical-align:middle}</style><body>
  <nav id="user-dropdown" data-user_id="1"><a href="/user/1">self_account</a></nav>
  <main class="ui main container"><h1>Better Names</h1>
    <table id="blank-name-list"><tbody>
      <tr><td>28</td><td class="td name"><a href="/user/1451"><img src="${avatar}" alt=""> adjacent_account </a></td><td>22</td></tr>
      <tr><td>29</td><td class="td name"><a id="blank-nickname" href="/user/2476">\n\t<img id="blank-avatar" src="${avatar}" alt="">\n\t\n</a></td><td>22</td></tr>
      <tr><td>30</td><td class="td name"><a href="/user/1158"><img src="${avatar}" alt=""> adjacent_account </a></td><td>21.5</td></tr>
    </tbody></table>
    <a id="standalone-avatar" href="/user/2476"><img src="${avatar}" alt=""></a>
    <a id="high" href="/user/${high}" style="color:purple!important;font-weight:600"><b style="color:blue">high_account</b><span class="badge">标签</span></a>
    <a id="other" href="/user/${other}">other_account</a>
    <a id="named" href="/user/${high}">${names[high]}</a>
    <a id="unknown" href="/user/900000009">unknown</a>
    <a id="clear" href="/user/900000002" style="color:purple">clear_account</a>
    <a id="custom" href="/user/900000001">custom_account</a>
    <a id="partial" href="/user/900000003">partial_account</a>
    <a id="coach" href="/user/1">coach_account</a>
    <a id="plan" href="/user/900000010">plan_account</a>
    <a id="plan-uni" href="/user/900000011">plan_uni</a>
    <a id="plan-graduate" href="/user/900000012">plan_graduate</a>
    <a id="plan-other" href="/user/900000013">plan_other</a>
    <a id="friend" href="/user/900000020">friend_account</a>
    <a id="friend-unknown" href="/user/900000021">friend_unknown_account</a>
    ${gradeKeys.map((key, index) => `<a id="grade-${key}" href="/user/${900001000 + index}">grade_account_${key}</a>`).join(' ')}
  </main></body></html>`;

for (const product of ['Asterveil', 'Asterveil Pro']) {
  const context = await chromium.launchPersistentContext(await mkdtemp(`${out}/profile-`), {
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    headless: true,
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(15_000);
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const extension = await testUserNameExtension(
      resolve('.output', product),
      await mkdtemp(`${out}/extension-`),
    );
    await cdp.send('Extensions.loadUnpacked', { path: extension });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(() =>
      chrome.storage.local.set({
        'asterveil:settings': {
          schemaVersion: 1,
          revision: 0,
          enabled: true,
          accentColor: '#bd4476',
          colorMode: 'light',
          modules: { 'local-avatars': false, 'home-layout': false },
        },
      }),
    );
    const state = () =>
      worker.evaluate(
        async () => (await chrome.storage.local.get('asterveil:settings'))['asterveil:settings'],
      );
    const mode = async (value) =>
      worker.evaluate(async (colorMode) => {
        const key = 'asterveil:settings';
        const current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({
          [key]: { ...current, colorMode, revision: current.revision + 1 },
        });
      }, value);
    const errors = [];
    let planStatus = 200;
    let friendStatus = 200;
    let officialStatus = 200;
    let signature = `${fixturePassword} 是 Better Names 的密码，后面可以添加说明。`;
    const officialRequests = [];
    const planUsers = [
      { id: Number(high), real_name: '计划不覆盖官方', graduate_year: 2032 },
      { id: 1, real_name: '计划不覆盖教练', graduate_year: 2029 },
      { id: 900000001, real_name: '计划名单同学', graduate_year: 2029 },
      {
        id: 900000010,
        real_name: '计划新增同学',
        graduate_year: 2032,
        phone: 'private-phone',
        email: 'private-email',
      },
      { id: 900000011, real_name: '计划大学同学', graduate_year: 2026 },
      { id: 900000012, real_name: '计划毕业同学', graduate_year: 2022 },
      { id: 900000013, real_name: '计划其他同学', graduate_year: null },
    ];
    const planRequests = [];
    const friendRequests = [];
    const friendFixture = (account) =>
      `<!doctype html><html><head><meta charset="utf-8"></head><body><table class="ui celled small very compact data table"><tbody><tr>${['用户号', '账号', '用户名', '昵称', '姓名', '班级', '座位', '关注关系', ''].map((title) => `<td>${title}</td>`).join('')}</tr>${[
        [high, '好友不覆盖官方', '初一7'],
        [1, '好友不覆盖教练', '高一贯4'],
        [900000001, '好友不覆盖自定义', '初三2'],
        [900000010, '好友中的计划同学', '高三3'],
        [900000020, account === '3' ? '新账号好友同学' : '好友新增同学', '高二15'],
        [900000021, '好友年级未知同学', ''],
      ]
        .map(
          ([id, name, grade]) =>
            `<tr><td><a href="/user/${id}">${id}</a></td><td>private-account</td><td>private-username</td><td>private-nickname</td><td>${name}</td><td>${grade}</td><td>private-seat</td><td>互相关注</td><td><a href="/user/${id}/unfollow">取消关注</a></td></tr>`,
        )
        .join('')}</tbody></table></body></html>`;
    await context.addCookies([
      {
        name: 'fixture_session',
        value: 'test-session',
        domain: 'jx.7fa4.cn',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    await context.route(/^https:\/\/(?:jx|in)\.7fa4\.cn:8888\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/user/811') {
        officialRequests.push({
          url: route.request().url(),
          cookie: route.request().headers().cookie ?? '',
        });
        return route.fulfill({
          status: officialStatus,
          contentType: 'text/html; charset=utf-8',
          body:
            signature === null
              ? '<div>请登录后查看用户信息</div>'
              : `<h4 class="ui top attached block header">个性签名</h4><div class="ui bottom attached segment"><div>${signature}</div></div>`,
        });
      }
      const account = /^\/user\/(\d+)\/friend$/.exec(path)?.[1];
      if (account) {
        friendRequests.push({
          url: route.request().url(),
          method: route.request().method(),
          cookie: route.request().headers().cookie ?? '',
        });
        return route.fulfill({
          status: friendStatus,
          contentType: 'text/html; charset=utf-8',
          body: friendFixture(account),
        });
      }
      if (path === '/better_names') {
        planRequests.push({
          url: route.request().url(),
          cookie: route.request().headers().cookie ?? '',
        });
        return route.fulfill({
          status: planStatus,
          contentType: 'application/json',
          body: JSON.stringify({ success: planStatus === 200, users: planUsers }),
        });
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const wait = async (tab, selector, property, value) =>
      tab
        .waitForFunction(
          ({ selector, property, value }) => {
            const node = document.querySelector(selector);
            return (
              node &&
              (property === 'color' ? getComputedStyle(node).color : node[property]) === value
            );
          },
          { selector, property, value },
          { polling: 50 },
        )
        .catch(async (error) => {
          console.error({
            selector,
            expected: value,
            actual: await tab.locator(selector).textContent(),
            errors,
          });
          await open(tab).catch(() => undefined);
          console.error(
            await tab
              .locator('.name-sources')
              .textContent()
              .catch(() => 'No settings'),
          );
          throw error;
        });
    const color = (tab, selector) =>
      tab.locator(selector).evaluate((node) => getComputedStyle(node).color);
    const waitScheme = (value) =>
      page.waitForFunction(
        (scheme) =>
          getComputedStyle(document.querySelector('[data-asterveil="settings"]'))
            .getPropertyValue('--av-scheme')
            .trim() === scheme,
        value,
        { polling: 50 },
      );
    const assertSavedColors = async () => {
      for (const key of gradeKeys) {
        const value = await page.locator(`#user-grade-${key}`).inputValue();
        assert.equal(
          await color(page, `#grade-${key}`),
          rgb(value),
          `${key}: name color must match the saved hex`,
        );
        assert.equal(
          await page
            .locator(`[data-grade="${key}"] label`)
            .evaluate((node) => getComputedStyle(node).color),
          rgb(value),
          `${key}: palette label must match the swatch`,
        );
        assert.equal(
          await page.locator(`#user-grade-hex-${key}`).inputValue(),
          value.toUpperCase(),
        );
      }
    };
    const open = async (tab) => {
      await tab.getByRole('button', { name: `打开 ${product} 设置`, exact: true }).click();
      await tab.getByRole('button', { name: 'Better Names', exact: true }).click();
      await tab.waitForFunction(
        () =>
          !document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#user-name-import').disabled,
        null,
        { polling: 50 },
      );
    };
    const upload = async (name, text) => {
      await page
        .locator('#user-name-file')
        .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#user-name-import').disabled,
        null,
        { polling: 50 },
      );
    };
    await page.goto('https://jx.7fa4.cn:8888/');
    await wait(page, '#high b', 'textContent', names[high]);
    await page.waitForFunction(
      (name) => document.querySelector('#blank-nickname')?.textContent.trim() === name,
      names['2476'],
    );
    assert.equal(await color(page, '#blank-nickname'), 'rgb(255, 77, 79)');
    assert.match(
      await page.locator('#blank-nickname').getAttribute('title'),
      /原用户名为空.*初2026级/,
    );
    assert.equal(await page.locator('#blank-nickname img').count(), 1);
    assert.equal(await page.locator('#standalone-avatar').textContent(), '');
    await page
      .locator('#blank-name-list')
      .screenshot({ path: resolve(out, `${product}-empty-nickname.png`) });
    await wait(page, '#plan', 'textContent', '计划新增同学');
    await wait(page, '#friend', 'textContent', '好友新增同学');
    assert.match(await page.locator('#friend').getAttribute('title'), /高2025级/);
    assert.match(await page.locator('#friend-unknown').getAttribute('title'), /其他/);
    assert.equal(friendRequests.length, 1);
    assert.match(friendRequests[0].url, /\/user\/1\/friend$/);
    assert.equal(friendRequests[0].method, 'GET');
    assert.match(friendRequests[0].cookie, /fixture_session=test-session/);
    assert.match(await page.locator('#plan').getAttribute('title'), /初2026级/);
    assert.match(await page.locator('#plan-uni').getAttribute('title'), /大2026级/);
    assert.match(await page.locator('#plan-graduate').getAttribute('title'), /毕业/);
    assert.match(await page.locator('#plan-other').getAttribute('title'), /其他/);
    assert.equal(await page.locator('#coach').textContent(), names['1']);
    assert.match(await page.locator('#coach').getAttribute('title'), /教练/);
    assert.equal(planRequests.length, 1);
    assert.match(planRequests[0].cookie, /fixture_session=test-session/);
    assert.match(await page.locator('#high').getAttribute('title'), /高2026级/);
    const originalHigh = await color(page, '#high');
    const originalOther = await color(page, '#other');
    assert.notEqual(originalHigh, originalOther);
    assert.equal(await color(page, '#high b'), originalHigh);
    assert.equal(
      await color(page, '#named'),
      originalHigh,
      'already-named links must still get a grade color',
    );
    assert.equal(await page.locator('#unknown').textContent(), 'unknown');
    assert.equal(await color(page, '#high .badge'), 'rgb(10, 100, 30)');
    await open(page);
    assert.equal(
      await page.locator('[data-source-id="plan"] strong').textContent(),
      'Better Names 计划',
    );
    assert.equal(
      await page.locator('[data-source-id="plan"] .name-source-count').textContent(),
      '7 人',
    );
    assert.equal(planRequests.length, 1, 'opening settings must reuse the feature request');
    assert.equal(await page.locator('.name-source-row').count(), 3);
    assert.equal(
      await page.locator('[data-source-id="friends"] .name-source-count').textContent(),
      '6 人',
    );
    assert.equal(friendRequests.length, 1, 'opening settings must reuse the friend request');
    assert.equal(officialRequests.length, 1, 'settings must reuse the unlocked official source');
    assert.match(officialRequests[0].cookie, /fixture_session=test-session/);
    assert.equal(
      await page.locator('[data-source-id="official"] .name-source-count').textContent(),
      `${Object.keys(names).length.toLocaleString('zh-CN')} 人`,
    );
    assert.equal(await page.locator('.name-grade-cell').count(), 16);
    assert.equal(await page.locator('#user-grade-g1').isDisabled(), true);
    assert.equal(await page.locator('#user-grade-editor').count(), 0);

    // A new document must reuse the session even while every remote source is unavailable.
    const beforeCachedReload = [
      officialRequests.length,
      planRequests.length,
      friendRequests.length,
    ];
    officialStatus = planStatus = friendStatus = 500;
    await page.reload();
    await wait(page, '#high b', 'textContent', names[high]);
    await wait(page, '#friend', 'textContent', '好友新增同学');
    assert.deepEqual(
      [officialRequests.length, planRequests.length, friendRequests.length],
      beforeCachedReload,
    );
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await page.waitForTimeout(80);
    assert.deepEqual(
      [officialRequests.length, planRequests.length, friendRequests.length],
      beforeCachedReload,
    );
    officialStatus = planStatus = friendStatus = 200;
    await open(page);

    const second = await context.newPage();
    second.on('pageerror', (error) => errors.push(error.message));
    await second.goto('https://in.7fa4.cn:8888/');
    await wait(second, '#high b', 'textContent', names[high]);
    await wait(second, '#friend', 'textContent', '好友新增同学');
    await page.bringToFront();
    const selectSource = async (id, enabled) => {
      await page.locator(`input[data-source-toggle="${id}"]`).setChecked(enabled);
      await page.waitForFunction(
        ({ id, enabled }) => {
          const input = document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector(`input[data-source-toggle="${id}"]`);
          return (
            input &&
            !input.disabled &&
            input.checked === enabled &&
            input.getAttribute('aria-checked') === String(enabled)
          );
        },
        { id, enabled },
        { polling: 50 },
      );
    };
    await selectSource('official', false);
    await wait(page, '#high b', 'textContent', '计划不覆盖官方');
    await wait(second, '#high b', 'textContent', '计划不覆盖官方');
    await selectSource('official', true);
    await wait(page, '#high b', 'textContent', names[high]);
    await wait(page, '#high', 'color', originalHigh);
    await selectSource('plan', false);
    await wait(page, '#plan', 'textContent', '好友中的计划同学');
    assert.equal(await page.locator('#better-names-source-refresh').isDisabled(), true);
    await selectSource('friends', false);
    await wait(page, '#plan', 'textContent', 'plan_account');
    await wait(page, '#friend', 'textContent', 'friend_account');
    await wait(second, '#friend', 'textContent', 'friend_account');
    assert.equal(await page.locator('#user-friend-source-refresh').isDisabled(), true);
    await selectSource('official', false);
    await wait(page, '#high b', 'textContent', 'high_account');
    assert.equal(await page.locator('#other').textContent(), 'other_account');
    const disabled = await context.newPage();
    await disabled.goto('https://jx.7fa4.cn:8888/');
    await disabled.waitForFunction(() => document.querySelector('[data-asterveil="settings"]'));
    assert.equal(await disabled.locator('#friend').textContent(), 'friend_account');
    assert.equal(planRequests.length, 2, 'disabled remote sources must not request on a new page');
    assert.equal(friendRequests.length, 2);
    await selectSource('official', true);
    await wait(disabled, '#high b', 'textContent', names[high]);
    await selectSource('plan', true);
    await wait(page, '#plan', 'textContent', '计划新增同学');
    await wait(disabled, '#plan', 'textContent', '计划新增同学');
    assert.equal(await page.locator('#friend').textContent(), 'friend_account');
    await selectSource('friends', true);
    await wait(page, '#friend', 'textContent', '好友新增同学');
    await wait(disabled, '#friend', 'textContent', '好友新增同学');
    assert.equal(
      planRequests.length,
      2,
      'new pages reuse the account session instead of requesting plan data again',
    );
    assert.equal(
      friendRequests.length,
      2,
      'new pages reuse the account session instead of requesting friend data again',
    );
    await disabled.close();
    await page.locator('.name-palette').getByText('自定义', { exact: true }).click();
    assert.equal(await page.locator('#user-grade-c1').inputValue(), '#ff4d4f');
    assert.equal(await page.locator('#user-grade-g1').inputValue(), '#96cc00');
    const hex = page.getByRole('textbox', { name: '高2026级十六进制颜色', exact: true });
    const navigation = await page.evaluate(() => performance.timeOrigin);
    await hex.fill('#445566');
    await wait(page, '#high', 'color', 'rgb(68, 85, 102)');
    await wait(second, '#high', 'color', 'rgb(68, 85, 102)');
    assert.equal(await hex.isEnabled(), true);
    assert.equal((await state()).userNames.palette.colors.g1, '#445566');
    await hex.fill('#12');
    await page.waitForTimeout(180);
    assert.equal(await hex.inputValue(), '#12');
    assert.equal((await state()).userNames.palette.colors.g1, '#445566');
    assert.equal(await hex.getAttribute('aria-invalid'), null);
    await page.locator('#user-grade-g1').focus();
    await page.locator('#user-grade-g1').evaluate((input) => {
      for (const color of ['#102030', '#aabbcc', '#667788']) {
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (input.disabled) throw new Error('continuous color editing must stay enabled');
      }
    });
    await wait(page, '#high', 'color', 'rgb(102, 119, 136)');
    await wait(second, '#high', 'color', 'rgb(102, 119, 136)');
    assert.equal((await state()).userNames.palette.colors.g1, '#667788');
    assert.equal(
      await page.evaluate(() => performance.timeOrigin),
      navigation,
      'color edits must not reload the page',
    );
    await hex.fill('#224466');
    await hex.press('Enter');
    await wait(page, '#high', 'color', 'rgb(34, 68, 102)');
    await wait(second, '#high', 'color', 'rgb(34, 68, 102)');
    assert.equal(await color(page, '#other'), originalOther);
    assert.equal((await state()).userNames.palette.colors.g1, '#224466');
    const beforeInvalid = await state();
    await hex.fill('#gggggg');
    await hex.press('Enter');
    assert.equal(await hex.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#user-grade-status').isVisible(), true);
    assert.deepEqual(await state(), beforeInvalid);
    await hex.fill('#224466');
    await hex.press('Enter');
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-asterveil="settings"]')
          .shadowRoot.querySelector('[name="user-grade-palette-mode"]').disabled,
    );
    await page.locator('.name-palette').getByText('默认', { exact: true }).click();
    await wait(page, '#high', 'color', originalHigh);
    await page.locator('.name-palette').getByText('自定义', { exact: true }).click();
    await wait(page, '#high', 'color', 'rgb(34, 68, 102)');
    await page.locator('#user-grade-g1').fill('#112233');
    await wait(page, '#high', 'color', 'rgb(17, 34, 51)');

    await upload(
      '含年级.json',
      JSON.stringify({
        [high]: names[high],
        900000001: { name: '示例自定义', colorKey: 'g1' },
        900000002: { name: '保留原色', colorKey: 'clear' },
      }),
    );
    await wait(page, '#custom', 'textContent', '示例自定义');
    await wait(page, '#custom', 'color', 'rgb(17, 34, 51)');
    await wait(page, '#clear', 'textContent', '保留原色');
    assert.equal(await page.locator('#clear').evaluate((node) => node.style.color), 'purple');
    const localSource = (await state()).userNames.sources[0].id;
    await selectSource(localSource, false);
    await wait(page, '#custom', 'textContent', '计划名单同学');
    await wait(page, '#clear', 'textContent', 'clear_account');
    await upload('关闭源也校验.json', '{"900000001":"冲突姓名"}');
    assert.match(await page.locator('#user-name-source-status').textContent(), /冲突/);
    assert.equal((await state()).userNames.sources[0].enabled, false);
    await selectSource(localSource, true);
    await wait(page, '#custom', 'textContent', '示例自定义');
    await upload(
      '配色核对.json',
      JSON.stringify(
        Object.fromEntries(
          gradeKeys.map((key, index) => [900001000 + index, { name: `示例${key}`, grade: key }]),
        ),
      ),
    );
    await wait(page, '#grade-x4', 'textContent', '示例x4');
    await assertSavedColors();
    const palettePlanRequests = planRequests.length;
    const customColors = (await state()).userNames.palette.colors;
    await page.locator('.name-palette').getByText('经典', { exact: true }).click();
    await wait(page, '#high', 'color', rgb(classicColors.g1));
    await wait(second, '#high', 'color', rgb(classicColors.g1));
    assert.equal((await state()).userNames.palette.mode, 'classic');
    assert.deepEqual((await state()).userNames.palette.colors, customColors);
    for (const [key, value] of Object.entries(classicColors)) {
      await wait(page, `#grade-${key}`, 'color', rgb(value));
      assert.equal(await page.locator(`#user-grade-${key}`).inputValue(), value);
      assert.equal(await page.locator(`#user-grade-${key}`).isDisabled(), true);
    }
    await assertSavedColors();
    assert.equal(await page.locator('#clear').evaluate((node) => node.style.color), 'purple');
    assert.equal(planRequests.length, palettePlanRequests);
    await page.reload();
    await wait(page, '#high', 'color', rgb(classicColors.g1));
    await open(page);
    assert.equal(await page.getByRole('radio', { name: '经典', exact: true }).isChecked(), true);
    for (const [scheme, width, height] of [
      ['light', 1440, 900],
      ['dark', 390, 844],
      ['light', 320, 568],
    ]) {
      await mode(scheme);
      await waitScheme(scheme);
      await page.setViewportSize({ width, height });
      await assertSavedColors();
      for (const selector of ['.page-view', '.name-palette', '.name-palette-actions .mode-options'])
        assert.equal(
          await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth),
          true,
          `${selector}: classic palette must fit at ${width}px`,
        );
      const segments = await page
        .locator('.name-palette-actions .mode-options label')
        .evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().top));
      assert.equal(new Set(segments).size, 1, 'all three palette modes stay on one row');
      await page.mouse.move(1, 1);
      await page
        .locator('.name-palette')
        .screenshot({ path: resolve(out, `${product}-classic-${scheme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.name-palette').getByText('自定义', { exact: true }).click();
    await wait(page, '#high', 'color', 'rgb(17, 34, 51)');
    await wait(second, '#high', 'color', 'rgb(17, 34, 51)');
    assert.deepEqual((await state()).userNames.palette.colors, customColors);
    for (const [name, text] of [
      [
        '官方年级冲突.json',
        JSON.stringify({ [high]: { name: names[high], grade: 'g2' }, 900000003: '不能写入' }),
      ],
      [
        '自定义年级冲突.json',
        '{"900000001":{"name":"示例自定义","grade":"c1"},"900000003":"不能写入"}',
      ],
      [
        '重复年级冲突.json',
        '{"900000003":{"name":"甲","grade":"c1"},"900000003":{"name":"甲","grade":"g1"}}',
      ],
    ]) {
      const before = await state();
      await upload(name, text);
      assert.match(await page.locator('#user-name-source-status').textContent(), /年级/);
      assert.deepEqual(await state(), before);
      assert.equal(await page.locator('#partial').textContent(), 'partial_account');
    }

    const refreshPlan = async (status) => {
      planStatus = status;
      await page.getByRole('button', { name: '刷新 Better Names 计划数据', exact: true }).click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#better-names-source-refresh').disabled,
      );
    };
    assert.equal(
      planRequests.length,
      palettePlanRequests,
      'reloads and palette edits must reuse the account session cache',
    );
    await refreshPlan(500);
    assert.match(await page.locator('#better-names-source-status').textContent(), /暂时无法更新/);
    assert.equal(await page.locator('#plan').textContent(), '计划新增同学');
    await refreshPlan(403);
    await wait(page, '#plan', 'textContent', '好友中的计划同学');
    assert.match(await page.locator('#plan').getAttribute('title'), /高2024级/);
    assert.match(await page.locator('#better-names-source-status').textContent(), /暂无访问权限/);
    assert.equal(await page.locator('#custom').textContent(), '示例自定义');
    assert.equal(await page.locator('#coach').textContent(), names['1']);
    planUsers[3].real_name = '计划更新同学';
    planUsers[3].graduate_year = 2029;
    await refreshPlan(200);
    await wait(page, '#plan', 'textContent', '计划更新同学');
    assert.match(await page.locator('#plan').getAttribute('title'), /高2026级/);
    assert.equal(await page.locator('#better-names-source-status').isVisible(), false);
    const refreshFriends = async (status) => {
      friendStatus = status;
      await page.getByRole('button', { name: '刷新我的好友数据', exact: true }).click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#user-friend-source-refresh').disabled,
      );
    };
    await refreshFriends(500);
    assert.match(await page.locator('#user-friend-source-status').textContent(), /暂时无法更新/);
    assert.equal(await page.locator('#friend').textContent(), '好友新增同学');
    await refreshFriends(403);
    await wait(page, '#friend', 'textContent', 'friend_account');
    assert.match(await page.locator('#user-friend-source-status').textContent(), /暂无访问权限/);
    assert.equal(await page.locator('#plan').textContent(), '计划更新同学');
    await refreshFriends(200);
    await wait(page, '#friend', 'textContent', '好友新增同学');
    const saved = JSON.stringify(await state());
    for (const privateValue of ['计划更新同学', 'private-phone', 'private-email'])
      assert.equal(saved.includes(privateValue), false);

    await mode('dark');
    await waitScheme('dark');
    await assertSavedColors();
    assert.equal(await color(page, '#high'), 'rgb(17, 34, 51)');
    await wait(second, '#high', 'color', 'rgb(17, 34, 51)');
    for (const value of ['#ffffff', '#000000']) {
      await page.locator('#user-grade-g1').fill(value);
      await wait(page, '#high', 'color', rgb(value));
      await assertSavedColors();
    }
    await page.locator('#user-grade-g1').fill('#112233');
    await wait(page, '#high', 'color', 'rgb(17, 34, 51)');
    await page.emulateMedia({ colorScheme: 'light' });
    await mode('system');
    await waitScheme('light');
    await assertSavedColors();
    await wait(page, '#high', 'color', 'rgb(17, 34, 51)');
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitScheme('dark');
    await assertSavedColors();
    assert.equal(await color(page, '#high'), 'rgb(17, 34, 51)');
    await mode('light');
    await waitScheme('light');
    await wait(page, '#high', 'color', 'rgb(17, 34, 51)');
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await wait(page, '#high', 'color', originalHigh);
    await assertSavedColors();
    await page.reload();
    await wait(page, '#custom', 'textContent', '示例自定义');
    await open(page);
    assert.equal(await page.locator('#user-grade-editor').count(), 0);
    for (const [scheme, width, height] of [
      ['light', 1440, 900],
      ['dark', 390, 844],
      ['light', 320, 568],
    ]) {
      await mode(scheme);
      await page.setViewportSize({ width, height });
      await page.waitForFunction(
        (scheme) =>
          getComputedStyle(document.querySelector('[data-asterveil="settings"]'))
            .getPropertyValue('--av-scheme')
            .trim() === scheme,
        scheme,
      );
      assert.equal(
        await page.locator('.page-view').evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      assert.equal(
        await page
          .locator('.name-palette')
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      const option = page.locator('.name-palette').getByText('自定义', { exact: true });
      assert.ok(
        await option.evaluate((node) => node.getBoundingClientRect().height < 40),
        'palette segments stay on one line',
      );
      await page.mouse.move(1, 1);
      await page
        .locator('.settings-dialog')
        .screenshot({ path: resolve(out, `${product}-${scheme}-${width}.png`) });
      await option.click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#user-grade-g1').disabled,
      );
      assert.equal(
        await page
          .locator('.name-palette')
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      await page.mouse.move(1, 1);
      await page
        .locator('.settings-dialog')
        .screenshot({ path: resolve(out, `${product}-custom-${scheme}-${width}.png`) });
      if (width === 1440)
        await page
          .locator('.name-palette')
          .screenshot({ path: resolve(out, `${product}-inline-palette.png`) });
      await page.locator('.name-palette').getByText('默认', { exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-asterveil="settings"]')
            .shadowRoot.querySelector('#user-grade-g1').disabled,
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = document.querySelector('#other').href;
      link.id = 'added';
      link.textContent = 'added_account';
      document.querySelector('main').append(link);
    });
    await wait(page, '#added', 'textContent', names[other]);
    await wait(page, '#added', 'color', originalOther);
    await page.locator('#high').evaluate((node) => node.style.setProperty('color', 'red'));
    await wait(page, '#high', 'color', originalHigh);
    await page.getByRole('switch', { name: 'Better Names', exact: true }).uncheck();
    await wait(page, '#high b', 'textContent', 'high_account');
    await page.waitForFunction(
      () => document.querySelector('#blank-nickname').textContent.trim() === '',
    );
    assert.equal(await page.locator('#blank-nickname img').count(), 1);
    assert.equal(await page.locator('#blank-nickname').getAttribute('title'), null);
    assert.equal(await page.locator('#blank-nickname').getAttribute('style'), null);
    assert.equal(
      await page.locator('#high').evaluate((node) => node.style.color),
      'red',
      'later site changes survive disable',
    );
    assert.equal(await page.locator('#high b').evaluate((node) => node.style.color), 'blue');
    assert.equal(await page.locator('#high').evaluate((node) => node.style.fontWeight), '600');
    assert.equal(await page.locator('#other').getAttribute('style'), null);
    assert.equal(await page.locator('#named').getAttribute('style'), null);
    await page.getByRole('switch', { name: 'Better Names', exact: true }).check();
    await wait(page, '#high', 'color', originalHigh);
    await page.waitForFunction(
      (name) => document.querySelector('#blank-nickname').textContent.trim() === name,
      names['2476'],
    );
    assert.equal(
      await page
        .locator('#blank-nickname')
        .evaluate(
          (link) =>
            [...link.childNodes].filter(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
            ).length,
        ),
      1,
    );
    await page.locator('#high').evaluate((node, id) => (node.href = `/user/${id}`), other);
    await wait(page, '#high b', 'textContent', names[other]);
    await wait(page, '#high', 'color', originalOther);
    assert.match(await page.locator('#high').getAttribute('title'), /高2025级/);
    await worker.evaluate(
      async ({ high, name }) => {
        const key = 'asterveil:settings';
        const current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({
          [key]: {
            ...current,
            revision: current.revision + 1,
            userNames: {
              revision: current.userNames.revision + 1,
              palette: current.userNames.palette,
              sources: [
                {
                  id: crypto.randomUUID(),
                  name: '旧学年名单',
                  entries: [
                    [high, name, 'c3'],
                    ['900000001', '示例自定义', 'x6'],
                    ['900000003', '毕业同学', 'd4'],
                  ],
                },
              ],
            },
          },
        });
      },
      { high, name: names[high] },
    );
    await page.waitForFunction(() => document.querySelector('#custom').title.includes('初2026级'));
    await wait(page, '#partial', 'textContent', '毕业同学');
    assert.match(await page.locator('#partial').getAttribute('title'), /毕业/);
    assert.match(await page.locator('#named').getAttribute('title'), /高2026级/);
    await page.locator('.name-palette').getByText('自定义', { exact: true }).click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-asterveil="settings"]')
          .shadowRoot.querySelector('[name="user-grade-palette-mode"]').disabled,
    );
    const migrated = (await state()).userNames;
    assert.equal(migrated.academicYear, 2026);
    assert.deepEqual(migrated.sources[0].entries, [
      [high, names[high], 'g1'],
      ['900000001', '示例自定义', 'c1'],
      ['900000003', '毕业同学', 'by'],
    ]);
    const archive = JSON.stringify({
      academicYear: 2025,
      users: {
        900000001: { name: '示例自定义', colorKey: 'x6' },
        900000009: { name: '升大学同学', colorKey: 'g3' },
      },
    });
    await upload('2025 年备份.json', archive);
    await wait(page, '#unknown', 'textContent', '升大学同学');
    assert.match(await page.locator('#unknown').getAttribute('title'), /大2026级/);
    const imported = await state();
    await upload('2025 年备份.json', archive);
    assert.deepEqual(await state(), imported);
    await page.reload();
    await wait(page, '#custom', 'textContent', '示例自定义');
    assert.match(await page.locator('#custom').getAttribute('title'), /初2026级/);
    assert.match(await page.locator('#unknown').getAttribute('title'), /大2026级/);
    await open(page);
    await wait(page, '#plan', 'textContent', '计划更新同学');
    const sameAccount = await context.newPage();
    await sameAccount.goto('https://jx.7fa4.cn:8888/');
    await wait(sameAccount, '#plan', 'textContent', '计划更新同学');
    await wait(sameAccount, '#friend', 'textContent', '好友新增同学');
    planStatus = 403;
    friendStatus = 403;
    officialStatus = 403;
    await page.locator('#user-dropdown').evaluate((node) => node.setAttribute('data-user_id', '2'));
    await wait(page, '#plan', 'textContent', 'plan_account');
    await wait(page, '#friend', 'textContent', 'friend_account');
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil="settings"]')
        .shadowRoot.querySelector('#better-names-source-status')
        .textContent.includes('暂无访问权限'),
    );
    assert.equal(await page.locator('#custom').textContent(), '示例自定义');
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil="settings"]')
        .shadowRoot.querySelector('#user-official-source-status')
        .textContent.includes('暂无访问权限'),
    );
    assert.equal((await page.locator('#blank-nickname').textContent()).trim(), '');
    await wait(sameAccount, '#plan', 'textContent', 'plan_account');
    await wait(sameAccount, '#friend', 'textContent', 'friend_account');
    await sameAccount.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await sameAccount.waitForTimeout(80);
    assert.equal(await sameAccount.locator('#plan').textContent(), 'plan_account');
    assert.equal((await sameAccount.locator('#blank-nickname').textContent()).trim(), '');
    await sameAccount.close();
    planUsers[3].real_name = '新账号计划同学';
    planStatus = 200;
    friendStatus = 200;
    officialStatus = 200;
    signature = 'wrong-fixture-password';
    await page.locator('#user-dropdown').evaluate((node) => node.setAttribute('data-user_id', '3'));
    await wait(page, '#plan', 'textContent', '新账号计划同学');
    await wait(page, '#friend', 'textContent', '新账号好友同学');
    assert.match(friendRequests.at(-1).url, /\/user\/3\/friend$/);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil="settings"]')
        .shadowRoot.querySelector('#user-official-source-status')
        .textContent.includes('官方数据无法解锁'),
    );
    assert.equal((await page.locator('#blank-nickname').textContent()).trim(), '');
    signature = null;
    await page.locator('#user-official-source-refresh').click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-asterveil="settings"]')
        .shadowRoot.querySelector('#user-official-source-status')
        .textContent.includes('请先登录'),
    );
    signature = `${fixturePassword}</div><div>新增一段说明，不参与解密。`;
    await page.locator('#user-official-source-refresh').click();
    await page.waitForFunction(
      (name) => document.querySelector('#blank-nickname')?.textContent.trim() === name,
      names['2476'],
    );
    assert.equal(JSON.stringify(await state()).includes(fixturePassword), false);
    assert.equal(JSON.stringify(await state()).includes('private-'), false);
    await page
      .locator('.name-sources')
      .screenshot({ path: resolve(out, `${product}-plan-sources.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.locator('.name-sources').evaluate((node) => node.scrollWidth <= node.clientWidth),
      true,
    );
    await page
      .locator('.name-sources')
      .screenshot({ path: resolve(out, `${product}-plan-sources-390.png`) });
    await second.close();
    assert.deepEqual(errors, []);
    console.log(
      `${product}: local priority, plan supplements, graduate-year grades, refresh recovery, permission loss, account isolation, palette editing, imports, grade migration and responsive layouts passed.`,
    );
  } finally {
    await context.close();
  }
}
