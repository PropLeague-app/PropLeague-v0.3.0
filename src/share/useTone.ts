import { usePlColorScale } from '../components/common/usePlStyle';
import { lossColor, lossIntensity } from '../engine/plColor';
import { C } from './palette';

/** Gives share cards the same P/L coloring the screens use: green for a gain, and for a loss either
 * plain red or, when the viewer turned on scaled coloring, yellow through red by how big the loss is
 * next to `ref` (see engine/plColor). Pass the same reference the screen uses for that number; with
 * none, a loss is plain red. */
export function useTone(): (amount: number, ref?: number) => string {
  const scale = usePlColorScale();
  return (amount: number, ref?: number) => {
    if (!(amount < 0)) return C.profit;
    if (scale === 'scaled' && ref != null && ref > 0) return lossColor(lossIntensity(amount, ref));
    return C.loss;
  };
}
