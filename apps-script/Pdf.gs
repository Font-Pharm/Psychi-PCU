/**
 * =====================================================================
 * Pdf.gs — เอกสาร PDF รายชื่อผู้ป่วยนัดฉีดยาจิตเวช (รูปแบบเอกสารทางการ)
 * ---------------------------------------------------------------------
 * วิธีทำ: สร้าง Google Docs ชั่วคราว -> แปลงเป็น PDF -> ย้ายไฟล์ชั่วคราวลงถังขยะ
 * ไฟล์ PDF ส่งตรงไปที่เครื่องผู้ใช้ ไม่ถูกเก็บหรือแชร์ใน Drive
 *
 * รูปแบบเอกสาร
 *   - กระดาษ A4 แนวนอน (ตาราง 7 คอลัมน์ ชื่อและชื่อยาไม่ต้องตัดบรรทัด)
 *   - ขอบกระดาษ บน/ล่าง 2 ซม. ซ้าย 2.5 ซม. ขวา 2 ซม.
 *   - ฟอนต์ Sarabun (ฟอนต์ราชการที่ Google Docs มีให้ใช้) หัวเรื่อง 16 / เนื้อหา 12 / หมายเหตุ 10
 *   - ความกว้างคอลัมน์กำหนดตามความยาวข้อมูลจริงของแต่ละคอลัมน์
 *   - ใช้ "ช่องว่างไม่ตัดบรรทัด" ระหว่างคำที่ต้องอยู่ด้วยกัน เช่น 50 mg, ชื่อ-สกุล
 *   - ช่องผลการฉีดและวันนัดจัดกึ่งกลาง / บรรทัดผู้จัดทำรายงานชิดขวาใต้ตาราง
 * =====================================================================
 */

const PDF_CM = 28.35;                                     // 1 ซม. = 28.35 จุด (หน่วยของ Google Docs)
const PDF_NBSP = '\u00A0';                                       // ช่องว่างที่ไม่ยอมให้ตัดขึ้นบรรทัดใหม่

// ความกว้างคอลัมน์ (ซม.) รวม 25.2 ซม. = กว้างกระดาษแนวนอน 29.7 - ขอบซ้าย 2.5 - ขอบขวา 2
const PDF_COLS = [
  { head: 'ที่', cm: 1.0, center: true },
  { head: 'HN', cm: 2.5, center: true },
  { head: 'ชื่อ-สกุล', cm: 5.6 },
  { head: 'ยา / ขนาด', cm: 4.9 },
  { head: 'ครั้งที่', cm: 1.4, center: true },
  { head: 'แพ้ยา', cm: 3.4 },                                 // ตารางค้างยืนยันจะเปลี่ยนเป็น "วันนัด"
  { head: 'ผลการฉีด / ลงชื่อผู้ฉีด', cm: 6.4, center: true }
];

/**
 * สร้าง PDF ของ รพ.สต. 1 แห่ง ในวันที่เลือก
 * รวม: นัดฉีดวันนั้น + รายการค้างยืนยันก่อนหน้า (ถ้าเป็นวันนี้)
 * คืนค่า { fileName, base64 }
 */
