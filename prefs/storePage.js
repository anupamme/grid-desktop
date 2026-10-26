import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import Adw from 'gi://Adw';

import {
    addTimeWidget,
    addAnalogClockWidget,
    addTimerWidget,
    addStopWatchWidget,
    addWeatherWidget,
    addWeatherBarsWidget,
    addWeatherCardsWidget,
    addMusicWidget,
    addPomodoroWidget,
    addPomodoroFocusWidget,
    addCpuRamWidget,
    addNetworkSpeedWidget,
    addSystemDashboardWidget,
    addBatteryStatusWidget,
    addNotesWidget,
    addClipboardWidget,
    addCalendarWidget,
    addQuotesWidget,
    addScreenTimeWidget,
    addCalendarGridWidget,
    addTodoWidget,
    addMoodWidget,
    addSystemInfoWidget,
    addResourceWheelWidget,
    addCurrencyTrackerWidget,
    addHabitTrackerWidget,
    addQuickTogglesWidget,
    addAudioOutputWidget,
    addControlsSlidersWidget,
    addPowerProfilesWidget,
    addPingWidget,
    addStorageBarWidget,
    addCryptoWidget,
    addTodayHistoryWidget,
    addPowerTogglesWidget,
    addWorldAnalogWidget,
    addCalendarTasksWidget,
    addBluetoothDevicesWidget,
    addMailGoaWidget,
    addLavaLampWidget,
    addBinaryWidget
} from './widgetAdders.js';

import {
    openAddAppLauncherDialog,
    openAddImageDialog,
    openAddSlideshowDialog,
    openAddWorldClockDialog,
    openAddGithubDialog,
    openAddRssHeadlinesDialog,
    openAddSunScheduleDialog,
    openAddCountdownDialog,
    openAddWorldAnalogDialog,
    openAddWatermindDialog,
    openAddMoonDialog
} from './widgetAddDialogs.js';

import { STORE_CATEGORIES, STORE_WIDGETS } from './widgetCatalog.js';

const DESKTOP_PREVIEW_SIZE_PX = 120;
const DESKTOP_CARD_HEIGHT_PX = 240;
const DESKTOP_CARD_WIDTH_PX = 200;
const CARDS_PER_ROW = 3;
const CLAMP_MAXIMUM_SIZE = 1400;

function escapeMarkup(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPreviewArea(extensionPath, thumbnail, previewSize, fallbackIconName = null) {
    const previewArea = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        hexpand: true,
        vexpand: true,
    });
    previewArea.set_size_request(previewSize, previewSize);

    if (thumbnail) {
        const picture = Gtk.Picture.new_for_filename(`${extensionPath}/assets/thumbnails/${thumbnail}`);
        picture.set_content_fit(Gtk.ContentFit.CONTAIN);
        picture.set_can_shrink(true);
        picture.set_halign(Gtk.Align.FILL);
        picture.set_valign(Gtk.Align.FILL);
        picture.set_hexpand(true);
        picture.set_vexpand(true);
        picture.set_margin_top(4);
        picture.set_margin_bottom(4);
        previewArea.append(picture);
    } else if (fallbackIconName) {
        const icon = new Gtk.Image({
            icon_name: fallbackIconName,
            pixel_size: 64,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        previewArea.append(icon);
    }

    return previewArea;
}

function createDesktopWidgetCard(extensionPath, widgetEntry, onAddClick) {
    const { title, description, gridSize, thumbnail, fallbackIconName } = widgetEntry;

    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: ['card'],
        margin_top: 4,
        margin_bottom: 4,
        margin_start: 4,
        margin_end: 4,
        hexpand: false,
    });
    card.set_size_request(DESKTOP_CARD_WIDTH_PX, DESKTOP_CARD_HEIGHT_PX);

    // 1. Preview
    card.append(buildPreviewArea(extensionPath, thumbnail, DESKTOP_PREVIEW_SIZE_PX, fallbackIconName));

    // 2. Szöveges leírás
    const textBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_start: 12,
        margin_end: 12,
    });

    const titleLabel = new Gtk.Label({
        label: title,
        xalign: 0,
        hexpand: true,
        css_classes: ['heading'],
        ellipsize: Pango.EllipsizeMode.END,
    });

    const descLabel = new Gtk.Label({
        label: description,
        xalign: 0,
        hexpand: true,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD,
        lines: 2,
        ellipsize: Pango.EllipsizeMode.END,
        css_classes: ['dim-label', 'caption'],
    });

    const sizeLabel = new Gtk.Label({
        label: gridSize,
        xalign: 0,
        hexpand: true,
        css_classes: ['dim-label', 'caption'],
        margin_top: 2,
    });

    textBox.append(titleLabel);
    textBox.append(descLabel);
    textBox.append(sizeLabel);
    card.append(textBox);

    // 3. Add gomb
    const addButton = new Gtk.Button({
        label: 'Add',
        css_classes: ['suggested-action', 'pill'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
        margin_top: 4,
        valign: Gtk.Align.END,
        halign: Gtk.Align.FILL,
    });
    addButton.connect('clicked', onAddClick);
    card.append(addButton);

    return card;
}

