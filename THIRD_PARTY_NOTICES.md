# 第三方来源

## 7FA4 submitter 0.1.13

提交器的站点适配与请求字段基于用户提供的 `submitter-main (1).zip`。
上游项目：https://jx.7fa4.cn:9080/tools/submitter
原界面署名：© 7FA4。

Asterveil 将适配逻辑移植为 TypeScript / 原生 DOM，重新组织弹窗与后台通信，
使用浏览器会话替代复制 Cookie，并增加来源、字段校验与错误处理。
未引入包内的 jQuery、jquery.cookie 或远端版本检查脚本。

## H 题编辑器

- [Marked](https://github.com/markedjs/marked)：Markdown 解析，MIT。
- [DOMPurify](https://github.com/cure53/DOMPurify)：HTML / MathML 清理，Apache-2.0 或 MPL-2.0；本项目按 Apache-2.0 使用。
- [KaTeX](https://github.com/KaTeX/KaTeX)：数学公式 HTML / MathML 排版与配套数学字体，MIT。
- [html-to-image](https://github.com/bubkoo/html-to-image)：DOM 转 PNG，MIT。
- [pdf-lib](https://github.com/Hopding/pdf-lib)：PDF 导出，MIT。
- [PDF.js](https://github.com/mozilla/pdf.js)：PDF 页面渲染，Apache-2.0。

精确版本见 `package-lock.json`。这些库及打包的相关依赖许可复制到构建产物 `licenses/`；PDF.js 的字体、CMap、图像解码组件保留各自目录下的许可证。全部由本地依赖打包，不从 CDN 加载可执行代码。
