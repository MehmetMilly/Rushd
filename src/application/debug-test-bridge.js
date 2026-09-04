// Temporary P02 bridge for existing debug tools and production-path tests.
// P04 owns retirement or replacement of the legacy data globals and this
// mounted-proxy accessor.
/**
 * @param {typeof globalThis} environment
 * @param {import('../data/legacy-v1/runtime.js').LegacyDataRuntime} dataRuntime
 * @param {unknown} mountedProxy
 */
export function installLegacyDebugBridge(environment, dataRuntime, mountedProxy) {
    const RushdDebug = Object.freeze({
        // Read-only access for existing characterization controls. It does not
        // add any finance commands beyond the proxy the legacy build exposed.
        getAppProxy: () => mountedProxy
    });
    const bridge = {
        RushdCore: dataRuntime.Core,
        MicroSaveCore: dataRuntime.Core,
        MicroSaveStore: dataRuntime.Store,
        MicroSaveDB: dataRuntime.DB,
        RushdDebug,
        RushdImportValidation: { validateBackupPayload: dataRuntime.validateBackupPayload },
        RushdMoneyInput: { parseMoneyInput: dataRuntime.parseMoneyInput }
    };
    Object.assign(environment, bridge);
    return bridge;
}
