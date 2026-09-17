const bcrypt = require("bcryptjs");
const { query } = require("./db");

async function verifyOtpAndReset({ email, role, otp, newPassword }) {
  // 1. Fetch OTP record from password_reset_otps
  const rows = await query(
    "SELECT * FROM password_reset_otps WHERE email=? AND role=? AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
    [email, role]
  );

  if (!rows.length) {
    throw new Error("Invalid or expired OTP");
  }

  const record = rows[0];
  
  // Column name check: otp_hash ya otp
  const isValid = await bcrypt.compare(otp, record.otp_hash || record.otp);

  if (!isValid) {
    throw new Error("Invalid 6-digit OTP");
  }

  // 2. Hash new password & update user in users table
  const newHash = await bcrypt.hash(newPassword, 10);
  
  await query(
    "UPDATE users SET password_hash=?, must_change_password=0 WHERE email=? AND role=?",
    [newHash, email, role]
  );

  // 3. Delete used OTP
  await query("DELETE FROM password_reset_otps WHERE email=? AND role=?", [email, role]);

  return true;
}

module.exports = { verifyOtpAndReset };