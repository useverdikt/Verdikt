import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "../queries/queryClient.js";

export function AppQueryProvider({ children }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
}
