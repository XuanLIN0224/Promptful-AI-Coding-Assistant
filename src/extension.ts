import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("promptful.openWorkspace", () => {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const panel = vscode.window.createWebviewPanel(
      "promptfulWorkspace",
      "Promptful",
      column ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );

    panel.webview.html = getWebviewContent(context.extensionUri, panel.webview);

    type OpenFilePayload = { path: string; content: string; languageId: string };
    type GeneratedFilePayload = { path: string; content: string };
    let generatedFileUris: vscode.Uri[] = [];

    const safeWorkspaceTarget = (
      root: vscode.Uri,
      relativePath: string
    ): { fileUri: vscode.Uri; directoryUri: vscode.Uri } | null => {
      const normalisedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parts = normalisedPath.split("/").filter(Boolean);
      if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
        return null;
      }

      return {
        fileUri: vscode.Uri.joinPath(root, ...parts),
        directoryUri: parts.length > 1 ? vscode.Uri.joinPath(root, ...parts.slice(0, -1)) : root,
      };
    };

    const coerceGeneratedFiles = (input: unknown): GeneratedFilePayload[] => {
      if (!Array.isArray(input)) return [];
      return input.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.path !== "string" || typeof candidate.content !== "string") return [];
        return [{ path: candidate.path, content: candidate.content }];
      });
    };

    const collectOpenFiles = async (): Promise<OpenFilePayload[]> => {
      const files = vscode.workspace.textDocuments
        .filter((d) => d.uri.scheme === "file")
        .map((d) => d.uri.fsPath);
      const generated = generatedFileUris.map((uri) => uri.fsPath);
      const unique = [...new Set([...generated, ...files])];
      const out: OpenFilePayload[] = [];
      for (const fsPath of unique) {
        try {
          const uri = vscode.Uri.file(fsPath);
          const doc = await vscode.workspace.openTextDocument(uri);
          out.push({
            path: fsPath,
            content: doc.getText(),
            languageId: doc.languageId,
          });
        } catch {
          // Ignore files that are no longer readable.
        }
      }
      return out;
    };

    const pushFilesToWebview = async () => {
      const files = await collectOpenFiles();
      const activePath = vscode.window.activeTextEditor?.document.uri.scheme === "file"
        ? vscode.window.activeTextEditor.document.uri.fsPath
        : null;
      void panel.webview.postMessage({
        type: "promptful/files",
        files,
        activePath,
      });
    };
    const codeColumnForPanel = (): vscode.ViewColumn => {
      if (panel.viewColumn === vscode.ViewColumn.Three) return vscode.ViewColumn.Two;
      if (panel.viewColumn === vscode.ViewColumn.Two) return vscode.ViewColumn.One;
      return vscode.ViewColumn.One;
    };

    const openDocInCodeColumn = async (doc: vscode.TextDocument, preserveFocus: boolean) => {
      await vscode.window.showTextDocument(doc, {
        viewColumn: codeColumnForPanel(),
        preview: false,
        preserveFocus,
      });
    };

    const closeDuplicateInPromptfulColumn = async (uri: vscode.Uri) => {
      if (!panel.viewColumn) return;
      const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === panel.viewColumn);
      if (!group) return;
      const dupes = group.tabs.filter((tab) => {
        const input = tab.input;
        return input instanceof vscode.TabInputText && input.uri.toString() === uri.toString();
      });
      if (dupes.length > 0) {
        await vscode.window.tabGroups.close(dupes, true);
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "promptful/requestFiles") {
        await pushFilesToWebview();
        return;
      }
      if (msg.type === "promptful/applyPlan") {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) {
          void vscode.window.showWarningMessage("Promptful: Open a workspace before applying the plan.");
          return;
        }

        const files = coerceGeneratedFiles(msg.files);
        const writtenUris: vscode.Uri[] = [];
        for (const file of files) {
          const target = safeWorkspaceTarget(root, file.path);
          if (!target) continue;
          try {
            await vscode.workspace.fs.createDirectory(target.directoryUri);
            await vscode.workspace.fs.writeFile(target.fileUri, Buffer.from(file.content, "utf8"));
            writtenUris.push(target.fileUri);
          } catch {
            // Keep the mock workflow moving if one generated file cannot be written.
          }
        }

        if (writtenUris.length === 0) {
          void vscode.window.showWarningMessage("Promptful: No starter files could be generated.");
          return;
        }
        generatedFileUris = writtenUris;

        try {
          const doc = await vscode.workspace.openTextDocument(writtenUris[0]);
          await openDocInCodeColumn(doc, false);
          await closeDuplicateInPromptfulColumn(writtenUris[0]);
        } catch {
          // The files were still generated even if VS Code cannot open the first one immediately.
        }

        await pushFilesToWebview();
        void vscode.window.showInformationMessage(`Promptful: Generated ${writtenUris.length} starter files in src.`);
        return;
      }
      if (msg.type === "promptful/openFile" && typeof msg.path === "string") {
        try {
          const uri = vscode.Uri.file(msg.path);
          const doc = await vscode.workspace.openTextDocument(uri);
          await openDocInCodeColumn(doc, false);
          await closeDuplicateInPromptfulColumn(uri);
          await pushFilesToWebview();
        } catch {
          // ignore
        }
        return;
      }
      if (msg.type === "promptful/openExternal" && typeof msg.url === "string") {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } catch {
          // ignore
        }
        return;
      }
      if (msg.type === "promptful/openWorkspaceFileByName" && typeof msg.fileName === "string") {
        const raw = msg.fileName.trim();
        const base = raw.replace(/^.*[/\\]/, "").trim() || raw;
        if (!base) return;
        try {
          const results = await vscode.workspace.findFiles(`**/${base}`, "{**/node_modules/**,**/.git/**}", 8);
          if (results.length === 0) {
            void vscode.window.showInformationMessage(`Promptful: Could not find "${base}" in the workspace.`);
            return;
          }
          let target = results[0];
          if (results.length > 1) {
            const pickedPath = await vscode.window.showQuickPick(
              results.map((u) => vscode.workspace.asRelativePath(u)),
              { title: `Multiple matches for "${base}"`, placeHolder: "Choose a file" }
            );
            if (!pickedPath) return;
            const match = results.find((u) => vscode.workspace.asRelativePath(u) === pickedPath);
            if (match) target = match;
          }
          try {
            const doc = await vscode.workspace.openTextDocument(target);
            await openDocInCodeColumn(doc, false);
            await closeDuplicateInPromptfulColumn(target);
          } catch {
            await vscode.commands.executeCommand("vscode.open", target);
          }
          void pushFilesToWebview();
        } catch {
          void vscode.window.showWarningMessage(`Promptful: Unable to open "${base}".`);
        }
        return;
      }
    });

    let isRelocatingEditor = false;
    const subs: vscode.Disposable[] = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (
          !isRelocatingEditor &&
          editor &&
          editor.document.uri.scheme === "file" &&
          panel.viewColumn &&
          editor.viewColumn === panel.viewColumn
        ) {
          isRelocatingEditor = true;
          void openDocInCodeColumn(editor.document, false)
            .then(() => closeDuplicateInPromptfulColumn(editor.document.uri))
            .finally(() => {
              isRelocatingEditor = false;
            });
        }
        void pushFilesToWebview();
      }),
      vscode.workspace.onDidOpenTextDocument(() => {
        void pushFilesToWebview();
      }),
      vscode.workspace.onDidCloseTextDocument(() => {
        void pushFilesToWebview();
      }),
      vscode.workspace.onDidChangeTextDocument(() => {
        void pushFilesToWebview();
      }),
    ];
    panel.onDidDispose(() => {
      for (const s of subs) s.dispose();
    });
    void pushFilesToWebview();
  });

  context.subscriptions.push(disposable);
}

function getWebviewContent(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "assets", "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "assets", "index.css"));
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Promptful</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    setTimeout(() => {
      const root = document.getElementById("root");
      if (root && root.childElementCount === 0) {
        root.innerHTML = '<div style="box-sizing:border-box;min-height:100vh;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1d1d1f;background:#f5f5f7;"><h1 style="font-size:16px;margin:0 0 8px;">Promptful webview did not start</h1><p style="font-size:13px;line-height:1.5;margin:0;color:#6e6e73;">Run <code>npm run build:webview</code>, then restart the Extension Development Host. If this message stays, open Developer Tools and check the Console.</p></div>';
      }
    }, 1200);
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {}
