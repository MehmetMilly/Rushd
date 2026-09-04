import { createMsProfileOverlay } from './ms-profile-overlay.js';

export function registerProfileOverlay(app, dataRuntime) {
    app.component('ms-profile-overlay', createMsProfileOverlay(dataRuntime));
}
