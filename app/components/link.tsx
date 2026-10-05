import { ExternalLink } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import cn from "~/utils/cn";

export type LinkProps =
  | {
      external: true;
      to: string;
      children: ReactNode;
      className?: string;
      styled?: boolean;
    }
  | {
      external?: false;
      to: string;
      children?: ReactNode;
      className?: string;
    };

export default function Link(props: LinkProps): JSX.Element {
  if (props.external) {
    return (
      <a
        href={props.to}
        target="_blank"
        rel="noreferrer"
        className={cn(
          props.styled && [
            "inline-flex items-center gap-x-0.5",
            "text-blue-500 hover:text-blue-700",
            "dark:text-blue-400 dark:hover:text-blue-300",
          ],
          props.className,
        )}
      >
        {props.children}
        {props.styled && <ExternalLink className="w-3.5" />}
      </a>
    );
  }

  // Deliberately no `prefetch`: an internal link never starts a page prefetch
  // for its target.
  //
  // `prefetch="intent"` made a plain hover over any of these links - the
  // machines list rows included - import the target route's whole module in the
  // browser and fetch its loaders. Route modules are shared by both
  // environments, and the browser import evaluates the *unstripped* module: it
  // reaches Node-only code through the loader imports (`~/utils/log` reads
  // `process.env` at module scope), which throws `ReferenceError: process is not
  // defined`. React Router answers a failed route-module import with
  // `window.location.reload()` ("Error loading route module ..., reloading
  // page..."), so hovering a machine name reloaded the whole list and wiped the
  // console error that explained it, once per hover - a failed import is never
  // cached.
  //
  // The relay cards no longer leak that server code into their client graph
  // (see `routes/machines/relay-verdicts.ts`), but prefetching stays off: it
  // runs another page's loaders for a hover, and any route module that grows a
  // Node-only import would turn a hover back into a reload.
  return (
    <RouterLink to={props.to} className={props.className}>
      {props.children}
    </RouterLink>
  );
}
