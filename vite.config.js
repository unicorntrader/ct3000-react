import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CT3000 was created with Create React App and ran on react-scripts. CRA
// was deprecated by Meta in 2023 and accumulated unfixable transitive
// vulnerabilities (29 reported by `npm audit` before the swap, all
// build-time tooling). Vite is the lower-friction replacement: same React
// code, same Tailwind/PostCSS pipeline, same React Router, same
// Supabase + Stripe integrations -- just a maintained build tool.
//
// Notes for future-me:
// - envPrefix accepts both VITE_ and REACT_APP_ during the migration so
//   we don't have to flip every Vercel project env var on the same day.
//   Once Vercel is fully renamed to VITE_*, drop REACT_APP_ here.
// - server.port pins the dev server to 3000 to match the CRA muscle
//   memory + Vercel `vercel dev` proxy expectations.
// - build.outDir is `dist` (Vite default). vercel.json was updated to
//   point at it; CRA's `build/` directory is no longer produced.
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
