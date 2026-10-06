---
title: 赞助
description: 通过微信或支付宝赞助本分支的维护。
---

<script setup>
import { useData } from "vitepress";

// 收款码放在 `docs/public/sponsor/`，由站点的公共目录直接提供，
// 因此路径要带上配置的 base。绑定写法（`:src`）不会被资源转换处理：
// 图片缺失时只会显示破图，不会让构建失败。
const { site } = useData();
const qr = (file) => `${site.value.base}sponsor/${file}`;
</script>

# 赞助本分支

<!-- 收款码图片放在 docs/public/sponsor/ 目录，对应
     /sponsor/wechat.png 与 /sponsor/alipay.png。 -->

Headplane 是自由开源软件，以后也一直是。如果这个分支帮你省了时间，欢迎用微信或支付宝
请作者喝杯咖啡——扫你常用的那个就行。

## 微信

<img :src="qr('wechat.png')" alt="微信收款码" width="240">

## 支付宝

<img :src="qr('alipay.png')" alt="支付宝收款码" width="240">

**赞助完全自愿，也不会改变软件的任何行为。** 无论是否赞助，功能对所有用户都一样：
没有任何功能需要赞助才能使用，技术支持也不因赞助而分先后，Headplane 的行为更不取决于
有没有人赞助。

谢谢，这份心意是实实在在的。

---

本项目基于上游 [Headplane](https://github.com/tale/headplane)（作者
[tale](https://github.com/tale)）。这里的赞助用于本分支的维护，而不是上游；
如果想支持上游，请使用导航栏里的赞助链接。
