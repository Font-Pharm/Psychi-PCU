/**
 * =====================================================================
 * Ai.gs — ให้ Gemini อ่านภาพสติ๊กเกอร์ยา
 * ---------------------------------------------------------------------
 *  - ใช้ Gemini API แบบเสียเงิน (Paid tier) เท่านั้น เพราะภาพมีข้อมูลผู้ป่วย
 *  - ภาพไม่ถูกบันทึกในระบบ ส่งไปอ่านแล้วทิ้ง
 *  - ผลของ AI ถูก "ตรวจซ้ำ" ด้วยกฎใน Logic.gs ช่องไหนไม่แน่ใจจะถูกทำเครื่องหมาย
 *    ให้เจ้าหน้าที่ตรวจก่อนบันทึกทุกครั้ง
 * Script Properties: GEMINI_API_KEY, GEMINI_MODEL (เช่น gemini-3.5-flash)
 * =====================================================================
 */

// คำสั่งให้ AI — อธิบายรูปแบบสติ๊กเกอร์ของ รพ.ศีขรภูมิ
const OCR_PROMPT = [
  'You are reading ONE Thai hospital drug sticker (Sikhoraphum Hospital pharmacy). Copy text exactly as printed.',
  'Layout: line 1 "กลุ่มงานเภสัชกรรม โรงพยาบาลศีขรภูมิ" then the dispense date (e.g. "09 พ.ย. 69").',
  'Line 2: "HN" + digits, then patient name with title (นาย/นาง/น.ส.), then "หน้า x / y" (ignore the page).',
  'Line 3: drug name, then "#" and the quantity number.',
  'Next line(s) until "ฉีดที่": the regimen (dose in mg, route, schedule) — join them with one space.',
  '"แพ้ยา:" line: allergy text after the colon (empty if blank).',
  'Ignore the blank "ฉีดที่....วันที่...." line.',
  'If any character of a field is blurred, covered, cut off or unreadable, return "" for that field',
  'and list the field name in unclearFields. NEVER guess digits of HN or quantity.',
  'Set isSticker=false if the image is not this kind of sticker.'
].join('\n');

// รูปแบบผลลัพธ์ JSON ที่บังคับให้ AI ตอบ
const OCR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isSticker: { type: 'BOOLEAN' },
    dateText: { type: 'STRING' },
    hn: { type: 'STRING' },
    name: { type: 'STRING' },
    drugText: { type: 'STRING' },
    qtyText: { type: 'STRING' },
    regimenText: { type: 'STRING' },
    allergyText: { type: 'STRING' },
    unclearFields: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['isSticker', 'dateText', 'hn', 'name', 'drugText', 'qtyText', 'regimenText', 'allergyText', 'unclearFields']
};

/**
 * ส่งภาพให้ Gemini อ่าน แล้วตรวจซ้ำ
 * คืนค่า { fields:{...ค่าที่เติมในฟอร์ม}, flags:{ชื่อช่อง:'เหตุผลที่ต้องตรวจ'}, raw:{...ข้อความที่อ่านได้} }
 */
function ocrSticker_(base64, mimeType) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY');
  const model = prop_('GEMINI_MODEL') || 'gemini-3.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: OCR_PROMPT }, { inlineData: { mimeType: mimeType, data: base64 } }]
    }],
    generationConfig: {
      temperature: 0,                                  // ให้ตอบแบบคงที่ ไม่สร้างสรรค์
      responseMimeType: 'application/json',
      responseSchema: OCR_SCHEMA
    }
  };
  const opt = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },               // ใส่ key ใน header ไม่ใส่ใน URL
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  let res = UrlFetchApp.fetch(url, opt);
  // Gemini ไม่ว่าง/ขัดข้องชั่วคราว (429, 500, 503) -> รอ 2 วินาทีแล้วลองใหม่ 1 ครั้ง
  if ([429, 500, 503].indexOf(res.getResponseCode()) >= 0) {
    Utilities.sleep(2000);
    res = UrlFetchApp.fetch(url, opt);
  }
  if (res.getResponseCode() !== 200) {
    console.error('gemini', res.getResponseCode(), res.getContentText().slice(0, 500));
    throw new Error('AI อ่านภาพไม่สำเร็จ: ' + geminiErrorTh_(res) + ' (รันฟังก์ชัน testGemini เพื่อตรวจ)');
  }
  const j = JSON.parse(res.getContentText());
  const text = j.candidates && j.candidates[0] && j.candidates[0].content &&
    j.candidates[0].content.parts && j.candidates[0].content.parts[0].text;
  if (!text) throw new Error('AI ไม่ส่งผลลัพธ์ กรุณาถ่ายภาพใหม่');
  return checkOcr_(JSON.parse(text));
}

