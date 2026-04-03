interface AccordionOptions {
  animation: {
    duration: number;
    easing: string;
  };
  selector: {
    content: string;
    trigger: string;
  };
}

export default class Accordion {
  private rootElement!: HTMLElement;
  private defaults!: AccordionOptions;
  private settings!: AccordionOptions;
  private triggerElements!: NodeListOf<HTMLElement>;
  private contentElements!: NodeListOf<HTMLElement>;
  private entries!: WeakMap<HTMLElement, { animation: Animation | null; content: HTMLElement; trigger: HTMLElement }>;
  private controller!: AbortController;
  private destroyed!: boolean;

  constructor(root: HTMLElement, options: Partial<AccordionOptions> = {}) {
    if (!root) return;
    this.rootElement = root;
    this.defaults = {
      animation: {
        duration: 300,
        easing: 'ease',
      },
      selector: {
        content: ':has(> [data-accordion-trigger]) + *',
        trigger: '[data-accordion-trigger]',
      },
    };
    this.settings = {
      animation: { ...this.defaults.animation, ...options.animation },
      selector: { ...this.defaults.selector, ...options.selector },
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    const NOT_NESTED = `:not(:scope ${this.settings.selector.content} *)`;
    this.triggerElements = this.rootElement.querySelectorAll(`${this.settings.selector.trigger}${NOT_NESTED}`);
    this.contentElements = this.rootElement.querySelectorAll(`${this.settings.selector.content}${NOT_NESTED}`);
    this.entries = new WeakMap();
    this.controller = new AbortController();
    this.destroyed = false;
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleContentBeforeMatch = this.handleContentBeforeMatch.bind(this);
    this.initialize();
  }

  private initialize(): void {
    if (!this.triggerElements.length || !this.contentElements.length) return;
    const { signal } = this.controller;
    this.triggerElements.forEach((trigger, i) => {
      const id = Math.random().toString(36).slice(-8);
      const content = this.contentElements[i];
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
    });
    this.contentElements.forEach((content, i) => {
      content.setAttribute('aria-labelledby', `${content.getAttribute('aria-labelledby') ?? ''} ${this.triggerElements[i].id}`.trim());
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.handleContentBeforeMatch, { signal });
    });
    this.triggerElements.forEach((trigger, i) => {
      const content = this.contentElements[i];
      if (!content) return;
      const entry = { animation: null, content, trigger };
      this.entries.set(trigger, entry);
      this.entries.set(content, entry);
    });
    this.rootElement.setAttribute('data-accordion-initialized', '');
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

  private toggle(trigger: HTMLElement, open: boolean, match = false): void {
    const entry = this.entries.get(trigger);
    if (!entry) return;
    if (String(open) === trigger.getAttribute('aria-expanded')) return;
    const name = trigger.getAttribute('data-accordion-name');
    if (name) {
      const current = this.rootElement.querySelector<HTMLElement>(`[aria-expanded="true"][data-accordion-name="${name}"]`);
      if (open && current && current !== trigger) {
        this.toggle(current, false, match);
      }
    }
    trigger.setAttribute('aria-label', trigger.getAttribute(`data-accordion-${open ? 'expanded' : 'collapsed'}-label`) ?? (trigger.getAttribute('aria-label') || ''));
    const { content } = entry;
    const startSize = content.hidden ? 0 : content.offsetHeight;
    if (content.hidden) {
      content.hidden = false;
    }
    const endSize = open ? content.scrollHeight : 0;
    let { animation } = entry;
    animation?.cancel();
    content.style.setProperty('overflow', 'clip');
    animation = content.animate(
      { blockSize: [`${startSize}px`, `${endSize}px`] },
      {
        duration: match ? 0 : this.settings.animation.duration,
        easing: this.settings.animation.easing,
      },
    );
    entry.animation = animation;
    trigger.setAttribute('aria-expanded', String(open));
    const cleanupAnimation = () => {
      if (entry.animation === animation) {
        entry.animation = null;
      }
    };
    animation.addEventListener('cancel', cleanupAnimation);
    animation.addEventListener('finish', () => {
      cleanupAnimation();
      if (!open) {
        content.setAttribute('hidden', 'until-found');
      }
      content.style.removeProperty('block-size');
      content.style.removeProperty('overflow');
    });
  }

  private handleTriggerClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    this.toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
  }

  private handleTriggerKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const focusables: HTMLElement[] = [];
    this.triggerElements.forEach((trigger) => {
      if (this.isFocusable(trigger)) {
        focusables.push(trigger);
      }
    });
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
  }

  private handleContentBeforeMatch(event: Event): void {
    const content = event.currentTarget;
    if (!(content instanceof HTMLElement)) return;
    const entry = this.entries.get(content);
    if (!entry) return;
    if (entry.trigger.getAttribute('aria-expanded') === 'false') {
      this.toggle(entry.trigger, true, true);
    }
  }

  open(trigger: HTMLElement): void {
    if (this.entries.has(trigger)) {
      this.toggle(trigger, true);
    }
  }

  close(trigger: HTMLElement): void {
    if (this.entries.has(trigger)) {
      this.toggle(trigger, false);
    }
  }

  async destroy(force = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rootElement.removeAttribute('data-accordion-initialized');
    this.controller.abort();
    if (!force) {
      const promises: Promise<void>[] = [];
      this.triggerElements.forEach((trigger) => {
        const entry = this.entries.get(trigger);
        if (entry?.animation) {
          promises.push(entry.animation.finished.catch(() => {}).then(() => {}));
        }
      });
      await Promise.all(promises);
    }
    this.triggerElements.forEach((trigger) => this.entries.get(trigger)?.animation?.cancel());
  }
}
