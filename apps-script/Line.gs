/**
 * =====================================================================
 * Line.gs — แจ้งเตือนผ่าน LINE OA (Messaging API)
 * ---------------------------------------------------------------------
 *  - ทุกเช้า (ALERT_HOUR) ส่งการ์ดรายชื่อผู้ป่วยที่มีนัดฉีด "วันนี้"
 *    ให้เจ้าหน้าที่ของ รพ.สต. นั้น ๆ เท่านั้น
 *  - ชื่อและ HN ถูกปิดบางส่วน ดูชื่อเต็ม/ดาวน์โหลด PDF ได้หลัง login
 *  - เจ้าหน้าที่ห้องยาที่เชื่อม LINE แล้ว ได้รับการ์ดสรุป "จำนวน" แยก รพ.สต.
 *  - ส่งเฉพาะวันที่มีนัดฉีด เพื่อประหยัดโควตาข้อความ
 * Script Properties: LINE_CHANNEL_ACCESS_TOKEN (จาก Messaging API channel)
 * =====================================================================
 */

/**
 * ส่งข้อความหาผู้ใช้หลายคน (multicast ส่งได้ครั้งละไม่เกิน 500 คน)
 * คืนค่าจำนวนคนที่ส่งสำเร็จ
 */
function pushLine_(userIds, messages) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
  const ids = userIds.filter(function (x, i) { return x && userIds.indexOf(x) === i; });   // ตัดซ้ำ/ค่าว่าง
  let sent = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: chunk, messages: messages }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) sent += chunk.length;
    else console.error('LINE', res.getResponseCode(), res.getContentText());
  }
  return sent;
}

/** ข้อความ 1 บรรทัดในการ์ด */
function flexText_(text, opt) {
  const o = { type: 'text', text: String(text), wrap: true, size: 'sm', color: '#263238' };
  Object.keys(opt || {}).forEach(function (k) { o[k] = opt[k]; });
  return o;
}

/**
 * สร้างการ์ด Flex รายชื่อของ รพ.สต. 1 แห่ง
 * today = นัดฉีดวันนี้, overdue = เลยวันนัดแต่ยังไม่ยืนยัน
 */
function buildPcuFlex_(pcu, dateIso, today, overdue) {
  const rows = [];
  rows.push(flexText_('นัดฉีดวันนี้ ' + today.length + ' ราย', { weight: 'bold', color: '#0B6E4F', size: 'md' }));
  today.slice(0, LINE_MAX_ROWS).forEach(function (i, k) {
    rows.push(flexText_((k + 1) + '. ' + maskName(i.name) + ' HN ' + maskHn(i.hn)));
    rows.push(flexText_('    ' + i.drugName.split(' ').slice(0, 2).join(' ') + ' ' + i.doseMg +
      ' mg (ครั้งที่ ' + i.cycleNo + ')', { color: '#546E7A', size: 'xs' }));
  });
  if (today.length > LINE_MAX_ROWS) rows.push(flexText_('และอีก ' + (today.length - LINE_MAX_ROWS) + ' ราย ดูในระบบ', { color: '#546E7A' }));
  if (overdue.length) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push(flexText_('ค้างยืนยันการฉีด ' + overdue.length + ' ราย', { weight: 'bold', color: '#C62828', margin: 'md' }));
    overdue.slice(0, 10).forEach(function (i) {
      rows.push(flexText_('- ' + maskName(i.name) + ' นัด ' + thaiDate(i.scheduledDate), { size: 'xs' }));
    });
  }
  const url = redirectUri_() + '?' + qs_({ view: 'day', pcu: pcu });
  return {
    type: 'flex',
    altText: 'นัดฉีดยาจิตเวช รพ.สต.' + pcu + ' วันนี้ ' + today.length + ' ราย',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0B6E4F', paddingAll: '14px',
        contents: [
          flexText_('แจ้งนัดฉีดยาจิตเวช', { color: '#FFFFFF', weight: 'bold', size: 'md' }),
          flexText_('รพ.สต.' + pcu + ' | ' + thaiDate(dateIso), { color: '#D7F0E6' })
        ]
      },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', color: '#1565C0', height: 'sm',
            action: { type: 'uri', label: 'เปิดรายชื่อ/PDF', uri: url }
          },
          flexText_(APP_FOOTER, { size: 'xxs', color: '#90A4AE', align: 'center' })
        ]
      }
    }
  };
}

