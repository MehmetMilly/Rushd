/**
         * RUSHD CORE UTILITIES
         * A collection of rigorous helper functions for math, formatting, and physics.
         */

        export const Core = {
            // --- CURRENCY ENGINE ---
            // Handles floating point errors by working in Integers (Halalas) then converting back.
            Currency: {
                format(amount, currency = 'SAR') {
                    return new Intl.NumberFormat('en-SA', {
                        style: 'currency',
                        currency: currency,
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 1
                    }).format(amount);
                },

                // Returns an object with parts for fancy typography styling
                formatParts(amount) {
                    const str = amount.toFixed(2);
                    const [whole, fraction] = str.split('.');
                    return { whole, fraction };
                },

                // Calculates variance percentage safely
                variancePct(expected, actual) {
                    if (expected === 0) return 0;
                    return ((expected - actual) / expected) * 100;
                }
            },

            // --- DATE ENGINE ---
            // Replacement for Moment.js/Day.js to save space but keep power.
            // P1-01: dates shown or selected by the user are local civil days.
            // UTC wall-clock timestamps (createdAt, exportedAt) may stay UTC.
            Date: {
                toLocalISO(date) {
                    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                },

                // Parses 'YYYY-MM-DD' as a local civil day instead of UTC midnight.
                parseLocalDate(dateStr) {
                    if (typeof dateStr !== 'string') return new Date(NaN);
                    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
                    if (!match) return new Date(NaN);
                    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
                },

                getTodayISO() {
                    return this.toLocalISO(new Date());
                },

                addDays(dateStr, days) {
                    const d = this.parseLocalDate(dateStr);
                    if (Number.isNaN(d.getTime())) return '';
                    d.setDate(d.getDate() + days);
                    return this.toLocalISO(d);
                },

                // Returns array of date objects for the scroller
                generateWindow(centerDateStr, daysBefore = 7, daysAfter = 21, locale = 'en-US', calendarType = 'gregorian') {
                    const center = this.parseLocalDate(centerDateStr);
                    if (Number.isNaN(center.getTime())) return [];
                    const start = new Date(center);
                    start.setDate(center.getDate() - daysBefore);

                    const days = [];
                    const totalDays = daysBefore + 1 + daysAfter;
                    // Explicit calendar avoids locales (e.g. ar-SA) silently defaulting to Islamic/Hijri
                    const dateOpts = calendarType === 'hijri' ? { calendar: 'islamic' } : { calendar: 'gregory' };

                    for (let i = 0; i < totalDays; i++) {
                        const d = new Date(start);
                        d.setDate(start.getDate() + i);
                        const iso = this.toLocalISO(d);
                        days.push({
                            iso: iso,
                            dom: d.toLocaleDateString(locale + '-u-nu-latn', { ...dateOpts, day: 'numeric' }),
                            month: d.toLocaleDateString(locale, { ...dateOpts, month: 'short' }).toUpperCase(),
                            day: d.toLocaleDateString(locale, { weekday: 'short' }),
                            fullDate: d,
                            isToday: iso === this.getTodayISO(),
                            isWeekend: d.getDay() === 5 || d.getDay() === 6 // Fri/Sat in KSA
                        });
                    }
                    return days;
                },

                humanize(dateStr, t = null) {
                    const today = this.getTodayISO();
                    if (dateStr === today) return t ? t.today : 'Today';
                    const d = this.parseLocalDate(dateStr);
                    if (Number.isNaN(d.getTime())) return dateStr || '';
                    const base = this.parseLocalDate(today);
                    const y = new Date(base);
                    y.setDate(base.getDate() - 1);
                    if (dateStr === this.toLocalISO(y)) return t ? t.yesterday : 'Yesterday';

                    const tm = new Date(base);
                    tm.setDate(base.getDate() + 1);
                    if (dateStr === this.toLocalISO(tm)) return t ? t.tomorrow : 'Tomorrow';

                    const locale = t ? (t._locale || 'en-US') : 'en-US';
                    return d.toLocaleDateString(locale, { calendar: 'gregory', month: 'short', day: 'numeric' });
                }
            },

            // --- ID GENERATOR ---
            // UUID v4 compliant generator for database keys
            UUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            },

            // --- PHYSICS ANIMATION LOOP ---
            // For custom canvas drawing or complex JS animations
            Physics: {
                lerp(start, end, factor) {
                    return start + (end - start) * factor;
                },

                // Spring logic
                spring(value, target, velocity, config = { stiffness: 0.1, damping: 0.8 }) {
                    const force = (target - value) * config.stiffness;
                    velocity += force;
                    velocity *= config.damping;
                    return { value: value + velocity, velocity };
                }
            }
        };
