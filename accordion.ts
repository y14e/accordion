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

type DeepRequired<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> }
      : NonNullable<T>;

type Binding = {
  trigger: HTMLElement;
  content: HTMLElement;
  animation: Animation | null;
};

export default class Accordion {
  #rootElement: HTMLElement;
  #defaults = {
    animation: { duration: 300, easing: 'ease' },
    selector: {
      content: ':has(> [data-accordion-trigger]) + *',
      trigger: '[data-accordion-trigger]',
    },
  } satisfies DeepRequired<AccordionOptions>;
  #settings: DeepRequired<AccordionOptions>;
  #triggerElements: NodeListOf<HTMLElement> | null;
  #contentElements: NodeListOf<HTMLElement> | null;
  #bindings: WeakMap<HTMLElement, Binding> | null = new WeakMap();
  #controller: AbortController | null = new AbortController();
  #destroyed = false;

  constructor(root: HTMLElement, options: AccordionOptions = {}) {
    if (!root) {
      throw new Error('Root element missing.');
    }

    this.#rootElement = root;
    this.#settings = {
      animation: { ...this.#defaults.animation, ...(options.animation ?? {}) },
      selector: { ...this.#defaults.selector, ...(options.selector ?? {}) },
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Object.assign(this.#settings.animation, { duration: 0 });
    }

    const { trigger, content } = this.#settings.selector;
    const NOT_NESTED = `:not(:scope ${content} *)`;
    this.#triggerElements = this.#rootElement.querySelectorAll(
      `${trigger}${NOT_NESTED}`,
    );
    this.#contentElements = this.#rootElement.querySelectorAll(
      `${content}${NOT_NESTED}`,
    );

    if (!this.#triggerElements.length || !this.#contentElements.length) {
      throw new Error('Trigger or content element missing.');
    }

    this.#initialize();
  }

  open(trigger: HTMLElement): void {
    if (!this.#destroyed && this.#bindings?.has(trigger)) {
      this.#toggle(trigger, true);
    }
  }

  close(trigger: HTMLElement): void {
    if (!this.#destroyed && this.#bindings?.has(trigger)) {
      this.#toggle(trigger, false);
    }
  }

  async destroy(force = false): Promise<void> {
    if (this.#destroyed || !this.#triggerElements || !this.#bindings) {
      return;
    }

    this.#destroyed = true;
    this.#controller?.abort();
    this.#controller = null;
    this.#rootElement.removeAttribute('data-accordion-initialized');

    if (!force) {
      const promises: Promise<void>[] = [];

      for (const trigger of this.#triggerElements) {
        const animation = this.#bindings.get(trigger)?.animation;

        if (animation) {
          promises.push(this.#waitAnimation(animation));
        }
      }

      await Promise.allSettled(promises);
    }

    for (const trigger of this.#triggerElements) {
      this.#bindings.get(trigger)?.animation?.cancel();
    }

    this.#triggerElements = null;
    this.#contentElements = null;
    this.#bindings = null;
  }

  #initialize(): void {
    if (
      !this.#triggerElements ||
      !this.#contentElements ||
      !this.#bindings ||
      !this.#controller
    ) {
      return;
    }

    const { signal } = this.#controller;

    for (let i = 0, l = this.#triggerElements.length; i < l; i++) {
      const trigger = this.#triggerElements[i];
      const id = Math.random().toString(36).slice(-8);
      const content = this.#contentElements[i];
      content.id ||= `accordion-content-${id}`;
      trigger.setAttribute('aria-controls', content.id);
      trigger.setAttribute(
        'aria-expanded',
        trigger.getAttribute('aria-expanded') ?? 'false',
      );
      trigger.id ||= `accordion-trigger-${id}`;
      trigger.setAttribute('tabindex', this.#isFocusable(trigger) ? '0' : '-1');

      if (!this.#isFocusable(trigger)) {
        trigger.style.setProperty('pointer-events', 'none');
      }

      trigger.addEventListener('click', this.#onTriggerClick, { signal });
      trigger.addEventListener('keydown', this.#onTriggerKeyDown, {
        signal,
      });
    }

    for (let i = 0, l = this.#contentElements.length; i < l; i++) {
      const content = this.#contentElements[i];
      content.setAttribute(
        'aria-labelledby',
        `${content.getAttribute('aria-labelledby') ?? ''} ${
          this.#triggerElements[i].id
        }`.trim(),
      );
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.#onContentBeforeMatch, {
        signal,
      });
    }

    for (let i = 0, l = this.#triggerElements.length; i < l; i++) {
      const trigger = this.#triggerElements[i];
      const content = this.#contentElements[i];
      const binding = this.#createBinding(trigger, content);
      this.#bindings.set(trigger, binding);
      this.#bindings.set(content, binding);
    }

    this.#rootElement.setAttribute('data-accordion-initialized', '');
  }

  #onTriggerClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;

    if (trigger instanceof HTMLElement) {
      this.#toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
    }
  };

  #onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (!this.#triggerElements) {
      return;
    }

    const { key } = event;

    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const focusables: HTMLElement[] = [];

    for (const trigger of this.#triggerElements) {
      if (this.#isFocusable(trigger)) {
        focusables.push(trigger);
      }
    }

    const active = this.#getActiveElement();

    if (!active) {
      return;
    }

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
    if (!this.#bindings) {
      return;
    }

    const content = event.currentTarget;

    if (!(content instanceof HTMLElement)) {
      return;
    }

    const binding = this.#bindings.get(content);

    if (!binding) {
      return;
    }

    if (binding.trigger.getAttribute('aria-expanded') === 'false') {
      this.#toggle(binding.trigger, true, true);
    }
  };

  #toggle(trigger: HTMLElement, open: boolean, match = false): void {
    if (!this.#triggerElements || !this.#bindings) {
      return;
    }

    const binding = this.#bindings.get(trigger);

    if (!binding || String(open) === trigger.getAttribute('aria-expanded')) {
      return;
    }

    const name = trigger.getAttribute('data-accordion-name');

    if (name && open) {
      for (const t of this.#triggerElements) {
        if (
          t !== trigger &&
          t.getAttribute('data-accordion-name') === name &&
          t.getAttribute('aria-expanded') === 'true'
        ) {
          this.#toggle(t, false, match);
          break;
        }
      }
    }

    trigger.setAttribute(
      'aria-label',
      trigger.getAttribute(
        `data-accordion-${open ? 'expanded' : 'collapsed'}-label`,
      ) ??
        trigger.getAttribute('aria-label') ??
        '',
    );

    const { content } = binding;
    const startSize = content.hidden ? 0 : content.offsetHeight;

    if (content.hidden) {
      content.hidden = false;
    }

    const endSize = open ? content.scrollHeight : 0;
    binding.animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    const { duration, easing } = this.#settings.animation;
    const animation = content.animate(
      { blockSize: [`${startSize}px`, `${endSize}px`] },
      { duration: match ? 0 : duration, easing },
    );
    binding.animation = animation;
    trigger.setAttribute('aria-expanded', String(open));
    const cleanup = (): void => {
      if (binding.animation === animation) {
        binding.animation = null;
      }
    };

    if (!this.#controller) {
      return;
    }

    const { signal } = this.#controller;
    animation.addEventListener('cancel', cleanup, { once: true, signal });
    animation.addEventListener(
      'finish',
      (): void => {
        cleanup();

        if (!open) {
          content.setAttribute('hidden', 'until-found');
        }

        const { style } = content;
        style.removeProperty('block-size');
        style.removeProperty('overflow');
      },
      { once: true, signal },
    );
  }

  #createBinding(trigger: HTMLElement, content: HTMLElement): Binding {
    return { trigger, content, animation: null };
  }

  #getActiveElement(): HTMLElement | null {
    let active = document.activeElement;

    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }

    return active instanceof HTMLElement ? active : null;
  }

  #isFocusable(element: HTMLElement): boolean {
    return (
      element.getAttribute('aria-disabled') !== 'true' &&
      !element.hasAttribute('disabled')
    );
  }

  #waitAnimation(animation: Animation): Promise<void> {
    const { playState } = animation;

    if (playState === 'idle' || playState === 'finished') {
      return Promise.resolve();
    }

    return new Promise<void>((resolve): void => {
      const done = (): void => {
        resolve();
      };
      animation.addEventListener('cancel', done, { once: true });
      animation.addEventListener('finish', done, { once: true });
    });
  }
}
