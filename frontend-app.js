// public/app.js
// All data now comes from the server / single SQLite database via fetch().
// Nothing important is computed or trusted client-side - the server
// re-validates every balance, role and amount independently.

const API = '/api';
let TOKEN = sessionStorage.getItem('gr_token') || null;
let CURRENT_USER = JSON.parse(sessionStorage.getItem('gr_user') || 'null');

function money(n){ return "UGX " + Number(n||0).toLocaleString(); }
function fmtDate(iso){ if(!iso) return ''; const d=new Date(iso.includes('T')?iso:iso.replace(' ','T')+'Z'); return d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function toast(msg, isErr){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (isErr?' err':'');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.className='toast', 3200);
}

async function api(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API+path, Object.assign({}, opts, {headers}));
  let data = null;
  try { data = await res.json(); } catch(e){ /* no body */ }
  if(!res.ok){
    const msg = (data && data.error) || `Request failed (${res.status})`;
    if(res.status === 401){ forceLogout(); }
    throw new Error(msg);
  }
  return data;
}

/* ---------------- Auth ---------------- */
/* ---------------- Auth tabs / parent self-signup ---------------- */
function switchAuthTab(which){
  const isSignIn = which === 'signin';
  document.getElementById('tabSignIn').classList.toggle('active', isSignIn);
  document.getElementById('tabSignUp').classList.toggle('active', !isSignIn);
  document.getElementById('panelSignIn').classList.toggle('active', isSignIn);
  document.getElementById('panelSignUp').classList.toggle('active', !isSignIn);
}
async function doParentSignup(){
  const admNo = document.getElementById('signupAdmNo').value.trim();
  const phone = document.getElementById('signupPhone').value.trim();
  const username = document.getElementById('signupUsername').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errBox = document.getElementById('signupError');
  const okBox = document.getElementById('signupSuccess');
  errBox.style.display = 'none'; okBox.style.display = 'none';

  if(!admNo || !phone || !username || !password){ errBox.textContent='All fields are required.'; errBox.style.display='block'; return; }
  if(password.length < 8){ errBox.textContent='Password must be at least 8 characters.'; errBox.style.display='block'; return; }

  const btn = document.getElementById('signupBtn');
  btn.textContent = 'Creating account…'; btn.disabled = true;
  try{
    await api('/auth/parent-signup', {method:'POST', body: JSON.stringify({adm_no: admNo, guardian_phone: phone, username, password})});
    okBox.textContent = `Account created! You can now sign in as "${username}".`;
    okBox.style.display = 'block';
    ['signupAdmNo','signupPhone','signupUsername','signupPassword'].forEach(id=> document.getElementById(id).value='');
    setTimeout(()=> switchAuthTab('signin'), 1800);
  }catch(e){
    errBox.textContent = e.message; errBox.style.display='block';
  }finally{
    btn.textContent = 'Create My Account'; btn.disabled = false;
  }
}

