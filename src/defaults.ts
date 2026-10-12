import type { AccordionOptions as Options } from '@/types';

export const defaults: Options = {
  animation: {
    duration: 300,
    easing: 'ease',
  },
  collapsible: true,
  selector: {
    content: '[data-accordion-content]',
    trigger: '[data-accordion-trigger]',
  },
};
