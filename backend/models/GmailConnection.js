
const mongoose = require("mongoose");

const GmailConnectionSchema = new mongoose.Schema(
  {
    clerkUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    googleEmail: {
      type: String,
      required: true,
    },

    encryptedRefreshToken: {
      type: String,
      required: true,
      select: false,
    },

    scopes: {
      type: [String],
      default: [],
    },

    connectedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.GmailConnection ||
  mongoose.model("GmailConnection", GmailConnectionSchema);
