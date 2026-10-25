import { useAuth, useUser } from "@clerk/expo";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert, Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";

const notifications = [
  {
    icon: "✉️",
    title: "Emails",
    count: 4,
    description: "Emails waiting for your attention",
  },
  {
    icon: "💬",
    title: "WhatsApp",
    count: 5,
    description: "Messages you may want to check",
  },
  {
    icon: "⏰",
    title: "Scheduled Events",
    count: 2,
    description: "Events scheduled for today",
  },
  {
    icon: "📅",
    title: "Upcoming Events",
    count: 3,
    description: "Events coming up soon",
  },
];

const sidebarItems = [
  { icon: "⌂", label: "Dashboard" },
  { icon: "✉", label: "Inbox" },
  { icon: "⏰", label: "Upcoming Events" },
  { icon: "▦", label: "Calendar" },
];

const bottomItems = [
  { icon: "⚙", label: "Settings" },
  { icon: "ⓘ", label: "About" },
  { icon: "?", label: "Help" },
];

export default function HomeScreen() {
  const router = useRouter();
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const { user } = useUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  if (!isLoaded) {
    return null;
  }
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <View className="flex-1 bg-slate-950">
      {/* SIDEBAR */}
      {sidebarOpen && (
        <Pressable
          className="absolute inset-0 z-20 bg-black/50"
          onPress={() => setSidebarOpen(false)}
        />
      )}

      <View
        className={`absolute left-0 top-0 z-30 h-full w-72 bg-slate-900 px-5 pb-8 pt-14 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <View className="mb-10">
          <Text className="text-2xl font-bold text-white">AI Assistant</Text>
          <Text className="mt-1 text-sm text-slate-400">
            Your personal copilot
          </Text>
        </View>


        <View className="gap-2">
          {sidebarItems.map((item, index) => (
            <Pressable
              key={item.label}
              className={`flex-row items-center rounded-2xl px-4 py-4 ${index === 0 ? "bg-white/10" : ""
                }`}
              onPress={() => {
                setSidebarOpen(false);

                if (item.label === "Inbox") {
                  router.push("/inbox");
                } else if (item.label === "Dashboard") {
                  router.replace("/");
                } else {
                  Alert.alert(item.label, "This page will be added later.");
                }
              }}
            >

              <Text className="mr-4 w-6 text-center text-xl text-white">
                {item.icon}
              </Text>

              <Text className="text-base font-medium text-white">
                {item.label}
              </Text>
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

                if (item.label === "Settings") {
                  router.push("/settings");
                } else {
                  Alert.alert(item.label, "This page will be added later.");
                }
              }}
            >
              <Text className="mr-4 w-6 text-center text-lg text-slate-400">
                {item.icon}
              </Text>

              <Text className="text-sm text-slate-300">{item.label}</Text>
            </Pressable>
          ))}

          <Pressable
            onPress={() => signOut()}
            className="mt-2 flex-row items-center rounded-2xl px-4 py-3"
          >
            <Text className="mr-4 w-6 text-center text-lg text-red-400">
              ↪
            </Text>

            <Text className="text-sm font-medium text-red-400">
              Logout
            </Text>
          </Pressable>
        </View>
      </View>

      {/* MAIN CONTENT */}
      <View className="flex-1">
        {/* NAVBAR */}
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
                placeholder="Search anything..."
                placeholderTextColor="#64748b"
                className="h-11 rounded-xl bg-slate-900 px-4 text-sm text-white"
              />
            </View>

            <Pressable className="ml-4 h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800">
              {user?.imageUrl ? (
                <Image
                  source={{ uri: user.imageUrl }}
                  className="h-full w-full"
                />
              ) : (
                <Text className="text-lg font-bold text-white">
                  {(
                    user?.firstName?.[0] ||
                    user?.emailAddresses?.[0]?.emailAddress?.[0] ||
                    "U"
                  ).toUpperCase()}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* DASHBOARD */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="px-5 pb-12 pt-7"
        >
          <View className="mb-7">
            <Text className="text-3xl font-bold text-white">
              {greeting} 👋
            </Text>

            <Text className="mt-2 text-base text-slate-400">
              Here's what needs your attention.
            </Text>
          </View>

          {/* AI INPUT */}
          <View className="mb-8 rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <Text className="text-sm font-medium text-slate-400">
              ASK YOUR COPILOT
            </Text>

            <Text className="mt-2 text-xl font-semibold text-white">
              What can I help you with?
            </Text>

            <View className="mt-5 flex-row items-center rounded-2xl bg-slate-800 px-4">
              <TextInput
                placeholder="Ask anything..."
                placeholderTextColor="#64748b"
                className="h-12 flex-1 text-white"
              />

              <Pressable className="h-9 w-9 items-center justify-center rounded-xl bg-white">
                <Text className="font-bold text-slate-950">↑</Text>
              </Pressable>
            </View>
          </View>

          {/* NOTIFICATIONS */}
          <View className="mb-7">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-xl font-bold text-white">
                Notifications
              </Text>

              <Pressable>
                <Text className="text-sm font-medium text-slate-400">
                  View all
                </Text>
              </Pressable>
            </View>

            <View className="gap-3">
              {notifications.map((notification) => (
                <Pressable
                  key={notification.title}
                  className="flex-row items-center rounded-2xl border border-slate-800 bg-slate-900 p-4"
                >
                  <View className="mr-4 h-12 w-12 items-center justify-center rounded-xl bg-slate-800">
                    <Text className="text-xl">{notification.icon}</Text>
                  </View>

                  <View className="flex-1">
                    <Text className="font-semibold text-white">
                      {notification.title}
                    </Text>

                    <Text className="mt-1 text-xs text-slate-400">
                      {notification.description}
                    </Text>
                  </View>

                  <View className="ml-3 h-9 min-w-9 items-center justify-center rounded-full bg-white px-2">
                    <Text className="font-bold text-slate-950">
                      {notification.count}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          {/* CALENDAR */}
          <View>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-xl font-bold text-white">Calendar</Text>

              <Pressable>
                <Text className="text-sm font-medium text-slate-400">
                  Open calendar
                </Text>
              </Pressable>
            </View>

            <View className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <View className="mb-5 flex-row items-center justify-between">
                <Pressable>
                  <Text className="text-xl text-white">‹</Text>
                </Pressable>

                <Text className="font-semibold text-white">
                  August 2026
                </Text>

                <Pressable>
                  <Text className="text-xl text-white">›</Text>
                </Pressable>
              </View>

              <View className="mb-3 flex-row justify-between">
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <Text
                    key={`${day}-${index}`}
                    className="w-8 text-center text-xs font-medium text-slate-500"
                  >
                    {day}
                  </Text>
                ))}
              </View>

              <View className="flex-row flex-wrap">
                {Array.from({ length: 31 }, (_, index) => (
                  <Pressable
                    key={index}
                    className="mb-3 w-[14.28%] items-center"
                  >
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${index + 1 === 10 ? "bg-white" : ""
                        }`}
                    >
                      <Text
                        className={`text-sm ${index + 1 === 10
                          ? "font-bold text-slate-950"
                          : "text-slate-300"
                          }`}
                      >
                        {index + 1}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}