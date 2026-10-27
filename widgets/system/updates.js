import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';

const BADGE_BG_ALPHA = 0.12;
const SUB_LABEL_OPACITY = 0.65;

function getFlatpakUpdateCount(callback) {
    if (!GLib.find_program_in_path('flatpak')) {
        callback(0);
        return;
    }

    try {
        const proc = new Gio.Subprocess({
            argv: ['sh', '-c', 'LC_ALL=C flatpak remote-ls --updates 2>/dev/null | wc -l'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                const count = parseInt(stdout?.trim() || '0', 10);
                callback(isNaN(count) ? 0 : count);
            } catch (_) {
                callback(0);
            }
        });
    } catch (_) {
        callback(0);
    }
}


// Csomagkezelő felderítése parancs és felirat szerint
function detectPackageManager() {
    if (GLib.find_program_in_path('checkupdates')) {
        return {
            name: 'PACMAN',
            cmd: ['sh', '-c', 'LC_ALL=C checkupdates 2>/dev/null | wc -l'],
        };
    }
    if (GLib.file_test('/usr/lib/update-notifier/apt-check', GLib.FileTest.EXISTS)) {
        return {
            name: 'APT',
            cmd: ['sh', '-c', '/usr/lib/update-notifier/apt-check 2>/dev/null | cut -d";" -f1'],
        };
    }
    if (GLib.find_program_in_path('apt')) {
        return {
            name: 'APT',
            cmd: ['sh', '-c', 'LC_ALL=C apt list --upgradable 2>/dev/null | grep -c "/"'],
        };
    }
    if (GLib.find_program_in_path('dnf')) {
        return {
            name: 'DNF',
            cmd: ['sh', '-c', "LC_ALL=C dnf check-update -q 2>/dev/null | grep -E '^[a-zA-Z0-9]' | wc -l || true"],
        };
    }
    if (GLib.find_program_in_path('zypper')) {
        return {
            name: 'ZYPPER',
            cmd: ['sh', '-c', "LC_ALL=C zypper -qn lu 2>/dev/null | grep -E '^v ' | wc -l"],
        };
    }
    return {
        name: 'UPDATES',
        cmd: null,
    };
}

export function createUpdatesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    // systemInfo méretezési logika (2x2 -> 3x3 -> 4x4)
    const scale = Math.max(0.65, Math.min(width / 110, height / 110));
    const padding = Math.max(8, Math.round(12 * scale));
    const badgeIconSize = Math.max(13, Math.round(15 * scale));
    const badgePadding = Math.max(3, Math.round(5 * scale));
    const badgeRadius = Math.max(6, Math.round(7 * scale));
    const countFontSize = Math.max(16, Math.round(22 * scale));
    const labelFontSize = Math.max(10, Math.round(12 * scale));

    const pm = detectPackageManager();

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    // 1. Jobb felső sarok: Ikon jelvény
    const topBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
    });

    const badgeBg = cssColorToRgba(textColor, BADGE_BG_ALPHA);
    const iconBadge = new St.Bin({
        style: `background-color: ${badgeBg}; border-radius: ${badgeRadius}px; padding: ${badgePadding}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const topIcon = new St.Icon({
        icon_name: 'software-update-available-symbolic',
        icon_size: badgeIconSize,
        style: `color: ${textColor}; opacity: 0.9;`,
    });
    iconBadge.set_child(topIcon);
    topBox.add_child(iconBadge);
    mainLayout.add_child(topBox);

    // 2. Bal alsó sarok: Szám és alatta a csomagkezelő neve
    const bottomBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.END,
        y_expand: true,
    });

    const countLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${countFontSize}px; font-weight: bold; line-height: 1.1;`,
    });

    const typeLabel = new St.Label({
        text: pm.name,
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SUB_LABEL_OPACITY}; font-weight: 600;`,
    });

    bottomBox.add_child(countLabel);
    bottomBox.add_child(typeLabel);
    mainLayout.add_child(bottomBox);

    container.add_child(mainLayout);

    let isDisposed = false;

    const checkUpdates = () => {
        const runNativeCheck = () => {
            return new Promise((resolve) => {
                if (!pm.cmd) return resolve(0);
                try {
                    const proc = new Gio.Subprocess({
                        argv: pm.cmd,
                        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                    });
                    proc.init(null);
                    proc.communicate_utf8_async(null, null, (p, res) => {
                        try {
                            const [, stdout] = p.communicate_utf8_finish(res);
                            const count = parseInt(stdout?.trim() || '0', 10);
                            resolve(isNaN(count) ? 0 : count);
                        } catch (_) {
                            resolve(0);
                        }
                    });
                } catch (_) {
                    resolve(0);
                }
            });
        };

        const runFlatpakCheck = () => {
            return new Promise((resolve) => {
                getFlatpakUpdateCount((count) => resolve(count));
            });
        };

        Promise.all([runNativeCheck(), runFlatpakCheck()]).then(([nativeCount, flatpakCount]) => {
            if (isDisposed) return;
            const total = nativeCount + flatpakCount;
            countLabel.set_text(`${total}`);

            if (total === 0) {
                topIcon.set_icon_name('emblem-ok-symbolic');
            } else {
                topIcon.set_icon_name('software-update-available-symbolic');
            }

            // Ha van flatpak is, kiírhatja pl. "APT + FP"-ként, vagy simán hagyhatod a natív nevét:
            if (flatpakCount > 0 && nativeCount > 0) {
                typeLabel.set_text(`${pm.name}+FP`);
            } else if (flatpakCount > 0 && nativeCount === 0) {
                typeLabel.set_text('FLATPAK');
            } else {
                typeLabel.set_text(pm.name);
            }
        });
    };

    checkUpdates();

    // 30 percenkénti frissítés (1800 mp)
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1800, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        checkUpdates();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}