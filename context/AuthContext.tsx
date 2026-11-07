import React, {
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

import * as SecureStore from "expo-secure-store";

const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");

type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;

  login: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;

  logout: () => Promise<void>;

  refreshUser: () => Promise<void>;
};

const AuthContext =
  createContext<AuthContextType | null>(null);

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] =
    useState<User | null>(null);

  const [token, setToken] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    loadSession();
  }, []);

  async function loadSession() {
    try {
      const storedToken =
        await SecureStore.getItemAsync(
          "access_token"
        );

      const storedUser =
        await SecureStore.getItemAsync(
          "user"
        );

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.log(
        "Failed to load session",
        error
      );
    } finally {
      setLoading(false);
    }
  }

  async function login(
    email: string,
    password: string
  ) {
    try {
      const response = await fetch(
        `${API_URL}/api/mobile/auth/login`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error:
            data.error ||
            "Login failed",
        };
      }

      await SecureStore.setItemAsync(
        "access_token",
        data.accessToken
      );

      await SecureStore.setItemAsync(
        "user",
        JSON.stringify(data.user)
      );

      setToken(data.accessToken);
      setUser(data.user);

      return {
        success: true,
      };
    } catch (error) {
      console.log(error);

      return {
        success: false,
        error:
          "Unable to connect to server",
      };
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(
      "access_token"
    );

    await SecureStore.deleteItemAsync(
      "user"
    );

    setToken(null);
    setUser(null);
  }

  async function refreshUser() {
    if (!token) return;

    try {
      const response = await fetch(
        `${API_URL}/api/mobile/auth/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        await logout();
        return;
      }

      const data =
        await response.json();

      await SecureStore.setItemAsync(
        "user",
        JSON.stringify(data.user)
      );

      setUser(data.user);
    } catch (error) {
      console.log(
        "Failed to refresh user",
        error
      );
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}