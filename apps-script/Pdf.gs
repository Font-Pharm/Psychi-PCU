/**
 * =====================================================================
 * Pdf.gs — ไฟล์ PDF รายชื่อผู้ป่วยที่ต้องฉีดยา (ฟอนต์ Sarabun)
 * ---------------------------------------------------------------------
 * วิธีทำ: สร้าง Google Docs ชั่วคราว -> แปลงเป็น PDF -> ย้ายไฟล์ชั่วคราวลงถังขยะ
 * ไฟล์ PDF ส่งตรงไปที่เครื่องผู้ใช้ ไม่ถูกเก็บหรือแชร์ใน Drive
 * =====================================================================
 */

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
  }) : [];
  // ประวัติแพ้ยาจากทะเบียนผู้ป่วย (แสดงในเอกสารเพื่อความปลอดภัยของผู้ฉีด)
  const allergy = {};
  readAll_('PAT').forEach(function (p) { allergy[p.hn] = p.allergy; });

  const doc = DocumentApp.create('tmp_injection_' + Date.now());
  const fileId = doc.getId();
  try {
    const body = doc.getBody();
    body.setMarginTop(40).setMarginBottom(40).setMarginLeft(40).setMarginRight(40);
    const A = DocumentApp.Attribute;
    // สร้างชุดรูปแบบตัวอักษร (ฟอนต์ Sarabun) ปรับขนาด/ตัวหนา/สีได้
    const sty = function (size, bold, color) {
      const o = {};
      o[A.FONT_FAMILY] = 'Sarabun';
      o[A.FONT_SIZE] = size;
      o[A.BOLD] = !!bold;
      o[A.FOREGROUND_COLOR] = color || '#000000';
      return o;
    };
    const base = sty(12, false);

    // หัวเอกสาร
    body.getParagraphs()[0].setText('รายชื่อผู้ป่วยนัดฉีดยาจิตเวช รพ.สต.' + pcu)
      .setAttributes(sty(16, true)).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('วันที่ ' + thaiDateLong_(dateIso) + '   จำนวน ' + dayList.length + ' ราย')
      .setAttributes(base).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // ตารางหลัก
    appendInjTable_(body, base, sty(12, true, '#FFFFFF'), dayList, allergy, false);

    // ตารางค้างยืนยัน
    if (overdue.length) {
      body.appendParagraph('รายการที่เลยวันนัดและยังไม่ยืนยันการฉีด ' + overdue.length + ' ราย')
        .setAttributes(sty(12, true));
      appendInjTable_(body, base, sty(12, true, '#FFFFFF'), overdue, allergy, true);
    }

    body.appendParagraph('ผู้จัดทำรายงาน ........................................   วันที่ ......................')
      .setAttributes(base);
    body.appendParagraph(APP_FOOTER + ' | พิมพ์เมื่อ ' + nowStr_())
      .setAttributes(sty(10, false, '#607D8B'));
    doc.saveAndClose();

    const blob = DriveApp.getFileById(fileId).getAs('application/pdf');
    return {
      fileName: 'นัดฉีดยาจิตเวช_' + pcu + '_' + dateIso + '.pdf',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } finally {
    DriveApp.getFileById(fileId).setTrashed(true);       // ทิ้งไฟล์ชั่วคราวเสมอ แม้เกิดข้อผิดพลาด
  }
}

/** เพิ่มตารางรายชื่อลงเอกสาร */
function appendInjTable_(body, base, headStyle, list, allergy, showDate) {
  const head = ['ที่', 'HN', 'ชื่อ-สกุล', 'ยา / ขนาด', 'ครั้งที่', showDate ? 'วันนัด' : 'แพ้ยา', 'สถานะ / ลงชื่อผู้ฉีด'];
  const rows = [head];
  list.forEach(function (i, k) {
    rows.push([
      String(k + 1), i.hn, i.name,
      i.drugName.split(' ').slice(0, 2).join(' ') + ' ' + i.doseMg + ' mg IM (' + i.ampPerDose + ' amp)',
      String(i.cycleNo),
      showDate ? thaiDate(i.scheduledDate) : (allergy[i.hn] || '-'),
      i.status === 'done' ? 'ฉีดแล้ว ' + thaiDate(i.actualDate) : (i.status === 'missed' ? 'ไม่มาฉีด' : '')
    ]);
  });
  if (rows.length === 1) rows.push(['', '', 'ไม่มีรายการ', '', '', '', '']);
  const table = body.appendTable(rows);
  table.setBorderColor('#90A4AE');
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(2).setPaddingBottom(2);
      cell.editAsText().setAttributes(r === 0 ? headStyle : base);   // หัวตาราง = ตัวหนาสีขาว
      if (r === 0) cell.setBackgroundColor('#0B6E4F');
    }
  }
}

/** วันที่แบบเต็ม "9 พฤศจิกายน 2569" */
function thaiDateLong_(iso) {
  const full = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const d = fromIso(iso);
  return d.getDate() + ' ' + full[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}
