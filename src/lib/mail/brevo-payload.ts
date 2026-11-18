/** Pure Brevo JSON body helper — safe to unit-test, no secrets. */
export function buildBrevoPayload(
  m: { to: string; subject: string; text: string; html?: string },
  senderEmail: string,
  senderName: string,
) {
  return {
    sender: { name: senderName.replace(/"/g, ""), email: senderEmail },
    to: [{ email: m.to }],
    subject: m.subject,
    htmlContent: m.html || undefined,
    textContent: m.text,
  };
}
