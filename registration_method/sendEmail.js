const nodemailer = require("nodemailer");

// Creates a reusable transporter using credentials from .env
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: false, // true for port 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends the OTP verification email to a user.
 * @param {string} toEmail - recipient's email address
 * @param {string} otp - 6-digit OTP code
 */
const sendOtpEmail = async (toEmail, otp) => {
  const mailOptions = {
    from: `"Online Voting System" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Your OTP Code - Online Voting System",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
        <h2>Verify your email</h2>
        <p>Use the OTP below to complete your registration. It expires in
           ${process.env.OTP_EXPIRES_MINUTES} minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendOtpEmail;
