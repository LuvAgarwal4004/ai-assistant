
const GmailConnection = require("../models/GmailConnection");
const GmailSyncState = require("../models/GmailSyncState");
const Email = require("../models/Email");
const EmailAnalysisJob = require("../models/EmailAnalysisJob");

const {
    createGmailClient,
    getProfile,
    listMessages,
    getMessage,
} = require("./gmailService");

const { ruleAnalysis } = require("./emailAnalysisService");

async function enqueueAnalysis(clerkUserId, messageId, contentHash) {
    try {
        await EmailAnalysisJob.updateOne(
            { clerkUserId, gmailMessageId: messageId, contentHash },
            {
                $setOnInsert: {
                    clerkUserId,
                    gmailMessageId: messageId,
                    contentHash,
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        // A duplicate-key race means another request already created the job.
        if (error.code !== 11000) throw error;
    }
}

async function saveMessage(clerkUserId, message) {
    const existing = await Email.findOne({
        clerkUserId,
        gmailMessageId: message.gmailMessageId,
    }).select("+bodyText");

    const changed = !existing || existing.contentHash !== message.contentHash;

    if (!changed) {
        await Email.updateOne(
            { _id: existing._id, clerkUserId },
            {
                $set: {
                    labels: message.labels,
                    isRead: message.isRead,
                    lastSyncedAt: new Date(),
                },
            }
        );

        return { imported: false, changed: false };
    }

    const rules = ruleAnalysis(message);

    const update = {
        ...message,
        ...rules,
        clerkUserId,
        analysisStatus: "pending",
        analysisProvider: "none",
        analyzedAt: null,
        lastSyncedAt: new Date(),
    };

    await Email.findOneAndUpdate(
        { clerkUserId, gmailMessageId: message.gmailMessageId },
        { $set: update },
        { upsert: true, new: true, runValidators: true }
    );

    await enqueueAnalysis(
        clerkUserId,
        message.gmailMessageId,
        message.contentHash
    );

    return { imported: !existing, changed: true };
}

async function importPage(gmail, clerkUserId, state) {
    const response = await listMessages(gmail, {
        days: state.initialDays,
        pageToken: state.pageToken,
    });

    const messages = response.messages || [];
    let imported = 0;
    let updated = 0;

    // Limit concurrent Gmail requests to avoid creating a large burst.
    for (let i = 0; i < messages.length; i += 5) {
        const batch = messages.slice(i, i + 5);

        const results = await Promise.all(
            batch.map(async (item) => {
                try {
                    const message = await getMessage(gmail, item.id);
                    return await saveMessage(clerkUserId, message);
                } catch (error) {
                    console.error(
                        `Could not import Gmail message ${item.id}:`,
                        error.message
                    );
                    throw error;
                }
            })
        );

        for (const result of results) {
            if (result.imported) imported++;
            else if (result.changed) updated++;
        }
    }

    state.pageToken = response.nextPageToken || null;
    state.initialSyncComplete = !response.nextPageToken;
    state.syncStatus = "idle";
    state.lastSyncAt = new Date();
    state.lastError = null;
    await state.save();

    return {
        mode: "initial",
        imported,
        updated,
        hasMore: Boolean(response.nextPageToken),
        initialSyncComplete: state.initialSyncComplete,
    };
}

async function incrementalSync(gmail, clerkUserId, state) {
    if (!state.historyId) {
        state.initialSyncStarted = false;
        state.initialSyncComplete = false;
        state.pageToken = null;
        await state.save();

        return null;
    }

    const changedIds = new Set();
    const deletedIds = new Set();
    let pageToken;

    try {
        do {
            const response = await gmail.users.history.list({
                userId: "me",
                startHistoryId: state.historyId,
                maxResults: 500,
                pageToken,
            });

            for (const record of response.data.history || []) {
                for (const item of record.messagesAdded || []) {
                    if (item.message?.id) changedIds.add(item.message.id);
                }
                for (const item of record.labelsAdded || []) {
                    if (item.message?.id) changedIds.add(item.message.id);
                }
                for (const item of record.labelsRemoved || []) {
                    if (item.message?.id) changedIds.add(item.message.id);
                }
                for (const item of record.messagesDeleted || []) {
                    if (item.message?.id) deletedIds.add(item.message.id);
                }
            }

            pageToken = response.data.nextPageToken;
            if (!pageToken && response.data.historyId) {
                state.historyId = response.data.historyId;
            }
        } while (pageToken);
    } catch (error) {
        if (error.response?.status === 404) {
            // Gmail history expired. Reset to a recoverable full sync.
            state.initialSyncStarted = false;
            state.initialSyncComplete = false;
            state.pageToken = null;
            state.historyId = null;
            await state.save();
            return null;
        }

        throw error;
    }

    for (const messageId of deletedIds) {
        await Email.deleteOne({ clerkUserId, gmailMessageId: messageId });
    }

    let imported = 0;
    let updated = 0;

    for (const messageId of changedIds) {
        // The history feed can include a message that has since been deleted.
        try {
            const message = await getMessage(gmail, messageId);
            const result = await saveMessage(clerkUserId, message);

            if (result.imported) imported++;
            else if (result.changed) updated++;
        } catch (error) {
            if (error.response?.status === 404) {
                await Email.deleteOne({ clerkUserId, gmailMessageId: messageId });
            } else {
                throw error;
            }
        }
    }

    state.syncStatus = "idle";
    state.lastSyncAt = new Date();
    state.lastError = null;
    await state.save();

    return {
        mode: "incremental",
        imported,
        updated,
        deleted: deletedIds.size,
        hasMore: false,
        initialSyncComplete: true,
    };
}

async function syncUserEmails({ clerkUserId, days, decryptToken }) {
    const connection = await GmailConnection.findOne({ clerkUserId })
        .select("+encryptedRefreshToken");

    if (!connection) {
        const error = new Error("Connect your Gmail account in Settings first.");
        error.statusCode = 409;
        throw error;
    }

    let state = await GmailSyncState.findOne({ clerkUserId });

    if (!state) {
        state = await GmailSyncState.create({ clerkUserId });
    }
    // If the user requests a wider or narrower history after a completed
    // import, start a fresh import using the newly selected range.
    if (
        state.initialSyncComplete &&
        [30, 60].includes(days) &&
        state.initialDays !== days
    ) {
        state.initialSyncStarted = false;
        state.initialSyncComplete = false;
        state.pageToken = null;
        state.historyId = null;
        await state.save();
    }

    // Reject overlapping syncs for the same user.
    if (
        state.syncStatus === "syncing" &&
        state.updatedAt &&
        Date.now() - state.updatedAt.getTime() < 2 * 60 * 1000
    ) {
        const error = new Error("A Gmail sync is already in progress.");
        error.statusCode = 409;
        throw error;
    }

    state.syncStatus = "syncing";
    state.lastError = null;
    await state.save();

    try {
        const gmail = createGmailClient(connection, decryptToken);

        if (!state.initialSyncStarted || !state.initialSyncComplete) {
            if (!state.initialSyncStarted) {
                if (![30, 60].includes(days)) {
                    const error = new Error("Choose either 30 or 60 days.");
                    error.statusCode = 400;
                    throw error;
                }

                const profile = await getProfile(gmail);

                state.historyId = profile.historyId || null;
                state.initialDays = days;
                state.initialSyncStarted = true;
                state.initialSyncComplete = false;
                state.pageToken = null;
                await state.save();
            }

            return await importPage(gmail, clerkUserId, state);
        }

        let result = await incrementalSync(gmail, clerkUserId, state);

        // A missing/expired history ID requires a new initial import.
        if (!result) {
            state = await GmailSyncState.findOne({ clerkUserId });
            state.initialSyncStarted = false;
            state.initialSyncComplete = false;
            state.pageToken = null;
            state.historyId = null;
            state.initialDays = 60;
            await state.save();

            const profile = await getProfile(gmail);
            state.historyId = profile.historyId || null;
            state.initialSyncStarted = true;
            state.initialDays = 60;
            await state.save();

            result = await importPage(gmail, clerkUserId, state);
            result.recoverySync = true;
        }

        return result;
    } catch (error) {
        await GmailSyncState.updateOne(
            { clerkUserId },
            {
                $set: {
                    syncStatus: "error",
                    lastError: String(error.message || "Sync failed").slice(0, 500),
                },
            }
        );

        throw error;
    }
}

async function getSyncStatus(clerkUserId) {
    const state = await GmailSyncState.findOne({ clerkUserId }).lean();

    const [total, pendingAnalysis] = await Promise.all([
        Email.countDocuments({ clerkUserId }),
        Email.countDocuments({
            clerkUserId,
            analysisStatus: { $in: ["pending", "processing"] },
        }),
    ]);

    return {
        syncStatus: state?.syncStatus || "idle",
        initialSyncStarted: state?.initialSyncStarted || false,
        initialSyncComplete: state?.initialSyncComplete || false,
        lastSyncAt: state?.lastSyncAt || null,
        lastError: state?.lastError || null,
        totalEmails: total,
        pendingAnalysis,
    };
}

module.exports = { syncUserEmails, getSyncStatus };
