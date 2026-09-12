import { queryOptions } from "@tanstack/react-query";

import { getSite, getSites } from "@/lib/sites";

export function sitesQueryOptions() {
  return queryOptions({
    queryKey: ["sites"],
    queryFn: ({ signal }) => getSites(signal),
  });
}

export function siteQueryOptions(siteId: string) {
  return queryOptions({
    queryKey: ["site", siteId],
    queryFn: ({ signal }) => getSite(siteId, signal),
  });
}
