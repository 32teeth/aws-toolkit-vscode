/*!
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import globals from '../shared/extensionGlobals'

import * as nls from 'vscode-nls'
const localize = nls.loadMessageBundle()

import * as vscode from 'vscode'
import * as mdeModel from '../mde/mdeModel'
import { showViewLogsMessage } from '../shared/utilities/messages'
import { LoginWizard } from './wizards/login'
import { selectCawsResource, selectRepoForWorkspace } from './wizards/selectResource'
import { getLogger } from '../shared/logger'
import { openCawsUrl } from './utils'
import { CawsAuthenticationProvider } from './auth'
import { Commands } from '../shared/vscode/commands2'
import { CawsClient, CawsDevEnv, ConnectedCawsClient, CawsResource } from '../shared/clients/cawsClient'
import {
    createCawsEnvProvider,
    createCawsSessionProvider,
    createClientFactory,
    DevEnvId,
    getConnectedWorkspace,
    getHostNameFromEnv,
    toCawsGitUri,
} from './model'
import { showConfigureWorkspace } from './vue/configure/backend'
import { UpdateDevelopmentWorkspaceRequest } from '../../types/clientcodeaws'

type LoginResult = 'Succeeded' | 'Cancelled' | 'Failed'

export async function login(authProvider: CawsAuthenticationProvider, client: CawsClient): Promise<LoginResult> {
    // TODO: add telemetry
    const wizard = new LoginWizard(authProvider)
    const lastSession = authProvider.getActiveSession()
    const response = await wizard.run()

    if (!response) {
        return 'Cancelled'
    }

    try {
        const { accountDetails, accessDetails } = response.session
        await client.setCredentials(accessDetails, accountDetails.metadata)

        if (lastSession && response.session.id !== lastSession.id) {
            authProvider.deleteSession(lastSession)
        }

        return 'Succeeded'
    } catch (err) {
        getLogger().error('CAWS: failed to login: %O', err)
        return 'Failed'
    }
}

export async function logout(authProvider: CawsAuthenticationProvider): Promise<void> {
    const session = authProvider.getActiveSession()

    if (session) {
        return authProvider.deleteSession(session)
    }
}

/** "List CODE.AWS Commands" command. */
export async function listCommands(): Promise<void> {
    // TODO: add telemetry
    vscode.commands.executeCommand('workbench.action.quickOpen', '> CODE.AWS')
}

/** "Clone CODE.AWS Repository" command. */
export async function cloneCawsRepo(client: ConnectedCawsClient, url?: vscode.Uri): Promise<void> {
    // TODO: add telemetry

    async function getPat() {
        // FIXME: make it easier to go from auth -> client so we don't need to do this
        const auth = CawsAuthenticationProvider.fromContext(globals.context)
        return auth.getPat(client)
    }

    if (!url) {
        const r = await selectCawsResource(client, 'repo')
        if (!r) {
            return
        }
        const resource = { name: r.name, project: r.project.name, org: r.org.name }
        const uri = toCawsGitUri(client.identity.name, await getPat(), resource)
        await vscode.commands.executeCommand('git.clone', uri)
    } else {
        const [_, org, project, repo] = url.path.slice(1).split('/')
        if (!org || !project || !repo) {
            throw new Error(`Invalid CAWS URL: unable to parse repository`)
        }
        const resource = { name: repo, project, org }
        const uri = toCawsGitUri(client.identity.name, await getPat(), resource)
        await vscode.commands.executeCommand('git.clone', uri)
    }
}

/** "Create CODE.AWS Development Environment" (MDE) command. */
export async function createDevEnv(client: ConnectedCawsClient): Promise<void> {
    // TODO: add telemetry
    const repo = await selectRepoForWorkspace(client)
    const projectName = repo?.project.name
    const organizationName = repo?.org.name

    if (!projectName || !organizationName) {
        return
    }

    const args = {
        organizationName,
        projectName,
        ideRuntimes: ['VSCode'],
        repositories: [
            {
                projectName,
                repositoryName: repo.name,
                branchName: repo.defaultBranch,
            },
        ],
    }
    const env = await client.createDevEnv(args)
    try {
        await client.startEnvironmentWithProgress(
            {
                developmentWorkspaceId: env.developmentWorkspaceId,
                ...args,
            },
            'RUNNING'
        )
    } catch (err) {
        showViewLogsMessage(
            localize(
                'AWS.command.caws.createDevEnv.failed',
                'Failed to create CODE.AWS development environment in "{0}": {1}',
                projectName,
                (err as Error).message
            )
        )
    }
}

