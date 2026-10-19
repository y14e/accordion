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

      [trigger, content].forEach((element) => {
        this.#bindings.set(element, binding);
      });
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

    for (const name of ['block-size', 'overflow']) {
      content.style.removeProperty(name);
    }
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
