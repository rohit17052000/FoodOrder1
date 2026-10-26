const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ status: 'error', message: 'Email and OTP required' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: `"JavaGoat" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your JavaGoat Verification Code',
      text: `Your OTP Code is: ${otp}`
    });

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
