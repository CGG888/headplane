<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

/*
 * Site-wide version footer. The version always comes from the repository's
 * `package.json`, injected by `theme/index.ts` at build time, so it can never
 * drift from the released version or the tags cut from it.
 */
const props = defineProps<{ version: string }>();

const { localeIndex } = useData();

const isEnglish = computed(() => localeIndex.value === "en");

// `package.json` holds the bare semver; release tags add the `v` prefix and
// `docker/metadata-action`'s `{{version}}` pattern publishes the bare semver.
const repositoryTag = computed(() => `v${props.version}`);
const containerImage = computed(
  () => `ghcr.io/cgg888/headplanecn:${props.version}`,
);

const links = computed(() =>
  isEnglish.value
    ? [
        { label: "Changelog", link: "/en/CHANGELOG" },
        { label: "Differences", link: "/en/differences" },
        { label: "Sponsor", link: "/en/sponsor" },
      ]
    : [
        { label: "更新日志", link: "/CHANGELOG" },
        { label: "与上游的差异", link: "/differences" },
        { label: "赞助", link: "/sponsor" },
      ],
);
</script>

<template>
  <footer class="version-footer">
    <div class="version-footer-inner">
      <p class="version-footer-title">HeadplaneCN v{{ version }}</p>
      <p class="version-footer-note">
        <template v-if="isEnglish">
          This version matches the repository tag {{ repositoryTag }} and the
          container image tag {{ containerImage }}; changes are listed in the
          changelog.
        </template>
        <template v-else>当前版本与仓库标签 {{ repositoryTag }}、容器镜像标签 {{ containerImage }} 一致；改动记录见更新日志。</template>
      </p>
      <p class="version-footer-links">
        <template v-for="(item, index) in links" :key="item.link">
          <span v-if="index > 0" class="version-footer-sep" aria-hidden="true">·</span>
          <a :href="withBase(item.link)">{{ item.label }}</a>
        </template>
      </p>
      <p class="version-footer-credit">
        <template v-if="isEnglish">
          Based on the upstream
          <a
            href="https://github.com/tale/headplane"
            target="_blank"
            rel="noreferrer"
            >Headplane</a
          >
          project by tale.
        </template>
        <template v-else
          >本项目基于上游
          <a
            href="https://github.com/tale/headplane"
            target="_blank"
            rel="noreferrer"
            >Headplane</a
          >
          项目（作者 tale）构建。</template
        >
      </p>
    </div>
  </footer>
</template>
