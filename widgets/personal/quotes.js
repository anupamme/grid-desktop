import Gio from 'gi://Gio';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { SECONDARY_OPACITY, resolveExplicitFontFamily, resolveWidgetForegroundColor } from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const QUOTE_ROTATE_INTERVAL_SEC = 30;

let quotesJsonPath = null;
try {
    const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
    const currentDir = GLib.path_get_dirname(currentFilePath);
    quotesJsonPath = GLib.build_filenamev([currentDir, '..', '..', 'utils', 'quotesData.json']);
} catch (e) {
    console.error('Grid Desktop: Failed to resolve quotes JSON path:', e.message);
}

export function createQuotesNode(config, width, height, xPosition, yPosition) {
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';

    const REF_WIDTH = 220;
    const REF_HEIGHT = 220;
    let scale = Math.min(width / REF_WIDTH, height / REF_HEIGHT);

    const outerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${Math.max(1, Math.round(14 * scale))}px;`,
    });
    container.add_child(outerBox);

    const quoteLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(17 * scale))}px; padding: 0 4px;`,
    });
    quoteLabel.clutter_text.line_wrap = true;
    quoteLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    outerBox.add_child(quoteLabel);

    const authorLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
        x_expand: true,
        y_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(13 * scale))}px; `
            + `opacity: ${SECONDARY_OPACITY}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`,
    });
    outerBox.add_child(authorLabel);

    const state = { timerId: null, refreshTimerId: null, cancellable: new Gio.Cancellable() };
    let quotes = [];

    function showQuote(quote) {
        quoteLabel.set_text(quote.text);
        authorLabel.set_text(`— ${quote.author}`);
    }

    function fetchQuotes() {
        if (!quotesJsonPath || !GLib.file_test(quotesJsonPath, GLib.FileTest.EXISTS)) {
            console.error('Quotes JSON file does not exist at:', quotesJsonPath);
            return;
        }

        const file = Gio.File.new_for_path(quotesJsonPath);

        file.load_contents_async(state.cancellable, (sourceFile, res) => {
            if (isActorDestroyed(container)) return;
            try {
                const [success, contents] = sourceFile.load_contents_finish(res);
                if (!success || !contents || contents.length === 0) {
                    console.error('Failed to read quotes JSON or file is empty');
                    return;
                }

                const raw = new TextDecoder().decode(contents);
                quotes = JSON.parse(raw);

                if (quotes && quotes.length > 0) {
                    const quote = quotes[Math.floor(Math.random() * quotes.length)];
                    showQuote(quote);
                }
            } catch (err) {
                console.error('Failed to parse local quotes JSON:', err);
            }
        });
    }

    fetchQuotes();

    function applyScale(newScale) {
        scale = newScale;
        outerBox.style = `padding: ${Math.max(1, Math.round(14 * scale))}px;`;
        quoteLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(17 * scale))}px; padding: 0 4px;`;
        authorLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.max(1, Math.round(13 * scale))}px; `
            + `opacity: ${SECONDARY_OPACITY}; padding-right: ${Math.max(1, Math.round(4 * scale))}px;`;
    }

    attachResponsiveScaler(container, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.min(w / REF_WIDTH, h / REF_HEIGHT));
    });

    state.refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, QUOTE_ROTATE_INTERVAL_SEC, () => {
        fetchQuotes();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        if (state.refreshTimerId) {
            GLib.Source.remove(state.refreshTimerId);
            state.refreshTimerId = null;
        }
        if (state.cancellable) {
            state.cancellable.cancel();
        }
    });

    return container;
}