async function doLogin(){
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';
  if(!username || !password){ errBox.textContent='Enter username and password.'; errBox.style.display='block'; return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try{
    const data = await api('/auth/login', {method:'POST', body: JSON.stringify({username,password})});
    TOKEN = data.token; CURRENT_USER = data.user;
    sessionStorage.setItem('gr_token', TOKEN);
    sessionStorage.setItem('gr_user', JSON.stringify(CURRENT_USER));
    enterApp();
  }catch(err){
    errBox.textContent = err.message; errBox.style.display='block';
  }finally{
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
}
function forceLogout(){
  sessionStorage.removeItem('gr_token'); sessionStorage.removeItem('gr_user');
  TOKEN = null; CURRENT_USER = null;
  document.getElementById('app').classList.remove('show');
  document.getElementById('loginScreen').style.display='flex';
}
async function logout(){
  try{ await api('/auth/logout', {method:'POST'}); }catch(e){}
  forceLogout();
}

/* ---------------- Nav / role config ---------------- */
const ROLE_NAV = {
  admin:   [['dashboard','📊','Dashboard'],['students','🎓','Students'],['fees','💰','Fees & Finance'],['attendance','📋','Attendance'],['reports','📈','Reports'],['notifications','✉️','Notifications'],['audit','🛡️','Audit Log'],['settings','⚙️','Settings']],
  bursar:  [['dashboard','📊','Dashboard'],['fees','💰','Fees & Finance'],['students','🎓','Students'],['reports','📈','Reports']],
  teacher: [['dashboard','📊','Dashboard'],['attendance','📋','Attendance'],['students','🎓','My Students']],
  parent:  [['dashboard','📊','Dashboard'],['parent','👪','My Child']]
};
const PAGE_META = {
  dashboard:{title:'Dashboard', sub:'Live snapshot, computed server-side from the single database.'},
  students:{title:'Students', sub:'Admissions & records — every other module reads from this table.'},
  fees:{title:'Fees & Finance', sub:'Invoices and payments. Balances are always recalculated on the server, never trusted from the browser.'},
  attendance:{title:'Attendance', sub:"Mark today's register. Absentees trigger an automatic email to the admin."},
  parent:{title:'My Child', sub:'Only your linked student\'s records — enforced server-side, not just hidden in the UI.'},
  reports:{title:'Reports & Analytics', sub:'School-wide performance summary — download as CSV or print/save as PDF.'},
  notifications:{title:'Notifications', sub:'Every email attempt to the admin address, sent or not.'},
  audit:{title:'Audit Log', sub:'Who did what, when — the accountability trail.'},
  settings:{title:'Settings', sub:'School configuration, fee structure, and account management.'}
};

async function enterApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').classList.add('show');
  document.getElementById('whoName').textContent = CURRENT_USER.name;
  document.getElementById('whoRole').textContent = CURRENT_USER.role;
  document.getElementById('dateChip').textContent = new Date().toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  buildNav();
  await populateClassSelectors();
  await loadBranding();
  goPage(ROLE_NAV[CURRENT_USER.role][0][0]);
}
async function loadBranding(){
  try{
    const s = await api('/settings');
    if(s.term && s.year) document.getElementById('termChip').textContent = `${s.term} · ${s.year}`;
    if(s.motto) document.getElementById('sidebarMotto').textContent = s.motto;
  }catch(e){ /* non-fatal - parent role may not have access */ }
}
function buildNav(){
  const nav = document.getElementById('navMenu'); nav.innerHTML='';
  ROLE_NAV[CURRENT_USER.role].forEach(([key,icon,label])=>{
    const b = document.createElement('button');
    b.innerHTML = `<span>${icon}</span> ${label}`;
    b.onclick = ()=> goPage(key);
    b.dataset.key = key;
    nav.appendChild(b);
  });
}
function goPage(key){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+key).classList.add('active');
  document.querySelectorAll('#navMenu button').forEach(b=> b.classList.toggle('active', b.dataset.key===key));
  document.getElementById('pageTitle').textContent = PAGE_META[key].title;
  document.getElementById('pageSub').textContent = PAGE_META[key].sub;

  if(key==='dashboard') renderDashboard();
  if(key==='students') renderStudents();
  if(key==='fees') renderInvoices();
  if(key==='attendance'){ document.getElementById('attDate').value = todayStr(); loadAttendanceSheet(); }
  if(key==='parent') renderParent();
  if(key==='notifications') renderNotifications();
  if(key==='audit') renderAudit();
  if(key==='settings') renderSettings();
  if(key==='reports') renderReports();
}

async function populateClassSelectors(){
  try{
    const structs = CURRENT_USER.role==='parent' ? [] : await api('/fees/structures').catch(()=>[]);
    const classes = structs.length ? structs.map(s=>s.cls) : ['S.1','S.2','S.3','S.4','S.5','S.6'];
    ['admClass','attClass'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.innerHTML = classes.map(c=>`<option value="${c}">${c}</option>`).join('');
    });
    const filt = document.getElementById('studentClassFilter');
    if(filt) filt.innerHTML = '<option value="">All classes</option>' + classes.map(c=>`<option value="${c}">${c}</option>`).join('');
  }catch(e){ /* non-fatal on parent role etc. */ }
}

