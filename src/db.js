const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+05:30"
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function initAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "System Admin";
  if (!email || !password) return;
  const rows = await query("SELECT id FROM users WHERE email=?", [email]);
  if (!rows.length) {
    const hash = await bcrypt.hash(password, 12);
    await query("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'ADMIN')",
      [name, email, hash]);
    console.log(`Initial admin created: ${email}`);
  }
}

module.exports = { pool, query, initAdmin };
