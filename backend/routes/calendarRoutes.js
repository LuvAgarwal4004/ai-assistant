const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { google } = require("googleapis");
const CalendarEvent = require("../models/CalendarEvent");
const GmailConnection = require("../models/GmailConnection");
const GmailOAuthState = require("../models/GmailOAuthState");
const {
  CALENDAR_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  syncGoogleCalendarEvents,
  createEvent,
  getAggregatedEvents,
} = require("../services/calendarService");

function hashState(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function createCalendarRouter({ requireClerkUser, decryptToken }) {
  const router = express.Router();

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Return Google Calendar connection status
  router.get("/calendar/status", requireClerkUser, async (req, res) => {
    try {
      const connection = await GmailConnection.findOne({
        clerkUserId: req.clerkUserId,
      }).select("googleEmail connectedAt scopes");

      if (!connection) {
        return res.json({
          connected: false,
          calendarConnected: false,
          email: null,
          scopes: [],
        });
      }

      const hasCalendar = (connection.scopes || []).some(
        (s) =>
          s.includes("calendar") ||
          s === CALENDAR_SCOPE ||
          s === CALENDAR_EVENTS_SCOPE
      );

      return res.json({
        connected: true,
        calendarConnected: hasCalendar,
        email: connection.googleEmail,
        scopes: connection.scopes,
      });
    } catch (error) {
      console.error("Calendar status lookup failed:", error.message);
      return res.status(500).json({ error: "Could not load Calendar status." });
    }
  });

  // Start OAuth with Google Calendar scopes
  router.post("/calendar/connect", requireClerkUser, async (req, res) => {
    try {
      const state = crypto.randomBytes(32).toString("hex");

      await GmailOAuthState.create({
        stateHash: hashState(state),
        clerkUserId: req.clerkUserId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
      const scopes = [
        GMAIL_SCOPE,
        CALENDAR_SCOPE,
        CALENDAR_EVENTS_SCOPE,
      ];

      const authorizationUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        include_granted_scopes: true,
        prompt: "consent",
        state,
      });

      return res.json({ authorizationUrl });
    } catch (error) {
      console.error("Could not start Calendar OAuth:", error.message);
      return res.status(500).json({
        error: "Could not start Google Calendar connection.",
      });
    }
  });

  // Get aggregated events (Google Calendar + DB events + Email deadlines)
  router.get("/calendar/events", requireClerkUser, async (req, res) => {
    try {
      const { start, end } = req.query;
      const data = await getAggregatedEvents(req.clerkUserId, {
        startDate: start,
        endDate: end,
      });

      return res.json(data);
    } catch (error) {
      console.error("Failed to load calendar events:", error.message);
      return res.status(500).json({ error: "Could not load calendar events." });
    }
  });

  // Create an event manually or from AI
  router.post("/calendar/events", requireClerkUser, async (req, res) => {
    try {
      const {
        title,
        description,
        startDate,
        endDate,
        isAllDay,
        priority,
        category,
        reminders,
        pushToGoogle = true,
      } = req.body;

      if (!title || !startDate) {
        return res.status(400).json({ error: "Title and startDate are required." });
      }

      const event = await createEvent({
        clerkUserId: req.clerkUserId,
        decryptToken,
        title,
        description,
        startDate,
        endDate,
        isAllDay,
        priority,
        category,
        source: "manual",
        reminders,
        pushToGoogle,
      });

      return res.json({ ok: true, event });
    } catch (error) {
      console.error("Failed to create event:", error.message);
      return res.status(500).json({ error: "Could not create event." });
    }
  });

  // Trigger sync with Google Calendar
  router.post("/calendar/sync", requireClerkUser, async (req, res) => {
    try {
      const result = await syncGoogleCalendarEvents({
        clerkUserId: req.clerkUserId,
        decryptToken,
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Calendar sync failed:", error.message);
      return res.status(500).json({ error: "Failed to sync Google Calendar." });
    }
  });

  // Delete event
  router.delete("/calendar/events/:id", requireClerkUser, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "Invalid event ID." });
      }

      const event = await CalendarEvent.findOneAndDelete({
        _id: req.params.id,
        clerkUserId: req.clerkUserId,
      });

      if (!event) {
        return res.status(404).json({ error: "Event not found." });
      }

      return res.json({ ok: true, deleted: true });
    } catch (error) {
      console.error("Delete event failed:", error.message);
      return res.status(500).json({ error: "Could not delete event." });
    }
  });

  return router;
}

module.exports = createCalendarRouter;
