import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("assistant-reminders", {
        name: "AI Assistant Reminders",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#8b5cf6",
      });
    }

    return finalStatus === "granted";
  } catch (err) {
    console.warn("Could not request notification permissions:", err);
    return false;
  }
}

export async function scheduleAdvanceReminder({
  title,
  body,
  date,
  minutesBefore = 60,
  identifier,
}: {
  title: string;
  body: string;
  date: Date | string;
  minutesBefore?: number;
  identifier?: string;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    const targetDate = new Date(date);
    const reminderTime = new Date(targetDate.getTime() - minutesBefore * 60 * 1000);

    // If the reminder time is in the past, do not schedule
    if (reminderTime.getTime() <= Date.now()) {
      return null;
    }

    const scheduledId = await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: `Reminder: ${title}`,
        body: body || `Starting in ${minutesBefore} minutes`,
        sound: "default",
        data: { targetDate: targetDate.toISOString() },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderTime,
        channelId: "assistant-reminders",
      },
    });

    return scheduledId;
  } catch (error) {
    console.warn("Could not schedule local notification:", error);
    return null;
  }
}

export async function scheduleDirectTimer({
  title,
  seconds,
}: {
  title: string;
  seconds: number;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    const triggerDate = new Date(Date.now() + seconds * 1000);
    const scheduledId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Timer Done: ${title}`,
        body: `Your ${Math.round(seconds / 60)} minute timer has finished!`,
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: "assistant-reminders",
      },
    });
    return scheduledId;
  } catch (error) {
    console.warn("Could not set timer notification:", error);
    return null;
  }
}
