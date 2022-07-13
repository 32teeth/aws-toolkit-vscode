/*!
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { LogStreamRegistry } from '../registry/logStreamRegistry'
import { getLogger } from '../../shared/logger'
import { uriToKey, findOccurencesOf } from '../cloudWatchLogsUtils'

export class LogStreamDocumentProvider implements vscode.TextDocumentContentProvider {
    // Expose an event to signal changes of _virtual_ documents
    // to the editor
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>()
    public get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event
    }

    public constructor(private readonly registry: LogStreamRegistry) {
        this.registry.onDidChange(uri => {
            getLogger().debug(`Registry item changed: ${uri.path}`)
            this._onDidChange.fire(uri)
        })
    }

    public highlightDocument(uri: vscode.Uri): void {
        const textEditor = this.registry.getTextEditor(uri)
        const logData = this.registry.getLog(uri)

        if (!logData) {
            throw new Error(`Missing log data in registry for uri key: ${uriToKey(uri)}. Unable to highlight`)
        }

        if (!textEditor) {
            throw new Error(`Missing textEditor in registry for uri key: ${uriToKey(uri)}. Unable to highlight`)
        }

        if (logData.parameters.filterPattern) {
            const highlighter = vscode.window.createTextEditorDecorationType({ backgroundColor: 'yellow' })
            const ranges = findOccurencesOf(textEditor.document, logData.parameters.filterPattern)
            textEditor.setDecorations(highlighter, ranges)
        }
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        // get latest content and return
        const content = this.registry.getLogContent(uri, { timestamps: true })
        if (!content) {
            getLogger().error(`No content found for URI: ${uri}`)
        }

        return content ?? ''
    }
}
