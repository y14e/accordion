export default class Accordion {
  constructor(root, options = {}) {
    if (!root) throw new Error('Root element missing');
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
      animation: { ...this.defaults.animation, ...(options.animation ?? {}) },
      selector: { ...this.defaults.selector, ...(options.selector ?? {}) },
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.animation.duration = 0;
    }
    const { selector } = this.settings;
    const NOT_NESTED = `:not(:scope ${selector.content} *)`;
    this.triggerElements = this.rootElement.querySelectorAll(`${selector.trigger}${NOT_NESTED}`);
    this.contentElements = this.rootElement.querySelectorAll(`${selector.content}${NOT_NESTED}`);
    this.entries = new WeakMap();
    this.controller = new AbortController();
    this.destroyed = false;
    this.initialize();
  }

  open(trigger) {
    if (this.entries.has(trigger)) {
      this.toggle(trigger, true);
    }
  }

  close(trigger) {
    if (this.entries.has(trigger)) {
      this.toggle(trigger, false);
    }
  }

  async destroy(force = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.abort();
    this.rootElement.removeAttribute('data-accordion-initialized');
    if (!force) {
      const promises = [];
      for (const trigger of this.triggerElements) {
        const entry = this.entries.get(trigger);
        if (entry?.animation) {
          promises.push(entry.animation.finished.catch(() => {}).then(() => {}));
        }
      }
      await Promise.all(promises);
    }
    for (const trigger of this.triggerElements) {
      this.entries.get(trigger)?.animation?.cancel();
    }
  }

  initialize() {
    if (this.triggerElements.length === 0 || this.contentElements.length === 0) return;
    const { signal } = this.controller;
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
      const entry = this.createEntry(trigger, content);
      this.entries.set(trigger, entry);
      this.entries.set(content, entry);
    }
    this.rootElement.setAttribute('data-accordion-initialized', '');
  }

  handleTriggerClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    this.toggle(trigger, trigger.getAttribute('aria-expanded') === 'false');
  };

  handleTriggerKeyDown = (event) => {
    const { key } = event;
    if (!['Enter', ' ', 'End', 'Home', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const focusables = [];
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

  handleContentBeforeMatch = (event) => {
    const content = event.currentTarget;
    if (!(content instanceof HTMLElement)) return;
    const entry = this.entries.get(content);
    if (!entry) return;
    if (entry.trigger.getAttribute('aria-expanded') === 'false') {
      this.toggle(entry.trigger, true, true);
    }
  };

  toggle(trigger, open, match = false) {
    const entry = this.entries.get(trigger);
    if (!entry) return;
    if (String(open) === trigger.getAttribute('aria-expanded')) return;
    const name = trigger.getAttribute('data-accordion-name');
    if (name) {
      const current = this.rootElement.querySelector(`[aria-expanded="true"][data-accordion-name="${name}"]`);
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
    const { duration, easing } = this.settings.animation;
    animation = content.animate({ blockSize: [`${startSize}px`, `${endSize}px`] }, { duration: !match ? duration : 0, easing });
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
      ['block-size', 'overflow'].forEach((prop) => content.style.removeProperty(prop));
    });
  }

  createEntry(trigger, content) {
    return { trigger, content, animation: null };
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
}
