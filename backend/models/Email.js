
const mongoose = require("mongoose");

const ActionItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, maxlength: 500 },
    dueDate: { type: String, default: null, maxlength: 100 },
  },
  { _id: false }
);

const EmailSchema = new mongoose.Schema(
  {
    clerkUserId: { type: String, required: true, index: true },
    gmailMessageId: { type: String, required: true },
    threadId: { type: String, default: null },

    from: { type: String, default: "" },
    to: { type: String, default: "" },
    subject: { type: String, default: "(No subject)" },
    snippet: { type: String, default: "" },
    bodyText: { type: String, default: "", select: false },

    receivedAt: { type: Date, default: null },
    labels: { type: [String], default: [] },
    isRead: { type: Boolean, default: false },

    contentHash: { type: String, required: true },
    summary: { type: String, default: "" },
    category: {
      type: String,
      enum: [
        "work",
        "personal",
        "finance",
        "travel",
        "promotion",
        "social",
        "updates",
        "other",
      ],
      default: "other",
    },
    priority: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "low",
    },
    priorityScore: { type: Number, default: 0, min: 0, max: 100 },
    priorityReason: { type: String, default: "" },
    actionItems: { type: [ActionItemSchema], default: [] },
    deadlines: { type: [String], default: [] },

    analysisStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    analysisProvider: {
      type: String,
      enum: ["rules", "gemini", "none"],
      default: "none",
    },
    analyzedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

EmailSchema.index(
  { clerkUserId: 1, gmailMessageId: 1 },
  { unique: true }
);
EmailSchema.index({ clerkUserId: 1, receivedAt: -1 });
EmailSchema.index({ clerkUserId: 1, priority: 1, receivedAt: -1 });
EmailSchema.index({ clerkUserId: 1, analysisStatus: 1 });

module.exports =
  mongoose.models.Email || mongoose.model("Email", EmailSchema);
