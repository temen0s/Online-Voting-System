const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: Number(process.env.EMAIL_PORT) === 465, // true for 465, false for 587 (STARTTLS)
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Sends the OTP verification email to a registering student.
 * @param {string} toEmail
 * @param {string} otp
 * @param {string} fullName
 */
async function sendOtpEmail(toEmail, otp, fullName = "") {
  const mailOptions = {
    from: `"Student Voting System" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Your OTP Code - Student Voting System",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2>Verify your email</h2>
        <p>${fullName ? `Hi ${fullName},` : "Hi,"} use the OTP below to complete your voter
           registration. It expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  };

  await getTransporter().sendMail(mailOptions);
}

module.exports = sendOtpEmail;
