---
title: Sponsor
description: Support the upkeep of this Headplane fork with a WeChat or Alipay donation.
---

<script setup>
import { useData } from "vitepress";

// The QR codes live in `docs/public/sponsor/` and are served from the site's
// public directory, so the path has to carry the configured base. A bound `:src`
// is left alone by the asset transform: a missing image shows a broken image
// instead of failing the build.
const { site } = useData();
const qr = (file) => `${site.value.base}sponsor/${file}`;
</script>

# Sponsor this fork

<!-- The QR images live in docs/public/sponsor/ and are served as
     /sponsor/wechat.png and /sponsor/alipay.png. -->

Headplane is free and open-source software, and it stays that way. If this fork
has been useful to you and you would like to support its upkeep, you can send a
donation over WeChat or Alipay — scan whichever one you use.

## WeChat

<img :src="qr('wechat.png')" alt="WeChat donation QR code" width="240">

## Alipay

<img :src="qr('alipay.png')" alt="Alipay donation QR code" width="240">

**Sponsoring is entirely voluntary, and it changes nothing about the software.**
Every feature is available to everyone either way: nothing is gated behind a
donation, no support is prioritised by it, and no behaviour of Headplane depends
on whether anyone has donated.

Thank you — it really is appreciated.

---

This fork is based on the upstream [Headplane](https://github.com/tale/headplane)
project by [tale](https://github.com/tale), and donations here support the upkeep
of this fork rather than upstream. To support upstream, use the sponsor links in
the site navigation.
