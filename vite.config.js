// Vite builds the existing pages as they are. The shelf's classic scripts (js/, data/) and the
// files pages fetch at runtime keep their absolute paths, so they are copied into dist untouched.
// Only two env values ever reach the browser: the Supabase URL and its public (anon or
// publishable) key. Nothing else is exposed, so a service or secret key in the env stays server-side.
import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { cpSync, existsSync } from 'node:fs';

const root = import.meta.dirname;
const PAGES = ['index', 'play', 'coach', 'key'];
const RUNTIME_DIRS = ['data', 'js', 'samples', 'blog'];

// Vercel serves /play for play.html (cleanUrls); the dev server should too.
const cleanUrls = () => ({
  name: 'lt-clean-urls',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = req.url.split('?')[0];
      if (PAGES.includes(path.slice(1))) req.url = req.url.replace(path, path + '.html');
      next();
    });
  },
});

const copyRuntime = () => ({
  name: 'lt-copy-runtime',
  apply: 'build',
  closeBundle() {
    for (const dir of RUNTIME_DIRS) if (existsSync(resolve(root, dir))) cpSync(resolve(root, dir), resolve(root, 'dist', dir), { recursive: true });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    publicDir: false,
    define: {
      __LT_SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL || ''),
      __LT_SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY || ''),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: { input: Object.fromEntries(PAGES.map(p => [p, resolve(root, `${p}.html`)])) },
    },
    plugins: [cleanUrls(), copyRuntime()],
  };
});
