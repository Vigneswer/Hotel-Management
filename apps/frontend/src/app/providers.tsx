import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 }, mutations: { retry: false } } });
export function AppProviders() { return <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>; }
