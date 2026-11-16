const RESEND_API_URL = "https://api.resend.com/emails";

function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendNotification({ to, subject, text }) {
  if (!configured()) {
    console.info("Email notifications are disabled: configure RESEND_API_KEY and MAIL_FROM.");
    return false;
  }

  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (!recipients.length) return false;

  let allSent = true;
  // Resend accepts up to 50 recipients per email request.
  for (let index = 0; index < recipients.length; index += 50) {
    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: recipients.slice(index, index + 50),
          subject,
          text,
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        console.error("Email notification failed:", response.status, details);
        allSent = false;
      }
    } catch (error) {
      // Email delivery must never roll back a ticket or comment operation.
      console.error("Email notification error:", error.message);
      allSent = false;
    }
  }

  return allSent;
}

module.exports = { sendNotification };
