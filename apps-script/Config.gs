/**
 * =====================================================================
 * Config.gs — ค่าตั้งต้นของระบบ
 * ระบบบันทึกยาฉีดจิตเวชออก รพ.สต.
 * กลุ่มงานเภสัชกรรม รพ.ศีขรภูมิ
 * =====================================================================
 * ไฟล์นี้เก็บ "ค่าคงที่" ที่ใช้ทั้งระบบ แก้ที่นี่ที่เดียว ทุกไฟล์จะใช้ค่าใหม่
 */

// ชื่อระบบที่แสดงบนหน้าเว็บ
const APP_NAME = 'ระบบบันทึกยาฉีดจิตเวช รพ.สต.';

// ข้อความเครดิตท้ายหน้า (ระบบทางการ)
const APP_FOOTER = 'กลุ่มงานเภสัชกรรม รพ.ศีขรภูมิ';

// ไอคอนบนแท็บเบราว์เซอร์ (เก็บบน GitHub Pages ของโปรเจกต์)
const FAVICON_URL = 'https://font-pharm.github.io/Psychi-PCU/icons/favicon-32.png';

// เขตเวลา ใช้ตอนจัดรูปแบบวันที่และตั้งเวลาแจ้งเตือน
const TZ = 'Asia/Bangkok';

// จำนวนหลักของ HN (จากสติ๊กเกอร์ = 9 หลัก เช่น 000012345)
const HN_LENGTH = 9;

// อายุการเข้าสู่ระบบ (วัน) — ครบแล้วต้อง login ใหม่
// ผู้ใช้ที่ถูกปิดใช้งานจะถูกตัดสิทธิ์ทันที ไม่ต้องรอหมดอายุ
const SESSION_DAYS = 7;

// เวลาเก็บข้อมูลอ้างอิง (ผู้ใช้/รพ.สต./ยา) และผลรายงานไว้ใช้ซ้ำ (วินาที)
const REF_CACHE_SECONDS = 600;
const RESULT_CACHE_SECONDS = 300;

// ชั่วโมงที่ส่งแจ้งเตือน LINE ทุกเช้า (Apps Script จะยิงภายในช่วง 07:00-07:59)
const ALERT_HOUR = 7;

// แจ้งรายการ "ค้างยืนยัน" ย้อนหลังกี่วัน
const OVERDUE_LOOKBACK_DAYS = 30;

// AuditLog เกินกี่แถวให้แยกเก็บเป็นแท็บใหม่ (กันไฟล์ช้า)
const AUDIT_MAX_ROWS = 50000;

// จำนวนรายชื่อสูงสุดในการ์ด LINE 1 ใบ (เกินนี้ให้เปิดดูในระบบ)
const LINE_MAX_ROWS = 25;

/**
 * โครงสร้างชีตทั้งหมด
 * key = ชื่อที่ใช้ในโค้ด, name = ชื่อแท็บใน Google Sheets, headers = หัวคอลัมน์แถวที่ 1
 * ถ้าจะเพิ่มคอลัมน์ ให้เพิ่มต่อท้ายเท่านั้น (ห้ามสลับลำดับ เพราะข้อมูลเดิมจะเลื่อน)
 */
