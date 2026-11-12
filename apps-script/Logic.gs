/**
 * =====================================================================
 * Logic.gs — สูตรคำนวณและกฎตรวจสอบข้อมูล
 * ---------------------------------------------------------------------
 * ไฟล์นี้ "ไม่เรียก" Google Sheets/LINE/Gemini เลย มีแต่การคำนวณล้วน ๆ
 * จึงทดสอบได้ง่าย และถ้ากฎเปลี่ยน (เช่น วิธีนับ amp) ให้แก้ที่ไฟล์นี้
 * วันที่ทั้งระบบเก็บเป็นข้อความรูปแบบ ISO "ปปปป-ดด-วว" (ค.ศ.) เช่น "2026-11-09"
 * =====================================================================
 */

// ชื่อเดือนย่อภาษาไทย (ลำดับ 0 = มกราคม)
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** เติม 0 ข้างหน้าเลขหลักเดียว เช่น 5 -> "05" */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** แปลง Date -> "2026-11-09" */
function toIso(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** แปลง "2026-11-09" -> Date (ถ้ารูปแบบผิดหรือวันไม่มีจริง คืนค่า null) */
function fromIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;                                   // รูปแบบไม่ตรง
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;   // เช่น 31 ก.พ. จะเลื่อนเดือน = วันไม่มีจริง
  return d;
}

