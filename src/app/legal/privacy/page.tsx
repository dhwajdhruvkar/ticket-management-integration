import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy Notice · Netlink Support",
  description: "What Netlink Support records about you and why.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Notice"
      updated="1 January 2026"
      intro="This notice explains what Netlink Support records about you when you use the service desk, why it is recorded, how long it is kept, and what you can ask us to do about it."
      sections={[
        {
          heading: "What we record",
          paragraphs: ["The service desk holds three kinds of information about you."],
          bullets: [
            "Account details from your organisation directory: name, work email, job title, department and role.",
            "Ticket content: the subject and body of anything you raise, replies, attachments, satisfaction ratings, and the configuration items or assets a ticket is linked to.",
            "Activity records: sign-ins and sign-outs, ticket changes, approvals and API-key use, each written to a hash-linked audit chain.",
          ],
        },
        {
          heading: "Why we record it",
          paragraphs: [
            "To resolve your requests, to route them to the right team, to measure whether the service desk is meeting its response and resolution targets, and to keep a defensible record of who changed what. Aggregate reporting — volumes, deflection, satisfaction — is produced from this data and is not used to assess individual requesters.",
          ],
        },
        {
          heading: "Automated processing",
          paragraphs: [
            "An AI assistant reads the text of your ticket in order to classify it, search published knowledge-base articles, and draft a suggested answer. Suggestions above the configured confidence threshold may resolve a ticket automatically; everything else is reviewed by a person. You can always reply to reopen a ticket that was closed automatically, and no employment or disciplinary decision is made by the assistant.",
          ],
        },
        {
          heading: "Who can see your tickets",
          paragraphs: [
            "You can see your own tickets. Service desk agents and their managers can see tickets in their organisation. Internal notes written by agents are never shown to requesters. Data is separated by organisation, and a request for a record outside your organisation is answered as if it does not exist.",
            "Where a third-party service is used to deliver the desk — email delivery, chat notifications, an AI model provider — ticket content may be transmitted to it for that purpose only, under contract, and never sold.",
          ],
        },
        {
          heading: "How long it is kept",
          paragraphs: [
            "Tickets and their messages are retained for the period set by your organisation's records policy, typically 24 months after closure. Audit records are retained longer because their integrity depends on the chain remaining unbroken. Attachments are removed with the ticket they belong to.",
          ],
        },
        {
          heading: "Your choices",
          paragraphs: [
            "You can change your notification preferences, display name and profile details from your profile page at any time. You can ask for a copy of the personal data held about you, ask for factual corrections, or object to a specific use of it.",
          ],
        },
      ]}
      contact="To exercise any of the rights above, raise a ticket in the HR category or contact your organisation's data protection contact. Requests are acknowledged within five working days."
    />
  );
}
