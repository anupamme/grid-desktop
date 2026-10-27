import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import { 
    createWidgetContainer, 
    attachResponsiveScaler 
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { launchFileUri } from '../../desktopGrid/contextMenu.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;
const CARD_BG_DARK_ALPHA = 0.08;
const CARD_BG_LIGHT_ALPHA = 0.05;

/** Megkeresi a Nautilus/freedesktop bélyegképet az URI alapján */
function getThumbnailForUri(uri) {
    try {
        const checksum = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
        const home = GLib.get_home_dir();
        const candidatePaths = [
            GLib.build_filenamev([home, '.cache', 'thumbnails', 'large', `${checksum}.png`]),
            GLib.build_filenamev([home, '.cache', 'thumbnails', 'normal', `${checksum}.png`]),
        ];

        for (const p of candidatePaths) {
            if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
                return p;
            }
        }
    } catch (e) {}
    return null;
}

export function createDownloadsNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    const defaultDownloads = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) || 
                             GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    const targetPath = config.folderPath || defaultDownloads;
    const downloadDir = Gio.File.new_for_path(targetPath);

    const folderDisplayName = (config.folderPath && config.folderPath !== defaultDownloads)
        ? GLib.path_get_basename(config.folderPath)
        : 'Downloads';

    // 1. Fejléc: Mappa ikon + "Downloads" felirat
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'folder-download-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: folderDisplayName,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // 2. Görgető konténer
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(scrollView);

    // 3. Görgethető tartalom konténer (St.BoxLayout, ami implementálja az St.Scrollable-t)
    const scrollContent = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(scrollContent);

    function refreshFiles() {
        if (isActorDestroyed(container)) return;

        scrollContent.destroy_all_children();

        const fileList = [];
        try {
            const enumerator = downloadDir.enumerate_children(
                'standard::name,standard::display-name,standard::icon,time::modified,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.startsWith('.')) continue;

                fileList.push({
                    name: info.get_display_name() || name,
                    file: downloadDir.get_child(name),
                    mtime: info.get_attribute_uint64('time::modified'),
                    icon: info.get_icon(),
                    isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                });
            }
        } catch (e) {
            return;
        }

        // Legújabb fájlok legelöl
        fileList.sort((a, b) => b.mtime - a.mtime);

        const cardRadius = Math.max(6, Math.round(8 * scale));
        const itemPadding = Math.max(3, Math.round(5 * scale));
        const thumbSize = Math.max(32, Math.round(44 * scale));
        const fontSize = Math.max(9, Math.round(11 * scale));
        const gap = Math.max(4, Math.round(6 * scale));

        const COLUMNS = 3;
        let currentRow = null;

        fileList.forEach((item, index) => {
            const col = index % COLUMNS;

            // Új sor nyitása 3 elemenként
            if (col === 0) {
                currentRow = new St.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    x_expand: true,
                    style: `margin-bottom: ${gap}px;`,
                });
                scrollContent.add_child(currentRow);
            }

            const filePath = item.file.get_path();
            const fileUri = item.file.get_uri();
            const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(item.name);

            const isLastInRow = (col === COLUMNS - 1);
            const mrStyle = !isLastInRow ? `margin-right: ${Math.round(gap)}px; ` : '';
            const btn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                style: `background-color: ${cssColorToRgba(textColor, cardBgAlpha)}; ` +
                    `border-radius: ${Math.round(cardRadius)}px; ` +
                    `padding: ${Math.round(itemPadding)}px; ` +
                    mrStyle,
            });

            const cellBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            btn.set_child(cellBox);


            let thumbPath = isImage ? filePath : getThumbnailForUri(fileUri);
            let giconToUse;

            if (thumbPath) {
                // Közvetlenül a fájlból csinálunk GIcon-t: nincs CSS parser, nincs hibás length property!
                giconToUse = Gio.FileIcon.new(Gio.File.new_for_path(thumbPath));
            } else {
                giconToUse = item.icon || Gio.ThemedIcon.new(item.isDir ? 'folder' : 'text-x-generic');
            }

            const previewWidget = new St.Icon({
                gicon: giconToUse,
                icon_size: Math.round(thumbSize),
                x_align: Clutter.ActorAlign.CENTER,
            });
            cellBox.add_child(previewWidget);

            const label = new St.Label({
                text: item.name,
                style: `${fontCss}color: ${textColor}; font-size: ${Math.round(fontSize)}px; margin-top: 3px;`,
                x_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.set_ellipsize(3);
            label.clutter_text.set_line_wrap(false);
            cellBox.add_child(label);

            btn.connect('clicked', () => {
                launchFileUri(fileUri);
            });

            currentRow.add_child(btn);
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));

        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;

        refreshFiles();
    }

    // Mappa monitorozása az új letöltések azonnali észleléséhez
    let monitor = null;
    let monitorTimeoutId = null;

    try {
        monitor = downloadDir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOUNTES, null);
        monitor.connect('changed', () => {
            if (monitorTimeoutId) GLib.Source.remove(monitorTimeoutId);
            monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                monitorTimeoutId = null;
                refreshFiles();
                return GLib.SOURCE_REMOVE;
            });
        });
    } catch (e) {}

    container.connect('destroy', () => {
        if (monitorTimeoutId) {
            GLib.Source.remove(monitorTimeoutId);
            monitorTimeoutId = null;
        }
        if (monitor) {
            monitor.cancel();
            monitor = null;
        }
    });

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}