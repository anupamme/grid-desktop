import Clutter from 'gi://Clutter';
import { buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { WidgetActor, resolveWidgetGlassHighlight } from '../../shell/widgetUIUtils.js';
import { attachCaptionOverlay } from './mediaCommon.js';



export function createStaticImageNode(widgetData, width, height, xPosition, yPosition) {
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const glassHighlight = resolveWidgetGlassHighlight(widgetData);
    const widgetStyle = `background-image: url("file://${widgetData.imagePath}"); background-size: cover; ${baseStyle} ${glassHighlight}`;

    const widgetNode = new WidgetActor({
        style: widgetStyle,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });

    widgetNode.set_clip_to_allocation(true);
    attachCaptionOverlay(widgetNode, widgetData, width, height);

    return widgetNode;
}
