const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('./db');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

function makeOtp() { return String(crypto.randomInt(100000, 1000000)); }

async function createOtp(email, role) {
  const otp = makeOtp();
  const hash = await bcrypt.hash(otp, 10);
  await query("UPDATE password_reset_otps SET used_at=NOW() WHERE email=? AND role=? AND used_at IS NULL", [email, role]);
  await query("INSERT INTO password_reset_otps(email,role,otp_hash,expires_at,attempts) VALUES(?,?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE),0)", [email, role, hash, OTP_TTL_MINUTES]);
  // Local development: show OTP only in the server terminal. In production, replace this with an email provider.
  if (String(process.env.OTP_DEV_MODE || 'false') === 'true') {
    console.log(`[OTP DEV MODE] ${role} ${email}: ${otp}`);
  }
  return otp;
}

async function verifyOtpAndReset({email, role, otp, newPassword}) {
  const rows = await query("SELECT id,otp_hash,attempts FROM password_reset_otps WHERE email=? AND role=? AND used_at IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1", [email, role]);
  if (!rows.length) throw Object.assign(new Error('OTP is invalid or expired. Please request a new OTP.'), {statusCode:400});
  const row=rows[0];
  if (Number(row.attempts) >= 5) throw Object.assign(new Error('Too many OTP attempts. Please request a new OTP.'), {statusCode:429});
  if (!(await bcrypt.compare(otp,row.otp_hash))) {
    await query("UPDATE password_reset_otps SET attempts=attempts+1 WHERE id=?", [row.id]);
    throw Object.assign(new Error('Invalid OTP.'), {statusCode:400});
  }
  const users=await query("SELECT id FROM users WHERE email=? AND role=? AND active=1 LIMIT 1", [email,role]);
  if (!users.length) throw Object.assign(new Error('Account not found.'), {statusCode:400});
  const passwordHash=await bcrypt.hash(newPassword,12);
  await query("UPDATE users SET password_hash=? WHERE id=?", [passwordHash,users[0].id]);
  await query("UPDATE password_reset_otps SET used_at=NOW() WHERE id=?", [row.id]);
  return users[0].id;
}

module.exports={createOtp,verifyOtpAndReset};
