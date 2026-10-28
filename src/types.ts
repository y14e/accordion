export interface AccordionOptions {
  animation: {
    duration: number;
    easing: string;
  };
  collapsible: boolean;
  selector: {
    content: string;
    item: string;
    trigger: string;
  };
}

export type Binding = {
  animation: Animation | null;
  content: HTMLElement;
  item: HTMLElement;
  trigger: HTMLElement;
};
