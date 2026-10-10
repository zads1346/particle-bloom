import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir: './tests/browser',
 fullyParallel: true,
 use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
 projects: [{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
 webServer: process.env.TEST_BASE_URL ? undefined : {command:'npm run preview -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
});
