// Sổ bán vé số — PWA. Dữ liệu ở Google Sheet qua Apps Script API.

let DATA = { customers: [], txs: [], today: '' };
let OFFLINE = false;
let CHAT = [];
let reportRange = 'week';
let region = 'MN', resultIdx = 0;
const RESULTS = {};

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moneyFull = n => (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
// Hiện gọn giống cách gõ: 500k, 1tr5 (1.500.000), 1tr25 (1.250.000), 1tr05 (1.050.000), 2tr
function money(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 1e6) return sign + (n / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'k';
  const tr = Math.floor(n / 1e6);
  const rest = String(Math.round((n % 1e6) / 1000)).padStart(3, '0').replace(/0+$/, '');
  return sign + tr.toLocaleString('vi-VN') + 'tr' + rest;
}
const fmtDate = d => d ? d.split('-').reverse().join('/') : '';
const shortDate = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
const isoOf = x => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const localToday = () => isoOf(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Bỏ dấu, viết thường để so khớp tên và câu nhắn không dấu
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9.,\s]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Lưu cục bộ (có thể bị chặn ở chế độ ẩn danh) ----------
function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) { return null; }
}
const getCfg = () => store('svs_cfg') || {};

// ---------- Gọi API ----------
// Không đặt header để fetch là "simple request", tránh preflight CORS với Apps Script.
async function api(action, payload) {
  const cfg = getCfg();
  if (!cfg.url || !cfg.token) throw new Error('Chưa cài đặt kết nối');
  const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ token: cfg.token, action, payload }) });
  let j;
  try { j = await res.json(); } catch (_) { throw new Error('Phản hồi không hợp lệ, kiểm tra lại đường dẫn kết nối'); }
  if (!j.ok) throw new Error(j.error || 'Có lỗi xảy ra');
  return j.data;
}
// Lỗi mạng của fetch là TypeError với câu tiếng Anh khác nhau theo trình duyệt
const errText = (e, net) => e instanceof TypeError ? net : e.message;
async function call(action, payload) {
  try { return await api(action, payload); }
  catch (e) { toast(errText(e, 'Không có mạng')); throw e; }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 2600);
}

async function reload() {
  try {
    DATA = await api('getData');
    OFFLINE = false;
    store('svs_data', { data: DATA, at: new Date().toISOString() });
    $('#offline').hidden = true;
  } catch (e) {
    const cached = store('svs_data');
    if (!cached) throw e;
    DATA = cached.data;
    DATA.today = localToday();
    OFFLINE = true;
    const b = $('#offline');
    b.textContent = 'Mất kết nối, đang xem sổ lưu lúc ' + new Date(cached.at).toLocaleString('vi-VN');
    b.hidden = false;
  }
  applyQueue();
}

// ---------- Lưu tạm trên máy khi mất mạng, tự gửi khi có mạng ----------
// Mỗi phần tử: { qid, KhachID, newName, tmpCust, Ngay, TienHang, DaTra, GhiChu }.
// Khách mới tạo lúc mất mạng có mã tạm "TMP…", được đổi sang mã thật khi gửi.
let QUEUE = store('svs_queue') || [];
const saveQueue = () => store('svs_queue', QUEUE);

// Thêm các lần ghi đang chờ vào sổ đang xem để số nợ cập nhật ngay
function applyQueue() {
  QUEUE.forEach(q => {
    if (q.newName && !DATA.customers.some(c => c.ID === q.tmpCust)) {
      DATA.customers.push({ ID: q.tmpCust, Ten: q.newName, SDT: '', DiaChi: '', GhiChu: '', pending: true });
    }
    if (!DATA.txs.some(t => t.ID === q.qid)) {
      DATA.txs.push({ ID: q.qid, Ngay: q.Ngay, KhachID: q.KhachID || q.tmpCust, TienHang: q.TienHang, DaTra: q.DaTra, GhiChu: q.GhiChu, pending: true });
    }
  });
  // Chỉ nhắc khi thật sự đang mất mạng; lúc bình thường lần ghi gửi xong trong vài giây
  const b = $('#queue');
  b.hidden = !QUEUE.length || !(OFFLINE || NET_DOWN);
  b.textContent = `🕓 ${QUEUE.length} lần ghi đang lưu trên máy, sẽ tự gửi khi có mạng`;
}

function enqueue(d) {
  const qid = 'Q' + uid();
  const isNew = !d.khachId;
  QUEUE.push({
    qid, KhachID: isNew ? null : d.khachId, newName: isNew ? d.newName : null, tmpCust: isNew ? 'TMP' + qid : null,
    Ngay: d.ngay, TienHang: d.tienHang, DaTra: d.daTra, GhiChu: d.ghiChu,
  });
  if (isNew) d.khachId = 'TMP' + qid;
  saveQueue();
  applyQueue();
  return qid;
}

function removeQueued(qid) {
  const i = QUEUE.findIndex(q => q.qid === qid);
  if (i < 0) return;
  const [q] = QUEUE.splice(i, 1);
  if (q.newName) {
    // Lần ghi khác của cùng khách mới sẽ đảm nhận việc tạo khách
    const next = QUEUE.find(x => x.KhachID === q.tmpCust);
    if (next) { next.newName = q.newName; next.tmpCust = q.tmpCust; }
    else DATA.customers = DATA.customers.filter(c => c.ID !== q.tmpCust);
  }
  DATA.txs = DATA.txs.filter(t => t.ID !== qid);
  saveQueue();
  applyQueue();
}

let NET_DOWN = false; // lần gửi gần nhất bị mất mạng
async function flushQueue() {
  if (!QUEUE.length || flushQueue.busy || !getCfg().url) return;
  flushQueue.busy = true;
  const wasDown = NET_DOWN || OFFLINE;
  let sent = 0;
  try {
    while (QUEUE.length) {
      const q = QUEUE[0];
      if (q.newName) {
        const real = await api('saveCustomer', { Ten: q.newName });
        QUEUE.forEach(x => { if (x.KhachID === q.tmpCust) x.KhachID = real; });
        CHAT.forEach(m => { if (m.draft && m.draft.khachId === q.tmpCust) m.draft.khachId = real; });
        q.KhachID = real; q.newName = null;
        saveQueue();
      }
      const txId = await api('addTransaction', { KhachID: q.KhachID, Ngay: q.Ngay, TienHang: q.TienHang, DaTra: q.DaTra, GhiChu: q.GhiChu });
      const i = QUEUE.findIndex(x => x.qid === q.qid);
      if (i < 0) {
        // Người dùng bấm Hoàn tác trong lúc đang gửi: xoá luôn dòng vừa lên Sheet
        await api('deleteTransaction', { id: txId });
      } else {
        CHAT.forEach(m => { if (m.txId === q.qid) { m.txId = txId; m.queued = false; } });
        QUEUE.splice(i, 1);
      }
      saveQueue();
      sent++;
    }
    NET_DOWN = false;
  } catch (e) {
    // Mất mạng thì để lần sau; lỗi khác thì báo để người dùng hoàn tác dòng đó
    if (e instanceof TypeError) NET_DOWN = true;
    else toast('Chưa gửi được 1 lần ghi: ' + e.message);
    applyQueue();
    renderChat();
  }
  flushQueue.busy = false;
  if (sent) {
    await reload().catch(() => {});
    saveChat();
    if (wasDown) toast(`Có mạng lại, đã gửi ${sent} lần ghi sổ`);
    refresh();
  }
}
window.addEventListener('online', () => flushQueue());
document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
setInterval(() => { if (QUEUE.length) flushQueue(); }, 30000);
function needOnline() {
  if (OFFLINE) { toast('Đang mất mạng, chưa ghi được'); return false; }
  return true;
}

