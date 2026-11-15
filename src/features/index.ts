import type { Feature } from '../core/feature';
import { translateFeature } from './translate';

/** 功能清单。新增功能：在 src/features/ 下建目录，并在这里登记。 */
export const features: readonly Feature[] = [translateFeature];
