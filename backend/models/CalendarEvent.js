const mongoose = require("mongoose");

const CalendarEventSchema = new mongoose.Schema(
  {
    clerkUserId: {
      type: String,
      required: true,
      index: true,
    },
    googleEventId: {
      type: String,
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },
    location: {
      type: String,
      default: "",
      maxlength: 300,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    isAllDay: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "medium",
      index: true,
    },
    category: {
      type: String,
      enum: [
        "exam",
        "holiday",
        "deadline",
        "meeting",
        "hackathon",
        "personal",
        "reminder",
        "other",
      ],
      default: "other",
    },
    source: {
      type: String,
      enum: [
        "google_calendar",
        "ai_chat",
        "email_deadline",
        "pdf_upload",
        "manual",
      ],
      default: "manual",
    },
    reminders: {
      type: [Number], // minutes before event, e.g. [1440, 60, 15]
      default: [60],
    },
    sourceEmailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Email",
      default: null,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

CalendarEventSchema.index({ clerkUserId: 1, startDate: 1 });
CalendarEventSchema.index({ clerkUserId: 1, priority: 1 });

module.exports =
  mongoose.models.CalendarEvent ||
  mongoose.model("CalendarEvent", CalendarEventSchema);
