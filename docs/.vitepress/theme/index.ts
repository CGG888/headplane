import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";

// The theme lives inside the repository, so the version footer reads the real
// `package.json` at build time instead of hard-coding a version string.
import packageJson from "../../../package.json";
import "./custom.css";
import VersionFooter from "./VersionFooter.vue";

const beta = __HEADPLANE_BETA_DOCS__ ?? false;
const version = packageJson.version;

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-top": () =>
        beta
          ? h(
              "div",
              {
                class: "beta-banner",
              },
              [
                "You are currently viewing the ",
                h("strong", "beta"),
                " documentation for HeadplaneCN. ",
                h(
                  "a",
                  {
                    href: "https://cgg888.github.io/headplaneCN/",
                  },
                  "Go to the stable docs →",
                ),
              ],
            )
          : null,
      // Rendered into `layout-bottom`, i.e. after the page content of every
      // page and therefore at the bottom of both homepages.
      "layout-bottom": () => h(VersionFooter, { version }),
    });
  },
} satisfies Theme;
