// =============================================================================
// Email ingestion pipeline (provider-agnostic).
//
// processInboundEmail() is the single entry point for any mailbox provider
// (Graph today; IMAP later). Steps:
//   dedupe (internetMessageId ledger) -> loop guard (own mailbox, auto-reply
//   subjects) -> spam guard (per-sender rate) -> body extraction (HTML->text,
//   quoted-reply trimming) -> thread match -> append to the matched ticket as
//   a requester reply OR create a ticket via the unified intake -> persist
//   attachments -> record the ledger row + audit.
//
// The ledger row is created BEFORE ticket processing (status pending write),
// so a crash mid-pipeline cannot double-ingest on the next poll.
// =============================================================================

import { appendAudit } from "../audit/auditChain";
import { getStore } from "../data";
import { newId, now } from "../domain/ids";
import { logger } from "../observability/logger";
import { requesterReply } from "../services/agentActions";
import { AttachmentError, saveAttachment } from "../services/attachmentService";
import { intakeTicket } from "../services/intake";
import { bareAddress, htmlToText, trimQuotedReply } from "./emailText";
import { resolveThreadTicket } from "./emailThreading";
import type { EmailMessageRow, EmailStatus } from "../domain/models";

export interface InboundAttachment {
  fileName: string;
  mimeType: string;
  /** Base64-encoded content (Graph fileAttachment.contentBytes). */
  contentBase64: string;
}

export interface InboundEmail {
  providerId?: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
  from: string;
  to?: string | null;
  subject: string;
  bodyHtml?: string | null;
  bodyText?: string | null;
  receivedAt?: string | null;
  attachments?: InboundAttachment[];
}

export interface IngestResult {
  status: EmailStatus;
  ticketId?: string;
  reason?: string;
}

const AUTO_REPLY_SUBJECTS = [
  /^auto(matic)?[\s-]*reply/i,
  /^out of (the )?office/i,
  /^undeliverable/i,
  /^delivery (status notification|failure)/i,
  /^mail delivery failed/i,
];

/** Max tickets a single sender can open per hour before we flag spam. */
const SENDER_HOURLY_LIMIT = 10;

export async function processInboundEmail(
  tenantId: string,
  mail: InboundEmail,
  opts: { supportMailbox?: string | null } = {}
): Promise<IngestResult> {
  const store = await getStore();
  const from = bareAddress(mail.from);

  // ---- 1. Dedupe on internetMessageId --------------------------------------
  if (mail.internetMessageId) {
    const seen = await store.emails.list({
      tenantId,
      internetMessageId: mail.internetMessageId,
    } as Partial<EmailMessageRow>);
    if (seen.length > 0) {
      return { status: "skipped_duplicate", reason: "internetMessageId already ingested" };
    }
  }

  // Ledger row FIRST: the unique message id now blocks re-ingestion even if a
  // later step crashes before completion.
  const ledgerRow: EmailMessageRow = {
    id: newId("eml"),
    tenantId,
    direction: "inbound",
    providerId: mail.providerId ?? null,
    internetMessageId: mail.internetMessageId ?? null,
    conversationId: mail.conversationId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    referencesHeader: mail.referencesHeader ?? null,
    fromAddress: from,
    toAddress: mail.to ?? null,
    subject: mail.subject,
    bodyText: "",
    hasAttachments: (mail.attachments?.length ?? 0) > 0,
    status: "failed",
    ticketId: null,
    receivedAt: mail.receivedAt ?? null,
    createdAt: now(),
  };
  await store.emails.create(ledgerRow);

  const finish = async (status: EmailStatus, patch: Partial<EmailMessageRow> = {}): Promise<void> => {
    await store.emails.update(ledgerRow.id, { status, ...patch });
  };

  try {
    // ---- 2. Loop guard ------------------------------------------------------
    const mailbox = opts.supportMailbox?.toLowerCase();
    if (mailbox && from === mailbox) {
      await finish("skipped_loop");
      return { status: "skipped_loop", reason: "message from the support mailbox itself" };
    }
    if (AUTO_REPLY_SUBJECTS.some((rx) => rx.test(mail.subject.trim()))) {
      await finish("skipped_loop");
      return { status: "skipped_loop", reason: "auto-reply/bounce subject" };
    }

    // ---- 3. Spam guard (per-sender hourly rate) -----------------------------
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentFromSender = (await store.emails.list({ tenantId, fromAddress: from })).filter(
      (row) => row.id !== ledgerRow.id && new Date(row.createdAt).getTime() > hourAgo && row.status === "processed"
    );
    if (recentFromSender.length >= SENDER_HOURLY_LIMIT) {
      await finish("skipped_spam");
      await appendAudit({
        tenantId,
        actor: "email-ingest",
        action: "email.spam_suppressed",
        payload: { from, subject: mail.subject, perHour: recentFromSender.length },
      });
      return { status: "skipped_spam", reason: "sender hourly limit reached" };
    }

    // ---- 4. Body extraction -------------------------------------------------
    const rawText = mail.bodyText?.trim()
      ? mail.bodyText
      : mail.bodyHtml
      ? htmlToText(mail.bodyHtml)
      : "";

    // ---- 5. Thread match ----------------------------------------------------
    const match = await resolveThreadTicket(tenantId, {
      subject: mail.subject,
      conversationId: mail.conversationId,
      inReplyTo: mail.inReplyTo,
      referencesHeader: mail.referencesHeader,
    });

    let ticketId: string;
    if (match) {
      // Reply on an existing ticket: only the new content, quoted tail removed.
      const replyBody = trimQuotedReply(rawText) || "(empty reply)";
      const updated = await requesterReply(match.ticketId, { name: from }, replyBody);
      ticketId = updated?.id ?? match.ticketId;
      await appendAudit({
        tenantId,
        actor: "email-ingest",
        action: "email.threaded_reply",
        ticketId,
        payload: { via: match.via, from, subject: mail.subject },
      });
    } else {
      const ticket = await intakeTicket(tenantId, {
        subject: mail.subject || "(no subject)",
        body: rawText || "(empty email body)",
        requesterEmail: from,
        channel: "email",
        source: "mailbox",
      });
      ticketId = ticket.id;
    }

    // ---- 6. Attachments -----------------------------------------------------
    let attachmentsSaved = 0;
    for (const att of mail.attachments ?? []) {
      try {
        const bytes = Buffer.from(att.contentBase64, "base64");
        await saveAttachment(
          tenantId,
          ticketId,
          { fileName: att.fileName, mimeType: att.mimeType, bytes },
          `email:${from}`
        );
        attachmentsSaved++;
      } catch (err) {
        // Individual attachment failures (type/size policy) never fail the mail.
        if (!(err instanceof AttachmentError)) throw err;
        logger.warn("email attachment rejected", {
          ticketId,
          fileName: att.fileName,
          reason: err.message,
        });
      }
    }

    await finish("processed", { ticketId, bodyText: rawText.slice(0, 20_000) });
    logger.info("email ingested", {
      ticketId,
      from,
      threaded: !!match,
      attachments: attachmentsSaved,
    });
    return { status: "processed", ticketId };
  } catch (err) {
    await finish("failed");
    logger.error("email ingestion failed", {
      from,
      subject: mail.subject,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
