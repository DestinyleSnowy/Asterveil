# Asterveil

面向 7FA4 的模块化浏览器扩展。当前完成基础框架，已查看目标网站的首页和习题页；本阶段提供模块运行时、设置面板及键盘焦点示范模块，后续按功能逐步扩展。

公开仓库：[DestinyleSnowy/Asterveil](https://github.com/DestinyleSnowy/Asterveil)。

配置支持 `https://jx.7fa4.cn:8888/` 与 `https://in.7fa4.cn:8888/`，两个入口共用本地设置。外网入口已成功访问；内网入口当前返回 `ERR_CONNECTION_CLOSED`，实际内网运行仍待验证。浏览器以 Chrome / Edge 120+ 的 Manifest V3 为当前目标；尚未验证 Firefox。

## 开发与加载

需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
```

开发模式由 WXT 管理。构建正式产物：

```sh
npm run check
npm run build
npm run zip
```

在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 中开启开发者模式，选择“加载已解压的扩展程序”，加载 `.output/chrome-mv3`。安装后刷新已打开的目标网站页面。`npm run zip` 生成用于分发的 ZIP，不会发布到商店。

点击工具栏图标打开控制面板。总开关保留各模块偏好；“键盘焦点”默认关闭，开启后可用 Tab 键检查轮廓，关闭后会移除对应样式。这是一个独立的基础功能，也用于展示模块接入方式。

## 目录

```text
src/
  entrypoints/     扩展入口：后台、内容脚本、弹出面板
  core/            模块契约、运行时、资源生命周期
  features/        功能模块与注册表
  site/            双入口配置及站点适配边界
  shared/          设置模型、模块元数据、消息协议
  platform/        浏览器存储和消息适配
  background/      后台应用服务，统一处理设置写入
docs/
  architecture.md 选型比较、设计约束与服务接入路线
```

## 添加模块

1. 在 `src/shared/catalog.ts` 添加 ID、标题、描述和默认开关。
2. 在 `src/features/<name>/index.ts` 实现 `FeatureModule`。
3. 在 `src/features/registry.ts` 注册路径匹配器与加载函数；设置面板自动生成开关。
4. 将站点专用的选择器和页面识别放入 `src/site/`，基于实际 DOM 编写，不依赖猜测。

模块必须为创建的资源注册清理，并在异步任务中使用 `scope.signal`。例如：

```ts
import type { FeatureModule } from '../../core/module';

export default {
  mount({ scope }) {
    const node = document.createElement('aside');
    scope.defer(() => node.remove());
    document.body.append(node);
    node.addEventListener('click', () => {}, { signal: scope.signal });
  },
} satisfies FeatureModule;
```

新增模块不需要修改运行时或后台。需要修改网页原有属性时，应保存旧值并在清理时恢复。新增复杂浮层应使用 Shadow DOM 隔离；不要对整站应用 CSS reset。

## 权限与数据

正式构建只声明 `storage` 权限，内容脚本匹配两个精确主机名，并在运行时检查 HTTPS 和 8888 端口。不读取 Cookie，不发送网络请求，不接入服务器，不加载远程代码。所有设置在 `browser.storage.local` 中保存；卸载扩展会删除这些设置。

`package.json` 的 `private: true` 用于防止意外发布 npm 包，与 GitHub 仓库公开性无关。

类型检查与生产构建已通过。自动化浏览器禁止访问扩展管理页，尚未完成加载后的端到端验收；请按上面的加载步骤检查面板开关及键盘焦点效果。

验证记录见 [架构文档](docs/architecture.md)。按项目要求，不长期保留临时测试脚本或测试依赖；类型检查、格式检查与构建命令保留，便于后续维护。
