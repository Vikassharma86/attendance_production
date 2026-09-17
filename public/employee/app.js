const $ = id => document.getElementById(id);

async function api(url, opt = {}) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opt.headers || {}) },
    ...opt
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || "Request failed");
  return d;
}

function showPasswordModal() {
  const m = $("changePasswordModal");
  if (!m) return;
  m.classList.add("show");
  m.style.display = "flex";
  m.setAttribute("aria-hidden", "false");
  if ($("currentPassword")) $("currentPassword").focus();
}

function hidePasswordModal() {
  const m = $("changePasswordModal");
  if (!m) return;
  m.classList.remove("show");
  m.style.display = "none";
  m.setAttribute("aria-hidden", "true");
}

async function load() {
  try {
    const m = await api("/api/auth/me");
    if (m.user.role !== "EMPLOYEE") throw Error("Employee account required");

    $("loginCard").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("who").textContent = `${m.user.name} • ${m.user.employee_code}`;

    const d = await api("/api/employee/dashboard");
    $("officeInfo").textContent = `${d.office.name}: ${Number(d.office.latitude).toFixed(6)}, ${Number(d.office.longitude).toFixed(6)} • radius ${d.office.radius_meters}m • max accuracy ${d.office.max_accuracy_meters}m`;
    
    render(d.recent);
    await loadMyLeaves();

    if (m.user.must_change_password) {
      showPasswordModal();
    } else {
      hidePasswordModal();
    }
  } catch (e) {
    $("loginCard").classList.remove("hidden");
    $("app").classList.add("hidden");
  }
}

function render(rows) {
  $("rows").innerHTML = rows.length
    ? rows.map(r => `
        <tr>
          <td><span class="badge ${r.punch_type === 'IN' ? 'badge-in' : 'badge-out'}">${r.punch_type}</span></td>
          <td>${new Date(r.punched_at).toLocaleString("en-IN")}</td>
          <td>${Number(r.distance_meters).toFixed(1)}m</td>
          <td>${r.accuracy_meters == null ? "-" : Number(r.accuracy_meters).toFixed(1) + "m"}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" class="empty">No punches yet</td></tr>`;
}

// Helper to format ISO dates cleanly to DD/MM/YYYY
function formatDate(str) {
  if (!str) return "-";
  const d = new Date(str);
  return isNaN(d) ? String(str).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// 1. Leave requests loader with clean Date Formatting
async function loadMyLeaves() {
  const target = $("myLeaveRows") || $("leaveRows");
  if (!target) return;

  try {
    const data = await api("/api/leaves");
    const leaves = Array.isArray(data) ? data : (data.rows || []);

    target.innerHTML = leaves.length
      ? leaves.map(r => `
          <tr>
            <td>${formatDate(r.start_date)} → ${formatDate(r.end_date)}</td>
            <td>${r.leave_type}</td>
            <td>${r.reason || "—"}</td>
            <td>
              <span class="badge badge-${String(r.status || 'pending').toLowerCase()}">
                ${r.status || 'PENDING'}
              </span>
            </td>
          </tr>
        `).join("")
      : `<tr><td colspan="4" class="empty">No leave requests found</td></tr>`;
  } catch (e) {
    target.innerHTML = `<tr><td colspan="4" class="empty">Unable to load leave requests</td></tr>`;
  }
}

// 2. Form Event Handlers
$("loginForm").onsubmit = async e => {
  e.preventDefault();
  $("loginMsg").textContent = "Signing in…";
  $("loginMsg").className = "status";
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value, password: $("password").value })
    });
    await load();
  } catch (x) {
    $("loginMsg").textContent = x.message;
    $("loginMsg").className = "error";
  }
};

$("punch").onclick = () => {
  $("status").textContent = "Requesting GPS…";
  $("status").className = "status";
  navigator.geolocation.getCurrentPosition(
    async p => {
      try {
        const d = await api("/api/attendance/punch", {
          method: "POST",
          body: JSON.stringify({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy
          })
        });
        $("status").textContent = `${d.punch_type} successful • ${Number(d.distance_meters).toFixed(1)}m from office`;
        $("status").className = "ok";
        await load();
      } catch (e) {
        $("status").textContent = e.message;
        $("status").className = "error";
      }
    },
    e => {
      $("status").textContent = "GPS error: " + e.message;
      $("status").className = "error";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
};

$("leaveForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/leaves", {
      method: "POST",
      body: JSON.stringify({
        start_date: $("start").value,
        end_date: $("end").value,
        leave_type: $("type").value,
        reason: $("reason").value
      })
    });
    alert("Leave submitted successfully");
    e.target.reset();
    await loadMyLeaves();
  } catch (x) {
    alert(x.message);
  }
};

