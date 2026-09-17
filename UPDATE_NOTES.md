# Attendance Pro v2.1

## New in this version
- OTP-based password recovery for both ADMIN and EMPLOYEE accounts.
- 6-digit OTP is hashed in the database and expires automatically.
- OTP attempts are limited.
- Email delivery uses Nodemailer/SMTP.
- Robust logout: the session cookie is cleared even if the session has expired.
- Admin dashboard has animated statistic counters, animated cards, floating background orbs, gradient buttons, GPS ring animation and mobile responsive behavior.
- Employee dashboard keeps mobile responsive behavior and now has working logout + OTP recovery.
- Admin can still reset an employee to a temporary password and permanently delete an employee ID.

## SMTP setup
Add SMTP settings to `.env`. For Gmail, enable 2-Step Verification and create a Google App Password. Put that App Password in `SMTP_PASS`.

For local development without email, set `OTP_DEV_MODE=true`. The OTP will be printed in the terminal running `npm start`. Do not use this mode in production.

## Database
The server automatically creates `password_reset_otps` on startup, so no manual SQL migration is required.
