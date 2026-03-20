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
  private triggerElements!: HTMLElement[];
  private contentElements!: HTMLElement[];
  private animations!: (Animation | null)[];
  private controller!: AbortController;
  private destroyed!: boolean;

  constructor(root: HTMLElement, options?: Partial<AccordionOptions>) {
    if (!root) {
      return;
    }
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
      animation: { ...this.defaults.animation, ...options?.animation },
      selector: { ...this.defaults.selector, ...options?.selector },
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    const NOT_NESTED = `:not(:scope ${this.settings.selector.content} *)`;
    this.triggerElements = [...this.rootElement.querySelectorAll<HTMLElement>(`${this.settings.selector.trigger}${NOT_NESTED}`)];
    this.contentElements = [...this.rootElement.querySelectorAll<HTMLElement>(`${this.settings.selector.content}${NOT_NESTED}`)];
    this.animations = Array(this.triggerElements.length).fill(null);
    this.controller = new AbortController();
    this.destroyed = false;
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleContentBeforeMatch = this.handleContentBeforeMatch.bind(this);
    this.initialize();
  }

  private initialize(): void {
    if (!this.triggerElements.length || !this.contentElements.length) {
      return;
    }
    const { signal } = this.controller;
    this.triggerElements.forEach((trigger, i) => {
      const id = Math.random().toString(36).slice(-8);
      trigger.setAttribute('aria-controls', (this.contentElements[i].id ||= `accordion-content-${id}`));
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
      content.setAttribute('aria-labelledby', `${content.getAttribute('aria-labelledby') || ''} ${this.triggerElements[i].id}`.trim());
      content.setAttribute('role', 'region');
      content.addEventListener('beforematch', this.handleContentBeforeMatch, { signal });
    });
    this.rootElement.setAttribute('data-accordion-initialized', '');
  }

  private getActiveElement(): HTMLElement | null {
    let active = document.activeElement;
    while (active && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active as HTMLElement | null;
  }

  private isFocusable(element: HTMLElement): boolean {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  private toggle(trigger: HTMLElement, open: boolean, match = false): void {
    if (open.toString() === trigger.getAttribute('aria-expanded')) {
      return;
    }
    const name = trigger.getAttribute('data-accordion-name');
    if (name) {
      const current = this.rootElement.querySelector<HTMLElement>(`[aria-expanded="true"][data-accordion-name="${name}"]`);
      if (open && current && current !== trigger) {
        this.toggle(current, false, match);
      }
    }
    trigger.setAttribute('aria-label', trigger.getAttribute(`data-accordion-${open ? 'expanded' : 'collapsed'}-label`) ?? (trigger.getAttribute('aria-label') || ''));
    const index = this.triggerElements.indexOf(trigger);
    const content = this.contentElements[index];
    const style = getComputedStyle(content);
    const startSize = !content.hidden ? style.getPropertyValue('block-size') : '0';
    let animation = this.animations[index];
    animation?.cancel();
    content.hidden = false;
    const endSize = open ? parseFloat(style.getPropertyValue('block-size')) : 0;
    requestAnimationFrame(() => trigger.setAttribute('aria-expanded', String(open)));
    content.style.setProperty('overflow', 'clip');
    animation = this.animations[index] = content.animate(
      { blockSize: [startSize, `${Math.max(parseFloat(style.getPropertyValue('min-block-size')), Math.min(endSize, parseFloat(style.getPropertyValue('max-block-size')) || endSize))}px`] },
      {
        duration: !match ? this.settings.animation.duration : 0,
        easing: this.settings.animation.easing,
      },
    );
    animation.addEventListener('finish', () => {
      this.animations[index] = null;
      if (!open) {
        content.setAttribute('hidden', 'until-found');
      }
      ['block-size', 'overflow'].forEach((name) => content.style.removeProperty(name));
    });
  }

  private handleTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLElement;
    this.toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
  }

  private handleTriggerKeyDown(event: KeyboardEvent): void {
    const { key } = event;
    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const focusables = this.triggerElements.filter(this.isFocusable);
    const active = this.getActiveElement()!;
    const currentIndex = focusables.indexOf(active);
    const length = focusables.length;
    let newIndex = currentIndex;
    switch (key) {
      case 'Enter':
      case ' ':
        active.click();
        return;
      case 'End':
        newIndex = length - 1;
        break;
      case 'Home':
        newIndex = 0;
        break;
      case 'ArrowUp':
        newIndex = (currentIndex - 1 + length) % length;
        break;
      case 'ArrowDown':
        newIndex = (currentIndex + 1) % length;
        break;
    }
    focusables[newIndex].focus();
  }

  private handleContentBeforeMatch(event: Event): void {
    const trigger = this.triggerElements[this.contentElements.indexOf(event.currentTarget as HTMLElement)];
    if (trigger.getAttribute('aria-expanded') === 'false') {
      this.toggle(trigger, true, true);
    }
  }

  open(trigger: HTMLElement): void {
    if (this.triggerElements.includes(trigger)) {
      this.toggle(trigger, true);
    }
  }

  close(trigger: HTMLElement): void {
    if (this.triggerElements.includes(trigger)) {
      this.toggle(trigger, false);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.rootElement.removeAttribute('data-accordion-initialized');
    this.controller.abort();
    await Promise.all(
      this.animations.map(async (animation) => {
        if (!animation) {
          return;
        }
        try {
          await animation.finished;
        } catch {}
        animation.cancel();
      }),
    );
  }
}
