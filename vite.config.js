import { defineConfig } from 'vite';
export default defineConfig({
 base: './',
 build: {
  target: 'es2022',
  rollupOptions: {output: {manualChunks(id) {if (id.includes('/node_modules/three/')) return 'three';}}},
 },
 server: {host: '127.0.0.1'},
});
