# Promptful Sync

Promptful Sync is a mock VS Code extension for evaluating a promptful collaborative AI coding workflow. It demonstrates decision trees, cluster layers, local and global context, source assignment, and generated starter files without connecting to a real AI model.

This project is designed for student evaluation sessions. All assistant behaviour is hard-coded or simulated.

## What You Need

- Visual Studio Code
- Git
- Node.js 20 LTS or newer
- npm, which comes with Node.js

## Get The Latest Version From Main

If you do not have the repository yet:

```bash
git clone https://github.com/XuanLIN0224/Promptful-AI-Coding-Assistant.git
cd Promptful-AI-Coding-Assistant
git checkout main
npm install
```

If you already cloned it:

```bash
cd Promptful-AI-Coding-Assistant
git checkout main
git pull origin main
npm install
```

Run this any time before a study session to make sure you have the newest version:

```bash
git checkout main
git pull origin main
npm install
```

## Run The Extension In VS Code

1. Open the repository folder in VS Code.
2. Open the Run and Debug panel.
3. Choose `Run Extension`.
4. Press the green play button, or press `F5`.
5. A new window called Extension Development Host will open.
6. In that new window, open the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows.
7. Run `Promptful: Open Collaborative Workspace`.

The Promptful mock workspace should open inside VS Code.

## If The Webview Looks Blank

First, run:

```bash
npm run vscode:prepublish
```

Then start `Run Extension` again from VS Code.

If it still looks blank, open Developer Tools in the Extension Development Host and check the Console for errors.

## Evaluation Notes

- The extension does not call ChatGPT, Gemini, Claude, or any real AI model.
- The model selector on the start page is only part of the mock interface.
- The Terminus scenario, cluster generation, node expansion, source assignment, and file generation are simulated.
- Applying the plan writes starter files into `src/` in the currently opened VS Code workspace.
- For a clean test run, use a fresh workspace folder or delete generated `src/` files before starting again.

## Useful Commands

Install dependencies:

```bash
npm install
```

Compile the extension TypeScript:

```bash
npm run compile
```

Build the webview:

```bash
npm run build:webview
```

Build everything required before launching:

```bash
npm run vscode:prepublish
```

## Updating During Development

When a new version is pushed to GitHub:

```bash
git checkout main
git pull origin main
npm install
npm run vscode:prepublish
```

Then restart the Extension Development Host.

## Troubleshooting

- If VS Code says the active editor must contain an openable resource, make sure you are running the extension from the repository folder, not from a loose file.
- If `npm install` fails, check that Node.js is installed and that you are inside the repository folder.
- If `Promptful: Open Collaborative Workspace` does not appear, make sure you launched the Extension Development Host with `Run Extension`.
- If generated files do not appear, open a normal workspace folder in the Extension Development Host before clicking Apply Plan.

