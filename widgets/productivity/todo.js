import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    getGridDesktopDataDir,
    loadJsonFromFileAsync,
    saveJsonToFile,
    saveJsonToFileSync
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 200;
const CONTAINER_PADDING_PX = 14;
const ROW_GAP_PX = 8;
const ROW_PADDING_V_PX = 8;
const ROW_PADDING_H_PX = 12;
const ROW_RADIUS_PX = 14;
const CHECKBOX_SIZE_PX = 20;

const DEFAULT_TASKS = [
    { text: 'Workout', done: true },
    { text: 'Study', done: false },
    { text: 'Eyedrops', done: true },
];

export function createTodoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    const dataDir = getGridDesktopDataDir('todos');
    const filePath = GLib.build_filenamev([dataDir, `todo-${config.id || 'default'}.json`]);

    let tasks = DEFAULT_TASKS.map(task => ({ ...task }));
    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    let tasksLoaded = false;

    const state = {
        isAdding: false
    };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    // ── FEJLÉC ──
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    mainBox.add_child(headerRow);

    const headerIcon = new St.Icon({
        icon_name: 'checkbox-checked-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(headerIcon);

    const titleLabel = new St.Label({
        text: 'To-Do',
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerRow.add_child(titleLabel);

    headerRow.add_child(new St.Widget({ x_expand: true }));

    const addButton = new St.Button({
        reactive: true,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: 'list-add-symbolic' }),
    });
    attachButtonFeedback(addButton);
    headerRow.add_child(addButton);

    // ── INLINE HOZZÁADÁS SOR ──
    const inlineInputBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    mainBox.add_child(inlineInputBox);

    const entry = new St.Entry({
        hint_text: 'New task…',
        can_focus: true,
        x_expand: true,
    });
    inlineInputBox.add_child(entry);

    const saveAddBtn = new St.Button({
        reactive: true,
        can_focus: true,
        child: new St.Icon({ icon_name: 'emblem-ok-symbolic' }),
    });
    attachButtonFeedback(saveAddBtn);
    inlineInputBox.add_child(saveAddBtn);

    const cancelAddBtn = new St.Button({
        reactive: true,
        can_focus: true,
        child: new St.Icon({ icon_name: 'window-close-symbolic' }),
    });
    attachButtonFeedback(cancelAddBtn);
    inlineInputBox.add_child(cancelAddBtn);

    // ── GÖRGETHETŐ FELADATLISTA ──
    const listScroll = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    listScroll.add_child(listContainer);
    mainBox.add_child(listScroll);

    const saveTasks = () => saveJsonToFile(filePath, { tasks });

    function triggerAdd() {
        const text = entry.get_text().trim();
        if (text.length > 0) {
            tasks.push({ text, done: false });
            saveTasks();
            renderRows();
        }
        entry.set_text('');
        state.isAdding = false;
        inlineInputBox.visible = false;
        if (global.stage.get_key_focus() === entry) {
            global.stage.set_key_focus(null);
        }
    }

    addButton.connect('clicked', () => {
        state.isAdding = !state.isAdding;
        inlineInputBox.visible = state.isAdding;
        if (state.isAdding) entry.grab_key_focus();
    });

    saveAddBtn.connect('clicked', triggerAdd);
    entry.clutter_text.connect('activate', triggerAdd);

    cancelAddBtn.connect('clicked', () => {
        state.isAdding = false;
        inlineInputBox.visible = false;
        entry.set_text('');
        if (global.stage.get_key_focus() === entry) {
            global.stage.set_key_focus(null);
        }
    });

    entry.clutter_text.connect('key-press-event', (_actor, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            state.isAdding = false;
            inlineInputBox.visible = false;
            entry.set_text('');
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    function renderRows() {
        listContainer.destroy_all_children();
        const px = (v) => Math.max(1, Math.round(v * scale));

        if (tasks.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No tasks yet',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(12)}px; color: ${textColor}; opacity: 0.5; margin-top: ${px(20)}px;`,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        tasks.forEach((task, idx) => {
            // Aktív vs elvégzett kártya háttér/átlátszóság
            const cardBg = task.done ? `rgba(${textRgb()}, 0.04)` : `rgba(${textRgb()}, 0.12)`;
            const borderCol = task.done ? `rgba(${textRgb()}, 0.08)` : `rgba(${textRgb()}, 0.22)`;

            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `background-color: ${cardBg}; `
                     + `border: 1px solid ${borderCol}; `
                     + `padding: ${px(ROW_PADDING_V_PX)}px ${px(ROW_PADDING_H_PX)}px; `
                     + `border-radius: ${px(ROW_RADIUS_PX)}px; `
                     + `margin-bottom: ${px(ROW_GAP_PX)}px; `
                     + `margin-right: ${px(4)}px;`
            });

            // Kör alakú checkbox
            const checkBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `width: ${px(CHECKBOX_SIZE_PX)}px; height: ${px(CHECKBOX_SIZE_PX)}px; `
                     + `border-radius: 9999px; `
                     + `background-color: ${task.done ? 'transparent' : 'transparent'}; `
                     + `border: ${Math.max(1, px(1.5))}px solid rgba(${textRgb()}, ${task.done ? '0.35' : '0.65'}); `
                     + `margin-right: ${px(10)}px;`
            });

            if (task.done) {
                checkBtn.set_child(new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: px(11),
                    style: `color: ${textColor}; opacity: 0.5;`
                }));
            }

            checkBtn.connect('clicked', () => {
                if (isActorDestroyed(container)) return;
                task.done = !task.done;
                saveTasks();
                renderRows();
            });
            attachButtonFeedback(checkBtn);
            row.add_child(checkBtn);

            // Szöveg formázása
            const escapedText = GLib.markup_escape_text(task.text || '', -1);
            const textMarkup = task.done ? `<s>${escapedText}</s>` : escapedText;

            const textLabel = new St.Label({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(13)}px; `
                     + `color: ${textColor}; opacity: ${task.done ? 0.45 : 0.95}; `
                     + `font-weight: ${task.done ? 'normal' : '500'};`
            });
            textLabel.clutter_text.use_markup = true;
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textLabel.clutter_text.set_markup(textMarkup);
            row.add_child(textLabel);

            // Törlés gomb
            const deleteBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `padding: ${px(2)}px; border-radius: 9999px; opacity: 0.4;`,
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: px(12)
                })
            });
            deleteBtn.connect('clicked', () => {
                if (isActorDestroyed(container)) return;
                tasks.splice(idx, 1);
                saveTasks();
                renderRows();
            });
            attachButtonFeedback(deleteBtn);
            row.add_child(deleteBtn);

            listContainer.add_child(row);
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px; spacing: ${px(8)}px;`;

        const titleFontSize = Math.max(11, Math.round(13 * scale));

        headerRow.style = `margin-bottom: ${px(4)}px;`;
        headerIcon.icon_size = px(16);
        headerIcon.style = `color: ${textColor}; margin-right: ${px(6)}px;`;

        titleLabel.style = `${fontCss}font-size: ${titleFontSize}px; font-weight: bold; `
            + `color: ${textColor}; opacity: 0.9;`;

        addButton.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.12); padding: ${px(4)}px;`;
        if (addButton.child) addButton.child.icon_size = px(13);

        inlineInputBox.style = `spacing: ${px(6)}px; margin-bottom: ${px(6)}px;`;
        entry.style = `${fontCss}font-size: ${px(12)}px; padding: ${px(4)}px ${px(8)}px; border-radius: ${px(6)}px;`;

        saveAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.15); padding: ${px(4)}px;`;
        if (saveAddBtn.child) saveAddBtn.child.icon_size = px(12);

        cancelAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.1); padding: ${px(4)}px;`;
        if (cancelAddBtn.child) cancelAddBtn.child.icon_size = px(12);

        renderRows();
    }

    applyScale(scale);

    registerWidgetCleanup(container, () => {
        if (tasksLoaded)
            saveJsonToFileSync(filePath, { tasks });
        if (global.stage.get_key_focus() === entry)
            global.stage.set_key_focus(null);
    });

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    loadJsonFromFileAsync(filePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        tasksLoaded = true;
        if (savedData && Array.isArray(savedData.tasks)) {
            tasks = savedData.tasks.filter(t => t && typeof t.text === 'string')
                .map(t => ({ text: t.text, done: !!t.done }));
            renderRows();
        } else if (!loadError) {
            saveTasks();
        }
    });

    return container;
}