function createFlowBox() {
    return new Gtk.FlowBox({
        column_spacing: 12,
        row_spacing: 12,
        homogeneous: true,
        selection_mode: Gtk.SelectionMode.NONE,
        activate_on_single_click: false,
        max_children_per_line: CARDS_PER_ROW,
        min_children_per_line: CARDS_PER_ROW,
        halign: Gtk.Align.FILL,
        valign: Gtk.Align.START,
        margin_top: 6,
        margin_bottom: 6,
    });
}

function createCategoryGroup(title, cardDefinitions) {
    const group = new Adw.PreferencesGroup({ title: escapeMarkup(title) });
    const flowBox = createFlowBox();

    cardDefinitions.forEach(item => {
        const cardWidget = item.createCard();
        flowBox.append(cardWidget);
    });

    group.add(flowBox);
    return group;
}

export function buildStorePage(window, settings, extensionPath) {
    const page = new Adw.PreferencesPage({
        title: 'Store',
        icon_name: 'software-update-available-symbolic',
    });

    const addWeather = (width, height, layout) => {
        addWeatherWidget(settings, settings.get_string('weather-city'), width, height, layout);
    };

    // ── Kártya regisztrációs adatbázis a keresőhöz és a listázáshoz ─────────
    const allRegisteredItems = [];

    const def = (entry, onAdd) => {
        const item = {
            entry,
            title: (entry?.title || '').toLowerCase(),
            desc: (entry?.description || '').toLowerCase(),
            createCard: () => createDesktopWidgetCard(extensionPath, entry, onAdd),
        };
        allRegisteredItems.push(item);
        return item;
    };

    // ── Keresőmező fejléc ─────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup();
    const searchEntry = new Gtk.SearchEntry({
        placeholder_text: 'Search widgets...',
        hexpand: true,
        margin_top: 4,
        margin_bottom: 8,
    });
    searchGroup.add(searchEntry);
    page.add(searchGroup);

    // ── Keresési találatok csoportja (alapból rejtve) ──────────────────
    const searchResultsGroup = new Adw.PreferencesGroup();
    const searchResultsFlow = createFlowBox();
    searchResultsGroup.add(searchResultsFlow);
    searchResultsGroup.set_visible(false);
    page.add(searchResultsGroup);

    const noResultsLabel = new Gtk.Label({
        label: 'No widgets found',
        css_classes: ['dim-label', 'title-3'],
        margin_top: 24,
        margin_bottom: 24,
        halign: Gtk.Align.CENTER,
    });
    noResultsLabel.set_visible(false);
    searchResultsGroup.add(noResultsLabel);

    // ── Kategóriák definíciója ───────────────────────────────────────
    const weatherItems = [
        def(STORE_WIDGETS[STORE_CATEGORIES.weather[0]], () => addWeather(3, 3, 'standard')),
        def(STORE_WIDGETS[STORE_CATEGORIES.weather[1]], () => addWeather(3, 3, 'simple')),
        def(STORE_WIDGETS[STORE_CATEGORIES.weather[2]], () => addWeather(6, 4, 'forecast')),
        def(STORE_WIDGETS.weatherBars, () => addWeatherBarsWidget(settings, settings.get_string('weather-city'), 6, 6)),
        def(STORE_WIDGETS.weatherCards, () => addWeatherCardsWidget(settings, settings.get_string('weather-city'), 3, 3)),
        def(STORE_WIDGETS.sunScheduleWidget, () => openAddSunScheduleDialog(window, settings)),
        def(STORE_WIDGETS.moonWidget, () => openAddMoonDialog(window, settings)),
    ];

    const mediaItems = [
        def(STORE_WIDGETS[STORE_CATEGORIES.music[0]], () => addMusicWidget(settings, 4, 4)),
        def(STORE_WIDGETS[STORE_CATEGORIES.music[1]], () => addMusicWidget(settings, 8, 4)),
        def(STORE_WIDGETS[STORE_CATEGORIES.media[0]], () => openAddImageDialog(window, settings)),
        def(STORE_WIDGETS[STORE_CATEGORIES.media[1]], () => openAddSlideshowDialog(window, settings)),
    ];

    const systemItems = [
        def(STORE_WIDGETS.systemDashboard, () => addSystemDashboardWidget(settings, 4, 4)),
        def(STORE_WIDGETS.systemMonitor, () => addCpuRamWidget(settings, 4, 2)),
        def(STORE_WIDGETS.storageBar, () => addStorageBarWidget(settings)),
        def(STORE_WIDGETS.resourceWheel, () => addResourceWheelWidget(settings, 'cpu', 5, 4)),
        def(STORE_WIDGETS.systemInfo, () => addSystemInfoWidget(settings, 'cpu', 2, 2)),
        def(STORE_WIDGETS.networkSpeed, () => addNetworkSpeedWidget(settings, 3, 2)),
        def(STORE_WIDGETS.pingMonitor, () => addPingWidget(settings)),
        def(STORE_WIDGETS.quickToggles, () => addQuickTogglesWidget(settings)),
        def(STORE_WIDGETS.powerToggles, () => addPowerTogglesWidget(settings)),
        def(STORE_WIDGETS.powerProfiles, () => addPowerProfilesWidget(settings)),
        def(STORE_WIDGETS.batteryStatus, () => addBatteryStatusWidget(settings, 4, 3)),
        def(STORE_WIDGETS.audioOutput, () => addAudioOutputWidget(settings)),
        def(STORE_WIDGETS.bluetoothDevices, () => addBluetoothDevicesWidget(settings)),
        def(STORE_WIDGETS.controlsSliders, () => addControlsSlidersWidget(settings)),
    ];

    const focusItems = [
        def(STORE_WIDGETS.pomodoroTimer, () => addPomodoroWidget(settings, 4, 4)),
        def(STORE_WIDGETS.pomodoroFocus, () => addPomodoroFocusWidget(settings, 4, 2)),
        def(STORE_WIDGETS.todoWidget, () => addTodoWidget(settings)),
        def(STORE_WIDGETS.quickNotes, () => addNotesWidget(settings, 4, 4)),
        def(STORE_WIDGETS.clipboardHistory, () => addClipboardWidget(settings, 4, 4)),
        def(STORE_WIDGETS.appLauncher, () => openAddAppLauncherDialog(window, settings)),
        def(STORE_WIDGETS.mailGoa, () => addMailGoaWidget(settings)),
    ];

    const timeItems = [
        def(STORE_WIDGETS[STORE_CATEGORIES.time[0]], () => addTimeWidget(settings, 3, 2, 'digital')),
        def(STORE_WIDGETS.analogClock, () => addAnalogClockWidget(settings, 'basic', 3, 3)),
        def(STORE_WIDGETS.worldClock, () => openAddWorldClockDialog(window, settings)),
        def(STORE_WIDGETS.worldAnalog, () => openAddWorldAnalogDialog(window, settings)),
        def(STORE_WIDGETS.calendarWidget, () => addCalendarWidget(settings)),
        def(STORE_WIDGETS.calendarGrid, () => addCalendarGridWidget(settings)),
        def(STORE_WIDGETS.timer, () => addTimerWidget(settings)),
        def(STORE_WIDGETS.countdown, () => openAddCountdownDialog(window, settings)),
        def(STORE_WIDGETS.stopwatch, () => addStopWatchWidget(settings)),
        def(STORE_WIDGETS.binary, () => addBinaryWidget(settings)),
    ];

    const personalItems = [
        def(STORE_WIDGETS.currencyTracker, () => addCurrencyTrackerWidget(settings)),
        def(STORE_WIDGETS.cryptoWidget, () => addCryptoWidget(settings)),
        def(STORE_WIDGETS.githubWidget, () => openAddGithubDialog(window, settings)),
        def(STORE_WIDGETS.habitTracker, () => addHabitTrackerWidget(settings)),
        def(STORE_WIDGETS.watermind, () => openAddWatermindDialog(window, settings)),
        def(STORE_WIDGETS.moodWidget, () => addMoodWidget(settings)),
        def(STORE_WIDGETS.screenTimeWidget, () => addScreenTimeWidget(settings)),
        def(STORE_WIDGETS.todayHistory, () => addTodayHistoryWidget(settings)),
        def(STORE_WIDGETS.rssHeadlinesWidget, () => openAddRssHeadlinesDialog(window, settings)),
        def(STORE_WIDGETS.quotesWidget, () => addQuotesWidget(settings)),
        def(STORE_WIDGETS.calendarTasks, () => addCalendarTasksWidget(settings)),
        def(STORE_WIDGETS.lavaLamp, () => addLavaLampWidget(settings)),
    ];

    const categoryGroups = [
        createCategoryGroup('Weather', weatherItems),
        createCategoryGroup('Media', mediaItems),
        createCategoryGroup('System Monitor', systemItems),
        createCategoryGroup('Focus & Productivity', focusItems),
        createCategoryGroup('Time & Calendar', timeItems),
        createCategoryGroup('Personal', personalItems),
    ];

    categoryGroups.forEach(grp => page.add(grp));

    // ── Keresési logika ──────────────────────────────────────────────
    searchEntry.connect('search-changed', (entry) => {
        const query = entry.get_text().trim().toLowerCase();

        if (query.length < 2) {
            // Visszaállás az eredeti kategóriás nézetre
            searchResultsGroup.set_visible(false);
            noResultsLabel.set_visible(false);
            categoryGroups.forEach(grp => grp.set_visible(true));
            return;
        }

        // Kategóriák elrejtése keresés közben
        categoryGroups.forEach(grp => grp.set_visible(false));

        // Előző találatok törlése
        let child = searchResultsFlow.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            searchResultsFlow.remove(child);
            child = next;
        }

        // Szűrés címre és leírásra
        const matches = allRegisteredItems.filter(item =>
            item.title.includes(query) || item.desc.includes(query)
        );

        if (matches.length > 0) {
            matches.forEach(item => {
                searchResultsFlow.append(item.createCard());
            });
            searchResultsFlow.set_visible(true);
            noResultsLabel.set_visible(false);
        } else {
            searchResultsFlow.set_visible(false);
            noResultsLabel.set_visible(true);
        }

        searchResultsGroup.set_visible(true);
    });

    // Clamp tágítása, hogy széles ablaknál kényelmesen elférjen a 3 oszlop
    const stack = [page];
    while (stack.length > 0) {
        const widget = stack.pop();
        if (widget instanceof Adw.Clamp) {
            widget.maximum_size = CLAMP_MAXIMUM_SIZE;
            widget.tightening_threshold = 900;
            continue;
        }
        let ch = widget.get_first_child();
        while (ch) {
            stack.push(ch);
            ch = ch.get_next_sibling();
        }
    }

    return page;
}