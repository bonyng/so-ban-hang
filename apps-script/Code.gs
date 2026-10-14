// Sổ bán vé số — API Google Apps Script
// Dữ liệu lưu trong Google Sheet gắn với script này. Web app (GitHub Pages) gọi vào doPost.
//
// Script Properties cần có:
//   APP_TOKEN       mã truy cập (hàm setup() tự tạo)
//   GEMINI_API_KEY  key Gemini cho phần Hỏi AI
//   GEMINI_MODEL    (tuỳ chọn) mặc định gemini-2.5-flash

const HEADERS = {
  KhachHang: ['ID', 'Ten', 'SDT', 'DiaChi', 'GhiChu', 'NgayTao'],
  GiaoDich: ['ID', 'Ngay', 'KhachID', 'TienHang', 'DaTra', 'GhiChu', 'TaoLuc'],
};

const RSS = {
  MB: 'https://xskt.com.vn/rss-feed/mien-bac-xsmb.rss',
  MT: 'https://xskt.com.vn/rss-feed/mien-trung-xsmt.rss',
  MN: 'https://xskt.com.vn/rss-feed/mien-nam-xsmn.rss',
};

const ACTIONS = {
  getData: () => getData(),
  saveCustomer: p => saveCustomer(p),
  addTransaction: p => addTransaction(p),
  deleteTransaction: p => deleteTransaction(p.id),
  getResults: p => getResults(p.region),
  chat: p => chat(p),
};

