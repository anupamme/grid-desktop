import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import { 
    createWidgetContainer, 
    attachResponsiveScaler,
    registerWidgetCleanup
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_WIDTH = 220;
const BASE_HEIGHT = 220;

// Segédfüggvény fájl tartalmának biztonságos kiolvasásához
function readFileContent(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) return null;
        const [ok, data] = file.load_contents(null);
        if (ok) {
            return new TextDecoder().decode(data).trim();
        }
    } catch (e) {}
    return null;
}

// 1. Gép modell (DMI)
function getHostModel() {
    const vendor = readFileContent('/sys/class/dmi/id/sys_vendor') || '';
    let product = readFileContent('/sys/class/dmi/id/product_name') || '';

    // Ha a product már tartalmazza a vendor nevét, ne duplázza
    if (vendor && product.toLowerCase().startsWith(vendor.toLowerCase())) {
        product = product.slice(vendor.length).trim();
    }

    // "Notebook PC" sallang levágása a végéről, hogy elférjen
    product = product.replace(/Notebook PC/gi, '').trim();

    const full = `${vendor} ${product}`.trim();
    return full.length > 0 ? full : 'Comnputer';
}

// 2. CPU infó (típus + magszám)
function getGpuInfo() {
    const pciDir = Gio.File.new_for_path('/sys/bus/pci/devices');
    if (!pciDir.query_exists(null)) return 'Unknown GPU';

    try {
        const enumerator = pciDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const devName = info.get_name();
            const classCode = readFileContent(`/sys/bus/pci/devices/${devName}/class`);
            
            // 0x030000 = VGA controller, 0x038000 = Display controller, 0x030200 = 3D controller
            if (classCode && (classCode.startsWith('0x0300') || classCode.startsWith('0x0380') || classCode.startsWith('0x0302'))) {
                const vendorId = readFileContent(`/sys/bus/pci/devices/${devName}/vendor`);
                
                let vendorName = '';
                if (vendorId === '0x8086') vendorName = 'Intel Graphics';
                else if (vendorId === '0x10de') vendorName = 'NVIDIA';
                else if (vendorId === '0x1002') vendorName = 'AMD Radeon';

                // Ha van uevent terméknév, vagy maradhat a felismert gyártó
                return vendorName || 'VGA Controller';
            }
        }
    } catch (e) {}
    return 'Grafikus vezérlő';
}

function getCpuInfo() {
    const cpuinfo = readFileContent('/proc/cpuinfo');
    if (!cpuinfo) return 'Processor';

    let modelName = '';
    let threads = 0;
    const physicalCores = new Set();

    const lines = cpuinfo.split('\n');
    for (const line of lines) {
        if (!modelName && (line.startsWith('model name') || line.startsWith('Hardware'))) {
            modelName = line.split(':')[1]?.trim() || '';
        }
        if (line.startsWith('processor')) {
            threads++;
        }
        if (line.startsWith('core id')) {
            physicalCores.add(line.split(':')[1]?.trim());
        }
    }

    // Tisztítás: védjegyek, sallangok törlése a feszes hely miatt
    modelName = modelName
        .replace(/\(R\)|\(TM\)/gi, '')
        .replace(/Core\s+/gi, '')
        .replace(/CPU\s+/gi, '')
        .replace(/Processor/gi, '')
        .replace(/with Radeon Graphics/gi, '')
        .replace(/Dual-Core|Quad-Core|Six-Core|Eight-Core/gi, '')
        .replace(/@.*$/, '')
        .trim();

    const cores = physicalCores.size > 0 ? physicalCores.size : Math.ceil(threads / 2);
    return `${modelName} (${cores}C/${threads}T)`;
}
// 4. Univerzális RAM méret (GB-ra kerekítve)
function getRamInfo() {
    const meminfo = readFileContent('/proc/meminfo');
    if (!meminfo) return 'RAM';

    const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match && match[1]) {
        const totalGb = Math.ceil(parseInt(match[1], 10) / 1024 / 1024);
        return `${totalGb} GB RAM`;
    }
    return 'RAM';
}

// 5. Univerzális OS név
function getOsInfo() {
    const osRelease = readFileContent('/etc/os-release');
    if (!osRelease) return 'Linux';

    const match = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (match && match[1]) {
        return match[1];
    }
    return 'Linux';
}

// 6. Thunderbolt perifériák (ha vannak)
function getConnectedThunderboltDevices() {
    const tbDir = Gio.File.new_for_path('/sys/bus/thunderbolt/devices');
    const devices = [];

    if (!tbDir.query_exists(null)) return devices;

    try {
        const enumerator = tbDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const devName = info.get_name();
            // Host kihagyása (0-0), csak a csatlakoztatott eszközök
            if (devName.includes('-') && !devName.endsWith('-0')) {
                const name = readFileContent(`/sys/bus/thunderbolt/devices/${devName}/device_name`);
                if (name) devices.push(name);
            }
        }
    } catch (e) {}
    return devices;
}

