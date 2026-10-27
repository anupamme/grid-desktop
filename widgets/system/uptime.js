import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';

function formatUptime(secondsTotal) {
    const total = Math.floor(secondsTotal);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    return parts.join(' ');
}

export function createUptimeNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.max(0.7, Math.min(width / 200, height / 100));
    const padding = Math.max(8, Math.round(12 * scale));
    const headerIconSize = Math.max(14, Math.round(16 * scale));
    const titleFontSize = Math.max(11, Math.round(13 * scale));
    const uptimeFontSize = Math.max(16, Math.round(20 * scale));

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px;`,
    });
    container.add_child(contentBox);

    // Fejléc (mint az Audio Output / Battery Status widgeteknél)
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-bottom: ${Math.round(6 * scale)}px;`,
    });

    const headerIcon = new St.Icon({
        icon_name: 'preferences-system-time-symbolic',
        icon_size: headerIconSize,
        style: `color: ${textColor}; margin-right: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'Uptime',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`,
    });

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // Érték megjelenítése alul
    const valueBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const uptimeLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${uptimeFontSize}px; font-weight: 500;`,
    });

    valueBox.add_child(uptimeLabel);
    contentBox.add_child(valueBox);

    let isDisposed = false;

    const readUptime = () => {
        try {
            const file = Gio.File.new_for_path('/proc/uptime');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    const [rawSec] = text.trim().split(/\s+/);
                    const seconds = parseFloat(rawSec);

                    if (!isNaN(seconds)) {
                        uptimeLabel.set_text(formatUptime(seconds));
                    }
                } catch (_) {}
            });
        } catch (_) {}
    };

    readUptime();

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        readUptime();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}