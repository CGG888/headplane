import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { unstable_useRoute as useRoute } from "react-router";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
import { useI18n } from "~/i18n/provider";
import {
  browserAddressStorage,
  canRevealAddresses,
  DEFAULT_ADDRESS_VISIBILITY,
  isAddressMasked,
  readHiddenAddresses,
  toggleRevealedAddress,
  withAddressesHidden,
  withAllAddressesRevealed,
  writeHiddenAddresses,
  type AddressVisibilityState,
} from "~/utils/address-visibility";
import cn from "~/utils/cn";

/**
 * The address masking store.
 *
 * Masking is presentation only: no loader reads this, so nothing about what a
 * page fetches changes when an address is revealed. The remembered preference
 * lives in `localStorage`, scoped to the signed-in person and to this build by
 * {@link ~/utils/address-visibility}, and is read after mount so the server
 * render and the first client render both agree on "everything hidden".
 *
 * The store is bound by whoever renders a masked value (or the preference
 * menu): the app layout already reports the identity the header shows, so a
 * component can read it without the page threading a prop through. Binding is
 * per identity, so switching accounts re-reads that account's choice.
 */

let state: AddressVisibilityState = DEFAULT_ADDRESS_VISIBILITY;
let boundUserKey: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AddressVisibilityState {
  return state;
}

function getServerSnapshot(): AddressVisibilityState {
  return DEFAULT_ADDRESS_VISIBILITY;
}

/**
 * Applies one identity's stored choice. The first render of a page always shows
 * the masked default; this runs after mount and only for an identity the store
 * has not read yet, so a value revealed by the reader is not re-hidden when
 * another masked value mounts beside it.
 */
function bindAddressVisibility(userKey: string): void {
  if (boundUserKey === userKey) {
    return;
  }

  boundUserKey = userKey;
  state = withAddressesHidden(state, readHiddenAddresses(browserAddressStorage(), userKey));
  emit();
}

/** The identity the app layout reports, or "" outside the signed-in layout. */
function useAddressVisibilityUserKey(): string {
  const layout = useRoute("layout/app");
  return layout?.loaderData?.user.subject ?? "";
}

/**
 * Binds the current identity's stored choice to the store. Rendering a masked
 * value already does this; a preference control calls it so the store is bound
 * even on a page whose values are all absent.
 */
export function useAddressVisibilityScope(): void {
  const userKey = useAddressVisibilityUserKey();

  useEffect(() => {
    bindAddressVisibility(userKey);
  }, [userKey]);
}

/** The whole masking state, for the preference controls. */
export function useAddressVisibility(): AddressVisibilityState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useAddressVisibilityScope();
  return snapshot;
}

export interface AddressMask {
  /** True while this value must render as the fixed mask. */
  masked: boolean;
  /** True while a reveal badge makes sense for this value. */
  canReveal: boolean;
  /** Reveals or re-hides this one value. */
  toggle: () => void;
}

/**
 * How one value renders right now. Every value is hidden unless the reader
 * turned masking off, asked for "show all", or revealed this very value.
 */
export function useAddressMask(value: string): AddressMask {
  useAddressVisibilityScope();
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => setAddressValueRevealed(value), [value]);

  return {
    masked: isAddressMasked(current, value),
    canReveal: canRevealAddresses(current),
    toggle,
  };
}

/** The remembered preference: on writes the choice, off just shows everything. */
export function setAddressesHidden(hidden: boolean): void {
  if (boundUserKey !== undefined) {
    writeHiddenAddresses(browserAddressStorage(), boundUserKey, hidden);
  }

  state = withAddressesHidden(state, hidden);
  emit();
}

/** "Show all" / "Hide all", which never changes the remembered preference. */
export function toggleAllAddresses(): void {
  state = withAllAddressesRevealed(state, !state.revealAll);
  emit();
}

/** Reveals or re-hides one value, keeping the others as they are. */
function setAddressValueRevealed(value: string): void {
  state = toggleRevealedAddress(state, value);
  emit();
}

/**
 * The address visibility menu: one control on a page header that turns the
 * hidden-by-default preference off, and one that shows everything at once (and
 * puts it back). It is a menu, not a form, so it can sit in any header.
 */
export function AddressVisibilityMenu() {
  const { t } = useI18n();
  const { hidden, revealAll } = useAddressVisibility();
  const masked = hidden && !revealAll;
  const label = t("address.menu");

  return (
    <Menu>
      <MenuTrigger
        aria-label={label}
        className={cn(
          "inline-flex w-fit items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
          "border border-mist-200 bg-white font-medium text-mist-700",
          "transition-colors duration-100 hover:bg-mist-50",
          "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
          "dark:border-mist-700 dark:bg-mist-800/50 dark:text-mist-200 dark:hover:bg-mist-700/50",
          "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
        )}
      >
        {masked ? (
          <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {label}
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-mist-400 dark:text-mist-500"
        />
      </MenuTrigger>
      <MenuContent align="end" className="w-72 py-2">
        <p className="px-3 pb-1 text-xs text-mist-500 dark:text-mist-400">
          {t("address.menuBody")}
        </p>
        <MenuItem
          className="flex items-center gap-x-2 text-sm"
          onClick={() => setAddressesHidden(!hidden)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {hidden ? (
              <Check aria-hidden="true" className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            ) : undefined}
          </span>
          {t("address.hideByDefault")}
        </MenuItem>
        <MenuItem
          className="flex items-center gap-x-2 text-sm"
          disabled={!hidden}
          onClick={toggleAllAddresses}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {revealAll ? (
              <EyeOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Eye aria-hidden="true" className="h-4 w-4" />
            )}
          </span>
          {revealAll ? t("address.hideAll") : t("address.showAll")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