// ---------- Số liệu ----------
// Số dư: dương = khách còn thiếu, âm = khách trả dư
function balances() {
  const b = {};
  DATA.txs.forEach(t => { b[t.KhachID] = (b[t.KhachID] || 0) + (Number(t.TienHang) || 0) - (Number(t.DaTra) || 0); });
  return b;
}
function balText(v) {
  if (v > 0) return `<span class="debt">Còn nợ ${money(v)}</span>`;
  if (v < 0) return `<span class="credit">Dư ${money(-v)}</span>`;
  return '<span class="muted">Hết nợ</span>';
}
const debtors = () => { const b = balances(); return DATA.customers.filter(c => b[c.ID] > 0).map(c => [c, b[c.ID]]).sort((a, z) => z[1] - a[1]); };
const totalDebt = () => debtors().reduce((a, [, v]) => a + v, 0);
const custById = id => DATA.customers.find(c => c.ID === id);
function sumRange(from, to) {
  const txs = DATA.txs.filter(t => t.Ngay >= from && t.Ngay <= to);
  return {
    txs,
    hang: txs.reduce((a, t) => a + (Number(t.TienHang) || 0), 0),
    tra: txs.reduce((a, t) => a + (Number(t.DaTra) || 0), 0),
    khach: new Set(txs.map(t => t.KhachID)).size,
  };
}
function weekRange(today) {
  const d = new Date(today + 'T00:00:00');
  const back = (d.getDay() + 6) % 7; // thứ Hai đầu tuần
  const from = addDays(today, -back);
  return [from, addDays(from, 6)];
}

// ---------- Hiểu số tiền gõ gọn ----------
// Đơn vị nhập là nghìn đồng: "500" = 500.000đ, "1500" = 1.500.000đ, "50k" = 50.000đ,
// "1tr2" = 1.200.000đ, "1,5tr" = 1.500.000đ. Có dấu chấm ngăn nghìn ("50.000") thì hiểu là số đồng đầy đủ.
function parseMoney(s) {
  s = norm(s).replace(/\s+/g, '').replace(/[.,]+$/, '');
  let m = s.match(/^(\d+)(?:[.,](\d+))?(?:tr|trieu|cu)(\d{1,3})?$/);
  if (m) {
    let v = parseFloat(m[1] + '.' + (m[2] || '0')) * 1e6;
    if (m[3]) v += Number(m[3].padEnd(3, '0')) * 1000;
    return Math.round(v);
  }
  m = s.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:k|nghin|ngan|n)?$/);
  if (m) {
    const v = Number(m[1].replace(/\./g, ''));
    return m[1].includes('.') ? v : v * 1000;
  }
  return null;
}

const KW_LAY = ['lay', 'mua'];
const KW_TRA = ['tra', 'dua', 'gui', 'chuyen', 'ck'];
const FILLER = new Set(['nha', 'nhe', 'nhen', 'roi', 'a', 'ha', 'tien', 'dong', 'd', 'hom', 'qua', 'nay', 've', 'cho', 'them', 'luon', 'no']);

// Câu ghi sổ đơn giản: "<tên> lấy <số> trả <số>". Không chắc thì trả null để hỏi Gemini.
function parseEntry(text) {
  const words = text.trim().split(/\s+/);
  const nw = words.map(norm);
  // Kiểu nhắn ngắn: "Bình 50 nợ" / "Bình nợ 50" = bán 50k chưa thu
  const n = nw.length;
  const isNo = w => w === 'no' || w === 'thieu';
  const hasKw = ws => ws.some(w => KW_LAY.includes(w) || KW_TRA.includes(w));
  if (n >= 3 && !hasKw(nw)) {
    if (isNo(nw[n - 1]) && parseMoney(nw[n - 2]) != null) {
      return { name: words.slice(0, n - 2).join(' '), tienHang: parseMoney(nw[n - 2]), daTra: 0, payAll: false, payFull: false };
    }
    if (isNo(nw[n - 2]) && parseMoney(nw[n - 1]) != null) {
      return { name: words.slice(0, n - 2).join(' '), tienHang: parseMoney(nw[n - 1]), daTra: 0, payAll: false, payFull: false };
    }
  }
  const first = nw.findIndex(w => KW_LAY.includes(w) || KW_TRA.includes(w));
  if (first <= 0) return null;
  const out = { name: words.slice(0, first).join(' '), tienHang: 0, daTra: 0, payAll: false, payFull: false };
  const seen = {};
  let key = null, buf = [];
  const flush = () => {
    if (!key) return true;
    const toks = buf.filter(w => !FILLER.has(w));
    if (key === 'tra' && toks.length === 1 && (toks[0] === 'du' || toks[0] === 'het')) {
      out[toks[0] === 'du' ? 'payFull' : 'payAll'] = true;
      return true;
    }
    const v = parseMoney(toks.join(''));
    if (v == null) return false;
    out[key === 'lay' ? 'tienHang' : 'daTra'] = v;
    return true;
  };
  for (let i = first; i < nw.length; i++) {
    const w = nw[i];
    const k = KW_LAY.includes(w) ? 'lay' : KW_TRA.includes(w) ? 'tra' : null;
    if (k) {
      if (!flush() || seen[k]) return null;
      seen[k] = true; key = k; buf = [];
    } else buf.push(w);
  }
  if (!flush()) return null;
  if (out.payFull) out.daTra = out.tienHang;
  if (!out.tienHang && !out.daTra && !out.payAll) return null;
  return out;
}

