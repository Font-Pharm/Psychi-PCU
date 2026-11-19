/**
 * =====================================================================
 * Auth.gs — การเข้าสู่ระบบ
 * ---------------------------------------------------------------------
 *  - ห้องยา    : บัญชี Google (OAuth 2.0)
 *  - รพ.สต.    : LINE Login (ผูกกับ LINE OA เพื่อรับแจ้งเตือน)
 * ขั้นตอน: กดปุ่ม -> ไปหน้า login ของ Google/LINE -> กลับมาที่เว็บแอปพร้อม code
 *        -> สคริปต์แลก code เป็นข้อมูลตัวตน -> สร้าง session (อายุ SESSION_DAYS วัน)
 * ผู้ใช้ใหม่ทุกคนมีสถานะ "รออนุมัติ" จนกว่าผู้ดูแลระบบจะอนุมัติและกำหนด รพ.สต.
 * =====================================================================
 * Script Properties ที่ต้องตั้ง:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (Google Cloud > OAuth client)
 *   LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET   (LINE Login channel)
 *   ADMIN_EMAILS  อีเมลผู้ดูแลระบบ คั่นด้วย , (อนุมัติอัตโนมัติ)
 *   REDIRECT_URI  (ไม่บังคับ) ถ้าไม่ตั้ง ใช้ URL ของเว็บแอปที่ deploy
 */

/** URL ที่ Google/LINE จะส่งผู้ใช้กลับมา ต้องตรงกับที่ลงทะเบียนไว้ทุกตัวอักษร */
function redirectUri_() {
  return prop_('REDIRECT_URI') || ScriptApp.getService().getUrl();
}

// คำสั่งนี้ถูกเรียกจากหน้าที่ฝังใน GitHub Pages หรือไม่ (ตั้งใน doGet / api)
let EMBED_ = false;

/** ลิงก์เปิดระบบสำหรับส่งให้ผู้ใช้ (การ์ด LINE): ใช้หน้าทางเข้า GitHub Pages ถ้าตั้งไว้ */
function appUrl_(params) {
  const q = qs_(params || {});
  return (LAUNCHER_URL || redirectUri_()) + (q ? '?' + q : '');
}

/**
 * สร้าง state (รหัสใช้ครั้งเดียว อายุ 10 นาที) กันการปลอมคำขอ login
 * เก็บไว้ว่ามาจาก Google หรือ LINE และเป็นการ login หรือเชื่อมบัญชี
 */
function newState_(provider, mode, uid, view, pcu) {
  const s = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('st_' + s, JSON.stringify({
    provider: provider, mode: mode, uid: uid || '', view: view || '', pcu: pcu || '',
    embed: EMBED_ ? 1 : 0                                    // เข้ามาจากหน้าทางเข้า GitHub Pages
  }), 600);
  return s;
}

/** แปลง object เป็น query string */
function qs_(o) {
  return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&');
}

/** ลิงก์ปุ่ม "เข้าสู่ระบบด้วย Google" */
function googleAuthUrl_(view, pcu) {
  if (!prop_('GOOGLE_CLIENT_ID')) return '';
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + qs_({
    client_id: prop_('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri_(),
    response_type: 'code',
    scope: 'openid email profile',                 // ขอแค่อีเมลและชื่อ
    state: newState_('google', 'login', '', view, pcu),
    prompt: 'select_account'                       // ให้เลือกบัญชีทุกครั้ง
  });
}

/** ลิงก์ปุ่ม "เข้าสู่ระบบด้วย LINE" (mode = login หรือ link) */
function lineAuthUrl_(mode, uid, view, pcu) {
  if (!prop_('LINE_LOGIN_CHANNEL_ID')) return '';
  return 'https://access.line.me/oauth2/v2.1/authorize?' + qs_({
    response_type: 'code',
    client_id: prop_('LINE_LOGIN_CHANNEL_ID'),
    redirect_uri: redirectUri_(),
    state: newState_('line', mode, uid, view, pcu),
    scope: 'profile openid',
    bot_prompt: 'aggressive'                       // ชวนเพิ่มเพื่อน LINE OA ระหว่าง login
  });
}

/** ถอดข้อมูลส่วนกลางของ id_token (JWT) */
function decodeJwt_(jwt) {
  let part = String(jwt).split('.')[1] || '';
  while (part.length % 4) part += '=';             // เติม = ให้ครบ ก่อนถอดรหัส base64
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
}

/**
 * รับ code กลับจาก Google/LINE แล้วสร้าง session
 * คืนค่า { session } หรือ { notice:'pending' } หรือ { error }
 */
function handleOAuthCallback_(code, state) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('st_' + state);
  if (!raw) return { error: 'หมดเวลาเข้าสู่ระบบ กรุณากดเข้าสู่ระบบอีกครั้ง' };
  cache.remove('st_' + state);                     // state ใช้ได้ครั้งเดียว
  const st = JSON.parse(raw);
  const out = callbackResult_(st, code);
  out.embed = !!st.embed;                                    // ต้องส่งกลับไปหน้าทางเข้า GitHub Pages หรือไม่
  return out;
}

