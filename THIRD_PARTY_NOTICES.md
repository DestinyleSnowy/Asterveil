# 第三方来源

## Better Names for 7FA4

“关于”中的售后群信息、Better Names 计划说明与加入状态接口参考
[Better Names for 7FA4](https://github.com/DestinyleSnowy/Better-Names-for-7FA4)。
Better Names 功能使用上游扩展包中的 `data/users.json` 与 `data/special_users.json`，保留用户 ID、
姓名与年级代码，数据位于 `src/data/user-names.json` 和 `src/data/user-grades.json`；来源提交与记录数见
`src/data/user-names.source.json`。年级分类沿用上游面板定义，默认配色由项目定制，年级记录及标签维护到 2026 学年。
运行时接入当前 7FA4 站点的 `/better_names` 和当前账号的 `/user/用户ID/friend` 作为可独立关闭的补充源，仅使用用户 ID、姓名和用于推算年级的高中毕业年份或班级；
本地数据库中的特殊人员处理优先保留，计划名单不随扩展发布。
微信赞赏码 `src/ui/settings/donate.jpg` 原样取自该项目的 `content/panel/donate.jpg`。
上游采用 MIT 许可证，Copyright (c) 2025-2026 鱼oe不缺氧；完整许可随扩展保留在
`licenses/better-names/LICENSE`。

## 7FA4 submitter 0.1.13

提交器的站点适配与请求字段基于用户提供的 `submitter-main (1).zip`。
上游项目：https://jx.7fa4.cn:9080/tools/submitter
原界面署名：© 7FA4。

Asterveil 将适配逻辑移植为 TypeScript / 原生 DOM，重新组织弹窗与后台通信，
使用浏览器会话替代复制 Cookie，并增加来源、字段校验与错误处理。
未引入包内的 jQuery、jquery.cookie 或远端版本检查脚本。

## Markdown Editor / Markdown Editor Pro

- [Marked](https://github.com/markedjs/marked)：Markdown 解析，MIT。
- [DOMPurify](https://github.com/cure53/DOMPurify)：HTML / MathML 清理，Apache-2.0 或 MPL-2.0；本项目按 Apache-2.0 使用。
- [KaTeX](https://github.com/KaTeX/KaTeX)：数学公式 HTML / MathML 排版与配套数学字体，MIT。
- [html-to-image](https://github.com/bubkoo/html-to-image)：DOM 转 PNG，MIT。
- [pdf-lib](https://github.com/Hopding/pdf-lib)：Pro 的 PDF 导出，MIT。
- [PDF.js](https://github.com/mozilla/pdf.js)：Pro 的 PDF 页面渲染，Apache-2.0。

精确版本见 `package-lock.json`。各版本实际打包的库及相关依赖许可复制到构建产物 `licenses/`；full 中 PDF.js 的字体、CMap、图像解码组件保留各自目录下的许可证，light 不包含 PDF 库与资源。全部由本地依赖打包，不从 CDN 加载可执行代码。
