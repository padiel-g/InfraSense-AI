"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { login as apiLogin, register as apiRegister, fetchMe, logoutApi } from "./api";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (data: { email: string; password: string; full_name?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

function getHttpStatus(error: unknown) {
  return (error as { response?: { status?: number } })?.response?.status;
}

function isAuthFailure(error: unknown) {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: try to rehydrate session from HttpOnly cookie via /api/auth/me
  useEffect(() => {
    let cancelled = false;

    fetchMe()
      .then((u: User) => {
        if (!cancelled) setUser(u);
      })
      .catch((err) => {
        if (!cancelled && isAuthFailure(err)) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleAuthLost() {
      setUser(null);
      setIsLoading(false);
    }

    window.addEventListener("imads:auth-lost", handleAuthLost);
    return () => window.removeEventListener("imads:auth-lost", handleAuthLost);
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      // Backend sets HttpOnly access_token + refresh_token cookies on success
      await apiLogin(email, password, rememberMe);
      const me: User = await fetchMe();
      setUser(me);
    },
    []
  );

  const register = useCallback(
    async (data: { email: string; password: string; full_name?: string }) => {
      const result: { user: User } = await apiRegister(data);
      setUser(result.user);
    },
    []
  );

  const logout = useCallback(async () => {
    await logoutApi(); // clears HttpOnly cookies server-side
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