// Tìm khách theo tên đã nhắn. Trả về { id } nếu chắc chắn, hoặc { cands } để người dùng chọn.
const HON = new Set(['co', 'chu', 'chi', 'anh', 'ba', 'ong', 'em', 'bac', 'di', 'cau', 'mo', 'thim', 'be']);
function resolveCustomer(raw) {
  const r = norm(raw).split(' ').filter(Boolean);
  const scored = DATA.customers.map(c => {
    const ct = norm(c.Ten).split(' ');
    const hit = r.filter(x => ct.includes(x));
    const score = hit.reduce((a, x) => a + (HON.has(x) ? 0.3 : 1), 0);
    return { c, full: hit.length === r.length, score };
  });
  const full = scored.filter(s => s.full);
  if (full.length === 1) return { id: full[0].c.ID };
  const pool = full.length ? full : scored.filter(s => s.score >= 1);
  return { cands: pool.sort((a, b) => b.score - a.score).slice(0, 4).map(s => s.c.ID) };
}

// ---------- Khung trang ----------
function setHeader(title, opts = {}) {
  $('#title').textContent = title;
  const back = $('#backBtn');
  back.hidden = !opts.back;
  back.onclick = opts.back || null;
  const box = $('#hdrActions');
  box.innerHTML = '';
  (opts.actions || []).forEach(a => {
    const b = document.createElement('button');
    b.className = 'hdr-btn'; b.textContent = a.text; b.onclick = a.fn;
    if (a.label) b.setAttribute('aria-label', a.label);
    box.appendChild(b);
  });
}
let CURRENT = ['chat'];
// Vẽ lại màn hình đang xem sau khi sổ thay đổi ngầm (không làm mất ô đang gõ)
function refresh() {
  const [tab, arg] = CURRENT;
  if (tab === 'chat') renderChat();
  else if (tab === 'customers' || tab === 'customer' || tab === 'report') go(tab, arg);
}
function go(tab, arg) {
  CURRENT = [tab, arg];
  const navTab = { customer: 'customers', report: 'customers', customerForm: 'customers', settings: '' }[tab] ?? tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === navTab));
  document.body.classList.toggle('chat-mode', tab === 'chat');
  window.scrollTo(0, 0);
  ({
    chat: viewChat, customers: viewCustomers, customer: viewCustomer, customerForm: viewCustomerForm,
    report: viewReport, results: viewResults, settings: viewSettings,
  })[tab](arg);
}
const settingsBtn = { text: '⚙', label: 'Cài đặt', fn: () => go('settings') };

// ---------- Ghi sổ (khung nhắn tin) ----------
const CHIPS = ['✏️ Ghi tay', 'Ai đang nợ?', 'Hôm nay bán bao nhiêu?', 'Tổng kết tuần', 'Cách ghi sổ'];
const HELP = 'Nhắn kiểu:\n• cô Ba lấy 50 trả 30\n• Bình 50 nợ\n• anh Phúc trả 100\n(50 là 50 nghìn)';

function saveChat() { store('svs_chat', CHAT.slice(-60)); }
function botSay(text, extra = {}) { CHAT.push({ id: uid(), role: 'bot', kind: 'text', text, ...extra }); }

function fmtText(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^\s*[*-]\s+/gm, '• ');
}

