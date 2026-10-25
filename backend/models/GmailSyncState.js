
const mongoose = require("mongoose");

const GmailSyncStateSchema = new mongoose.Schema(
  {
    clerkUserId: { type: String, required: true, unique: true },
    historyId: { type: String, default: null },

    initialSyncStarted: { type: Boolean, default: false },
    initialSyncComplete: { type: Boolean, default: false },
    initialDays: { type: Number, enum: [30, 60], default: 30 },
    pageToken: { type: String, default: null },

    syncStatus: {
      type: String,
      enum: ["idle", "syncing", "error"],
      default: "idle",
    },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.GmailSyncState ||
  mongoose.model("GmailSyncState", GmailSyncStateSchema);
