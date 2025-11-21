const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('GraphBus E2E', () => {
    let electronApp;
    let window;

    test.beforeAll(async () => {
        // Launch Electron app
        electronApp = await electron.launch({
            args: [path.join(__dirname, '../../main.js')],
            env: { ...process.env, NODE_ENV: 'test' }
        });

        // Get the first window
        window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('Create App Workflow', async () => {
        // 1. Verify Welcome Screen
        const welcomeHeader = await window.locator('h1');
        await expect(welcomeHeader).toContainText('Welcome to GraphBus');

        // 2. Verify buttons are visible
        const createButton = window.locator('button:has-text("Create Project")').first();
        const openButton = window.locator('button:has-text("Open Project")');

        await expect(createButton).toBeVisible();
        await expect(openButton).toBeVisible();

        // 3. Click "Create Project" button
        await createButton.click();

        // 4. Verify modal opens
        const modal = window.locator('#newProjectForm');
        await expect(modal).toBeVisible({ timeout: 5000 });

        console.log('✅ Welcome screen and buttons working correctly!');
    });
});
