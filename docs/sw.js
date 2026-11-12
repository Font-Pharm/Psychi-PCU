// Service worker ขั้นต่ำ: ทำให้ Android ติดตั้งเป็นแอปได้
// ไม่เก็บข้อมูลใด ๆ ไว้ในเครื่อง (ข้อมูลผู้ป่วยอยู่ในระบบ Apps Script เท่านั้น)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* ส่งต่อให้เครือข่ายตามปกติ */ });