/** การ์ดสรุปจำนวนสำหรับห้องยา (ไม่มีชื่อผู้ป่วย) */
function buildSummaryFlex_(dateIso, perPcu) {
  const names = Object.keys(perPcu).sort();
  const rows = names.map(function (n) {
    return {
      type: 'box', layout: 'horizontal', contents: [
        flexText_('รพ.สต.' + n, { flex: 5 }),
        flexText_(perPcu[n].today + ' ราย', { flex: 2, align: 'end' }),
        flexText_(perPcu[n].overdue ? 'ค้าง ' + perPcu[n].overdue : '-', { flex: 2, align: 'end', color: '#C62828' })
      ]
    };
  });
  const total = names.reduce(function (s, n) { return s + perPcu[n].today; }, 0);
  return {
    type: 'flex',
    altText: 'สรุปนัดฉีดยาจิตเวชวันนี้ ' + total + ' ราย',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1565C0', paddingAll: '14px',
        contents: [
          flexText_('สรุปนัดฉีดยาจิตเวช รพ.สต.', { color: '#FFFFFF', weight: 'bold', size: 'md' }),
          flexText_(thaiDate(dateIso) + ' | รวม ' + total + ' ราย', { color: '#DCE9FA' })
        ]
      },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows },
      footer: {
        type: 'box', layout: 'vertical', contents: [{
          type: 'button', style: 'primary', color: '#0B6E4F', height: 'sm',
          // เปิดในเบราว์เซอร์หลักของเครื่อง เพราะ Google ไม่อนุญาตให้ login ในเบราว์เซอร์ของ LINE
          action: { type: 'uri', label: 'เปิดระบบ', uri: redirectUri_() + '?view=calendar&openExternalBrowser=1' }
        }]
      }
    }
  };
}

/**
 * งานประจำวัน (ตั้งเวลาด้วย createDailyTrigger)
 * 1) หานัดฉีดวันนี้ + ค้างยืนยัน แยกตาม รพ.สต.
 * 2) ส่งการ์ดให้เจ้าหน้าที่ รพ.สต. ที่มีนัดวันนี้
 * 3) ส่งการ์ดสรุปให้ห้องยาที่เชื่อม LINE
 */
function sendDailyAlerts() {
  const rotated = rotateAuditLog_();                     // แยก AuditLog เก่าออก ถ้าใหญ่เกิน
  const today = todayIso_();
  const since = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
  const per = {};
  readAll_('INJ').forEach(function (i) {
    if (i.status !== 'pending') return;
    if (!per[i.pcu]) per[i.pcu] = { today: [], overdue: [] };
    if (i.scheduledDate === today) per[i.pcu].today.push(i);
    else if (i.scheduledDate < today && i.scheduledDate >= since) per[i.pcu].overdue.push(i);
  });
  const users = readAll_('USERS').filter(function (u) { return u.status === 'active' && u.lineUserId; });
  const log = [];
  const summary = {};
  Object.keys(per).forEach(function (pcu) {
    const g = per[pcu];
    if (!g.today.length) return;                         // ส่งเฉพาะวันที่มีนัดฉีด
    g.today.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    summary[pcu] = { today: g.today.length, overdue: g.overdue.length };
    const ids = users.filter(function (u) { return u.role === 'pcu' && u.pcu === pcu; })
      .map(function (u) { return u.lineUserId; });
    const sent = ids.length ? pushLine_(ids, [buildPcuFlex_(pcu, today, g.today, g.overdue)]) : 0;
    log.push(pcu + ':' + g.today.length + ' ราย ส่ง ' + sent + '/' + ids.length + ' คน');
  });
  if (Object.keys(summary).length) {
    const staff = users.filter(function (u) { return u.role !== 'pcu'; }).map(function (u) { return u.lineUserId; });
    if (staff.length) log.push('ห้องยา ส่ง ' + pushLine_(staff, [buildSummaryFlex_(today, summary)]) + ' คน');
  }
  let msg = log.length ? log.join(' | ') : 'วันนี้ไม่มีนัดฉีด';
  if (!/\/exec$/.test(redirectUri_())) msg += ' | คำเตือน: ยังไม่ได้ตั้ง REDIRECT_URI ลิงก์ในการ์ด LINE อาจเปิดไม่ได้';
  if (rotated) msg += ' | แยก AuditLog เก่าเป็นแท็บใหม่แล้ว';
  audit_(null, 'dailyAlert', msg);
  return msg;
}

/**
 * แจ้งผู้ดูแลระบบที่เชื่อม LINE ว่ามีคำขอบันทึกย้อนหลังรออนุมัติ
 * (ไม่มีชื่อ/HN ผู้ป่วยในข้อความ)
 */
function notifyAdminsRequest_(pcu) {
  if (!prop_('LINE_CHANNEL_ACCESS_TOKEN')) return 0;
  const ids = readAll_('USERS').filter(function (u) {
    return u.role === 'admin' && u.status === 'active' && u.lineUserId;
  }).map(function (u) { return u.lineUserId; });
  if (!ids.length) return 0;
  const n = readAll_('REQ').filter(function (r) { return r.status === 'pending'; }).length;
  return pushLine_(ids, [{
    type: 'text',
    text: 'มีคำขอบันทึกย้อนหลังใหม่ จาก รพ.สต.' + pcu + '\nรออนุมัติทั้งหมด ' + n + ' รายการ\n' +
      redirectUri_() + '?view=requests&openExternalBrowser=1'
  }]);
}
