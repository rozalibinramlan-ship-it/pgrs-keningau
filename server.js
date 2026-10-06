// ============================================================
// PGRS KENINGAU — SERVER
// Register Ahli Parti · N39 · N40 · N41
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ============================================================
// GEMINI AI SETUP
// ============================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============================================================
// GOOGLE SHEETS SETUP (GUNA SECRET FILE)
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

// Password check middleware
function checkPassword(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-app-password'];
  if (pass !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Password salah' });
  }
  next();
}

// ============================================================
// ROUTES
// ============================================================

// Test password — buka app
app.get('/api/check-password', (req, res) => {
  const pass = req.query.pass;
  if (pass === APP_PASSWORD) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, error: 'Password salah' });
});

// Get next number (No. Seterusnya)
app.get('/api/next-number', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const nextNum = 355001 + Math.max(0, rows.length - 1);
    res.json({ success: true, nextNumber: nextNum });
  } catch (err) {
    console.error('Error next-number:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test AI
app.get('/api/test-ai', checkPassword, async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent('Balas dengan: OK');
    res.json({ success: true, reply: result.response.text() });
  } catch (err) {
    console.error('Error test-ai:', err);
    res.status(500).json({ error: err.message });
  }
});

// Scan borang — process image
app.post('/api/scan', checkPassword, async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Tiada gambar dihantar' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Anda adalah pembantu untuk pendaftaran ahli PGRS Keningau (Parti Gerakan Rakyat Sabah).
Ekstrak maklumat berikut dari gambar borang ini dalam format JSON:

{
  "nama": "nama penuh",
  "ic": "nombor kad pengenalan",
  "alamat": "alamat penuh",
  "noTel": "nombor telefon",
  "dun": "N39 atau N40 atau N41",
  "cawangan": "nama cawangan",
  "jawatan": "jawatan dalam parti (kalau ada)"
}

Kalau ada maklumat yang tak jelas, letak null.
Balas HANYA dengan JSON, tiada penjelasan lain.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: image,
        },
      },
    ]);

    const text = result.response.text();
    // Clean JSON from markdown if needed
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanText);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error scan:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save ahli ke Google Sheet
app.post('/api/save', checkPassword, async (req, res) => {
  try {
    const { nama, ic, alamat, noTel, dun, cawangan, jawatan } = req.body;
    if (!nama || !ic) {
      return res.status(400).json({ error: 'Nama dan IC wajib diisi' });
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const nextNum = 355001 + Math.max(0, rows.length - 1);

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextNum,
          new Date().toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' }),
          nama || '',
          ic || '',
          alamat || '',
          noTel || '',
          dun || '',
          cawangan || '',
          jawatan || ''
        ]],
      },
    });

    res.json({ success: true, noAhli: nextNum });
  } catch (err) {
    console.error('Error save:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get senarai ahli
app.get('/api/list', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:I',
    });
    const rows = response.data.values || [];
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error list:', err);
    res.status(500).json({ error: err.message });
  }
});

// Statistik
app.get('/api/stats', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:I',
    });
    const rows = response.data.values || [];
    const dataRows = rows.slice(1);

    const stats = {
      total: dataRows.length,
      n39: dataRows.filter(r => r[6] === 'N39').length,
      n40: dataRows.filter(r => r[6] === 'N40').length,
      n41: dataRows.filter(r => r[6] === 'N41').length,
    };

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SERVE register.html
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ PGRS Keningau server running on port ${PORT}`);
  console.log(`🔐 Password: ${APP_PASSWORD}`);
  console.log(`🤖 AI Model: gemini-2.5-flash`);
  console.log(`📁 Google Auth: Secret File (/etc/secrets/google-key.json)`);
});