
const express = require("express");
const mongoose = require("mongoose");

const Email = require("../models/Email");
const EmailAnalysisJob = require("../models/EmailAnalysisJob");
const { syncUserEmails, getSyncStatus } = require("../services/gmailSyncService");
const { startEmailAnalysisWorker } = require("../services/emailAnalysisService");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createEmailRouter({ requireClerkUser, decryptToken }) {
  const router = express.Router();

  startEmailAnalysisWorker();

  router.post("/email/sync", requireClerkUser, async (req, res) => {
    try {
      const days = Number(req.body?.days ?? 30);

      if (![30, 60].includes(days)) {
        return res.status(400).json({
          error: "The days value must be 30 or 60.",
        });
      }

      const result = await syncUserEmails({
        clerkUserId: req.clerkUserId,
        days,
        decryptToken,
      });

      return res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      const status = error.statusCode || 500;

      console.error("Email sync failed:", error.message);

      return res.status(status).json({
        error:
          status === 500
            ? "Gmail sync failed. Check the backend logs and try again."
            : error.message,
      });
    }
  });

  router.get("/email/sync-status", requireClerkUser, async (req, res) => {
    try {
      const status = await getSyncStatus(req.clerkUserId);
      return res.json(status);
    } catch (error) {
      console.error("Sync status failed:", error.message);
      return res.status(500).json({ error: "Could not load sync status." });
    }
  });

  router.get("/emails", requireClerkUser, async (req, res) => {
    try {
      const query = String(req.query.q || "").trim().slice(0, 100);
      const priority = String(req.query.priority || "").toLowerCase();
      const category = String(req.query.category || "").toLowerCase();
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));

      const filter = { clerkUserId: req.clerkUserId };

      if (["high", "medium", "low"].includes(priority)) {
        filter.priority = priority;
      }

      const categories = [
        "work", "personal", "finance", "travel",
        "promotion", "social", "updates", "other",
      ];

      if (categories.includes(category)) {
        filter.category = category;
      }

      if (query) {
        const safeQuery = new RegExp(escapeRegex(query), "i");
        filter.$or = [
          { from: safeQuery },
          { to: safeQuery },
          { subject: safeQuery },
          { snippet: safeQuery },
          { summary: safeQuery },
          { bodyText: safeQuery },
        ];
      }

      const [emails, total] = await Promise.all([
        Email.find(filter)
          .select("-bodyText")
          .sort({ receivedAt: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Email.countDocuments(filter),
      ]);

      return res.json({
        emails,
        page,
        limit,
        total,
        hasMore: page * limit < total,
      });
    } catch (error) {
      console.error("Email list failed:", error.message);
      return res.status(500).json({ error: "Could not load emails." });
    }
  });

  router.get("/emails/:id", requireClerkUser, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "Invalid email ID." });
      }

      const email = await Email.findOne({
        _id: req.params.id,
        clerkUserId: req.clerkUserId,
      }).select("+bodyText");

      if (!email) {
        return res.status(404).json({ error: "Email not found." });
      }

      return res.json({ email });
    } catch (error) {
      console.error("Email detail failed:", error.message);
      return res.status(500).json({ error: "Could not load email." });
    }
  });

  router.post("/emails/:id/analyze", requireClerkUser, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: "Invalid email ID." });
      }

      const email = await Email.findOne({
        _id: req.params.id,
        clerkUserId: req.clerkUserId,
      }).select("+bodyText");

      if (!email) {
        return res.status(404).json({ error: "Email not found." });
      }

      await Email.updateOne(
        { _id: email._id, clerkUserId: req.clerkUserId },
        { $set: { analysisStatus: "pending" } }
      );

      try {
        await EmailAnalysisJob.updateOne(
          {
            clerkUserId: req.clerkUserId,
            gmailMessageId: email.gmailMessageId,
            contentHash: email.contentHash,
          },
          {
            $set: {
              status: "pending",
              attempts: 0,
              nextAttemptAt: new Date(),
              lockedAt: null,
              lastError: null,
            },
            $setOnInsert: {
              clerkUserId: req.clerkUserId,
              gmailMessageId: email.gmailMessageId,
              contentHash: email.contentHash,
            },
          },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }

      return res.json({ queued: true });
    } catch (error) {
      console.error("Email re-analysis failed:", error.message);
      return res.status(500).json({ error: "Could not queue email analysis." });
    }
  });

  return router;
}

module.exports = createEmailRouter;
