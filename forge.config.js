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
    icon: 'epic',
    extraResource: [
      './node_modules/ffmpeg-static/ffmpeg.exe',
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
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'DownStream',
        setupIcon: 'epic.ico',
        iconUrl: 'file://' + __dirname + '/epic.ico',
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
