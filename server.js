// ============================================================
// PGRS KENINGAU — SERVER (v3)
// Model: gemini-3.8-flash
// Sheet: A-L (12 kolum)
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

// Model terkini — Google recommend
const GEMINI_MODEL = 'gemini-3.8-flash';

// ============================================================
// GOOGLE SHEETS SETUP (SECRET FILE)
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

// Test password
app.get('/api/check-password', (req, res) => {
  const pass = req.query.pass;
  if (pass === APP_PASSWORD) return res.json({ success: true });
  res.status(401).json({ success: false, error: 'Password salah' });
});

// Get next number (No Borang / No Ahli)
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
    console.error('Error next-number:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test AI
app.get('/api/test-ai', checkPassword, async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent('Balas dengan: OK');
    res.json({ success: true, model: GEMINI_MODEL, reply: result.response.text() });
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

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `Anda adalah pembantu untuk pendaftaran ahli PGRS Keningau (Parti Gerakan Rakyat Sabah).
Ekstrak maklumat berikut dari gambar borang ini dalam format JSON:

{
  "nama": "nama penuh",
  "ic": "nombor kad pengenalan",
  "dun": "N39 atau N40 atau N41",
  "cawangan": "nama cawangan",
  "tarikhLahir": "tarikh lahir (DD/MM/YYYY)",
  "tempatLahir": "tempat lahir",
  "noTel": "nombor telefon",
  "jawatan": "jawatan dalam parti",
  "alamat": "alamat penuh"
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
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    const jsonText = (firstBrace !== -1 && lastBrace !== -1)
      ? cleanText.substring(firstBrace, lastBrace + 1)
      : cleanText;
    const data = JSON.parse(jsonText);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error scan:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save ahli ke Google Sheet
app.post('/api/save', checkPassword, async (req, res) => {
  try {
    const {
      nama, ic, dun, cawangan,
      tarikhLahir, tempatLahir, noTel, jawatan, alamat,
      noAhliManual
    } = req.body;

    if (!nama || !ic) {
      return res.status(400).json({ error: 'Nama dan IC wajib diisi' });
    }

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const dataRows = rows.length > 1 ? rows.length - 1 : 0;
    const nextNum = 355001 + dataRows;
    const noAhli = noAhliManual || nextNum;

    const tarikhDaftar = new Date().toLocaleString('ms-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextNum,           // A - No Borang
          noAhli,            // B - No Ahli
          nama || '',        // C - Nama
          ic || '',          // D - No KP
          dun || '',         // E - DUN
          cawangan || '',    // F - Cawangan
          tarikhLahir || '', // G - Tarikh Lahir
          tempatLahir || '', // H - Tempat Lahir
          noTel || '',       // I - No Tel
          jawatan || '',     // J - Jawatan
          alamat || '',      // K - Alamat
          tarikhDaftar       // L - Tarikh Daftar
        ]],
      },
    });

    res.json({ success: true, noBorang: nextNum, noAhli });
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
      range: 'Sheet1!A:L',
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
    console.error('Error stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve register.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ PGRS Keningau server running on port ${PORT}`);
  console.log(`🔐 Password: ${APP_PASSWORD}`);
  console.log(`🤖 AI Model: ${GEMINI_MODEL}`);
  console.log(`📁 Google Auth: Secret File`);
  console.log(`📊 Sheet range: Sheet1!A:L (12 kolum)`);
});