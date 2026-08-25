// In-memory IndexedDB shim for exercising Rushd's real production storage code
// in Node. Implements the exact API surface index.html uses: open with
// onupgradeneeded, single/multi-store transactions, put/delete/get/getAll,
// date-index getAll, deleteDatabase (including a blockable path), and
// transaction-scoped atomicity — writes buffer per transaction and commit only
// on complete, so an aborted transaction leaves no partial state behind.
//
// Fault injection:
//   shim.state.failNextWriteTransaction = { reason: 'injected' }
//     — the next readwrite transaction aborts instead of committing.
//   shim.state.failNextReadTransaction = { reason: 'injected' }
//     — the next readonly transaction errors instead of resolving.
//   shim.state.blockDeleteDatabase = true
//     — deleteDatabase fires onblocked while another simulated tab holds the
//       database open; resolveBlockedDelete() releases it and fires onsuccess.
//   shim.state.transactionLog
//     — records every transaction { stores, mode, writes, committed, aborted }.

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

class ShimDOMException extends Error {
    constructor(message, name) {
        super(message);
        this.name = name;
    }
}

const makeRequest = () => {
    const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        _done: false
    };
    return request;
};

const settleRequest = (request, error) => {
    if (request._done) return;
    request._done = true;
    if (error) {
        request.error = error;
        if (typeof request.onerror === 'function') request.onerror({ target: request });
    } else {
        if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
    }
};

const createStores = () => ({
    settings: { keyPath: 'key', data: new Map(), indexes: {} },
    templates: { keyPath: 'id', data: new Map(), indexes: {} },
    expenses: { keyPath: 'id', data: new Map(), indexes: { date: 'date', isPaid: 'isPaid' } }
});

