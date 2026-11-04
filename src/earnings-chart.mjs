import {init,use} from 'echarts/core';
import {BarChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
use([BarChart,GridComponent,LegendComponent,TooltipComponent,CanvasRenderer]);
export {init};
