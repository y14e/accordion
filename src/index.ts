/**
 * Accordion
 * WAI-ARIA compliant accordion pattern implementation in TypeScript.
 *
 * @version 2.0.4
 * @author Yusuke Kamiyamane
 * @license MIT
 * @copyright Copyright (c) Yusuke Kamiyamane
 * @see {@link https://github.com/y14e/accordion}
 */

// -----------------------------------------------------------------------------
// import
// -----------------------------------------------------------------------------

import {
  addTokenToAttribute,
  restoreAttributes,
  saveAttributes,
} from '@y14e/attributes-utils';
import Button from '@y14e/button';
import { createRovingTabIndex } from '@y14e/roving-tabindex';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AccordionOptions {
  animation: {
    duration: number;
    easing: string;
  };
  collapsible: boolean;
  selector: {
    content: string;
    trigger: string;
  };
}

type Binding = {
  animation: Animation | null;
  content: HTMLElement;
  trigger: HTMLElement;
};

// -----------------------------------------------------------------------------
// APIs
// -----------------------------------------------------------------------------

export default class Accordion {
  static defaults: Partial<AccordionOptions> = {};

  #rootElement!: HTMLElement;
  #defaults = {
    animation: { duration: 300, easing: 'ease' },
    collapsible: true,
    selector: {
      content: '[data-accordion-content]',
      trigger: '[data-accordion-trigger]',
    },
  };
  #settings!: AccordionOptions;
  #triggerElements!: HTMLElement[];
  #contentElements!: HTMLElement[];
  #bindings = new WeakMap<HTMLElement, Binding>();
  #eventController: AbortController | null = null;
  #animationController: AbortController | null = null;
  #cleanupRovingTabIndex: (() => void) | null = null;
  #buttons: Button[] = [];
  #isDestroyed = false;

  constructor(root: HTMLElement, options: Partial<AccordionOptions> = {}) {
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Invalid root element');
    }

    if (root.hasAttribute('data-accordion-initialized')) {
      console.warn('Already initialized');
      return;
    }

    this.#rootElement = root;
    this.#defaults = this.#mergeOptions(this.#defaults, Accordion.defaults);
    this.#settings = this.#mergeOptions(this.#defaults, options);
    matchMedia('(prefers-reduced-motion: reduce)').matches &&
      Object.assign(this.#settings.animation, { duration: 0 });
    const { trigger, content } = this.#settings.selector;
    const NOT_NESTED = `:not(:scope ${content} *)`;
    this.#triggerElements = [
      ...this.#rootElement.querySelectorAll<HTMLElement>(
        `${trigger}${NOT_NESTED}`,
      ),
    ];

    if (!this.#triggerElements.length) {
      console.warn('Missing trigger elements');
      return;
    }

    this.#contentElements = [
      ...this.#rootElement.querySelectorAll<HTMLElement>(
        `${content}${NOT_NESTED}`,
      ),
    ];

    if (!this.#contentElements.length) {
      console.warn('Missing content elements');
      return;
    }

    this.#triggerElements.forEach((trigger, i) => {
      const content = this.#contentElements[i];

      if (!content) {
        return;
      }

      const binding = this.#createBinding(trigger, content);
      this.#bindings.set(trigger, binding);
      this.#bindings.set(content, binding);
    });

    this.#initialize();
  }

  collapse(trigger: HTMLElement): void {
    if (this.#isDestroyed) {
      return;
    }

    if (!(trigger instanceof HTMLElement) || !this.#bindings.has(trigger)) {
      console.warn('Invalid trigger element');
      return;
    }

    this.#toggle(trigger, false);
  }

  async destroy(force = false): Promise<void> {
    if (this.#isDestroyed) {
      return;
    }

    this.#isDestroyed = true;
    this.#eventController?.abort();
    this.#eventController = null;
    this.#cleanupRovingTabIndex?.();
    this.#cleanupRovingTabIndex = null;

    this.#buttons.forEach((button) => {
      button.destroy();
    });

    this.#buttons.length = 0;
    !force && (await this.#waitAnimationsFinish());

    this.#contentElements.forEach((content) => {
      force && this.#bindings.get(content)?.animation?.finish();
      this.#onContentAnimationFinish(content);
    });

    this.#animationController?.abort();
    this.#animationController = null;
    restoreAttributes([...this.#triggerElements, ...this.#contentElements]);
    this.#triggerElements.length = 0;
    this.#contentElements.length = 0;
    this.#rootElement.removeAttribute('data-accordion-initialized');
  }

  expand(trigger: HTMLElement): void {
    if (this.#isDestroyed) {
      return;
    }

    if (!(trigger instanceof HTMLElement) || !this.#bindings.has(trigger)) {
      console.warn('Invalid trigger element');
      return;
    }

    this.#toggle(trigger, true);
  }

  #initialize(): void {
    saveAttributes(this.#triggerElements, [
      'aria-controls',
      'aria-disabled',
      'id',
      'style',
      'tabindex',
    ]);
    saveAttributes(this.#contentElements, ['aria-labelledby', 'id', 'role']);
    this.#eventController = new AbortController();
    const { signal } = this.#eventController;

    this.#triggerElements.forEach((trigger, i) => {
      const id = Math.random().toString(36).slice(-8);
      const content = this.#contentElements[i];

      if (!content) {
        return;
      }

      content.id ||= `accordion-content-${id}`;
      addTokenToAttribute(trigger, 'aria-controls', content.id);
      trigger.setAttribute(
        'aria-expanded',
        String(trigger.ariaExpanded === 'true'),
      );
      trigger.id ||= `accordion-trigger-${id}`;

      if (!this.#isFocusable(trigger)) {
        trigger.setAttribute('aria-disabled', 'true');
        trigger.setAttribute('tabindex', '-1');
        trigger.style.setProperty('pointer-events', 'none');
      }

      trigger.addEventListener('click', this.#onTriggerClick, { signal });
      addTokenToAttribute(content, 'aria-labelledby', trigger.id);
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.#onContentBeforeMatch, {
        signal,
      });
      this.#buttons.push(new Button(trigger));
    });

    const { trigger, content } = this.#settings.selector;
    this.#cleanupRovingTabIndex = createRovingTabIndex(this.#rootElement, {
      direction: 'vertical',
      navigationOnly: true,
      selector: `${trigger}:not(:scope ${content} *)`,
      wrap: true,
    });
    this.#rootElement.setAttribute('data-accordion-initialized', '');
  }

  #onTriggerClick = (event: Event): void => {
    event.preventDefault();
    const trigger = event.currentTarget;

    if (!(trigger instanceof HTMLElement)) {
      return;
    }

    this.#toggle(trigger, trigger.ariaExpanded === 'false');
  };

  #onContentAnimationFinish(content: HTMLElement): void {
    const trigger = this.#bindings.get(content)?.trigger;

    if (!trigger) {
      return;
    }

    trigger.ariaExpanded === 'false' &&
      content.setAttribute('hidden', 'until-found');

    ['block-size', 'overflow'].forEach((name) => {
      content.style.removeProperty(name);
    });
  }

  #onContentBeforeMatch = (event: Event): void => {
    const content = event.currentTarget;

    if (!(content instanceof HTMLElement)) {
      return;
    }

    const binding = this.#bindings.get(content);

    if (!binding) {
      return;
    }

    binding.trigger.ariaExpanded === 'false' &&
      this.#toggle(binding.trigger, true, true);
  };

  #toggle(
    trigger: HTMLElement,
    isExpand: boolean,
    isMatch = false,
    isProgrammatic = false,
  ): void {
    if (trigger.ariaExpanded === String(isExpand)) {
      return;
    }

    if (
      !isExpand &&
      !isProgrammatic &&
      !this.#settings.collapsible &&
      this.#triggerElements.filter((trigger) => trigger.ariaExpanded === 'true')
        .length <= 1
    ) {
      return;
    }

    const name = trigger.getAttribute('data-accordion-name');

    if (name && isExpand) {
      const expanded = this.#triggerElements.find(
        (t) =>
          t !== trigger &&
          t.getAttribute('data-accordion-name') === name &&
          t.ariaExpanded === 'true',
      );
      expanded && this.#toggle(expanded, false, isMatch, true);
    }

    trigger.setAttribute(
      'aria-label',
      trigger.getAttribute(
        `data-accordion-${isExpand ? 'expanded' : 'collapsed'}-label`,
      ) ??
        trigger.ariaLabel ??
        '',
    );

    const binding = this.#bindings.get(trigger);

    if (!binding) {
      return;
    }

    const { content } = binding;
    const startSize = content.hidden ? 0 : content.offsetHeight;

    if (content.hidden) {
      content.hidden = false;
    }

    const endSize = isExpand ? content.scrollHeight : 0;
    binding.animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    const { duration, easing } = this.#settings.animation;
    const animation = content.animate(
      { blockSize: [`${startSize}px`, `${endSize}px`] },
      { duration: isMatch ? 0 : duration, easing },
    );
    binding.animation = animation;
    trigger.setAttribute('aria-expanded', String(isExpand));

    function cleanup(): void {
      if (binding?.animation === animation) {
        binding.animation = null;
      }
    }

    this.#animationController = new AbortController();
    const { signal } = this.#animationController;
    animation.addEventListener('cancel', cleanup, { once: true, signal });

    animation.addEventListener(
      'finish',
      () => {
        if (binding?.animation === animation) {
          this.#onContentAnimationFinish(content);
          cleanup();
        }
      },
      { once: true, signal },
    );
  }

  #createBinding(trigger: HTMLElement, content: HTMLElement): Binding {
    return { animation: null, content, trigger };
  }

  #isFocusable(element: HTMLElement): boolean {
    return !element.hasAttribute('disabled') && element.tabIndex >= 0;
  }

  #mergeOptions(
    target: AccordionOptions,
    source: Partial<AccordionOptions>,
  ): AccordionOptions {
    return {
      ...target,
      ...source,
      animation: { ...target.animation, ...(source.animation ?? {}) },
      selector: { ...target.selector, ...(source.selector ?? {}) },
    };
  }

  async #waitAnimationsFinish(): Promise<void> {
    const promises: Promise<void>[] = [];

    this.#contentElements.forEach((content) => {
      const animation = this.#bindings.get(content)?.animation;
      animation && promises.push(waitAnimationFinish(animation));
    });

    await Promise.allSettled(promises);
  }
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

function waitAnimationFinish(animation: Animation): Promise<void> {
  return ['idle', 'finished'].includes(animation.playState)
    ? Promise.resolve()
    : new Promise((resolve) =>
        animation.addEventListener('finish', () => resolve(), { once: true }),
      );
}
