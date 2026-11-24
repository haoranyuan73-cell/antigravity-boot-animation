'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const BLOCK_SIZE = 4 * 1024 * 1024;
const LOADING_START = '/* --- ANTIGRAVITY LOADING TRANSITION START --- */';
const LOADING_END = '/* --- ANTIGRAVITY LOADING TRANSITION END --- */';
const LOADING_VERSION = '/* AG_LOADING_BOOT_V3 */';
const BACKUP_SUFFIX = '.bak-before-boot-animation';

function printHelp() {
  console.log([
    'Antigravity 开机动画安装工具',
    '',
    '用法:',
    '  node install-boot-animation.cjs [选项]',
    '',
    '选项:',
    '  --variant <solo|trio>        选择动画版本（默认 solo；trio 为三 AI 娘同框版）',
    '  --wallpaper <图片路径>        可选，指定星门内展示的自定义壁纸路径（不填则使用内置星空渐层）',
    '  --asar <app.asar路径>        可选，手动指定 Antigravity 的 app.asar 路径',
    '  --uninstall                  卸载开机动画补丁，恢复原始加载界面',
    '  --force-skip-running-check   跳过运行中进程检查（仅用于离线测试）',
    '  -h, --help                   显示本帮助信息',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = {
    variant: 'solo',
    wallpaper: '',
    asar: '',
    uninstall: false,
    forceSkipRunningCheck: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--uninstall') {
      opts.uninstall = true;
    } else if (arg === '--force-skip-running-check') {
      opts.forceSkipRunningCheck = true;
    } else if (arg === '--variant' && argv[i + 1]) {
      opts.variant = argv[++i];
    } else if (arg.startsWith('--variant=')) {
      opts.variant = arg.slice('--variant='.length);
    } else if (arg === '--wallpaper' && argv[i + 1]) {
      opts.wallpaper = argv[++i];
    } else if (arg.startsWith('--wallpaper=')) {
      opts.wallpaper = arg.slice('--wallpaper='.length);
    } else if (arg === '--asar' && argv[i + 1]) {
      opts.asar = argv[++i];
    } else if (arg.startsWith('--asar=')) {
      opts.asar = arg.slice('--asar='.length);
    } else {
      throw new Error(`未知参数: ${arg}（使用 --help 查看说明）`);
    }
  }
  if (opts.variant !== 'solo' && opts.variant !== 'trio') {
    throw new Error(`--variant 仅支持 solo 或 trio，收到: ${opts.variant}`);
  }
  return opts;
}

function getDefaultAsarPaths() {
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(localApp, 'Programs', 'antigravity', 'resources', 'app.asar'),
      path.join(localApp, 'Programs', 'Antigravity', 'resources', 'app.asar'),
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Antigravity.app/Contents/Resources/app.asar'];
  }
  return [
    '/opt/Antigravity/resources/app.asar',
    '/usr/lib/antigravity/resources/app.asar',
    path.join(os.homedir(), '.local', 'share', 'antigravity', 'resources', 'app.asar'),
  ];
}

function resolveAsarPath(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`找不到指定的 app.asar: ${resolved}`);
    }
    return { asarPath: resolved, isCustomPath: true };
  }
  const candidates = getDefaultAsarPaths();
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return { asarPath: p, isCustomPath: false };
    }
  }
  throw new Error(
    `未在默认路径找到 app.asar，请使用 --asar <路径> 手动指定。\n尝试过的路径:\n  ${candidates.join('\n  ')}`
  );
}

