/**
 * =====================================================================
 * Code.gs — ไฟล์หลัก: เปิดหน้าเว็บ, ติดตั้งชีต, อ่าน/เขียนข้อมูล, คำสั่ง API
 * ---------------------------------------------------------------------
 * หลักการความปลอดภัย:
 *  - Google Sheets ไม่แชร์ให้ใคร ผู้ใช้เข้าถึงข้อมูลได้ทางหน้าเว็บเท่านั้น
 *  - ทุกคำสั่งจากหน้าเว็บผ่านฟังก์ชัน api() ซึ่งตรวจ session + สิทธิ์ทุกครั้ง
 *  - ผู้ใช้ รพ.สต. ถูกกรองข้อมูลฝั่งเซิร์ฟเวอร์ ให้เห็นเฉพาะ รพ.สต. ของตัวเอง
 * =====================================================================
 */

/* ------------------------------------------------------------------
 * 1) เปิดหน้าเว็บ
 * ------------------------------------------------------------------ */

/**
 * doGet ทำงานทุกครั้งที่มีคนเปิดลิงก์เว็บแอป
 * ถ้า URL มี ?code=...&state=... แปลว่าเพิ่งกลับมาจากหน้า login ของ Google/LINE
 */
function doGet(e) {
  const p = (e && e.parameter) || {};                       // พารามิเตอร์ใน URL
  rememberExecUrl_();                                        // จำลิงก์ /exec ไว้ใช้ตอนส่ง LINE
  const boot = {                                             // ข้อมูลตั้งต้นที่ส่งให้หน้าเว็บ
    appName: APP_NAME,
    footer: APP_FOOTER,
    logo: LOGO_URL,                                          // โลโก้ (เก็บบน GitHub Pages)
    execUrl: redirectUri_(),                                 // ลิงก์เว็บแอป (ใช้โหลดหน้าใหม่/ออกจากระบบ)
    view: p.view || '',                                      // หน้าที่ต้องการเปิด (จากปุ่มใน LINE)
    pcu: p.pcu || '',
    session: '',
    notice: '',
    error: ''
  };
  if (p.code && p.state) {                                   // กลับมาจากการ login
    const r = handleOAuthCallback_(p.code, p.state);
    boot.view = r.view || boot.view;                         // กลับไปหน้าที่ตั้งใจเปิด (เช่น จากการ์ด LINE)
    boot.pcu = r.pcu || boot.pcu;
    boot.session = r.session || '';
    boot.notice = r.notice || '';
    boot.error = r.error || '';
  } else if (p.error) {                                      // ผู้ใช้กดยกเลิกที่หน้า login
    boot.error = 'ยกเลิกการเข้าสู่ระบบ';
  }
  boot.loginUrls = {                                         // ลิงก์ปุ่ม login (จำหน้าที่จะเปิดหลัง login ไว้ใน state)
    google: googleAuthUrl_(boot.view, boot.pcu),
    line: lineAuthUrl_('login', '', boot.view, boot.pcu)
  };
  const t = HtmlService.createTemplateFromFile('Index');
  // แปลงเป็น JSON และแทน "<" กันการแทรกสคริปต์
  t.bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(APP_NAME)
    .setFaviconUrl(FAVICON_URL)                              // ไอคอนบนแท็บเบราว์เซอร์
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');   // ให้แสดงผลพอดีจอมือถือ
}

/* ------------------------------------------------------------------
 * 2) ติดตั้งระบบครั้งแรก — กดรันฟังก์ชัน setup ในหน้า Apps Script 1 ครั้ง
 * ------------------------------------------------------------------ */
function setup() {
  // สร้าง/อัปเดตหัวตารางทุกแท็บ (รันซ้ำได้ เมื่อเพิ่มคอลัมน์ใหม่ ข้อมูลเดิมไม่หาย)
  Object.keys(SHEETS).forEach(function (key) { ensureSheet_(key); });
  if (readAll_('PCU').length === 0) {                        // ใส่รายชื่อ รพ.สต. ถ้ายังว่าง
    appendMany_('PCU', DEFAULT_PCUS.map(function (n) { return { name: n, active: 'Y' }; }));
  }
  if (readAll_('DRUG').length === 0) {                       // ใส่รายการยา ถ้ายังว่าง
    appendMany_('DRUG', DEFAULT_DRUGS.map(function (r) {
      return { code: r[0], name: r[1], mgPerAmp: r[2], keywords: r[3], active: r[4] };
    }));
  }
  bumpDataVersion_();                                        // ล้างผลรายงานที่เก็บไว้
  Logger.log('ติดตั้งชีตเรียบร้อย');
}

/** สร้างแท็บ (ถ้ายังไม่มี) และเขียนหัวตารางแถวที่ 1 */
function ensureSheet_(key) {
  const def = SHEETS[key];
  const ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);                    // ยังไม่มีแท็บ -> สร้างใหม่
  sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
    .setFontWeight('bold').setBackground('#0B6E4F').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);                                       // ตรึงหัวตาราง
  // ตั้งทุกคอลัมน์เป็น "ข้อความธรรมดา" เพื่อให้ HN 000xxx และวันที่ ไม่ถูกแปลงรูปแบบ
  sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
  touch_(key);
  return sh;
}

/**
 * จำลิงก์ /exec ลง Script Properties อัตโนมัติ
 * (ตอนส่ง LINE ผ่านตัวตั้งเวลา ScriptApp.getService().getUrl() อาจได้ลิงก์ /dev ที่คนทั่วไปเปิดไม่ได้)
 */
function rememberExecUrl_() {
  if (prop_('REDIRECT_URI')) return;
  const u = ScriptApp.getService().getUrl() || '';
  if (/\/exec$/.test(u)) PropertiesService.getScriptProperties().setProperty('REDIRECT_URI', u);
}

/**
 * AuditLog ใหญ่เกิน AUDIT_MAX_ROWS -> เปลี่ยนชื่อแท็บเดิมเก็บไว้ แล้วเริ่มแท็บใหม่
 * (เรียกทุกเช้าจาก sendDailyAlerts)
 */
