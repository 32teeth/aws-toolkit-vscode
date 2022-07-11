/*!
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert'
import * as vscode from 'vscode'
import { createURIFromArgs, parseCloudWatchLogsUri, uriToKey } from '../../cloudWatchLogs/cloudWatchLogsUtils'
import { CLOUDWATCH_LOGS_SCHEME } from '../../shared/constants'

const goodComponents = {
    logGroupInfo: {
        groupName: 'theBeeGees',
        regionName: 'ap-southeast-2',
    },
    parameters: { streamName: 'islandsInTheStream' },
}

const goodUri = createURIFromArgs(goodComponents.logGroupInfo, goodComponents.parameters)

describe('parseCloudWatchLogsUri', async function () {
    it('converts a valid URI to components', function () {
        const result = parseCloudWatchLogsUri(goodUri)
        assert.deepStrictEqual(result.logGroupInfo, goodComponents.logGroupInfo)
        assert.deepStrictEqual(result.parameters, goodComponents.parameters)
    })

    it('does not convert URIs with an invalid scheme', async function () {
        assert.throws(() => {
            parseCloudWatchLogsUri(vscode.Uri.parse('wrong:scheme'))
        })
    })

    it('does not convert URIs with more or less than three elements', async function () {
        assert.throws(() => {
            parseCloudWatchLogsUri(vscode.Uri.parse(`${CLOUDWATCH_LOGS_SCHEME}:elementOne:elementTwo`))
        })

        assert.throws(() => {
            parseCloudWatchLogsUri(
                vscode.Uri.parse(`${CLOUDWATCH_LOGS_SCHEME}:elementOne:elementTwo:elementThree:whoopsAllElements`)
            )
        })
    })
})

describe('createURIFromArgs', function () {
    it('converts components to a valid URI that can be parsed.', function () {
        const testUri = vscode.Uri.parse(
            `${CLOUDWATCH_LOGS_SCHEME}:${goodComponents.logGroupInfo.groupName}:${
                goodComponents.logGroupInfo.regionName
            }?${encodeURIComponent(JSON.stringify(goodComponents.parameters))}`
        )
        assert.deepStrictEqual(testUri, goodUri)
        const testComponents = parseCloudWatchLogsUri(testUri)
        assert.deepStrictEqual(testComponents, goodComponents)
    })
})

describe('uriToKey', function () {
    let testUri: vscode.Uri
    before(function () {
        testUri = vscode.Uri.parse(
            `${CLOUDWATCH_LOGS_SCHEME}:g:r
            ?${encodeURIComponent(JSON.stringify(goodComponents.parameters))}`
        )
    })

    it('creates unique strings for Uri with different parameters', function () {
        const diffParameters = { streamName: 'NotIslandsInTheStream' }

        const uriDiffParameters = vscode.Uri.parse(
            `${CLOUDWATCH_LOGS_SCHEME}:g:r
            ?${encodeURIComponent(JSON.stringify(diffParameters))}`
        )

        assert.notStrictEqual(uriToKey(testUri), uriToKey(uriDiffParameters))
    })

    it('creates unique strings for Uri with different log group info', function () {
        const uriDiffGroup = vscode.Uri.parse(
            `${CLOUDWATCH_LOGS_SCHEME}:g2:r2
            ?${encodeURIComponent(JSON.stringify(goodComponents.parameters))}`
        )

        assert.notStrictEqual(uriToKey(testUri), uriToKey(uriDiffGroup))
    })
})
