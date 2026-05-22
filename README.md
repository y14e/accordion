# Accordion

WAI-ARIA compliant [accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) pattern implementation in TypeScript.

## Install

```bash
npm i @y14e/accordion
```

```ts
// npm
import Accordion from '@y14e/accordion';

// CDNs
import Accordion from 'https://esm.sh/@y14e/accordion'
// or
import Accordion from 'https://cdn.jsdelivr.net/npm/@y14e/accordion/+esm';
// or
import Accordion from 'https://unpkg.com/@y14e/accordion/dist/index.js';
```

## Usage

```ts
import Accordion from './accordion';

new Accordion(root, options);
// => Accordion
//
// root: HTMLElement
// options (optional): AccordionOptions

```

## 🪄 Options

```ts
interface AccordionOptions {
  animation?: {
    duration?: number; // ms (default: 300)
    easing?: string;   // <easing-function> (default: 'ease')
  };
  selector?: {
    content?: string;  // default: ':has(> [data-accordion-trigger]) + *'
    trigger?: string;  // default: '[data-accordion-trigger]'
  };
}
```

### ⚙️ Customize defaults

Override the global default settings applied to all accordion instances.

```ts
import Accordion from './accordion';

Accordion.defaults = {
  animation: {
    duration: 1000,
  },
  selector: {
    content: '.content',
    trigger: '.trigger',
  },
};

new Accordion(root);
```

## 📦 APIs

### `open`

```ts
accordion.open(trigger);
// => void
//
// trigger: HTMLElement
```

### `close`

```ts
accordion.close(trigger);
// => void
//
// trigger: HTMLElement
```

### `destroy`

Destroys the instance and cleans up all event listeners.

```ts
accordion.destroy(force);
// => Promise<void>
//
// force (optional): If true, skips waiting for animations to finish.
```

## Demo

https://y14e.github.io/accordion-ts/