function viewChat(prefill) {
  setHeader('Ghi sổ', { actions: [settingsBtn] });
  if (!CHAT.length) botSay('Chào bạn 👋\n' + HELP);
  $('#view').innerHTML = `
    <div class="chat" id="chat"></div>
    <div class="chatbar">
      <div class="chips">${CHIPS.map(c => `<button type="button" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <form class="ask" id="askForm">
        <input id="askQ" placeholder="Nhắn để ghi sổ…" autocomplete="off" enterkeyhint="send">
        <button aria-label="Gửi">➤</button>
      </form>
    </div>
    <datalist id="custNames">${DATA.customers.map(c => `<option value="${esc(c.Ten)}">`).join('')}</datalist>`;
  renderChat();
  $('#chat').onclick = onChatClick;
  document.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => {
    if (b.dataset.chip === '✏️ Ghi tay') { manualCard(''); renderChat(); }
    else send(b.dataset.chip);
  });
  $('#askForm').onsubmit = e => { e.preventDefault(); const q = $('#askQ'); send(q.value); q.value = ''; };
  // Bấm gửi không làm đóng bàn phím, để nhắn tiếp như Zalo
  $('#askForm button').addEventListener('mousedown', e => e.preventDefault());
  $('#askForm button').addEventListener('touchstart', e => { e.preventDefault(); $('#askForm').requestSubmit(); }, { passive: false });
  if (prefill) { const q = $('#askQ'); q.value = prefill; q.focus(); }
}

function renderChat() {
  const box = $('#chat');
  if (!box) return;
  box.innerHTML = CHAT.map(msgHTML).join('');
  saveChat();
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

// "Bán 50k · Thu 30k", bỏ phần bằng 0
const flowText = (ban, thu) => [ban ? `Bán <b>${money(ban)}</b>` : '', thu ? `Thu <b>${money(thu)}</b>` : ''].filter(Boolean).join(' · ');
function dayLabel(d) {
  if (d === DATA.today) return 'Hôm nay';
  if (d === addDays(DATA.today, -1)) return 'Hôm qua';
  return shortDate(d);
}

// Thẻ ghi sổ gọn kiểu tin nhắn Zalo: avatar + tên + 1 dòng số tiền + nút
function draftHTML(m) {
  const d = m.draft;
  const c = custById(d.khachId) || { ID: '', Ten: d.newName || d.rawName };
  const head = (line) => `<div class="cm-head">${avatar(c, 'sm')}
    <div class="cm-main"><div class="cm-name">${esc(c.Ten)}</div><div class="cm-line">${line}</div></div>
    <span class="cm-date">${dayLabel(d.ngay)}</span></div>`;
  if (m.status === 'cancelled') return `<div class="msg bot muted">Đã huỷ, không ghi sổ.</div>`;
  if (m.status === 'saved') {
    const now = balances()[d.khachId] || 0;
    return `<div class="msg bot cm">${head(flowText(d.tienHang, d.daTra))}
      <div class="cm-foot">${m.undone ? '<span class="muted">↩️ Đã hoàn tác</span>'
        : `<span>${m.queued && (OFFLINE || NET_DOWN) ? '<span class="wait">🕓 Lưu trên máy</span>' : '<span class="done">✓ Đã ghi</span>'} · ${balText(now)}</span><button class="undo" data-act="undo" data-id="${m.id}">Hoàn tác</button>`}</div></div>`;
  }
  if (m.editing) {
    return `<div class="msg bot cm">${head('Sửa số tiền (nghìn đồng)')}
      <div class="cm-edit">
        <label for="eH${m.id}">Bán</label><input id="eH${m.id}" inputmode="decimal" value="${d.tienHang ? d.tienHang / 1000 : ''}" placeholder="0">
        <label for="eT${m.id}">Thu</label><input id="eT${m.id}" inputmode="decimal" value="${d.daTra ? d.daTra / 1000 : ''}" placeholder="0">
      </div>
      <div class="cm-actions"><button class="b-ok" data-act="editok" data-id="${m.id}">Xong</button></div></div>`;
  }
  const before = (d.khachId && balances()[d.khachId]) || 0;
  return `<div class="msg bot cm">${head(flowText(d.tienHang, d.daTra) || 'Chưa có số tiền')}
    <div class="cm-foot">${d.newName ? '<span class="tag">Khách mới</span> ' : ''}<span>Sau khi ghi: ${balText(before + d.tienHang - d.daTra)}</span></div>
    <div class="cm-actions">
      <button class="b-ok" data-act="save" data-id="${m.id}">✅ Ghi sổ</button>
      <button class="b-ghost" data-act="edit" data-id="${m.id}">Sửa</button>
      <button class="b-ghost" data-act="cancel" data-id="${m.id}">Huỷ</button>
    </div></div>`;
}

function msgHTML(m) {
  if (m.role === 'me') return `<div class="msg me">${esc(m.text)}</div>`;
  if (m.kind === 'draft') return draftHTML(m);
  if (m.kind === 'pick') {
    if (m.status === 'done') return `<div class="msg bot muted">Đã chọn khách.</div>`;
    const b = balances();
    return `<div class="msg bot wide">Chưa thấy <b>${esc(m.draft.rawName)}</b> trong sổ.${m.cands.length ? ' Có phải là:' : ''}
      ${m.cands.map(id => { const c = custById(id); return c ? `<button class="opt" data-act="pick" data-id="${m.id}" data-arg="${id}">${esc(c.Ten)} <span class="muted">· ${b[id] > 0 ? 'nợ ' + money(b[id]) : 'hết nợ'}</span></button>` : ''; }).join('')}
      <button class="opt new" data-act="new" data-id="${m.id}">➕ Khách mới: ${esc(m.draft.rawName)}</button></div>`;
  }
  if (m.kind === 'thinking') return `<div class="msg bot muted">Đang xem sổ…</div>`;
  if (m.kind === 'manual') return manualHTML(m);
  return `<div class="msg bot">${fmtText(m.text)}${m.go ? `<button class="btn soft" data-go="${m.go}">${esc(m.goLabel)}</button>` : ''}</div>`;
}

// Đưa một bản nháp ghi sổ vào khung chat (hỏi chọn khách nếu chưa chắc)
function proposeEntry(rawName, e, ngay, note) {
  const draft = { rawName, khachId: null, newName: null, tienHang: e.tienHang || 0, daTra: e.daTra || 0, payAll: !!e.payAll, ngay, ghiChu: note };
  const r = resolveCustomer(rawName);
  if (r.id) { setCustomer(draft, r.id); CHAT.push({ id: uid(), role: 'bot', kind: 'draft', draft }); }
  else CHAT.push({ id: uid(), role: 'bot', kind: 'pick', draft, cands: r.cands });
}
function setCustomer(draft, id) {
  draft.khachId = id;
  if (draft.payAll) draft.daTra = Math.max(0, (balances()[id] || 0) + draft.tienHang);
}

function quickAnswer(t) {
  if (/ket qua|xo so|do ve/.test(t)) return botSay('Kết quả xổ số ba miền ở tab Kết quả.', { go: 'results', goLabel: '🎫 Xem kết quả' }), true;
  if (/tong ket/.test(t)) return botSay(weekSummary(), { go: 'report', goLabel: '📊 Xem báo cáo' }), true;
  if (/huong dan|cach ghi|giup/.test(t)) return botSay(HELP), true;
  if (/\b(ai|khach nao)\b.*\b(no|thieu)\b|\bdang no\b/.test(t)) {
    const list = debtors();
    botSay(list.length
      ? `Có ${list.length} khách đang nợ, tổng **${money(totalDebt())}**:\n` + list.slice(0, 10).map(([c, v]) => `• ${c.Ten}: ${money(v)}`).join('\n')
      : 'Hiện không có khách nào nợ 👍');
    return true;
  }
  if (/hom nay/.test(t) && /ban|thu|doanh/.test(t)) {
    const s = sumRange(DATA.today, DATA.today);
    botSay(`Hôm nay (${fmtDate(DATA.today)}):\n• Doanh thu: **${money(s.hang)}**\n• Đã thu: **${money(s.tra)}**\n• Số khách: ${s.khach}`);
    return true;
  }
  return false;
}

async function send(text) {
  text = String(text || '').trim();
  if (!text || send.busy) return;
  const history = CHAT.filter(m => m.kind === 'text' || m.role === 'me').slice(-6)
    .map(m => ({ role: m.role === 'me' ? 'user' : 'model', text: m.text }));
  CHAT.push({ id: uid(), role: 'me', text });
  const t = norm(text);
  const ngay = /hom qua/.test(t) ? addDays(DATA.today, -1) : DATA.today;

  const e = parseEntry(text);
  if (e) { proposeEntry(e.name, e, ngay, text); return renderChat(); }
  if (quickAnswer(t)) return renderChat();
  // Câu có vẻ là ghi sổ: AI không giúp được thì mở thẻ ghi tay để vẫn lưu được
  const looksLikeEntry = /\d|\b(lay|mua|tra|dua|gui|no)\b/.test(t);
  if (OFFLINE) {
    if (looksLikeEntry) manualCard('Mất mạng, điền tay nhé:', text, ngay);
    else botSay('Mất mạng. Nhắn kiểu: cô Ba lấy 50 trả 30');
    return renderChat();
  }

  send.busy = true;
  const wait = { id: uid(), role: 'bot', kind: 'thinking' };
  CHAT.push(wait); renderChat();
  try {
    const r = await api('chat', { text, history });
    CHAT.splice(CHAT.indexOf(wait), 1);
    if (r.loai === 'ghi_so' && r.ten_khach && (r.tien_ve || r.da_tra)) {
      proposeEntry(r.ten_khach, { tienHang: Math.round(r.tien_ve || 0), daTra: Math.round(r.da_tra || 0) }, ngay, text);
    } else if (r.loai !== 'cau_hoi' && looksLikeEntry) {
      manualCard('Chưa hiểu, điền tay nhé:', text, ngay);
    } else botSay(r.tra_loi || 'Chưa hiểu. ' + HELP);
  } catch (err) {
    CHAT.splice(CHAT.indexOf(wait), 1);
    console.warn(err);
    const why = err instanceof TypeError ? 'Mất mạng' : 'AI đang bận';
    if (looksLikeEntry) manualCard(why + ', điền tay nhé:', text, ngay);
    else botSay(why + ', thử lại sau nhé.');
  }
  send.busy = false;
  renderChat();
}

// Thẻ ghi tay: dùng khi AI không hiểu hoặc không chạy. Đoán sẵn tên khách nếu câu nhắn có tên trong sổ.
function manualCard(intro, text = '', ngay = DATA.today) {
  const t = norm(text);
  const guess = DATA.customers.filter(c => t.includes(norm(c.Ten))).sort((a, b) => b.Ten.length - a.Ten.length)[0];
  CHAT.push({ id: uid(), role: 'bot', kind: 'manual', intro, name: guess ? guess.Ten : '', ngay, note: text });
}
function manualHTML(m) {
  if (m.status === 'done') return '';
  return `<div class="msg bot cm">${intro(m.intro)}
    <div class="cm-manual">
      <input id="mN${m.id}" list="custNames" value="${esc(m.name)}" placeholder="Tên khách" aria-label="Tên khách" autocomplete="off">
      <div class="cm-edit" style="padding-left:0">
        <label for="mH${m.id}">Bán</label><input id="mH${m.id}" inputmode="decimal" placeholder="nghìn">
        <label for="mT${m.id}">Thu</label><input id="mT${m.id}" inputmode="decimal" placeholder="nghìn">
      </div>
    </div>
    <div class="cm-actions" style="padding-left:0">
      <button class="b-ok" data-act="manualok" data-id="${m.id}">Tiếp</button>
      <button class="b-ghost" data-act="manualno" data-id="${m.id}">Huỷ</button>
    </div></div>`;
}
const intro = s => s ? `<div style="margin-bottom:8px">${fmtText(s)}</div>` : '';

async function onChatClick(ev) {
  const goBtn = ev.target.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const m = CHAT.find(x => x.id === b.dataset.id);
  if (!m) return;
  const act = b.dataset.act;
  if (act === 'pick' || act === 'new') {
    m.status = 'done';
    const draft = m.draft;
    if (act === 'pick') setCustomer(draft, b.dataset.arg);
    else draft.newName = draft.rawName;
    CHAT.push({ id: uid(), role: 'bot', kind: 'draft', draft });
    return renderChat();
  }
  if (act === 'manualok') {
    const name = $('#mN' + m.id).value.trim();
    const h = parseMoney($('#mH' + m.id).value || '0'), t = parseMoney($('#mT' + m.id).value || '0');
    if (!name) return toast('Nhập tên khách');
    if (h == null || t == null) return toast('Số tiền chưa đúng, gõ ví dụ 50 hoặc 1tr2');
    if (!h && !t) return toast('Nhập số tiền bán hoặc thu');
    m.status = 'done';
    proposeEntry(name, { tienHang: h, daTra: t }, m.ngay, m.note || `${name} bán ${h / 1000} thu ${t / 1000}`);
    return renderChat();
  }
  if (act === 'manualno') { m.status = 'done'; return renderChat(); }
  if (act === 'edit') { m.editing = true; return renderChat(); }
  if (act === 'editok') {
    const h = parseMoney($('#eH' + m.id).value || '0'), t = parseMoney($('#eT' + m.id).value || '0');
    if (h == null || t == null) return toast('Số tiền chưa đúng, gõ ví dụ 50 hoặc 1tr2');
    m.draft.tienHang = h; m.draft.daTra = t; m.editing = false;
    return renderChat();
  }
  if (act === 'cancel') { m.status = 'cancelled'; return renderChat(); }
  if (act === 'save') {
    const d = m.draft;
    if (!d.tienHang && !d.daTra) return toast('Chưa có số tiền nào để ghi');
    // Hiện "Đã ghi" ngay, gửi lên Sheet ở phía sau (mất mạng thì giữ trên máy, có mạng tự gửi)
    m.txId = enqueue(d); m.queued = true; m.status = 'saved';
    renderChat();
    flushQueue();
    return;
  }
  if (act === 'undo') {
    if (m.queued) { removeQueued(m.txId); m.undone = true; toast('Đã hoàn tác'); return renderChat(); }
    if (!needOnline()) return;
    m.undone = true;
    deleteInBackground(m.txId, () => { m.undone = false; });
    toast('Đã hoàn tác');
    return renderChat();
  }
}

function weekSummary() {
  const [from, to] = weekRange(DATA.today);
  const s = sumRange(from, to);
  const list = debtors();
  return `📋 Tổng kết tuần ${shortDate(from)} – ${shortDate(to)}\n• Doanh thu: **${money(s.hang)}**\n• Đã thu: **${money(s.tra)}**\n• Số khách: ${s.khach}\n\n`
    + (list.length
      ? `Khách đang nợ (${list.length} người, tổng **${money(totalDebt())}**):\n` + list.slice(0, 15).map(([c, v]) => `• ${c.Ten}: ${money(v)}`).join('\n')
      : 'Không có khách nào nợ 👍');
}
// Chủ nhật mở app lần đầu trong ngày: tự gửi tổng kết tuần
function autoWeekly() {
  if (new Date(DATA.today + 'T00:00:00').getDay() !== 0 || store('svs_week') === DATA.today) return;
  store('svs_week', DATA.today);
  botSay(weekSummary(), { go: 'report', goLabel: '📊 Xem báo cáo' });
}

// ---------- Khách hàng ----------
const COLORS = ['#e17055', '#0984e3', '#00b894', '#6c5ce7', '#d63031', '#e84393', '#2d98da', '#20bf6b', '#f39c12', '#8e44ad'];
function avatar(c, cls = '') {
  const w = c.Ten.trim().split(/\s+/);
  const ini = (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  const h = [...c.ID].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return `<span class="avatar ${cls}" style="background:${COLORS[h % COLORS.length]}">${esc(ini)}</span>`;
}
function lastDate(id) {
  const d = DATA.txs.filter(t => t.KhachID === id).reduce((a, t) => t.Ngay > a ? t.Ngay : a, '');
  if (!d) return 'Chưa mua lần nào';
  if (d === DATA.today) return 'Lần cuối: hôm nay';
  if (d === addDays(DATA.today, -1)) return 'Lần cuối: hôm qua';
  return 'Lần cuối: ' + fmtDate(d);
}

function viewCustomers(q = '') {
  setHeader('Khách hàng', { actions: [{ text: '+ Thêm', fn: () => go('customerForm') }, settingsBtn] });
  const bal = balances();
  const today = sumRange(DATA.today, DATA.today);
  const list = DATA.customers
    .filter(c => !q || norm(c.Ten + ' ' + c.SDT).includes(norm(q)))
    .sort((a, b) => (bal[b.ID] || 0) - (bal[a.ID] || 0));
  $('#view').innerHTML = `
    <div class="stats">
      <div class="card"><div class="muted">Hôm nay bán</div><div class="big">${money(today.hang)}</div></div>
      <div class="card"><div class="muted">Khách đang nợ</div><div class="big debt">${money(totalDebt())}</div></div>
    </div>
    <button class="btn soft" style="margin:0 0 12px" onclick="go('report')">📊 Báo cáo, biểu đồ, xuất Excel</button>
    <input id="q" type="search" placeholder="🔍 Tìm khách…" value="${esc(q)}">
    <div style="height:12px"></div>
    ${list.length ? `<div class="list">${list.map(c => `
      <button class="item" onclick="go('customer','${c.ID}')">
        ${avatar(c)}
        <span class="main"><span class="name">${esc(c.Ten)}</span><br><span class="muted">${lastDate(c.ID)}</span></span>
        <span class="amt">${balText(bal[c.ID] || 0)}</span>
      </button>`).join('')}</div>`
      : `<div class="loading">${q ? 'Không tìm thấy khách.' : 'Chưa có khách. Ghi sổ ở tab 💬 là khách tự được thêm.'}</div>`}`;
  const qi = $('#q');
  qi.oninput = () => { const v = qi.value; viewCustomers(v); const n = $('#q'); n.focus(); n.setSelectionRange(v.length, v.length); };
}

function viewCustomer(id) {
  const c = custById(id);
  if (!c) return go('customers');
  setHeader(c.Ten, { back: () => go('customers'), actions: [{ text: 'Sửa', fn: () => go('customerForm', c) }] });
  const bal = balances()[id] || 0;
  const txs = DATA.txs.filter(t => t.KhachID === id).sort((a, b) => (b.Ngay + b.ID).localeCompare(a.Ngay + a.ID));
  // Số dư sau từng lần ghi, cộng dồn từ lần cũ nhất
  const after = {};
  txs.slice().reverse().reduce((run, t) => (after[t.ID] = run + (Number(t.TienHang) || 0) - (Number(t.DaTra) || 0)), 0);
  const afterText = v => v > 0 ? 'còn nợ ' + money(v) : v < 0 ? 'dư ' + money(-v) : 'hết nợ';
  const phone = String(c.SDT || '').replace(/[^\d+]/g, '');
  $('#view').innerHTML = `
    <div class="card" style="text-align:center">
      ${avatar(c, 'lg')}
      <div class="big" style="margin-top:8px">${balText(bal)}</div>
      ${c.DiaChi ? `<div class="muted">${esc(c.DiaChi)}</div>` : ''}
      ${c.GhiChu ? `<div class="muted">${esc(c.GhiChu)}</div>` : ''}
      <div class="btns" style="margin-top:14px">
        <button class="btn" onclick="go('chat', ${esc(JSON.stringify(c.Ten + ' '))})">💬 Ghi sổ</button>
        ${bal > 0 ? `<button class="btn zalo" onclick="remind('${id}')">📤 Nhắc nợ</button>`
                  : phone ? `<a class="btn line" href="tel:${esc(phone)}">📞 Gọi</a>` : '<span></span>'}
      </div>
      ${bal > 0 && phone ? `<a class="btn line" href="tel:${esc(phone)}">📞 Gọi ${esc(c.SDT)}</a>` : ''}
    </div>
    <div class="card">
      <strong>Lịch sử</strong>
      ${txs.map(t => {
        const net = (Number(t.TienHang) || 0) - (Number(t.DaTra) || 0);
        const netHTML = net > 0 ? `<span class="net debt">+${money(net)}<small>nợ thêm</small></span>`
          : net < 0 ? `<span class="net credit">−${money(-net)}<small>trả bớt</small></span>`
          : '<span class="net muted">Đủ</span>';
        return `
        <div class="tx" onclick="this.classList.toggle('open')">
          <div class="row"><b>${dayLabel(t.Ngay)}${t.Ngay.slice(0, 4) !== DATA.today.slice(0, 4) ? '/' + t.Ngay.slice(0, 4) : ''}</b>${netHTML}</div>
          <div class="row"><span>${flowText(Number(t.TienHang), Number(t.DaTra))}</span><span class="muted">${afterText(after[t.ID])}</span></div>
          ${t.GhiChu ? `<div class="muted">“${esc(t.GhiChu)}”</div>` : ''}
          <button class="del" onclick="event.stopPropagation(); delTx('${t.ID}','${id}')">Xoá dòng này</button>
        </div>`;
      }).join('') || '<div class="muted" style="margin-top:8px">Chưa có giao dịch.</div>'}
      ${txs.length ? '<div class="hint" style="text-align:center">Bấm vào một dòng để xoá nếu ghi nhầm</div>' : ''}
    </div>`;
}

async function delTx(txId, custId) {
  if (txId.startsWith('Q')) {
    if (!confirm('Xoá dòng này khỏi sổ?')) return;
    CHAT.forEach(m => { if (m.txId === txId) m.undone = true; });
    removeQueued(txId); saveChat(); toast('Đã xoá');
    return viewCustomer(custId);
  }
  if (!needOnline() || !confirm('Xoá dòng này khỏi sổ?')) return;
  CHAT.forEach(m => { if (m.txId === txId) m.undone = true; });
  deleteInBackground(txId);
  toast('Đã xoá');
  viewCustomer(custId);
}

// Xoá trên máy ngay, gửi lệnh xoá lên Sheet ở phía sau; lỗi thì tải lại sổ cho đúng
function deleteInBackground(txId, onFail) {
  DATA.txs = DATA.txs.filter(t => t.ID !== txId);
  api('deleteTransaction', { id: txId })
    .then(() => reload())
    .catch(e => { if (onFail) onFail(); toast(errText(e, 'Mất mạng, chưa xoá được')); return reload(); })
    .then(() => { saveChat(); refresh(); });
}

// Nhắc nợ: mở bảng chia sẻ của điện thoại (chọn Zalo, Messenger…); máy không hỗ trợ thì chép tin nhắn
async function remind(id) {
  const c = custById(id);
  const text = `Chào ${c.Ten}, sổ mình ghi còn nợ ${moneyFull(balances()[id])} chưa thanh toán (tính đến ${fmtDate(DATA.today)}). Khi nào tiện gửi giúp mình nha. Cảm ơn nhiều!`;
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Đã chép tin nhắn, mở Zalo và dán vào'); }
  catch (_) { toast('Không chép được, hãy gõ tay'); return; }
  const phone = String(c.SDT || '').replace(/\D/g, '');
  if (phone) setTimeout(() => { location.href = 'https://zalo.me/' + phone; }, 900);
}

function viewCustomerForm(c = {}) {
  setHeader(c.ID ? 'Sửa khách' : 'Thêm khách', { back: () => c.ID ? go('customer', c.ID) : go('customers') });
  $('#view').innerHTML = `
    <div class="card">
      <label for="cTen">Tên *</label><input id="cTen" value="${esc(c.Ten)}" placeholder="VD: Cô Ba tạp hoá">
      <label for="cSDT">Số điện thoại (để nhắc nợ qua Zalo)</label><input id="cSDT" type="tel" value="${esc(c.SDT)}">
      <label for="cDC">Địa chỉ</label><input id="cDC" value="${esc(c.DiaChi)}">
      <label for="cGC">Ghi chú</label><input id="cGC" value="${esc(c.GhiChu)}">
      <button class="btn" id="cSave">Lưu</button>
    </div>`;
  $('#cSave').onclick = async e => {
    if (c.pending) return toast('Khách này đang chờ gửi lên, sửa được sau khi có mạng');
    if (!needOnline()) return;
    e.target.disabled = true;
    try {
      const id = await call('saveCustomer', { ID: c.ID, Ten: $('#cTen').value, SDT: $('#cSDT').value, DiaChi: $('#cDC').value, GhiChu: $('#cGC').value });
      await reload(); toast('Đã lưu'); go('customer', id);
    } catch (_) { e.target.disabled = false; }
  };
}

// ---------- Báo cáo ----------
function rangeOf(key) {
  const t = DATA.today;
  if (key === 'week') return weekRange(t);
  if (key === '30d') return [addDays(t, -29), t];
  if (key === 'year') return [t.slice(0, 4) + '-01-01', t];
  if (key === 'all') return [DATA.txs.reduce((a, x) => x.Ngay && x.Ngay < a ? x.Ngay : a, t), t];
  const d = new Date(t + 'T00:00:00'), y = d.getFullYear(), m = d.getMonth();
  if (key === 'month') return [isoOf(new Date(y, m, 1)), t];
  return [isoOf(new Date(y, m - 1, 1)), isoOf(new Date(y, m, 0))];
}

// Khoảng dài hơn 2 tháng thì gộp cột theo tháng
const byMonth = (from, to) => (new Date(to) - new Date(from)) / 864e5 > 62;
function chartSVG(from, to) {
  const monthly = byMonth(from, to);
  const keyOf = d => monthly ? d.slice(0, 7) : d;
  const days = [];
  if (monthly) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
      days.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
  } else for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const label = k => monthly ? 'T' + Number(k.slice(5, 7)) + (from.slice(0, 4) !== to.slice(0, 4) ? '/' + k.slice(2, 4) : '') : shortDate(k);
  const current = keyOf(DATA.today);
  const val = {};
  DATA.txs.forEach(t => { if (t.Ngay >= from && t.Ngay <= to) val[keyOf(t.Ngay)] = (val[keyOf(t.Ngay)] || 0) + (Number(t.TienHang) || 0); });
  const max = Math.max(...days.map(d => val[d] || 0), 1);
  const W = 600, H = 200, top = 22, bottom = 24, left = 4;
  const bw = (W - left) / days.length;
  const y = v => top + (H - top - bottom) * (1 - v / max);
  const step = Math.ceil(days.length / 7);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ doanh thu theo ngày">
    <line x1="0" x2="${W}" y1="${top}" y2="${top}" stroke="#e4e6eb" stroke-dasharray="4 4"/>
    <text x="${W - 2}" y="${top - 6}" text-anchor="end">${money(max)}</text>
    <line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="#e4e6eb"/>
    ${days.map((d, i) => {
      const v = val[d] || 0, x = left + i * bw + bw * 0.15, w = bw * 0.7;
      return `${v ? `<rect x="${x}" y="${y(v)}" width="${w}" height="${H - bottom - y(v)}" rx="3" fill="${d === current ? '#c0392b' : '#e8907f'}"><title>${label(d)}: ${money(v)}</title></rect>` : ''}
        ${i % step === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${label(d)}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

function viewReport(key) {
  if (key) reportRange = key;
  setHeader('Báo cáo', { back: () => go('customers') });
  const [from, to] = rangeOf(reportRange);
  const s = sumRange(from, to);
  const tabs = [['week', 'Tuần này'], ['month', 'Tháng này'], ['prev', 'Tháng trước'], ['30d', '30 ngày'], ['year', 'Năm nay'], ['all', 'Tất cả']];
  $('#view').innerHTML = `
    <div class="seg">${tabs.map(([k, l]) => `<button class="${k === reportRange ? 'on' : ''}" onclick="viewReport('${k}')">${l}</button>`).join('')}</div>
    <div class="muted" style="margin-bottom:8px">Từ ${fmtDate(from)} đến ${fmtDate(to)}</div>
    <div class="stats">
      <div class="card"><div class="muted">Doanh thu</div><div class="big">${money(s.hang)}</div></div>
      <div class="card"><div class="muted">Đã thu</div><div class="big">${money(s.tra)}</div></div>
    </div>
    <div class="card"><div class="row"><strong>Doanh thu theo ${byMonth(from, to) ? 'tháng' : 'ngày'}</strong><span class="muted">${s.khach} khách</span></div>${chartSVG(from, to)}</div>
    <div class="card"><div class="muted">Khách đang nợ (tất cả)</div><div class="big debt">${money(totalDebt())}</div>
      ${debtors().slice(0, 10).map(([c, v]) => `<div class="row tx"><span>${esc(c.Ten)}</span><b>${money(v)}</b></div>`).join('')}</div>
    <button class="btn" id="xls">📥 Tải sổ về máy (file Excel)</button>
    <div class="hint" style="text-align:center">Gồm danh sách khách và toàn bộ giao dịch</div>`;
  $('#xls').onclick = exportExcel;
}

function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
async function exportExcel(e) {
  e.target.disabled = true;
  try {
    if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const bal = balances();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Tên', 'Số điện thoại', 'Địa chỉ', 'Ghi chú', 'Còn nợ (+) / Dư (-)'],
      ...DATA.customers.map(c => [c.Ten, String(c.SDT || ''), c.DiaChi, c.GhiChu, bal[c.ID] || 0]),
    ]), 'Khách hàng');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Ngày', 'Khách', 'Bán', 'Thu', 'Ghi chú'],
      ...DATA.txs.slice().sort((a, b) => a.Ngay.localeCompare(b.Ngay))
        .map(t => [fmtDate(t.Ngay), (custById(t.KhachID) || {}).Ten || '(đã xoá)', Number(t.TienHang) || 0, Number(t.DaTra) || 0, t.GhiChu]),
    ]), 'Giao dịch');
    XLSX.writeFile(wb, `so-ban-ve-so-${DATA.today}.xlsx`);
    toast('Đã tải file Excel');
  } catch (_) { toast('Không tải được, kiểm tra mạng rồi thử lại'); }
  e.target.disabled = false;
}

