
import { useAuth } from "@clerk/expo";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");

type EmailItem = {
  _id: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  summary: string;
  category: string;
  priority: "high" | "medium" | "low";
  priorityScore: number;
  priorityReason: string;
  actionItems: { text: string; dueDate?: string | null }[];
  deadlines: string[];
  analysisStatus: string;
  receivedAt: string | null;
  isRead: boolean;
  bodyText?: string;
};

type SyncStatus = {
  syncStatus: string;
  initialSyncComplete: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  totalEmails: number;
  pendingAnalysis: number;
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function priorityColor(priority: string) {
  if (priority === "high") return "#b91c1c";
  if (priority === "medium") return "#b45309";
  return "#166534";
}

export default function InboxScreen() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [selected, setSelected] = useState<EmailItem | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [days, setDays] = useState<30 | 60>(30);
  const [page, setPage] = useState(1);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalMatching, setTotalMatching] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loadingMoreRef = useRef(false);

  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const listRequestId = useRef(0);

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!API_URL) {
        throw new Error("Missing EXPO_PUBLIC_BACKEND_URL in the root .env.");
      }

      const token = await getToken();

      if (!token) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });

      return readJson(response);
    },
    [getToken]
  );

  const loadEmails = useCallback(
    async (pageToLoad = 1, append = false) => {
      const requestId = ++listRequestId.current;

      const params = new URLSearchParams();
      params.set("page", String(pageToLoad));
      params.set("limit", "30");
      params.set("days", String(days));

      // Only send q when a search is actually applied.
      if (appliedSearch.trim()) {
        params.set("q", appliedSearch.trim());
      }

      // An empty priority means All priorities.
      if (priority) {
        params.set("priority", priority);
      }

      try {
        const data = await request(`/api/emails?${params.toString()}`);

        // Ignore responses belonging to an older search or filter.
        if (
          !mountedRef.current ||
          requestId !== listRequestId.current
        ) {
          return;
        }

        const incoming: EmailItem[] = data.emails || [];

        if (append) {
          setEmails((current) => {
            const existingIds = new Set(current.map((email) => email._id));
            const newEmails = incoming.filter(
              (email: EmailItem) => !existingIds.has(email._id)
            );

            return [...current, ...newEmails];
          });
        } else {
          setEmails(incoming);
        }

        setPage(pageToLoad);
        setHasMore(Boolean(data.hasMore));
        setTotalMatching(Number(data.total || 0));
      } finally {
        if (mountedRef.current && !append) {
          setLoading(false);
        }
      }
    },
    [request, appliedSearch, priority, days]
  );

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      loadEmails(1, false).catch((err) => {
        if (cancelled) return;

        setError(
          err instanceof Error
            ? err.message
            : "Could not load filtered emails."
        );
      });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadEmails]);

  const loadStatus = useCallback(async () => {
    const data = await request("/api/email/sync-status");

    if (mountedRef.current) setSyncStatus(data);
  }, [request]);

  const loadMoreEmails = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      !hasMore ||
      loading ||
      syncing
    ) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");

    try {
      const nextPage = page + 1;
      await loadEmails(nextPage, true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load more emails."
      );
    } finally {
      loadingMoreRef.current = false;

      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [page, hasMore, loading, syncing, loadEmails]);

  const syncNow = useCallback(
    async (_continueImport = false) => {
      if (busyRef.current) return;

      busyRef.current = true;
      setSyncing(true);
      setError("");

      let pagesProcessed = 0;
      let totalImported = 0;
      let totalUpdated = 0;

      try {
        let result: {
          hasMore?: boolean;
          imported?: number;
          updated?: number;
        };

        do {
          result = await request("/api/email/sync", {
            method: "POST",
            body: JSON.stringify({ days }),
          });

          pagesProcessed += 1;
          totalImported += result.imported || 0;
          totalUpdated += result.updated || 0;

          if (result.hasMore) {
            setError(
              `Importing your ${days}-day inbox... ` +
              `${totalImported} new messages imported so far.`
            );
          }

          await Promise.all([loadEmails(1, false), loadStatus()]);
        } while (result.hasMore);

        setError("");

        // Reload the final list after the last page.
        await Promise.all([loadEmails(1, false), loadStatus()]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not sync Gmail. Tap Sync now to retry."
        );
      } finally {
        busyRef.current = false;

        if (mountedRef.current) {
          setSyncing(false);
        }
      }
    },
    [request, days, loadEmails, loadStatus]
  );


  const openEmail = useCallback(
    async (item: EmailItem) => {
      setSelected(item);

      try {
        const data = await request(`/api/emails/${item._id}`);

        if (mountedRef.current) setSelected(data.email);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not load this email.";
        Alert.alert("Email", message);
      }
    },
    [request]
  );

  const reanalyze = useCallback(async () => {
    if (!selected) return;

    try {
      await request(`/api/emails/${selected._id}/analyze`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      Alert.alert("Analysis queued", "The email will be analyzed shortly.");
      await loadEmails();
    } catch (err) {
      Alert.alert(
        "Could not queue analysis",
        err instanceof Error ? err.message : "Please try again."
      );
    }
  }, [selected, request, loadEmails]);

  const syncNowRef = useRef(syncNow);

  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  const initialLoadDone = useRef(false);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      initialLoadDone.current = false;

      const initialLoad = async () => {
        if (initialLoadDone.current) return;
        initialLoadDone.current = true;
        setLoading(true);
        try {
          await syncNowRef.current(false);
        } finally {
          if (mountedRef.current) setLoading(false);
        }
      };

      void initialLoad();

      const interval = setInterval(() => {
        void syncNowRef.current(false);
      }, 60000);

      return () => {
        mountedRef.current = false;
        initialLoadDone.current = false;
        clearInterval(interval);
      };
    }, []) // ← remove syncNow from deps
  );

  const lastSynced = syncStatus?.lastSyncAt
    ? new Date(syncStatus.lastSyncAt).toLocaleString()
    : "Not synced yet";

  return (
    <View className="flex-1 bg-slate-950 px-4 pt-14">
      <Pressable
        onPress={() => router.back()}
        className="mb-4 flex-row items-center self-start"
      >
        <Text className="text-sm font-semibold text-emerald-400">
          ← Back to Dashboard
        </Text>
      </Pressable>

      <View className="mb-5 flex-row items-center justify-between">
        <View>
          <Text className="text-3xl font-bold text-white">Inbox</Text>
          <Text className="mt-1 text-sm text-slate-400">
            {syncStatus?.totalEmails ?? emails.length} stored · {totalMatching} matching ({days} days)
          </Text>
        </View>

        <Pressable
          onPress={() => void syncNow(false)}
          disabled={syncing}
          className="rounded-xl bg-emerald-500 px-4 py-3"
        >
          <Text className="font-bold text-slate-950">
            {syncing ? "Syncing..." : "Sync now"}
          </Text>
        </Pressable>
      </View>

      <View className="mb-3 flex-row gap-2">
        {([30, 60] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              if (days !== value) {
                setDays(value);
                setPage(1);
              }
            }}
            className={`rounded-full px-4 py-2 ${days === value ? "bg-emerald-400" : "bg-slate-800"
              }`}
          >
            <Text
              className={`font-semibold ${days === value ? "text-slate-950" : "text-slate-200"
                }`}
            >
              {value} days
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="mb-3 flex-row gap-2">

        <TextInput
          value={search}
          onChangeText={(value) => {
            setSearch(value);

            // Clearing the text immediately removes the active search filter.
            if (value.trim() === "") {
              setAppliedSearch("");
              setPage(1);
            }
          }}
          onSubmitEditing={() => {
            setAppliedSearch(search.trim());
            setPage(1);
          }}
          placeholder="Search sender, subject or content..."
          placeholderTextColor="#94a3b8"
          returnKeyType="search"
          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white"
        />



        <Pressable
          onPress={() => {
            setAppliedSearch(search.trim());
            setPage(1);
          }}
          className="justify-center rounded-xl bg-slate-700 px-4"
        >
          <Text className="font-semibold text-white">Search</Text>
        </Pressable>

      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4 max-h-10"
        contentContainerStyle={{ gap: 8 }}
      >
        {[
          { label: "All", value: "" },
          { label: "High", value: "high" },
          { label: "Medium", value: "medium" },
          { label: "Low", value: "low" },
        ].map((item) => (
          <Pressable
            key={item.value || "all"}
            onPress={() => {
              setPriority(item.value);
              setPage(1);
            }}
            className={`rounded-full px-4 py-2 ${priority === item.value ? "bg-indigo-500" : "bg-slate-800"
              }`}
          >
            <Text className="font-semibold text-white">{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {syncing && (
        <View className="mb-3 flex-row items-center gap-2">
          <ActivityIndicator color="#34d399" />
          <Text className="text-sm text-slate-300">
            Checking Gmail and importing messages...
          </Text>
        </View>
      )}

      {!!error && (
        <Text className="mb-3 text-sm text-amber-300">{error}</Text>
      )}

      <Text className="mb-3 text-xs text-slate-500">
        Last sync: {lastSynced}
        {syncStatus?.pendingAnalysis
          ? ` · ${syncStatus.pendingAnalysis} analyses pending`
          : ""}
      </Text>

      {/* Continue import button is hidden per request */}

      {loading && emails.length === 0 ? (
        <ActivityIndicator size="large" color="#34d399" />
      ) : (

        <ScrollView
          className="flex-1"
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;

            const distanceFromBottom =
              contentSize.height -
              layoutMeasurement.height -
              contentOffset.y;

            if (distanceFromBottom < 300) {
              void loadMoreEmails();
            }
          }}
          onMomentumScrollEnd={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;

            const distanceFromBottom =
              contentSize.height -
              layoutMeasurement.height -
              contentOffset.y;

            if (distanceFromBottom < 300) {
              void loadMoreEmails();
            }
          }}
          scrollEventThrottle={100}
          refreshControl={

            <RefreshControl
              refreshing={syncing}
              onRefresh={() => void syncNow(false)}
              tintColor="#34d399"
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {emails.map((item) => (
            <Pressable
              key={item._id}
              onPress={() => void openEmail(item)}
              className="mb-3 rounded-2xl border border-slate-800 bg-slate-900 p-4"
            >
              <View className="mb-2 flex-row items-start justify-between gap-3">
                <Text className="min-w-0 flex-1 font-semibold text-white">
                  {item.from || "Unknown sender"}
                </Text>

                <Text
                  className="text-xs font-bold uppercase"
                  style={{ color: priorityColor(item.priority) }}
                >
                  {item.priority || "low"}
                </Text>
              </View>

              <Text className="mb-2 text-base font-bold text-slate-100">
                {item.subject || "(No subject)"}
              </Text>

              <Text className="mb-2 text-sm text-slate-300">
                {item.summary || item.snippet || "Waiting for analysis..."}
              </Text>

              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-slate-500">
                  {item.receivedAt
                    ? new Date(item.receivedAt).toLocaleDateString()
                    : ""}
                </Text>

                <Text className="text-xs text-slate-400">
                  {item.analysisStatus === "completed"
                    ? item.category
                    : "Analysis pending"}
                </Text>
              </View>
            </Pressable>
          ))}

          {loadingMore && (
            <View className="items-center py-4">
              <ActivityIndicator color="#34d399" />
              <Text className="mt-2 text-sm text-slate-400">
                Loading more emails...
              </Text>
            </View>
          )}

          {hasMore && !loadingMore && (
            <Pressable
              onPress={() => void loadMoreEmails()}
              className="mb-4 rounded-xl border border-slate-700 px-4 py-3"
            >
              <Text className="text-center font-semibold text-emerald-300">
                Load more emails
              </Text>
            </Pressable>
          )}

          {!hasMore && emails.length > 0 && (
            <Text className="py-3 text-center text-xs text-slate-500">
              All {totalMatching} matching emails loaded
            </Text>
          )}


          {!loading && emails.length === 0 && (
            <Text className="py-10 text-center text-slate-400">
              {error
                ? "Could not load emails. Check your connection and try syncing again."
                : "No messages found. Connect Gmail in Settings, then sync again."}
            </Text>
          )}
        </ScrollView>
      )}

      <Modal
        visible={Boolean(selected)}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View className="flex-1 bg-slate-950 px-5 pt-14">
          <View className="mb-5 flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-white">Email details</Text>
            <Pressable onPress={() => setSelected(null)}>
              <Text className="text-base font-semibold text-emerald-300">
                Close
              </Text>
            </Pressable>
          </View>

          {selected && (
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              <Text className="mb-1 text-sm text-slate-400">From</Text>
              <Text className="mb-4 text-white">{selected.from}</Text>

              <Text className="mb-1 text-sm text-slate-400">Subject</Text>
              <Text className="mb-4 text-lg font-bold text-white">
                {selected.subject}
              </Text>

              <Text className="mb-1 text-sm text-slate-400">Summary</Text>
              <Text className="mb-4 text-slate-100">
                {selected.summary || "Analysis is pending."}
              </Text>

              <Text className="mb-1 text-sm text-slate-400">Priority</Text>
              <Text
                className="mb-4 font-bold uppercase"
                style={{ color: priorityColor(selected.priority) }}
              >
                {selected.priority} · {selected.priorityScore}/100
              </Text>

              <Text className="mb-1 text-sm text-slate-400">
                Why this priority?
              </Text>
              <Text className="mb-4 text-slate-200">
                {selected.priorityReason || "Not analyzed yet."}
              </Text>

              <Text className="mb-2 text-sm text-slate-400">Action items</Text>
              {selected.actionItems?.length ? (
                selected.actionItems.map((item, index) => (
                  <Text key={`${index}-${item.text}`} className="mb-2 text-white">
                    • {item.text}
                    {item.dueDate ? ` (Due: ${item.dueDate})` : ""}
                  </Text>
                ))
              ) : (
                <Text className="mb-4 text-slate-400">
                  No action items extracted.
                </Text>
              )}

              <Text className="mb-2 mt-3 text-sm text-slate-400">Deadlines</Text>
              {selected.deadlines?.length ? (
                selected.deadlines.map((item, index) => (
                  <Text key={`${index}-${item}`} className="mb-2 text-white">
                    • {item}
                  </Text>
                ))
              ) : (
                <Text className="mb-4 text-slate-400">
                  No deadlines identified.
                </Text>
              )}

              <Text className="mb-2 mt-3 text-sm text-slate-400">
                Original message
              </Text>
              <Text className="mb-5 leading-6 text-slate-200">
                {selected.bodyText || selected.snippet || "No readable body."}
              </Text>

              <Pressable
                onPress={() => void reanalyze()}
                className="rounded-xl bg-emerald-400 px-4 py-3"
              >
                <Text className="text-center font-bold text-slate-950">
                  Analyze again
                </Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
