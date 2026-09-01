const { app, BrowserWindow, shell, session, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;

// فحص ما إذا كان المنفذ مشغولاً بخادم آخر (نسخة قديمة مثلاً)
function isPortBusy(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/info`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// تشغيل خادم Express في الخلفية — فقط إذا كان المنفذ حرّاً
async function startServer() {
  const busy = await isPortBusy(3456);
  if (busy) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'jmf admin',
      message: 'يوجد خادم لوحة تحكم يعمل بالفعل على المنفذ 3456 (على الأغلب نسخة قديمة أو عملية node متروكة).\n\nأغلق تطبيق jmf admin القديم تماماً ثم أعد فتح هذا التطبيق، وإلا ستظهر لك واجهة الإصدار القديم.',
      buttons: ['حسناً'],
    });
    app.quit();
    return;
  }
  require('./server.js');
}

// مسح كاش الـ Service Worker والكاش القديم عند أول تشغيل لإصدار جديد
// حتى لا تظهر واجهة قديمة مخزّنة بعد تحديث التطبيق
function ensureFreshSession() {
  try {
    const markerFile = path.join(app.getPath('userData'), '.session-version');
    const ver = app.getVersion();
    let prev = null;
    try { prev = fs.readFileSync(markerFile, 'utf8').trim(); } catch {}
    if (prev !== ver) {
      Promise.all([
        session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }),
        session.defaultSession.clearCache(),
      ]).catch(() => {});
      try { fs.writeFileSync(markerFile, ver); } catch {}
      console.log('[jmf admin] تم مسح الكاش القديم للانتقال إلى الإصدار ' + ver);
    }
  } catch {}
}

function waitForServer(port, retries = 30) {
  return new Promise((resolve) => {
    const check = (attempt) => {
      const req = http.get(`http://localhost:${port}/api/info`, (res) => {
        if (res.statusCode === 200) return resolve(true);
        if (attempt >= retries) return resolve(false);
        setTimeout(() => check(attempt + 1), 250);
      });
      req.on('error', () => {
        if (attempt >= retries) return resolve(false);
        setTimeout(() => check(attempt + 1), 250);
      });
      req.end();
    };
    check(0);
  });
}

function resolveIcon() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ];
  for (const c of candidates) {
    const fs = require('fs');
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 950,
    minHeight: 620,
    title: 'jmf admin panel — لوحة التحكم',
    backgroundColor: '#0a0e17',
    autoHideMenuBar: true,
    icon: resolveIcon(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.removeMenu();

  await waitForServer(3456);
  mainWindow.loadURL('http://localhost:3456');

  // فتح الروابط الخارجية في المتصفح الافتراضي
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:3456')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await startServer();
  ensureFreshSession();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
