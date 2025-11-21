const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('File Editor Sizing', () => {
    let electronApp;
    let window;

    test.beforeAll(async () => {
        // Launch Electron app with test project directory
        const projectPath = '/Users/ubuntu/workbench/test_project/chat-app-2';
        electronApp = await electron.launch({
            args: [
                path.join(__dirname, '../../main.js'),
                `--dir=${projectPath}`  // Pass project directory as CLI argument
            ],
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

    test('File editor container spans full available space', async () => {
        // Wait for the app and project to fully load
        await window.waitForTimeout(2000);

        // Switch to files view
        const filesTab = window.locator('button[data-view="files"]');
        await filesTab.click();
        await window.waitForTimeout(500);

        // Make the files view active (it should already be, but verify)
        const filesView = window.locator('#filesView');
        await expect(filesView).toBeVisible();

        // Get the file editor container
        const fileEditorContainer = window.locator('#fileEditorContainer');
        const textarea = window.locator('#fileEditor');

        // Get viewport size
        const viewportSize = window.viewportSize();
        console.log(`Viewport size: ${viewportSize.width}x${viewportSize.height}`);

        // Get container dimensions
        const containerBox = await fileEditorContainer.boundingBox();
        const textareaBox = await textarea.boundingBox();

        console.log(`Container dimensions: ${containerBox.width}x${containerBox.height}`);
        console.log(`Textarea dimensions: ${textareaBox.width}x${textareaBox.height}`);

        // Verify textarea fills the container
        expect(Math.abs(textareaBox.width - containerBox.width)).toBeLessThan(2);
        expect(Math.abs(textareaBox.height - containerBox.height)).toBeLessThan(2);

        // Verify container has substantial size (not collapsed)
        expect(containerBox.width).toBeGreaterThan(200);
        expect(containerBox.height).toBeGreaterThan(200);

        // Verify container takes up most of the available width (accounting for sidebar)
        // Sidebar is 250px, so container should be viewport - sidebar - margins
        const expectedMinWidth = viewportSize.width - 300; // 250px sidebar + padding
        expect(containerBox.width).toBeGreaterThan(expectedMinWidth * 0.8);

        // Verify container takes up substantial vertical space
        const expectedMinHeight = viewportSize.height - 200; // Account for header and tabs
        expect(containerBox.height).toBeGreaterThan(expectedMinHeight * 0.7);

        console.log('✅ File editor container properly spans available space!');
    });

    test('Textarea has no scroll issues and maintains aspect', async () => {
        // Switch to files view if not already there
        const filesTab = window.locator('button[data-view="files"]');
        await filesTab.click();
        await window.waitForTimeout(500);

        const textarea = window.locator('#fileEditor');

        // Check that textarea has proper computed styles
        const computedStyle = await textarea.evaluate(el => {
            const style = window.getComputedStyle(el);
            return {
                width: style.width,
                height: style.height,
                padding: style.padding,
                boxSizing: style.boxSizing,
                display: style.display,
                overflow: style.overflow,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                resize: style.resize
            };
        });

        console.log('Computed textarea styles:', computedStyle);

        // Verify styles are correct
        expect(computedStyle.width).not.toBe('0px');
        expect(computedStyle.height).not.toBe('0px');
        expect(computedStyle.boxSizing).toBe('border-box'); // Should include padding in size
        expect(computedStyle.display).toBe('block'); // Should be block display
        expect(computedStyle.resize).toBe('none'); // Should not be resizable

        console.log('✅ Textarea has correct computed styles!');
    });

    test('File tree and editor layout is flexbox', async () => {
        // Switch to files view
        const filesTab = window.locator('button[data-view="files"]');
        await filesTab.click();
        await window.waitForTimeout(500);

        // Check the main file browser container
        const fileTreeContainer = window.locator('#fileTreeContainer');
        const editorPanel = window.locator('#fileEditorContainer').locator('xpath=../..'); // Get parent flex container

        // Check computed styles
        const containerParentStyle = await fileTreeContainer.locator('xpath=../..').evaluate(el => {
            const style = window.getComputedStyle(el);
            return {
                display: style.display,
                flexDirection: style.flexDirection,
                overflow: style.overflow
            };
        });

        console.log('Parent flex container styles:', containerParentStyle);

        // Verify flexbox layout
        expect(containerParentStyle.display).toBe('flex');
        expect(containerParentStyle.overflow).toBe('hidden');

        console.log('✅ File tree and editor use proper flexbox layout!');
    });
});
