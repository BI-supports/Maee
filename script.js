let db = null;
const DB_STORAGE_KEY = 'problemTrackerDB';
const ITEMS_PER_PAGE = 10;
let currentPage = 1;

let currentChangeID = null;
let currentChangeStatus = null;
let currentEditID = null; // لتحديد المشكلة التي سيتم تعديلها

const modal = document.getElementById("problem-modal");
const openModalBtn = document.getElementById("open-modal-btn");
const closeBtn = document.querySelector(".modal-content .close-btn");
const closeFormBtn = document.getElementById("close-form-btn");

const notifyPopup = document.getElementById("notify-popup");
const notifyText = document.getElementById("notify-text");
const notifyYesBtn = document.getElementById("confirm-yes");
const notifyNoBtn = document.getElementById("confirm-no");

const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");
const pageInfoSpan = document.getElementById("page-info");

function showToast(message, type='info', duration=3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return isNaN(date) ? dateStr : date.toLocaleDateString('en-US');
}

function calculateDays(startDate, endDate) {
    if (!startDate || !endDate) return '-';
    const start = new Date(startDate), end = new Date(endDate);
    return Math.ceil(Math.abs(end-start)/(1000*60*60*24));
}

function saveDB() {
    if (!db) return;
    try {
        const data = db.export();
        const binaryString = String.fromCharCode(...data);
        localStorage.setItem(DB_STORAGE_KEY, btoa(binaryString));
    } catch(e) { console.error(e); }
}

async function initDB() {
    const SQL = await initSqlJs({ locateFile: file => `./sqljs/${file}` });
    const base64Data = localStorage.getItem(DB_STORAGE_KEY);
    if (base64Data) {
        const binary = new Uint8Array(atob(base64Data).split('').map(c=>c.charCodeAt(0)));
        db = new SQL.Database(binary);
        showToast("تم استعادة البيانات السابقة.", "info");
    } else {
        db = new SQL.Database();
        db.run(`CREATE TABLE IF NOT EXISTS problems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            problem_number TEXT,
            entity TEXT,
            description TEXT,
            reporter TEXT,
            phone TEXT,
            status TEXT,
            added_date TEXT,
            completed_date TEXT
        );`);
        showToast("تم إنشاء قاعدة بيانات جديدة.", "info");
    }
    // Ensure legacy DBs get the new column and a unique index on problem_number
    try{
        const info = db.exec("PRAGMA table_info(problems);");
        if(info && info.length){
            const names = info[0].values.map(r=>r[1]);
            if(!names.includes('problem_number')){
                try{ db.run("ALTER TABLE problems ADD COLUMN problem_number TEXT;"); }catch(e){}
            }
        }
        try{ db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_problems_problem_number ON problems(problem_number);"); }catch(e){}
    }catch(e){ console.warn(e); }
    loadProblems();
}

function getProblems() {
    if (!db) return [];
    const res = db.exec("SELECT * FROM problems ORDER BY id DESC");
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c,i)=>[c,row[i]])));
}

