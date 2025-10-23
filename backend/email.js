import dotenv from 'dotenv';
dotenv.config({ override: true });

import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendEmail(to, subject, html) {
  const msg = {
    to,
    from: {
      email: process.env.FROM_EMAIL,
      name: process.env.FROM_NAME
    },
    subject,
    html
  };

  try {
    await sgMail.send(msg);
    console.log('✅ Email sent to', to);
    return true;
  } catch (err) {
    console.error('❌ SendGrid error:', err.response?.body || err.message);

    // In production, if SendGrid fails, log the email content for manual sending
    if (process.env.NODE_ENV === 'production') {
      console.log('PRODUCTION EMAIL FAILURE - Manual sending required:');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('HTML Content:');
      console.log(html);
      console.log('--- End of email content ---');
    }

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
