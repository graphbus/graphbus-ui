const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    expect: {
        timeout: 10000
    },
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
});
