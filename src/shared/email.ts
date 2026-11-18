// One rule for comparing and storing email addresses: trim, then lowercase.
// Requester emails are stored this way on creation; reads compare
// case-insensitively so older rows with mixed case still belong to their requester.
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