function buildInjectionPdf_(pcu, dateIso) {
  if (!fromIso(dateIso)) throw new Error('วันที่ไม่ถูกต้อง');
  const all = readAll_('INJ').filter(function (i) { return i.pcu === pcu && i.status !== 'cancelled'; });
  const dayList = all.filter(function (i) { return i.scheduledDate === dateIso; })
    .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  const overdue = dateIso === todayIso_() ? all.filter(function (i) {
    return i.status === 'pending' && i.scheduledDate < dateIso &&
      i.scheduledDate >= addDaysIso(dateIso, -OVERDUE_LOOKBACK_DAYS);
  }).sort(function (a, b) { return a.scheduledDate < b.scheduledDate ? -1 : 1; }) : [];
  // ประวัติแพ้ยาจากทะเบียนผู้ป่วย (แสดงในเอกสารเพื่อความปลอดภัยของผู้ฉีด)
  const allergy = {};
  readAll_('PAT').forEach(function (p) { allergy[p.hn] = p.allergy; });

  const doc = DocumentApp.create('tmp_injection_' + Date.now());
  const fileId = doc.getId();
  try {
    const body = doc.getBody();
    // กระดาษ A4 แนวนอน + ขอบกระดาษ
    body.setPageWidth(29.7 * PDF_CM).setPageHeight(21.0 * PDF_CM);
    body.setMarginTop(2 * PDF_CM).setMarginBottom(2 * PDF_CM);
    body.setMarginLeft(2.5 * PDF_CM).setMarginRight(2 * PDF_CM);

    // ---- หัวเอกสาร ----
    const title = body.getParagraphs()[0];
    title.setText('รายชื่อผู้ป่วยนัดฉีดยาจิตเวช');
    styleP_(title, sty_(16, true), 'center', 0, 2);
    styleP_(body.appendParagraph('โรงพยาบาลส่งเสริมสุขภาพตำบล' + pcu), sty_(14, true), 'center', 0, 2);
    styleP_(body.appendParagraph('วันที่ ' + nb_(thaiDateLong_(dateIso)) + '     จำนวนนัดฉีด ' + dayList.length + PDF_NBSP + 'ราย'),
      sty_(12, false), 'center', 0, 10);

    // ---- ตารางหลัก ----
    appendInjTable_(body, dayList, allergy, false);

    // ---- ตารางค้างยืนยัน ----
    if (overdue.length) {
      styleP_(body.appendParagraph('รายการที่เลยวันนัดและยังไม่ยืนยันผลการฉีด (' + overdue.length + PDF_NBSP + 'ราย)'),
        sty_(12, true), 'left', 14, 4);
      appendInjTable_(body, overdue, allergy, true);
    }

    // ---- ผู้จัดทำรายงาน: บรรทัดเดียว ชิดขวาใต้ตาราง ----
    styleP_(body.appendParagraph('ผู้จัดทำรายงาน ........................................   วันที่ ......................'),
      sty_(12, false), 'right', 8, 10);
    // ---- หมายเหตุ ----
    styleP_(body.appendParagraph('หมายเหตุ  โปรดบันทึกผลการฉีดในระบบภายในวันที่ฉีด กรณีผู้ป่วยไม่มาตามนัด ให้ระบุ "ไม่มา" และติดตามผู้ป่วย'),
      sty_(10, false, '#455A64'), 'left', 0, 0);

    // ---- ท้ายกระดาษทุกหน้า ----
    const footer = doc.addFooter();
    const fp = footer.getParagraphs()[0] || footer.appendParagraph('');
    fp.setText(APP_FOOTER + '   พิมพ์เมื่อ ' + nowStr_());
    styleP_(fp, sty_(9, false, '#78909C'), 'right', 0, 0);

    doc.saveAndClose();
    const blob = DriveApp.getFileById(fileId).getAs('application/pdf');
    return {
      fileName: 'นัดฉีดยาจิตเวช_' + pcu + '_' + dateIso + '.pdf',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    // บอกบรรทัดที่ผิดพลาดด้วย เช่น "... [Pdf.gs:52]" เพื่อให้ตามแก้ได้ตรงจุด
    const at = String(e.stack || '').match(/\w+\.gs:\d+/);
    throw new Error('สร้าง PDF ไม่สำเร็จ: ' + e.message + (at ? ' [' + at[0] + ']' : ''));
  } finally {
    DriveApp.getFileById(fileId).setTrashed(true);       // ทิ้งไฟล์ชั่วคราวเสมอ แม้เกิดข้อผิดพลาด
  }
}

/** เพิ่มตารางรายชื่อลงเอกสาร (showDate = ตารางค้างยืนยัน แสดงวันนัดแทนแพ้ยา) */
function appendInjTable_(body, list, allergy, showDate) {
  const heads = PDF_COLS.map(function (c, k) { return k === 5 && showDate ? 'วันนัด' : c.head; });
  const rows = [heads];
  list.forEach(function (i, k) {
    rows.push([
      String(k + 1),
      i.hn,
      nb_(i.name),                                           // ชื่อ-สกุลอยู่บรรทัดเดียวกัน
      drugText_(i),
      String(i.cycleNo),
      showDate ? nb_(thaiDate(i.scheduledDate)) : (allergy[i.hn] || 'ไม่มี'),
      i.status === 'done' ? 'ฉีดแล้ว' + PDF_NBSP + nb_(thaiDate(i.actualDate)) : (i.status === 'missed' ? 'ไม่มา' : ' ')
    ]);
  });
  if (rows.length === 1) rows.push([' ', ' ', 'ไม่มีนัดฉีด', ' ', ' ', ' ', ' ']);

  const table = body.appendTable(rows);
  table.setBorderColor('#9AA5AB').setBorderWidth(0.75);
  PDF_COLS.forEach(function (c, k) { table.setColumnWidth(k, c.cm * PDF_CM); });

  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    row.setMinimumHeight(r === 0 ? 0.9 * PDF_CM : 1.15 * PDF_CM);   // แถวข้อมูลสูงพอให้ลงชื่อได้
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(5).setPaddingRight(5);
      cell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
      if (r === 0) cell.setBackgroundColor('#E3ECE8');         // หัวตารางพื้นเทาเขียวอ่อน ตัวอักษรดำ
      const text = cell.getText();
      // แพ้ยา: ถ้ามีประวัติ ให้เป็นตัวหนาสีแดงเข้ม เพื่อให้ผู้ฉีดเห็นชัด
      const alert = r > 0 && c === 5 && !showDate && text && text !== 'ไม่มี' && text.trim();
      const st = r === 0 ? sty_(12, true) : (alert ? sty_(12, true, '#A11A1A') : sty_(12, false));
      // กึ่งกลาง: หัวตาราง, คอลัมน์ที่กำหนด center, และช่อง "วันนัด" ในตารางค้างยืนยัน
      const align = r === 0 || PDF_COLS[c].center || (c === 5 && showDate) ? 'center' : 'left';
      for (let k = 0; k < cell.getNumChildren(); k++) {
        const child = cell.getChild(k);
        if (child && child.getType() === DocumentApp.ElementType.PARAGRAPH) styleP_(child.asParagraph(), st, align, 0, 0);
      }
    }
  }
  // ย่อหน้าว่างหลังตาราง (Google Docs บังคับให้มี) ทำให้เตี้ยที่สุด
  const after = body.appendParagraph('');
  styleP_(after, sty_(4, false), 'left', 0, 0);
}

