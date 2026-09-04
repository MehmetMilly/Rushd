import { createMsIcon } from './ms-icon.js';
import { createMsButton } from './ms-button.js';
import { createMsSwipeItem } from './ms-swipe-item.js';
import { createMsNumpad } from './ms-numpad.js';
import { createMsStatRing } from './ms-stat-ring.js';
import { createMsModal } from './ms-modal.js';

export function registerLegacyComponents(app, environment = globalThis) {
    app.component('ms-icon', createMsIcon(environment));
    app.component('ms-btn', createMsButton(environment));
    app.component('ms-swipe-item', createMsSwipeItem(environment));
    app.component('ms-numpad', createMsNumpad(environment));
    app.component('ms-stat-ring', createMsStatRing(environment));
    app.component('ms-modal', createMsModal(environment));
}
