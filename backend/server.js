
require("dotenv").config();
const createEmailRouter = require("./routes/emailRoutes");
const createCalendarRouter = require("./routes/calendarRoutes");
const createAiRouter = require("./routes/aiRoutes");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { google } = require("googleapis");
const { verifyToken } = require("@clerk/backend");

const GmailConnection = require("./models/GmailConnection");
const GmailOAuthState = require("./models/GmailOAuthState");

const app = express();
app.use(cors());

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use(
  "/api",
  createEmailRouter({
    requireClerkUser,
    decryptToken,
  })
);

app.use(
  "/api",
  createCalendarRouter({
    requireClerkUser,
    decryptToken,
  })
);

app.use(
  "/api",
  createAiRouter({
    requireClerkUser,
    decryptToken,
  })
);
const PORT = Number(process.env.PORT || 4000);
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const requiredVariables = [
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "MONGODB_URI",
  "TOKEN_ENCRYPTION_KEY",
  "EXPO_REDIRECT_URI",
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing backend environment variable: ${variable}`);
  }
}

if (!/^[a-fA-F0-9]{64}$/.test(process.env.TOKEN_ENCRYPTION_KEY)) {
  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters."
  );
}

const encryptionKey = Buffer.from(
  process.env.TOKEN_ENCRYPTION_KEY,
  "hex"
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function hashState(state) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

function encryptToken(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Store IV, authentication tag and ciphertext together.
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decryptToken(encryptedValue) {
  const [ivHex, authTagHex, encryptedHex] = encryptedValue.split(":");

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Stored Gmail token has an invalid format.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

async function requireClerkUser(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        error: "Please sign in first.",
      });
    }

    const verified = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    if (!verified.sub) {
      return res.status(401).json({
        error: "Invalid user session.",
      });
    }

    req.clerkUserId = verified.sub;
    next();
  } catch (error) {
    console.error("Clerk verification failed:", error.message);

    return res.status(401).json({
      error: "Your session is invalid or expired. Please sign in again.",
    });
  }
}

function redirectToApp(result, extraParams = {}) {
  const base = process.env.EXPO_REDIRECT_URI;
  const separator = base.includes("?") ? "&" : "?";
  let url = `${base}${separator}gmail=${encodeURIComponent(result)}`;
  for (const [k, v] of Object.entries(extraParams)) {
    url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }
  return url;
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "AI Assistant backend",
  });
});

app.get("/api/me", requireClerkUser, (req, res) => {
  res.json({
    authenticated: true,
    clerkUserId: req.clerkUserId,
  });
});

// Create a short-lived, single-use OAuth state and return Google's URL.
app.post("/api/gmail/connect", requireClerkUser, async (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");

    await GmailOAuthState.create({
      stateHash: hashState(state),
      clerkUserId: req.clerkUserId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [GMAIL_SCOPE],
      include_granted_scopes: true,
      prompt: "consent",
      state,
    });

    return res.json({ authorizationUrl });
  } catch (error) {
    console.error("Could not start Gmail OAuth:", error.message);

    return res.status(500).json({
      error: "Could not start Gmail connection. Please try again.",
    });
  }
});

// Google redirects here after the user approves or denies access.
app.get("/auth/google/callback", async (req, res) => {
  let stateRecord = null;

  try {
    const { code, state, error } = req.query;

    if (error) {
      if (typeof state === "string") {
        stateRecord = await GmailOAuthState.findOneAndDelete({
          stateHash: hashState(state),
        });
      }

      if (!stateRecord || stateRecord.expiresAt <= new Date()) {
        return res.status(400).send(
          "OAuth request expired or invalid. Return to the app and try again."
        );
      }

      return res.redirect(redirectToApp("cancelled"));
    }

    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).send("Missing OAuth code or state.");
    }

    // Atomically consume the state. Replaying it will not work.
    stateRecord = await GmailOAuthState.findOneAndDelete({
      stateHash: hashState(state),
      expiresAt: { $gt: new Date() },
    });

    if (!stateRecord) {
      return res.status(400).send(
        "OAuth state is invalid, expired, or already used. Return to the app and try again."
      );
    }

    const { tokens } = await oauth2Client.getToken(code);

    // Google may omit refresh_token on later authorizations.
    // Preserve the existing refresh token if one is already stored.
    const existing = await GmailConnection.findOne({
      clerkUserId: stateRecord.clerkUserId,
    }).select("+encryptedRefreshToken");

    const refreshToken =
      tokens.refresh_token ||
      (existing
        ? decryptToken(existing.encryptedRefreshToken)
        : null);

    if (!refreshToken) {
      return res.status(400).send(
        "Google did not provide offline access. Please return to the app and try connecting again."
      );
    }

    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    const profile = await gmail.users.getProfile({ userId: "me" });

    if (!profile.data.emailAddress) {
      throw new Error("Google did not return a Gmail email address.");
    }

    const encryptedRefreshToken = encryptToken(refreshToken);

    await GmailConnection.findOneAndUpdate(
      { clerkUserId: stateRecord.clerkUserId },
      {
        $set: {
          clerkUserId: stateRecord.clerkUserId,
          googleEmail: profile.data.emailAddress,
          encryptedRefreshToken,
          scopes: tokens.scope
            ? tokens.scope.split(" ")
            : [GMAIL_SCOPE],
          connectedAt: new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    const grantedScopes = tokens.scope || "";
    const calendarGranted = grantedScopes.includes("calendar");

    return res.redirect(
      redirectToApp("connected", {
        calendar: calendarGranted ? "connected" : "none",
      })
    );
  } catch (error) {
    console.error(
      "Gmail OAuth callback failed:",
      error.response?.data || error.message
    );

    return res.redirect(redirectToApp("error"));
  }
});

// Return only safe account metadata, never the refresh token.
app.get("/api/gmail/status", requireClerkUser, async (req, res) => {
  try {
    const connection = await GmailConnection.findOne({
      clerkUserId: req.clerkUserId,
    }).select("googleEmail connectedAt scopes");

    return res.json({
      connected: Boolean(connection),
      email: connection?.googleEmail || null,
      connectedAt: connection?.connectedAt || null,
      scopes: connection?.scopes || [],
    });
  } catch (error) {
    console.error("Gmail status lookup failed:", error.message);

    return res.status(500).json({
      error: "Could not load Gmail connection status.",
    });
  }
});

// Disconnect only the currently authenticated user's Gmail account.
app.delete("/api/gmail/disconnect", requireClerkUser, async (req, res) => {
  try {
    const connection = await GmailConnection.findOne({
      clerkUserId: req.clerkUserId,
    }).select("+encryptedRefreshToken");

    if (!connection) {
      return res.json({ disconnected: true });
    }

    // Delete the local credential even if Google's revoke endpoint fails.
    // A failure to revoke is reported so it can be addressed separately.
    let revocationWarning = null;

    try {
      const refreshToken = decryptToken(
        connection.encryptedRefreshToken
      );

      await oauth2Client.revokeToken(refreshToken);
    } catch (error) {
      console.error("Google token revocation failed:", error.message);
      revocationWarning =
        "The local connection was removed, but Google revocation could not be confirmed. You can also remove access in your Google Account security settings.";
    }

    await GmailConnection.deleteOne({
      _id: connection._id,
      clerkUserId: req.clerkUserId,
    });

    await GmailOAuthState.deleteMany({
      clerkUserId: req.clerkUserId,
    });

    return res.json({
      disconnected: true,
      warning: revocationWarning,
    });
  } catch (error) {
    console.error("Gmail disconnect failed:", error.message);

    return res.status(500).json({
      error: "Could not disconnect Gmail. Please try again.",
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error." : err.message,
  });
});

async function startServer() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY is not set. AI Copilot features will be unavailable.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  console.log("MongoDB connected successfully.");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
