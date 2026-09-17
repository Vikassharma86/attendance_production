require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { query, initAdmin } = require("./db");
const { signToken, auth, requireRole } = require("./auth");
const { verifyLocation } = require("./geofence");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set("trust proxy", 1);
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || false,
  credentials: true
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: "Too many login attempts. Try again later." } });
app.use("/api", apiLimiter);

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").slice(0,64);
}
async function audit(req, action, entityType=null, entityId=null, details={}) {
  try {
    await query(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details,ip_address,user_agent) VALUES(?,?,?,?,?,?,?)",
      [req.user?.sub || null, action, entityType, entityId, JSON.stringify(details), clientIp(req), String(req.headers["user-agent"] || "").slice(0,500)]
    );
  } catch (e) { console.error("audit:", e.message); }
}
async function getOffice() {
  const rows = await query("SELECT * FROM office_locations WHERE active=1 ORDER BY id LIMIT 1");
  return rows[0];
}
function setSession(res, token) {
  res.cookie("access_token", token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  });
}
function clearSession(res) { res.clearCookie("access_token", { path: "/" }); }

const loginSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(1).max(200)
});

app.post("/api/auth/login", loginLimiter, async (req,res,next) => {
  try {
    const data = loginSchema.parse(req.body);
    const rows = await query(
      `SELECT u.id,u.name,u.email,u.password_hash,u.role,u.employee_id,u.must_change_password,e.employee_code
       FROM users u LEFT JOIN employees e ON e.id=u.employee_id
       WHERE u.email=? AND u.active=1 LIMIT 1`, [data.email]
    );
    if (!rows.length || !(await bcrypt.compare(data.password, rows[0].password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const u = rows[0];
    const token = signToken(u);
    setSession(res, token);
    await audit(req, "LOGIN", "USER", u.id);
    res.json({ user: { id:u.id, name:u.name, email:u.email, role:u.role, employee_id:u.employee_id, employee_code:u.employee_code, must_change_password:Boolean(u.must_change_password) } });
  } catch(e) { next(e); }
});
const changePasswordSchema = z.object({
  current_password:z.string().min(1).max(200),
  new_password:z.string().min(6).max(200),
  confirm_password:z.string().min(6).max(200)
});

app.post("/api/auth/change-password", auth, async (req,res,next) => {
  try {
    const d=changePasswordSchema.parse(req.body);
    if(d.new_password !== d.confirm_password) return res.status(400).json({error:"New passwords do not match"});
    if(d.current_password === d.new_password) return res.status(400).json({error:"New password must be different from current password"});
    const rows=await query("SELECT id,password_hash FROM users WHERE id=? AND active=1 LIMIT 1",[req.user.sub]);
    if(!rows.length || !(await bcrypt.compare(d.current_password,rows[0].password_hash))) {
      return res.status(401).json({error:"Current password is incorrect"});
    }
    const hash=await bcrypt.hash(d.new_password,12);
    await query("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",[hash,req.user.sub]);
    await audit(req,"PASSWORD_CHANGE","USER",req.user.sub);
    res.json({ok:true});
  } catch(e){next(e);}
});

app.post("/api/auth/logout", auth, async (req,res) => {
  await audit(req, "LOGOUT", "USER", req.user.sub);
  clearSession(res);
  res.json({ ok:true });
});
app.get("/api/auth/me", auth, async (req,res,next) => {
  try {
    const rows = await query(
      `SELECT u.id,u.name,u.email,u.role,u.employee_id,u.must_change_password,e.employee_code,e.department,e.designation
       FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?`, [req.user.sub]
    );
    if (!rows.length) return res.status(401).json({error:"User not found"});
    res.json({user:rows[0]});
  } catch(e){next(e);}
});

app.get("/api/employee/dashboard", auth, requireRole("EMPLOYEE"), async (req,res,next)=>{
  try {
    const emp = (await query("SELECT * FROM employees WHERE id=?", [req.user.employee_id]))[0];
    const recent = await query(
      "SELECT id,punch_type,punched_at,latitude,longitude,accuracy_meters,distance_meters FROM attendance WHERE employee_id=? ORDER BY punched_at DESC LIMIT 20",
      [req.user.employee_id]
    );
    const office = await getOffice();
    res.json({employee:emp, recent, office:{name:office.name,latitude:office.latitude,longitude:office.longitude,radius_meters:office.radius_meters,max_accuracy_meters:office.max_accuracy_meters}});
  } catch(e){next(e);}
});

const punchSchema = z.object({
  latitude:z.number().finite().min(-90).max(90),
  longitude:z.number().finite().min(-180).max(180),
  accuracy:z.number().finite().nonnegative().max(10000).optional().nullable()
});

app.post("/api/attendance/punch", auth, requireRole("EMPLOYEE"), async (req,res,next)=>{
  try {
    const data = punchSchema.parse(req.body);
    const office = await getOffice();
    if (!office) return res.status(503).json({error:"Office location is not configured"});
    const check = verifyLocation(data.latitude, data.longitude, data.accuracy, office);
    if (!check.inside) {
      await audit(req,"PUNCH_BLOCKED","ATTENDANCE",null,{distance:check.distance,accuracy:data.accuracy,accuracyOk:check.accuracyOk});
      return res.status(403).json({
        error:"Punch blocked: you are outside the allowed office area or GPS accuracy is insufficient.",
        distance_meters:Math.round(check.distance*100)/100,
        radius_meters:Number(office.radius_meters),
        accuracy_ok:check.accuracyOk
      });
    }

    const last = (await query(
      "SELECT punch_type,punched_at FROM attendance WHERE employee_id=? ORDER BY punched_at DESC LIMIT 1",
      [req.user.employee_id]
    ))[0];

    const punchType = !last || last.punch_type === "OUT" ? "IN" : "OUT";
    const now = new Date();
    await query(
      `INSERT INTO attendance(employee_id,punch_type,punched_at,latitude,longitude,accuracy_meters,distance_meters,ip_address,user_agent)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [req.user.employee_id,punchType,now,data.latitude,data.longitude,data.accuracy ?? null,check.distance,clientIp(req),String(req.headers["user-agent"]||"").slice(0,500)]
    );
    await audit(req,"PUNCH_"+punchType,"ATTENDANCE",null,{distance:check.distance,accuracy:data.accuracy});
    res.json({ok:true,punch_type:punchType,punched_at:now,distance_meters:check.distance});
  } catch(e){next(e);}
});

app.get("/api/attendance/history", auth, requireRole("EMPLOYEE"), async (req,res,next)=>{
  try {
    const rows = await query(
      "SELECT id,punch_type,punched_at,distance_meters,accuracy_meters FROM attendance WHERE employee_id=? ORDER BY punched_at DESC LIMIT 500",
      [req.user.employee_id]
    );
    res.json({rows});
  } catch(e){next(e);}
});

app.post("/api/leaves", auth, requireRole("EMPLOYEE"), async (req,res,next)=>{
  try {
    const s=z.object({start_date:z.string(),end_date:z.string(),leave_type:z.string().min(1).max(50),reason:z.string().max(1000).optional()}).parse(req.body);
    if(s.end_date < s.start_date) return res.status(400).json({error:"End date must be on or after start date"});
    await query("INSERT INTO leave_requests(employee_id,start_date,end_date,leave_type,reason) VALUES(?,?,?,?,?)",
      [req.user.employee_id,s.start_date,s.end_date,s.leave_type,s.reason||null]);
    await audit(req,"LEAVE_CREATE","LEAVE",null,s);
    res.json({ok:true});
  }catch(e){next(e);}
});

app.get("/api/admin/dashboard", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    const [employees, todayPunches, pendingLeaves] = await Promise.all([
      query("SELECT COUNT(*) c FROM employees WHERE active=1"),
      query("SELECT COUNT(DISTINCT employee_id) c FROM attendance WHERE DATE(punched_at)=CURDATE() AND punch_type='IN'"),
      query("SELECT COUNT(*) c FROM leave_requests WHERE status='PENDING'")
    ]);
    res.json({employees:employees[0].c,today_present:todayPunches[0].c,pending_leaves:pendingLeaves[0].c});
  }catch(e){next(e);}
});

app.get("/api/admin/employees", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try { res.json({rows:await query("SELECT id,employee_code,name,email,phone,department,designation,joining_date,active FROM employees ORDER BY name")}); }
  catch(e){next(e);}
});

const empSchema=z.object({
  employee_code:z.string().min(1).max(50),
  name:z.string().min(1).max(120),
  email:z.string().email().max(190).optional().nullable(),
  phone:z.string().max(30).optional().nullable(),
  department:z.string().max(100).optional().nullable(),
  designation:z.string().max(100).optional().nullable(),
  joining_date:z.string().optional().nullable(),
  active:z.boolean().optional()
});

app.post("/api/admin/employees", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    const d=empSchema.parse(req.body);
    const tempPassword=String(req.body.temp_password||"").trim();
    if(d.email && tempPassword.length < 6) return res.status(400).json({error:"Temporary password must be at least 6 characters when an email is provided"});
    const r=await query("INSERT INTO employees(employee_code,name,email,phone,department,designation,joining_date,active) VALUES(?,?,?,?,?,?,?,?)",
      [d.employee_code,d.name,d.email||null,d.phone||null,d.department||null,d.designation||null,d.joining_date||null,d.active===false?0:1]);
    if(d.email) {
      const hash=await bcrypt.hash(tempPassword,12);
      await query("INSERT INTO users(name,email,password_hash,role,employee_id,active,must_change_password) VALUES(?,?,?,'EMPLOYEE',?,?,1)",[d.name,d.email,hash,r.insertId,d.active===false?0:1]);
    }
    await audit(req,"EMPLOYEE_CREATE","EMPLOYEE",r.insertId,{employee_code:d.employee_code,login_created:Boolean(d.email)});
    res.json({id:r.insertId,login_created:Boolean(d.email)});
  }catch(e){next(e);}
});
app.put("/api/admin/employees/:id", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    const d=empSchema.partial().parse(req.body);
    const keys=Object.keys(d);
    if(!keys.length) return res.json({ok:true});
    const allowed=["employee_code","name","email","phone","department","designation","joining_date","active"];
    const fields=keys.filter(k=>allowed.includes(k));
    const vals=fields.map(k=>d[k]===undefined?null:(k==="active"?Number(d[k]):d[k]));
    await query(`UPDATE employees SET ${fields.map(k=>`${k}=?`).join(",")} WHERE id=?`,[...vals,req.params.id]);
    await audit(req,"EMPLOYEE_UPDATE","EMPLOYEE",req.params.id,d);
    res.json({ok:true});
  }catch(e){next(e);}
});
app.delete("/api/admin/employees/:id", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    await query("UPDATE employees SET active=0 WHERE id=?",[req.params.id]);
    await audit(req,"EMPLOYEE_DEACTIVATE","EMPLOYEE",req.params.id);
    res.json({ok:true});
  }catch(e){next(e);}
});

app.get("/api/admin/office", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try { res.json({office:await getOffice()}); }catch(e){next(e);}
});
app.put("/api/admin/office", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    const d=z.object({name:z.string().min(1).max(120),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radius_meters:z.number().positive().max(5000),max_accuracy_meters:z.number().positive().max(1000)}).parse(req.body);
    const office=await getOffice();
    await query("UPDATE office_locations SET name=?,latitude=?,longitude=?,radius_meters=?,max_accuracy_meters=? WHERE id=?",
      [d.name,d.latitude,d.longitude,d.radius_meters,d.max_accuracy_meters,office.id]);
    await audit(req,"OFFICE_UPDATE","OFFICE",office.id,d);
    res.json({ok:true});
  }catch(e){next(e);}
});

app.get("/api/admin/attendance", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    const from=req.query.from || new Date().toISOString().slice(0,10);
    const to=req.query.to || from;
    const rows=await query(
      `SELECT a.id,e.employee_code,e.name,e.department,a.punch_type,a.punched_at,a.latitude,a.longitude,a.accuracy_meters,a.distance_meters
       FROM attendance a JOIN employees e ON e.id=a.employee_id
       WHERE DATE(a.punched_at) BETWEEN ? AND ? ORDER BY a.punched_at DESC LIMIT 10000`,[from,to]);
    res.json({rows,from,to});
  }catch(e){next(e);}
});

app.get("/api/admin/leaves", auth, requireRole("ADMIN"), async (req,res,next)=>{
  try {
    res.json({rows:await query(`SELECT l.*,e.employee_code,e.name FROM leave_requests l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC LIMIT 1000`)});
  }catch(e){next(e);}
});
app.put("/api/admin/leaves/:id", auth, requireRole("ADMIN"), async(req,res,next)=>{
  try {
    const status=z.enum(["APPROVED","REJECTED"]).parse(req.body.status);
    await query("UPDATE leave_requests SET status=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?",[status,req.user.sub,req.params.id]);
    await audit(req,"LEAVE_"+status,"LEAVE",req.params.id,{status});
    res.json({ok:true});
  }catch(e){next(e);}
});

async function attendanceRows(from,to) {
  return query(`SELECT e.employee_code,e.name,e.department,a.punch_type,a.punched_at,a.latitude,a.longitude,a.accuracy_meters,a.distance_meters
    FROM attendance a JOIN employees e ON e.id=a.employee_id
    WHERE DATE(a.punched_at) BETWEEN ? AND ? ORDER BY a.punched_at ASC`,[from,to]);
}
app.get("/api/admin/export/attendance.xlsx", auth, requireRole("ADMIN"), async(req,res,next)=>{
  try {
    const from=req.query.from || new Date().toISOString().slice(0,10), to=req.query.to || from;
    const rows=await attendanceRows(from,to);
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet("Attendance");
    ws.columns=[{header:"Employee ID",key:"employee_code",width:18},{header:"Name",key:"name",width:24},{header:"Department",key:"department",width:20},{header:"Type",key:"punch_type",width:10},{header:"Time",key:"punched_at",width:24},{header:"Latitude",key:"latitude",width:14},{header:"Longitude",key:"longitude",width:14},{header:"Accuracy (m)",key:"accuracy_meters",width:14},{header:"Distance (m)",key:"distance_meters",width:14}];
    rows.forEach(r=>ws.addRow(r));
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="attendance-${from}-to-${to}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  }catch(e){next(e);}
});
app.get("/api/admin/export/attendance.pdf", auth, requireRole("ADMIN"), async(req,res,next)=>{
  try {
    const from=req.query.from || new Date().toISOString().slice(0,10), to=req.query.to || from;
    const rows=await attendanceRows(from,to);
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",`attachment; filename="attendance-${from}-to-${to}.pdf"`);
    const doc=new PDFDocument({margin:30,size:"A4",layout:"landscape"}); doc.pipe(res);
    doc.fontSize(16).text(`Attendance Report: ${from} to ${to}`);
    doc.moveDown();
    doc.fontSize(8);
    rows.forEach(r=>doc.text(`${r.employee_code} | ${r.name} | ${r.department||""} | ${r.punch_type} | ${new Date(r.punched_at).toLocaleString("en-IN")} | ${Number(r.distance_meters).toFixed(1)}m`));
    doc.end();
  }catch(e){next(e);}
});

app.use(express.static(path.join(__dirname,"../public")));
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
app.get("/admin/", (req,res)=>res.sendFile(path.join(__dirname,"../public/admin/index.html")));


async function ensurePasswordFlagColumn() {
  try {
    await query("ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
}

app.use((err,req,res,next)=>{
  console.error(err);
  if(err instanceof z.ZodError) return res.status(400).json({error:"Invalid input",details:err.issues});
  if(err.code==="ER_DUP_ENTRY") return res.status(409).json({error:"Duplicate record"});
  res.status(500).json({error:"Internal server error"});
});

(async()=>{
  try {
    await query("SELECT 1");
    await ensurePasswordFlagColumn();
    await initAdmin();
    app.listen(PORT,()=>console.log(`Attendance server running on port ${PORT}`));
  } catch(e) {
    console.error("Startup failed:",e);
    process.exit(1);
  }
})();
