# Production Employee Attendance Punching Machine

A Node.js + Express + MySQL attendance application with server-side GPS geofencing.

## Default office geofence

- Latitude: 28.5844444444
- Longitude: 77.3155555556
- Radius: 100 meters

The server calculates the Haversine distance. A punch is accepted only when the submitted GPS position is within the configured office radius and the reported GPS accuracy is acceptable.

> A normal browser cannot guarantee that GPS data is genuine. For higher assurance, use managed devices, MDM, a native app with device-attestation capabilities, or another trusted location signal. HTTPS is required for browser geolocation in production.

## Features

- Employee login
- Admin login and role-based authorization
- Employee directory CRUD
- Password hashing
- Secure HttpOnly JWT cookie
- CSRF-style origin checking through CORS configuration
- Rate limiting
- Helmet security headers
- Server-side geofence validation
- Punch in / punch out
- Duplicate/sequence protection
- Attendance history
- Daily/monthly reporting
- Excel and PDF export
- Leave requests and admin approval
- Office geofence configuration
- Audit log
- Responsive employee/admin dashboards
- MySQL schema and seed data

## Setup

1. Install Node.js 20+ and MySQL 8+.
2. Create a database and user, or run `sql/schema.sql` as an administrator.
3. Copy `.env.example` to `.env` and set production secrets.
4. Run:

```bash
npm install
npm start
```

5. Open `/` for employee login and `/admin/` for the admin dashboard.

## First admin

The SQL seed creates an admin with a temporary password only when `SEED_ADMIN_PASSWORD` is supplied. For safety, this project does not hard-code a production password.

Set these environment variables before first start:

- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

The application creates the initial admin on startup if it does not exist.

## Production deployment

Put the Node process behind Nginx/Caddy/Apache with HTTPS. Set `COOKIE_SECURE=true` and a strict `CORS_ORIGIN`.

Recommended:
- reverse proxy with TLS
- process manager such as systemd or PM2
- MySQL automated backups
- firewall limiting MySQL to the application server
- strong random JWT secret
- separate production database user
- monitoring and log rotation
- managed employee devices if location anti-spoofing matters

## Attendance rules

- First successful punch of a work sequence is Punch In.
- Next successful punch is Punch Out.
- A new Punch In is possible after a Punch Out.
- The server blocks a second Punch In without a Punch Out.
- Every accepted punch stores time, latitude, longitude, accuracy, and calculated distance.
- Blocked punch attempts are written to the audit log.

## API summary

Auth:
- POST `/api/auth/login`
- POST `/api/auth/logout`
- GET `/api/auth/me`

Employee:
- GET `/api/employee/dashboard`
- POST `/api/attendance/punch`
- GET `/api/attendance/history`
- POST `/api/leaves`

Admin:
- GET `/api/admin/dashboard`
- GET/POST/PUT/DELETE `/api/admin/employees`
- GET/PUT `/api/admin/office`
- GET `/api/admin/attendance`
- GET `/api/admin/export/attendance.xlsx`
- GET `/api/admin/export/attendance.pdf`
- GET/PUT `/api/admin/leaves/:id`

## Security note

The browser submits location coordinates. The server is authoritative for the 100m calculation, but browser GPS can be manipulated. This is a limitation of web-only geofencing, not a bug in the application.
