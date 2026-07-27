import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Acceptable Use Policy · Netlink Support",
  description: "How the Netlink Support service desk may be used.",
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      updated="1 January 2026"
      intro="Netlink Support is an internal service desk for employees and contractors of Netlink Software Group America. This policy sets out what the system may be used for and what is expected of the people who use it."
      sections={[
        {
          heading: "Who may use the service desk",
          paragraphs: [
            "Access is granted to current employees, contractors and named partner staff through your organisation account. Accounts are personal: do not share your credentials, and do not raise or action tickets under someone else's identity.",
          ],
        },
        {
          heading: "What the service desk is for",
          paragraphs: [
            "Use it to report incidents, request services from the catalogue, and follow the progress of work that IT, HR or Facilities are doing for you.",
          ],
          bullets: [
            "Describe the problem accurately, including what you were doing when it happened.",
            "Attach only the evidence needed to resolve the ticket — screenshots, logs, error messages.",
            "Keep conversation on the ticket rather than in side channels, so the record stays complete.",
          ],
        },
        {
          heading: "What is not permitted",
          paragraphs: ["The following will be treated as a policy breach and may be referred to your manager or to HR."],
          bullets: [
            "Uploading malware, credentials, payment card data or content you have no right to share.",
            "Attempting to access tickets, articles or records belonging to other people or other organisations.",
            "Probing, scanning or otherwise testing the service desk's security without written authorisation.",
            "Using the AI assistant to generate content that is abusive, discriminatory or unlawful.",
            "Automating bulk submissions through the API in a way that degrades service for others.",
          ],
        },
        {
          heading: "Monitoring and the audit trail",
          paragraphs: [
            "Every action taken in the service desk — sign-ins, ticket changes, approvals, API-key use — is written to a tamper-evident, hash-linked audit log. Administrators can review that log, and it may be produced in response to a security investigation, a regulatory request or a legal obligation.",
            "The AI assistant reads ticket content and knowledge-base articles in order to triage and answer. Do not paste anything into a ticket that you would not want an assistant, an agent or an auditor to read.",
          ],
        },
        {
          heading: "Service levels and availability",
          paragraphs: [
            "Response and resolution targets shown on a ticket are the operational commitment of the service desk, measured against your organisation's business calendar. They are internal targets rather than a contractual guarantee, and they may be paused while a ticket is waiting on you.",
          ],
        },
        {
          heading: "Enforcement",
          paragraphs: [
            "Accounts that breach this policy may be suspended without notice. Serious or repeated breaches are escalated to your line manager and, where relevant, to HR or the security team.",
          ],
        },
      ]}
      contact="Questions about this policy? Raise a ticket in the HR or IT category, or contact the service desk team directly — they will route it to the policy owner."
    />
  );
}