// ---------- Kết quả xổ số ----------
// Xếp như tờ kết quả: G8 trên cùng, giải Đặc biệt dưới cùng
const prizeRank = p => p.g === 'ĐB' ? 0 : Number(p.g);
const XS_LOADING = {}, XS_TRY = {};
async function viewResults(r) {
  if (r) { region = r; resultIdx = 0; }
  setHeader('Kết quả xổ số');
  const regs = [['MN', 'Miền Nam'], ['MT', 'Miền Trung'], ['MB', 'Miền Bắc']];
  const seg = `<div class="seg">${regs.map(([k, l]) => `<button class="${k === region ? 'on' : ''}" onclick="viewResults('${k}')">${l}</button>`).join('')}</div>`;
  // Hiện ngay kết quả đã lưu trên máy; quá 15 phút thì tải bản mới ở phía sau
  if (!RESULTS[region]) RESULTS[region] = store('svs_xs_' + region);
  const cached = RESULTS[region];
  const stale = !cached || Date.now() - cached.at > 15 * 60e3;
  const tried = XS_TRY[region] || 0;
  if (stale && !XS_LOADING[region] && Date.now() - tried > 60e3) {
    const reg = region;
    XS_LOADING[reg] = true; XS_TRY[reg] = Date.now();
    const fresh = api('getResults', { region: reg })
      .then(items => { RESULTS[reg] = { at: Date.now(), items }; store('svs_xs_' + reg, RESULTS[reg]); })
      .catch(() => {})
      .finally(() => { XS_LOADING[reg] = false; if (CURRENT[0] === 'results' && region === reg && RESULTS[reg] !== cached) viewResults(); });
    if (!cached) {
      $('#view').innerHTML = seg + '<div class="loading">Đang tải kết quả…</div>';
      await fresh;
      if (!RESULTS[reg] && CURRENT[0] === 'results' && region === reg) $('#view').innerHTML = seg + '<div class="loading">Không tải được. Thử lại sau.</div>';
      return;
    }
  }
  if (!cached) {
    $('#view').innerHTML = seg + `<div class="loading">${XS_LOADING[region] ? 'Đang tải kết quả…' : 'Không tải được. Thử lại sau.'}</div>`;
    return;
  }
  const items = cached.items;
  if (!items.length) { $('#view').innerHTML = seg + '<div class="loading">Chưa có kết quả.</div>'; return; }
  const it = items[resultIdx] || items[0];
  $('#view').innerHTML = seg + `
    <select id="rDay" aria-label="Chọn ngày">${items.map((x, i) => `<option value="${i}" ${i === resultIdx ? 'selected' : ''}>${esc(x.title.replace(/^KẾT QUẢ XỔ SỐ MIỀN \S+ /, ''))}</option>`).join('')}</select>
    <div style="height:12px"></div>
    ${it.dais.map(d => `
      <div class="card"><strong style="font-size:1.1rem">${esc(d.name)}</strong>
        <table>${d.prizes.slice().sort((a, b) => prizeRank(b) - prizeRank(a)).map(p => `<tr class="${p.g === 'ĐB' ? 'db' : ''}"><td class="g">${p.g === 'ĐB' ? 'ĐB' : 'G' + esc(p.g)}</td><td class="nums">${p.nums.map(esc).join(' · ')}</td></tr>`).join('')}</table>
      </div>`).join('')}
    <div class="muted">Nguồn: <a href="${esc(it.link)}" target="_blank" rel="noopener">xskt.com.vn</a></div>`;
  $('#rDay').onchange = e => { resultIdx = Number(e.target.value); viewResults(); };
}

