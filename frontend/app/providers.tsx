"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import { AuthProvider } from "@/lib/authContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            gcTime: 300000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            placeholderData: (previousData: unknown) => previousData,
            // Never retry on auth failures — the axios interceptor in lib/api.ts
            // already handles token refresh and notifies AuthProvider on failure.
            // Retrying here would fire the interceptor again on each attempt,
            // causing a refresh → fail → retry → refresh loop.
            retry: (failureCount, error) => {
              const status = (error as { response?: { status?: number } })
                ?.response?.status;
              if (status === 401 || status === 403) return false;
              return failureCount < 2;
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          {children}
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