function rotateAuditLog_() {
  const sh = sh_('AUDIT');
  if (sh.getLastRow() <= AUDIT_MAX_ROWS) return false;
  sh.setName(SHEETS.AUDIT.name + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'));
  ensureSheet_('AUDIT');
  return true;
}

/**
 * แก้ข้อมูลในชีตด้วยมือ (เช่น แก้ชื่อยา mg/amp, อนุมัติผู้ใช้) -> ล้างที่พักให้หน้าเว็บเห็นค่าใหม่ทันที
 * Google เรียกฟังก์ชันนี้เองทุกครั้งที่มีคนพิมพ์ในชีต (Simple trigger)
 */
function onEdit() {
  try {
    CacheService.getScriptCache().removeAll(REF_KEYS.map(function (k) { return 'ref_' + k; }));
    bumpDataVersion_();
  } catch (e) { /* ไม่ให้การพิมพ์ในชีตสะดุด */ }
}

/** ตั้งเวลาแจ้งเตือน LINE ทุกเช้า (รัน 1 ครั้ง หรือกดปุ่มในหน้าตั้งค่า) */
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {     // ลบตัวเก่าก่อน กันส่งซ้ำ
    if (tr.getHandlerFunction() === 'sendDailyAlerts') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('sendDailyAlerts').timeBased()
    .everyDays(1).atHour(ALERT_HOUR).inTimezone(TZ).create();
  return 'ตั้งเวลาแจ้งเตือนทุกวัน ' + ALERT_HOUR + ':00-' + ALERT_HOUR + ':59 น. แล้ว';
}

/* ------------------------------------------------------------------
 * 3) ตัวช่วยอ่าน/เขียน Google Sheets
 * ------------------------------------------------------------------ */

/** ค่าใน Script Properties (ที่เก็บรหัสลับ เช่น API key) */
function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** เปิดไฟล์ Sheets: ใช้ SHEET_ID ถ้าตั้งไว้ ไม่งั้นใช้ไฟล์ที่ผูกสคริปต์อยู่ */
function ss_() {
  const id = prop_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** เปิดแท็บตาม key ใน SHEETS */
function sh_(key) {
  const sh = ss_().getSheetByName(SHEETS[key].name);
  if (!sh) throw new Error('ไม่พบแท็บ ' + SHEETS[key].name + ' กรุณารัน setup');
  return sh;
}

/**
 * ที่พักข้อมูลชั่วคราว: อ่านแท็บเดียวกันซ้ำในคำสั่งเดียว ไม่ต้องอ่านจากชีตใหม่
 * (ล้างอัตโนมัติทุกครั้งที่เขียนแท็บนั้น และเริ่มว่างใหม่ทุกครั้งที่มีการเรียกคำสั่ง)
 */
const MEMO_ = {};

// แท็บเล็กที่ไม่ค่อยเปลี่ยน -> เก็บใน CacheService ข้ามคำสั่งได้ (ลดการอ่านชีตทุกครั้ง)
const REF_KEYS = ['USERS', 'PCU', 'DRUG'];

// แท็บข้อมูลหลัก -> ถ้าถูกแก้ไข ผลรายงานที่เก็บไว้ต้องคำนวณใหม่
const DATA_KEYS = ['DISP', 'INJ', 'PAT', 'REQ'];
let DATA_DIRTY_ = false;

/** อ่านทั้งแท็บเป็นรายการ object และจำเลขแถวไว้ใน _row (ใช้ตอนแก้ไข) */
function readAll_(key) {
  if (!MEMO_[key]) MEMO_[key] = REF_KEYS.indexOf(key) >= 0 ? readRefCached_(key) : readSheet_(key);
  // ส่งสำเนากลับ กันโค้ดส่วนอื่นแก้ข้อมูลในที่พักโดยไม่ตั้งใจ
  return MEMO_[key].map(function (o) { return Object.assign({}, o); });
}

/** อ่านแท็บอ้างอิงผ่าน CacheService (หมดอายุ REF_CACHE_SECONDS หรือถูกล้างเมื่อมีการเขียน) */
function readRefCached_(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('ref_' + key);
  if (hit) return JSON.parse(hit);
  const rows = readSheet_(key);
  try { cache.put('ref_' + key, JSON.stringify(rows), REF_CACHE_SECONDS); } catch (e) { /* ใหญ่เกิน 100KB ก็ไม่เก็บ */ }
  return rows;
}

/** ข้อมูลในแท็บ key เปลี่ยน: ล้างที่พักทุกชั้น */
function touch_(key) {
  delete MEMO_[key];
  if (REF_KEYS.indexOf(key) >= 0) CacheService.getScriptCache().remove('ref_' + key);
  if (DATA_KEYS.indexOf(key) >= 0) DATA_DIRTY_ = true;
}

/** เลขรุ่นข้อมูล: เปลี่ยนทุกครั้งที่ข้อมูลหลักถูกแก้ ผลรายงานรุ่นเก่าจะไม่ถูกใช้ */
function dataVersion_() {
  return prop_('DATA_VER') || '0';
}
function bumpDataVersion_() {
  // เวลา + รหัสสุ่ม: ไม่ซ้ำแม้บันทึก 2 ครั้งในมิลลิวินาทีเดียวกัน
  PropertiesService.getScriptProperties().setProperty('DATA_VER', Date.now() + '-' + Utilities.getUuid().slice(0, 8));
  DATA_DIRTY_ = false;
}

/**
 * ใช้ผลรายงานที่เก็บไว้ ถ้าข้อมูลยังไม่เปลี่ยน ไม่งั้นคำนวณใหม่แล้วเก็บไว้
 * name+params = ชื่อรายงานและตัวกรอง, fn = ฟังก์ชันคำนวณ
 */
function cachedResult_(name, params, fn) {
  const cache = CacheService.getScriptCache();
  const raw = name + '|' + JSON.stringify(params) + '|' + dataVersion_();
  const key = 'res_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const out = fn();
  try { cache.put(key, JSON.stringify(out), RESULT_CACHE_SECONDS); } catch (e) { /* ใหญ่เกิน ไม่เก็บ */ }
  return out;
}

/** อ่านจากชีตจริง */
function readSheet_(key) {
  const values = sh_(key).getDataRange().getValues();
  const headers = SHEETS[key].headers;
  const out = [];
  for (let i = 1; i < values.length; i++) {                  // เริ่มแถวที่ 2 (ข้ามหัวตาราง)
    if (values[i][0] === '') continue;                       // ข้ามแถวว่าง
    const o = { _row: i + 1 };
    headers.forEach(function (h, j) {                        // เก็บเป็นข้อความทั้งหมด
      const v = values[i][j];
      o[h] = (v === undefined || v === null) ? '' : String(v); // คอลัมน์ที่ยังไม่มีในชีต = ค่าว่าง
    });
    out.push(o);
  }
  return out;
}

/** แปลงค่าเป็นข้อความปลอดภัย กันสูตรแปลกปลอม (ข้อความขึ้นต้นด้วย = + - @) */
function cell_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** เพิ่มหลายแถวพร้อมกัน (เร็วกว่าเพิ่มทีละแถว) */
function appendMany_(key, objs) {
  if (!objs.length) return;
  const headers = SHEETS[key].headers;
  const sh = sh_(key);
  touch_(key);                                               // ข้อมูลเปลี่ยน ล้างที่พัก
  const rows = objs.map(function (o) { return headers.map(function (h) { return cell_(o[h]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
}

/** แก้ไขแถวเดิม เฉพาะคอลัมน์ที่ส่งมา */
function update_(key, row, obj) {
  const headers = SHEETS[key].headers;
  touch_(key);                                               // ข้อมูลเปลี่ยน ล้างที่พัก
  const rg = sh_(key).getRange(row, 1, 1, headers.length);
  const cur = rg.getValues()[0];
  headers.forEach(function (h, j) { if (obj[h] !== undefined) cur[j] = cell_(obj[h]); });
  rg.setValues([cur]);
}

/** เวลาปัจจุบันแบบอ่านง่าย */
function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** วันนี้แบบ ISO ตามเวลาไทย */
function todayIso_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/** สร้างรหัสไม่ซ้ำ เช่น D261110143005-123 */
function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + '-' +
    Utilities.getUuid().slice(0, 6);
}

/** บันทึกการใช้งานลง AuditLog */
function audit_(user, action, detail) {
  appendMany_('AUDIT', [{
    time: nowStr_(), uid: user ? user.uid : '-', displayName: user ? user.displayName : 'system',
    action: action, detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
  }]);
}

/** ล็อกระหว่างเขียน กันสองคนบันทึกชนกัน */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {                                // รอได้สูงสุด 20 วินาที
    throw new Error('มีผู้ใช้อื่นกำลังบันทึกข้อมูลอยู่ กรุณากดอีกครั้ง');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * บันทึกการจ่ายยา 1 รายการ + สร้างนัดฉีด + อัปเดตทะเบียนผู้ป่วย
 * ใช้ร่วมกันระหว่าง "สแกน/บันทึก" และ "อนุมัติคำขอย้อนหลัง"
 * ต้องเรียกภายใน withLock_ และผ่าน validateDispense แล้ว
 * outcomes = ผลการฉีดของนัดที่ผ่านมาแล้ว (เฉพาะคำขอย้อนหลัง) หรือ null
 * คืนค่า รหัสการจ่ายยา
 */
function createDispense_(rec, ctx, v, createdBy, outcomes) {
  const c = v.computed;
  const now = nowStr_();
  const id = newId_('D');

  // ยกเลิกนัดที่ยังไม่ฉีดของรอบที่ "เก่ากว่า" (ยาเดียวกัน) ตั้งแต่วันจ่ายยารอบนี้
  // จำรหัสรอบใหม่ไว้ใน replacedBy เพื่อคืนนัดได้ ถ้ารอบใหม่ถูกยกเลิกภายหลัง
  // (รอบที่ใหม่กว่ารอบนี้ จะไม่ถูกแตะ)
  const olderIds = ctx.disps.filter(function (d) {
    return d.drugCode === rec.drugCode && d.dispenseDate < rec.dispenseDate;
  }).map(function (d) { return d.id; });
  readAll_('INJ').forEach(function (i) {
    if (olderIds.indexOf(i.dispenseId) >= 0 && i.status === 'pending' && i.scheduledDate >= rec.dispenseDate) {
      update_('INJ', i._row, {
        status: 'cancelled', replacedBy: id, note: 'แทนด้วยรอบจ่ายยา ' + thaiDate(rec.dispenseDate)
      });
    }
  });

  appendMany_('DISP', [{
    id: id, fiscalYear: c.fiscalYear, recordDate: todayIso_(), dispenseDate: rec.dispenseDate,
    pcu: rec.pcu, hn: rec.hn, name: rec.name, drugCode: rec.drugCode, drugName: c.drugName,
    doseMg: rec.doseMg, ampPerDose: c.ampPerDose, days: rec.days.join(','),
    regimenText: rec.regimenText, qtyAmp: rec.qtyAmp, ampCalc: c.ampCalc,
    appointmentDate: rec.appointmentDate, injCount: c.injCount, allergy: rec.allergy,
    isNew: c.isNew ? 'Y' : 'N', status: 'active', createdBy: createdBy, createdAt: now,
    note: v.warnings.length ? 'ยืนยันคำเตือน: ' + v.warnings.join(' | ') : '',
    everyMonths: c.everyMonths
  }]);

  // สร้างนัดฉีด ครั้งที่ 1, 2, 3, ... ของรอบนี้
  // ถ้ามาจากคำขอย้อนหลัง ใส่ผลการฉีดที่ผู้ส่งระบุไว้ (outcomes) ให้นัดที่ผ่านมาแล้ว
  const res = {};
  (outcomes || []).forEach(function (o) { res[o.date] = o; });
  appendMany_('INJ', c.schedule.map(function (d, k) {
    const o = res[d] && d <= todayIso_() ? res[d] : null;
    return {
      id: id + '-' + (k + 1), dispenseId: id, fiscalYear: fiscalYearOf(d), pcu: rec.pcu,
      hn: rec.hn, name: rec.name, drugCode: rec.drugCode, drugName: c.drugName,
      doseMg: rec.doseMg, ampPerDose: c.ampPerDose, cycleNo: k + 1, scheduledDate: d,
      status: o ? o.status : 'pending',
      actualDate: o && o.status === 'done' ? o.actualDate : '',
      confirmedBy: o ? createdBy : '', confirmedAt: o ? now : '',
      note: o ? ('บันทึกย้อนหลัง' + (o.note ? ': ' + o.note : '')) : ''
    };
  }));

  // ทะเบียนผู้ป่วย: รายใหม่ = เพิ่ม, รายเดิม = อัปเดตชื่อ/รพ.สต./ประวัติแพ้ยา
  if (ctx.pat) {
    const upd = { name: rec.name, pcu: rec.pcu, allergy: rec.allergy, updatedAt: now };
    // ไม่มีรอบที่ใช้งานอยู่ (เช่น รอบแรกถูกยกเลิกเพราะบันทึกผิด) -> นับวันรับยาครั้งแรกใหม่
    if (c.isNew || !ctx.pat.firstDispenseDate || rec.dispenseDate < ctx.pat.firstDispenseDate) {
      upd.firstDispenseDate = rec.dispenseDate;
    }
    update_('PAT', ctx.pat._row, upd);
  } else {
    appendMany_('PAT', [{
      hn: rec.hn, name: rec.name, pcu: rec.pcu, firstDispenseDate: rec.dispenseDate,
      allergy: rec.allergy, updatedAt: now
    }]);
  }
  return id;
}

/* ------------------------------------------------------------------
 * 4) API — หน้าเว็บเรียกผ่าน google.script.run.api(token, action, payload)
 * ------------------------------------------------------------------ */

/**
 * ประตูเดียวของทุกคำสั่ง: ตรวจ session -> ตรวจสิทธิ์ -> ทำงาน -> ส่งผลกลับเป็น JSON
 */
function api(token, action, payload) {
  try {
    const user = requireUser_(token);                        // ไม่มี session = ปฏิเสธ
    const def = ACTIONS[action];
    if (!def) throw new Error('ไม่รู้จักคำสั่ง ' + action);
    if (def.roles.indexOf(user.role) < 0) throw new Error('ไม่มีสิทธิ์ใช้งานส่วนนี้');
    const p = payload || {};
    // คำสั่งอ่านอย่างเดียวที่มี cacheKey -> ใช้ผลที่เก็บไว้ ถ้าข้อมูลยังไม่เปลี่ยน
    const data = def.cacheKey
      ? cachedResult_(action, def.cacheKey(user, p), function () { return def.run(user, p); })
      : def.run(user, p);
    if (DATA_DIRTY_) bumpDataVersion_();                     // มีการแก้ข้อมูล -> ผลรายงานเดิมใช้ไม่ได้
    return JSON.stringify({ ok: true, data: data });
  } catch (err) {
    if (DATA_DIRTY_) bumpDataVersion_();                     // เขียนไปบางส่วนก่อนเกิดข้อผิดพลาด
    console.error(action, err);                              // เก็บ log ไว้ดูใน Executions
    return JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// กลุ่มสิทธิ์
const ALL = ['admin', 'pharmacy', 'pcu'];
const STAFF = ['admin', 'pharmacy'];
const ADMIN = ['admin'];

/** ผู้ใช้ รพ.สต. ต้องดูได้เฉพาะ รพ.สต. ของตัวเอง — ส่วนห้องยาเลือกได้ */
function scopePcu_(user, requested) {
  return user.role === 'pcu' ? user.pcu : (requested || '');
}

/** แปลงข้อมูลฟอร์มให้เป็นชนิดที่ถูกต้อง */
function normalizeRec_(r) {
  r = r || {};
  const num = function (v) { return (v === '' || v === null || v === undefined) ? '' : Number(v); };
  return {
    pcu: String(r.pcu || '').trim(),
    dispenseDate: String(r.dispenseDate || '').trim(),
    hn: normalizeHn(r.hn, HN_LENGTH),                        // "1234" -> "000001234"
    name: String(r.name || '').replace(/\s+/g, ' ').trim(),
    drugCode: String(r.drugCode || '').trim(),
    doseMg: num(r.doseMg),
    days: parseDays(r.days),
    regimenText: String(r.regimenText || '').trim(),
    everyMonths: parseEveryMonths(r.regimenText),            // "ทุก 2 เดือน" -> 2 (ไม่มี = 1)
    qtyAmp: num(r.qtyAmp),
    appointmentDate: String(r.appointmentDate || '').trim(),
    allergy: String(r.allergy || '').trim()
  };
}

/** รวบรวมข้อมูลประกอบการตรวจสอบของ HN นี้ */
function buildCtx_(rec) {
  return {
    pcus: readAll_('PCU').filter(function (x) { return x.active !== 'N'; })
      .map(function (x) { return x.name; }),
    drugs: readAll_('DRUG').filter(function (x) { return x.active !== 'N'; }),
    disps: readAll_('DISP').filter(function (d) { return d.hn === rec.hn && d.status === 'active'; }),
    pat: readAll_('PAT').filter(function (x) { return x.hn === rec.hn; })[0] || null,
    today: todayIso_(),
    hnLength: HN_LENGTH
  };
}

/** มีคำขอย้อนหลังของ HN+ยา+วันจ่ายยาเดียวกัน รออนุมัติอยู่หรือไม่ */
function pendingRequestFor_(rec, exceptId) {
  return readAll_('REQ').some(function (r) {
    return r.status === 'pending' && r.id !== exceptId && r.hn === rec.hn &&
      r.drugCode === rec.drugCode && r.dispenseDate === rec.dispenseDate;
  });
}

/** ทำความสะอาดผลการฉีดที่ส่งมาจากหน้าเว็บ */
function cleanOutcomes_(list) {
  return (Array.isArray(list) ? list : []).map(function (o) {
    return {
      date: String(o.date || ''), status: o.status === 'done' ? 'done' : (o.status === 'missed' ? 'missed' : ''),
      actualDate: o.status === 'done' ? String(o.actualDate || '') : '', note: String(o.note || '').slice(0, 200)
    };
  });
}

/**
 * ตรวจคำขอย้อนหลังทั้งชุด: กฎการจ่ายยาเดิม + ผลการฉีดของนัดที่ผ่านมา + คำขอซ้ำ
 * ใช้ทั้งตอนส่งคำขอ และตอนผู้ดูแลระบบอนุมัติ (ข้อมูลอาจเปลี่ยนระหว่างรอ)
 */
function checkBackfill_(rec, outcomes, hideNames, exceptReqId) {
  const ctx = buildCtx_(rec);
  ctx.hideNames = hideNames;
  const v = validateDispense(rec, ctx);
  if (!v.errors.length) {
    v.errors = v.errors.concat(checkOutcomes(v.computed.schedule, outcomes, ctx.today, rec.dispenseDate));
  }
  if (pendingRequestFor_(rec, exceptReqId)) v.errors.push('มีคำขอย้อนหลังของรายการนี้รออนุมัติอยู่แล้ว');
  v.ctx = ctx;
  return v;
}

/** HN นี้มีการจ่ายยาที่ใช้งานอยู่หรือไม่ (ใช้แยกรายใหม่/รายเดิม) */
function hasActiveDispense_(hn) {
  return readAll_('DISP').some(function (d) { return d.hn === hn && d.status === 'active'; });
}

/** ตัดข้อมูลการฉีดให้เหลือเฉพาะที่หน้าเว็บต้องใช้ */
function injView_(i) {
  return {
    id: i.id, dispenseId: i.dispenseId, pcu: i.pcu, hn: i.hn, name: i.name,
    drugName: i.drugName, doseMg: i.doseMg, ampPerDose: i.ampPerDose, cycleNo: i.cycleNo,
    scheduledDate: i.scheduledDate, status: i.status, actualDate: i.actualDate, note: i.note
  };
}

/**
 * รายการคำสั่งทั้งหมด: roles = ใครใช้ได้, run = สิ่งที่ทำ
 */
const ACTIONS = {

  // เปิดระบบ: ข้อมูลผู้ใช้ + ข้อมูลหน้าแรก ในการเรียกครั้งเดียว (ลดเวลารอ)
  boot: {
    roles: ALL, run: function (user) {
      const out = ACTIONS.me.run(user);
      // ข้อมูลหน้าแรก: รพ.สต. = หน้า "วันนี้", ห้องยา = ภาพรวม
      const first = user.role === 'pcu' ? 'todayList' : 'dashboard';
      out.initial = cachedResult_(first, ACTIONS[first].cacheKey(user, {}), function () {
        return ACTIONS[first].run(user, {});
      });
      if (user.role === 'admin') {
        out.pendingRequests = readAll_('REQ').filter(function (r) { return r.status === 'pending'; }).length;
      }
      return out;
    }
  },

  // ข้อมูลผู้ใช้และตัวเลือกพื้นฐาน
  me: {
    roles: ALL, run: function (user) {
      return {
        uid: user.uid, displayName: user.displayName, role: user.role, roleTh: ROLE_TH[user.role],
        pcu: user.pcu, type: user.type, lineLinked: !!user.lineUserId,
        pcus: readAll_('PCU').filter(function (x) { return x.active !== 'N'; }).map(function (x) { return x.name; }),
        drugs: readAll_('DRUG').filter(function (x) { return x.active !== 'N'; })
          .map(function (d) { return { code: d.code, name: d.name, mgPerAmp: Number(d.mgPerAmp) }; }),
        today: todayIso_(),
        fiscalYear: fiscalYearOf(todayIso_())
      };
    }
  },

  // ให้ AI อ่านภาพสติ๊กเกอร์ (ภาพไม่ถูกเก็บในระบบ)
  ocr: {
    roles: STAFF, run: function (user, p) {
      if (!p.imageBase64) throw new Error('ไม่พบภาพ');
      const r = ocrSticker_(p.imageBase64, p.mimeType || 'image/jpeg');
      audit_(user, 'ocr', { hn: r.fields.hn ? maskHn(r.fields.hn) : '-' });
      return r;
    }
  },

  // ค้นข้อมูลผู้ป่วยจาก HN (เติม รพ.สต. ให้อัตโนมัติ)
  lookupHn: {
    roles: STAFF, run: function (user, p) {
      const hn = normalizeHn(p.hn, HN_LENGTH);
      const pat = readAll_('PAT').filter(function (x) { return x.hn === hn; })[0];
      return pat ? { found: true, isNew: !hasActiveDispense_(hn), name: pat.name, pcu: pat.pcu, allergy: pat.allergy }
        : { found: false, isNew: true };
    }
  },

  // ตรวจสอบก่อนบันทึก (ยังไม่เขียนข้อมูล)
  preview: {
    roles: STAFF, run: function (user, p) {
      const rec = normalizeRec_(p.rec);
      return validateDispense(rec, buildCtx_(rec));
    }
  },

  // บันทึกการจ่ายยา + สร้างนัดฉีดทุกครั้ง
  saveDispense: {
    roles: STAFF, run: function (user, p) {
      const rec = normalizeRec_(p.rec);
      return withLock_(function () {
        const ctx = buildCtx_(rec);
        const v = validateDispense(rec, ctx);                // ตรวจซ้ำฝั่งเซิร์ฟเวอร์เสมอ
        if (pendingRequestFor_(rec)) v.errors.push('มีคำขอย้อนหลังของรายการนี้รออนุมัติอยู่ กรุณาให้ผู้ดูแลระบบพิจารณาก่อน');
        if (v.errors.length) return { saved: false, errors: v.errors, warnings: v.warnings };
        if (v.warnings.length && !p.ack) return { saved: false, needAck: true, errors: [], warnings: v.warnings };
        const id = createDispense_(rec, ctx, v, user.displayName, null);
        audit_(user, 'saveDispense', { id: id, hn: maskHn(rec.hn), pcu: rec.pcu, warnings: v.warnings.length });
        return { saved: true, id: id, schedule: v.computed.schedule, isNew: v.computed.isNew };
      });
    }
  },

  // รายการจ่ายยา (ค้นหา/กรอง)
  listDispenses: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), p.fy, p.q, !!p.showCancelled]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const q = String(p.q || '').trim();
      const rows = readAll_('DISP').filter(function (d) {
        if (p.fy && String(d.fiscalYear) !== String(p.fy)) return false;
        if (pcu && d.pcu !== pcu) return false;
        if (!p.showCancelled && d.status !== 'active') return false;
        if (q && d.hn.indexOf(q) < 0 && d.name.indexOf(q) < 0) return false;
        return true;
      }).sort(function (a, b) { return a.dispenseDate < b.dispenseDate ? 1 : -1; }).slice(0, 500);
      return rows.map(function (d) {
        return {
          id: d.id, dispenseDate: d.dispenseDate, recordDate: d.recordDate, pcu: d.pcu, hn: d.hn,
          name: d.name, drugName: d.drugName, doseMg: d.doseMg, days: d.days, qtyAmp: d.qtyAmp,
          ampCalc: d.ampCalc, appointmentDate: d.appointmentDate, injCount: d.injCount,
          isNew: d.isNew, status: d.status, createdBy: d.createdBy, allergy: d.allergy, note: d.note
        };
      });
    }
  },

  // ยกเลิกการจ่ายยาที่บันทึกผิด (นัดฉีดที่ยังไม่ฉีดจะถูกยกเลิกด้วย)
  cancelDispense: {
    roles: STAFF, run: function (user, p) {
      if (!p.reason) throw new Error('กรุณาระบุเหตุผลที่ยกเลิก');
      return withLock_(function () {
        const d = readAll_('DISP').filter(function (x) { return x.id === p.id; })[0];
        if (!d) throw new Error('ไม่พบรายการ');
        if (d.status !== 'active') throw new Error('รายการนี้ถูกยกเลิกไปแล้ว');
        update_('DISP', d._row, {
          status: 'cancelled', updatedBy: user.displayName, updatedAt: nowStr_(),
          note: (d.note ? d.note + ' | ' : '') + 'ยกเลิก: ' + p.reason
        });
        // การจ่ายยาที่ยังใช้งานอยู่ของ HN นี้ (หลังยกเลิกรายการนี้แล้ว)
        const active = readAll_('DISP').filter(function (x) { return x.hn === d.hn && x.status === 'active'; });
        const byId = {};
        active.forEach(function (x) { byId[x.id] = x; });
        let restored = 0;
        readAll_('INJ').forEach(function (i) {
          // 1) นัดที่ยังไม่ฉีดของรายการนี้ -> ยกเลิก
          if (i.dispenseId === d.id && i.status === 'pending') {
            update_('INJ', i._row, { status: 'cancelled', note: 'ยกเลิกการจ่ายยา' });
            return;
          }
          // 2) นัดของรอบก่อนที่ถูกรายการนี้ยกเลิกไว้ -> คืนเป็น "รอฉีด"
          if (i.replacedBy !== d.id || i.status !== 'cancelled') return;
          const owner = byId[i.dispenseId];
          if (!owner) return;                                  // รอบเจ้าของถูกยกเลิกไปแล้ว ไม่ต้องคืน
          // ถ้ามีรอบอื่นที่ใหม่กว่ารอบเจ้าของ และเริ่มก่อนวันนัดนี้ นัดนี้ยังต้องถูกแทนอยู่
          const blocker = active.filter(function (x) {
            return x.drugCode === owner.drugCode && x.dispenseDate > owner.dispenseDate &&
              x.dispenseDate <= i.scheduledDate;
          }).sort(function (a, b) { return a.dispenseDate < b.dispenseDate ? -1 : 1; })[0];
          if (blocker) {
            update_('INJ', i._row, { replacedBy: blocker.id, note: 'แทนด้วยรอบจ่ายยา ' + thaiDate(blocker.dispenseDate) });
          } else {
            update_('INJ', i._row, { status: 'pending', replacedBy: '', note: 'คืนนัด (ยกเลิกรอบ ' + thaiDate(d.dispenseDate) + ')' });
            restored++;
          }
        });
        // ทะเบียนผู้ป่วย: วันรับยาครั้งแรก = วันจ่ายยาที่เก่าที่สุดที่ยังใช้งานอยู่
        const pat = readAll_('PAT').filter(function (x) { return x.hn === d.hn; })[0];
        if (pat) {
          const first = active.map(function (x) { return x.dispenseDate; }).sort()[0] || '';
          update_('PAT', pat._row, { firstDispenseDate: first, updatedAt: nowStr_() });
        }
        audit_(user, 'cancelDispense', { id: d.id, reason: p.reason, restored: restored });
        return { restored: restored };
      });
    }
  },

  // ข้อมูลปฏิทินรายเดือน month = "2026-11"
  calendar: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), p.month || todayIso_().slice(0, 7)]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const month = String(p.month || todayIso_().slice(0, 7));
      return readAll_('INJ').filter(function (i) {
        return i.scheduledDate.slice(0, 7) === month && i.status !== 'cancelled' && (!pcu || i.pcu === pcu);
      }).map(injView_);
    }
  },

  // รายการที่ต้องยืนยัน: ค้างยืนยัน + กำหนดฉีดภายใน 7 วันข้างหน้า
  pendingList: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), todayIso_()]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const until = addDaysIso(todayIso_(), 7);
      return readAll_('INJ').filter(function (i) {
        return i.status === 'pending' && i.scheduledDate <= until && (!pcu || i.pcu === pcu);
      }).sort(function (a, b) { return a.scheduledDate < b.scheduledDate ? -1 : 1; }).map(injView_);
    }
  },

  // หน้า "วันนี้": นัดวันนี้ (ทุกสถานะ) + ค้างยืนยัน + รอฉีดใน 7 วันข้างหน้า พร้อมประวัติแพ้ยา
  todayList: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), todayIso_()]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const t = todayIso_();
      const since = addDaysIso(t, -OVERDUE_LOOKBACK_DAYS);
      const until = addDaysIso(t, 7);
      const allergy = {};
      readAll_('PAT').forEach(function (x) { allergy[x.hn] = x.allergy; });
      return readAll_('INJ').filter(function (i) {
        if (i.status === 'cancelled' || (pcu && i.pcu !== pcu)) return false;
        if (i.scheduledDate === t) return true;                           // วันนี้ ทุกสถานะ
        return i.status === 'pending' && i.scheduledDate >= since && i.scheduledDate <= until;
      }).sort(function (a, b) {
        return a.scheduledDate === b.scheduledDate ? (a.name < b.name ? -1 : 1) : (a.scheduledDate < b.scheduledDate ? -1 : 1);
      }).map(function (i) {
        const v = injView_(i);
        v.allergy = allergy[i.hn] || '';
        return v;
      });
    }
  },

  // หน้าแรกห้องยา: ตัวเลขสรุปวันนี้ แยกตาม รพ.สต.
  dashboard: {
    roles: STAFF,
    cacheKey: function () { return [todayIso_()]; },
    run: function () {
      const t = todayIso_();
      const since = addDaysIso(t, -OVERDUE_LOOKBACK_DAYS);
      const per = {};
      const row = function (pcu) {
        if (!per[pcu]) per[pcu] = { pcu: pcu, today: 0, done: 0, missed: 0, pending: 0, overdue: 0 };
        return per[pcu];
      };
      readAll_('INJ').forEach(function (i) {
        if (i.status === 'cancelled') return;
        if (i.scheduledDate === t) { const r = row(i.pcu); r.today++; r[i.status]++; }
        else if (i.status === 'pending' && i.scheduledDate < t && i.scheduledDate >= since) row(i.pcu).overdue++;
      });
      const month = t.slice(0, 7);
      let ampMonth = 0;
      readAll_('DISP').forEach(function (d) {
        if (d.status === 'active' && d.dispenseDate.slice(0, 7) === month) ampMonth += Number(d.qtyAmp) || 0;
      });
      const rows = Object.keys(per).map(function (k) { return per[k]; })
        .sort(function (a, b) { return (b.overdue - a.overdue) || (b.today - a.today); });
      return {
        rows: rows,
        today: rows.reduce(function (s, r) { return s + r.today; }, 0),
        overdue: rows.reduce(function (s, r) { return s + r.overdue; }, 0),
        pendingRequests: readAll_('REQ').filter(function (r) { return r.status === 'pending'; }).length,
        ampMonth: ampMonth
      };
    }
  },

  // ยืนยันการฉีด — วันที่ฉีดจริงไม่จำเป็นต้องตรงกับวันนัด
  confirmInjection: {
    roles: ALL, run: function (user, p) {
      const status = String(p.status || '');
      if (['done', 'missed', 'pending'].indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
      return withLock_(function () {
        const i = readAll_('INJ').filter(function (x) { return x.id === p.id; })[0];
        if (!i) throw new Error('ไม่พบรายการ');
        if (user.role === 'pcu' && i.pcu !== user.pcu) throw new Error('ไม่มีสิทธิ์แก้ไขรายการของ รพ.สต. อื่น');
        if (i.status === 'cancelled') throw new Error('รายการนี้ถูกยกเลิกแล้ว');
        let actual = '';
        if (status === 'missed' && i.scheduledDate > todayIso_()) {
          throw new Error('ยังไม่ถึงวันนัด (' + thaiDate(i.scheduledDate) + ') บันทึก "ไม่มาฉีด" ไม่ได้');
        }
        if (status === 'done') {
          actual = String(p.actualDate || '');
          if (!fromIso(actual)) throw new Error('กรุณาระบุวันที่ฉีดจริง');
          if (actual > todayIso_()) throw new Error('วันที่ฉีดจริงต้องไม่เกินวันนี้');
          const d = readAll_('DISP').filter(function (x) { return x.id === i.dispenseId; })[0];
          if (d && actual < d.dispenseDate) throw new Error('วันที่ฉีดจริงต้องไม่ก่อนวันจ่ายยา (' + thaiDate(d.dispenseDate) + ')');
        }
        update_('INJ', i._row, {
          status: status, actualDate: actual, note: String(p.note || '').slice(0, 200),
          confirmedBy: status === 'pending' ? '' : user.displayName,
          confirmedAt: status === 'pending' ? '' : nowStr_()
        });
        audit_(user, 'confirmInjection', { id: i.id, status: status, actualDate: actual });
        return true;
      });
    }
  },

  // รายใหม่ / รายเดิม ในปีงบที่เลือก
  patientsNewOld: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), p.fy, todayIso_()]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const fy = String(p.fy || fiscalYearOf(todayIso_()));
      const range = fiscalRange(fy);
      const pats = {};
      readAll_('PAT').forEach(function (x) { pats[x.hn] = x; });
      const today = todayIso_();
      const nextInj = {};                                       // นัดฉีดครั้งถัดไปของแต่ละ HN
      readAll_('INJ').forEach(function (i) {
        if (i.status === 'pending' && i.scheduledDate >= today &&
          (!nextInj[i.hn] || i.scheduledDate < nextInj[i.hn])) nextInj[i.hn] = i.scheduledDate;
      });
      const latest = {};                                        // การจ่ายยาล่าสุดในปีงบของแต่ละ HN
      readAll_('DISP').forEach(function (d) {
        if (d.status !== 'active' || String(d.fiscalYear) !== fy || (pcu && d.pcu !== pcu)) return;
        if (!latest[d.hn] || d.dispenseDate > latest[d.hn].dispenseDate) latest[d.hn] = d;
      });
      const out = { newList: [], oldList: [] };
      Object.keys(latest).forEach(function (hn) {
        const d = latest[hn];
        const first = (pats[hn] && pats[hn].firstDispenseDate) || d.dispenseDate;
        const row = {
          hn: hn, name: d.name, pcu: d.pcu, drugName: d.drugName, doseMg: d.doseMg,
          firstDispenseDate: first, lastDispenseDate: d.dispenseDate,
          appointmentDate: d.appointmentDate, nextInjection: nextInj[hn] || ''
        };
        // รายใหม่ = ได้รับยาครั้งแรกในระบบ และครั้งแรกนั้นอยู่ในปีงบนี้
        if (first >= range.from && first <= range.to) out.newList.push(row); else out.oldList.push(row);
      });
      const byPcu = function (a, b) { return a.pcu === b.pcu ? (a.name < b.name ? -1 : 1) : (a.pcu < b.pcu ? -1 : 1); };
      out.newList.sort(byPcu);
      out.oldList.sort(byPcu);
      return out;
    }
  },

  // ประวัติผู้ป่วยรายคน (นับครั้งที่ฉีดต่อเนื่องตลอด)
  patientHistory: {
    roles: ALL, run: function (user, p) {
      const hn = normalizeHn(p.hn, HN_LENGTH);
      const pat = readAll_('PAT').filter(function (x) { return x.hn === hn; })[0];
      if (!pat) return { found: false };
      const disps = readAll_('DISP').filter(function (d) { return d.hn === hn; });
      if (user.role === 'pcu' && !disps.some(function (d) { return d.pcu === user.pcu; })) {
        throw new Error('ไม่มีสิทธิ์ดูผู้ป่วยของ รพ.สต. อื่น');
      }
      const injs = readAll_('INJ').filter(function (i) { return i.hn === hn && i.status !== 'cancelled'; })
        .sort(function (a, b) { return a.scheduledDate < b.scheduledDate ? -1 : 1; });
      let n = 0;
      const timeline = injs.map(function (i) {
        const v = injView_(i);
        if (i.status === 'done') { n++; v.lifetimeNo = n; }   // นับต่อเนื่องเฉพาะที่ฉีดแล้ว
        return v;
      });
      audit_(user, 'patientHistory', { hn: maskHn(hn) });
      return {
        found: true, hn: hn, name: pat.name, pcu: pat.pcu, allergy: pat.allergy,
        firstDispenseDate: pat.firstDispenseDate, totalDone: n,
        dispenses: disps.sort(function (a, b) { return a.dispenseDate < b.dispenseDate ? 1 : -1; })
          .map(function (d) {
            return {
              id: d.id, dispenseDate: d.dispenseDate, pcu: d.pcu, drugName: d.drugName, doseMg: d.doseMg,
              days: d.days, qtyAmp: d.qtyAmp, appointmentDate: d.appointmentDate, status: d.status
            };
          }),
        timeline: timeline
      };
    }
  },

  // สรุปจำนวนยาและการฉีด แยกตาม รพ.สต. (month = "2026-11" หรือว่าง = ทั้งปีงบ)
  summary: {
    roles: ALL,
    cacheKey: function (u, p) { return [scopePcu_(u, p.pcu), p.fy, p.month]; },
    run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      const fy = String(p.fy || fiscalYearOf(todayIso_()));
      const month = String(p.month || '');
      const drugs = readAll_('DRUG').map(function (d) { return { code: d.code, name: d.name }; });
      const pcus = pcu ? [pcu] : readAll_('PCU').map(function (x) { return x.name; });
      const table = {};
      pcus.forEach(function (n) {
        table[n] = { pcu: n, patients: {}, ampDispensed: {}, ampUsed: {}, total: 0, done: 0, missed: 0, pending: 0 };
        drugs.forEach(function (d) { table[n].ampDispensed[d.code] = 0; table[n].ampUsed[d.code] = 0; });
      });
      // จำนวน amp ที่จ่ายออกไป (ตามสติ๊กเกอร์) นับตามวันจ่ายยา
      readAll_('DISP').forEach(function (d) {
        if (d.status !== 'active' || String(d.fiscalYear) !== fy || !table[d.pcu]) return;
        if (month && d.dispenseDate.slice(0, 7) !== month) return;
        table[d.pcu].ampDispensed[d.drugCode] = (table[d.pcu].ampDispensed[d.drugCode] || 0) + Number(d.qtyAmp);
        table[d.pcu].patients[d.hn] = true;
      });
      // การฉีด นับตามวันนัดฉีด
      readAll_('INJ').forEach(function (i) {
        if (['pending', 'done', 'missed'].indexOf(i.status) < 0) return;   // ข้ามยกเลิก/สถานะที่พิมพ์ผิดในชีต
        if (String(i.fiscalYear) !== fy || !table[i.pcu]) return;
        if (month && i.scheduledDate.slice(0, 7) !== month) return;
        const t = table[i.pcu];
        t.total++;
        t[i.status]++;
        if (i.status === 'done') t.ampUsed[i.drugCode] = (t.ampUsed[i.drugCode] || 0) + Number(i.ampPerDose);
      });
      return {
        fy: fy, month: month, drugs: drugs,
        rows: pcus.map(function (n) {
          const t = table[n];
          t.patientCount = Object.keys(t.patients).length;
          delete t.patients;
          return t;
        })
      };
    }
  },

  // ไฟล์ PDF รายชื่อผู้ป่วยที่ต้องฉีดในวันที่เลือก
  pdf: {
    roles: ALL, run: function (user, p) {
      const pcu = scopePcu_(user, p.pcu);
      if (!pcu) throw new Error('กรุณาเลือก รพ.สต.');
      const r = buildInjectionPdf_(pcu, String(p.date || todayIso_()));
      audit_(user, 'pdf', { pcu: pcu, date: p.date });
      return r;
    }
  },

  // ===== คำขอบันทึกย้อนหลัง (ยาไปฉีดก่อนมีข้อมูลในระบบ) =====

  // คำนวณตารางนัด + ตรวจข้อมูล (ยังไม่บันทึก)
  backfillPreview: {
    roles: ALL, run: function (user, p) {
      const rec = normalizeRec_(p.rec);
      if (user.role === 'pcu') rec.pcu = user.pcu;           // รพ.สต. ส่งได้เฉพาะของตัวเอง
      const v = checkBackfill_(rec, cleanOutcomes_(p.outcomes), user.role === 'pcu');
      // รอบแรกยังไม่ได้ระบุผล -> ไม่ต้องแสดงข้อผิดพลาดเรื่องผลการฉีด
      if (p.skipOutcomes) v.errors = v.errors.filter(function (e) { return !/ผลการฉีด|ฉีดจริง/.test(e); });
      delete v.ctx;
      v.today = todayIso_();
      return v;
    }
  },

  // ส่งคำขอให้ผู้ดูแลระบบอนุมัติ
  backfillSubmit: {
    roles: ALL, run: function (user, p) {
      const rec = normalizeRec_(p.rec);
      if (user.role === 'pcu') rec.pcu = user.pcu;
      const reason = String(p.reason || '').trim().slice(0, 300);
      const outcomes = cleanOutcomes_(p.outcomes);
      const id = withLock_(function () {
        const v = checkBackfill_(rec, outcomes, user.role === 'pcu');
        if (!reason) v.errors.push('กรุณาระบุเหตุผลที่ต้องบันทึกย้อนหลัง');
        if (v.errors.length) throw new Error(v.errors.join(' | '));
        if (v.warnings.length && !p.ack) throw new Error('กรุณาติ๊กยืนยันคำเตือนก่อนส่งคำขอ');
        const rid = newId_('R');
        appendMany_('REQ', [{
          id: rid, status: 'pending', pcu: rec.pcu, hn: rec.hn, drugCode: rec.drugCode,
          dispenseDate: rec.dispenseDate, payload: JSON.stringify({ rec: rec, outcomes: outcomes }),
          reason: reason, submittedBy: user.displayName, submittedUid: user.uid, submittedAt: nowStr_()
        }]);
        audit_(user, 'backfillSubmit', { id: rid, hn: maskHn(rec.hn), pcu: rec.pcu });
        return rid;
      });
      try { notifyAdminsRequest_(rec.pcu); } catch (e) { console.error('notify', e); }   // แจ้งไม่ได้ไม่เป็นไร
      return { id: id };
    }
  },

  // รายการคำขอ: ผู้ดูแลเห็นทั้งหมด (รออนุมัติมาก่อน) / คนอื่นเห็นเฉพาะที่ตัวเองส่ง
  listRequests: {
    roles: ALL, run: function (user) {
      const isAdmin = user.role === 'admin';
      const rows = readAll_('REQ').filter(function (r) { return isAdmin || r.submittedUid === user.uid; })
        .sort(function (a, b) {
          if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
          return a.submittedAt < b.submittedAt ? 1 : -1;
        }).slice(0, 200);
      return rows.map(function (r) {
        const pl = JSON.parse(r.payload || '{}');
        const out = {
          id: r.id, status: r.status, pcu: r.pcu, hn: r.hn, dispenseDate: r.dispenseDate, reason: r.reason,
          submittedBy: r.submittedBy, submittedAt: r.submittedAt, reviewedBy: r.reviewedBy,
          reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, rec: pl.rec, outcomes: pl.outcomes
        };
        if (isAdmin && r.status === 'pending') {               // ตรวจซ้ำกับข้อมูลปัจจุบัน
          const v = checkBackfill_(normalizeRec_(pl.rec), cleanOutcomes_(pl.outcomes), false, r.id);
          out.check = { errors: v.errors, warnings: v.warnings, computed: v.computed };
        }
        return out;
      });
    }
  },

  // ผู้ดูแลระบบ อนุมัติ/ไม่อนุมัติ คำขอ
  reviewRequest: {
    roles: ADMIN, run: function (user, p) {
      const decision = p.decision === 'approve' ? 'approved' : (p.decision === 'reject' ? 'rejected' : '');
      if (!decision) throw new Error('คำสั่งไม่ถูกต้อง');
      const note = String(p.note || '').trim().slice(0, 300);
      if (decision === 'rejected' && !note) throw new Error('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
      return withLock_(function () {
        const r = readAll_('REQ').filter(function (x) { return x.id === p.id; })[0];
        if (!r) throw new Error('ไม่พบคำขอ');
        if (r.status !== 'pending') throw new Error('คำขอนี้ถูกพิจารณาไปแล้ว');
        let dispenseId = '';
        if (decision === 'approved') {
          const pl = JSON.parse(r.payload || '{}');
          const rec = normalizeRec_(pl.rec);
          const outcomes = cleanOutcomes_(pl.outcomes);
          const v = checkBackfill_(rec, outcomes, false, r.id);   // ตรวจกับข้อมูลล่าสุดอีกครั้ง
          if (v.errors.length) return { done: false, errors: v.errors, warnings: v.warnings };
          if (v.warnings.length && !p.ack) return { done: false, needAck: true, errors: [], warnings: v.warnings };
          dispenseId = createDispense_(rec, v.ctx, v,
            r.submittedBy + ' (ย้อนหลัง อนุมัติโดย ' + user.displayName + ')', outcomes);
        }
        update_('REQ', r._row, {
          status: decision, reviewedBy: user.displayName, reviewedAt: nowStr_(), reviewNote: note, dispenseId: dispenseId
        });
        audit_(user, 'reviewRequest', { id: r.id, decision: decision, dispenseId: dispenseId });
        return { done: true, dispenseId: dispenseId };
      });
    }
  },

  // ลิงก์เชื่อมบัญชี LINE ให้เจ้าหน้าที่ห้องยา (รับแจ้งเตือนสรุป)
  linkLineUrl: {
    roles: STAFF, run: function (user) { return lineAuthUrl_('link', user.uid); }
  },

  // ===== ผู้ดูแลระบบ =====
  listUsers: {
    roles: ADMIN, run: function () {
      return readAll_('USERS').map(function (u) {
        return {
          uid: u.uid, type: u.type, email: u.email, displayName: u.displayName, role: u.role,
          pcu: u.pcu, status: u.status, lineLinked: !!u.lineUserId, createdAt: u.createdAt, lastLogin: u.lastLogin
        };
      });
    }
  },
  updateUser: {
    roles: ADMIN, run: function (user, p) {
      if (['admin', 'pharmacy', 'pcu'].indexOf(p.role) < 0) throw new Error('บทบาทไม่ถูกต้อง');
      if (['active', 'pending', 'disabled'].indexOf(p.status) < 0) throw new Error('สถานะไม่ถูกต้อง');
      if (p.role === 'pcu' && !p.pcu) throw new Error('ผู้ใช้ รพ.สต. ต้องเลือก รพ.สต.');
      if (p.uid === user.uid && p.role !== 'admin') throw new Error('ไม่สามารถลดสิทธิ์ตัวเองได้');
      return withLock_(function () {
        const u = readAll_('USERS').filter(function (x) { return x.uid === p.uid; })[0];
        if (!u) throw new Error('ไม่พบผู้ใช้');
        update_('USERS', u._row, { role: p.role, pcu: p.role === 'pcu' ? p.pcu : '', status: p.status });
        audit_(user, 'updateUser', { uid: p.uid, role: p.role, pcu: p.pcu, status: p.status });
        return true;
      });
    }
  },
  testLine: {
    roles: ADMIN, run: function (user) {
      if (!user.lineUserId) throw new Error('บัญชีนี้ยังไม่เชื่อม LINE');
      return pushLine_([user.lineUserId], [{ type: 'text', text: 'ทดสอบการแจ้งเตือนจาก ' + APP_NAME }]);
    }
  },
  runAlertsNow: {
    roles: ADMIN, run: function (user) { audit_(user, 'runAlertsNow', ''); return sendDailyAlerts(); }
  },
  setupTrigger: {
    roles: ADMIN, run: function (user) { audit_(user, 'setupTrigger', ''); return createDailyTrigger(); }
  }
};