/** ข้อความยา 2 บรรทัด: ชื่อยา / ขนาด วิธีให้ จำนวน amp (คำที่ต้องอยู่ด้วยกันใช้ช่องว่างไม่ตัดบรรทัด) */
function drugText_(i) {
  const name = String(i.drugName || '').split(' ').slice(0, 2).join(PDF_NBSP);
  return name + '\n' + i.doseMg + PDF_NBSP + 'mg' + PDF_NBSP + 'IM' + '  (' + i.ampPerDose + PDF_NBSP + 'amp)';
}

/** แทนช่องว่างธรรมดาด้วยช่องว่างไม่ตัดบรรทัด */
function nb_(s) {
  return String(s || '').replace(/ /g, PDF_NBSP);
}

/** ชุดรูปแบบตัวอักษร ฟอนต์ Sarabun */
function sty_(size, bold, color) {
  const A = DocumentApp.Attribute;
  const o = {};
  o[A.FONT_FAMILY] = 'Sarabun';
  o[A.FONT_SIZE] = size;
  o[A.BOLD] = !!bold;
  o[A.FOREGROUND_COLOR] = color || '#000000';
  return o;
}

/**
 * ตั้งรูปแบบย่อหน้า (ข้ามถ้าไม่มีย่อหน้า)
 * align = 'left' | 'center' | 'right', before/after = ระยะห่างก่อน/หลังย่อหน้า (จุด)
 */
function styleP_(p, st, align, before, after) {
  if (!p) return;
  p.setAttributes(st);
  const H = DocumentApp.HorizontalAlignment;
  if (align) p.setAlignment(align === 'center' ? H.CENTER : align === 'right' ? H.RIGHT : H.LEFT);
  p.setLineSpacing(1.0);                                     // ระยะบรรทัดปกติ ไม่ห่างเกิน
  if (before !== undefined) p.setSpacingBefore(before);
  if (after !== undefined) p.setSpacingAfter(after);
}

/**
 * ทดสอบสร้าง PDF จากหน้าแก้โค้ด: เลือกฟังก์ชัน testPdf แล้วกด "เรียกใช้"
 * ดูผลที่ "บันทึกการดำเนินการ" (ถ้า error จะบอกชื่อไฟล์และบรรทัด)
 * ถ้าอยากเปิดดูไฟล์: ตั้ง SAVE = true ไฟล์จะถูกบันทึกในไดรฟ์ของเจ้าของสคริปต์
 */
function testPdf() {
  const SAVE = false;
  const pcu = readAll_('PCU')[0].name;                   // รพ.สต. แห่งแรกในรายการ
  const r = buildInjectionPdf_(pcu, todayIso_());
  Logger.log('สำเร็จ: ' + r.fileName + ' ขนาด ' + Math.round(r.base64.length * 0.75 / 1024) + ' KB');
  if (SAVE) {
    const f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(r.base64), 'application/pdf', r.fileName));
    Logger.log('เปิดดูได้ที่: ' + f.getUrl());
  }
}

/** วันที่แบบเต็ม "9 พฤศจิกายน 2569" */
function thaiDateLong_(iso) {
  const full = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const d = fromIso(iso);
  return d.getDate() + ' ' + full[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}