// ---------- Cài đặt ----------
function viewSettings() {
  setHeader('Cài đặt', { back: () => go('chat') });
  const cfg = getCfg();
  $('#view').innerHTML = `
    <div class="card">
      <label for="sUrl">Đường dẫn kết nối</label>
      <input id="sUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}">
      <label for="sTok">Mã truy cập</label>
      <input id="sTok" type="password" value="${esc(cfg.token)}">
      <button class="btn" id="sSave">Lưu và kiểm tra</button>
    </div>
    <div class="card"><button class="btn line" style="margin:0" id="sClear">Xoá tin nhắn trong khung Ghi sổ</button>
      <div class="hint">Chỉ xoá tin nhắn trên máy này, sổ không bị ảnh hưởng.</div></div>
    <div class="muted">Mã truy cập chỉ lưu trên máy này. Nếu lỡ lộ mã, hãy đổi mã mới trong Google Apps Script rồi nhập lại ở đây.</div>`;
  $('#sClear').onclick = () => { CHAT = []; saveChat(); toast('Đã xoá tin nhắn'); };
  $('#sSave').onclick = async e => {
    const url = $('#sUrl').value.trim(), token = $('#sTok').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) return toast('Đường dẫn phải có dạng https://script.google.com/…/exec');
    e.target.disabled = true;
    store('svs_cfg', { url, token });
    try {
      DATA = await api('getData');
      OFFLINE = false;
      store('svs_data', { data: DATA, at: new Date().toISOString() });
      $('#offline').hidden = true;
      toast('Kết nối thành công');
      go('chat');
    } catch (err) {
      toast(errText(err, 'Không kết nối được, kiểm tra lại đường dẫn'));
      e.target.disabled = false;
    }
  };
}

