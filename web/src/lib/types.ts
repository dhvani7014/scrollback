/** A recognised line of text; coordinates are fractions (0..1) of the frame. */
export interface OcrLine { t: string; x: number; y: number; w: number; h: number }

export interface PxLine { t: string; x0: number; y0: number; x1: number; y1: number; ind: number }

export interface Block {
  lines: PxLine[];
  gutter: boolean;
  code: boolean;
  charW: number;
  pitch: number;
  x0: number; y0: number; x1: number; y1: number;
}

export interface Frame {
  id: number;
  ts: number;       // ms since the read began (or video time for recordings)
  w: number;
  h: number;
  url: string;      // object URL of the JPEG
  lines: OcrLine[];
  blocks?: Block[];
}

export interface OcrEngine {
  recognize(canvas: HTMLCanvasElement): Promise<OcrLine[]>;
  dispose(): Promise<void>;
}