/**
 * ตรวจซ้ำผลของ AI ด้วยกฎ แล้วแปลงเป็นค่าสำหรับฟอร์ม
 * ช่องที่ผิดรูปแบบหรือ AI ไม่แน่ใจ -> flags (หน้าเว็บจะแสดงสีเหลือง)
 */
function checkOcr_(a) {
  const flags = {};
  const unclear = (a.unclearFields || []).map(function (s) { return String(s); });
  const mark = function (field, why) { if (!flags[field]) flags[field] = why; };
  if (a.isSticker === false) mark('all', 'ภาพนี้อาจไม่ใช่สติ๊กเกอร์ยาฉีด');

  // วันที่จ่ายยา
  const dispenseDate = parseThaiDate(a.dateText);
  if (!dispenseDate) mark('dispenseDate', 'อ่านวันที่ไม่ได้');

  // HN: ต้องเป็นตัวเลขครบ 9 หลัก
  const hn = String(a.hn || '').replace(/\D/g, '');
  if (hn.length !== HN_LENGTH) mark('hn', 'HN ไม่ครบ ' + HN_LENGTH + ' หลัก');

  // ชื่อ: ต้องมีคำนำหน้า
  const name = String(a.name || '').replace(/\s+/g, ' ').trim();
  if (!name) mark('name', 'อ่านชื่อไม่ได้');
  else if (!/^(นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็ก)/.test(name)) mark('name', 'ไม่พบคำนำหน้าชื่อ');

  // ชนิดยา: เทียบคำสำคัญกับชีต Drugs
  const drugText = String(a.drugText || '').toLowerCase();
  const drug = readAll_('DRUG').filter(function (d) {
    return d.active !== 'N' && String(d.keywords).toLowerCase().split(',').some(function (k) {
      return k.trim() && drugText.indexOf(k.trim()) >= 0;
    });
  })[0];
  if (!drug) mark('drugCode', 'ไม่รู้จักชื่อยา "' + (a.drugText || '') + '"');

  // จำนวน amp
  const qty = /^\d+$/.test(String(a.qtyText || '').trim()) ? Number(a.qtyText) : '';
  if (qty === '') mark('qtyAmp', 'อ่านจำนวนไม่ได้');

  // regimen: อ่านขนาดยาและวันที่ฉีดด้วยกฎอีกชั้น
  const reg = parseRegimen(a.regimenText);
  if (reg.doseMg === null) mark('doseMg', 'ไม่พบขนาดยา mg');
  if (!reg.days.length) mark('days', 'ไม่พบวันที่ฉีด');
  if (reg.problems.length) mark('regimenText', reg.problems.join(', '));

  // ช่องที่ AI บอกว่าไม่ชัด
  const map = {
    dateText: 'dispenseDate', hn: 'hn', name: 'name', drugText: 'drugCode',
    qtyText: 'qtyAmp', regimenText: 'regimenText', allergyText: 'allergy'
  };
  unclear.forEach(function (f) { if (map[f]) mark(map[f], 'AI ระบุว่าภาพไม่ชัด'); });

  // ถ้า HN นี้เคยมีในระบบ เติม รพ.สต. และตรวจชื่อ
  let pcu = '';
  let known = false;
  if (hn.length === HN_LENGTH) {
    const pat = readAll_('PAT').filter(function (x) { return x.hn === hn; })[0];
    if (pat) {
      known = hasHistory_(hn, pat);                       // รายเดิม = เคยมีประวัติจ่ายยา
      pcu = pat.pcu;
      if (normName(pat.name) !== normName(name)) mark('name', 'ไม่ตรงกับชื่อเดิมในระบบ: ' + pat.name);
    }
  }
  if (!pcu) mark('pcu', 'กรุณาเลือก รพ.สต.');
  mark('appointmentDate', 'สติ๊กเกอร์ไม่มีวันนัด กรุณากรอก');

  return {
    fields: {
      pcu: pcu, dispenseDate: dispenseDate || '', hn: hn, name: name,
      drugCode: drug ? drug.code : '', doseMg: reg.doseMg === null ? '' : reg.doseMg,
      days: reg.days.join(','), regimenText: reg.raw, qtyAmp: qty,
      appointmentDate: '', allergy: String(a.allergyText || '').trim()
    },
    flags: flags,
    known: known,
    raw: { dateText: a.dateText, drugText: a.drugText, qtyText: a.qtyText }
  };
}