function isAntigravityRunning() {
  if (process.platform === 'win32') {
    const script =
      "$ErrorActionPreference = 'Stop'; " +
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); " +
      "$items = @(Get-CimInstance Win32_Process -Filter \"Name = 'Antigravity.exe'\" -ErrorAction Stop | " +
      "Select-Object Name,CommandLine); ConvertTo-Json -InputObject $items -Compress";
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const out = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    const items = JSON.parse(out.replace(/^\uFEFF/, ''));
    return Array.isArray(items) && items.some(p => p && String(p.Name || '').toLowerCase() === 'antigravity.exe');
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      execFileSync('pgrep', ['-f', 'Antigravity'], { stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function computeIntegrity(buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const blocks = [];
  if (buf.length === 0) {
    blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  } else {
    for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
      blocks.push(crypto.createHash('sha256').update(buf.subarray(i, i + BLOCK_SIZE)).digest('hex'));
    }
  }
  return { algorithm: 'SHA256', hash, blockSize: BLOCK_SIZE, blocks };
}

function patchAsarFile(sourceAsarPath, destAsarPath, targetRelPath, transformFn) {
  const data = fs.readFileSync(sourceAsarPath);
  if (data.length < 16 || data.readUInt32LE(0) !== 4) {
    throw new Error('无效的 ASAR 文件头');
  }
  const headerSize = data.readUInt32LE(4);
  const jsonSize = data.readUInt32LE(12);
  if (headerSize < 8 || jsonSize > headerSize - 8 || 8 + headerSize > data.length) {
    throw new Error('ASAR 文件头已损坏或截断');
  }
  const payloadStart = 8 + headerSize;
  const header = JSON.parse(data.subarray(16, 16 + jsonSize).toString('utf8'));

  const bodyChunks = [];
  let currentOffset = 0;
  let foundTarget = false;

  function processNode(node, prefix, inheritedUnpacked) {
    if (!node.files || typeof node.files !== 'object') {
      throw new Error('无效的 ASAR 目录结构');
    }
    for (const [name, entry] of Object.entries(node.files)) {
      if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
        throw new Error(`不安全的 ASAR 路径: ${name}`);
      }
      const relPath = prefix ? `${prefix}/${name}` : name;
      const unpacked = Boolean(inheritedUnpacked || entry.unpacked);
      if (entry.files) {
        processNode(entry, relPath, unpacked);
      } else if (entry.link !== undefined || unpacked) {
        continue;
      } else {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
          throw new Error(`无效的文件大小: ${relPath}`);
        }
        const origOffset = Number(entry.offset);
        if (!/^\d+$/.test(String(entry.offset)) || !Number.isSafeInteger(origOffset) || origOffset + entry.size > data.length - payloadStart) {
          throw new Error(`无效的文件偏移: ${relPath}`);
        }
        let fileBuf = data.subarray(payloadStart + origOffset, payloadStart + origOffset + entry.size);
        if (relPath === targetRelPath) {
          foundTarget = true;
          const nextText = transformFn(fileBuf.toString('utf8'));
          new Function(nextText);
          fileBuf = Buffer.from(nextText, 'utf8');
          entry.size = fileBuf.length;
          entry.integrity = computeIntegrity(fileBuf);
        }
        entry.offset = String(currentOffset);
        bodyChunks.push(fileBuf);
        currentOffset += fileBuf.length;
      }
    }
  }

  processNode(header, '', false);
  if (!foundTarget) {
    throw new Error(`ASAR 中未找到目标文件: ${targetRelPath}`);
  }

  const newJsonBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const newJsonSize = newJsonBuf.length;
  const alignedJsonSize = Math.ceil(newJsonSize / 4) * 4;
  const newHeaderSize2 = 4 + alignedJsonSize;
  const newHeaderSize = 4 + newHeaderSize2;

  const headerPre = Buffer.alloc(16 + alignedJsonSize);
  headerPre.writeUInt32LE(4, 0);
  headerPre.writeUInt32LE(newHeaderSize, 4);
  headerPre.writeUInt32LE(newHeaderSize2, 8);
  headerPre.writeUInt32LE(newJsonSize, 12);
  newJsonBuf.copy(headerPre, 16);

  fs.writeFileSync(destAsarPath, Buffer.concat([headerPre, ...bodyChunks]));
}

function stripExistingPatch(code) {
  const blockRe = /\r?\n?\/\* --- ANTIGRAVITY LOADING TRANSITION START --- \*\/[\s\S]*?\/\* --- ANTIGRAVITY LOADING TRANSITION END --- \*\/\s*/g;
  return code.replace(blockRe, '').trimEnd();
}