// Chạy một lần sau khi dán code: tạo sheet và mã truy cập (xem trong Nhật ký thực thi).
function setup() {
  Object.keys(HEADERS).forEach(getSheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_TOKEN')) {
    props.setProperty('APP_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  Logger.log('APP_TOKEN = ' + props.getProperty('APP_TOKEN'));
}

function doGet() {
  return json_({ ok: true, data: 'Sổ bán vé số API' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
    if (!token || req.token !== token) throw new Error('Sai mã truy cập');
    const fn = ACTIONS[req.action];
    if (!fn) throw new Error('Hành động không hợp lệ');
    return json_({ ok: true, data: fn(req.payload || {}) });
  } catch (err) {
    // Lỗi do mình viết đều bằng tiếng Việt có dấu; lỗi hệ thống của Google (tiếng Anh) thì ghi log và báo chung
    const vi = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(err.message);
    if (!vi) console.error(err);
    return json_({ ok: false, error: vi ? err.message : 'Máy chủ đang gặp lỗi, thử lại sau' });
  }
}

// ---------- Khách hàng & giao dịch ----------

function getData() {
  return {
    customers: rows_('KhachHang'),
    txs: rows_('GiaoDich'),
    today: today_(),
  };
}

function saveCustomer(c) {
  const ten = String(c.Ten || '').trim();
  if (!ten) throw new Error('Thiếu tên khách');
  return withLock_(() => {
    const sh = getSheet_('KhachHang');
    if (c.ID) {
      const row = findRow_(sh, c.ID);
      if (!row) throw new Error('Không tìm thấy khách');
      sh.getRange(row, 2, 1, 4).setValues([[ten, String(c.SDT || ''), c.DiaChi || '', c.GhiChu || '']]);
      return c.ID;
    }
    const id = 'KH' + Date.now();
    sh.appendRow([id, ten, String(c.SDT || ''), c.DiaChi || '', c.GhiChu || '', today_()]);
    return id;
  });
}

function addTransaction(t) {
  const tienHang = Number(t.TienHang) || 0;
  const daTra = Number(t.DaTra) || 0;
  if (!t.KhachID) throw new Error('Chưa chọn khách');
  if (tienHang < 0 || daTra < 0) throw new Error('Số tiền không được âm');
  if (tienHang === 0 && daTra === 0) throw new Error('Nhập số tiền bán hoặc thu');
  return withLock_(() => {
    const id = 'GD' + Date.now();
    getSheet_('GiaoDich').appendRow([
      id, t.Ngay || today_(), t.KhachID, tienHang, daTra, t.GhiChu || '', new Date(),
    ]);
    return id;
  });
}

function deleteTransaction(id) {
  return withLock_(() => {
    const sh = getSheet_('GiaoDich');
    const row = findRow_(sh, id);
    if (row) sh.deleteRow(row);
    return true;
  });
}

// ---------- Kết quả xổ số ----------

function getResults(region) {
  const url = RSS[region];
  if (!url) throw new Error('Miền không hợp lệ');
  const cache = CacheService.getScriptCache();
  const key = 'xs_' + region;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Không tải được kết quả, thử lại sau');
  const items = XmlService.parse(res.getContentText()).getRootElement()
    .getChild('channel').getChildren('item');
  const out = items.map(it => ({
    title: it.getChildText('title'),
    link: it.getChildText('link'),
    dais: parseDesc_(it.getChildText('description') || '', region),
  }));
  cache.put(key, JSON.stringify(out), 900); // 15 phút
  return out;
}

function parseDesc_(desc, region) {
  const dais = [];
  let cur = null;
  desc.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(line => {
    const dai = line.match(/^\[(.+)\]$/);
    if (dai) {
      cur = { name: dai[1].trim(), prizes: [] };
      dais.push(cur);
      return;
    }
    if (!cur) {
      cur = { name: region === 'MB' ? 'Miền Bắc' : '', prizes: [] };
      dais.push(cur);
    }
    // Feed miền Nam/Trung dính giải 7 và 8 trên một dòng, vd "7: 7458: 13"
    const g78 = line.match(/^7:\s*(\d{3})\s*8:\s*(\d{2})$/);
    if (g78) {
      cur.prizes.push({ g: '7', nums: [g78[1]] }, { g: '8', nums: [g78[2]] });
      return;
    }
    const p = line.match(/^(ĐB|\d):\s*(.+)$/);
    if (p) cur.prizes.push({ g: p[1], nums: p[2].split('-').map(s => s.trim()).filter(Boolean) });
  });
  return dais;
}

// ---------- Khung nhắn tin: Gemini hiểu câu ghi sổ hoặc trả lời câu hỏi ----------

const AI_RULES = [
  'Bạn là trợ lý sổ sách cho một người bán vé số kiến thiết có giấy phép. Người dùng nhắn tin ngắn, ít dấu câu, có thể viết không dấu.',
  'Phân loại tin nhắn và trả về JSON:',
  '- loai = "ghi_so" khi họ ghi một lần khách lấy vé và/hoặc trả tiền, vd "cô Ba lấy 50 trả 30", "anh Phúc trả 100".',
  '  ten_khach: tên khách đúng như trong sổ nếu chắc chắn là người đó, nếu không thì giữ nguyên cách họ viết.',
  '  tien_ve: tiền vé khách lấy, da_tra: tiền khách trả, đơn vị đồng. Không nhắc tới thì để 0.',
  '  Số người dùng gõ tính bằng NGHÌN ĐỒNG: "50" = 50000; "500" = 500000; "1500" = 1500000; "50k" = 50000.',
  '  "1tr" hoặc "1 triệu" = 1000000; "1tr2" = 1200000. Số có dấu chấm ngăn nghìn như "50.000" là số đồng đầy đủ = 50000.',
  '  "trả đủ" nghĩa là da_tra = tien_ve. "trả hết nợ" nghĩa là da_tra = số dư hiện tại của khách + tien_ve.',
  '- loai = "cau_hoi" khi họ hỏi về khách hàng, công nợ, doanh thu. Ghi câu trả lời vào tra_loi,',
  '  chỉ dựa trên DỮ LIỆU SỔ, tính cẩn thận.',
  '  Người đọc là người lớn tuổi: trả lời TỐI ĐA 3 DÒNG, câu thật ngắn, không giải thích dài, không chào hỏi.',
  '  Danh sách thì mỗi dòng một người, dạng "• Tên: số tiền", tối đa 5 người.',
  '  Dùng từ của sổ cửa hàng: "bán" (tiền hàng khách lấy), "thu" (tiền khách đưa), "còn nợ", "doanh thu". Không dùng chữ "vé".',
  '  Ghi số tiền dạng gọn: 500k (500.000đ), 1tr5 (1.500.000đ), 1tr25 (1.250.000đ), 2tr (2.000.000đ).',
  '  Số dư dương là khách còn thiếu, âm là khách trả dư. Không có trong sổ thì nói không có, không bịa.',
  '- loai = "khong_ro" cho mọi trường hợp khác, tra_loi chỉ một câu ngắn, vd "Nhắn kiểu: cô Ba lấy 50 trả 30".',
  'Từ chối mọi yêu cầu về lô đề, dự đoán, thống kê hay soi cầu số xổ số (loai = "khong_ro").',
].join('\n');

const CHAT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    loai: { type: 'STRING', format: 'enum', enum: ['ghi_so', 'cau_hoi', 'khong_ro'] },
    ten_khach: { type: 'STRING' },
    tien_ve: { type: 'NUMBER' },
    da_tra: { type: 'NUMBER' },
    tra_loi: { type: 'STRING' },
  },
  required: ['loai'],
};

function chat(p) {
  const text = String(p.text || '').trim();
  if (!text) throw new Error('Chưa nhập tin nhắn');

  const history = (p.history || []).slice(-6).map(h => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 1000) }],
  }));
  const body = {
    systemInstruction: { parts: [{ text: AI_RULES + '\n\n' + bookContext_() }] },
    contents: history.concat([{ role: 'user', parts: [{ text: text.slice(0, 500) }] }]),
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: CHAT_SCHEMA },
  };
  let r = gemini_(body);
  // Một số mô hình không nhận responseSchema: thử lại chỉ với yêu cầu trả JSON
  if (r.code === 400 && !isKeyError_(r.err)) {
    delete body.generationConfig.responseSchema;
    body.systemInstruction.parts[0].text += '\n\nChỉ trả về JSON với các trường: loai, ten_khach, tien_ve, da_tra, tra_loi.';
    r = gemini_(body);
  }
  if (r.code !== 200) throw new Error(geminiErrorText_(r));

  const parts = (r.json.candidates && r.json.candidates[0] && r.json.candidates[0].content && r.json.candidates[0].content.parts) || [];
  try {
    return JSON.parse(parts.map(x => x.text || '').join('').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch (_) {
    return { loai: 'khong_ro', tra_loi: 'Mình chưa hiểu. Thử nhắn kiểu: cô Ba lấy 50 trả 30' };
  }
}

function geminiKey_() {
  // Bỏ khoảng trắng hoặc dấu ngoặc lỡ dán kèm
  const key = String(PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '').trim().replace(/^["']+|["']+$/g, '');
  if (!key) throw new Error('Chưa cài khoá Gemini (GEMINI_API_KEY) trong Apps Script');
  return key;
}

// Mô hình: GEMINI_MODEL nếu bạn tự đặt, không thì mô hình app tự chọn lần trước
function currentModel_() {
  const props = PropertiesService.getScriptProperties();
  return (props.getProperty('GEMINI_MODEL') || props.getProperty('GEMINI_MODEL_AUTO') || 'gemini-2.5-flash').trim();
}

// Google ngừng mô hình cũ: lấy tên Google gợi ý trong lỗi, hoặc bản Flash mới nhất trong danh sách
function pickNewModel_(err) {
  const hint = String((err && err.message) || '').match(/use models\/([\w.-]+)/i);
  if (hint) return hint[1];
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  const ver = n => (n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  const names = (JSON.parse(res.getContentText()).models || [])
    .filter(x => (x.supportedGenerationMethods || []).includes('generateContent'))
    .map(x => x.name.replace(/^models\//, ''))
    .filter(n => /^gemini-[\d.]+-flash$/.test(n))
    .sort((a, b) => ver(b) - ver(a));
  return names[0] || null;
}

function gemini_(body) {
  let r = geminiOnce_(body, currentModel_());
  // Quá tải tạm thời (503/500): chờ chút rồi thử lại tối đa 2 lần
  for (let i = 1; i <= 2 && (r.code === 503 || r.code === 500); i++) {
    Utilities.sleep(2000 * i);
    r = geminiOnce_(body, r.model);
  }
  if (r.code === 404) {
    const next = pickNewModel_(r.err);
    if (next && next !== r.model) {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('GEMINI_MODEL_AUTO', next);
      if (props.getProperty('GEMINI_MODEL')) props.deleteProperty('GEMINI_MODEL'); // tên đặt tay đã hỏng
      console.log('Chuyển sang mô hình ' + next);
      r = geminiOnce_(body, next);
    }
  }
  return r;
}

function geminiOnce_(body, model) {
  const key = geminiKey_();
  const m = encodeURIComponent(model);
  // Khoá AI Studio ("AIza…" hoặc dạng mới "AQ.…") gọi máy chủ Gemini.
  // Khoá "AQ." cũng có thể là khoá Vertex AI tạo trong Google Cloud: bị từ chối thì thử máy chủ Vertex.
  const urls = ['https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent'];
  if (key.startsWith('AQ.')) urls.push('https://aiplatform.googleapis.com/v1/publishers/google/models/' + m + ':generateContent');
  let out;
  for (const url of urls) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    let json = {};
    try { json = JSON.parse(res.getContentText()); } catch (_) {}
    if (code !== 200) console.error('Gemini ' + code + ' (' + model + ', ' + url.split('/')[2] + '): ' + res.getContentText()); // xem trong Nhật ký thực thi
    out = { code, json, err: json.error || {}, model };
    if (code !== 401 && code !== 403) break;
  }
  return out;
}

function isKeyError_(err) {
  return /API key|API_KEY/i.test(JSON.stringify(err || {}));
}

// Đổi lỗi tiếng Anh của Gemini thành câu tiếng Việt nói rõ nguyên nhân
function geminiErrorText_(r) {
  const raw = JSON.stringify(r.err || {});
  if (isKeyError_(r.err)) return 'Khoá Gemini không đúng. Tạo khoá mới ở aistudio.google.com/apikey rồi dán lại vào GEMINI_API_KEY';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(raw)) return 'Dự án của khoá chưa bật Gemini API. Tạo khoá ở aistudio.google.com/apikey sẽ tự bật';
  if (/location is not supported|User location/i.test(raw)) return 'Gemini chưa hỗ trợ khu vực của máy chủ, thử đổi GEMINI_MODEL';
  if (r.code === 403) return 'Khoá Gemini chưa có quyền. Nếu vừa bật Gemini API thì chờ 5 phút rồi thử lại; vẫn lỗi thì tạo khoá mới ở aistudio.google.com/apikey';
  if (r.code === 404) return 'Không tìm được mô hình Gemini dùng được (đang thử "' + r.model + '"). Đặt GEMINI_MODEL theo tên Google gợi ý trong Nhật ký thực thi';
  if (r.code === 429) return 'Trợ lý đang quá tải hoặc hết lượt miễn phí, thử lại sau ít phút';
  if (r.code === 503 || r.code === 500) return 'Trợ lý Gemini đang quá tải, thử lại sau ít phút. Câu ghi sổ đơn giản (vd: cô Ba lấy 50 trả 30) vẫn ghi được bình thường';
  return 'Gemini báo lỗi (mã ' + r.code + '). Mở Apps Script, chạy hàm testGemini để xem chi tiết';
}

// Chạy trong trình soạn Apps Script để kiểm tra khoá Gemini; kết quả hiện trong Nhật ký thực thi
function testGemini() {
  const key = geminiKey_();
  Logger.log('Khoá dài ' + key.length + ' ký tự, bắt đầu bằng "' + key.slice(0, 4) + '" → '
    + (key.startsWith('AQ.') || key.startsWith('AIza') ? 'đúng dạng khoá Google' : 'không giống khoá Google, kiểm tra lại'));
  const r = gemini_({ contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng một chữ: OK' }] }] });
  if (r.code === 200) Logger.log('✅ Gemini chạy tốt với mô hình ' + r.model);
  else Logger.log('❌ ' + geminiErrorText_(r) + '\nChi tiết: ' + JSON.stringify(r.err));
}

// Tóm tắt sổ thành văn bản gửi kèm câu hỏi. Tính sẵn số dư để AI không phải cộng tay.
function bookContext_() {
  const d = getData();
  const names = {};
  const stat = {};
  d.customers.forEach(c => {
    names[c.ID] = c.Ten;
    stat[c.ID] = { hang: 0, tra: 0, last: '' };
  });
  d.txs.forEach(t => {
    const s = stat[t.KhachID] || (stat[t.KhachID] = { hang: 0, tra: 0, last: '' });
    s.hang += Number(t.TienHang) || 0;
    s.tra += Number(t.DaTra) || 0;
    if (t.Ngay > s.last) s.last = t.Ngay;
  });

  const since = new Date();
  since.setDate(since.getDate() - 180);
  const sinceStr = Utilities.formatDate(since, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const recent = d.txs.filter(t => t.Ngay >= sinceStr).slice(-3000);

  return [
    'DỮ LIỆU SỔ',
    'Hôm nay: ' + d.today,
    '',
    // Không gửi SĐT, địa chỉ cho Gemini — trả lời sổ sách không cần tới
    'KHÁCH HÀNG (Tên | Số dư | Tổng tiền vé | Tổng đã trả | Giao dịch gần nhất)',
  ].concat(d.customers.map(c => {
    const s = stat[c.ID];
    return [c.Ten, s.hang - s.tra, s.hang, s.tra, s.last || '-'].join(' | ');
  })).concat([
    '',
    'GIAO DỊCH 180 NGÀY GẦN NHẤT (Ngày | Khách | Tiền vé | Đã trả | Ghi chú)',
  ]).concat(recent.map(t =>
    [t.Ngay, names[t.KhachID] || '(đã xoá)', t.TienHang, t.DaTra, t.GhiChu].join(' | ')
  )).join('\n');
}

// ---------- Tiện ích ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
    // Giữ ngày và SĐT ở dạng chữ để không bị Sheets tự đổi định dạng
    if (name === 'GiaoDich') sh.getRange('B:B').setNumberFormat('@');
    if (name === 'KhachHang') sh.getRange('C:C').setNumberFormat('@');
  }
  return sh;
}

function rows_(name) {
  const values = getSheet_(name).getDataRange().getValues();
  const head = values.shift();
  const tz = Session.getScriptTimeZone();
  return values.filter(r => r[0] !== '').map(r => {
    const o = {};
    head.forEach((k, i) => {
      const v = r[i];
      o[k] = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v;
    });
    return o;
  });
}

function findRow_(sh, id) {
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (ids[i][0] === id) return i + 1;
  return 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
