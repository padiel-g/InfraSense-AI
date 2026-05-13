"use client";
import { useEffect, useRef } from "react";

interface Box {
  x1?: number; y1?: number; x2?: number; y2?: number;
  class?: string; confidence?: number;
  [key: string]: unknown;
}

interface Props {
  imageUrl: string;
  boxes: Box[];
}

export default function BboxCanvas({ imageUrl, boxes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    // crossOrigin must be set before .src to avoid a CORS-tainted canvas.
    img.crossOrigin = "anonymous";

    img.onerror = () => {
      // Show a clear placeholder instead of leaving the canvas blank.
      canvas.width  = 320;
      canvas.height = 200;
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Image unavailable", canvas.width / 2, canvas.height / 2);
    };

    img.onload = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      boxes.forEach((box) => {
        // Skip boxes with missing coordinates rather than defaulting to
        // full-canvas dimensions, which would render a meaningless overlay.
        if (box.x1 == null || box.y1 == null || box.x2 == null || box.y2 == null) return;

        const x1 = Number(box.x1);
        const y1 = Number(box.y1);
        const x2 = Number(box.x2);
        const y2 = Number(box.y2);

        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const label = `${box.class ?? "waste"} ${box.confidence != null ? (Number(box.confidence) * 100).toFixed(0) + "%" : ""}`;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(x1, y1 - 20, ctx.measureText(label).width + 8, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "13px sans-serif";
        ctx.fillText(label, x1 + 4, y1 - 5);
      });
    };

    img.src = imageUrl;
  }, [imageUrl, boxes]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full rounded border"
      style={{ display: "block" }}
    />
  );
}
