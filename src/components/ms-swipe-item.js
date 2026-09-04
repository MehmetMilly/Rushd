// Mechanically extracted P02 runtime template. SFC conversion is deferred to P05/P06.
export function createMsSwipeItem(environment = globalThis) {
    const { navigator, performance, setTimeout, clearTimeout } = environment;
    return {
            props: ['bg', 'selectionActive'], // selectionActive: Boolean - disables swipe when true
            emits: ['swipe-left', 'swipe-right', 'click', 'longpress'],
            data() {
                return {
                    offset: 0,
                    startX: 0,
                    isDragging: false,
                    threshold: 100, // Pixel distance to trigger action
                    startTime: 0,
                    lastX: 0,
                    lastTime: 0,
                    velocityX: 0,
                    _longPressTimer: null,
                    _longPressFired: false
                }
            },
            computed: {
                // We use raw physical offset.
                // +Offset (Right) = Check/Pay
                // -Offset (Left) = Delete
                style() {
                    return {
                        transform: `translateX(${this.offset}px)`,
                        transition: this.isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }
                },
                // offset > 0 = finger moved right physically = "swipe-right" event = pay (check)
                // offset < 0 = finger moved left physically = "swipe-left" event = delete
                showCheck() {
                    return this.offset > 20;
                },
                showDelete() {
                    return this.offset < -20;
                },
                iconScale() {
                    return 0.5 + Math.min(Math.abs(this.offset) / 100, 1);
                }
            },
            methods: {
                clearLongPress() {
                    if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
                },
                start(e) {
                    this._longPressFired = false;
                    this.startX = e.touches[0].clientX;
                    this.isDragging = true;
                    const now = performance.now();
                    this.startTime = now;
                    this.lastTime = now;
                    this.lastX = this.startX;
                    this.velocityX = 0;

                    // Long-press detection (only outside selection mode)
                    if (!this.selectionActive) {
                        this.clearLongPress();
                        this._longPressTimer = setTimeout(() => {
                            if (this.isDragging && Math.abs(this.offset) < 15) {
                                this._longPressFired = true;
                                if (navigator.vibrate) navigator.vibrate(30);
                                this.$emit('longpress');
                                this.isDragging = false;
                                this.offset = 0;
                            }
                        }, 500);
                    }
                },
                move(e) {
                    if (!this.isDragging) return;
                    const currentX = e.touches[0].clientX;
                    const delta = currentX - this.startX;
                    const now = performance.now();
                    const dt = Math.max(1, now - this.lastTime);
                    this.velocityX = (currentX - this.lastX) / dt;
                    this.lastX = currentX;
                    this.lastTime = now;

                    // Cancel long-press if finger moves too far
                    if (Math.abs(delta) > 10) this.clearLongPress();

                    // In selection mode, don't allow swipe
                    if (this.selectionActive) return;

                    // Add resistance (rubber banding)
                    // The further you pull, the harder it gets
                    this.offset = delta * 0.72;
                },
                end() {
                    this.clearLongPress();
                    const wasDragging = this.isDragging;
                    this.isDragging = false;

                    // If long-press fired, suppress everything
                    if (this._longPressFired) { this._longPressFired = false; return; }

                    // In selection mode, tap emits click (toggle select)
                    if (this.selectionActive) { this.offset = 0; return; }

                    const fastFling = Math.abs(this.velocityX) > 0.55;
                    const crossed = Math.abs(this.offset) > this.threshold;
                    const shouldTrigger = crossed || fastFling;

                    // Trigger Actions based on threshold (physical direction)
                    if (shouldTrigger && this.offset > 0) {
                        if (navigator.vibrate) navigator.vibrate(20);
                        this.offset = 132;
                        this.$emit('swipe-right');
                        setTimeout(() => { this.offset = 0; }, 55);
                    }
                    else if (shouldTrigger && this.offset < 0) {
                        if (navigator.vibrate) navigator.vibrate([20, 50, 20]);
                        this.offset = -132;
                        this.$emit('swipe-left');
                        setTimeout(() => { this.offset = 0; }, 55);
                    }
                    else {
                        // Spring back to zero
                        this.offset = 0;
                    }
                },
                handleClick() {
                    if (this._longPressFired) return;
                    this.$emit('click');
                }
            },
            template: `
                <div class="swipe-container relative overflow-hidden" style="border-radius: var(--radius-md);">
                    <!-- Action Layer: Absolute Icons at Physical Positions -->
                    <div class="action-layer absolute inset-0" style="background: rgba(0,0,0,0.3);">

                        <!-- Check Icon: Always on Physical Left (revealed by sliding Right) -->
                        <div v-show="showCheck"
                             class="transition-transform absolute"
                             :style="{
                                 left: '24px',
                                 top: '50%',
                                 marginTop: '-16px',
                                 color: 'var(--c-accent-success)',
                                 transform: 'scale(' + iconScale + ')'
                             }">
                            <ms-icon name="check_circle" :size="32"></ms-icon>
                        </div>

                        <!-- Delete Icon: Always on Physical Right (revealed by sliding Left) -->
                        <div v-show="showDelete"
                             class="transition-transform absolute"
                             :style="{
                                 right: '24px',
                                 top: '50%',
                                 marginTop: '-16px',
                                 color: 'var(--c-accent-danger)',
                                 transform: 'scale(' + iconScale + ')'
                             }">
                            <ms-icon name="delete" :size="32"></ms-icon>
                        </div>
                    </div>

                    <div class="swipe-content relative bg-surface-1"
                         :style="style"
                         @touchstart="start"
                         @touchmove="move"
                         @touchend="end"
                         @touchcancel="end"
                         @click="handleClick">
                        <slot></slot>
                    </div>
                </div>
            `
        };
}
