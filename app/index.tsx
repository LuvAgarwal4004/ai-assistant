import { useAuth, useUser } from "@clerk/expo";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  requestNotificationPermissions,
  scheduleAdvanceReminder,
  scheduleDirectTimer,
} from "../services/notificationService";

const API_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");

type CalendarEventItem = {
  _id: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isAllDay: boolean;
  priority: "high" | "medium" | "low";
  category: "exam" | "holiday" | "deadline" | "meeting" | "hackathon" | "personal" | "reminder" | "other";
  source: "google_calendar" | "ai_chat" | "email_deadline" | "pdf_upload" | "manual";
  reminders?: number[];
  googleEventId?: string;
};

type EmailDeadlineItem = {
  _id: string;
  from: string;
  subject: string;
  priority: "high" | "medium" | "low";
  priorityScore: number;
  deadlines: string[];
  actionItems?: { text: string; dueDate?: string | null }[];
  receivedAt?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: {
    scheduled?: any[];
    memoryUpdated?: boolean;
  };
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function getPriorityColor(priority: string) {
  if (priority === "high") return "#ef4444";
  if (priority === "medium") return "#f59e0b";
  return "#10b981";
}

function getPriorityGlowClass(priority: string | null) {
  if (priority === "high") return "border-2 border-rose-500 bg-rose-950/40 shadow-lg shadow-rose-500/60";
  if (priority === "medium") return "border-2 border-amber-500 bg-amber-950/40 shadow-md shadow-amber-500/50";
  if (priority === "low") return "border-2 border-emerald-500 bg-emerald-950/40 shadow-sm shadow-emerald-500/40";
  return "";
}

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const sidebarItems = [
  { icon: "⌂", label: "Dashboard" },
  { icon: "✉", label: "Inbox" },
  { icon: "📅", label: "Calendar" },
  { icon: "🧠", label: "AI Memory" },
];

const bottomItems = [
  { icon: "⚙", label: "Settings" },
];

export default function HomeScreen() {
  const router = useRouter();
  const { isSignedIn, isLoaded, signOut, getToken } = useAuth();
  const { user } = useUser();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Calendar State
  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string>(toDateString(today));

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [emailDeadlines, setEmailDeadlines] = useState<EmailDeadlineItem[]>([]);
  const [memoryRulesCount, setMemoryRulesCount] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);

  const [loadingData, setLoadingData] = useState(false);
  const [syncingCalendar, setSyncingCalendar] = useState(false);

  // AI Chat & Copilot State
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content:
        "Hello! I am your AI Copilot. You can tell me to schedule tasks, exams, or meetings with priorities. You can also upload your college calendar PDF, tell me your VIP priority senders, track hackathons, or set custom timers and advance reminders!",
    },
  ]);
  const [uploadingPdf, setUploadingPdf] = useState(false);

  // Manual Add Event Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"high" | "medium" | "low">("medium");
  const [newCategory, setNewCategory] = useState<string>("meeting");
  const [newTime, setNewTime] = useState("10:00 AM");

  const scrollViewRef = useRef<ScrollView>(null);

  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error("Please sign in.");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, [getToken]);

  // Request notifications permission on start
  useEffect(() => {
    void requestNotificationPermissions();
  }, []);

  // Fetch Calendar events, email deadlines, and AI memory counts
  const loadDashboardData = useCallback(async () => {
    if (!API_URL || !isSignedIn) return;
    setLoadingData(true);

    try {
      const headers = await getAuthHeaders();

      // Load aggregated calendar events
      const calRes = await fetch(`${API_URL}/api/calendar/events`, { headers });
      if (calRes.ok) {
        const data = await calRes.json();
        setEvents(data.calendarEvents || []);
        setEmailDeadlines(data.emailsWithDeadlines || []);

        // Schedule advance reminders for upcoming events
        for (const ev of (data.calendarEvents || []).slice(0, 10)) {
          if (ev.reminders && ev.reminders.length && ev.startDate) {
            for (const mins of ev.reminders) {
              void scheduleAdvanceReminder({
                title: ev.title,
                body: `[Priority: ${ev.priority.toUpperCase()}] ${ev.description || "Upcoming event"}`,
                date: ev.startDate,
                minutesBefore: mins,
                identifier: `event-${ev._id}-${mins}`,
              });
            }
          }
        }
      }

      // Load AI memory count
      const memRes = await fetch(`${API_URL}/api/ai/memory`, { headers });
      if (memRes.ok) {
        const memData = await memRes.json();
        const mem = memData.memory;
        if (mem) {
          const totalRules =
            (mem.prioritySenders?.length || 0) +
            (mem.importantTopics?.length || 0) +
            (mem.ignoredTopics?.length || 0) +
            (mem.customRules?.length || 0);
          setMemoryRulesCount(totalRules);
        }
      }

      // Load sync status / total emails
      const syncRes = await fetch(`${API_URL}/api/email/sync-status`, { headers });
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        setInboxCount(syncData.totalEmails || 0);
      }
    } catch (err) {
      console.warn("Failed to load dashboard data:", err);
    } finally {
      setLoadingData(false);
    }
  }, [getAuthHeaders, isSignedIn]);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      void loadDashboardData();
    }
  }, [isLoaded, isSignedIn, loadDashboardData]);

  // Calendar Day Navigation
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const jumpToToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDate(toDateString(now));
  };

  // Sync Google Calendar
  const handleSyncGoogleCalendar = async () => {
    if (!API_URL) return;
    setSyncingCalendar(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/calendar/sync`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert("Calendar Synced", `Successfully synced ${data.synced || 0} events from Google Calendar.`);
        await loadDashboardData();
      } else {
        Alert.alert("Sync Info", data.error || "Could not sync Google Calendar. Please check connection in Settings.");
      }
    } catch (err) {
      Alert.alert("Sync Error", err instanceof Error ? err.message : "Failed to sync calendar.");
    } finally {
      setSyncingCalendar(false);
    }
  };

  // Calendar matrix calculation
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const days = [];
    // Padding before the 1st
    for (let i = 0; i < firstDay; i++) {
      days.push({ dayNumber: null, dateString: null });
    }
    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ dayNumber: d, dateString: dateStr });
    }
    return days;
  }, [currentYear, currentMonth]);

  // Map events to dates with highest priority indicator
  const dateEventMap = useMemo(() => {
    const map = new Map<string, { highestPriority: "high" | "medium" | "low" | null; items: any[] }>();

    // Process CalendarEvent items
    for (const ev of events) {
      if (!ev.startDate) continue;
      const key = toDateString(new Date(ev.startDate));
      const existing = map.get(key) || { highestPriority: null, items: [] };
      existing.items.push({ ...ev, kind: "calendar_event" });

      if (ev.priority === "high") {
        existing.highestPriority = "high";
      } else if (ev.priority === "medium" && existing.highestPriority !== "high") {
        existing.highestPriority = "medium";
      } else if (ev.priority === "low" && !existing.highestPriority) {
        existing.highestPriority = "low";
      }

      map.set(key, existing);
    }

    // Process Email deadlines
    for (const em of emailDeadlines) {
      if (em.receivedAt) {
        const key = toDateString(new Date(em.receivedAt));
        const existing = map.get(key) || { highestPriority: null, items: [] };
        existing.items.push({
          _id: em._id,
          title: `Deadline: ${em.subject}`,
          description: `From: ${em.from}. ${em.deadlines.join("; ")}`,
          priority: em.priority,
          category: "deadline",
          source: "email_deadline",
          startDate: em.receivedAt,
          kind: "email_deadline",
        });

        if (em.priority === "high") {
          existing.highestPriority = "high";
        } else if (em.priority === "medium" && existing.highestPriority !== "high") {
          existing.highestPriority = "medium";
        } else if (em.priority === "low" && !existing.highestPriority) {
          existing.highestPriority = "low";
        }

        map.set(key, existing);
      }
    }

    return map;
  }, [events, emailDeadlines]);

  // Selected date events
  const selectedDayData = useMemo(() => {
    if (!selectedDate) return [];
    return dateEventMap.get(selectedDate)?.items || [];
  }, [selectedDate, dateEventMap]);

  // Handle AI Chat submission
  const handleSendAiMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || aiInput).trim();
    if (!textToSend || aiBusy) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: textToSend,
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setAiInput("");
    setAiBusy(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: textToSend,
          conversationHistory: chatMessages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to process message.");
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: "assistant",
        content: data.reply || "Done!",
        actions: data.actions,
      };

      setChatMessages((prev) => [...prev, botMsg]);

      // If events were scheduled, trigger advance local notifications & refresh calendar!
      if (data.actions?.scheduled?.length) {
        for (const ev of data.actions.scheduled) {
          if (ev.reminders && ev.reminders.length && ev.startDate) {
            for (const mins of ev.reminders) {
              void scheduleAdvanceReminder({
                title: ev.title,
                body: `[Priority: ${ev.priority.toUpperCase()}] Starting soon!`,
                date: ev.startDate,
                minutesBefore: mins,
              });
            }
          }
        }
        await loadDashboardData();
      }

      // If timer is mentioned, schedule quick local timer
      const timerMatch = textToSend.match(/(\d+)\s*(?:minute|min)s?\s*timer/i);
      if (timerMatch) {
        const mins = Number(timerMatch[1]);
        void scheduleDirectTimer({
          title: `Timer (${mins} mins)`,
          seconds: mins * 60,
        });
      }

      if (data.actions?.memoryUpdated) {
        await loadDashboardData();
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Could not complete request."}`,
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setAiBusy(false);
    }
  };

  // Upload College Calendar PDF
  const handlePickAndUploadPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      setUploadingPdf(true);

      // Read file to base64
      let base64 = "";
      try {
        base64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: "base64",
        });
      } catch (e) {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const raw = reader.result as string;
            resolve(raw.includes(",") ? raw.split(",")[1] : raw);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/ai/upload-pdf`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pdfBase64: base64,
          fileName: asset.name,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze PDF schedule.");
      }

      const successNotice: ChatMessage = {
        id: `pdf-${Date.now()}`,
        role: "assistant",
        content: `📄 **College Calendar Imported!**\n\n${data.summary}\n\nSuccessfully scheduled **${data.eventsCount}** events, exams, and holidays. Exams are marked in glowing RED (High Priority) on your calendar. Advance reminders have been set!`,
      };

      setChatMessages((prev) => [...prev, successNotice]);
      setChatOpen(true);
      await loadDashboardData();

      Alert.alert(
        "Calendar Imported!",
        `Extracted and scheduled ${data.eventsCount} events from ${asset.name}. Exams are marked in High Priority on your calendar!`
      );
    } catch (err) {
      Alert.alert(
        "Upload Error",
        err instanceof Error ? err.message : "Could not upload and parse PDF."
      );
    } finally {
      setUploadingPdf(false);
    }
  };

  // Create manual event
  const handleCreateManualEvent = async () => {
    if (!newTitle.trim()) {
      Alert.alert("Missing Title", "Please enter an event or task title.");
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const [year, month, day] = selectedDate.split("-").map(Number);
      const eventDate = new Date(year, month - 1, day, 10, 0, 0);

      const res = await fetch(`${API_URL}/api/calendar/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: newTitle.trim(),
          startDate: eventDate.toISOString(),
          priority: newPriority,
          category: newCategory,
          reminders: [1440, 60],
          pushToGoogle: true,
        }),
      });

      if (res.ok) {
        setAddModalOpen(false);
        setNewTitle("");
        await loadDashboardData();
        Alert.alert("Event Added", "Task scheduled on calendar and Google Calendar!");
      } else {
        const d = await res.json();
        Alert.alert("Error", d.error || "Could not add event.");
      }
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add event.");
    }
  };

  const highPriorityCount = useMemo(() => {
    return (
      events.filter((e) => e.priority === "high").length +
      emailDeadlines.filter((e) => e.priority === "high").length
    );
  }, [events, emailDeadlines]);

  const todayCount = useMemo(() => {
    const todayStr = toDateString(new Date());
    return dateEventMap.get(todayStr)?.items.length || 0;
  }, [dateEventMap]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <View className="flex-1 bg-slate-950">
      {/* SIDEBAR OVERLAY */}
      {sidebarOpen && (
        <Pressable
          className="absolute inset-0 z-20 bg-black/60"
          onPress={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR DRAWER */}
      <View
        className={`absolute left-0 top-0 z-30 h-full w-72 bg-slate-900 px-5 pb-8 pt-14 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <View className="mb-8">
          <Text className="text-2xl font-bold text-white">AI Assistant</Text>
          <Text className="mt-1 text-sm text-slate-400">Your executive copilot</Text>
        </View>

        <View className="gap-2">
          {sidebarItems.map((item, index) => (
            <Pressable
              key={item.label}
              className={`flex-row items-center rounded-2xl px-4 py-3.5 ${
                index === 0 ? "bg-white/10" : ""
              }`}
              onPress={() => {
                setSidebarOpen(false);
                if (item.label === "Inbox") {
                  router.push("/inbox");
                } else if (item.label === "Calendar") {
                  scrollViewRef.current?.scrollToEnd({ animated: true });
                } else if (item.label === "AI Memory") {
                  router.push("/settings");
                } else {
                  router.replace("/");
                }
              }}
            >
              <Text className="mr-4 w-6 text-center text-xl text-white">{item.icon}</Text>
              <Text className="text-base font-medium text-white">{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View className="mt-auto border-t border-slate-800 pt-5">
          {bottomItems.map((item) => (
            <Pressable
              key={item.label}
              className="mb-2 flex-row items-center rounded-2xl px-4 py-3"
              onPress={() => {
                setSidebarOpen(false);
                router.push("/settings");
              }}
            >
              <Text className="mr-4 w-6 text-center text-lg text-slate-400">{item.icon}</Text>
              <Text className="text-sm text-slate-300">{item.label}</Text>
            </Pressable>
          ))}

          <Pressable
            onPress={() => signOut()}
            className="mt-2 flex-row items-center rounded-2xl px-4 py-3"
          >
            <Text className="mr-4 w-6 text-center text-lg text-rose-400">↪</Text>
            <Text className="text-sm font-medium text-rose-400">Logout</Text>
          </Pressable>
        </View>
      </View>

      {/* TOP HEADER */}
      <View className="border-b border-slate-800 bg-slate-950 px-5 pb-4 pt-14">
        <View className="flex-row items-center">
          <Pressable
            className="mr-4 h-11 w-11 items-center justify-center rounded-xl bg-slate-900"
            onPress={() => setSidebarOpen(true)}
          >
            <Text className="text-2xl text-white">☰</Text>
          </Pressable>

          <View className="flex-1">
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search schedules & emails..."
              placeholderTextColor="#64748b"
              className="h-11 rounded-xl bg-slate-900 px-4 text-sm text-white"
            />
          </View>

          <Pressable
            onPress={() => router.push("/settings")}
            className="ml-4 h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800"
          >
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} className="h-full w-full" />
            ) : (
              <Text className="text-lg font-bold text-white">
                {(user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0] || "U").toUpperCase()}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* MAIN SCROLLABLE CONTENT */}
      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60 }}
      >
        {/* GREETING */}
        <View className="mb-6">
          <Text className="text-3xl font-bold text-white">{greeting} 👋</Text>
          <Text className="mt-1 text-base text-slate-400">
            Here is your intelligent schedule, deadlines & copilot.
          </Text>
        </View>

        {/* AI COPILOT INTERACTIVE BOX */}
        <View className="mb-8 rounded-3xl border border-indigo-900/60 bg-slate-900 p-5 shadow-xl shadow-indigo-950/50">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-bold tracking-wider text-indigo-400 uppercase">
                ASK YOUR EXECUTIVE COPILOT
              </Text>
              <Text className="mt-1 text-xl font-bold text-white">
                Schedule, set priorities, or upload PDF
              </Text>
            </View>
            <Pressable
              onPress={() => setChatOpen(true)}
              className="rounded-full bg-indigo-950 px-3 py-1.5 border border-indigo-700/50"
            >
              <Text className="text-xs font-semibold text-indigo-300">
                💬 Chat ({chatMessages.length})
              </Text>
            </Pressable>
          </View>

          {/* QUICK SUGGESTION PILLS */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-4"
            contentContainerStyle={{ gap: 8 }}
          >
            {[
              "Schedule team review tomorrow at 4 PM high priority",
              "Set a 25 minute study timer",
              "Remember: Dr. Roy is a priority sender",
              "Track all hackathons as high priority",
            ].map((promptText) => (
              <Pressable
                key={promptText}
                onPress={() => void handleSendAiMessage(promptText)}
                className="rounded-full bg-slate-800 border border-slate-700 px-3.5 py-1.5"
              >
                <Text className="text-xs text-slate-300">⚡ {promptText}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* INPUT BAR WITH PDF UPLOAD BUTTON */}
          <View className="mt-4 flex-row items-center rounded-2xl bg-slate-800 px-3 py-1 border border-slate-700/60">
            {/* PDF UPLOAD BUTTON */}
            <Pressable
              disabled={uploadingPdf}
              onPress={() => void handlePickAndUploadPdf()}
              className="mr-2 h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/30 border border-indigo-500/40"
            >
              {uploadingPdf ? (
                <ActivityIndicator size="small" color="#a78bfa" />
              ) : (
                <Text className="text-lg">📎</Text>
              )}
            </Pressable>

            <TextInput
              value={aiInput}
              onChangeText={setAiInput}
              onSubmitEditing={() => void handleSendAiMessage()}
              placeholder="e.g. Schedule exam Friday 10 AM, high priority..."
              placeholderTextColor="#64748b"
              className="h-12 flex-1 text-white text-sm"
            />

            <Pressable
              disabled={aiBusy || !aiInput.trim()}
              onPress={() => void handleSendAiMessage()}
              className={`h-9 w-9 items-center justify-center rounded-xl ${
                aiInput.trim() ? "bg-white" : "bg-slate-700 opacity-60"
              }`}
            >
              {aiBusy ? (
                <ActivityIndicator size="small" color="#020617" />
              ) : (
                <Text className="font-bold text-slate-950">↑</Text>
              )}
            </Pressable>
          </View>

          {uploadingPdf && (
            <View className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#818cf8" />
              <Text className="text-xs text-indigo-300">
                Gemini is reading your college calendar PDF and extracting all exams & dates...
              </Text>
            </View>
          )}
        </View>

        {/* METRICS & NOTIFICATIONS CARDS */}
        <View className="mb-8">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-white">Live Overview</Text>
            <Pressable onPress={() => void loadDashboardData()}>
              <Text className="text-xs font-semibold text-violet-400">
                {loadingData ? "Refreshing..." : "↻ Refresh"}
              </Text>
            </Pressable>
          </View>

          <View className="flex-row gap-3">
            {/* HIGH PRIORITY */}
            <View className="flex-1 rounded-2xl border border-rose-900/60 bg-slate-900 p-4">
              <Text className="text-2xl font-bold text-rose-400">{highPriorityCount}</Text>
              <Text className="mt-1 text-xs font-semibold text-white">High Priority</Text>
              <Text className="text-[10px] text-slate-400">Exams & Deadlines</Text>
            </View>

            {/* TODAY */}
            <View className="flex-1 rounded-2xl border border-amber-900/60 bg-slate-900 p-4">
              <Text className="text-2xl font-bold text-amber-400">{todayCount}</Text>
              <Text className="mt-1 text-xs font-semibold text-white">Today's Schedule</Text>
              <Text className="text-[10px] text-slate-400">Events & Timers</Text>
            </View>

            {/* AI MEMORY */}
            <Pressable
              onPress={() => router.push("/settings")}
              className="flex-1 rounded-2xl border border-indigo-900/60 bg-slate-900 p-4"
            >
              <Text className="text-2xl font-bold text-indigo-400">{memoryRulesCount}</Text>
              <Text className="mt-1 text-xs font-semibold text-white">AI Memory</Text>
              <Text className="text-[10px] text-slate-400">Active VIP Rules</Text>
            </Pressable>
          </View>
        </View>

        {/* COMPLETE ADVANCED INTERACTIVE CALENDAR */}
        <View className="mb-8">
          <View className="mb-4 flex-row items-center justify-between">
            <View>
              <Text className="text-2xl font-bold text-white">Interactive Calendar</Text>
              <Text className="text-xs text-slate-400">
                Glows by priority: 🔴 High · 🟡 Medium · 🟢 Low
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => void handleSyncGoogleCalendar()}
                disabled={syncingCalendar}
                className="rounded-xl bg-slate-800 border border-slate-700 px-3 py-2"
              >
                <Text className="text-xs font-semibold text-emerald-400">
                  {syncingCalendar ? "Syncing..." : "📅 Sync Google"}
                </Text>
              </Pressable>

              <Pressable
                onPress={jumpToToday}
                className="rounded-xl bg-violet-600 px-3 py-2"
              >
                <Text className="text-xs font-bold text-white">Today</Text>
              </Pressable>
            </View>
          </View>

          {/* CALENDAR CONTAINER */}
          <View className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            {/* Month & Year Bar */}
            <View className="mb-5 flex-row items-center justify-between">
              <Pressable
                onPress={prevMonth}
                className="h-9 w-9 items-center justify-center rounded-xl bg-slate-800"
              >
                <Text className="text-lg text-white font-bold">‹</Text>
              </Pressable>

              <Text className="text-lg font-bold text-white">
                {MONTH_NAMES[currentMonth]} {currentYear}
              </Text>

              <Pressable
                onPress={nextMonth}
                className="h-9 w-9 items-center justify-center rounded-xl bg-slate-800"
              >
                <Text className="text-lg text-white font-bold">›</Text>
              </Pressable>
            </View>

            {/* Days of Week Header */}
            <View className="mb-3 flex-row justify-between">
              {DAYS_OF_WEEK.map((d) => (
                <Text
                  key={d}
                  className="w-10 text-center text-xs font-bold text-slate-500 uppercase"
                >
                  {d}
                </Text>
              ))}
            </View>

            {/* Days Grid */}
            <View className="flex-row flex-wrap">
              {calendarDays.map((cell, index) => {
                if (!cell.dayNumber || !cell.dateString) {
                  return <View key={`empty-${index}`} className="mb-3 w-[14.28%]" />;
                }

                const dayEvents = dateEventMap.get(cell.dateString);
                const isSelected = selectedDate === cell.dateString;
                const isCurrentToday = toDateString(today) === cell.dateString;
                const highestPriority = dayEvents?.highestPriority || null;
                const glowClass = getPriorityGlowClass(highestPriority);

                return (
                  <Pressable
                    key={cell.dateString}
                    onPress={() => setSelectedDate(cell.dateString!)}
                    className="mb-3 w-[14.28%] items-center"
                  >
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-2xl ${
                        isSelected
                          ? "bg-violet-600 border-2 border-white shadow-lg shadow-violet-500/80"
                          : glowClass || (isCurrentToday ? "border border-white bg-slate-800" : "bg-slate-800/70")
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected
                            ? "font-bold text-white"
                            : isCurrentToday
                            ? "font-bold text-violet-300"
                            : "text-slate-200"
                        }`}
                      >
                        {cell.dayNumber}
                      </Text>

                      {/* Priority Dot Markers */}
                      {dayEvents && dayEvents.items.length > 0 && !isSelected && (
                        <View className="absolute bottom-1 flex-row gap-0.5">
                          {dayEvents.items.slice(0, 3).map((it, idx) => (
                            <View
                              key={idx}
                              style={{ backgroundColor: getPriorityColor(it.priority) }}
                              className="h-1.5 w-1.5 rounded-full"
                            />
                          ))}
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* DAY DETAILS PANEL */}
          <View className="mt-4 rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <View className="flex-row items-center justify-between pb-3 border-b border-slate-800">
              <View>
                <Text className="text-lg font-bold text-white">
                  Schedule for {selectedDate}
                </Text>
                <Text className="text-xs text-slate-400">
                  {selectedDayData.length} items scheduled on this day
                </Text>
              </View>

              <Pressable
                onPress={() => setAddModalOpen(true)}
                className="rounded-xl bg-violet-600 px-3.5 py-2"
              >
                <Text className="text-xs font-bold text-white">+ Add Event</Text>
              </Pressable>
            </View>

            <View className="mt-4 gap-3">
              {selectedDayData.map((item, idx) => {
                const priorityColor = getPriorityColor(item.priority);
                return (
                  <View
                    key={item._id || idx}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 mr-2">
                        <Text className="text-base font-bold text-white">
                          {item.title}
                        </Text>
                        {item.description ? (
                          <Text className="mt-1 text-xs text-slate-300">
                            {item.description}
                          </Text>
                        ) : null}
                      </View>

                      {/* Glowing Priority Tag */}
                      <View
                        style={{
                          backgroundColor: `${priorityColor}20`,
                          borderColor: priorityColor,
                        }}
                        className="rounded-full border px-2.5 py-0.5"
                      >
                        <Text
                          style={{ color: priorityColor }}
                          className="text-[10px] font-bold uppercase"
                        >
                          {item.priority}
                        </Text>
                      </View>
                    </View>

                    <View className="mt-3 flex-row items-center justify-between">
                      <View className="flex-row gap-2">
                        <View className="rounded-md bg-slate-800 px-2 py-0.5">
                          <Text className="text-[10px] text-slate-300 uppercase font-semibold">
                            {item.category || "Task"}
                          </Text>
                        </View>
                        <View className="rounded-md bg-indigo-950 px-2 py-0.5 border border-indigo-800/40">
                          <Text className="text-[10px] text-indigo-300 font-semibold">
                            Source: {item.source}
                          </Text>
                        </View>
                      </View>

                      {item.startDate && (
                        <Text className="text-xs text-slate-400">
                          {item.isAllDay ? "All day" : new Date(item.startDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}

              {selectedDayData.length === 0 && (
                <View className="py-6 items-center">
                  <Text className="text-sm text-slate-500">No events or deadlines for this day.</Text>
                  <Pressable
                    onPress={() => setAddModalOpen(true)}
                    className="mt-2"
                  >
                    <Text className="text-xs font-semibold text-violet-400">
                      Tap here to schedule a task or reminder
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* FULL SCREEN AI CHAT MODAL */}
      <Modal
        visible={chatOpen}
        animationType="slide"
        onRequestClose={() => setChatOpen(false)}
      >
        <View className="flex-1 bg-slate-950 px-5 pt-14 pb-8">
          <View className="mb-4 flex-row items-center justify-between border-b border-slate-800 pb-3">
            <View>
              <Text className="text-2xl font-bold text-white">AI Copilot Chat</Text>
              <Text className="text-xs text-slate-400">
                Natural language scheduling, memory preferences & timers
              </Text>
            </View>
            <Pressable onPress={() => setChatOpen(false)}>
              <Text className="text-base font-semibold text-violet-400">Close</Text>
            </Pressable>
          </View>

          {/* CHAT MESSAGES */}
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 20 }}>
            {chatMessages.map((msg) => (
              <View
                key={msg.id}
                className={`mb-3.5 max-w-[85%] rounded-2xl p-4 ${
                  msg.role === "user"
                    ? "self-end bg-violet-600 rounded-br-none"
                    : "self-start bg-slate-900 border border-slate-800 rounded-bl-none"
                }`}
              >
                <Text
                  className={`text-sm leading-5 ${
                    msg.role === "user" ? "text-white font-medium" : "text-slate-100"
                  }`}
                >
                  {msg.content}
                </Text>

                {msg.actions?.scheduled?.map((sc: any, idx: number) => (
                  <View
                    key={idx}
                    className="mt-2 rounded-xl bg-slate-950 p-2.5 border border-slate-800"
                  >
                    <Text className="text-xs font-bold text-emerald-400">
                      ✓ Scheduled: {sc.title}
                    </Text>
                    <Text className="text-[10px] text-slate-400">
                      Date: {new Date(sc.startDate).toLocaleString()} · Priority: {sc.priority?.toUpperCase()}
                    </Text>
                  </View>
                ))}
              </View>
            ))}

            {aiBusy && (
              <View className="self-start rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <ActivityIndicator size="small" color="#a78bfa" />
                <Text className="mt-1 text-xs text-slate-400">Copilot is thinking & scheduling...</Text>
              </View>
            )}
          </ScrollView>

          {/* CHAT INPUT BAR */}
          <View className="flex-row items-center rounded-2xl bg-slate-900 border border-slate-800 px-3 py-1">
            <Pressable
              disabled={uploadingPdf}
              onPress={() => void handlePickAndUploadPdf()}
              className="mr-2 h-10 w-10 items-center justify-center rounded-xl bg-slate-800"
            >
              <Text className="text-lg">📎</Text>
            </Pressable>

            <TextInput
              value={aiInput}
              onChangeText={setAiInput}
              onSubmitEditing={() => void handleSendAiMessage()}
              placeholder="Ask anything or schedule..."
              placeholderTextColor="#64748b"
              className="h-12 flex-1 text-white text-sm"
            />

            <Pressable
              disabled={aiBusy || !aiInput.trim()}
              onPress={() => void handleSendAiMessage()}
              className="h-9 w-9 items-center justify-center rounded-xl bg-violet-600"
            >
              <Text className="font-bold text-white">↑</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ADD EVENT MODAL */}
      <Modal
        visible={addModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddModalOpen(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/75 px-5">
          <View className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <Text className="text-xl font-bold text-white">Schedule Event / Task</Text>
            <Text className="mt-1 text-xs text-slate-400">
              For date: {selectedDate}
            </Text>

            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Event or Task Title..."
              placeholderTextColor="#64748b"
              className="mt-4 rounded-xl bg-slate-800 px-4 py-3 text-white text-sm border border-slate-700"
            />

            {/* PRIORITY SELECTION */}
            <Text className="mt-4 text-xs font-semibold text-slate-400 uppercase">
              Priority Level
            </Text>
            <View className="mt-2 flex-row gap-2">
              {(["high", "medium", "low"] as const).map((p) => {
                const active = newPriority === p;
                const col = getPriorityColor(p);
                return (
                  <Pressable
                    key={p}
                    onPress={() => setNewPriority(p)}
                    style={{
                      borderColor: col,
                      backgroundColor: active ? `${col}30` : "#1e293b",
                    }}
                    className="flex-1 rounded-xl border py-2 items-center"
                  >
                    <Text
                      style={{ color: active ? col : "#94a3b8" }}
                      className="text-xs font-bold uppercase"
                    >
                      {p}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* CATEGORY SELECTION */}
            <Text className="mt-4 text-xs font-semibold text-slate-400 uppercase">
              Category
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {["exam", "deadline", "meeting", "hackathon", "holiday"].map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setNewCategory(cat)}
                  className={`rounded-full px-3 py-1 border ${
                    newCategory === cat
                      ? "bg-violet-600 border-violet-500"
                      : "bg-slate-800 border-slate-700"
                  }`}
                >
                  <Text className="text-xs text-white capitalize">{cat}</Text>
                </Pressable>
              ))}
            </View>

            <View className="mt-6 flex-row gap-3">
              <Pressable
                onPress={() => setAddModalOpen(false)}
                className="flex-1 rounded-xl bg-slate-800 py-3 items-center"
              >
                <Text className="font-semibold text-slate-300">Cancel</Text>
              </Pressable>

              <Pressable
                onPress={() => void handleCreateManualEvent()}
                className="flex-1 rounded-xl bg-violet-600 py-3 items-center"
              >
                <Text className="font-bold text-white">Save Event</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