function callbackResult_(st, code) {
  const back = { view: st.view, pcu: st.pcu };               // หน้าที่จะเปิดหลัง login
  try {
    const ident = st.provider === 'google' ? exchangeGoogle_(code) : exchangeLine_(code);
    if (st.mode === 'link') return linkLine_(st.uid, ident);
    const user = upsertUser_(ident);
    if (user.status === 'pending') return { notice: 'pending:' + user.displayName };
    if (user.status !== 'active') return { error: 'บัญชีนี้ถูกปิดการใช้งาน' };
    return { session: createSession_(user.uid), view: back.view, pcu: back.pcu };
  } catch (err) {
    console.error('oauth', err);
    return { error: 'เข้าสู่ระบบไม่สำเร็จ: ' + err.message };
  }
}

/** แลก code ของ Google เป็นอีเมล */
function exchangeGoogle_(code) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      code: code, client_id: prop_('GOOGLE_CLIENT_ID'), client_secret: prop_('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri_(), grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  const j = JSON.parse(res.getContentText());
  if (!j.id_token) throw new Error(j.error_description || j.error || 'Google ไม่ส่งข้อมูลตัวตน');
  // id_token ได้รับตรงจาก Google ผ่าน HTTPS จึงอ่านข้อมูลได้เลย แต่ยังตรวจผู้รับและการยืนยันอีเมล
  const c = decodeJwt_(j.id_token);
  if (c.aud !== prop_('GOOGLE_CLIENT_ID')) throw new Error('token ไม่ได้ออกให้ระบบนี้');
  if (!c.email || c.email_verified === false) throw new Error('อีเมลยังไม่ยืนยัน');
  return { type: 'google', uid: 'g:' + c.email.toLowerCase(), email: c.email.toLowerCase(), name: c.name || c.email, lineUserId: '' };
}

/** แลก code ของ LINE เป็น LINE userId */
function exchangeLine_(code) {
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'post',
    payload: {
      grant_type: 'authorization_code', code: code, redirect_uri: redirectUri_(),
      client_id: prop_('LINE_LOGIN_CHANNEL_ID'), client_secret: prop_('LINE_LOGIN_CHANNEL_SECRET')
    },
    muteHttpExceptions: true
  });
  const j = JSON.parse(res.getContentText());
  if (!j.id_token) throw new Error(j.error_description || j.error || 'LINE ไม่ส่งข้อมูลตัวตน');
  // ให้ LINE ตรวจความถูกต้องของ id_token อีกชั้น
  const v = JSON.parse(UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: j.id_token, client_id: prop_('LINE_LOGIN_CHANNEL_ID') },
    muteHttpExceptions: true
  }).getContentText());
  if (!v.sub) throw new Error(v.error_description || 'ตรวจสอบ LINE ไม่ผ่าน');
  return { type: 'line', uid: 'l:' + v.sub, email: '', name: v.name || 'ผู้ใช้ LINE', lineUserId: v.sub };
}