export async function openDevEnv(client: ConnectedCawsClient, env: CawsDevEnv): Promise<void> {
    const runningEnv = await client.startEnvironmentWithProgress(
        {
            developmentWorkspaceId: env.developmentWorkspaceId,
            organizationName: env.org.name,
            projectName: env.project.name,
        },
        'RUNNING'
    )
    if (!runningEnv) {
        getLogger().error('openDevEnv: failed to start environment: %s', env.developmentWorkspaceId)
        return
    }

    const deps = await mdeModel.ensureDependencies()
    if (!deps) {
        return
    }

    const provider = createCawsSessionProvider(client, deps.ssm)
    const cawsEnvProvider = createCawsEnvProvider(provider, env)
    const SessionProcess = mdeModel.createBoundProcess(cawsEnvProvider).extend({
        onStdout(stdout) {
            getLogger().verbose(`CAWS connect: ${env.id}: ${stdout}`)
        },
        onStderr(stderr) {
            getLogger().verbose(`CAWS connect: ${env.id}: ${stderr}`)
        },
        rejectOnErrorCode: true,
    })

    await mdeModel.startVscodeRemote(SessionProcess, getHostNameFromEnv(env), '/projects', deps.ssh, deps.vsc)
}

/**
 * Implements commands:
 * - "Open CODE.AWS Organization"
 * - "Open CODE.AWS Project"
 * - "Open CODE.AWS Repository"
 */
export async function openCawsResource(client: ConnectedCawsClient, kind: CawsResource['type']): Promise<void> {
    // TODO: add telemetry
    const resource = await selectCawsResource(client, kind)

    if (!resource) {
        return
    }

    if (resource.type !== 'env') {
        openCawsUrl(resource)
        return
    }

    try {
        await openDevEnv(client, resource)
    } catch (err) {
        showViewLogsMessage(
            localize(
                'AWS.command.caws.createDevEnv.failed',
                'Failed to start CODE.AWS development environment "{0}": {1}',
                resource.developmentWorkspaceId,
                (err as Error).message
            )
        )
    }
}

export async function stopWorkspace(client: ConnectedCawsClient, workspace: DevEnvId): Promise<void> {
    await client.stopDevEnv({
        developmentWorkspaceId: workspace.developmentWorkspaceId,
        projectName: workspace.project.name,
        organizationName: workspace.org.name,
    })
}

export async function deleteWorkspace(client: ConnectedCawsClient, workspace: DevEnvId): Promise<void> {
    await client.deleteDevEnv({
        developmentWorkspaceId: workspace.developmentWorkspaceId,
        projectName: workspace.project.name,
        organizationName: workspace.org.name,
    })
}

export type WorkspaceSettings = Pick<
    UpdateDevelopmentWorkspaceRequest,
    'alias' | 'instanceType' | 'inactivityTimeoutMinutes'
>

export async function updateWorkspace(
    client: ConnectedCawsClient,
    workspace: DevEnvId,
    settings: WorkspaceSettings
): Promise<void> {
    await client.updateDevelopmentWorkspace({
        ...settings,
        id: workspace.developmentWorkspaceId,
        projectName: workspace.project.name,
        organizationName: workspace.org.name,
        updateBehavior: 'restart',
    })
}

function createClientInjector(
    authProvider: CawsAuthenticationProvider,
    clientFactory: () => Promise<CawsClient>
): ClientInjector {
    return async (command, ...args) => {
        const client = await clientFactory()

        if (!client.connected) {
            const result = await login(authProvider, client)

            if (result === 'Succeeded' && client.connected) {
                return command(client, ...args)
            }

            if (result === 'Failed') {
                globals.window.showErrorMessage('AWS: Not connected to CODE.AWS')
            }

            return
        }

        return command(client, ...args)
    }
}

function createCommandDecorator(commands: CawsCommands): CommandDecorator {
    return command =>
        (...args) =>
            commands.withClient(command, ...args)
}

interface CawsCommand<T extends any[], U> {
    (client: ConnectedCawsClient, ...args: T): U | Promise<U>
}

