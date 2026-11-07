const UserMemory = require("../models/UserMemory");
const CalendarEvent = require("../models/CalendarEvent");
const Email = require("../models/Email");
const { createEvent, getGoogleCalendarClient } = require("./calendarService");

function getGeminiEndpoint(modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = modelName || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function callGemini(payload) {
  const models = [
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  let lastError = null;
  for (const model of [...new Set(models)]) {
    try {
      const endpoint = getGeminiEndpoint(model);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const output = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      if (output) return output;
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${model} attempt failed:`, err.message);
    }
  }

  throw lastError || new Error("Gemini generation failed.");
}

async function processAIChat({
  clerkUserId,
  message,
  conversationHistory = [],
  decryptToken,
}) {
  // 1. Load user memory
  let userMemory = await UserMemory.findOne({ clerkUserId });
  if (!userMemory) {
    userMemory = await UserMemory.create({ clerkUserId });
  }

  // 2. Load context (recent high-priority emails, upcoming events)
  const now = new Date();
  const upcomingEvents = await CalendarEvent.find({
    clerkUserId,
    startDate: { $gte: new Date(now.getTime() - 86400000) },
  })
    .sort({ startDate: 1 })
    .limit(10)
    .lean();

  const recentImportantEmails = await Email.find({
    clerkUserId,
    $or: [{ priority: "high" }, { "deadlines.0": { $exists: true } }],
  })
    .sort({ receivedAt: -1 })
    .limit(5)
    .select("from subject priority priorityReason deadlines actionItems")
    .lean();

  const systemPrompt = `
You are an intelligent, proactive executive AI Copilot for a busy user.
Today's Date/Time: ${now.toISOString()} (${now.toDateString()}).

User's current Personal AI Memory:
- Priority Senders: ${JSON.stringify(userMemory.prioritySenders || [])}
- Important Topics: ${JSON.stringify(userMemory.importantTopics || [])}
- Ignored Topics: ${JSON.stringify(userMemory.ignoredTopics || [])}
- Preferred Reminder Timing: ${JSON.stringify(userMemory.preferredReminderTiming || [1440, 60])} minutes before
- Custom Rules: ${JSON.stringify(userMemory.customRules || [])}

Context - Upcoming Events:
${JSON.stringify(upcomingEvents.map((e) => ({ title: e.title, date: e.startDate, priority: e.priority })))}

Context - Recent Important/Deadline Emails:
${JSON.stringify(recentImportantEmails.map((e) => ({ from: e.from, subject: e.subject, priority: e.priority, deadlines: e.deadlines })))}

Key Distinction Guideline:
- Distinguish priority preferences from actual deadlines!
- An email/event can be high priority because of sender or importance without having an urgent deadline.
- A marketing or promotional email might have an urgent countdown/deadline, but its true priority is LOW.
- Always be helpful, clear, and action-oriented.

Analyze the user's message. You can:
1. Schedule one or more events/tasks/timers in the calendar.
2. Update the user's Personal AI Memory (e.g. add/remove priority senders, important topics like hackathons, ignored topics, reminder timing, custom rules).
3. Set advance reminder timings.
4. Answer questions about upcoming deadlines, schedules, or memory preferences.

Return STRICT JSON with the following structure:
{
  "reply": "Your conversational answer to the user explaining what you did or answering their question.",
  "actions": {
    "scheduleEvents": [
      {
        "title": "Title of event",
        "description": "Details or notes",
        "startDate": "ISO-8601 string (e.g. 2026-10-26T10:00:00.000Z)",
        "endDate": "ISO-8601 string (optional)",
        "isAllDay": false,
        "priority": "high" | "medium" | "low",
        "category": "exam" | "holiday" | "deadline" | "meeting" | "hackathon" | "personal" | "reminder" | "other",
        "reminders": [1440, 60]
      }
    ],
    "memoryUpdates": {
      "addPrioritySenders": ["sender@example.com"],
      "removePrioritySenders": [],
      "addImportantTopics": ["hackathon", "internship"],
      "removeImportantTopics": [],
      "addIgnoredTopics": ["marketing"],
      "removeIgnoredTopics": [],
      "setPreferredReminderTiming": [1440, 60],
      "addCustomRules": ["rule string"]
    }
  }
}
`;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      ...conversationHistory.slice(-6).map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })),
      {
        role: "user",
        parts: [{ text: message }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      maxOutputTokens: 1500,
    },
  };

  const rawJson = await callGemini(payload);
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    parsed = {
      reply: rawJson.replace(/^```json/, "").replace(/```$/, "").trim(),
      actions: {},
    };
  }

  const executedActions = {
    scheduled: [],
    memoryUpdated: false,
  };

  // Execute memory updates if requested
  const mem = parsed.actions?.memoryUpdates;
  if (mem) {
    let changed = false;

    if (Array.isArray(mem.addPrioritySenders) && mem.addPrioritySenders.length) {
      userMemory.prioritySenders = [
        ...new Set([...userMemory.prioritySenders, ...mem.addPrioritySenders]),
      ];
      changed = true;
    }
    if (Array.isArray(mem.removePrioritySenders) && mem.removePrioritySenders.length) {
      userMemory.prioritySenders = userMemory.prioritySenders.filter(
        (s) => !mem.removePrioritySenders.includes(s)
      );
      changed = true;
    }

    if (Array.isArray(mem.addImportantTopics) && mem.addImportantTopics.length) {
      userMemory.importantTopics = [
        ...new Set([...userMemory.importantTopics, ...mem.addImportantTopics]),
      ];
      changed = true;
    }
    if (Array.isArray(mem.removeImportantTopics) && mem.removeImportantTopics.length) {
      userMemory.importantTopics = userMemory.importantTopics.filter(
        (t) => !mem.removeImportantTopics.includes(t)
      );
      changed = true;
    }

    if (Array.isArray(mem.addIgnoredTopics) && mem.addIgnoredTopics.length) {
      userMemory.ignoredTopics = [
        ...new Set([...userMemory.ignoredTopics, ...mem.addIgnoredTopics]),
      ];
      changed = true;
    }
    if (Array.isArray(mem.removeIgnoredTopics) && mem.removeIgnoredTopics.length) {
      userMemory.ignoredTopics = userMemory.ignoredTopics.filter(
        (t) => !mem.removeIgnoredTopics.includes(t)
      );
      changed = true;
    }

    if (Array.isArray(mem.setPreferredReminderTiming) && mem.setPreferredReminderTiming.length) {
      userMemory.preferredReminderTiming = mem.setPreferredReminderTiming;
      changed = true;
    }

    if (Array.isArray(mem.addCustomRules) && mem.addCustomRules.length) {
      userMemory.customRules = [
        ...new Set([...userMemory.customRules, ...mem.addCustomRules]),
      ];
      changed = true;
    }

    if (changed) {
      await userMemory.save();
      executedActions.memoryUpdated = true;
    }
  }

  // Execute scheduling if requested
  const eventsToSchedule = parsed.actions?.scheduleEvents || [];
  for (const ev of eventsToSchedule) {
    if (!ev.title || !ev.startDate) continue;

    const created = await createEvent({
      clerkUserId,
      decryptToken,
      title: ev.title,
      description: ev.description || "",
      startDate: new Date(ev.startDate),
      endDate: ev.endDate ? new Date(ev.endDate) : null,
      isAllDay: Boolean(ev.isAllDay),
      priority: ["high", "medium", "low"].includes(ev.priority) ? ev.priority : "medium",
      category: ev.category || "other",
      source: "ai_chat",
      reminders: Array.isArray(ev.reminders) && ev.reminders.length
        ? ev.reminders
        : userMemory.preferredReminderTiming || [60],
      pushToGoogle: true,
    });

    executedActions.scheduled.push(created);
  }

  return {
    reply: parsed.reply,
    actions: executedActions,
    updatedMemory: userMemory,
  };
}

async function processPdfCalendarUpload({
  clerkUserId,
  pdfBase64,
  fileName = "calendar.pdf",
  decryptToken,
}) {
  let userMemory = await UserMemory.findOne({ clerkUserId });
  const preferredReminders = userMemory?.preferredReminderTiming || [1440, 60];

  const prompt = `
You are an expert academic calendar and schedule parser.
Analyze this uploaded PDF file ("${fileName}"). It represents a college/university calendar, syllabus, exam timetable, or schedule.
Carefully read all dates, events, exams, assignments, semester holidays, and deadlines.

Instructions:
1. Extract EVERY distinct date and event mentioned.
2. For each event determine:
   - title: concise descriptive event name (e.g. "Midterm Exam - CS101", "Winter Break", "Hackathon Submission")
   - startDate: ISO 8601 string (e.g. "2026-11-10T09:00:00.000Z" or "2026-11-10"). If year is not mentioned, use 2026.
   - endDate: ISO 8601 string if the event spans multiple days.
   - isAllDay: true if it's a full-day event/holiday/date.
   - priority:
     * "high" for: exams, final tests, submission deadlines, hackathon finales.
     * "medium" for: quizzes, mid-terms, project reviews, workshops.
     * "low" for: holidays, sports day, general festivals.
   - category: "exam" | "holiday" | "deadline" | "hackathon" | "meeting" | "other"
   - description: brief context or subject info.

Return STRICT JSON matching this format:
{
  "summary": "Brief summary of what was found in the document",
  "events": [
    {
      "title": "string",
      "startDate": "YYYY-MM-DD or ISO string",
      "endDate": "YYYY-MM-DD or ISO string",
      "isAllDay": true,
      "priority": "high" | "medium" | "low",
      "category": "exam" | "holiday" | "deadline" | "hackathon" | "meeting" | "other",
      "description": "string"
    }
  ]
}
`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 3000,
    },
  };

  const rawJson = await callGemini(payload);
  const parsed = JSON.parse(rawJson);

  const importedEvents = [];
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  for (const item of events) {
    if (!item.title || !item.startDate) continue;

    const created = await createEvent({
      clerkUserId,
      decryptToken,
      title: item.title,
      description: item.description || `Extracted from ${fileName}`,
      startDate: new Date(item.startDate),
      endDate: item.endDate ? new Date(item.endDate) : null,
      isAllDay: item.isAllDay !== false,
      priority: ["high", "medium", "low"].includes(item.priority) ? item.priority : "medium",
      category: item.category || "other",
      source: "pdf_upload",
      reminders: preferredReminders,
      pushToGoogle: true,
    });

    importedEvents.push(created);
  }

  return {
    summary: parsed.summary || `Extracted and scheduled ${importedEvents.length} events from ${fileName}.`,
    eventsCount: importedEvents.length,
    events: importedEvents,
  };
}

module.exports = {
  processAIChat,
  processPdfCalendarUpload,
};
