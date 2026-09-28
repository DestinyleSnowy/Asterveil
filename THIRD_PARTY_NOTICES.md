# 第三方来源

## 7FA4 submitter 0.1.13

提交器的站点适配与请求字段基于用户提供的 `submitter-main (1).zip`。
上游项目：https://jx.7fa4.cn:9080/tools/submitter
原界面署名：© 7FA4。

Asterveil 将适配逻辑移植为 TypeScript / 原生 DOM，重新组织弹窗与后台通信，
使用浏览器会话替代复制 Cookie，并增加来源、字段校验与错误处理。
未引入包内的 jQuery、jquery.cookie 或远端版本检查脚本。