function loadProblems() {
    const all = getProblems();
    const totalPages = Math.ceil(all.length/ITEMS_PER_PAGE);
    if(currentPage>totalPages && totalPages>0) currentPage=totalPages;
    const start = (currentPage-1)*ITEMS_PER_PAGE;
    const rows = all.slice(start, start+ITEMS_PER_PAGE);

    const tbody = document.querySelector('#problems-table tbody');
    tbody.innerHTML = '';
    rows.forEach(p=>{
        const days = calculateDays(p.added_date,p.completed_date);
        let cleanPhone = p.phone?.replace(/[^0-9]/g,'')||'';
        if(cleanPhone.startsWith('05')) cleanPhone='966'+cleanPhone.slice(1);
        else if(cleanPhone.startsWith('5')) cleanPhone='966'+cleanPhone;

        let statusClass = p.status==='جديد'?'new':p.status==='جاري حل المشكلة'?'in-progress':'completed';
        let nextText = p.status==='جديد'?'بدء الحل':p.status==='جاري حل المشكلة'?'إكمال':'إعادة فتح';

        const tr = tbody.insertRow();
        tr.innerHTML=`
            <td>${p.problem_number || '-'}</td>
            <td>${p.entity}</td>
            <td>${p.description}</td>
            <td>${formatDate(p.added_date)}</td>
            <td>${formatDate(p.completed_date)}</td>
            <td>${days}</td>
            <td>${p.reporter}</td>
            <td><a href="https://wa.me/${cleanPhone}" target="_blank">💬 ${p.phone||'-'}</a></td>
            <td><span class="status-button ${statusClass}">${p.status}</span></td>
            <td>
                <button class="status-button ${statusClass}" data-id="${p.id}" data-status="${p.status}">${nextText}</button>
                <button class="edit-button" data-id="${p.id}">✏️</button>
            </td>
            <td><button class="delete-button" data-id="${p.id}">❌</button></td>
        `;
    });

    pageInfoSpan.textContent=`الصفحة ${totalPages?currentPage:0} من ${totalPages}`;
    prevPageBtn.disabled=currentPage===1||totalPages===0;
    nextPageBtn.disabled=currentPage===totalPages||totalPages===0;

    updateCounters(all);

    // bind buttons
    tbody.querySelectorAll('.status-button[data-id]').forEach(btn=>{
        btn.onclick=()=> handleStatusClick(btn.dataset.id, btn.dataset.status);
    });
    tbody.querySelectorAll('.delete-button').forEach(btn=>{
        btn.onclick=()=> deleteProblem(btn.dataset.id);
    });
    tbody.querySelectorAll('.edit-button').forEach(btn=>{
        btn.onclick=()=> editProblem(btn.dataset.id);
    });
}

function updateCounters(all){
    document.getElementById('total-count').textContent=all.length;
    document.getElementById('new-count').textContent=all.filter(p=>p.status==='جديد').length;
    document.getElementById('in-progress-count').textContent=all.filter(p=>p.status==='جاري حل المشكلة').length;
    document.getElementById('completed-count').textContent=all.filter(p=>p.status==='مكتملة').length;
}

// توليد رقم مشكلة جديد
function generateProblemNumber() {
    const res = db.exec("SELECT MAX(CAST(SUBSTR(problem_number, 3) AS INTEGER)) as max_num FROM problems WHERE problem_number LIKE 'P-%'");
    let maxNum = 0;
    if (res && res.length && res[0].values.length && res[0].values[0][0] !== null) {
        maxNum = parseInt(res[0].values[0][0], 10);
    }
    return `P-${String(maxNum + 1).padStart(4, '0')}`;
}

function saveProblem(e){
    e.preventDefault();
    let problemNumber = document.getElementById('problem-number')?.value.trim() || null;
    const entity=document.getElementById('entity-name').value;
    const desc=document.getElementById('problem-description').value;
    const reporter=document.getElementById('reporter-name').value;
    const phone=document.getElementById('reporter-phone').value;
    const status=document.getElementById('problem-status').value;

    if(currentEditID){
        // عند التعديل: إذا لم يكن هناك رقم مشكلة، نحافظ على القيمة القديمة
        if (!problemNumber) {
            const res = db.exec(`SELECT problem_number FROM problems WHERE id=${currentEditID}`);
            if (res && res.length && res[0].values.length) {
                problemNumber = res[0].values[0][0];
            }
        }
        const stmt=db.prepare("UPDATE problems SET entity=?,description=?,reporter=?,phone=?,status=?,problem_number=? WHERE id=?");
        stmt.run([entity,desc,reporter,phone,status,problemNumber,currentEditID]);
        stmt.free();
        showToast("تم تعديل المشكلة بنجاح!", "success");
        currentEditID=null;
    } else {
        // عند الإضافة: إذا لم يكن هناك رقم مشكلة، نولد رقماً جديداً
        if (!problemNumber) {
            problemNumber = generateProblemNumber();
        }
        const added=new Date().toISOString();
        const stmt=db.prepare("INSERT INTO problems (entity,description,reporter,phone,status,added_date,problem_number) VALUES (?,?,?,?,?,?,?)");
        stmt.run([entity,desc,reporter,phone,status,added,problemNumber]);
        stmt.free();
        showToast("تمت إضافة المشكلة بنجاح!", "success");
    }

    saveDB();
    document.getElementById('problem-form').reset();
    modal.style.display='none';
    currentPage=1;
    loadProblems();
}

