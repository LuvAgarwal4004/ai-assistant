
const mongoose = require("mongoose");

const EmailAnalysisJobSchema = new mongoose.Schema(
  {
    clerkUserId: { type: String, required: true },
    gmailMessageId: { type: String, required: true },
    contentHash: { type: String, required: true },

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

EmailAnalysisJobSchema.index(
  { clerkUserId: 1, gmailMessageId: 1, contentHash: 1 },
  { unique: true }
);
EmailAnalysisJobSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports =
  mongoose.models.EmailAnalysisJob ||
  mongoose.model("EmailAnalysisJob", EmailAnalysisJobSchema);