export function createIdbShim() {
    const state = {
        failNextWriteTransaction: null,
        failNextReadTransaction: null,
        blockDeleteDatabase: false,
        transactionLog: [],
        deleteDatabaseRequests: [],
        externalConnections: new Set(), // simulated open connections from "other tabs"
        lateCompletionHandlers: []
    };

    const databases = new Map(); // name -> { version, stores }

    const getDatabase = (name) => {
        if (!databases.has(name)) {
            databases.set(name, { version: 1, stores: createStores() });
        }
        return databases.get(name);
    };

    const releaseExternalConnections = () => {
        state.externalConnections.clear();
    };

    const idb = {
        async _inspect(name) {
            const db = databases.get(name);
            if (!db) return { exists: false };
            const snapshot = {};
            for (const [storeName, store] of Object.entries(db.stores)) {
                snapshot[storeName] = Array.from(store.data.values()).map((value) => JSON.parse(JSON.stringify(value)));
            }
            return { exists: true, version: db.version, stores: snapshot };
        },

        open(name, version) {
            const request = makeRequest();
            nextTick().then(() => {
                const db = getDatabase(name);
                db.version = version || db.version;
                const fakeDb = {
                    name,
                    version: db.version,
                    objectStoreNames: {
                        contains: (storeName) => Object.prototype.hasOwnProperty.call(db.stores, storeName)
                    },
                    createObjectStore: (storeName, options) => {
                        if (!db.stores[storeName]) {
                            db.stores[storeName] = { keyPath: options?.keyPath || 'id', data: new Map(), indexes: {} };
                        }
                        return {
                            createIndex: (indexName) => {
                                db.stores[storeName].indexes[indexName] = indexName;
                                return {};
                            }
                        };
                    },
                    deleteObjectStore: (storeName) => {
                        delete db.stores[storeName];
                    },
                    transaction: (storeNames, mode) => {
                        const names = Array.isArray(storeNames) ? [...storeNames] : [storeNames];
                        return createTransaction(db, names, mode || 'readonly');
                    },
                    close: () => {}
                };
                request.result = fakeDb;
                settleRequest(request, null);
            });
            return request;
        },

        deleteDatabase(name) {
            const request = makeRequest();
            const record = { name, blocked: false, completed: false, error: null };
            state.deleteDatabaseRequests.push(record);

            const attemptDeletion = () => {
                if (state.externalConnections.size > 0 || state.blockDeleteDatabase) {
                    record.blocked = true;
                    if (typeof request.onblocked === 'function') request.onblocked({ target: request });
                    // The deletion stays pending; the holder below can release it.
                    state.pendingDelete = {
                        request,
                        record,
                        complete: () => {
                            if (record.completed) return;
                            record.completed = true;
                            databases.delete(name);
                            settleRequest(request, null);
                        }
                    };
                    return;
                }
                record.completed = true;
                databases.delete(name);
                settleRequest(request, null);
            };

            nextTick().then(attemptDeletion);
            return request;
        }
    };

    // Test-control API: simulate the blocking tab closing after onblocked fired.
    const resolveBlockedDelete = () => {
        releaseExternalConnections();
        state.blockDeleteDatabase = false;
        const pending = state.pendingDelete;
        state.pendingDelete = null;
        if (pending) pending.complete();
    };

    const createTransaction = (db, storeNames, mode) => {
        const buffered = []; // { storeName, op, key, value }
        const readOnlyResults = [];
        const logEntry = {
            stores: [...storeNames],
            mode,
            writes: 0,
            committed: false,
            aborted: false
        };
        state.transactionLog.push(logEntry);

        let abortError = null;

        const extractKey = (storeName, value) => {
            const store = db.stores[storeName];
            return value[store.keyPath];
        };

        const queueOperation = (storeName, op, key, value) => {
            if (mode !== 'readwrite') {
                throw new ShimDOMException('ReadOnlyError: cannot write in a readonly transaction', 'ReadOnlyError');
            }
            buffered.push({ storeName, op, key, value });
            logEntry.writes += 1;
            return makeRequest();
        };

        const tx = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            objectStore: (storeName) => {
                const store = db.stores[storeName];
                if (!store) {
                    throw new ShimDOMException(`NotFoundError: no store ${storeName}`, 'NotFoundError');
                }
                return {
                    put: (value) => queueOperation(storeName, 'put', extractKey(storeName, value), value),
                    delete: (key) => queueOperation(storeName, 'delete', key, null),
                    get: (key) => {
                        const request = makeRequest();
                        const value = store.data.get(key);
                        readOnlyResults.push(() => {
                            request.result = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
                            settleRequest(request, null);
                        });
                        return request;
                    },
                    getAll: () => {
                        const request = makeRequest();
                        const values = Array.from(store.data.values());
                        readOnlyResults.push(() => {
                            request.result = values.map((value) => JSON.parse(JSON.stringify(value)));
                            settleRequest(request, null);
                        });
                        return request;
                    },
                    index: (indexName) => ({
                        getAll: (range) => {
                            const request = makeRequest();
                            const field = store.indexes[indexName];
                            const values = Array.from(store.data.values())
                                .filter((value) => field in value && (range === undefined || value[field] === range));
                            readOnlyResults.push(() => {
                                request.result = values.map((value) => JSON.parse(JSON.stringify(value)));
                                settleRequest(request, null);
                            });
                            return request;
                        }
                    })
                };
            },
            abort: () => {
                abortError = new ShimDOMException('The transaction was aborted.', 'AbortError');
                finish(false);
            }
        };

        let finished = false;
        const finish = (commit) => {
            if (finished) return;
            finished = true;
            logEntry.committed = commit;
            logEntry.aborted = !commit;
            if (commit) {
                for (const entry of buffered) {
                    const store = db.stores[entry.storeName];
                    if (entry.op === 'put') store.data.set(entry.key, JSON.parse(JSON.stringify(entry.value)));
                    if (entry.op === 'delete') store.data.delete(entry.key);
                }
                for (const run of readOnlyResults) run();
                if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx });
            } else {
                tx.error = abortError || new ShimDOMException('The transaction was aborted.', 'AbortError');
                if (typeof tx.onabort === 'function') tx.onabort({ target: tx });
                if (typeof tx.onerror === 'function') tx.onerror({ target: tx });
            }
        };

        // Commit/abort asynchronously after the synchronous request queue drains.
        nextTick().then(() => {
            if (finished) return;
            if (mode === 'readwrite' && state.failNextWriteTransaction) {
                abortError = new ShimDOMException(state.failNextWriteTransaction.reason || 'Injected write failure', 'InjectedFailure');
                state.failNextWriteTransaction = null;
                finish(false);
                return;
            }
            if (mode === 'readonly' && state.failNextReadTransaction) {
                abortError = new ShimDOMException(state.failNextReadTransaction.reason || 'Injected read failure', 'InjectedFailure');
                state.failNextReadTransaction = null;
                finish(false);
                return;
            }
            finish(true);
        });

        return tx;
    };

    return {
        idb,
        state,
        resolveBlockedDelete,
        inspect: (name) => idb._inspect(name)
    };
}

export class LocalStorageShim {
    constructor(initial = {}) {
        this._data = new Map(Object.entries(initial));
    }
    get length() {
        return this._data.size;
    }
    key(index) {
        return Array.from(this._data.keys())[index] ?? null;
    }
    getItem(key) {
        return this._data.has(key) ? this._data.get(key) : null;
    }
    setItem(key, value) {
        this._data.set(String(key), String(value));
    }
    removeItem(key) {
        this._data.delete(key);
    }
    clear() {
        this._data.clear();
    }
    snapshot() {
        return Object.fromEntries(this._data);
    }
}
