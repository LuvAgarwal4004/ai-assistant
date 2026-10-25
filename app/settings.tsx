
import { useAuth, useUser } from "@clerk/expo";
import * as Linking from "expo-linking";
import { useFocusEffect, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");

type GmailStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  scopes: string[];
};

export default function SettingsScreen() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  const [gmail, setGmail] = useState<GmailStatus>({
    connected: false,
    email: null,
    connectedAt: null,
    scopes: [],
  });

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();

    if (!token) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, [getToken]);

  const loadGmailStatus = useCallback(async () => {
    if (!API_URL) {
      throw new Error(
        "Backend URL is missing. Add EXPO_PUBLIC_BACKEND_URL to the root .env and restart Expo."
      );
    }

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/gmail/status`, {
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load Gmail status.");
    }

    setGmail(data);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }

    loadGmailStatus()
      .catch((error) => {
        Alert.alert(
          "Could not load Gmail status",
          error instanceof Error ? error.message : "Please try again."
        );
      })
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, loadGmailStatus]);

  // Refresh status when returning to Settings after Google consent.
  useFocusEffect(
    useCallback(() => {
      if (!isLoaded || !isSignedIn) return;

      loadGmailStatus().catch(() => {
        // Initial load displays errors; focus refresh can retry silently.
      });
    }, [isLoaded, isSignedIn, loadGmailStatus])
  );

  const refreshStatus = async () => {
    setRefreshing(true);

    try {
      await loadGmailStatus();
    } catch (error) {
      Alert.alert(
        "Refresh failed",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setRefreshing(false);
    }
  };

  const connectGmail = async () => {
    if (!API_URL) {
      Alert.alert(
        "Backend URL missing",
        "Add EXPO_PUBLIC_BACKEND_URL to the root .env file and restart Expo."
      );
      return;
    }

    Alert.alert(
      "Connect Gmail",
      "AI Assistant will request read-only access to your Gmail account. This permission can allow the app to read your email messages. It will not allow the app to send or delete emails. You can disconnect at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue to Google",
          onPress: async () => {
            setBusy(true);

            try {
              const headers = await getAuthHeaders();

              const response = await fetch(
                `${API_URL}/api/gmail/connect`,
                {
                  method: "POST",
                  headers,
                }
              );

              const data = await response.json();

              if (!response.ok || !data.authorizationUrl) {
                throw new Error(
                  data.error || "Could not start Google authorization."
                );
              }

              const returnUrl = "aiassistant://settings";

              const result = await WebBrowser.openAuthSessionAsync(
                data.authorizationUrl,
                returnUrl
              );

              // Google's callback redirects to aiassistant://settings?gmail=...
              if (result.type === "success" && result.url) {
                const parsed = Linking.parse(result.url);
                const gmailResult = parsed.queryParams?.gmail;

                if (gmailResult === "connected") {
                  await loadGmailStatus();

                  Alert.alert(
                    "Gmail connected",
                    "Your Gmail account is now connected."
                  );
                } else if (gmailResult === "cancelled") {
                  Alert.alert(
                    "Connection cancelled",
                    "Google access was not granted."
                  );
                } else if (gmailResult === "error") {
                  Alert.alert(
                    "Connection failed",
                    "Google authorization did not complete successfully. Check the backend terminal for details."
                  );
                }
              }
            } catch (error) {
              Alert.alert(
                "Could not connect Gmail",
                error instanceof Error ? error.message : "Please try again."
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const disconnectGmail = () => {
    Alert.alert(
      "Disconnect Gmail?",
      "AI Assistant will remove the saved Gmail connection. You can connect again later.",
      [
        { text: "Keep connected", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setBusy(true);

            try {
              const headers = await getAuthHeaders();
              const response = await fetch(
                `${API_URL}/api/gmail/disconnect`,
                {
                  method: "DELETE",
                  headers,
                }
              );

              const data = await response.json();

              if (!response.ok) {
                throw new Error(
                  data.error || "Could not disconnect Gmail."
                );
              }

              setGmail({
                connected: false,
                email: null,
                connectedAt: null,
                scopes: [],
              });

              Alert.alert(
                "Gmail disconnected",
                data.warning ||
                "The saved Gmail connection has been removed."
              );
            } catch (error) {
              Alert.alert(
                "Disconnect failed",
                error instanceof Error ? error.message : "Please try again."
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (!isLoaded || loading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#a78bfa" />
        <Text className="mt-3 text-slate-300">Loading settings...</Text>
      </View>
    );
  }

  if (!isSignedIn) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-6">
        <Text className="text-center text-slate-100">
          Please sign in to view your settings.
        </Text>
        <Pressable
          onPress={() => router.replace("/(auth)/sign-in")}
          className="mt-5 rounded-xl bg-violet-600 px-5 py-3"
        >
          <Text className="font-semibold text-white">Go to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-slate-950"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshStatus}
          tintColor="#a78bfa"
        />
      }
    >
      <Pressable onPress={() => router.back()} className="mb-6 self-start">
        <Text className="text-violet-300">← Back</Text>
      </Pressable>

      <Text className="text-3xl font-bold text-white">Settings</Text>
      <Text className="mt-2 text-slate-400">
        Manage your account and connected services.
      </Text>

      <View className="mt-7 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <Text className="text-lg font-semibold text-white">
          Your account
        </Text>
        <Text className="mt-3 text-slate-300">
          {user?.fullName || user?.primaryEmailAddress?.emailAddress || "Signed in"}
        </Text>
        {user?.fullName && (
          <Text className="mt-1 text-sm text-slate-400">
            {user?.primaryEmailAddress?.emailAddress}
          </Text>
        )}
        <Text className="mt-3 text-xs text-slate-500">
          Authentication managed securely by Clerk.
        </Text>
      </View>

      <View className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-white">
            Gmail
          </Text>
          <View
            className={`rounded-full px-3 py-1 ${gmail.connected ? "bg-emerald-950" : "bg-slate-800"
              }`}
          >
            <Text
              className={`text-xs font-semibold ${gmail.connected ? "text-emerald-300" : "text-slate-300"
                }`}
            >
              {gmail.connected ? "Connected" : "Not connected"}
            </Text>
          </View>
        </View>

        <Text className="mt-3 leading-6 text-slate-400">
          {gmail.connected
            ? `Connected account: ${gmail.email}`
            : "Connect Gmail to let the assistant access your email with the permission you approve."}
        </Text>

        <Text className="mt-3 text-xs leading-5 text-slate-500">
          Permission requested: Gmail read-only. Your Google refresh token
          is encrypted on the backend and is not stored in this app.
        </Text>

        <Pressable
          disabled={busy}
          onPress={gmail.connected ? disconnectGmail : connectGmail}
          className={`mt-5 items-center rounded-xl px-4 py-4 ${gmail.connected ? "bg-rose-950" : "bg-violet-600"
            } ${busy ? "opacity-60" : ""}`}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {gmail.connected ? "Disconnect Gmail" : "Connect Gmail"}
            </Text>
          )}
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={refreshStatus}
          className="mt-3 items-center rounded-xl border border-slate-700 px-4 py-3"
        >
          <Text className="text-slate-200">Refresh connection status</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