function card(label,value,sub,color){
  return `<div class="card stat-card ${color||''}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard(){
  try{
    const d = await api('/dashboard');
    let cards = [];
    if(d.role==='admin' || d.role==='bursar'){
      cards.push(card('Active Students', d.activeStudents, 'Currently enrolled', ''));
      cards.push(card('Fees Collected', money(d.collected), 'This term, all classes', 'gold'));
      cards.push(card('Outstanding Balance', money(d.outstanding), `${d.defaulters} invoice(s) not fully paid`, 'brick'));
      cards.push(card('Attendance Today', d.attendanceToday.total? `${d.attendanceToday.present}/${d.attendanceToday.total}` : '—', d.attendanceToday.total? `${d.attendanceToday.absent} absent` : 'Not taken yet', 'sky'));
    }
    if(d.role==='teacher'){
      cards.push(card('My Class Size', d.classSize, d.myClass, ''));
      cards.push(card('Attendance Today', d.attendanceToday.total? `${d.attendanceToday.present}/${d.attendanceToday.total}` : 'Not taken', d.attendanceToday.total? `${d.attendanceToday.absent} absent`:'Go to Attendance', 'gold'));
    }
    if(d.role==='parent'){
      cards.push(card('Children Enrolled', d.childrenCount, d.childrenNames.join(', ') || '', ''));
      cards.push(card('Combined Fee Balance', money(d.balance), d.childrenCount>1?'Across all children':'', d.balance>0?'brick':''));
      cards.push(card('Attendance Record', d.attendance.total? `${d.attendance.present}/${d.attendance.total}` : 'No data yet', 'Days present / recorded, all children', 'gold'));
    }
    document.getElementById('dashStats').innerHTML = cards.join('');
  }catch(e){ toast(e.message, true); }
}

/* ---------------- Students ---------------- */
let studentsCache = [];
async function renderStudents(){
  document.getElementById('btnAddStudent').style.display = CURRENT_USER.role==='admin' ? 'inline-flex':'none';
  const search = document.getElementById('studentSearch');
  const filt = document.getElementById('studentClassFilter');
  search.oninput = doLoad; filt.onchange = doLoad;

  async function doLoad(){
    try{
      const q = new URLSearchParams();
      if(search.value) q.set('q', search.value);
      if(filt.value) q.set('cls', filt.value);
      studentsCache = await api('/students?'+q.toString());
      paintStudents();
    }catch(e){ toast(e.message, true); }
  }
  await doLoad();
}
function paintStudents(){
  const rows = studentsCache.map(s=>{
    const bal = s.balance || 0;
    const st = bal<=0 ? 'paid' : (s.invoice && s.invoice.paid>0 ? 'partial':'unpaid');
    const canPay = (CURRENT_USER.role==='bursar'||CURRENT_USER.role==='admin');
    return `<tr>
      <td>${s.adm_no}</td><td>${escapeHtml(s.name)}</td><td>${s.cls} ${s.stream||''}</td><td>${s.gender}</td>
      <td><span class="badge-status ${s.status}">${s.status}</span></td>
      <td>${escapeHtml(s.guardian_name)}<br><span class="kv">${s.guardian_phone}</span></td>
      <td><span class="badge-status ${st}">${money(bal)}</span></td>
      <td>${canPay && s.invoice ? `<button class="btn btn-outline" onclick="openPaymentModal(${s.invoice.id}, ${s.id})">Record Payment</button>` : ''}</td>
    </tr>`;
  }).join('');
  document.getElementById('studentsBody').innerHTML = rows || `<tr><td colspan="8"><div class="empty-state">No students match your search.</div></td></tr>`;
}

function openAdmitModal(){
  ['admName','admGuardianName','admGuardianPhone','admGuardianEmail','admParentUsername','admParentPassword'].forEach(id=> document.getElementById(id).value='');
  document.getElementById('admCreateParent').checked = true;
  document.getElementById('parentAccountFields').style.display = 'grid';
  document.getElementById('parentExistingNote').style.display = 'block';
  document.getElementById('admitModal').classList.add('show');
}
function closeModal(id){ document.getElementById(id).classList.remove('show'); }

function toggleParentFields(){
  const on = document.getElementById('admCreateParent').checked;
  document.getElementById('parentAccountFields').style.display = on ? 'grid' : 'none';
  document.getElementById('parentExistingNote').style.display = on ? 'block' : 'none';
}
function generateParentPassword(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  for(let i=0;i<8;i++) pw += chars[Math.floor(Math.random()*chars.length)];
  document.getElementById('admParentPassword').value = pw;
}
// Suggest the guardian's phone number as the parent username as soon as
// it's typed, since that's the realistic default - admin can still edit it.
document.addEventListener('DOMContentLoaded', ()=>{
  const phoneField = document.getElementById('admGuardianPhone');
  if(phoneField) phoneField.addEventListener('input', ()=>{
    const userField = document.getElementById('admParentUsername');
    if(userField && !userField.dataset.touched) userField.value = phoneField.value.replace(/\s+/g,'');
  });
  const userField = document.getElementById('admParentUsername');
  if(userField) userField.addEventListener('input', ()=> userField.dataset.touched = '1');
});

async function admitStudent(){
  const createParent = document.getElementById('admCreateParent').checked;
  const payload = {
    name: document.getElementById('admName').value.trim(),
    gender: document.getElementById('admGender').value,
    dob: document.getElementById('admDob').value,
    cls: document.getElementById('admClass').value,
    stream: document.getElementById('admStream').value,
    boarding: document.getElementById('admBoarding').value,
    guardian_name: document.getElementById('admGuardianName').value.trim(),
    guardian_phone: document.getElementById('admGuardianPhone').value.trim(),
    guardian_email: document.getElementById('admGuardianEmail').value.trim() || null,
    create_parent_account: createParent,
    parent_username: createParent ? document.getElementById('admParentUsername').value.trim() : null,
    parent_password: createParent ? document.getElementById('admParentPassword').value : null
  };
  if(!payload.name || !payload.guardian_name || !payload.guardian_phone){ toast('Please fill in all required fields (*).', true); return; }
  if(createParent && (!payload.parent_username || !payload.parent_password || payload.parent_password.length<8)){
    toast('Parent username and an 8+ character password are required (or untick "Create a parent portal login").', true); return;
  }
  try{
    const res = await api('/students', {method:'POST', body: JSON.stringify(payload)});
    toast(`${payload.name} admitted as ${res.admNo}. Invoice generated and admin notified.`);
    closeModal('admitModal');
    renderStudents();
    if(res.parentAccount){
      showParentSlip(payload.name, res.admNo, res.parentAccount);
    }
  }catch(e){ toast(e.message, true); }
}
function showParentSlip(studentName, admNo, parentAccount){
  document.getElementById('parentSlipBody').innerHTML = `
    <h4>Gayaza Road Secondary School</h4>
    <div style="text-align:center;font-size:11px;color:#555;">Parent Portal Access Slip</div>
    <hr>
    <div class="row"><span>Student</span><b>${escapeHtml(studentName)}</b></div>
    <div class="row"><span>Admission No</span><span>${admNo}</span></div>
    <hr>
    <div class="row"><span>Portal Username</span><b>${escapeHtml(parentAccount.username)}</b></div>
    ${parentAccount.isNewAccount
      ? `<div class="row"><span>Temporary Password</span><b>${escapeHtml(document.getElementById('admParentPassword').value)}</b></div>`
      : `<div class="row"><span>Note</span><span>Linked to existing login</span></div>`}
    <hr>
    <div style="text-align:center;font-size:11px;color:#555;">Give this slip to the guardian. They can log in at the school portal to check fees, attendance and payment history.</div>
  `;
  document.getElementById('parentSlipModal').classList.add('show');
}

/* ---------------- Fees & Payments ---------------- */
let invoicesCache = [];
async function renderInvoices(){
  try{
    const summary = await api('/fees/summary');
    document.getElementById('feesStats').innerHTML = [
      card('Total Collected', money(summary.collected), 'All recorded payments', ''),
      card('Outstanding', money(summary.outstanding), 'Across all invoices', 'brick'),
      card('Defaulting Invoices', summary.defaulters+' / '+summary.totalInvoices, 'Not yet fully paid', 'gold')
    ].join('');
  }catch(e){}

  const search = document.getElementById('feeSearch');
  const statusFilter = document.getElementById('feeStatusFilter');
  search.oninput = doLoad; statusFilter.onchange = doLoad;

  async function doLoad(){
    try{
      const q = new URLSearchParams();
      if(search.value) q.set('q', search.value);
      if(statusFilter.value) q.set('status', statusFilter.value);
      invoicesCache = await api('/fees/invoices?'+q.toString());
      paintInvoices();
    }catch(e){ toast(e.message, true); }
  }
  await doLoad();
}
function paintInvoices(){
  const rows = invoicesCache.map(inv=>`
    <tr>
      <td>#INV-${String(inv.id).padStart(4,'0')}</td>
      <td>${escapeHtml(inv.student_name)} <span class="kv">(${inv.adm_no})</span></td>
      <td>${inv.cls} ${inv.stream||''}</td>
      <td>${inv.term}</td>
      <td>${money(inv.amount)}</td>
      <td>${money(inv.paid)}</td>
      <td>${money(inv.balance)}</td>
      <td><span class="badge-status ${inv.status}">${inv.status}</span></td>
      <td>${inv.status!=='paid' ? `<button class="btn btn-outline" onclick="openPaymentModal(${inv.id})">Record Payment</button>` : '<span class="kv">Settled</span>'}</td>
    </tr>`).join('');
  document.getElementById('invoicesBody').innerHTML = rows || `<tr><td colspan="9"><div class="empty-state">No invoices match your filters.</div></td></tr>`;
}

function openPaymentModal(invoiceId){
  document.getElementById('payInvoiceId').value = invoiceId;
  const inv = invoicesCache.find(i=>i.id===invoiceId) ||
              (studentsCache.find(s=>s.invoice && s.invoice.id===invoiceId) || {}).invoice;
  const label = inv ? `Invoice #INV-${String(invoiceId).padStart(4,'0')} — Balance: ${money((inv.balance!==undefined?inv.balance:(inv.amount-inv.paid)))}` : `Invoice #${invoiceId}`;
  document.getElementById('paymentInvoiceInfo').innerHTML = `<b>${label}</b>`;
  document.getElementById('payAmount').value = '';
  document.getElementById('paymentModal').classList.add('show');
}
async function recordPayment(){
  const invoiceId = document.getElementById('payInvoiceId').value;
  const amount = Number(document.getElementById('payAmount').value);
  const method = document.getElementById('payMethod').value;
  if(!amount || amount<=0){ toast('Enter a valid amount.', true); return; }
  try{
    const res = await api(`/fees/invoices/${invoiceId}/payments`, {method:'POST', body: JSON.stringify({amount, method})});
    toast('Payment recorded. Admin notified by email.');
    closeModal('paymentModal');
    showReceipt(res);
    renderStudents(); renderInvoices();
  }catch(e){ toast(e.message, true); }
}
function showReceipt(res){
  document.getElementById('receiptBody').innerHTML = `
    <h4>Gayaza Road Secondary School</h4>
    <div style="text-align:center;font-size:11px;color:#555;">Kyebando, Gayaza Road, Kampala</div>
    <hr>
    <div class="row"><span>Receipt No.</span><b>${res.receiptNo}</b></div>
    <div class="row"><span>Date</span><span>${new Date().toLocaleString('en-GB')}</span></div>
    <div class="row"><span>Student</span><span>${escapeHtml(res.student.name)}</span></div>
    <div class="row"><span>Adm. No</span><span>${res.student.adm_no}</span></div>
    <hr>
    <div class="row"><span>Invoice Total</span><span>${money(res.invoice.amount)}</span></div>
    <div class="row"><span>Total Paid</span><span>${money(res.invoice.paid)}</span></div>
    <div class="row"><b>Balance</b><b>${money(res.invoice.balance)}</b></div>
    <hr>
    <div style="text-align:center;font-size:11px;color:#555;">Thank you. Received on behalf of Gayaza Road Secondary School.</div>
  `;
  document.getElementById('receiptModal').classList.add('show');
}