// 3. Password Change Handling Fix
if ($("changePassword")) $("changePassword").onclick = showPasswordModal;

const passwordForm = $("passwordForm") || $("changePasswordForm");
if (passwordForm) {
  passwordForm.onsubmit = async e => {
    e.preventDefault();
    if ($("modalError")) $("modalError").textContent = "";
    
    const b = $("submitPasswordBtn");
    if (b) { b.disabled = true; b.textContent = "Updating…"; }

    try {
      await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: $("currentPassword").value,
          newPassword: $("newPassword").value,
          confirmPassword: $("confirmPassword") ? $("confirmPassword").value : $("newPassword").value
        })
      });
      hidePasswordModal();
      alert("Password updated successfully.");
      await load();
    } catch (x) {
      if ($("modalError")) $("modalError").textContent = x.message;
    } finally {
      if (b) { b.disabled = false; b.textContent = "Update Password"; }
    }
  };
}

// 4. Forgot Password & Recovery Flow
function setOtpStep(step2) {
  const ids = ["forgotOtp", "recoveryNew", "recoveryConfirm"];
  ids.forEach(id => { if ($(id)) $(id).disabled = !step2; });
  if ($("forgotEmail")) $("forgotEmail").disabled = step2;
  if ($("employeeOtpStep1")) $("employeeOtpStep1").classList.toggle("hidden", step2);
  if ($("employeeOtpStep2")) $("employeeOtpStep2").classList.toggle("hidden", !step2);
}

function showForgotModal() {
  const m = $("forgotModal");
  if (!m) return;
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
  setOtpStep(false);
  if ($("forgotEmail") && $("email")) $("forgotEmail").value = $("email").value;
  if ($("forgotMsg")) $("forgotMsg").textContent = "";
  if ($("resetMsg")) $("resetMsg").textContent = "";
  if ($("forgotEmail")) $("forgotEmail").focus();
}

function hideForgotModal() {
  const m = $("forgotModal");
  if (!m) return;
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
}

if ($("forgotPassword")) $("forgotPassword").onclick = showForgotModal;
if ($("closeForgot")) $("closeForgot").onclick = hideForgotModal;

if ($("forgotForm")) {
  $("forgotForm").onsubmit = async e => {
    e.preventDefault();
    const step2 = $("employeeOtpStep2") && !$("employeeOtpStep2").classList.contains("hidden");
    const b = e.target.querySelector("button:not(.secondary)");
    if (b) { b.disabled = true; b.textContent = step2 ? "Resetting…" : "Sending OTP…"; }

    try {
      if (!step2) {
        const d = await api("/api/auth/employee-forgot", {
          method: "POST",
          body: JSON.stringify({ email: $("forgotEmail").value })
        });
        if ($("forgotMsg")) {
          $("forgotMsg").textContent = d.message + " Check your email.";
          $("forgotMsg").className = "ok";
        }
        setOtpStep(true);
        if ($("forgotOtp")) $("forgotOtp").focus();
      } else {
        const d = await api("/api/auth/employee-reset-otp", {
          method: "POST",
          body: JSON.stringify({
            email: $("forgotEmail").value,
            otp: $("forgotOtp").value,
            new_password: $("recoveryNew").value,
            confirm_password: $("recoveryConfirm").value
          })
        });
        if ($("resetMsg")) {
          $("resetMsg").textContent = d.message;
          $("resetMsg").className = "ok";
        }
        setTimeout(hideForgotModal, 1200);
      }
    } catch (x) {
      const el = step2 ? $("resetMsg") : $("forgotMsg");
      if (el) {
        el.textContent = x.message;
        el.className = "error";
      }
    } finally {
      if (b) { b.disabled = false; b.textContent = step2 ? "Reset Password" : "Send OTP"; }
    }
  };
}

if ($("logout")) {
  $("logout").onclick = async () => {
    const b = $("logout");
    b.disabled = true;
    b.textContent = "Logging out…";
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (e) {} finally {
      location.replace("/");
    }
  };
}

// Initial application boot
load();