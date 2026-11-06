const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const path = require('path');
const fs = require('fs');
const { buildControlStrip } = require('./scripts/buildControlStrip');

// downstream for legacy macos, the same app built to run on macos 10.13 and 10.14 (see duild-mac-legacy.sh).
// it brings its own python and runs yt-dlp's platform-independent build, prepared in build/legacy by scripts/prepareLegacy.js.
const legacy = process.env.DOWNSTREAM_LEGACY === '1';

function copyDirSync(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (skip(srcPath)) continue;
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, skip);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = {
  // the legacy build has its own folder, so building both keeps both.
  outDir: legacy ? 'out-legacy' : 'out',
  packagerConfig: {
    asar: true,
    appBundleId: 'com.stratabytes.downstream',
    darwinDarkModeSupport: true,
    // ad-hoc signs on macos (no apple developer account needed).
    // a fully unsigned bundle makes macos run its xprotect/syspolicyd first-exec assessment on every executable in the bundle with nothing cacheable by code-hash, which causes a long first-launch hang on every reinstall.
    // ad-hoc signatures give each binary a cdhash the system can assess once and cache. only applies when building on darwin.
    // hardenedRuntime must stay off: @electron/osx-sign defaults it to true, which enables macOS Library Validation.
    // library validation requires every loaded framework to share the main executable's Team ID, but ad-hoc signatures have no Team ID at all -- so a hardened-runtime + ad-hoc build can never load its own Electron Framework.framework.
    // this was silent on Ventura but hard-crashed on Monterey at launch with a dyld "Library not loaded" error (see CrashLog(montery)/*.ips). Hardened runtime only matters for notarized, real-Developer-ID builds anyway, which this isn't.
    // NOTE: @electron/osx-sign v1 ignores a top-level hardenedRuntime (legacy electron-osx-sign API); it must come from optionsForFile, whose defaults hardcode hardenedRuntime: true.
    ...(process.platform === 'darwin' ? {
      osxSign: {
        identity: '-',
        identityValidation: false,
        optionsForFile: () => ({ hardenedRuntime: false }),
        // the unpacked yt-dlp keeps the signature it ships with.
        // its bundled python framework can't be re-signed ("bundle format is ambiguous"), which stops signing and leaves the whole app unsigned.
        ignore: (file) => file.includes('/Contents/Resources/yt-dlp_macos/'),
      },
    } : {}),
    icon: process.platform === 'darwin'
      ? 'assets/icons/mac/icon'
      : 'assets/icons/win/icon',
    // linux names its program in lowercase, as packages there do, and the other platforms keep theirs.
    ...(process.platform === 'linux' ? { executableName: 'downstream' } : {}),
    extraResource: {
      darwin: [
        './node_modules/ffmpeg-static/ffmpeg',
        `./node_modules/ffprobe-static/bin/darwin/${process.arch}/ffprobe`,
        ...(legacy
          ? ['./build/legacy/yt-dlp_macos', './build/legacy/python']
          : ['./node_modules/yt-dlp-exec/bin/yt-dlp_macos']),
      ],
      // the window icon comes along as a file, since linux has no icon inside the program itself.
      linux: [
        './node_modules/ffmpeg-static/ffmpeg',
        `./node_modules/ffprobe-static/bin/linux/${process.arch}/ffprobe`,
        './node_modules/yt-dlp-exec/bin/yt-dlp_linux',
        './assets/icons/png/512.png',
      ],
    }[process.platform] || [
      './node_modules/ffmpeg-static/ffmpeg.exe',
      `./node_modules/ffprobe-static/bin/win32/${process.arch}/ffprobe.exe`,
      './node_modules/yt-dlp-exec/bin/yt-dlp.exe',
    ],
  },
  hooks: {
    // the control strip helper is built before running or packaging on macos.
    generateAssets: async () => {
      buildControlStrip();
    },
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform) => {
      const rootDeps = ['ytdl-core', 'yt-dlp-exec'];
      const projectNM = path.resolve(__dirname, 'node_modules');
      // the mac and linux yt-dlp builds ship as extra resources, not inside the app archive.
      const macYtDlpDir = path.join(projectNM, 'yt-dlp-exec', 'bin', 'yt-dlp_macos');
      const linuxYtDlp = path.join(projectNM, 'yt-dlp-exec', 'bin', 'yt-dlp_linux');

      function resolvePkgDir(pkgName, searchFrom) {
        try {
          const pkgJson = require.resolve(path.join(pkgName, 'package.json'), {
            paths: [searchFrom],
          });
          return path.dirname(pkgJson);
        } catch {
          const top = path.join(projectNM, pkgName);
          if (fs.existsSync(top)) return top;
          return null;
        }
      }

      function collectDeps(pkgName, searchFrom, visited = new Set()) {
        const srcDir = resolvePkgDir(pkgName, searchFrom);
        if (!srcDir || visited.has(srcDir)) return;
        visited.add(srcDir);

        const relFromNM = path.relative(projectNM, srcDir);
        const destDir = path.join(buildPath, 'node_modules', relFromNM);
        copyDirSync(srcDir, destDir, (p) => p === macYtDlpDir || p === linuxYtDlp);

        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
          for (const dep of Object.keys(pkg.dependencies || {})) {
            collectDeps(dep, srcDir, visited);
          }
        } catch {}
      }

      const visited = new Set();
      for (const dep of rootDeps) {
        collectDeps(dep, projectNM, visited);
      }

      // the control strip helper ships in resources beside the other macos binaries.
      if (platform === 'darwin') {
        const helper = buildControlStrip();
        if (helper) {
          const dest = path.join(buildPath, '..', path.basename(helper));
          fs.copyFileSync(helper, dest);
          fs.chmodSync(dest, 0o755);
        }
      }
    },
  },
  rebuildConfig: {
    onlyModules: [],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Downstream',
        setupIcon: 'assets/icons/win/icon.ico',
        iconUrl: 'file://' + path.join(__dirname, 'assets', 'icons', 'win', 'icon.ico'),
        // the loop shown in a small window while setup installs.
        loadingGif: 'assets/icons/win/installing.gif',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: legacy ? 'Downstream for Legacy macOS' : 'Downstream',
        icon: 'assets/icons/mac/icon.icns',
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'downstream',
          productName: 'Downstream',
          genericName: 'Media Downloader and Player',
          description: 'Save media from the internet, and play your local media library.',
          productDescription: 'Downstream saves media from the internet and plays your local media library, with an EQ, even volume, visualizers and folders of your own.',
          bin: 'downstream',
          icon: 'assets/icons/png/512.png',
          categories: ['AudioVideo', 'Audio', 'Video'],
          section: 'sound',
          maintainer: 'StrataBytes',
          homepage: 'https://github.com/StrataBytes/Downstream',
          // ubuntu 24.04 and newer need a small apparmor profile for electron's sandbox, written and removed by these.
          scripts: {
            postinst: 'scripts/linux/postinst',
            postrm: 'scripts/linux/postrm',
          },
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new VitePlugin({
      build: [
        {
          entry: 'src/main.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'src/preload.js',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
        {
          // vite's main-process build doesn't inline local relative requires, leaving them as literal `require('./x')` resolved at runtime relative to the output directory.
          // main.js's require('./binaryRecovery') needs this file built to .vite/build/binaryRecovery.js alongside it, in both dev and packaged builds.
          entry: 'src/binaryRecovery.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          // same as above, for touchBar.js.
          entry: 'src/touchBar.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          // same as above, for ytDlpMacos.js.
          entry: 'src/ytDlpMacos.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          // same as above, for controlStrip.js, which touchBar.js requires.
          entry: 'src/controlStrip.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
