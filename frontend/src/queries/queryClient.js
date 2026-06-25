import { QueryClient } from "@tanstack/react-query";

/** Shared QueryClient — stale-while-revalidate aligned with workspaceResourceCache TTL. */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false
      }
    }
  });
}

export const appQueryClient = createAppQueryClient();