interface ClientInjector {
    <T extends any[], U>(command: CawsCommand<T, U>, ...args: T): Promise<U | undefined>
}

interface CommandDecorator {
    <T extends any[], U>(command: CawsCommand<T, U>): (...args: T) => Promise<U | undefined>
}

type Inject<T, U> = T extends (...args: infer P) => infer R
    ? P extends [U, ...infer L]
        ? (...args: L) => R
        : never
    : never

type WithClient<T> = Parameters<Inject<T, ConnectedCawsClient>>

export class CawsCommands {
    public readonly withClient: ClientInjector
    public readonly bindClient = createCommandDecorator(this)

    public constructor(
        private readonly authProvider: CawsAuthenticationProvider,
        private readonly clientFactory = createClientFactory(authProvider)
    ) {
        this.withClient = createClientInjector(authProvider, clientFactory)
    }

    public async login() {
        return login(this.authProvider, await this.clientFactory())
    }

    public logout() {
        return logout(this.authProvider)
    }

    public cloneRepository(...args: WithClient<typeof cloneCawsRepo>) {
        return this.withClient(cloneCawsRepo, ...args)
    }

    public createWorkspace(...args: WithClient<typeof createDevEnv>) {
        return this.withClient(createDevEnv, ...args)
    }

    public openResource(...args: WithClient<typeof openCawsResource>) {
        return this.withClient(openCawsResource, ...args)
    }

    public stopWorkspace(...args: WithClient<typeof stopWorkspace>) {
        return this.withClient(stopWorkspace, ...args)
    }

    public deleteWorkspace(...args: WithClient<typeof deleteWorkspace>) {
        return this.withClient(deleteWorkspace, ...args)
    }

    public updateWorkspace(...args: WithClient<typeof updateWorkspace>) {
        return this.withClient(updateWorkspace, ...args)
    }

    public openOrganization() {
        return this.openResource('org')
    }

    public openProject() {
        return this.openResource('project')
    }

    public openRepository() {
        return this.openResource('repo')
    }

    public openWorkspace() {
        return this.openResource('env')
    }

    public listCommands() {
        return listCommands()
    }

    public async openDevFile(uri: vscode.Uri) {
        await vscode.window.showTextDocument(uri)
    }

    public async openWorkspaceSettings() {
        const workspace = await this.withClient(getConnectedWorkspace)

        if (!workspace) {
            throw new Error('No workspace available')
        }

        return showConfigureWorkspace(globals.context, workspace, CawsCommands.declared)
    }

    public static fromContext(ctx: Pick<vscode.ExtensionContext, 'secrets' | 'globalState'>) {
        const auth = CawsAuthenticationProvider.fromContext(ctx)
        const factory = createClientFactory(auth)

        return new this(auth, factory)
    }

    public static readonly declared = {
        login: Commands.from(this).declareLogin('aws.caws.connect'),
        logout: Commands.from(this).declareLogout('aws.caws.logout'),
        openResource: Commands.from(this).declareOpenResource('aws.caws.openResource'),
        cloneRepo: Commands.from(this).declareCloneRepository('aws.caws.cloneRepo'),
        listCommands: Commands.from(this).declareListCommands('aws.caws.listCommands'),
        createWorkspace: Commands.from(this).declareCreateWorkspace('aws.caws.createDevEnv'),
        openOrganization: Commands.from(this).declareOpenOrganization('aws.caws.openOrg'),
        openProject: Commands.from(this).declareOpenProject('aws.caws.openProject'),
        openRepository: Commands.from(this).declareOpenRepository('aws.caws.openRepo'),
        openWorkspace: Commands.from(this).declareOpenWorkspace('aws.caws.openDevEnv'),
        stopWorkspace: Commands.from(this).declareStopWorkspace('aws.caws.stopWorkspace'),
        deleteWorkspace: Commands.from(this).declareDeleteWorkspace('aws.caws.deleteWorkspace'),
        updateWorkspace: Commands.from(this).declareUpdateWorkspace('aws.caws.updateWorkspace'),
        openDevFile: Commands.from(this).declareOpenDevFile('aws.caws.openDevFile'),
        openWorkspaceSettings: Commands.from(this).declareOpenWorkspaceSettings('aws.caws.openWorkspaceSettings'),
    } as const
}
