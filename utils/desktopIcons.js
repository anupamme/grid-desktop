import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { getWidgets, saveWidgets, findEmptySpot, nextWidgetId, calculateGridDimensions } from './widgetUtils.js';

/** Ellenőrzi, hogy egy URI jelenleg TÉNYLEG létezik és fel van-e csatolva */
function isMountActuallyActive(uri) {
    if (!uri) return false;
    try {
        const file = Gio.File.new_for_uri(uri);
        // 1. Megpróbáljuk lekérni a befoglaló mountot
        const mount = file.find_enclosing_mount(null);
        if (!mount) return false;

        // 2. Külön a Google Drive és hálózati URI-k esetén:
        // Ha nem lehet query_info-t kérni rá, a GVfs kapcsolat halott!
        const info = file.query_info(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        return info !== null;
    } catch (e) {
        // Ha G_IO_ERROR_NOT_MOUNTED vagy hálózati hiba -> NINCS felcsatolva!
        return false;
    }
}
/** Megkeresi a Nautilus/freedesktop által generált bélyegképet az URI hash-e alapján */
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

let _monitor = null;
let _monitorTimeoutId = null;
let _trashMonitor = null;
let _trashSignalId = 0;
let _loginManager = null;
let _sleepSignalId = 0;

export function syncDesktopIcons(settings, forceOrganize = false) {
    if (!settings) return false;

    let modified = false;
    const showDesktopIcons = settings.get_boolean('show-desktop-icons');
    let widgets = getWidgets(settings);

    if (!showDesktopIcons) {
        const countBefore = widgets.length;
        widgets = widgets.filter(w => !w.isDesktopIcon);
        if (widgets.length !== countBefore) {
            saveWidgets(settings, widgets);
            return true;
        }
        return false;
    }

    // Korábbi duplikált ID-k automatikus kijavítása a meglévő mentett adatokban
    const seenIds = new Set();
    widgets.forEach((w, idx) => {
        if (!w.id || seenIds.has(w.id)) {
            w.id = `widget-desktop-fixed-${Date.now()}-${idx}`;
            modified = true;
        } else {
            seenIds.add(w.id);
        }
    });

    const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || `${GLib.get_home_dir()}/Desktop`;
    const directory = Gio.File.new_for_path(desktopPath);

    const showLabels = settings.get_boolean('desktop-icons-show-labels');
    const size = 3;
    const side = settings.get_string('desktop-icons-side') || 'left';
    const direction = settings.get_string('desktop-icons-direction') || 'vertical';

    const showHome = settings.get_boolean('desktop-icons-show-home');
    const showTrash = settings.get_boolean('desktop-icons-show-trash');
    const showMounts = settings.get_boolean('desktop-icons-show-mounts');

    const globalMonitorSetting = settings.get_string('global-monitor') || 'primary';
    const targetMonitor = (globalMonitorSetting === 'each' || globalMonitorSetting === 'all')
        ? 'primary'
        : globalMonitorSetting;

    const stageWidth = global.stage ? global.stage.width : 1920;
    const stageHeight = global.stage ? global.stage.height : 1080;
    const gridDimensions = calculateGridDimensions(stageWidth, stageHeight);
    const cols = gridDimensions.gridCols;
    const rows = gridDimensions.gridRows;

    let currentFiles = [];

    if (showHome) {
        currentFiles.push({
            name: GLib.get_user_name() || 'Saját mappa',
            uri: Gio.File.new_for_path(GLib.get_home_dir()).get_uri(),
            icon: 'user-home',
            isSpecial: true,
        });
    }

    if (showTrash) {
        const trashFile = Gio.File.new_for_uri('trash:///');
        let trashIcon = 'user-trash';
        try {
            const trashInfo = trashFile.query_info('trash::item-count', Gio.FileQueryInfoFlags.NONE, null);
            const count = trashInfo.get_attribute_uint32('trash::item-count');
            if (count > 0) {
                trashIcon = 'user-trash-full';
            }
        } catch (e) {}

        currentFiles.push({
            name: 'Kuka',
            uri: 'trash:///',
            icon: trashIcon,
            isSpecial: true,
        });
    }

    if (showMounts) {
        try {
            const volumeMonitor = Gio.VolumeMonitor.get();
            const mounts = volumeMonitor.get_mounts();
            mounts.forEach(mount => {
                const root = mount.get_root();
                if (root && root.get_path() !== '/') {
                    const uri = root.get_uri();

                    // Google drive és hálózati meghajtóknál ellenőrizzük, hogy él-e még a kapcsolat
                    const isNetwork = uri.startsWith('google-drive:') || 
                                      uri.startsWith('smb:') || 
                                      uri.startsWith('sftp:');

                    if (!isNetwork || isMountActuallyActive(uri)) {
                        currentFiles.push({
                            name: mount.get_name(),
                            uri: uri,
                            icon: mount.get_icon() ? mount.get_icon().to_string() : 'drive-harddisk',
                            isSpecial: true,
                            isMount: true,
                        });
                    }
                }
            });
        } catch (e) {}
    }

    try {
        const enumerator = directory.enumerate_children(
            'standard::name,standard::display-name,standard::icon,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const fileName = info.get_name();
            if (fileName.startsWith('.')) continue;

            const childFile = directory.get_child(fileName);
            let displayName = info.get_display_name() || fileName;
            let iconString = info.get_icon() ? info.get_icon().to_string() : 'text-x-generic';
            let isDesktopEntry = false;

            const filePath = childFile.get_path();
            const fileUri = childFile.get_uri();

            // 1. KÉP ELŐNÉZET: Ha kép, közvetlenül a fájl elérési útját használjuk ikonként
            const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName);
            if (isImage && filePath) {
                iconString = filePath;
            } else {
                // 2. NAUTILUS THUMBNAIL CACHE: egyéb fájloknál (pl. PDF, videó)
                const thumb = getThumbnailForUri(fileUri);
                if (thumb) {
                    iconString = thumb;
                }
            }

            if (fileName.endsWith('.desktop')) {
                try {
                    const appInfo = Gio.DesktopAppInfo.new_from_filename(childFile.get_path());
                    if (appInfo) {
                        displayName = appInfo.get_name() || displayName;
                        const gicon = appInfo.get_icon();
                        if (gicon) {
                            iconString = gicon.to_string();

                            if (!iconString.startsWith('/')) {
                                const userIconDir = `${GLib.get_home_dir()}/.local/share/icons/hicolor`;
                                const sizes = ['128x128', '256x256', '48x48', '64x64', '32x32'];
                                for (const sz of sizes) {
                                    const testPath = `${userIconDir}/${sz}/apps/${iconString}.png`;
                                    if (GLib.file_test(testPath, GLib.FileTest.EXISTS)) {
                                        iconString = testPath;
                                        break;
                                    }
                                }
                            }
                        }
                        isDesktopEntry = true;
                    }
                } catch (err) {}
            }

            currentFiles.push({
                name: displayName,
                uri: childFile.get_uri(),
                path: childFile.get_path(),
                icon: iconString,
                isDesktopEntry: isDesktopEntry
            });
        }
    } catch (e) {
        return false;
    }

    // 1. Töröljük a már nem létező fájlok widgetjeit
    const countBefore = widgets.length;
    widgets = widgets.filter(w => {
        if (!w.isDesktopIcon) return true;
        
        // Ha csatolt meghajtó (Google Drive, pendrive, stb.):
        if (w.isMount) {
            // Csak akkor maradhat, ha:
            // a) Benne van az aktív mounts listában ÉS
            // b) A valóságban is él a kapcsolata (nem szakadt le hordozás/alvás közben)
            const existsInCurrent = currentFiles.some(f => f.isMount && f.uri === w.uri);
            if (!existsInCurrent || !isMountActuallyActive(w.uri)) {
                return false; // KUKÁZZUK A BERAGADT IKONT!
            }
            return true;
        }
        
        // Normál fájlok szűrése:
        return currentFiles.some(f => {
            if (f.uri === w.uri) return true;
            try {
                return decodeURIComponent(f.uri) === decodeURIComponent(w.uri) || f.name === w.name;
            } catch (e) {
                return f.name === w.name;
            }
        });
    });
    if (widgets.length !== countBefore) modified = true;

    // Meghatározzuk a legnagyobb meglévő desktop id számot a memóriában
    let maxIdNum = 0;
    const prefix = 'widget-desktop-';
    widgets.forEach(w => {
        if (typeof w.id === 'string' && w.id.startsWith(prefix)) {
            const num = parseInt(w.id.slice(prefix.length), 10);
            if (!isNaN(num) && num > maxIdNum) maxIdNum = num;
        }
    });

    // 2. Új elemek hozzáadása vagy meglévők frissítése
    currentFiles.forEach(file => {
        let w = widgets.find(icon => {
            if (!icon.isDesktopIcon) return false;
            if (icon.uri === file.uri) return true;
            try {
                return decodeURIComponent(icon.uri) === decodeURIComponent(file.uri) || icon.name === file.name;
            } catch (e) {
                return icon.name === file.name;
            }
        });

        if (!w) {
            maxIdNum++;
            const newId = `${prefix}${maxIdNum}`;

            let isRight = false;
            try {
                isRight = (settings.get_string('desktop-icons-side') === 'right');
            } catch (e) {
                isRight = (settings.get_enum('desktop-icons-side') === 1);
            }

            let isVertical = true;
            try {
                isVertical = (settings.get_string('desktop-icons-direction') === 'vertical');
            } catch (e) {
                isVertical = (settings.get_enum('desktop-icons-direction') === 0);
            }

            let spot = null;

            if (isVertical) {
                const startCol = isRight ? (cols - size) : 0;
                const colStep = isRight ? -1 : 1;

                for (let cStep = 0; cStep <= cols - size; cStep++) {
                    const c = startCol + (cStep * colStep);
                    for (let r = 0; r <= rows - size; r++) {
                        const isOccupied = widgets.some(other => {
                            const oW = other.width || size;
                            const oH = other.height || size;
                            return c < (other.x + oW) &&
                                   (c + size) > other.x &&
                                   r < (other.y + oH) &&
                                   (r + size) > other.y;
                        });
                        if (!isOccupied) {
                            spot = { x: c, y: r };
                            break;
                        }
                    }
                    if (spot) break;
                }
            } else {
                const startCol = isRight ? (cols - size) : 0;
                const colStep = isRight ? -1 : 1;

                for (let r = 0; r <= rows - size; r++) {
                    for (let cStep = 0; cStep <= cols - size; cStep++) {
                        const c = startCol + (cStep * colStep);
                        const isOccupied = widgets.some(other => {
                            const oW = other.width || size;
                            const oH = other.height || size;
                            return c < (other.x + oW) &&
                                   (c + size) > other.x &&
                                   r < (other.y + oH) &&
                                   (r + size) > other.y;
                        });
                        if (!isOccupied) {
                            spot = { x: c, y: r };
                            break;
                        }
                    }
                    if (spot) break;
                }
            }

            w = {
                id: newId,
                type: 'desktop-icon',
                isDesktopIcon: true,
                isMount: Boolean(file.isMount),
                uri: file.uri,
                name: file.name,
                icon: file.icon,
                width: size,
                height: size,
                showLabel: showLabels,
                monitor: targetMonitor,
                x: spot ? spot.x : 0,
                y: spot ? spot.y : 0
            };
            widgets.push(w);
            modified = true;
        } else {
            let updated = false;
            if (file.isSpecial && !w.isSpecial) { w.isSpecial = true; updated = true; }
            if (w.name !== file.name) { w.name = file.name; updated = true; }
            if (w.icon !== file.icon) { w.icon = file.icon; updated = true; }
            if (w.showLabel !== showLabels) { w.showLabel = showLabels; updated = true; }
            if (w.width !== size || w.height !== size) {
                w.width = size;
                w.height = size;
                updated = true;
            }
            if (!w.monitor) {
                w.monitor = targetMonitor;
                updated = true;
            }
            if (updated) modified = true;
        }
    });

    // 3. Kényszerített újrarendezés (ha a beállítás megváltozott)
    if (forceOrganize) {
        let desktopIcons = widgets.filter(w => w.isDesktopIcon);
        let otherWidgets = widgets.filter(w => !w.isDesktopIcon);

        let isRight = false;
        try {
            isRight = (settings.get_string('desktop-icons-side') === 'right');
        } catch (e) {
            isRight = (settings.get_enum('desktop-icons-side') === 1);
        }

        let isVertical = true;
        try {
            isVertical = (settings.get_string('desktop-icons-direction') === 'vertical');
        } catch (e) {
            isVertical = (settings.get_enum('desktop-icons-direction') === 0);
        }

        let startX = isRight ? (cols - size) : 0;
        let curX = startX;
        let curY = 0;

        desktopIcons.forEach(icon => {
            icon.width = size;
            icon.height = size;

            let placed = false;
            let safetyCount = 0;

            while (!placed && safetyCount < 300) {
                safetyCount++;

                const overlap = otherWidgets.some(other => {
                    return curX < (other.x + other.width) &&
                           (curX + size) > other.x &&
                           curY < (other.y + other.height) &&
                           (curY + size) > other.y;
                });

                if (!overlap) {
                    icon.x = curX;
                    icon.y = curY;
                    placed = true;
                }

                if (isVertical) {
                    curY += size;
                    if (curY + size > rows) {
                        curY = 0;
                        curX = isRight ? (curX - size) : (curX + size);
                    }
                } else {
                    curX = isRight ? (curX - size) : (curX + size);
                    if (curX < 0 || (curX + size) > cols) {
                        curX = startX;
                        curY += size;
                    }
                }
            }
        });

        modified = true;
    }

    if (modified) {
        saveWidgets(settings, widgets);
    }
    return modified;
}

