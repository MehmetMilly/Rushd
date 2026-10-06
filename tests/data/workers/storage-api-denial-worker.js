/* global DOMException: false, navigator: false */

import '/harness/v2-worker.js';

const storageManager = navigator.storage;
const originalGetDirectory = storageManager.getDirectory.bind(storageManager);
let denyNextDirectory = true;

Object.defineProperty(storageManager, 'getDirectory', {
  configurable: true,
  value: async () => {
    if (denyNextDirectory) {
      denyNextDirectory = false;
      throw new DOMException('storage quota exceeded (test-only)', 'QuotaExceededError');
    }
    return originalGetDirectory();
  },
});
