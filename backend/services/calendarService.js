const { google } = require("googleapis");
const CalendarEvent = require("../models/CalendarEvent");
const GmailConnection = require("../models/GmailConnection");
const Email = require("../models/Email");

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getGoogleCalendarClient(clerkUserId, decryptToken) {
  const connection = await GmailConnection.findOne({ clerkUserId }).select(
    "+encryptedRefreshToken"
  );

  if (!connection || !connection.encryptedRefreshToken) {
    return null;
  }

  const hasCalendarScope = (connection.scopes || []).some(
    (s) =>
      s.includes("calendar") ||
      s === CALENDAR_SCOPE ||
      s === CALENDAR_EVENTS_SCOPE
  );

  const refreshToken = decryptToken(connection.encryptedRefreshToken);
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });

  return {
    calendar: google.calendar({ version: "v3", auth: client }),
    hasCalendarScope,
  };
}

async function syncGoogleCalendarEvents({ clerkUserId, decryptToken, days = 60 }) {
  try {
    const clientData = await getGoogleCalendarClient(clerkUserId, decryptToken);
    if (!clientData) {
      return { synced: 0, reason: "Google account not connected" };
    }

    const { calendar } = clientData;
    const now = new Date();
    const timeMin = new Date(now.getTime() - 15 * 86400000).toISOString();
    const timeMax = new Date(now.getTime() + days * 86400000).toISOString();

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const items = response.data.items || [];
    let syncedCount = 0;

    for (const item of items) {
      if (!item.id || item.status === "cancelled") {
        if (item.id) {
          await CalendarEvent.deleteOne({ clerkUserId, googleEventId: item.id });
        }
        continue;
      }

      const isAllDay = Boolean(item.start?.date);
      const startDate = new Date(item.start?.dateTime || item.start?.date || Date.now());
      const endDate = item.end?.dateTime || item.end?.date
        ? new Date(item.end.dateTime || item.end.date)
        : null;

      // Extract reminders
      let reminders = [60];
      if (item.reminders?.overrides?.length) {
        reminders = item.reminders.overrides
          .map((o) => Number(o.minutes))
          .filter(Boolean);
      }

      await CalendarEvent.findOneAndUpdate(
        { clerkUserId, googleEventId: item.id },
        {
          $set: {
            clerkUserId,
            googleEventId: item.id,
            title: item.summary || "(No Title)",
            description: item.description || "",
            location: item.location || "",
            startDate,
            endDate,
            isAllDay,
            priority: /urgent|important|exam|interview|deadline/i.test(
              `${item.summary} ${item.description}`
            )
              ? "high"
              : "medium",
            category: /exam|test|quiz/i.test(item.summary)
              ? "exam"
              : /holiday|vacation/i.test(item.summary)
              ? "holiday"
              : /deadline|due/i.test(item.summary)
              ? "deadline"
              : "meeting",
            source: "google_calendar",
            reminders,
          },
        },
        { upsert: true, new: true }
      );
      syncedCount++;
    }

    return { synced: syncedCount, total: items.length };
  } catch (error) {
    console.warn("Failed to sync Google Calendar events:", error.message);
    return { synced: 0, error: error.message };
  }
}

async function createEvent({
  clerkUserId,
  decryptToken,
  title,
  description = "",
  startDate,
  endDate = null,
  isAllDay = false,
  priority = "medium",
  category = "other",
  source = "manual",
  reminders = [60],
  pushToGoogle = true,
}) {
  const parsedStartDate = new Date(startDate);
  if (isNaN(parsedStartDate.getTime())) {
    throw new Error("Invalid startDate provided for calendar event.");
  }
  const parsedEndDate = endDate && !isNaN(new Date(endDate).getTime())
    ? new Date(endDate)
    : new Date(parsedStartDate.getTime() + 3600000);

  let googleEventId = null;

  if (pushToGoogle) {
    try {
      const clientData = await getGoogleCalendarClient(clerkUserId, decryptToken);
      if (clientData?.calendar) {
        const { calendar } = clientData;
        const gEvent = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: title,
            description: `${description}\n\n[Priority: ${priority.toUpperCase()}] [Scheduled by AI Assistant]`,
            start: isAllDay
              ? { date: parsedStartDate.toISOString().split("T")[0] }
              : { dateTime: parsedStartDate.toISOString() },
            end: isAllDay
              ? { date: parsedEndDate.toISOString().split("T")[0] }
              : { dateTime: parsedEndDate.toISOString() },
            reminders: {
              useDefault: false,
              overrides: (reminders.length ? reminders : [60]).map((mins) => ({
                method: "popup",
                minutes: mins,
              })),
            },
          },
        });
        googleEventId = gEvent.data.id;
      }
    } catch (gErr) {
      console.warn("Could not insert directly to Google Calendar:", gErr.message);
    }
  }

  const created = await CalendarEvent.create({
    clerkUserId,
    googleEventId,
    title,
    description,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    isAllDay,
    priority,
    category,
    source,
    reminders,
  });

  return created;
}

async function getAggregatedEvents(clerkUserId, { startDate, endDate }) {
  const query = { clerkUserId };
  if (startDate || endDate) {
    query.startDate = {};
    if (startDate) query.startDate.$gte = new Date(startDate);
    if (endDate) query.startDate.$lte = new Date(endDate);
  }

  const calendarEvents = await CalendarEvent.find(query).sort({ startDate: 1 }).lean();

  // Also include deadlines extracted from emails
  const emailsWithDeadlines = await Email.find({
    clerkUserId,
    $or: [
      { deadlines: { $exists: true, $not: { $size: 0 } } },
      { "actionItems.dueDate": { $exists: true, $ne: null } },
    ],
  })
    .select("subject from priority priorityScore deadlines actionItems receivedAt")
    .sort({ receivedAt: -1 })
    .lean();

  return {
    calendarEvents,
    emailsWithDeadlines,
  };
}

module.exports = {
  CALENDAR_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  getGoogleCalendarClient,
  syncGoogleCalendarEvents,
  createEvent,
  getAggregatedEvents,
};
