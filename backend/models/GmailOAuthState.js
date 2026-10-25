
const mongoose = require("mongoose");

const GmailOAuthStateSchema = new mongoose.Schema(
  {
    stateHash: {
      type: String,
      required: true,
      unique: true,
    },

    clerkUserId: {
      type: String,
      required: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.GmailOAuthState ||
  mongoose.model("GmailOAuthState", GmailOAuthStateSchema);