function editProblem(id){
    const res=db.exec(`SELECT * FROM problems WHERE id=${id}`);
    if(!res.length) return;
    const row=res[0].values[0];
    const cols=res[0].columns;
    const p=Object.fromEntries(cols.map((c,i)=>[c,row[i]]));

    document.getElementById('entity-name').value=p.entity;
    document.getElementById('problem-description').value=p.description;
    document.getElementById('reporter-name').value=p.reporter;
    document.getElementById('reporter-phone').value=p.phone;
    document.getElementById('problem-status').value=p.status;
    if(document.getElementById('problem-number')) document.getElementById('problem-number').value = p.problem_number || '';

    modal.style.display='block';
    currentEditID=id;
}

function handleStatusClick(id,status){
    currentChangeID=id;
    currentChangeStatus=status;
    if(status==='جاري حل المشكلة'){
        const res=db.exec(`SELECT reporter,description,phone FROM problems WHERE id=${id}`);
        if(res.length){
            const [reporter,desc,phone]=res[0].values[0];
            notifyText.textContent=`هل تريد إشعار المستفيد ${reporter} بأنه تم حل المشكلة؟`;
            notifyPopup.style.display='flex';
        }
    } else toggleStatus(id,status,false);
}

notifyYesBtn.onclick=()=> { toggleStatus(currentChangeID,currentChangeStatus,true); notifyPopup.style.display='none'; }
notifyNoBtn.onclick=()=> { toggleStatus(currentChangeID,currentChangeStatus,false); notifyPopup.style.display='none'; }

function toggleStatus(id,status,notify=false){
    let newStatus=status==='جديد'?'جاري حل المشكلة':status==='جاري حل المشكلة'?'مكتملة':'جديد';
    let completed=status==='جاري حل المشكلة'?new Date().toISOString():null;

    if(notify){
        const res=db.exec(`SELECT reporter,phone,description FROM problems WHERE id=${id}`);
        if(res.length){
            const [reporter,phone,desc]=res[0].values[0];
            let cleanPhone=phone?.replace(/[^0-9]/g,'')||'';
            if(cleanPhone.startsWith('05')) cleanPhone='966'+cleanPhone.slice(1);
            else if(cleanPhone.startsWith('5')) cleanPhone='966'+cleanPhone;

            const message=`اهلاً ${reporter} %0A تم حل المشكلة التالية: "${desc}" %0A شكراً لتعاونك`;
            window.open(`https://wa.me/${cleanPhone}?text=${message}`,'_blank');
        }
    }

    const stmt=db.prepare("UPDATE problems SET status=?,completed_date=? WHERE id=?");
    stmt.run([newStatus,completed,id]);
    stmt.free();

    saveDB();
    loadProblems();
    showToast("تم تحديث حالة المشكلة بنجاح","success");
}

let deleteId = null;
const deletePopup = document.getElementById("delete-popup");
const deleteConfirmBtn = document.getElementById("delete-confirm");
const deleteCancelBtn = document.getElementById("delete-cancel");

function deleteProblem(id) {
    deleteId = id;
    deletePopup.classList.add('show');
}

