const express = require("express");
const UserMemory = require("../models/UserMemory");
const { processAIChat, processPdfCalendarUpload } = require("../services/aiChatService");

function createAiRouter({ requireClerkUser, decryptToken }) {
  const router = express.Router();

  // Send message to AI Copilot
  router.post("/ai/chat", requireClerkUser, async (req, res) => {
    try {
      const { message, conversationHistory = [] } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "A message string is required." });
      }

      const result = await processAIChat({
        clerkUserId: req.clerkUserId,
        message,
        conversationHistory,
        decryptToken,
      });

      return res.json(result);
    } catch (error) {
      console.error("AI chat processing failed:", error.message);
      return res.status(500).json({
        error: error.message || "Failed to process message with AI Copilot.",
      });
    }
  });

  // Upload and parse college calendar / syllabus PDF
  router.post("/ai/upload-pdf", requireClerkUser, async (req, res) => {
    try {
      const { pdfBase64, fileName } = req.body;
      if (!pdfBase64 || typeof pdfBase64 !== "string") {
        return res.status(400).json({ error: "pdfBase64 is required." });
      }

      const result = await processPdfCalendarUpload({
        clerkUserId: req.clerkUserId,
        pdfBase64,
        fileName: fileName || "calendar.pdf",
        decryptToken,
      });

      return res.json(result);
    } catch (error) {
      console.error("PDF schedule upload failed:", error.message);
      return res.status(500).json({
        error: error.message || "Could not analyze and extract schedule from PDF.",
      });
    }
  });

  // Get user personal AI memory
  router.get("/ai/memory", requireClerkUser, async (req, res) => {
    try {
      let memory = await UserMemory.findOne({ clerkUserId: req.clerkUserId });
      if (!memory) {
        memory = await UserMemory.create({ clerkUserId: req.clerkUserId });
      }

      return res.json({ memory });
    } catch (error) {
      console.error("Failed to load user memory:", error.message);
      return res.status(500).json({ error: "Could not load AI memory." });
    }
  });

  // Update user personal AI memory
  router.put("/ai/memory", requireClerkUser, async (req, res) => {
    try {
      const {
        prioritySenders,
        importantTopics,
        ignoredTopics,
        preferredReminderTiming,
        customRules,
      } = req.body;

      const update = {};
      if (Array.isArray(prioritySenders)) update.prioritySenders = prioritySenders;
      if (Array.isArray(importantTopics)) update.importantTopics = importantTopics;
      if (Array.isArray(ignoredTopics)) update.ignoredTopics = ignoredTopics;
      if (Array.isArray(preferredReminderTiming)) update.preferredReminderTiming = preferredReminderTiming;
      if (Array.isArray(customRules)) update.customRules = customRules;

      const memory = await UserMemory.findOneAndUpdate(
        { clerkUserId: req.clerkUserId },
        { $set: update },
        { upsert: true, new: true }
      );

      return res.json({ ok: true, memory });
    } catch (error) {
      console.error("Failed to update AI memory:", error.message);
      return res.status(500).json({ error: "Could not update AI memory." });
    }
  });

  return router;
}

module.exports = createAiRouter;