function buildLoadingPatchSnippet({ htmlPath, videoPath, variant, wallpaperPath }) {
  return `
${LOADING_START}
${LOADING_VERSION}
const __agBootFs = require('node:fs');
const __agBootHtml = ${JSON.stringify(htmlPath)};
const __agBootVideo = ${JSON.stringify(videoPath)};
const __agBootVariant = ${JSON.stringify(variant)};
const __agBootWallpaper = ${JSON.stringify(wallpaperPath || '')};
let __agBootVideoPlayed = false;
const __agOrigAttachLoadingOverlay = attachLoadingOverlay;

function __agAttachBootVideoOverlay(win, foregroundColor, backgroundColor) {
  const view = new electron_1.WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      transparent: true,
    },
  });
  try { view.setBackgroundColor('#00000000'); } catch (_) {}
  win.contentView.addChildView(view);
  const updateBounds = () => {
    if (win.isDestroyed?.() || view.webContents?.isDestroyed?.()) return;
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  updateBounds();
  win.on('resize', updateBounds);

  const hubContents = (0, utils_1.getHubWebContents)(win) ?? win.webContents;
  let cleanedUp = false;
  let hubLoaded = Boolean(
    hubContents &&
    typeof hubContents.isLoadingMainFrame === 'function' &&
    !hubContents.isLoadingMainFrame() &&
    typeof hubContents.getURL === 'function' &&
    hubContents.getURL()
  );
  let videoDone = false;
  let hardTimer = null;

  const notifyHubReady = () => {
    if (cleanedUp || !hubLoaded || view.webContents?.isDestroyed?.()) return;
    try {
      view.webContents.executeJavaScript('window.__agHubReady && window.__agHubReady()')?.catch?.(() => {});
    } catch (_) {}
  };

  const cleanupOverlay = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
    try {
      hubContents?.off?.('did-finish-load', onHubFinishLoad);
      view.webContents?.off?.('did-finish-load', notifyHubReady);
      view.webContents?.off?.('page-title-updated', onTitleUpdated);
      view.webContents?.off?.('did-fail-load', onDidFailLoad);
    } catch (_) {}
    try {
      if (!win.isDestroyed?.()) {
        win.off?.('resize', updateBounds);
        win.contentView.removeChildView(view);
      }
    } catch (_) {}
    try {
      if (!view.webContents?.isDestroyed?.()) {
        view.webContents.close?.();
      }
    } catch (_) {}
  };

  const fallbackToOriginal = () => {
    if (cleanedUp) return;
    const shouldFallback = !hubLoaded && !win.isDestroyed?.();
    cleanupOverlay();
    if (shouldFallback) {
      try {
        __agOrigAttachLoadingOverlay(win, foregroundColor, backgroundColor);
      } catch (_) {}
    }
  };

  const onHubFinishLoad = () => {
    hubLoaded = true;
    notifyHubReady();
    if (videoDone) cleanupOverlay();
  };

  const onDidFailLoad = (_event, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame === false) return;
    if (hubLoaded) cleanupOverlay();
    else fallbackToOriginal();
  };

  const onTitleUpdated = (_event, title) => {
    if (title === '__AG_BOOT_SKIP__' || title === '__AG_BOOT_FAIL__') {
      if (hubLoaded) cleanupOverlay();
      else fallbackToOriginal();
    } else if (title === '__AG_BOOT_DONE__') {
      videoDone = true;
      if (hubLoaded) cleanupOverlay();
    }
  };

  hardTimer = setTimeout(() => {
    if (hubLoaded) cleanupOverlay();
    else fallbackToOriginal();
  }, 12000);
  if (!hubLoaded) {
    hubContents?.once?.('did-finish-load', onHubFinishLoad);
  }
  try {
    view.webContents.on('did-finish-load', notifyHubReady);
    view.webContents.on('page-title-updated', onTitleUpdated);
    view.webContents.on('did-fail-load', onDidFailLoad);
  } catch (_) {}

  win.once?.('closed', cleanupOverlay);

  try {
    const query = { variant: __agBootVariant };
    if (__agBootWallpaper) query.wp = __agBootWallpaper;
    const loadPromise = view.webContents.loadFile(__agBootHtml, { query });
    if (loadPromise && typeof loadPromise.catch === 'function') {
      loadPromise.catch(() => {
        if (cleanedUp) return;
        if (hubLoaded) cleanupOverlay();
        else fallbackToOriginal();
      });
    }
  } catch (_) {
    fallbackToOriginal();
  }
}

function __agPatchedAttachLoadingOverlay(win, foregroundColor, backgroundColor) {
  try {
    if (!__agBootVideoPlayed && __agBootFs.existsSync(__agBootHtml) && __agBootFs.existsSync(__agBootVideo)) {
      __agBootVideoPlayed = true;
      return __agAttachBootVideoOverlay(win, foregroundColor, backgroundColor);
    }
  } catch (_) {}
  return __agOrigAttachLoadingOverlay(win, foregroundColor, backgroundColor);
}

exports.attachLoadingOverlay = __agPatchedAttachLoadingOverlay;
${LOADING_END}
`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const htmlPath = path.resolve(__dirname, 'boot-overlay.html');
  const videoName = opts.variant === 'trio' ? '反重力开场_三AI娘同框版.mp4' : '反重力开场_Gemini单人版.mp4';
  const videoPath = path.resolve(__dirname, videoName);

  if (!opts.uninstall) {
    if (!fs.existsSync(htmlPath)) throw new Error(`缺少文件: ${htmlPath}`);
    if (!fs.existsSync(videoPath)) throw new Error(`缺少视频文件: ${videoPath}`);
    if (opts.wallpaper) {
      const resolvedWp = path.resolve(opts.wallpaper);
      if (!fs.existsSync(resolvedWp)) {
        throw new Error(`找不到指定的壁纸文件: ${resolvedWp}`);
      }
      opts.wallpaper = resolvedWp;
    }
  }

  const { asarPath, isCustomPath } = resolveAsarPath(opts.asar);
  if (!isCustomPath && !opts.forceSkipRunningCheck && isAntigravityRunning()) {
    throw new Error('检测到 Antigravity 正在运行，请先彻底退出软件（Ctrl+Q）后再执行安装或卸载。');
  }

  const backupPath = `${asarPath}${BACKUP_SUFFIX}`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath);
    console.log(`已创建原始备份: ${backupPath}`);
  }

  const tempPath = `${asarPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    patchAsarFile(asarPath, tempPath, 'dist/loadingOverlay.js', rawText => {
      const cleaned = stripExistingPatch(rawText);
      if (opts.uninstall) {
        return cleaned + '\n';
      }
      if (!cleaned.includes('attachLoadingOverlay')) {
        throw new Error('dist/loadingOverlay.js 中未找到 attachLoadingOverlay，当前客户端版本可能不兼容');
      }
      return cleaned + buildLoadingPatchSnippet({
        htmlPath,
        videoPath,
        variant: opts.variant,
        wallpaperPath: opts.wallpaper,
      });
    });
    fs.renameSync(tempPath, asarPath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }

  if (opts.uninstall) {
    console.log('已成功卸载开机动画补丁，下次启动 Antigravity 将恢复原始加载界面。');
  } else {
    console.log(`安装成功！当前版本: ${opts.variant === 'trio' ? '三 AI 娘同框版' : 'Gemini 单人版'}`);
    console.log(`关联文件目录: ${__dirname}`);
    console.log('提示：请先彻底退出 Antigravity 再重新打开即可看到效果。如需自动有声播放，可在快捷方式目标后加上 --autoplay-policy=no-user-gesture-required');
  }
}

try {
  main();
} catch (err) {
  console.error(`[错误] ${err.message}`);
  process.exitCode = 1;
}