/**
 * แปลรหัสข้อผิดพลาดของ Gemini เป็นภาษาไทย
 */
function geminiErrorTh_(res) {
  const code = res.getResponseCode();
  let msg = '';
  try { msg = JSON.parse(res.getContentText()).error.message; } catch (e) { msg = res.getContentText().slice(0, 200); }
  const th = {
    400: 'คำขอไม่ถูกต้อง หรือ API key ผิด',
    403: 'API key ไม่มีสิทธิ์ หรือยังไม่เปิดใช้ Generative Language API',
    404: 'ไม่พบชื่อโมเดลใน GEMINI_MODEL',
    429: 'เกินโควตา หรือโปรเจกต์ยังไม่ผูก Billing',
    500: 'เซิร์ฟเวอร์ Gemini ขัดข้อง ลองใหม่อีกครั้ง',
    503: 'Gemini ใช้งานหนาแน่น ลองใหม่อีกครั้ง'
  };
  return (th[code] || 'รหัส ' + code) + ' [' + code + '] ' + msg;
}

/**
 * ===== ฟังก์ชันตรวจหาสาเหตุ: เลือก testGemini แล้วกด "เรียกใช้" ในหน้า Apps Script =====
 * ผลจะแสดงใน "บันทึกการดำเนินการ" (Execution log) ทีละขั้น
 */
function testGemini() {
  // ขั้น 1: มี API key หรือยัง
  const key = prop_('GEMINI_API_KEY');
  if (!key) { Logger.log('ขั้น 1 ไม่ผ่าน: ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Script Properties'); return; }
  Logger.log('ขั้น 1 ผ่าน: พบ API key (ขึ้นต้นด้วย ' + key.slice(0, 6) + '...)');

  // ขั้น 2: key ใช้ได้ไหม + มีโมเดลอะไรให้ใช้บ้าง
  const list = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key }, muteHttpExceptions: true
  });
  if (list.getResponseCode() !== 200) { Logger.log('ขั้น 2 ไม่ผ่าน: ' + geminiErrorTh_(list)); return; }
  const flash = (JSON.parse(list.getContentText()).models || [])
    .filter(function (m) {
      return /flash/.test(m.name) && (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
    })
    .map(function (m) { return m.name.replace('models/', ''); });
  Logger.log('ขั้น 2 ผ่าน: โมเดล Flash ที่ใช้ได้ = ' + flash.join(', '));

  // ขั้น 3: ชื่อโมเดลที่ตั้งไว้มีอยู่จริงไหม
  const model = prop_('GEMINI_MODEL') || 'gemini-3.5-flash';
  if (flash.indexOf(model) < 0) {
    Logger.log('ขั้น 3 ไม่ผ่าน: ไม่พบโมเดล "' + model + '" ให้ตั้ง GEMINI_MODEL เป็นชื่อหนึ่งจากขั้น 2');
    return;
  }
  Logger.log('ขั้น 3 ผ่าน: ใช้โมเดล ' + model);

  // ขั้น 4: ลองสั่งงานจริง (ข้อความสั้น ไม่มีข้อมูลผู้ป่วย)
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ตอบคำว่า OK คำเดียว' }] }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) { Logger.log('ขั้น 4 ไม่ผ่าน: ' + geminiErrorTh_(res)); return; }
  Logger.log('ขั้น 4 ผ่าน: Gemini ตอบกลับแล้ว ระบบพร้อมอ่านสติ๊กเกอร์');
  Logger.log('อย่าลืม: แก้โค้ดแล้วต้อง Deploy เป็น "เวอร์ชันใหม่" ทุกครั้ง หน้าเว็บจึงจะใช้โค้ดล่าสุด');
}
