const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, employee_id: user.employee_id || null },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function auth(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

module.exports = { signToken, auth, requireRole };