/* ---------------- Attendance ---------------- */
let attendanceRows = [];
async function loadAttendanceSheet(){
  const cls = document.getElementById('attClass').value;
  const date = document.getElementById('attDate').value || todayStr();
  try{
    attendanceRows = await api(`/attendance?cls=${encodeURIComponent(cls)}&date=${encodeURIComponent(date)}`);
    document.getElementById('attendanceBody').innerHTML = attendanceRows.map(s=>`
      <tr data-student="${s.id}">
        <td>${s.adm_no}</td><td>${escapeHtml(s.name)}</td>
        <td><select>
          <option ${s.attendanceStatus==='Present'?'selected':''}>Present</option>
          <option ${s.attendanceStatus==='Absent'?'selected':''}>Absent</option>
          <option ${s.attendanceStatus==='Late'?'selected':''}>Late</option>
          <option ${s.attendanceStatus==='Excused'?'selected':''}>Excused</option>
        </select></td>
      </tr>`).join('') || `<tr><td colspan="3"><div class="empty-state">No active students in this class.</div></td></tr>`;
  }catch(e){ toast(e.message, true); }
}
async function saveAttendance(){
  const cls = document.getElementById('attClass').value;
  const date = document.getElementById('attDate').value || todayStr();
  const rows = document.querySelectorAll('#attendanceBody tr[data-student]');
  const records = Array.from(rows).map(r=>({ studentId: Number(r.dataset.student), status: r.querySelector('select').value }));
  try{
    const res = await api('/attendance', {method:'POST', body: JSON.stringify({cls, date, records})});
    toast(`Attendance saved. ${res.absentCount} absent — admin notified by email.`);
  }catch(e){ toast(e.message, true); }
}