deleteConfirmBtn.onclick = function() {
    if (!deleteId) return;
    
    const stmt = db.prepare("DELETE FROM problems WHERE id=?");
    stmt.run([deleteId]);
    stmt.free();
    
    saveDB();
    loadProblems();
    showToast("تم حذف المشكلة بنجاح", "success");
    deletePopup.classList.remove('show');
    deleteId = null;
}

deleteCancelBtn.onclick = function() {
    deletePopup.classList.remove('show');
    deleteId = null;
}

openModalBtn.onclick=()=>{ modal.style.display='block'; currentEditID=null; };
closeBtn.onclick=closeFormBtn.onclick=()=>{ modal.style.display='none'; document.getElementById('problem-form').reset(); };
window.onclick=e=>{if(e.target==modal){modal.style.display='none'; document.getElementById('problem-form').reset(); } }

// Sidebar functionality
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');

function toggleSidebar() {
    sidebar.classList.toggle('active');
    sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
    sidebar.classList.remove('active');
    sidebarOverlay.classList.remove('active');
}

document.addEventListener('DOMContentLoaded',()=>{
    // Hide all popups by default
    document.querySelectorAll('.popup-overlay').forEach(popup => {
        popup.classList.remove('show');
    });
    
    // تحقق من المشكلات المتأخرة كل دقيقة
    checkDelayedProblems();
    setInterval(checkDelayedProblems, 60000);
    
    initDB();
    document.getElementById('problem-form').addEventListener('submit', saveProblem);

    // Sidebar event listeners
    toggleSidebarBtn.addEventListener('click', toggleSidebar);
    closeSidebarBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // إدارة الإشعارات
const notificationsBtn = document.getElementById('notifications-btn');
const notificationsPanel = document.getElementById('notifications-panel');
const notificationsCount = document.getElementById('notifications-count');
const notificationsList = document.getElementById('notifications-list');
const closeNotificationsBtn = document.getElementById('close-notifications');

function checkDelayedProblems() {
    if (!db) return;
    
    // تحديد تاريخ اليوم في منتصف الليل (بدون وقت)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const problems = getProblems().filter(p => {
        // تجاهل المشكلات المكتملة
        if (!p.added_date || p.status === 'مكتملة') return false;
        
        // تحويل تاريخ الإضافة إلى منتصف الليل (بدون وقت)
        const addedDate = new Date(p.added_date);
        if (isNaN(addedDate)) return false;
        addedDate.setHours(0, 0, 0, 0);
        
        // حساب الفرق بالأيام
        const diffTime = today.getTime() - addedDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        // إظهار الإشعار فقط إذا مر يوم كامل على الأقل
        return diffDays >= 1;
    });
    
    // تحديث عدد الإشعارات
    notificationsCount.style.display = 'flex';
    notificationsCount.textContent = problems.length;
    
    if (problems.length > 0) {
        notificationsCount.classList.add('has-notifications');
        notificationsCount.classList.remove('no-notifications');
    } else {
        notificationsCount.classList.add('no-notifications');
        notificationsCount.classList.remove('has-notifications');
        notificationsCount.textContent = '0';
    }
    
    // تحديث قائمة الإشعارات
    notificationsList.innerHTML = '';
    problems.forEach(p => {
        const days = calculateDays(p.added_date, new Date().toISOString());
        const statusEmoji = p.status === 'جديد' ? '🔴' : p.status === 'جاري حل المشكلة' ? '🟡' : '⚪';
        
        const item = document.createElement('div');
        item.className = 'notification-item';
        item.innerHTML = `
            <div class="notification-icon">⚠️</div>
            <div class="notification-content">
                <div class="notification-title">مشكلة غير مكتملة ${statusEmoji}</div>
                <div class="notification-desc">
                    المشكلة: "${p.description}"
                    <br>
                    الجهة: ${p.entity}
                    <br>
                    الحالة: ${p.status}
                    <br>
                    مضى عليها: ${days} يوم
                </div>
            </div>
        `;
        item.onclick = () => {
            notificationsPanel.classList.remove('active');
            // التمرير إلى المشكلة في الجدول
            const row = document.querySelector(`tr[data-id="${p.id}"]`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        notificationsList.appendChild(item);
    });
}

// فتح/إغلاق لوحة الإشعارات
notificationsBtn.onclick = () => {
    notificationsPanel.classList.toggle('active');
};

closeNotificationsBtn.onclick = () => {
    notificationsPanel.classList.remove('active');
};

// إغلاق الإشعارات عند النقر خارجها
document.addEventListener('click', (e) => {
    if (!notificationsBtn.contains(e.target) && 
        !notificationsPanel.contains(e.target)) {
        notificationsPanel.classList.remove('active');
    }
});

// Connect sidebar buttons to existing functionality
    // Ensure any sidebar button click closes the sidebar (safe delegation)
    document.querySelectorAll('#sidebar .sidebar-btn').forEach(btn => {
        btn.addEventListener('click', () => closeSidebar());
    });

    // Export to CSV (kept from previous implementation)
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => {
        const problems = getProblems();
        if (!problems.length) {
            showToast("لا توجد بيانات للتصدير", "error");
            return;
        }
        
        const headers = ['رقم المشكلة','الجهة', 'المشكلة', 'تاريخ الإضافة', 'تاريخ الإكمال', 'أيام الحل', 'المبلّغ', 'الهاتف', 'الحالة'];
        const csv = [
            headers.join(','),
            ...problems.map(p => [
                p.problem_number || '',
                p.entity,
                p.description,
                formatDate(p.added_date),
                formatDate(p.completed_date),
                calculateDays(p.added_date, p.completed_date),
                p.reporter,
                p.phone,
                p.status
            ].join(','))
        ].join('\n');
        
        const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `problems_report_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        closeSidebar();
    });

    // Import problems from Excel/CSV (uses same exported report format)
    const importExcelBtn = document.getElementById('import-excel-btn');
    const importExcelInput = document.getElementById('import-excel-input');
    if (importExcelBtn && importExcelInput) {
        importExcelBtn.addEventListener('click', () => importExcelInput.click());

        importExcelInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const ext = (file.name || '').split('.').pop().toLowerCase();
            const reader = new FileReader();

            const handleJson = (json) => {
                if (!json || !json.length) {
                    showToast('الملف لا يحتوي على بيانات', 'error');
                    return;
                }

                // Map expected headers to DB fields
                // Expected headers (from export): الجهة, المشكلة, تاريخ الإضافة, تاريخ الإكمال, أيام الحل, المبلّغ, الهاتف, الحالة
                let inserted = 0;
                try {
                    db.run('BEGIN TRANSACTION;');
                    json.forEach(row => {
                        const entity = row['الجهة'] || row['جهة'] || '';
                        const description = row['المشكلة'] || row['وصف'] || '';
                        let added = row['تاريخ الإضافة'] || row['added_date'] || '';
                        let completed = row['تاريخ الإكمال'] || row['completed_date'] || '';
                        const reporter = row['المبلّغ'] || row['المبلغ'] || '';
                        const phone = row['الهاتف'] || row['Phone'] || '';
                        const status = row['الحالة'] || 'جديد';

                        // helper to parse cell dates (handles Excel serial numbers)
                        const parseCellDate = (val) => {
                            if (val === null || val === undefined || val === '') return null;
                            // Excel stores dates as numbers (serial) in many cases
                            if (typeof val === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
                                const dc = XLSX.SSF.parse_date_code(val);
                                if (dc && dc.y) {
                                    const D = new Date(dc.y, (dc.m||1)-1, dc.d || 1, dc.H||0, dc.M||0, Math.floor(dc.S)||0);
                                    return D.toISOString();
                                }
                            }
                            if (val instanceof Date) return val.toISOString();
                            // try native parsing
                            const d = new Date(val);
                            if (!isNaN(d)) return d.toISOString();
                            // try dd/mm/yyyy
                            const parts = (''+val).split(/[\/\-.]/).map(p=>p.trim());
                            if (parts.length===3) {
                                const day = parseInt(parts[0],10);
                                const month = parseInt(parts[1],10)-1;
                                const year = parseInt(parts[2],10);
                                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                                    const D = new Date(year, month, day);
                                    if (!isNaN(D)) return D.toISOString();
                                }
                            }
                            return null;
                        };

                        let problemNumber = row['رقم المشكلة'] || row['رقم_المشكلة'] || row['problem_number'] || row['Problem Number'] || '';
                        problemNumber = ((''+problemNumber).trim()||null);

                        added = parseCellDate(added) || new Date().toISOString();
                        completed = parseCellDate(completed);

                        // إذا لم يكن هناك رقم مشكلة، نولد رقماً جديداً
                        if (!problemNumber) {
                            problemNumber = generateProblemNumber();
                        }

                        // محاولة تحديث السجل الموجود أو إضافة سجل جديد
                        const pnEsc = (''+problemNumber).replace(/'/g, "''");
                        const existing = db.exec(`SELECT id FROM problems WHERE problem_number='${pnEsc}'`);
                        if (existing && existing.length && existing[0].values.length) {
                            const existingId = existing[0].values[0][0];
                            const stmtU = db.prepare("UPDATE problems SET entity=?,description=?,reporter=?,phone=?,status=?,added_date=?,completed_date=? WHERE id=?");
                            stmtU.run([entity, description, reporter, phone, status, added, completed, existingId]);
                            stmtU.free();
                        } else {
                            const stmt = db.prepare("INSERT INTO problems (entity,description,reporter,phone,status,added_date,completed_date,problem_number) VALUES (?,?,?,?,?,?,?,?)");
                            stmt.run([entity, description, reporter, phone, status, added, completed, problemNumber]);
                            stmt.free();
                        }
                        inserted++;
                    });
                    db.run('COMMIT;');
                } catch (err) {
                    console.error(err);
                    try { db.run('ROLLBACK;'); } catch(e){}
                    showToast('حدث خطأ أثناء استيراد الملف', 'error');
                    return;
                }

                saveDB();
                loadProblems();
                showToast(`تم استيراد ${inserted} صف.`, 'success');
                importExcelInput.value = null;
                closeSidebar();
            };

            reader.onerror = function() {
                showToast('فشل قراءة الملف', 'error');
            };

            if (ext === 'csv') {
                reader.onload = function(ev) {
                    const txt = ev.target.result;
                    // let SheetJS parse CSV
                    const wb = XLSX.read(txt, { type: 'string' });
                    const first = wb.SheetNames[0];
                    const sheet = wb.Sheets[first];
                    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    handleJson(json);
                };
                reader.readAsText(file, 'utf-8');
            } else {
                // xls/xlsx
                reader.onload = function(ev) {
                    const data = ev.target.result;
                    const wb = XLSX.read(data, { type: 'binary' });
                    const first = wb.SheetNames[0];
                    const sheet = wb.Sheets[first];
                    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    handleJson(json);
                };
                reader.readAsBinaryString(file);
            }
        });
    }

    // Backup / export sqlite file
    const exportSqliteBtn = document.getElementById('export-sqlite-btn');
    if (exportSqliteBtn) exportSqliteBtn.addEventListener('click', () => {
        if (!db) {
            showToast("لا يمكن إنشاء نسخة احتياطية", "error");
            return;
        }
        const data = db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `problemtracker_backup_${new Date().toISOString().split('T')[0]}.db`;
        a.click();
        URL.revokeObjectURL(url);
        closeSidebar();
    });
    prevPageBtn.onclick=()=>{ currentPage--; loadProblems(); };
    nextPageBtn.onclick=()=>{ currentPage++; loadProblems(); };
    notifyPopup.style.display='none';
});
