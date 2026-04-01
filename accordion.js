export default class Accordion {
  constructor(root, options = {}) {
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
    this.triggerElements = [...this.rootElement.querySelectorAll(`${this.settings.selector.trigger}${NOT_NESTED}`)];
    this.contentElements = [...this.rootElement.querySelectorAll(`${this.settings.selector.content}${NOT_NESTED}`)];
    this.animations = Array(this.triggerElements.length).fill(null);
    this.controller = new AbortController();
    this.destroyed = false;
    this.handleTriggerClick = this.handleTriggerClick.bind(this);
    this.handleTriggerKeyDown = this.handleTriggerKeyDown.bind(this);
    this.handleContentBeforeMatch = this.handleContentBeforeMatch.bind(this);
    this.initialize();
  }

  initialize() {
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
    this.rootElement.setAttribute('data-accordion-initialized', '');
  }

  getActiveElement() {
    let active = document.activeElement;
    while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active instanceof HTMLElement ? active : null;
  }

  isFocusable(element) {
    return element.getAttribute('aria-disabled') !== 'true' && !element.hasAttribute('disabled');
  }

  toggle(trigger, open, match = false) {
    if (String(open) === trigger.getAttribute('aria-expanded')) return;
    const name = trigger.getAttribute('data-accordion-name');
    if (name) {
      const current = this.rootElement.querySelector(`[aria-expanded="true"][data-accordion-name="${name}"]`);
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
    animation = content.animate(
      { blockSize: [startSize, `${Math.max(parseFloat(style.getPropertyValue('min-block-size')), Math.min(endSize, parseFloat(style.getPropertyValue('max-block-size')) || endSize))}px`] },
      {
        duration: !match ? this.settings.animation.duration : 0,
        easing: this.settings.animation.easing,
      },
    );
    this.animations[index] = animation;
    const cleanupAnimation = () => {
      if (this.animations[index] === animation) {
        this.animations[index] = null;
      }
    };
    animation.addEventListener('cancel', cleanupAnimation);
    animation.addEventListener('finish', () => {
      cleanupAnimation();
      if (!open) {
        content.setAttribute('hidden', 'until-found');
      }
      ['block-size', 'overflow'].forEach((name) => content.style.removeProperty(name));
    });
  }

  handleTriggerClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    this.toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
  }

  handleTriggerKeyDown(event) {
    const { key } = event;
    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const focusables = this.triggerElements.filter(this.isFocusable);
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

  handleContentBeforeMatch(event) {
    const content = event.currentTarget;
    if (!(content instanceof HTMLElement)) return;
    const trigger = this.triggerElements[this.contentElements.indexOf(content)];
    if (trigger.getAttribute('aria-expanded') === 'false') {
      this.toggle(trigger, true, true);
    }
  }

  open(trigger) {
    if (this.triggerElements.includes(trigger)) {
      this.toggle(trigger, true);
    }
  }

  close(trigger) {
    if (this.triggerElements.includes(trigger)) {
      this.toggle(trigger, false);
    }
  }

  async destroy(force = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rootElement.removeAttribute('data-accordion-initialized');
    this.controller.abort();
    if (!force) {
      await Promise.all(this.animations.map((animation) => animation?.finished.catch(() => {})));
    }
    this.animations.forEach((animation) => animation?.cancel());
  }
}