let _volumeMonitor = null;
let _mountSignals = [];

export function monitorDesktop(settings, callback) {
    if (_monitor || !settings) return;

    // 1. Asztal mappa figyelése
    const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || `${GLib.get_home_dir()}/Desktop`;
    const desktopFile = Gio.File.new_for_path(desktopPath);
    try {
        _monitor = desktopFile.monitor_directory(Gio.FileMonitorFlags.WATCH_MOUNTES, null);
        _monitor.connect('changed', () => {
            if (_monitorTimeoutId) {
                GLib.Source.remove(_monitorTimeoutId);
                _monitorTimeoutId = null;
            }
            _monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                _monitorTimeoutId = null;
                if (global.stage && global.stage._isGridgetsDragging) {
                    return GLib.SOURCE_REMOVE;
                }
                const modified = syncDesktopIcons(settings, false);
                if (modified && callback) callback();
                return GLib.SOURCE_REMOVE;
            });
        });
    } catch (e) {}

    // 2. Kuka állapotváltozás figyelése (ürítés vagy új szemét)
    try {
        const trashFile = Gio.File.new_for_uri('trash:///');
        _trashMonitor = trashFile.monitor_directory(Gio.FileMonitorFlags.WATCH_MOUNTES, null);
        _trashSignalId = _trashMonitor.connect('changed', () => {
            if (_monitorTimeoutId) {
                GLib.Source.remove(_monitorTimeoutId);
                _monitorTimeoutId = null;
            }
            _monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                _monitorTimeoutId = null;
                const modified = syncDesktopIcons(settings, false);
                if (modified && callback) callback();
                return GLib.SOURCE_REMOVE;
            });
        });
    } catch (e) {}

    // 3. Kötetek és felcsatolt meghajtók figyelése
    try {
        _volumeMonitor = Gio.VolumeMonitor.get();
        const onMountChange = () => {
            if (_monitorTimeoutId) {
                GLib.Source.remove(_monitorTimeoutId);
                _monitorTimeoutId = null;
            }
            _monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                _monitorTimeoutId = null;
                if (global.stage && global.stage._isGridgetsDragging) {
                    return GLib.SOURCE_REMOVE;
                }
                const modified = syncDesktopIcons(settings, false);
                if (modified && callback) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        callback();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        _mountSignals.push(_volumeMonitor.connect('mount-added', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('mount-removed', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('mount-changed', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('volume-changed', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('volume-removed', onMountChange));
    } catch (e) {}

    try {
        _loginManager = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.login1',
            '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager',
            null
        );

        _sleepSignalId = _loginManager.connect('g-signal', (proxy, sender, [signalName, params]) => {
            if (signalName === 'PrepareForSleep') {
                const isSleeping = params.get_child_value(0).get_boolean();
                if (!isSleeping) {
                    // Felébredtünk!
                    // 1. Azonnali ellenőrzés (a helyi pendrive-okhoz):
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                        const mod = syncDesktopIcons(settings, false);
                        if (mod && callback) callback();
                        return GLib.SOURCE_REMOVE;
                    });

                    // 2. Késleltetett ellenőrzés 4 másodperc múlva (amikor a Wi-Fi és a Google Drive újra feláll vagy végleg leszakad):
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                        const mod = syncDesktopIcons(settings, false);
                        if (mod && callback) callback();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        });
    } catch (e) {}

}

export function stopMonitor() {
    if (_monitorTimeoutId) {
        GLib.Source.remove(_monitorTimeoutId);
        _monitorTimeoutId = null;
    }
    if (_monitor) {
        _monitor.cancel();
        _monitor = null;
    }
    if (_trashMonitor) {
        if (_trashSignalId) {
            _trashMonitor.disconnect(_trashSignalId);
            _trashSignalId = 0;
        }
        _trashMonitor.cancel();
        _trashMonitor = null;
    }
    if (_volumeMonitor && _mountSignals.length > 0) {
        _mountSignals.forEach(id => _volumeMonitor.disconnect(id));
        _mountSignals = [];
        _volumeMonitor = null;
    }
    if (_loginManager && _sleepSignalId) {
        _loginManager.disconnect(_sleepSignalId);
        _sleepSignalId = 0;
        _loginManager = null;
    }
}