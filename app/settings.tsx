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
  TextInput,
  View,
} from "react-native";

const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");

type GmailStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  scopes: string[];
};

type CalendarStatus = {
  connected: boolean;
  calendarConnected: boolean;
  email: string | null;
  scopes: string[];
};

type UserMemory = {
  prioritySenders: string[];
  importantTopics: string[];
  ignoredTopics: string[];
  preferredReminderTiming: number[];
  customRules: string[];
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

  const [calendar, setCalendar] = useState<CalendarStatus>({
    connected: false,
    calendarConnected: false,
    email: null,
    scopes: [],
  });

  const [memory, setMemory] = useState<UserMemory>({
    prioritySenders: [],
    importantTopics: ["hackathon", "exam", "interview", "assignment", "deadline"],
    ignoredTopics: ["marketing", "newsletter", "sale", "discount", "promotional"],
    preferredReminderTiming: [1440, 60],
    customRules: [],
  });

  const [newSender, setNewSender] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [newIgnored, setNewIgnored] = useState("");
  const [newRule, setNewRule] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
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
    if (!API_URL) return;

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/gmail/status`, { headers });
    const data = await response.json();

    if (response.ok) {
      setGmail(data);
    }
  }, [getAuthHeaders]);

  const loadCalendarStatus = useCallback(async () => {
    if (!API_URL) return;

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/calendar/status`, { headers });
    const data = await response.json();

    if (response.ok) {
      setCalendar(data);
    }
  }, [getAuthHeaders]);

  const loadMemory = useCallback(async () => {
    if (!API_URL) return;

    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/ai/memory`, { headers });
    const data = await response.json();

    if (response.ok && data.memory) {
      setMemory({
        prioritySenders: data.memory.prioritySenders || [],
        importantTopics: data.memory.importantTopics || [],
        ignoredTopics: data.memory.ignoredTopics || [],
        preferredReminderTiming: data.memory.preferredReminderTiming || [1440, 60],
        customRules: data.memory.customRules || [],
      });
    }
  }, [getAuthHeaders]);

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([loadGmailStatus(), loadCalendarStatus(), loadMemory()]);
    } catch (err) {
      console.warn("Failed to load settings data:", err);
    }
  }, [loadGmailStatus, loadCalendarStatus, loadMemory]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }

    loadAll().finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, loadAll]);

  useFocusEffect(
    useCallback(() => {
      if (!isLoaded || !isSignedIn) return;
      loadAll().catch(() => {});
    }, [isLoaded, isSignedIn, loadAll])
  );

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      await loadAll();
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
      "AI Assistant will request read-only access to your Gmail account. This allows the app to read, summarize, prioritize emails, and extract deadlines. You can disconnect at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue to Google",
          onPress: async () => {
            setBusy(true);
            try {
              const headers = await getAuthHeaders();
              const response = await fetch(`${API_URL}/api/gmail/connect`, {
                method: "POST",
                headers,
              });
              const data = await response.json();

              if (!response.ok || !data.authorizationUrl) {
                throw new Error(data.error || "Could not start Google authorization.");
              }

              const returnUrl = "aiassistant://settings";
              const result = await WebBrowser.openAuthSessionAsync(
                data.authorizationUrl,
                returnUrl
              );

              if (result.type === "success" && result.url) {
                const parsed = Linking.parse(result.url);
                const gmailResult = parsed.queryParams?.gmail;

                if (gmailResult === "connected") {
                  await loadAll();
                  Alert.alert("Gmail connected", "Your Gmail account is now connected.");
                } else if (gmailResult === "cancelled") {
                  Alert.alert("Connection cancelled", "Google access was not granted.");
                } else {
                  await loadAll();
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

  const connectCalendar = async () => {
    if (!API_URL) return;

    Alert.alert(
      "Connect Google Calendar",
      "AI Assistant will request permission to read and manage your Google Calendar events. This enables syncing events into your app calendar, viewing schedules, and letting the AI schedule tasks, exams, and reminders on your behalf.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue to Google",
          onPress: async () => {
            setBusy(true);
            try {
              const headers = await getAuthHeaders();
              const response = await fetch(`${API_URL}/api/calendar/connect`, {
                method: "POST",
                headers,
              });
              const data = await response.json();

              if (!response.ok || !data.authorizationUrl) {
                throw new Error(data.error || "Could not start Calendar authorization.");
              }

              const returnUrl = "aiassistant://settings";
              const result = await WebBrowser.openAuthSessionAsync(
                data.authorizationUrl,
                returnUrl
              );

              if (result.type === "success" && result.url) {
                await loadAll();
                Alert.alert(
                  "Google Calendar connected",
                  "Google Calendar permissions have been granted and synced!"
                );
              }
            } catch (error) {
              Alert.alert(
                "Could not connect Calendar",
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
      "Disconnect Google Services?",
      "AI Assistant will remove the saved Google credentials and disconnected services.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const headers = await getAuthHeaders();
              const response = await fetch(`${API_URL}/api/gmail/disconnect`, {
                method: "DELETE",
                headers,
              });
              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || "Could not disconnect.");
              }

              setGmail({
                connected: false,
                email: null,
                connectedAt: null,
                scopes: [],
              });
              setCalendar({
                connected: false,
                calendarConnected: false,
                email: null,
                scopes: [],
              });

              Alert.alert("Disconnected", data.warning || "Google account disconnected.");
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

  const saveMemoryPreferences = async (updated: UserMemory) => {
    setSavingMemory(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/ai/memory`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updated),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not update AI memory.");
      }
      setMemory(updated);
    } catch (err) {
      Alert.alert(
        "Save failed",
        err instanceof Error ? err.message : "Could not save memory preferences."
      );
    } finally {
      setSavingMemory(false);
    }
  };

  const addPrioritySender = () => {
    const val = newSender.trim().toLowerCase();
    if (!val || memory.prioritySenders.includes(val)) return;
    const updated = {
      ...memory,
      prioritySenders: [...memory.prioritySenders, val],
    };
    setNewSender("");
    void saveMemoryPreferences(updated);
  };

  const removePrioritySender = (sender: string) => {
    const updated = {
      ...memory,
      prioritySenders: memory.prioritySenders.filter((s) => s !== sender),
    };
    void saveMemoryPreferences(updated);
  };

  const addImportantTopic = () => {
    const val = newTopic.trim().toLowerCase();
    if (!val || memory.importantTopics.includes(val)) return;
    const updated = {
      ...memory,
      importantTopics: [...memory.importantTopics, val],
    };
    setNewTopic("");
    void saveMemoryPreferences(updated);
  };

  const removeImportantTopic = (topic: string) => {
    const updated = {
      ...memory,
      importantTopics: memory.importantTopics.filter((t) => t !== topic),
    };
    void saveMemoryPreferences(updated);
  };

  const addIgnoredTopic = () => {
    const val = newIgnored.trim().toLowerCase();
    if (!val || memory.ignoredTopics.includes(val)) return;
    const updated = {
      ...memory,
      ignoredTopics: [...memory.ignoredTopics, val],
    };
    setNewIgnored("");
    void saveMemoryPreferences(updated);
  };

  const removeIgnoredTopic = (topic: string) => {
    const updated = {
      ...memory,
      ignoredTopics: memory.ignoredTopics.filter((t) => t !== topic),
    };
    void saveMemoryPreferences(updated);
  };

  const addCustomRule = () => {
    const val = newRule.trim();
    if (!val || memory.customRules.includes(val)) return;
    const updated = {
      ...memory,
      customRules: [...memory.customRules, val],
    };
    setNewRule("");
    void saveMemoryPreferences(updated);
  };

  const removeCustomRule = (rule: string) => {
    const updated = {
      ...memory,
      customRules: memory.customRules.filter((r) => r !== rule),
    };
    void saveMemoryPreferences(updated);
  };

  const toggleReminderTiming = (minutes: number) => {
    const exists = memory.preferredReminderTiming.includes(minutes);
    const updatedTimings = exists
      ? memory.preferredReminderTiming.filter((m) => m !== minutes)
      : [...memory.preferredReminderTiming, minutes].sort((a, b) => b - a);

    const updated = {
      ...memory,
      preferredReminderTiming: updatedTimings.length ? updatedTimings : [60],
    };
    void saveMemoryPreferences(updated);
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
      contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refreshStatus}
          tintColor="#a78bfa"
        />
      }
    >
      <Pressable onPress={() => router.back()} className="mb-6 self-start">
        <Text className="text-violet-300 font-medium">← Back to Dashboard</Text>
      </Pressable>

      <Text className="text-3xl font-bold text-white">Settings</Text>
      <Text className="mt-2 text-slate-400">
        Manage accounts, connected services, and personal AI memory.
      </Text>

      {/* ACCOUNT */}
      <View className="mt-7 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <Text className="text-lg font-semibold text-white">Your account</Text>
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

      {/* GMAIL */}
      <View className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-white">✉️ Gmail</Text>
          <View
            className={`rounded-full px-3 py-1 ${
              gmail.connected ? "bg-emerald-950" : "bg-slate-800"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                gmail.connected ? "text-emerald-300" : "text-slate-300"
              }`}
            >
              {gmail.connected ? "Connected" : "Not connected"}
            </Text>
          </View>
        </View>

        <Text className="mt-3 leading-6 text-slate-400">
          {gmail.connected
            ? `Connected account: ${gmail.email}`
            : "Connect Gmail to summarize messages, extract deadlines, and create prioritized inbox."}
        </Text>

        <Pressable
          disabled={busy}
          onPress={gmail.connected ? disconnectGmail : connectGmail}
          className={`mt-4 items-center rounded-xl px-4 py-3.5 ${
            gmail.connected ? "bg-rose-950" : "bg-violet-600"
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
      </View>

      {/* GOOGLE CALENDAR */}
      <View className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-white">📅 Google Calendar</Text>
          <View
            className={`rounded-full px-3 py-1 ${
              calendar.calendarConnected ? "bg-emerald-950" : "bg-slate-800"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                calendar.calendarConnected ? "text-emerald-300" : "text-slate-300"
              }`}
            >
              {calendar.calendarConnected ? "Connected" : "Not connected"}
            </Text>
          </View>
        </View>

        <Text className="mt-3 leading-6 text-slate-400">
          {calendar.calendarConnected
            ? `Connected account: ${calendar.email}. Events, deadlines, and AI schedules synchronize with your calendar.`
            : "Connect Google Calendar to display events inside the app, schedule tasks via AI chat, and receive advance reminders."}
        </Text>

        <Pressable
          disabled={busy}
          onPress={calendar.calendarConnected ? disconnectGmail : connectCalendar}
          className={`mt-4 items-center rounded-xl px-4 py-3.5 ${
            calendar.calendarConnected ? "bg-rose-950" : "bg-emerald-600"
          } ${busy ? "opacity-60" : ""}`}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {calendar.calendarConnected ? "Disconnect Calendar" : "Connect Google Calendar"}
            </Text>
          )}
        </Pressable>
      </View>

      {/* PHASE 4: PERSONAL AI MEMORY & PREFERENCES */}
      <View className="mt-7 rounded-2xl border border-indigo-900/50 bg-slate-900 p-5">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-xl font-bold text-white">🧠 Personal AI Memory</Text>
            <Text className="mt-1 text-xs text-indigo-300">
              Phase 4 — Your personal copilot memory
            </Text>
          </View>
          {savingMemory && <ActivityIndicator color="#818cf8" size="small" />}
        </View>

        <Text className="mt-3 text-xs leading-5 text-slate-400">
          The AI learns your preferences and applies them across all messages, searches, and calendar scheduling. It strictly distinguishes your personal priorities (e.g. VIP senders, hackathons) from arbitrary deadlines.
        </Text>

        {/* Priority Senders */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-white">
            ⭐ Priority Senders (VIP Contacts)
          </Text>
          <Text className="mt-0.5 text-xs text-slate-400">
            Emails from these senders always rank as high priority.
          </Text>

          <View className="mt-2 flex-row flex-wrap gap-2">
            {memory.prioritySenders.map((s) => (
              <View
                key={s}
                className="flex-row items-center rounded-full bg-indigo-950/80 border border-indigo-700/50 px-3 py-1"
              >
                <Text className="text-xs text-indigo-200">{s}</Text>
                <Pressable onPress={() => removePrioritySender(s)} className="ml-2">
                  <Text className="text-xs font-bold text-indigo-400">✕</Text>
                </Pressable>
              </View>
            ))}
            {memory.prioritySenders.length === 0 && (
              <Text className="text-xs italic text-slate-500">No VIP senders saved yet.</Text>
            )}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <TextInput
              value={newSender}
              onChangeText={setNewSender}
              onSubmitEditing={addPrioritySender}
              placeholder="e.g. mentor@univ.edu or @company.com"
              placeholderTextColor="#64748b"
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white"
            />
            <Pressable
              onPress={addPrioritySender}
              className="rounded-xl bg-indigo-600 px-4 items-center justify-center"
            >
              <Text className="text-xs font-semibold text-white">Add</Text>
            </Pressable>
          </View>
        </View>

        {/* Important Topics */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-white">
            🏆 Important Topics (Hackathons, Exams, Projects)
          </Text>
          <Text className="mt-0.5 text-xs text-slate-400">
            Messages matching these topics are elevated in importance.
          </Text>

          <View className="mt-2 flex-row flex-wrap gap-2">
            {memory.importantTopics.map((topic) => (
              <View
                key={topic}
                className="flex-row items-center rounded-full bg-emerald-950/80 border border-emerald-700/50 px-3 py-1"
              >
                <Text className="text-xs text-emerald-200">{topic}</Text>
                <Pressable onPress={() => removeImportantTopic(topic)} className="ml-2">
                  <Text className="text-xs font-bold text-emerald-400">✕</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <TextInput
              value={newTopic}
              onChangeText={setNewTopic}
              onSubmitEditing={addImportantTopic}
              placeholder="e.g. hackathon, fellowship, thesis"
              placeholderTextColor="#64748b"
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white"
            />
            <Pressable
              onPress={addImportantTopic}
              className="rounded-xl bg-emerald-600 px-4 items-center justify-center"
            >
              <Text className="text-xs font-semibold text-white">Add</Text>
            </Pressable>
          </View>
        </View>

        {/* Ignored Topics */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-white">
            🚫 Ignored Topics (Marketing, Spam, Newsletters)
          </Text>
          <Text className="mt-0.5 text-xs text-slate-400">
            Even if marketing emails contain "urgent" or "sale ending", they remain LOW priority.
          </Text>

          <View className="mt-2 flex-row flex-wrap gap-2">
            {memory.ignoredTopics.map((item) => (
              <View
                key={item}
                className="flex-row items-center rounded-full bg-slate-800 px-3 py-1 border border-slate-700"
              >
                <Text className="text-xs text-slate-300">{item}</Text>
                <Pressable onPress={() => removeIgnoredTopic(item)} className="ml-2">
                  <Text className="text-xs font-bold text-slate-400">✕</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <TextInput
              value={newIgnored}
              onChangeText={setNewIgnored}
              onSubmitEditing={addIgnoredTopic}
              placeholder="e.g. sale, webinar, discount"
              placeholderTextColor="#64748b"
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white"
            />
            <Pressable
              onPress={addIgnoredTopic}
              className="rounded-xl bg-slate-700 px-4 items-center justify-center"
            >
              <Text className="text-xs font-semibold text-white">Add</Text>
            </Pressable>
          </View>
        </View>

        {/* Preferred Reminder Timing */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-white">
            ⏰ Preferred Advance Reminder Timing
          </Text>
          <Text className="mt-0.5 text-xs text-slate-400">
            When events or deadlines are scheduled, set notifications in advance:
          </Text>

          <View className="mt-2.5 flex-row flex-wrap gap-2">
            {[
              { label: "1 Day Before", value: 1440 },
              { label: "2 Hours Before", value: 120 },
              { label: "1 Hour Before", value: 60 },
              { label: "30 Min Before", value: 30 },
              { label: "15 Min Before", value: 15 },
            ].map((item) => {
              const active = memory.preferredReminderTiming.includes(item.value);
              return (
                <Pressable
                  key={item.value}
                  onPress={() => toggleReminderTiming(item.value)}
                  className={`rounded-full px-3.5 py-1.5 border ${
                    active
                      ? "bg-violet-600 border-violet-500"
                      : "bg-slate-800 border-slate-700"
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      active ? "text-white" : "text-slate-400"
                    }`}
                  >
                    {active ? "✓ " : ""}{item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Custom AI Rules */}
        <View className="mt-6">
          <Text className="text-sm font-semibold text-white">
            📝 Custom Rules & Instructions
          </Text>
          <Text className="mt-0.5 text-xs text-slate-400">
            Special instructions given directly to your AI copilot.
          </Text>

          <View className="mt-2 gap-2">
            {memory.customRules.map((rule) => (
              <View
                key={rule}
                className="flex-row items-center justify-between rounded-xl bg-slate-800 p-3"
              >
                <Text className="flex-1 text-xs text-slate-200 mr-2">{rule}</Text>
                <Pressable onPress={() => removeCustomRule(rule)}>
                  <Text className="text-xs font-bold text-red-400">Delete</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View className="mt-2.5 flex-row gap-2">
            <TextInput
              value={newRule}
              onChangeText={setNewRule}
              onSubmitEditing={addCustomRule}
              placeholder="e.g. Treat all emails from advisor Dr. Roy as top priority"
              placeholderTextColor="#64748b"
              className="flex-1 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white"
            />
            <Pressable
              onPress={addCustomRule}
              className="rounded-xl bg-indigo-600 px-4 items-center justify-center"
            >
              <Text className="text-xs font-semibold text-white">Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
