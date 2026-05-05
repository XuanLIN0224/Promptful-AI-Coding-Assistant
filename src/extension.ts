import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("promptful.openWorkspace", () => {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const panel = vscode.window.createWebviewPanel(
      "promptfulWorkspace",
      "Promptful",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      }
    );

    panel.webview.html = getWebviewContent(context.extensionUri, panel.webview);

    type OpenFilePayload = { path: string; content: string; languageId: string };

    const collectOpenFiles = async (): Promise<OpenFilePayload[]> => {
      const files = vscode.workspace.textDocuments
        .filter((d) => d.uri.scheme === "file")
        .map((d) => d.uri.fsPath);
      const unique = [...new Set(files)];
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
    let suppressSideOpen = false;

    const openDocInSide = async (doc: vscode.TextDocument, preserveFocus: boolean) => {
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
        preserveFocus,
      });
    };

    const ensureActiveEditorOpensInSide = async (editor: vscode.TextEditor | undefined) => {
      if (!editor) return;
      if (suppressSideOpen) return;
      if (editor.document.uri.scheme !== "file") return;
      if (editor.viewColumn === vscode.ViewColumn.Beside) return;
      suppressSideOpen = true;
      try {
        await openDocInSide(editor.document, true);
      } finally {
        setTimeout(() => {
          suppressSideOpen = false;
        }, 0);
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "promptful/requestFiles") {
        await pushFilesToWebview();
        return;
      }
      if (msg.type === "promptful/openFile" && typeof msg.path === "string") {
        try {
          const uri = vscode.Uri.file(msg.path);
          const doc = await vscode.workspace.openTextDocument(uri);
          await openDocInSide(doc, false);
          await pushFilesToWebview();
        } catch {
          // ignore
        }
      }
    });

    const subs: vscode.Disposable[] = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void ensureActiveEditorOpensInSide(editor);
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
