const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Debug File Editor Layout', () => {
    let electronApp;
    let window;

    test.beforeAll(async () => {
        const projectPath = '/Users/ubuntu/workbench/test_project/chat-app-2';
        electronApp = await electron.launch({
            args: [
                path.join(__dirname, '../../main.js'),
                `--dir=${projectPath}`
            ],
            env: { ...process.env, NODE_ENV: 'test' }
        });

        window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
    });

    test.afterAll(async () => {
        if (electronApp) {
            await electronApp.close();
        }
    });

    test('Inspect file editor layout and take screenshots', async () => {
        // Wait for project to load
        await window.waitForTimeout(3000);

        // Take screenshot of initial state
        await window.screenshot({ path: 'test-results/01-initial-state.png' });

        // Switch to files view
        const filesTab = window.locator('button[data-view="files"]');
        await filesTab.click();
        await window.waitForTimeout(500);

        // Take screenshot after clicking files tab
        await window.screenshot({ path: 'test-results/02-files-view.png' });

        // Log the DOM structure of the files view
        const domStructure = await window.evaluate(() => {
            const filesView = document.getElementById('filesView');
            const viewContent = filesView?.querySelector('.view-content');
            const fileEditorContainer = document.getElementById('fileEditorContainer');
            const fileEditor = document.getElementById('fileEditor');
            const fileStats = document.getElementById('fileStats');
            const stateView = document.getElementById('stateView');

            return {
                filesView: {
                    display: window.getComputedStyle(filesView).display,
                    visibility: window.getComputedStyle(filesView).visibility,
                    position: window.getComputedStyle(filesView).position,
                    zIndex: window.getComputedStyle(filesView).zIndex,
                    boundingBox: filesView.getBoundingClientRect()
                },
                viewContent: {
                    display: window.getComputedStyle(viewContent).display,
                    height: window.getComputedStyle(viewContent).height,
                    overflow: window.getComputedStyle(viewContent).overflow,
                    boundingBox: viewContent.getBoundingClientRect()
                },
                fileEditorContainer: {
                    display: window.getComputedStyle(fileEditorContainer).display,
                    flex: window.getComputedStyle(fileEditorContainer).flex,
                    boundingBox: fileEditorContainer.getBoundingClientRect()
                },
                fileEditor: {
                    display: window.getComputedStyle(fileEditor).display,
                    width: window.getComputedStyle(fileEditor).width,
                    height: window.getComputedStyle(fileEditor).height,
                    boundingBox: fileEditor.getBoundingClientRect()
                },
                fileStats: {
                    display: window.getComputedStyle(fileStats).display,
                    visibility: window.getComputedStyle(fileStats).visibility,
                    pointerEvents: window.getComputedStyle(fileStats).pointerEvents,
                    boundingBox: fileStats.getBoundingClientRect()
                },
                stateView: {
                    display: window.getComputedStyle(stateView).display,
                    visibility: window.getComputedStyle(stateView).visibility,
                    pointerEvents: window.getComputedStyle(stateView).pointerEvents,
                    zIndex: window.getComputedStyle(stateView).zIndex,
                    boundingBox: stateView.getBoundingClientRect()
                }
            };
        });

        console.log('=== DOM Structure ===');
        console.log(JSON.stringify(domStructure, null, 2));

        // Check for overlapping elements
        const overlappingElements = await window.evaluate(() => {
            const elements = document.querySelectorAll('[style*="position"], [style*="absolute"], [style*="fixed"]');
            const overlaps = [];

            elements.forEach(el => {
                if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                    const style = window.getComputedStyle(el);
                    overlaps.push({
                        id: el.id || el.className,
                        tag: el.tagName,
                        display: style.display,
                        position: style.position,
                        zIndex: style.zIndex,
                        width: style.width,
                        height: style.height,
                        top: style.top,
                        left: style.left,
                        visibility: style.visibility
                    });
                }
            });

            return overlaps;
        });

        console.log('=== Overlapping/Positioned Elements ===');
        console.log(JSON.stringify(overlappingElements, null, 2));

        // Try clicking a file to see if it opens
        await window.waitForTimeout(1000);

        // Look for any file in the tree
        const firstFile = await window.locator('.file-tree-file').first();
        if (await firstFile.isVisible()) {
            await firstFile.click();
            await window.waitForTimeout(500);

            // Take screenshot after opening file
            await window.screenshot({ path: 'test-results/03-file-opened.png' });

            const editorContent = await window.evaluate(() => {
                return document.getElementById('fileEditor').value.substring(0, 100);
            });

            console.log('File opened successfully, first 100 chars:', editorContent);
        }
    });
});
