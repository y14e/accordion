import {
  addAttributeToken,
  restoreAttributes,
  saveAttributes,
} from '@y14e/attribute-utils';
import { generateBase62Random } from '@y14e/basen';
import { Button } from '@y14e/button';
import { createRovingTabIndex } from '@y14e/roving-tabindex';
import { defaults } from './defaults';
import { resolveOptions } from './options';
import type { Binding, AccordionOptions as Options } from './types';

export class Accordion {
  static defaults: Partial<Options> = {};

  #rootElement!: HTMLElement;
  #settings!: Options;
  #itemElements!: HTMLElement[];
  #triggerElements!: HTMLElement[];
  #contentElements!: HTMLElement[];
  #bindings = new WeakMap<HTMLElement, Binding>();
  #eventController: AbortController | null = null;
  #animationController: AbortController | null = null;
  #cleanupRovingTabIndex: (() => void) | null = null;
  #buttons: Button[] = [];
  #isDestroyed = false;

  constructor(root: HTMLElement, options: Partial<Options> = {}) {
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Invalid root element');
    }

    if (root.hasAttribute('data-accordion-initialized')) {
      console.warn('Already initialized');
      return;
    }

    this.#rootElement = root;
    this.#settings = resolveOptions(
      resolveOptions(defaults, Accordion.defaults),
      options,
    );

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#settings.animation.duration = 0;
    }

    const { item, trigger, content } = this.#settings.selector;
    const NOT_NESTED = `:not(:scope ${content} *)`;
    this.#itemElements = [
      ...this.#rootElement.querySelectorAll<HTMLElement>(
        `${item}${NOT_NESTED}`,
      ),
    ];

    if (!this.#itemElements.length) {
      console.warn('Missing item elements');
      return;
    }

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

    this.#itemElements.forEach((item, i) => {
      const trigger = this.#triggerElements[i];
      const content = this.#contentElements[i];

      if (!trigger || !content) {
        return;
      }

      const binding = this.#createBinding(item, trigger, content);

      [item, trigger, content].forEach((element) => {
        this.#bindings.set(element, binding);
      });
    });

    this.#initialize();
  }

  collapse(item: HTMLElement): void {
    if (this.#isDestroyed) {
      return;
    }

    if (!(item instanceof HTMLElement) || !this.#bindings.has(item)) {
      console.warn('Invalid item element');
      return;
    }

    this.#toggle(item, false);
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

    for (const button of this.#buttons) {
      button.destroy();
    }

    this.#buttons.length = 0;
    !force && (await this.#waitAnimationsFinish());

    for (const content of this.#contentElements) {
      force && this.#bindings.get(content)?.animation?.finish();
      this.#onContentAnimationFinish(content);
    }

    this.#animationController?.abort();
    this.#animationController = null;
    restoreAttributes([...this.#triggerElements, ...this.#contentElements]);
    this.#itemElements.length = 0;
    this.#triggerElements.length = 0;
    this.#contentElements.length = 0;
    this.#rootElement.removeAttribute('data-accordion-initialized');
  }

  expand(item: HTMLElement): void {
    if (this.#isDestroyed) {
      return;
    }

    if (!(item instanceof HTMLElement) || !this.#bindings.has(item)) {
      console.warn('Invalid item element');
      return;
    }

    this.#toggle(item, true);
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
      const id = generateBase62Random(4);
      const content = this.#contentElements[i];

      if (!content) {
        return;
      }

      content.id ||= `accordion-content-${id}`;
      addAttributeToken(trigger, 'aria-controls', content.id);
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
      addAttributeToken(content, 'aria-labelledby', trigger.id);
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

  #onTriggerClick = (event: MouseEvent): void => {
    event.preventDefault();
    const trigger = event.currentTarget;

    if (!(trigger instanceof HTMLElement)) {
      return;
    }

    const item = this.#bindings.get(trigger)?.item;
    item && this.#toggle(item, trigger.ariaExpanded === 'false');
  };

  #onContentAnimationFinish(content: HTMLElement): void {
    const trigger = this.#bindings.get(content)?.trigger;

    if (!trigger) {
      return;
    }

    trigger.ariaExpanded === 'false' &&
      content.setAttribute('hidden', 'until-found');

    for (const name of ['block-size', 'overflow']) {
      content.style.removeProperty(name);
    }
  }

  #onContentBeforeMatch = (event: Event): void => {
    const content = event.currentTarget;

    if (!(content instanceof HTMLElement)) {
      return;
    }

    const trigger = this.#bindings.get(content)?.trigger;
    trigger?.ariaExpanded === 'false' && this.#toggle(content, true, true);
  };

  #toggle(
    item: HTMLElement,
    isExpand: boolean,
    isMatch = false,
    isProgrammatic = false,
  ): void {
    const binding = this.#bindings.get(item);

    if (!binding) {
      return;
    }

    const { trigger, content } = binding;

    if (trigger.ariaExpanded === String(isExpand)) {
      return;
    }

    if (
      !isExpand &&
      !isProgrammatic &&
      !this.#settings.collapsible &&
      this.#triggerElements.filter((t) => t.ariaExpanded === 'true').length <= 1
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

    const startSize = !content.hidden ? content.offsetHeight : 0;

    if (content.hidden) {
      content.hidden = false;
    }

    const endSize = isExpand ? content.scrollHeight : 0;
    binding.animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    const { duration, easing } = this.#settings.animation;
    const animation = content.animate(
      { blockSize: [`${startSize}px`, `${endSize}px`] },
      { duration: !isMatch ? duration : 0, easing },
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

  #createBinding(
    item: HTMLElement,
    trigger: HTMLElement,
    content: HTMLElement,
  ): Binding {
    return { animation: null, content, item, trigger };
  }

  #isFocusable(element: HTMLElement): boolean {
    return !element.hasAttribute('disabled') && element.tabIndex >= 0;
  }

  async #waitAnimationsFinish(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const content of this.#contentElements) {
      const animation = this.#bindings.get(content)?.animation;
      animation && promises.push(waitAnimationFinish(animation));
    }

    await Promise.allSettled(promises);
  }
}

function waitAnimationFinish(animation: Animation): Promise<void> {
  return ['finished', 'idle'].includes(animation.playState)
    ? Promise.resolve()
    : new Promise((resolve) =>
        animation.addEventListener('finish', () => resolve(), { once: true }),
      );
}

export type { Options as AccordionOptions };
