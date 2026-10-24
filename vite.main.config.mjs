import { defineConfig } from 'vite';

export default defineConfig({
  // true in the legacy build for macos 10.13 and 10.14 (see duild-legacy.sh).
  define: { __DOWNSTREAM_LEGACY__: JSON.stringify(process.env.DOWNSTREAM_LEGACY === '1') },
});
