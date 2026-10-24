'use strict';

// builds the macos control strip helper from src/native/controlStrip.m with the system compiler.
// it only rebuilds when the source or this script is newer than the last build.
// a failed build only leaves the player out of the control strip.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SOURCE = path.join(root, 'src', 'native', 'controlStrip.m');
const OUTPUT = path.join(root, 'build', 'control-strip', 'DownstreamControlStrip');

// returns the built helper, or null where there isn't one.
function buildControlStrip() {
  if (process.platform !== 'darwin') return null;
  const changed = Math.max(fs.statSync(SOURCE).mtimeMs, fs.statSync(__filename).mtimeMs);
  if (fs.existsSync(OUTPUT) && fs.statSync(OUTPUT).mtimeMs >= changed) return OUTPUT;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  try {
    // one binary for both apple silicon and intel macs, back to the legacy build's macos 10.13.
    execFileSync('clang', [
      '-fobjc-arc', '-O2',
      '-arch', 'arm64', '-arch', 'x86_64',
      '-mmacosx-version-min=10.13',
      '-framework', 'AppKit', '-framework', 'QuartzCore',
      SOURCE, '-o', OUTPUT,
    ], { stdio: 'inherit' });
    // the compiler only signs the apple silicon half, so both get an ad-hoc signature macos can assess once and cache.
    execFileSync('codesign', ['--force', '--sign', '-', OUTPUT], { stdio: 'inherit' });
    console.log('Built the control strip helper.');
    return OUTPUT;
  } catch (err) {
    console.warn(`Couldn't build the control strip helper, the player won't be in the control strip: ${err.message}`);
    return null;
  }
}

module.exports = { buildControlStrip };
