/**
 * Accordion
 * WAI-ARIA compliant accordion pattern implementation in TypeScript.
 *
 * @version 1.2.6
 * @author Yusuke Kamiyamane
 * @license MIT
 * @copyright Copyright (c) Yusuke Kamiyamane
 * @see {@link https://github.com/y14e/accordion}
 */

// -----------------------------------------------------------------------------
// import
// -----------------------------------------------------------------------------

import type { DeepRequired } from 'utility-types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AccordionOptions {
  readonly animation?: {
    readonly duration?: number;
    readonly easing?: string;
  };
  readonly selector?: {
    readonly content?: string;
    readonly trigger?: string;
  };
}

type Binding = {
  trigger: HTMLElement;
  content: HTMLElement;
  animation: Animation | null;
};

// -----------------------------------------------------------------------------
// APIs
// -----------------------------------------------------------------------------

export default class Accordion {
  static defaults: AccordionOptions = {};

  #rootElement!: HTMLElement;
  #defaults = {
    animation: { duration: 300, easing: 'ease' },
    selector: {
      content: ':has(> [data-accordion-trigger]) + *',
      trigger: '[data-accordion-trigger]',
    },
  };
  #settings!: DeepRequired<AccordionOptions>;
  #triggerElements!: HTMLElement[];
  #contentElements!: HTMLElement[];
  #bindings = new WeakMap<HTMLElement, Binding>();
  #eventController: AbortController | null = null;
  #animationController: AbortController | null = null;
  #isDestroyed = false;

  constructor(root: HTMLElement, options: AccordionOptions = {}) {
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

      const binding = createBinding(trigger, content);
      this.#bindings.set(trigger, binding);
      this.#bindings.set(content, binding);
    });

    this.#initialize();
  }

  open(trigger: HTMLElement): void {
    if (this.#isDestroyed) {
      return;
    }

    if (!(trigger instanceof HTMLElement) || !this.#bindings.has(trigger)) {
      console.warn('Invalid trigger element');
      return;
    }

    this.#toggle(trigger, true);
  }

  close(trigger: HTMLElement): void {
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
    !force && (await this.#waitAnimationsFinish());

    this.#contentElements.forEach((content) => {
      force && this.#bindings.get(content)?.animation?.finish();
      this.#onAnimationFinish(content);
    });

    this.#animationController?.abort();
    this.#animationController = null;
    this.#triggerElements.length = 0;
    this.#contentElements.length = 0;
    this.#rootElement.removeAttribute('data-accordion-initialized');
  }

  #initialize(): void {
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
        trigger.ariaExpanded === 'true' ? 'true' : 'false',
      );
      trigger.id ||= `accordion-trigger-${id}`;

      if (!isFocusable(trigger)) {
        trigger.setAttribute('aria-disabled', 'true');
        trigger.setAttribute('tabindex', '-1');
        trigger.style.setProperty('pointer-events', 'none');
      }

      trigger.addEventListener('click', this.#onTriggerClick, { signal });
      trigger.addEventListener('keydown', this.#onTriggerKeyDown, { signal });
      addTokenToAttribute(content, 'aria-labelledby', trigger.id);
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.#onContentBeforeMatch, {
        signal,
      });
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

  #onTriggerKeyDown = (event: KeyboardEvent): void => {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = event;

    if (altKey || ctrlKey || metaKey || shiftKey) {
      return;
    }

    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return;
    }

    const focusables = this.#triggerElements.filter(isFocusable);
    const active = getActiveElement();

    if (!(active instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    const currentIndex = focusables.indexOf(active);
    let newIndex = currentIndex;

    switch (key) {
      case 'Enter':
      case ' ':
        active.click();
        return;
      case 'End':
        newIndex = -1;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'ArrowUp':
        newIndex = currentIndex - 1;
        break;
      case 'ArrowDown':
        newIndex = (currentIndex + 1) % focusables.length;
        break;
    }

    focusables.at(newIndex)?.focus();
  };

  #onContentBeforeMatch = (event: Event): void => {
    const content = event.currentTarget;

    if (!(content instanceof HTMLElement)) {
      return;
    }

    const binding = this.#bindings.get(content);

    if (!binding) {
      return;
    }

    binding.trigger.ariaExpanded !== 'true' &&
      this.#toggle(binding.trigger, true, true);
  };

  #toggle(trigger: HTMLElement, isOpen: boolean, isMatch = false): void {
    if (trigger.ariaExpanded === String(isOpen)) {
      return;
    }

    const name = trigger.getAttribute('data-accordion-name');

    if (name && isOpen) {
      const opened = this.#triggerElements.find(
        (t) =>
          t !== trigger &&
          t.getAttribute('data-accordion-name') === name &&
          t.ariaExpanded === 'true',
      );

      if (opened) {
        this.#toggle(opened, false, isMatch);
      }
    }

    trigger.setAttribute(
      'aria-label',
      trigger.getAttribute(
        `data-accordion-${isOpen ? 'expanded' : 'collapsed'}-label`,
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

    const endSize = isOpen ? content.scrollHeight : 0;
    binding.animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    const { duration, easing } = this.#settings.animation;
    const animation = content.animate(
      { blockSize: [`${startSize}px`, `${endSize}px`] },
      { duration: isMatch ? 0 : duration, easing },
    );
    binding.animation = animation;
    trigger.setAttribute('aria-expanded', String(isOpen));

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
        this.#onAnimationFinish(content);
        cleanup();
      },
      { once: true, signal },
    );
  }

  #mergeOptions(
    target: DeepRequired<AccordionOptions>,
    source: AccordionOptions,
  ): DeepRequired<AccordionOptions> {
    return {
      animation: { ...target.animation, ...(source.animation ?? {}) },
      selector: { ...target.selector, ...(source.selector ?? {}) },
    };
  }

  #onAnimationFinish(content: HTMLElement): void {
    const trigger = this.#bindings.get(content)?.trigger;

    if (!trigger) {
      return;
    }

    if (trigger.ariaExpanded === 'false') {
      content.setAttribute('hidden', 'until-found');
    }

    const { style } = content;
    style.removeProperty('block-size');
    style.removeProperty('overflow');
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

function addTokenToAttribute(
  element: HTMLElement,
  attribute: string,
  token: string,
): void {
  const tokens = new Set(
    element.getAttribute(attribute)?.trim().split(/\s+/) ?? [],
  );
  tokens.add(token);
  element.setAttribute(attribute, [...tokens].join(' '));
}

function createBinding(trigger: HTMLElement, content: HTMLElement): Binding {
  return { trigger, content, animation: null };
}

function getActiveElement(): Element | null {
  let current = document.activeElement;

  while (current?.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement;
  }

  return current;
}

function isFocusable(element: HTMLElement): boolean {
  return !element.hasAttribute('disabled') && element.tabIndex >= 0;
}

function waitAnimationFinish(animation: Animation): Promise<void> {
  const { playState } = animation;

  if (playState === 'idle' || playState === 'finished') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) =>
    animation.addEventListener('finish', () => resolve(), { once: true }),
  );
}
