// Replace the old Code.gs in the existing project. Keep its checkVouchers trigger.
const VOUCHER_WORKER = 'https://shopee-website-vouchers.vantunggit26.workers.dev';
const CONNECTION_PROPERTY = 'ACCOUNT_VAULT_ALERT_CODE';

function readVoucherJson_(path, token) {
  const response = UrlFetchApp.fetch(VOUCHER_WORKER + path, {
    followRedirects: false,
    muteHttpExceptions: true,
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const status = response.getResponseCode();
  if (status === 401 && token) {
    throw new Error('Mã kết nối chưa có hiệu lực hoặc đã được cấp lại. Kiểm tra Cài đặt dự án.');
  }
  if (status !== 200) throw new Error('Cloudflare trả mã HTTP ' + status);
  return JSON.parse(response.getContentText());
}

function loadVoucherSettings_(props) {
  const token = (props.getProperty(CONNECTION_PROPERTY) || '').trim();
  if (!token) throw new Error('Thêm ACCOUNT_VAULT_ALERT_CODE trong Cài đặt dự án.');
  const settings = readVoucherJson_('/voucher-alerts/runner', token).settings;
  if (!settings || !Array.isArray(settings.emails) || !settings.emails.length
    || !settings.keyword || !Number.isFinite(settings.startsAt)) {
    throw new Error('Chưa đọc được cấu hình thông báo.');
  }
  return settings;
}

function installAlerts() {
  verifyAlertConnection();
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'checkVouchers')) {
    ScriptApp.newTrigger('checkVouchers').timeBased().everyMinutes(5).create();
  }
}

function verifyAlertConnection() {
  loadVoucherSettings_(PropertiesService.getScriptProperties());
  const data = readVoucherJson_('/vouchers');
  if (!Array.isArray(data.feed)) throw new Error('Chưa đọc được Tin ưu đãi.');
  console.log('Đã kết nối Account Vault và đọc được Tin ưu đãi.');
}

function sendTestEmail() {
  const settings = loadVoucherSettings_(PropertiesService.getScriptProperties());
  for (const email of settings.emails) {
    MailApp.sendEmail(email, '[Account Vault] Gửi thử',
      'Apps Script đã đọc được cấu hình thông báo từ Account Vault.');
  }
}

function checkVouchers() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const settings = loadVoucherSettings_(props);
    if (!settings.enabled) return;
    const data = readVoucherJson_('/vouchers');
    if (!Array.isArray(data.feed)) throw new Error('Chưa đọc được Tin ưu đãi.');
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    const keyword = normalize(settings.keyword);
    const matched = data.feed.filter(item => item.id && item.publishedAt >= settings.startsAt
      && normalize(item.title).includes(keyword));

    const now = Math.floor(Date.now() / 1000);
    const sent = props.getProperties();
    for (const [key, createdAt] of Object.entries(sent)) {
      if (key.startsWith('sent:') && now - Number(createdAt) > 6 * 86400) props.deleteProperty(key);
    }
    const sentKey = (email, item) => `sent:${email}:${item.id}`;
    for (const email of settings.emails) {
      const pending = matched.filter(item => !sent[sentKey(email, item)]).slice(0, 20);
      if (!pending.length) continue;
      if (MailApp.getRemainingDailyQuota() < 1) return;
      const lines = pending.map(item => {
        const link = (item.links || []).find(url => /^https:\/\//i.test(url));
        return [item.title, link].filter(Boolean).join('\n');
      });
      MailApp.sendEmail(email, `[Account Vault] ${pending.length} tin khớp: ${settings.keyword}`, lines.join('\n\n'));
      props.setProperties(Object.fromEntries(pending.map(item => [sentKey(email, item), String(now)])));
    }
  } finally {
    lock.releaseLock();
  }
}

// Manual test only: use the full available feed without changing the scheduled job's state.
function sendLatestVoucherTest() {
  const settings = loadVoucherSettings_(PropertiesService.getScriptProperties());
  const { feed } = readVoucherJson_('/vouchers');
  if (!Array.isArray(feed)) throw new Error('Chưa đọc được Tin ưu đãi.');

  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const keyword = normalize(settings.keyword);
  let latest;
  for (const item of feed) {
    if (item?.id && Number.isFinite(item.publishedAt) && normalize(item.title).includes(keyword)
      && (!latest || item.publishedAt > latest.publishedAt)) latest = item;
  }
  if (!latest) {
    console.log(`Không tìm thấy tin chứa “${settings.keyword}”. Không gửi email.`);
    return;
  }
  if (MailApp.getRemainingDailyQuota() < settings.emails.length) {
    throw new Error('Hạn mức gửi email còn lại không đủ cho danh sách Gmail đã lưu.');
  }

  const links = (latest.links || []).filter(url => /^https:\/\//i.test(url));
  const body = ['Đây là email gửi thử với tin khớp gần nhất:', '', latest.title, ...links].join('\n');
  for (const email of settings.emails) {
    MailApp.sendEmail(email, `[Account Vault] Gửi thử: ${settings.keyword}`, body);
  }
  console.log(`Đã gửi thử tin mới nhất tới ${settings.emails.length} địa chỉ Gmail.`);
}
