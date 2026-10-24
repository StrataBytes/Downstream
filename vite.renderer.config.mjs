import { readFileSync } from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    // the version on the home screen, straight from package.json.
    __APP_VERSION__: JSON.stringify(version),
    // true in the legacy build for macos 10.13 and 10.14 (see duild-legacy.sh).
    __DOWNSTREAM_LEGACY__: JSON.stringify(process.env.DOWNSTREAM_LEGACY === '1'),
  },
});