// ---------- Bàn phím mở/đóng ----------
const isField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !['checkbox', 'radio', 'button'].includes(el.type);
function fitKeyboard() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  document.documentElement.style.setProperty('--kb', kb + 'px');
  if (document.body.classList.contains('chat-mode') && document.body.classList.contains('typing')) {
    window.scrollTo(0, document.body.scrollHeight);
  }
}
document.addEventListener('focusin', e => {
  if (!isField(e.target)) return;
  document.body.classList.add('typing');
  setTimeout(fitKeyboard, 300); // chờ bàn phím mở xong
});
document.addEventListener('focusout', () => setTimeout(() => {
  if (isField(document.activeElement)) return;
  document.body.classList.remove('typing');
  document.documentElement.style.setProperty('--kb', '0px');
}, 100));
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitKeyboard);
  visualViewport.addEventListener('scroll', fitKeyboard);
}

// ---------- Khởi động ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  CHAT = store('svs_chat') || [];
  CHAT = CHAT.filter(m => m.kind !== 'thinking');
  const cfg = getCfg();
  if (!cfg.url || !cfg.token) return go('settings');
  // Mở ngay bằng sổ đã lưu lần trước, rồi lấy bản mới từ Sheet ở phía sau
  const cached = store('svs_data');
  if (cached) {
    DATA = cached.data;
    DATA.today = localToday();
    applyQueue();
    autoWeekly();
    go('chat');
    reload().catch(() => {}).then(() => { refresh(); flushQueue(); });
    return;
  }
  try { await reload(); autoWeekly(); go('chat'); flushQueue(); }
  catch (e) { toast(e.message); go('settings'); }
})();