/** บวก/ลบวันจากวันที่ ISO แล้วคืนค่าเป็น ISO */
function addDaysIso(iso, n) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** แสดงวันที่แบบไทย "2026-11-09" -> "9 พ.ย. 69" */
function thaiDate(iso) {
  const d = fromIso(iso);
  if (!d) return '';
  return d.getDate() + ' ' + TH_MONTHS[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(-2);
}

/**
 * อ่านวันที่จากสติ๊กเกอร์ เช่น "09 พ.ย. 69" -> "2026-11-09"
 * รองรับปี 2 หลัก (69), 4 หลัก พ.ศ. (2569) หรือ ค.ศ. (2026)
 */
function parseThaiDate(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = /(\d{1,2})\s*([ก-๙.]+)\s*(\d{2,4})/.exec(s);   // เลขวัน + ชื่อเดือนไทย + เลขปี
  if (!m) return null;
  const day = Number(m[1]);
  const monKey = m[2].replace(/\./g, '');                    // ตัดจุดออก "พ.ย." -> "พย"
  const idx = TH_MONTHS.findIndex(function (x) { return x.replace(/\./g, '') === monKey; });
  if (idx < 0) return null;                                  // ไม่รู้จักชื่อเดือน
  let y = Number(m[3]);
  if (y < 100) y += 2500;                                    // 69 -> 2569
  if (y > 2400) y -= 543;                                    // พ.ศ. -> ค.ศ.
  const d = new Date(y, idx, day);
  if (d.getDate() !== day) return null;                      // วันไม่มีจริง
  return toIso(d);
}

/**
 * ปีงบประมาณ (พ.ศ.) ของวันที่ — ตัดปีงบทุก 30 ก.ย.
 * 1 ต.ค. 2569 ถึง 30 ก.ย. 2570 = ปีงบ 2570
 */
function fiscalYearOf(iso) {
  const d = fromIso(iso);
  if (!d) return '';
  let y = d.getFullYear() + 543;          // แปลงเป็น พ.ศ.
  if (d.getMonth() >= 9) y += 1;          // เดือน ต.ค.(9) ขึ้นไป นับเป็นปีงบถัดไป
  return y;
}

/** ช่วงวันที่ของปีงบ เช่น 2570 -> {from:"2026-10-01", to:"2027-09-30"} */
function fiscalRange(fy) {
  const ce = Number(fy) - 543;
  return { from: (ce - 1) + '-10-01', to: ce + '-09-30' };
}

/**
 * แยกวันที่ฉีดจากข้อความ เช่น "5,19" หรือ [5,19] -> [5,19]
 * ใช้กับช่อง "วันที่ฉีด" ในฟอร์ม
 */
function parseDays(v) {
  const arr = Array.isArray(v) ? v : (String(v || '').match(/\d{1,2}/g) || []);
  const nums = arr.map(Number).filter(function (n) { return n >= 1 && n <= 31; });
  return nums.filter(function (n, i) { return nums.indexOf(n) === i; })   // ตัดเลขซ้ำ
    .sort(function (a, b) { return a - b; });
}

/**
 * อ่าน regimen จากสติ๊กเกอร์ (ตรวจซ้ำกับผลของ AI)
 * ตัวอย่างที่รองรับ:
 *   "12.5 mg IM ทุกวันที่ 5 ของเดือน"          -> 12.5 mg, [5]
 *   "100 mg IM ทุก 1 เดือน วันที่ 19 ของเดือน"  -> 100 mg, [19]
 *   "75 mg IM ทุกวันที่ 5 ,19"                -> 75 mg, [5,19]
 *   "50 mg IM วันที่ 5 และ 22 ของทุกเดือน"     -> 50 mg, [5,22]
 */
function parseRegimen(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const out = { doseMg: null, days: [], everyMonths: parseEveryMonths(s), raw: s, problems: [] };
  const md = /(\d+(?:\.\d+)?)\s*mg/i.exec(s);          // ตัวเลขที่อยู่หน้า "mg"
  if (md) out.doseMg = parseFloat(md[1]);
  else out.problems.push('ไม่พบขนาดยา (mg) ใน regimen');
  const idx = s.indexOf('วันที่');                       // วันที่ฉีดอยู่หลังคำว่า "วันที่"
  if (idx >= 0) out.days = parseDays(s.slice(idx + 'วันที่'.length));
  if (!out.days.length) out.problems.push('ไม่พบวันที่ฉีดใน regimen');
  if (isWeekly(s)) out.problems.push('regimen เป็นรายสัปดาห์ ระบบรองรับเฉพาะ "วันที่ของเดือน"');
  return out;
}

/**
 * ฉีดทุกกี่เดือน จากข้อความ regimen
 * "ทุก 2 เดือน วันที่ 19" -> 2 | "ทุกวันที่ 5" หรือ "ทุก 1 เดือน" -> 1
 */
function parseEveryMonths(text) {
  const m = /ทุก\s*(\d+)\s*เดือน/.exec(String(text || ''));
  return m ? Math.max(1, Number(m[1])) : 1;
}

/** regimen เป็นแบบรายสัปดาห์หรือไม่ (ระบบยังไม่รองรับ) */
function isWeekly(text) {
  return /สัปดาห์|อาทิตย์|week|wk/i.test(String(text || ''));
}

/**
 * จำนวน amp ต่อการฉีด 1 ครั้ง (ปัดขึ้นทีละครั้ง เพราะ amp ที่เปิดแล้วใช้ต่อไม่ได้)
 * เช่น 12.5 mg / 25 mg ต่อ amp = 0.5 -> ปัดเป็น 1 amp
 */
function calcAmpPerDose(doseMg, mgPerAmp) {
  if (!(doseMg > 0) || !(mgPerAmp > 0)) return 0;
  return Math.ceil(doseMg / mgPerAmp - 1e-9);         // -1e-9 กันปัดเกินจากเศษทศนิยม
}

/**
 * สร้างตารางวันฉีด
 * นับตั้งแต่ "วันจ่ายยา" (รวมวันนั้น) ถึง "ก่อนวันนัดพบแพทย์" (ไม่รวมวันนัด)
 * ถ้าเดือนนั้นไม่มีวันที่กำหนด (เช่น 31 ในเดือน พ.ย.) ใช้วันสุดท้ายของเดือนแทน
 */
function buildSchedule(dispIso, apptIso, days, everyMonths) {
  const start = fromIso(dispIso);
  const end = fromIso(apptIso);
  const every = everyMonths > 1 ? everyMonths : 1;               // ทุกกี่เดือน (ค่าเริ่มต้น 1)
  const res = [];
  if (!start || !end || !days || !days.length || end <= start) return res;
  let y = start.getFullYear();
  let m = start.getMonth();
  let firstMonth = null;                                         // เดือนแรกที่มีนัดฉีด (ใช้นับรอบ ทุก N เดือน)
  for (let guard = 0; guard < 36; guard++) {                     // กันวนไม่รู้จบ (สูงสุด 3 ปี)
    const last = new Date(y, m + 1, 0).getDate();                // วันสุดท้ายของเดือน
    const list = parseDays(days.map(function (d) { return Math.min(d, last); }));
    const inRange = list.map(function (d) { return new Date(y, m, d); })
      .filter(function (dt) { return dt >= start && dt < end; }); // อยู่ในช่วงที่กำหนด
    const monthNo = y * 12 + m;
    if (inRange.length && firstMonth === null) firstMonth = monthNo;
    if (firstMonth !== null && (monthNo - firstMonth) % every === 0) {
      inRange.forEach(function (dt) { res.push(toIso(dt)); });   // เฉพาะเดือนที่ถึงรอบ
    }
    m++;
    if (m > 11) { m = 0; y++; }                                  // ข้ามปี
    if (new Date(y, m, 1) >= end) break;                         // เลยวันนัดแล้ว หยุด
  }
  return res;
}

/**
 * จัดรูปแบบ HN ที่พิมพ์เอง: เก็บเฉพาะตัวเลข แล้วเติม 0 ข้างหน้าให้ครบ len หลัก
 * "1234" -> "000001234" | "12-345" -> "000012345"
 * ถ้าว่างหรือยาวเกิน len คืนค่าตัวเลขเดิม (ให้กฎตรวจสอบแจ้งข้อผิดพลาด)
 */
function normalizeHn(v, len) {
  const d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  if (!d || d.length > len) return d;
  return ('000000000000' + d).slice(-len);
}

/**
 * ตรวจผลการฉีดที่ผู้ส่งคำขอย้อนหลังระบุ
 * schedule = วันนัดที่ระบบคำนวณ, outcomes = [{date, status:'done'|'missed', actualDate}]
 * นัดที่ถึงวันแล้ว (<= วันนี้) ต้องระบุผลทุกครั้ง
 * คืนค่า รายการข้อผิดพลาด (ว่าง = ผ่าน)
 */
function checkOutcomes(schedule, outcomes, today, dispenseDate) {
  const errors = [];
  const byDate = {};
  (outcomes || []).forEach(function (o) { byDate[o.date] = o; });
  schedule.forEach(function (d, k) {
    if (d > today) return;                                       // นัดล่วงหน้า ยังไม่ต้องระบุผล
    const o = byDate[d];
    const label = 'ครั้งที่ ' + (k + 1) + ' (' + thaiDate(d) + ')';
    if (!o || (o.status !== 'done' && o.status !== 'missed')) { errors.push('กรุณาระบุผลการฉีด ' + label); return; }
    if (o.status === 'done') {
      if (!fromIso(o.actualDate)) errors.push('กรุณาระบุวันที่ฉีดจริง ' + label);
      else if (o.actualDate > today) errors.push('วันที่ฉีดจริงต้องไม่เกินวันนี้ ' + label);
      else if (o.actualDate < dispenseDate) errors.push('วันที่ฉีดจริงต้องไม่ก่อนวันจ่ายยา ' + label);
    }
  });
  return errors;
}

/** ตัดช่องว่างออก ใช้เทียบชื่อ */
function normName(s) {
  return String(s || '').replace(/\s+/g, '').trim();
}

/** ปิดชื่อบางส่วนสำหรับข้อความ LINE: "นายสมชาย ใจดี" -> "นายส***" */
function maskName(name) {
  const s = String(name || '').trim();
  const prefixes = ['นางสาว', 'น.ส.', 'นาง', 'นาย', 'ด.ช.', 'ด.ญ.', 'เด็กชาย', 'เด็กหญิง'];
  let p = '';
  let rest = s;
  for (let i = 0; i < prefixes.length; i++) {
    if (s.indexOf(prefixes[i]) === 0) { p = prefixes[i]; rest = s.slice(p.length).trim(); break; }
  }
  return p + (rest ? rest.charAt(0) : '') + '***';
}

/** ปิด HN บางส่วน: "000012345" -> "xxxxx2345" */
function maskHn(hn) {
  const s = String(hn || '');
  return s.length > 4 ? 'xxxxx' + s.slice(-4) : s;
}

/**
 * ตรวจสอบข้อมูลก่อนบันทึก
 * rec = ข้อมูลจากฟอร์ม, ctx = ข้อมูลประกอบจากระบบ
 *   ctx.pcus   = รายชื่อ รพ.สต.
 *   ctx.drugs  = รายการยา [{code,name,mgPerAmp}]
 *   ctx.disps  = การจ่ายยาเดิมของ HN นี้ (สถานะ active)
 *   ctx.pat    = ข้อมูลในทะเบียนผู้ป่วย (ถ้ามี) หรือ null
 *   ctx.today  = วันนี้ ISO
 * คืนค่า { errors:[...] = ห้ามบันทึก, warnings:[...] = ต้องกดยืนยันก่อน, computed:{...} }
 */
function validateDispense(rec, ctx) {
  const errors = [];
  const warnings = [];

  // 1) ช่องที่ต้องกรอก
  const required = {
    pcu: 'ชื่อ รพ.สต.', dispenseDate: 'วันที่จ่ายยา', hn: 'HN', name: 'ชื่อผู้ป่วย',
    drugCode: 'ชนิดยา', doseMg: 'ขนาดยา (mg)', qtyAmp: 'จำนวนที่จ่าย (amp)',
    appointmentDate: 'วันนัดพบแพทย์'
  };
  Object.keys(required).forEach(function (k) {
    if (rec[k] === '' || rec[k] === null || rec[k] === undefined) errors.push('กรุณากรอก ' + required[k]);
  });
  if (!rec.days || !rec.days.length) errors.push('กรุณากรอก วันที่ฉีด (เช่น 5 หรือ 5,19)');
  if (errors.length) return { errors: errors, warnings: warnings, computed: null };

  // 2) รูปแบบข้อมูล
  if (ctx.pcus.indexOf(rec.pcu) < 0) errors.push('ไม่พบ รพ.สต. นี้ในระบบ');
  const drug = ctx.drugs.filter(function (d) { return d.code === rec.drugCode; })[0];
  if (!drug) errors.push('ไม่พบชนิดยานี้ในระบบ');
  if (!new RegExp('^\\d{' + ctx.hnLength + '}$').test(rec.hn)) {
    errors.push('HN ต้องเป็นตัวเลข ' + ctx.hnLength + ' หลัก');
  }
  const dd = fromIso(rec.dispenseDate);
  const ad = fromIso(rec.appointmentDate);
  const td = fromIso(ctx.today);
  if (!dd) errors.push('วันที่จ่ายยาไม่ถูกต้อง');
  if (!ad) errors.push('วันนัดพบแพทย์ไม่ถูกต้อง');
  if (dd && dd > td) errors.push('วันที่จ่ายยาเป็นวันในอนาคต');
  if (dd && ad && ad <= dd) errors.push('วันนัดพบแพทย์ต้องอยู่หลังวันที่จ่ายยา');
  if (rec.days.length > 2) errors.push('กำหนดวันฉีดได้ไม่เกิน 2 วันต่อเดือน');
  if (!(rec.doseMg > 0)) errors.push('ขนาดยาต้องมากกว่า 0 mg');
  if (!(Number.isInteger(rec.qtyAmp) && rec.qtyAmp >= 1)) errors.push('จำนวนที่จ่ายต้องเป็นจำนวนเต็มตั้งแต่ 1 amp');
  const every = rec.everyMonths || 1;
  if (!(Number.isInteger(every) && every >= 1 && every <= 6)) errors.push('รอบการฉีด "ทุก N เดือน" ต้องอยู่ระหว่าง 1-6 เดือน');
  const mgPerAmp = drug ? Number(drug.mgPerAmp) : 0;
  if (drug && !(mgPerAmp > 0)) errors.push('ค่า mg ต่อ amp ของยานี้ในชีต Drugs ไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ');
  if (errors.length) return { errors: errors, warnings: warnings, computed: null };

  // 3) คำนวณตารางฉีดและจำนวน amp
  const ampPerDose = calcAmpPerDose(rec.doseMg, mgPerAmp);
  const fullSchedule = buildSchedule(rec.dispenseDate, rec.appointmentDate, rec.days, every);
  // ถ้ามีรอบจ่ายยาที่ "ใหม่กว่า" อยู่แล้ว (บันทึกย้อนหลัง) สร้างนัดเฉพาะก่อนวันจ่ายยารอบนั้น
  const newer = ctx.disps.filter(function (d) {
    return d.drugCode === rec.drugCode && d.dispenseDate > rec.dispenseDate;
  }).map(function (d) { return d.dispenseDate; }).sort()[0] || '';
  const schedule = newer ? fullSchedule.filter(function (x) { return x < newer; }) : fullSchedule;
  const ampCalc = fullSchedule.length * ampPerDose;              // เทียบกับจำนวนบนสติ๊กเกอร์ ใช้ตารางเต็ม
  const computed = {
    ampPerDose: ampPerDose, schedule: schedule, ampCalc: ampCalc, injCount: schedule.length,
    everyMonths: every, fiscalYear: fiscalYearOf(rec.dispenseDate), drugName: drug.name,
    isNew: ctx.disps.length === 0                                // รายใหม่ = ยังไม่มีการจ่ายยาที่ใช้งานอยู่เลย
  };

  // 4) ข้อผิดพลาดที่ห้ามบันทึก
  if (!fullSchedule.length) errors.push('ไม่มีวันฉีดระหว่างวันจ่ายยาถึงก่อนวันนัดพบแพทย์');
  const dup = ctx.disps.some(function (d) {
    return d.dispenseDate === rec.dispenseDate && d.drugCode === rec.drugCode;
  });
  if (dup) errors.push('รายการนี้ถูกบันทึกแล้ว (HN วันที่จ่าย และชนิดยาเดียวกัน)');

  // 5) คำเตือน (บันทึกได้เมื่อผู้ใช้กดยืนยัน)
  if (fullSchedule.length && ampCalc !== rec.qtyAmp) {
    warnings.push('จำนวนที่จ่าย ' + rec.qtyAmp + ' amp ไม่ตรงกับที่คำนวณได้ ' + ampCalc +
      ' amp (' + fullSchedule.length + ' ครั้ง x ' + ampPerDose + ' amp)');
  }
  if (newer) {
    warnings.push('มีรอบจ่ายยาที่ใหม่กว่าแล้ว (' + thaiDate(newer) + ') ระบบจะสร้างนัดเฉพาะก่อนวันนั้น ' +
      schedule.length + ' ครั้ง และไม่แตะนัดของรอบที่ใหม่กว่า');
  }
  if (isWeekly(rec.regimenText)) {
    warnings.push('regimen เป็นรายสัปดาห์ แต่ระบบคำนวณตาม "วันที่ของเดือน" กรุณาตรวจตารางวันฉีดให้ถูกต้อง');
  }
  if (every > 1) warnings.push('regimen ฉีดทุก ' + every + ' เดือน กรุณาตรวจตารางวันฉีดว่าตรงกับคำสั่งแพทย์');
  if (Math.abs(rec.doseMg / (mgPerAmp / 2) - Math.round(rec.doseMg / (mgPerAmp / 2))) > 1e-9) {
    warnings.push('ขนาดยา ' + rec.doseMg + ' mg ไม่ลงตัวกับครึ่ง amp กรุณาตรวจสอบ');
  }
  if (ctx.pat) {
    // ctx.hideNames = ผู้ใช้ รพ.สต. -> ไม่แสดงชื่อ/รพ.สต. เดิม (กันข้อมูลข้าม รพ.สต. รั่ว)
    if (normName(ctx.pat.name) !== normName(rec.name)) {
      warnings.push('ชื่อไม่ตรงกับประวัติเดิมของ HN นี้' + (ctx.hideNames ? ' กรุณาตรวจ HN อีกครั้ง' : ' (' + ctx.pat.name + ')'));
    }
    if (ctx.pat.pcu && ctx.pat.pcu !== rec.pcu) {
      warnings.push(ctx.hideNames ? 'HN นี้เคยรับยาที่ รพ.สต. อื่น' : 'ผู้ป่วยรายนี้เคยรับยาที่ รพ.สต.' + ctx.pat.pcu);
    }
  }
  if ((td - dd) / 86400000 > 30) warnings.push('วันที่จ่ายยาย้อนหลังเกิน 30 วัน');
  if ((ad - dd) / 86400000 > 180) warnings.push('วันนัดพบแพทย์ห่างจากวันจ่ายยาเกิน 6 เดือน');
  const overlap = ctx.disps.some(function (d) {
    return d.drugCode === rec.drugCode && d.dispenseDate < rec.dispenseDate &&
      d.appointmentDate > rec.dispenseDate;
  });
  if (overlap) {
    warnings.push('รอบจ่ายยาก่อนหน้ายังไม่ถึงวันนัด ระบบจะยกเลิกนัดฉีดที่ยังไม่ฉีดของรอบก่อน ตั้งแต่วันที่จ่ายยารอบนี้');
  }
  return { errors: errors, warnings: warnings, computed: computed };
}
