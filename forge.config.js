const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const path = require('path');
const fs = require('fs');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.stratabytes.downstream',
    darwinDarkModeSupport: true,
    // ad-hoc signs on macos (no apple developer account needed).
    // a fully unsigned bundle makes macos run its xprotect/syspolicyd first-exec assessment on every executable in the bundle with nothing cacheable by code-hash, which causes a long first-launch hang on every reinstall.
    // ad-hoc signatures give each binary a cdhash the system can assess once and cache. only applies when building on darwin.
    ...(process.platform === 'darwin' ? {
      osxSign: {
        identity: '-',
        identityValidation: false,
      },
    } : {}),
    icon: process.platform === 'darwin'
      ? 'assets/icons/mac/icon'
      : 'assets/icons/win/icon',
    extraResource: process.platform === 'darwin'
      ? [
          './node_modules/ffmpeg-static/ffmpeg',
          `./node_modules/ffprobe-static/bin/darwin/${process.arch}/ffprobe`,
          './node_modules/yt-dlp-exec/bin/yt-dlp',
        ]
      : [
          './node_modules/ffmpeg-static/ffmpeg.exe',
          `./node_modules/ffprobe-static/bin/win32/${process.arch}/ffprobe.exe`,
          './node_modules/yt-dlp-exec/bin/yt-dlp.exe',
        ],
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const rootDeps = ['ytdl-core', 'yt-dlp-exec'];
      const projectNM = path.resolve(__dirname, 'node_modules');

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
        copyDirSync(srcDir, destDir);

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
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Downstream',
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
      config: {},
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
