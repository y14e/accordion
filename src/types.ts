export interface AccordionOptions {
  animation: {
    duration: number;
    easing: string;
  };
  collapsible: boolean;
  selector: {
    content: string;
    trigger: string;
  };
}

export type Binding = {
  animation: Animation | null;
  content: HTMLElement;
  trigger: HTMLElement;
};
