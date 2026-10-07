// ============================================================
// PGRS KENINGAU — SERVER (v5 FINAL)
// Role: staff / admin
// Auto UPPERCASE
// ============================================================

const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIG
// ============================================================
const APP_PASSWORD = process.env.APP_PASSWORD || 'pgrs-keningau';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ============================================================
// GEMINI AI
// ============================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const MODEL_LIST = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3.8-flash'
];

// ============================================================
// GOOGLE SHEETS
// ============================================================
const auth = new google.auth.GoogleAuth({
  keyFile: '/etc/secrets/google-key.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ============================================================
// HELPER: CHECK ROLE
// ============================================================
function getRole(pass) {
  if (pass === ADMIN_PASSWORD) return 'admin';
  if (pass === APP_PASSWORD) return 'staff';
  return null;
}

// Middleware: check password (staff OR admin)
function checkPassword(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-app-password'];
  const role = getRole(pass);
  if (!role) return res.status(401).json({ error: 'Password salah' });
  req.role = role;
  next();
}

// Middleware: check admin ONLY
function checkAdmin(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-app-password'];
  const role = getRole(pass);
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Access denied — admin only' });
  }
  req.role = role;
  next();
}

// ============================================================
// HELPER: CALL GEMINI WITH FALLBACK
// ============================================================
async function callGeminiWithFallback(parts) {
  let lastError = null;
  for (const modelName of MODEL_LIST) {
    try {
      console.log(`[AI] Trying: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(parts);
      const text = result.response.text();
      console.log(`[AI] ✅ Success: ${modelName}`);
      return { success: true, text, model: modelName };
    } catch (err) {
      console.log(`[AI] ❌ Failed ${modelName}: ${err.message.substring(0, 80)}`);
      lastError = err;
    }
  }
  return { success: false, error: lastError?.message || 'All models failed' };
}

// ============================================================
// ROUTES
// ============================================================

// Check role
app.get('/api/check-role', (req, res) => {
  const pass = req.query.pass;
  const role = getRole(pass);
  if (role) {
    res.json({ success: true, role });
  } else {
    res.status(401).json({ success: false, error: 'Password salah' });
  }
});

// Check password (backup)
app.get('/api/check-password', (req, res) => {
  const pass = req.query.pass;
  if (getRole(pass)) return res.json({ success: true });
  res.status(401).json({ success: false });
});

// Next number (staff + admin)
app.get('/api/next-number', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const dataRows = rows.length > 1 ? rows.length - 1 : 0;
    const nextNum = 355001 + dataRows;
    res.json({ success: true, nextNumber: nextNum });
  } catch (err) {
    console.error('next-number:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test AI (staff + admin)
app.get('/api/test-ai', checkPassword, async (req, res) => {
  const result = await callGeminiWithFallback('Balas dengan: OK');
  if (result.success) {
    res.json({ success: true, model: result.model, reply: result.text });
  } else {
    res.status(503).json({ error: result.error });
  }
});

// Scan (staff + admin)
app.post('/api/scan', checkPassword, async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) return res.status(400).json({ error: 'Tiada gambar' });

    const prompt = `Extract data from this PGRS membership form. Return ONLY JSON:
{"nama":"","ic":"","dun":"N39 or N40 or N41","cawangan":"","tarikhLahir":"DD/MM/YYYY","tempatLahir":"","noTel":"","jawatan":"","alamat":""}
Use null if unclear.`;

    const result = await callGeminiWithFallback([
      prompt,
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }
    ]);

    if (!result.success) return res.status(503).json({ error: result.error });

    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const fb = cleanText.indexOf('{');
    const lb = cleanText.lastIndexOf('}');
    const jsonText = (fb !== -1 && lb !== -1) ? cleanText.substring(fb, lb + 1) : cleanText;
    const data = JSON.parse(jsonText);

    res.json({ success: true, data, model: result.model });
  } catch (err) {
    console.error('scan:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save (staff + admin) — AUTO UPPERCASE
app.post('/api/save', checkPassword, async (req, res) => {
  try {
    const {
      nama, ic, dun, cawangan,
      tarikhLahir, tempatLahir, noTel, jawatan, alamat,
      noAhliManual
    } = req.body;

    if (!nama || !ic) return res.status(400).json({ error: 'Nama dan IC wajib' });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const dataRows = rows.length > 1 ? rows.length - 1 : 0;
    const nextNum = 355001 + dataRows;
    const noAhli = noAhliManual || nextNum;

    const tarikhDaftar = new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    // AUTO UPPERCASE semua
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextNum,
          noAhli,
          (nama || '').toString().toUpperCase(),
          (ic || '').toString().toUpperCase(),
          (dun || '').toString().toUpperCase(),
          (cawangan || '').toString().toUpperCase(),
          (tarikhLahir || '').toString().toUpperCase(),
          (tempatLahir || '').toString().toUpperCase(),
          (noTel || '').toString().toUpperCase(),
          (jawatan || '').toString().toUpperCase(),
          (alamat || '').toString().toUpperCase(),
          tarikhDaftar
        ]],
      },
    });

    res.json({ success: true, noBorang: nextNum, noAhli });
  } catch (err) {
    console.error('save:', err);
    res.status(500).json({ error: err.message });
  }
});

// List (ADMIN ONLY)
app.get('/api/list', checkAdmin, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
    });
    const rows = response.data.values || [];
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats (staff + admin — sebab progress perlu untuk staff)
app.get('/api/stats', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
    });
    const rows = response.data.values || [];
    const dataRows = rows.slice(1);

    const stats = {
      total: dataRows.length,
      n39: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N39')).length,
      n40: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N40')).length,
      n41: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N41')).length,
    };

    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve register.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ PGRS Keningau server running on port ${PORT}`);
  console.log(`🔑 Staff password: ${APP_PASSWORD}`);
  console.log(`🔐 Admin password: ${ADMIN_PASSWORD}`);
  console.log(`⚡ AI models: ${MODEL_LIST.length} (fallback)`);
  console.log(`📊 Sheet: Sheet1!A:L (12 kolum)`);
});