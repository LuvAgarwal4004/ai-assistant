
const { google } = require("googleapis");
const crypto = require("crypto");

function createGmailClient(connection, decryptToken) {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth.setCredentials({
    refresh_token: decryptToken(connection.encryptedRefreshToken),
  });

  return google.gmail({ version: "v1", auth: oauth });
}

function decodeBase64Url(value) {
  if (!value) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

function collectBody(part, result = { plain: "", html: "" }) {
  if (!part) return result;

  const mimeType = String(part.mimeType || "").toLowerCase();
  const data = part.body?.data;

  if (data) {
    const decoded = decodeBase64Url(data);

    if (mimeType === "text/plain") {
      result.plain += `${decoded}\n`;
    } else if (mimeType === "text/html") {
      result.html += `${decoded}\n`;
    }
  }

  for (const child of part.parts || []) {
    collectBody(child, result);
  }

  return result;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getHeader(headers, name) {
  const header = (headers || []).find(
    (item) => String(item.name || "").toLowerCase() === name.toLowerCase()
  );

  return header?.value || "";
}

function parseMessage(message) {
  const payload = message.payload || {};
  const headers = payload.headers || [];
  const bodies = collectBody(payload);
  const bodyText = (
    bodies.plain.trim() || htmlToText(bodies.html)
  ).slice(0, 50000);

  const subject = getHeader(headers, "Subject") || "(No subject)";
  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const internalDate = Number(message.internalDate || 0);

  const receivedAt =
    Number.isFinite(internalDate) && internalDate > 0
      ? new Date(internalDate)
      : null;

  const labels = message.labelIds || [];
  const contentHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        from,
        to,
        subject,
        bodyText,
        snippet: message.snippet || "",
        receivedAt: receivedAt?.toISOString() || null,
      })
    )
    .digest("hex");

  return {
    gmailMessageId: message.id,
    threadId: message.threadId || null,
    from,
    to,
    subject,
    snippet: String(message.snippet || "").slice(0, 2000),
    bodyText,
    receivedAt,
    labels,
    isRead: !labels.includes("UNREAD"),
    contentHash,
  };
}

async function getProfile(gmail) {
  const response = await gmail.users.getProfile({ userId: "me" });
  return response.data;
}

async function listMessages(gmail, { days, pageToken }) {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `newer_than:${days}d`,
    maxResults: 50,
    pageToken: pageToken || undefined,
    includeSpamTrash: false,
  });

  return response.data;
}

async function getMessage(gmail, messageId) {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  return parseMessage(response.data);
}

module.exports = {
  createGmailClient,
  getProfile,
  listMessages,
  getMessage,
};
