const $=id=>document.getElementById(id);
async function api(url,opt={}){const r=await fetch(url,{credentials:"include",headers:{"Content-Type":"application/json",...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d}
function animateNumber(el,value){const target=Number(value)||0;const start=Number(el.textContent)||0;const duration=700;const t0=performance.now();function frame(t){const p=Math.min((t-t0)/duration,1);el.textContent=Math.round(start+(target-start)*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(frame)}requestAnimationFrame(frame)}
async function load(){try{const m=await api("/api/auth/me");if(m.user.role!=="ADMIN")throw Error();$("loginCard").classList.add("hidden");$("app").classList.remove("hidden");$("who").textContent=`${m.user.name} • ${m.user.email}`;$("todayLabel").textContent=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});const [d,o,e,l]=await Promise.all([api("/api/admin/dashboard"),api("/api/admin/office"),api("/api/admin/employees"),api("/api/admin/leaves")]);animateNumber($("employees"),d.employees);animateNumber($("present"),d.today_present);animateNumber($("pending"),d.pending_leaves);fillOffice(o.office);renderEmp(e.rows);renderLeaves(l.rows);setDates();await loadAttendance();document.querySelectorAll(".animated-card").forEach((el,i)=>{el.style.animationDelay=`${Math.min(i*70,500)}ms`;el.classList.add("animate-in")})}catch(e){}}
function setDates(){const x=new Date().toISOString().slice(0,10);$("from").value=x;$("to").value=x}
function fillOffice(o){$("oname").value=o.name;$("olat").value=o.latitude;$("olng").value=o.longitude;$("oradius").value=o.radius_meters;$("oaccuracy").value=o.max_accuracy_meters}
function renderEmp(rows){$("empRows").innerHTML=rows.length?rows.map(r=>`<tr><td><strong>${r.employee_code}</strong></td><td>${r.name}</td><td>${r.email||"—"}</td><td>${r.department||"—"}</td><td><span class="badge ${r.active?'badge-active':'badge-off'}">${r.active?"Active":"Inactive"}</span></td><td class="actions-cell">${r.email?`<button class="mini-warning" onclick="openReset(${r.id},${JSON.stringify(r.name)})">Reset Password</button>`:""} ${r.active?`<button class="mini-danger" onclick="deactivate(${r.id})">Deactivate</button>`:""} <button class="mini-delete" onclick="deleteEmployee(${r.id},${JSON.stringify(r.name)})">Delete ID</button></td></tr>`).join(""):`<tr><td colspan="6" class="empty">No employees found</td></tr>`}
function renderLeaves(rows){
  $("leaveRows").innerHTML = rows.length
    ? rows.map(r => `
      <tr>
        <td><strong>${r.employee_code}</strong> · ${r.name}</td>
        <td>${r.start_date} → ${r.end_date}</td>
        <td>${r.leave_type}</td>
        <td>
          <span class="badge badge-${String(r.status).toLowerCase()}">
            ${r.status}
          </span>
        </td>
        <td>
          ${r.status === "PENDING"
            ? `
              <button class="mini-success leave-approve" data-id="${r.id}">
                Approve
              </button>
              <button class="mini-danger leave-reject" data-id="${r.id}">
                Reject
              </button>
            `
            : "—"}
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="empty">No leave requests found</td></tr>`;

  document.querySelectorAll(".leave-approve").forEach(btn => {
    btn.addEventListener("click", () => review(btn.dataset.id, "APPROVED"));
  });

  document.querySelectorAll(".leave-reject").forEach(btn => {
    btn.addEventListener("click", () => review(btn.dataset.id, "REJECTED"));
  });
}
async function loadAttendance(){try{const d=await api(`/api/admin/attendance?from=${$("from").value}&to=${$("to").value}`);$("attRows").innerHTML=d.rows.length?d.rows.map(r=>`<tr><td><strong>${r.employee_code}</strong></td><td>${r.name}</td><td>${r.department||"—"}</td><td><span class="badge ${r.punch_type==='IN'?'badge-in':'badge-out'}">${r.punch_type}</span></td><td>${new Date(r.punched_at).toLocaleString("en-IN")}</td><td>${Number(r.distance_meters).toFixed(1)}m</td></tr>`).join(""):`<tr><td colspan="6" class="empty">No attendance records for this date range</td></tr>`;const q=`from=${$("from").value}&to=${$("to").value}`;$("xlsx").href="/api/admin/export/attendance.xlsx?"+q;$("pdf").href="/api/admin/export/attendance.pdf?"+q}catch(e){alert(e.message)}}
$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginMsg").textContent="Signing in…";try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});await load()}catch(x){$("loginMsg").textContent=x.message;$("loginMsg").className="error"}};
$("officeForm").onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/office",{method:"PUT",body:JSON.stringify({name:$("oname").value,latitude:+$("olat").value,longitude:+$("olng").value,radius_meters:+$("oradius").value,max_accuracy_meters:+$("oaccuracy").value})});alert("Office settings saved");await load()}catch(x){alert(x.message)}};
$("empForm").onsubmit=async e=>{e.preventDefault();try{const d=await api("/api/admin/employees",{method:"POST",body:JSON.stringify({employee_code:$("ecode").value,name:$("ename").value,email:$("eemail").value||null,department:$("edept").value||null,designation:$("edesig").value||null,temp_password:$("etemp").value||""})});e.target.reset();alert(d.login_created?"Employee added. Login created with the temporary password.":"Employee added without a login account.");await load()}catch(x){alert(x.message)}};
$("loadAtt").onclick=loadAttendance;
$("logout").onclick=async()=>{const b=$("logout");b.disabled=true;b.textContent="Logging out…";try{await api("/api/auth/logout",{method:"POST"})}catch(e){console.error("ADMIN LOAD ERROR:",e)}finally{location.replace("/admin/")}};
window.openReset=(id,name)=>{const m=$("resetEmployeeModal");$("resetEmployeeId").value=id;$("resetEmployeeName").textContent=`Set a temporary password for ${name}.`;$("resetTemp").value="";$("resetMsg").textContent="";m.classList.add("show");m.setAttribute("aria-hidden","false");$("resetTemp").focus()};
window.deactivate=async id=>{if(confirm("Deactivate employee? They will no longer be able to log in.")){try{await api("/api/admin/employees/"+id,{method:"DELETE"});await load()}catch(e){alert(e.message)}}};
window.deleteEmployee=async(id,name)=>{if(confirm(`Permanently delete ${name}? This removes the employee login, attendance records and leave history. This cannot be undone.`)){try{await api("/api/admin/employees/"+id,{method:"DELETE"});alert("Employee deleted permanently");await load()}catch(e){alert(e.message)}}};
window.review=async(id,status)=>{try{await api("/api/admin/leaves/"+id,{method:"PUT",body:JSON.stringify({status})});await load()}catch(e){alert(e.message)}};
function showForgotModal(){const m=$("forgotModal");m.classList.add("show");m.setAttribute("aria-hidden","false");$("adminOtpStep1").classList.remove("hidden");$("adminOtpStep2").classList.add("hidden");$("forgotEmail").value=$("email").value;$("forgotMsg").textContent="";$("resetAdminMsg").textContent="";$("forgotEmail").focus()}
function hideForgotModal(){const m=$("forgotModal");m.classList.remove("show");m.setAttribute("aria-hidden","true")}
$("forgotPassword").onclick=showForgotModal;$("closeForgot").onclick=hideForgotModal;
$("forgotForm").onsubmit=async e=>{e.preventDefault();const step2=!$("adminOtpStep2").classList.contains("hidden");const b=e.target.querySelector("button:not(.secondary)");b.disabled=true;b.textContent=step2?"Resetting…":"Sending OTP…";try{if(!step2){const d=await api("/api/auth/admin-forgot",{method:"POST",body:JSON.stringify({email:$("forgotEmail").value})});$("forgotMsg").textContent=d.message+" Check your email.";$("forgotMsg").className="ok";$("adminOtpStep1").classList.add("hidden");$("adminOtpStep2").classList.remove("hidden");$("forgotOtp").focus()}else{const d=await api("/api/auth/admin-reset-otp",{method:"POST",body:JSON.stringify({email:$("forgotEmail").value,otp:$("forgotOtp").value,new_password:$("recoveryNew").value,confirm_password:$("recoveryConfirm").value})});$("resetAdminMsg").textContent=d.message;$("resetAdminMsg").className="ok";setTimeout(hideForgotModal,1200)}}catch(x){const el=step2?$("resetAdminMsg"):$("forgotMsg");el.textContent=x.message;el.className="error"}finally{b.disabled=false;b.textContent=step2?"Reset Password":"Send OTP"}};
$("closeReset").onclick=()=>{const m=$("resetEmployeeModal");m.classList.remove("show");m.setAttribute("aria-hidden","true")};
$("resetEmployeeForm").onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector("button");b.disabled=true;b.textContent="Resetting…";try{const d=await api(`/api/admin/employees/${$("resetEmployeeId").value}/reset-password`,{method:"POST",body:JSON.stringify({temp_password:$("resetTemp").value})});$("resetMsg").textContent=d.message;$("resetMsg").className="ok"}catch(x){$("resetMsg").textContent=x.message;$("resetMsg").className="error"}finally{b.disabled=false;b.textContent="Reset Password"}};
load();
