/**
 * Application-layer sync policy (P03 Task D).
 *
 * Provider-neutral remote apply lives here so P04/P08 adapters can reuse
 * the same finance-effect path without treating a pulled operation as a
 * newly authored local command.
 */

export { applyRemoteOperation } from './apply-remote';