/* ---------------- Parent Portal ---------------- */
let parentChildrenCache = [];
async function renderParent(){
  const box = document.getElementById('parentContent');
  try{
    parentChildrenCache = await api('/parent/children');
    const switcher = parentChildrenCache.length > 1 ? `
      <div class="child-switcher">
        ${parentChildrenCache.map((c,i)=>`<button class="child-tab ${i===0?'active':''}" data-cid="${c.id}" onclick="selectChild(${c.id}, this)">${escapeHtml(c.name.split(' ')[0])} <span class="kv">(${c.cls})</span></button>`).join('')}
      </div>` : '';
    box.innerHTML = switcher + `<div id="childDetail"></div>`;
    await loadChildDetail(parentChildrenCache[0].id);
  }catch(e){ box.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
function selectChild(id, btn){
  document.querySelectorAll('.child-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadChildDetail(id);
}
async function loadChildDetail(studentId){
  const target = document.getElementById('childDetail');
  target.innerHTML = `<div class="empty-state">Loading…</div>`;
  try{
    const data = await api('/parent/student/'+studentId);
    const {student, invoice, payments, attendance} = data;
    target.innerHTML = `
      <div class="card" style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;">
          <div>
            <div style="font-size:17px;font-weight:800;">${escapeHtml(student.name)}</div>
            <div class="kv">${student.adm_no} · ${student.cls} ${student.stream||''} · ${student.boarding}</div>
          </div>
          <div style="text-align:right;">
            <div class="kv">Fee Balance</div>
            <div style="font-size:20px;font-weight:800;color:${invoice && invoice.balance>0 ? 'var(--brick)':'var(--forest)'};">${money(invoice?invoice.balance:0)}</div>
          </div>
        </div>
      </div>
      <div class="section-title">Payment History</div>
      <div class="table-wrap" style="margin-bottom:20px;">
        <table><thead><tr><th>Receipt</th><th>Date</th><th>Amount</th><th>Method</th></tr></thead>
        <tbody>${payments.map(p=>`<tr><td>${p.receipt_no}</td><td>${fmtDate(p.created_at)}</td><td>${money(p.amount)}</td><td>${p.method}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty-state">No payments recorded yet.</div></td></tr>'}</tbody></table>
      </div>
      <div class="section-title">Recent Attendance</div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead>
      <tbody>${attendance.map(a=>`<tr><td>${a.date}</td><td><span class="badge-status ${a.status.toLowerCase()}">${a.status}</span></td></tr>`).join('') || '<tr><td colspan="2"><div class="empty-state">No attendance recorded yet.</div></td></tr>'}</tbody></table></div>
    `;
  }catch(e){ target.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}

/* ---------------- Notifications & Audit ---------------- */
async function renderNotifications(){
  try{
    const rows = await api('/notifications');
    document.getElementById('notificationsBody').innerHTML = rows.map(r=>`
      <tr><td>${fmtDate(r.created_at)}</td><td>${escapeHtml(r.to_email)}</td><td>${escapeHtml(r.subject)}</td>
      <td><span class="badge-status ${r.status.startsWith('sent')?'paid':'unpaid'}">${escapeHtml(r.status)}</span></td></tr>
    `).join('') || `<tr><td colspan="4"><div class="empty-state">No notifications yet.</div></td></tr>`;
  }catch(e){ toast(e.message, true); }
}
async function renderAudit(){
  try{
    const rows = await api('/audit');
    document.getElementById('auditBody').innerHTML = rows.map(a=>`
      <tr><td>${fmtDate(a.created_at)}</td><td>${escapeHtml(a.username)}</td><td>${escapeHtml(a.role||'')}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.detail||'')}</td></tr>
    `).join('') || `<tr><td colspan="5"><div class="empty-state">No activity yet.</div></td></tr>`;
  }catch(e){ toast(e.message, true); }
}

/* ---------------- Settings ---------------- */
async function renderSettings(){
  try{
    const s = await api('/settings');
    document.getElementById('setSchoolName').value = s.schoolName || '';
    document.getElementById('setMotto').value = s.motto || '';
    document.getElementById('setSchoolLoc').value = s.location || '';
    document.getElementById('setTerm').value = s.term || 'Term 1';
    document.getElementById('setYear').value = s.year || '';

    const fs = await api('/fees/structures');
    document.getElementById('feeStructBody').innerHTML = fs.map(f=>`
      <tr><td>${f.cls}</td>
      <td><input type="number" value="${f.amount}" style="width:140px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;" onchange="updateFeeStruct('${f.cls}', this.value)"></td>
      <td class="kv">Applies to new admissions</td></tr>
    `).join('');
  }catch(e){ toast(e.message, true); }
}
async function updateFeeStruct(cls, val){
  try{
    await api(`/fees/structures/${encodeURIComponent(cls)}`, {method:'PUT', body: JSON.stringify({amount:Number(val)})});
    toast(`${cls} fee updated.`);
  }catch(e){ toast(e.message, true); }
}
async function saveSettings(){
  try{
    await api('/settings', {method:'PUT', body: JSON.stringify({
      schoolName: document.getElementById('setSchoolName').value,
      motto: document.getElementById('setMotto').value,
      location: document.getElementById('setSchoolLoc').value,
      term: document.getElementById('setTerm').value,
      year: document.getElementById('setYear').value
    })});
    toast('Settings saved.');
  }catch(e){ toast(e.message, true); }
}
function toggleNewUserStudentField(){
  const isParent = document.getElementById('newUserRole').value === 'parent';
  document.getElementById('newUserStudentField').style.display = isParent ? 'block' : 'none';
}
async function createUser(){
  const role = document.getElementById('newUserRole').value;
  const payload = {
    username: document.getElementById('newUserUsername').value.trim(),
    password: document.getElementById('newUserPassword').value,
    name: document.getElementById('newUserName').value.trim(),
    role,
    student_adm_nos: role==='parent' ? document.getElementById('newUserAdmNos').value.trim() : undefined
  };
  if(!payload.username || !payload.password || !payload.name){ toast('Fill in all fields.', true); return; }
  try{
    await api('/auth/users', {method:'POST', body: JSON.stringify(payload)});
    toast(`Account "${payload.username}" created.`);
    ['newUserUsername','newUserPassword','newUserName','newUserAdmNos'].forEach(id=> { const el=document.getElementById(id); if(el) el.value=''; });
  }catch(e){ toast(e.message, true); }
}

/* ---------------- Boot ---------------- */
/* ---------------- Reports ---------------- */
async function renderReports(){
  const box = document.getElementById('reportContent');
  box.innerHTML = `<div class="empty-state">Loading report…</div>`;
  try{
    const r = await api('/reports/overview');
    const generated = new Date(r.generatedAt).toLocaleString('en-GB');
    box.innerHTML = `
      <div class="report-header">
        <div style="display:flex;gap:14px;align-items:center;">
          <div class="crest-badge">GRSS</div>
          <div>
            <h2>${escapeHtml(r.schoolName)}</h2>
            <div class="meta">Performance Report · ${escapeHtml(r.term)} ${escapeHtml(r.year)} · Generated ${generated}</div>
          </div>
        </div>
      </div>

      <div class="report-grid">
        <div class="report-metric"><div class="n">${r.overall.activeStudents} / ${r.overall.totalStudents}</div><div class="l">Active Students</div></div>
        <div class="report-metric"><div class="n">${money(r.overall.totalCollected)}</div><div class="l">Fees Collected</div></div>
        <div class="report-metric"><div class="n">${money(r.overall.totalOutstanding)}</div><div class="l">Outstanding</div></div>
        <div class="report-metric"><div class="n">${r.overall.attendanceRatePercent!==null ? r.overall.attendanceRatePercent+'%' : '—'}</div><div class="l">Overall Attendance Rate</div></div>
      </div>

      <div class="section-title">Performance by Class</div>
      <div class="table-wrap" style="margin-bottom:22px;">
        <table>
          <thead><tr><th>Class</th><th>Students</th><th>Invoiced</th><th>Collected</th><th>Outstanding</th><th>Attendance Rate</th></tr></thead>
          <tbody>${r.byClass.map(c=>`
            <tr>
              <td><b>${c.cls}</b></td><td>${c.studentCount}</td><td>${money(c.invoiced)}</td><td>${money(c.collected)}</td>
              <td>${money(c.outstanding)}</td><td>${c.attendanceRatePercent!==null? c.attendanceRatePercent+'%' : '—'}</td>
            </tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">No class data yet.</div></td></tr>'}</tbody>
        </table>
      </div>

      <div class="section-title">Top Fee Defaulters</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Adm. No</th><th>Name</th><th>Class</th><th>Guardian</th><th>Balance</th></tr></thead>
          <tbody>${r.defaulters.map(d=>`
            <tr><td>${d.adm_no}</td><td>${escapeHtml(d.name)}</td><td>${d.cls}</td>
            <td>${escapeHtml(d.guardian_name)}<br><span class="kv">${d.guardian_phone}</span></td>
            <td><span class="badge-status unpaid">${money(d.balance)}</span></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty-state">No outstanding balances. 🎉</div></td></tr>'}</tbody>
        </table>
      </div>
    `;
  }catch(e){
    box.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}
async function downloadReportCsv(){
  try{
    const res = await fetch(API+'/reports/csv', { headers: { 'Authorization': 'Bearer '+TOKEN } });
    if(!res.ok){ const d = await res.json().catch(()=>({})); throw new Error(d.error || 'Download failed.'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gayaza-road-ss-report-${todayStr()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Report downloaded.');
  }catch(e){ toast(e.message, true); }
}

(function boot(){
  const yearEl = document.getElementById('loginYear');
  if(yearEl) yearEl.textContent = new Date().getFullYear();
  if(TOKEN && CURRENT_USER){ enterApp(); }
  document.getElementById('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
})();
