/*!
 * Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert'
import { toCawsUrl } from '../../caws/utils'
import * as caws from '../../shared/clients/cawsClient'

describe('cawsClient', function () {
    it('toCawsUrl()', async function () {
        const org: caws.CawsOrg = {
            id: 'orgid1',
            name: 'org1',
        }
        const project: caws.CawsProject = {
            org: org,
            id: 'projectid1',
            name: 'project1',
        }
        const repo: caws.CawsRepo = {
            org: org,
            project: project,
            id: 'repoid1',
            name: 'repo1',
        }
        const prefix = `https://${caws.cawsHostname}/organizations`
        assert.deepStrictEqual(toCawsUrl(org), `${prefix}/org1/view`)
        assert.deepStrictEqual(toCawsUrl(project), `${prefix}/org1/projects/project1/view`)
        assert.deepStrictEqual(toCawsUrl(repo), `${prefix}/org1/projects/project1/source-repositories/repo1/view`)
    })
})
