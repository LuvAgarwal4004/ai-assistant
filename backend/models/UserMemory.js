const mongoose = require("mongoose");

const UserMemorySchema = new mongoose.Schema(
  {
    clerkUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    prioritySenders: {
      type: [String],
      default: [], // e.g. ["boss@company.com", "@university.edu"]
    },
    importantTopics: {
      type: [String],
      default: ["hackathon", "exam", "interview", "assignment", "deadline"],
    },
    ignoredTopics: {
      type: [String],
      default: ["marketing", "newsletter", "sale", "discount", "promotional"],
    },
    preferredReminderTiming: {
      type: [Number],
      default: [1440, 60], // 1 day before (1440 mins) and 1 hour before (60 mins)
    },
    customRules: {
      type: [String],
      default: [], // e.g. "Mark emails from university administration as high priority"
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.UserMemory ||
  mongoose.model("UserMemory", UserMemorySchema);
