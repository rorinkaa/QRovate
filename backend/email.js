import dotenv from 'dotenv';
dotenv.config({ override: true });

import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT == 465, // true for 465, false for other ports
      auth: SMTP_USER && SMTP_PASS ? {
        user: SMTP_USER,
        pass: SMTP_PASS,
      } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(to, subject, html) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('SMTP not configured, skipping email send');
    return false;
  }

  try {
    const info = await getTransporter().sendMail({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    console.log('Email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

export async function sendPasswordResetEmail(email, resetToken, frontendUrl) {
  const resetUrl = `${frontendUrl}/?reset=${resetToken}`;
  const subject = 'Reset your QRovate password';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Password Reset Request</h2>
      <p>You requested a password reset for your QRovate account.</p>
      <p>Click the link below to reset your password:</p>
      <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>If you didn't request this, please ignore this email.</p>
      <p>This link will expire in 24 hours.</p>
      <p>Best,<br>The QRovate Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html);
}

export async function sendVerificationEmail(email, verifyToken, frontendUrl) {
  const verifyUrl = `${frontendUrl}/?verify=${verifyToken}`;
  const subject = 'Verify your QRovate account';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welcome to QRovate!</h2>
      <p>Please verify your email address to complete your registration.</p>
      <p>Click the link below to verify your account:</p>
      <p><a href="${verifyUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
      <p>If you didn't create this account, please ignore this email.</p>
      <p>This link will expire in 48 hours.</p>
      <p>Best,<br>The QRovate Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html);
}
