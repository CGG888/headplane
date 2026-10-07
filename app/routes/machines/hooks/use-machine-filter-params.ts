import { useSearchParams } from "react-router";

export interface MachineFilterParams {
  filterUser: string | null;
  filterTag: string | null;
  filterStatus: "online" | "offline" | "expired" | null;
  filterRoute: "exit-node" | "subnet" | null;
  hasActiveFilters: boolean;
  setParam: (key: string, value: string | null) => void;
  clearFilters: () => void;
}

const FILTER_STATUSES = ["online", "offline", "expired"] as const;
const FILTER_ROUTES = ["exit-node", "subnet"] as const;

/**
 * `?status=x` used to be asserted into the filter type and then handed to the
 * machine list, where an unknown value reached `String.prototype` lookups
 * (`?status=constructor`) or threw while formatting. Anything that is not one
 * of the known values is treated as "no filter".
 */
export function parseStatus(raw: string | null): MachineFilterParams["filterStatus"] {
  return FILTER_STATUSES.find((value) => value === raw) ?? null;
}

export function parseRoute(raw: string | null): MachineFilterParams["filterRoute"] {
  return FILTER_ROUTES.find((value) => value === raw) ?? null;
}

export function useMachineFilterParams(): MachineFilterParams {
  const [searchParams, setSearchParams] = useSearchParams();

  const filterUser = searchParams.get("user");
  const filterTag = searchParams.get("tag");
  const filterStatus = parseStatus(searchParams.get("status"));
  const filterRoute = parseRoute(searchParams.get("route"));

  const hasActiveFilters =
    filterUser !== null || filterTag !== null || filterStatus !== null || filterRoute !== null;

  const setParam = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      const q = prev.get("q");
      if (q) next.set("q", q);
      return next;
    });
  };

  return {
    filterUser,
    filterTag,
    filterStatus,
    filterRoute,
    hasActiveFilters,
    setParam,
    clearFilters,
  };
}