// 7. Csatlakoztatott USB perifériák (szűrve)
function getConnectedUsbDevices() {
    const usbDir = Gio.File.new_for_path('/sys/bus/usb/devices');
    const devices = [];
    const blacklist = ['bluetooth', 'camera', 'webcam', 'fingerprint', 'hub'];

    if (!usbDir.query_exists(null)) return devices;

    try {
        const enumerator = usbDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (name.includes(':') || name.startsWith('usb')) continue;

            const devPath = `/sys/bus/usb/devices/${name}`;
            const devClass = readFileContent(`${devPath}/bDeviceClass`);
            if (devClass === '09') continue; // Hub kihagyása

            const prodName = readFileContent(`${devPath}/product`);
            if (prodName) {
                const lower = prodName.toLowerCase();
                if (!blacklist.some(term => lower.includes(term))) {
                    devices.push(prodName);
                }
            }
        }
    } catch (e) {}
    return devices;
}

export function createHardwareInfoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const isDark = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBg = cssColorToRgba(textColor, isDark ? 0.05 : 0.04);
    const cardBorder = cssColorToRgba(textColor, isDark ? 0.08 : 0.12);

    let scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerIcon = new St.Icon({
        icon_name: 'preferences-system-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: getHostModel(),
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── Görgethető törzs ──
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
    });
    mainLayout.add_child(scrollView);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(contentBox);

    // Sor gyártó
    function createRow(iconName, text) {
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: text,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(icon);
        row.add_child(label);
        return { row, icon, label };
    }

    // Fix specifikációk betöltése
    const staticRows = [
        createRow('video-display-symbolic', getGpuInfo()),
        createRow('cpu-symbolic', getCpuInfo()),
        createRow('drive-harddisk-symbolic', getRamInfo()),
        createRow('distributor-logo-debian', getOsInfo()),
    ];
    staticRows.forEach(r => contentBox.add_child(r.row));

    const separator = new St.Widget({ x_expand: true });
    contentBox.add_child(separator);

    // Periféria kártya tartó doboz (dinamikusan újratölthető)
    const devicesContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    contentBox.add_child(devicesContainer);

    let activeCardActors = [];

    function refreshPeripherals() {
        if (isActorDestroyed(container)) return;
        devicesContainer.destroy_all_children();
        activeCardActors = [];

        // 1. Thunderbolt eszközök kezelése (tömbként iterálva)
        const tbDevices = getConnectedThunderboltDevices();
        if (tbDevices.length > 0) {
            for (const tb of tbDevices) {
                addDeviceCard('thunderbolt-symbolic', String(tb), true);
            }
        }

        // 2. USB eszközök kezelése
        const usbList = getConnectedUsbDevices();
        if (usbList.length === 0 && tbDevices.length === 0) {
            addDeviceCard('input-mouse-symbolic', 'Nincs külső eszköz', false);
        } else {
            for (const dev of usbList) {
                addDeviceCard('input-mouse-symbolic', String(dev), true);
            }
        }

        applyScale(scale);
    }

    function addDeviceCard(iconName, text, isActive) {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text: text,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(icon);
        box.add_child(label);

        devicesContainer.add_child(box);
        activeCardActors.push({ box, icon, label, isActive });
    }

    function applyScale(newScale) {
        scale = newScale;
        const pad = Math.max(10, Math.round(14 * scale));
        const fontSize = Math.max(10, Math.round(11.5 * scale));
        const iconSize = Math.max(13, Math.round(15 * scale));
        const rowGap = Math.max(3, Math.round(5 * scale));

        mainLayout.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(15 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(12 * scale)}px; font-weight: bold;`;

        contentBox.style = `spacing: ${rowGap}px; padding: 0px 2px;`;
        devicesContainer.style = `spacing: ${rowGap}px;`;

        staticRows.forEach(r => {
            r.icon.icon_size = iconSize;
            r.icon.style = `color: ${textColor}; opacity: 0.8; margin-right: 7px;`;
            r.label.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px;`;
        });

        separator.style = `height: 1px; background-color: ${cardBorder}; margin: 2px 0px;`;

        activeCardActors.forEach(c => {
            const bg = c.isActive ? cardBg : 'transparent';
            const border = c.isActive ? cardBorder : 'transparent';
            const opacity = c.isActive ? '0.9' : '0.5';

            c.box.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: 5px; padding: 4px 6px;`;
            c.icon.icon_size = iconSize;
            c.icon.style = `color: ${textColor}; opacity: ${opacity}; margin-right: 7px;`;
            c.label.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; opacity: ${opacity};`;
        });
    }

    refreshPeripherals();
    applyScale(scale);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / BASE_WIDTH, h / BASE_HEIGHT));
    });

    // 5 másodpercenként frissíti a perifériákat (bedugott egér, leválasztott dokkoló stb.)
    const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
        refreshPeripherals();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        if (timerId) GLib.source_remove(timerId);
    });

    return container;
}