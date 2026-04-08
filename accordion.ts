interface AccordionOptions {
  animation?: {
    duration?: number;
    easing?: string;
  };
  selector?: {
    content?: string;
    trigger?: string;
  };
}

type DeepRequired<T> = T extends (...args: unknown[]) => unknown ? T : T extends readonly unknown[] ? { [K in keyof T]: DeepRequired<NonNullable<T[K]>> } : T extends object ? { [K in keyof T]-?: DeepRequired<NonNullable<T[K]>> } : NonNullable<T>;

type AccordionBinding = {
  trigger: HTMLElement;
  content: HTMLElement;
  animation: Animation | null;
};

export default class Accordion {
  private readonly rootElement: HTMLElement;
  private readonly defaults: DeepRequired<AccordionOptions> = {
    animation: {
      duration: 300,
      easing: 'ease',
    },
    selector: {
      content: ':has(> [data-accordion-trigger]) + *',
      trigger: '[data-accordion-trigger]',
    },
  };
  private readonly settings: DeepRequired<AccordionOptions>;
  private readonly triggerElements: NodeListOf<HTMLElement>;
  private readonly contentElements: NodeListOf<HTMLElement>;
  private readonly bindingMap: WeakMap<HTMLElement, AccordionBinding> = new WeakMap();
  private readonly eventController = new AbortController();
  private destroyed = false;

  constructor(root: HTMLElement, options: AccordionOptions = {}) {
    if (!root) throw new Error('Root element missing');
    this.rootElement = root;
    this.settings = {
      animation: { ...this.defaults.animation, ...(options.animation ?? {}) },
      selector: { ...this.defaults.selector, ...(options.selector ?? {}) },
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    const { trigger, content } = this.settings.selector;
    const NOT_NESTED = `:not(:scope ${content} *)`;
    this.triggerElements = this.rootElement.querySelectorAll(`${trigger}${NOT_NESTED}`);
    this.contentElements = this.rootElement.querySelectorAll(`${content}${NOT_NESTED}`);
    if (this.triggerElements.length === 0 || this.contentElements.length === 0) throw new Error('Trigger or content element missing');
    this.initialize();
  }

  open(trigger: HTMLElement): void {
    if (this.bindingMap.has(trigger)) {
      this.toggle(trigger, true);
    }
  }

  close(trigger: HTMLElement): void {
    if (this.bindingMap.has(trigger)) {
      this.toggle(trigger, false);
    }
  }

  async destroy(force = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventController.abort();
    this.rootElement.removeAttribute('data-accordion-initialized');
    if (!force) {
      const promises: Promise<void>[] = [];
      for (const trigger of this.triggerElements) {
        const binding = this.bindingMap.get(trigger);
        if (binding?.animation) {
          promises.push(binding.animation.finished.catch(() => {}).then(() => {}));
        }
      }
      await Promise.all(promises);
    }
    for (const trigger of this.triggerElements) {
      this.bindingMap.get(trigger)?.animation?.cancel();
    }
  }

  private initialize(): void {
    const { signal } = this.eventController;
    for (let i = 0, l = this.triggerElements.length; i < l; i++) {
      const trigger = this.triggerElements[i];
      const id = Math.random().toString(36).slice(-8);
      const content = this.contentElements[i];
      if (!content) continue;
      content.id ||= `accordion-content-${id}`;
      trigger.setAttribute('aria-controls', content.id);
      if (!trigger.hasAttribute('aria-expanded')) {
        trigger.setAttribute('aria-expanded', 'false');
      }
      trigger.id ||= `accordion-trigger-${id}`;
      trigger.setAttribute('tabindex', this.isFocusable(trigger) ? '0' : '-1');
      if (!this.isFocusable(trigger)) {
        trigger.style.setProperty('pointer-events', 'none');
      }
      trigger.addEventListener('click', this.handleTriggerClick, { signal });
      trigger.addEventListener('keydown', this.handleTriggerKeyDown, { signal });
    }
    for (let i = 0, l = this.contentElements.length; i < l; i++) {
      const content = this.contentElements[i];
      content.setAttribute('aria-labelledby', `${content.getAttribute('aria-labelledby') ?? ''} ${this.triggerElements[i].id}`.trim());
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.handleContentBeforeMatch, { signal });
    }
    for (let i = 0, l = this.triggerElements.length; i < l; i++) {
      const trigger = this.triggerElements[i];
      const content = this.contentElements[i];
      if (!content) continue;
      const binding = this.createBinding(trigger, content);
      this.bindingMap.set(trigger, binding);
      this.bindingMap.set(content, binding);
    }
    this.rootElement.setAttribute('data-accordion-initialized', '');
  }

  private handleTriggerClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    this.toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
  };

  private handleTriggerKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;
    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const focusables: HTMLElement[] = [];
    for (const trigger of this.triggerElements) {
      if (this.isFocusable(trigger)) {
        focusables.push(trigger);
      }
    }
    const active = this.getActiveElement();
    if (!active) return;
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

  private handleContentBeforeMatch = (event: Event): void => {
    const content = event.currentTarget;
    if (!(content instanceof HTMLElement)) return;
    const binding = this.bindingMap.get(content);
    if (!binding) return;
    if (binding.trigger.getAttribute('aria-expanded') === 'false') {
      this.toggle(binding.trigger, true, true);
    }
  };

  private toggle(trigger: HTMLElement, open: boolean, match = false): void {
    const binding = this.bindingMap.get(trigger);
    if (!binding) return;
    if (String(open) === trigger.getAttribute('aria-expanded')) return;
    const name = trigger.getAttribute('data-accordion-name');
    if (name) {
      const current = this.rootElement.querySelector<HTMLElement>(`[aria-expanded="true"][data-accordion-name="${name}"]`);
      if (open && current && current !== trigger) {
        this.toggle(current, false, match);
      }
    }
    trigger.setAttribute('aria-label', trigger.getAttribute(`data-accordion-${open ? 'expanded' : 'collapsed'}-label`) ?? (trigger.getAttribute('aria-label') || ''));
    const { content } = binding;
    const startSize = content.hidden ? 0 : content.offsetHeight;
    if (content.hidden) {
      content.hidden = false;
    }
    const endSize = open ? content.scrollHeight : 0;
    let { animation } = binding;
    animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    const { duration, easing } = this.settings.animation;
    animation = content.animate({ blockSize: [`${startSize}px`, `${endSize}px`] }, { duration: !match ? duration : 0, easing });
    binding.animation = animation;
    trigger.setAttribute('aria-expanded', String(open));
    const cleanupAnimation = () => {
      if (binding.animation === animation) {
        binding.animation = null;
      }
    };
    animation.addEventListener('cancel', cleanupAnimation);
    animation.addEventListener('finish', () => {
      cleanupAnimation();
      if (!open) {
        content.setAttribute('hidden', 'until-found');
      }
      ['block-size', 'overflow'].forEach((prop) => content.style.removeProperty(prop));
    });
  }

  private createBinding(trigger: HTMLElement, content: HTMLElement): AccordionBinding {
    return { trigger, content, animation: null };
  }

  private getActiveElement(): HTMLElement | null {
    let active = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  private isFocusable(element: HTMLElement): boolean {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }
}