const SHEETS = {
  // การจ่ายยา 1 แถว = สติ๊กเกอร์ 1 ใบ
  DISP: {
    name: 'Dispenses',
    headers: ['id', 'fiscalYear', 'recordDate', 'dispenseDate', 'pcu', 'hn', 'name',
      'drugCode', 'drugName', 'doseMg', 'ampPerDose', 'days', 'regimenText',
      'qtyAmp', 'ampCalc', 'appointmentDate', 'injCount', 'allergy', 'isNew',
      'status', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'note',
      'everyMonths']                                          // ฉีดทุกกี่เดือน (1 = ทุกเดือน)
  },
  // นัดฉีด 1 แถว = การฉีด 1 ครั้ง (ระบบสร้างให้อัตโนมัติจาก regimen)
  INJ: {
    name: 'Injections',
    headers: ['id', 'dispenseId', 'fiscalYear', 'pcu', 'hn', 'name', 'drugCode',
      'drugName', 'doseMg', 'ampPerDose', 'cycleNo', 'scheduledDate', 'status',
      'actualDate', 'confirmedBy', 'confirmedAt', 'note',
      'replacedBy']                                           // ถูกยกเลิกเพราะรอบจ่ายยาใหม่รหัสนี้ (ใช้คืนนัด)
  },
  // ทะเบียนผู้ป่วย ใช้แยกรายใหม่/รายเดิม และตรวจชื่อกับ HN
  PAT: {
    name: 'Patients',
    headers: ['hn', 'name', 'pcu', 'firstDispenseDate', 'allergy', 'updatedAt']
  },
  // รายชื่อ รพ.สต.
  PCU: { name: 'PCU', headers: ['name', 'active'] },
  // รายการยา mgPerAmp = จำนวน mg ใน 1 amp
  DRUG: { name: 'Drugs', headers: ['code', 'name', 'mgPerAmp', 'keywords', 'active'] },
  // ผู้ใช้งาน
  USERS: {
    name: 'Users',
    headers: ['uid', 'type', 'email', 'lineUserId', 'displayName', 'role', 'pcu',
      'status', 'createdAt', 'lastLogin',
      'tokenVer']                                             // เพิ่มเลขนี้ = ออกจากระบบทุกเครื่อง
  },
  // คำขอบันทึกย้อนหลัง (รอผู้ดูแลระบบอนุมัติ)
  REQ: {
    name: 'Requests',
    headers: ['id', 'status', 'pcu', 'hn', 'drugCode', 'dispenseDate', 'payload', 'reason',
      'submittedBy', 'submittedUid', 'submittedAt', 'reviewedBy', 'reviewedAt', 'reviewNote', 'dispenseId']
  },
  // บันทึกการใช้งาน (ใครทำอะไร เมื่อไร)
  AUDIT: { name: 'AuditLog', headers: ['time', 'uid', 'displayName', 'action', 'detail'] }
};

// รายชื่อ รพ.สต. 21 แห่ง (ใส่ลงชีต PCU ตอนรัน setup ครั้งแรก)
const DEFAULT_PCUS = [
  'กุดหวาย', 'ขวาวใหญ่', 'ขะเนก', 'คาละแมะ', 'โคสนวน', 'จารพัต', 'ช่างปี่',
  'ตรมไพร', 'ตรึม', 'แตล', 'นาท่ม', 'นารุ่ง', 'ผักไหม', 'ยะยาน', 'ยาง',
  'หนองขวาว', 'หนองจอก', 'หนองโดน', 'หนองบัว', 'หนองเหล็ก', 'หัวแรต'
];

// รายการยาเริ่มต้น — mgPerAmp ตั้งตาม 1 amp = 1 ml
// *** ก่อนใช้งานจริง ให้ตรวจสอบกับขนาดบรรจุที่มีในคลังยา แล้วแก้ในชีต Drugs ***
const DEFAULT_DRUGS = [
  ['FLU', 'Fluphenazine decanoate 25 mg/ml inj.', 25, 'fluphenazine', 'Y'],
  ['HAL', 'Haloperidol decanoate 50 mg/ml inj.', 50, 'haloperidol', 'Y']
];

// ชื่อสถานะการฉีดภาษาไทย
const INJ_STATUS_TH = {
  pending: 'รอฉีด',
  done: 'ฉีดแล้ว',
  missed: 'ไม่มาฉีด',
  cancelled: 'ยกเลิก'
};

// ชื่อบทบาทภาษาไทย
const ROLE_TH = {
  admin: 'ผู้ดูแลระบบ',
  pharmacy: 'ห้องยา',
  pcu: 'รพ.สต.'
};