/** หา/สร้างผู้ใช้ในชีต Users */
function upsertUser_(ident) {
  return withLock_(function () {
    const u = readAll_('USERS').filter(function (x) { return x.uid === ident.uid; })[0];
    const now = nowStr_();
    if (u) {
      update_('USERS', u._row, { lastLogin: now, displayName: ident.name });
      u.displayName = ident.name;
      return u;
    }
    const admins = prop_('ADMIN_EMAILS').toLowerCase().split(',').map(function (s) { return s.trim(); });
    const isAdmin = ident.email && admins.indexOf(ident.email) >= 0;
    const nu = {
      uid: ident.uid, type: ident.type, email: ident.email, lineUserId: ident.lineUserId,
      displayName: ident.name, role: isAdmin ? 'admin' : (ident.type === 'line' ? 'pcu' : 'pharmacy'),
      pcu: '', status: isAdmin ? 'active' : 'pending', createdAt: now, lastLogin: now
    };
    appendMany_('USERS', [nu]);
    audit_(nu, 'newUser', { type: nu.type });
    return nu;
  });
}

/** เชื่อม LINE เข้ากับบัญชี Google ของห้องยา (เพื่อรับแจ้งเตือน) */
function linkLine_(uid, ident) {
  if (ident.type !== 'line') return { error: 'เชื่อมบัญชีไม่สำเร็จ' };
  return withLock_(function () {
    const u = readAll_('USERS').filter(function (x) { return x.uid === uid; })[0];
    if (!u || u.status !== 'active') return { error: 'ไม่พบบัญชีที่ต้องการเชื่อม' };
    update_('USERS', u._row, { lineUserId: ident.lineUserId });
    audit_(u, 'linkLine', '');
    return { session: createSession_(u.uid), notice: 'linked' };
  });
}

/**
 * ===== Session แบบลงลายมือชื่อ (ไม่ต้องเก็บใน Cache จึงไม่หลุดเอง) =====
 * token = ข้อมูล(uid, เลขรุ่น, วันหมดอายุ) + ลายเซ็น HMAC ด้วยรหัสลับของระบบ
 * ใครแก้ข้อมูลใน token ลายเซ็นจะไม่ตรง ระบบจะปฏิเสธ
 */

/** รหัสลับสำหรับลงลายมือชื่อ (สร้างอัตโนมัติครั้งแรก เก็บใน Script Properties) */
function sessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let sec = props.getProperty('SESSION_SECRET');
  if (!sec) {
    sec = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', sec);
  }
  return sec;
}

/** ลายเซ็นของข้อความ */
function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, sessionSecret_()))
    .replace(/=+$/, '');
}

/** สร้าง token อายุ SESSION_DAYS วัน */
function createSession_(uid) {
  const u = readAll_('USERS').filter(function (x) { return x.uid === uid; })[0];
  const payload = { u: uid, v: String((u && u.tokenVer) || '0'), e: Date.now() + SESSION_DAYS * 86400000 };
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return body + '.' + sign_(body);
}

/** ถอดและตรวจ token คืนค่า payload หรือ null */
function readToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) return null;   // ลายเซ็นไม่ตรง = ถูกแก้ไข
  let body = parts[0];
  while (body.length % 4) body += '=';
  try {
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString('UTF-8'));
    return p.e > Date.now() ? p : null;                                 // หมดอายุ = null
  } catch (e) { return null; }
}

/** ตรวจ session และคืนข้อมูลผู้ใช้ — ใช้ในทุกคำสั่ง api() */
function requireUser_(token) {
  const p = readToken_(token);
  if (!p) throw new Error('SESSION_EXPIRED');
  const u = readAll_('USERS').filter(function (x) { return x.uid === p.u; })[0];
  // ผู้ใช้ถูกลบ/ปิดใช้งาน หรือกดออกจากระบบไปแล้ว (เลขรุ่นไม่ตรง) = ต้อง login ใหม่
  if (!u || u.status !== 'active' || String(u.tokenVer || '0') !== p.v) throw new Error('SESSION_EXPIRED');
  if (u.role === 'pcu' && !u.pcu) throw new Error('บัญชียังไม่ได้กำหนด รพ.สต. กรุณาติดต่อห้องยา');
  return u;
}

/** ออกจากระบบ: เพิ่มเลขรุ่น token ทำให้ token เดิมทุกเครื่องใช้ไม่ได้ */
function logout(token) {
  const p = readToken_(token);
  if (!p) return true;
  withLock_(function () {
    const u = readAll_('USERS').filter(function (x) { return x.uid === p.u; })[0];
    if (u && String(u.tokenVer || '0') === p.v) update_('USERS', u._row, { tokenVer: Number(u.tokenVer || 0) + 1 });
  });
  return true;
}
