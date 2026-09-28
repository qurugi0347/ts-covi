import React, { useLayoutEffect, useRef, useState } from "react";

type Side = "left" | "right";
type Widths = { left: number; right: number };

export function ResizableWorkspace({ children }: { children: [React.ReactNode, React.ReactNode, React.ReactNode] }) {
  const workspace = useRef<HTMLDivElement>(null);
  const remMeasure = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ side: Side; pointerId: number; x: number; width: number } | null>(null);
  const [widths, setWidths] = useState<Widths | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bounds, setBounds] = useState({ available: 0, unit: 16, divider: 8 });
  const [desktop, setDesktop] = useState(() => matchMedia("(min-width: 60rem)").matches);
  const preferred = (side: Side) => bounds.unit * (side === "left" ? 15 : 21);
  const minimum = (side: Side) => bounds.unit * (side === "left" ? 12 : 15);
  const maximum = (side: Side, other: number) => Math.max(minimum(side), bounds.available - 2 * bounds.divider - bounds.unit * 22 - other);
  const current = { left: widths?.left ?? preferred("left"), right: widths?.right ?? preferred("right") };
  const clamp = (side: Side, value: number, other: number) => Math.min(Math.max(value, minimum(side)), maximum(side, other));
  const fit = (next: Widths): Widths => {
    const left = clamp("left", next.left, minimum("right"));
    const right = clamp("right", next.right, left);
    return { left: clamp("left", left, right), right };
  };
  const fitted = fit(current);
  const setSide = (side: Side, value: number) => setWidths((previous) => {
    const prior = fit({ left: previous?.left ?? preferred("left"), right: previous?.right ?? preferred("right") });
    const other = prior[side === "left" ? "right" : "left"];
    return { ...prior, [side]: clamp(side, value, other) };
  });

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const media = matchMedia("(min-width: 60rem)");
    const measure = () => {
      const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const divider = matchMedia("(pointer: coarse)").matches ? 44 : 8;
      setBounds({ available: element.clientWidth, unit, divider });
      setDesktop(media.matches);
      if (!media.matches) { drag.current = null; document.body.classList.remove("resizing-panels"); setDragging(false); }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (remMeasure.current) observer.observe(remMeasure.current);
    media.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); media.removeEventListener("change", measure); window.removeEventListener("resize", measure); document.body.classList.remove("resizing-panels"); };
  }, []);

  const separator = (side: Side) => {
    const size = Math.round(fitted[side]);
    const min = Math.round(minimum(side));
    const max = Math.round(maximum(side, fitted[side === "left" ? "right" : "left"]));
    return <div
      className="panel-separator" role="separator" tabIndex={desktop ? 0 : -1}
      aria-label={`${side === "left" ? "탐색" : "상세"} 패널 너비 조절`}
      aria-orientation="vertical" aria-controls={side === "left" ? "covi-explorer" : "covi-inspector"}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={size} aria-valuetext={`${size}px`}
      aria-describedby="panel-resize-help"
      onPointerDown={(event) => {
        if (!desktop || drag.current || !event.isPrimary || event.button !== 0) return;
        drag.current = { side, pointerId: event.pointerId, x: event.clientX, width: fitted[side] };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add("resizing-panels");
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.side !== side || drag.current.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.current.x;
        setSide(side, drag.current.width + (side === "left" ? delta : -delta));
      }}
      onPointerUp={(event) => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; document.body.classList.remove("resizing-panels"); setDragging(false); }}
      onPointerCancel={(event) => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; document.body.classList.remove("resizing-panels"); setDragging(false); }}
      onLostPointerCapture={(event) => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; document.body.classList.remove("resizing-panels"); setDragging(false); }}
      onKeyDown={(event) => {
        if (!desktop) return;
        const step = event.shiftKey ? 48 : 16;
        const direction = side === "left" ? 1 : -1;
        let next: number;
        if (event.key === "ArrowLeft") next = fitted[side] - step * direction;
        else if (event.key === "ArrowRight") next = fitted[side] + step * direction;
        else if (event.key === "Home") next = min;
        else if (event.key === "End") next = max;
        else if (event.key === "Enter") next = preferred(side);
        else return;
        event.preventDefault();
        setSide(side, next);
      }}
    />;
  };

  return <div ref={workspace} className={`workspace${dragging ? " dragging" : ""}`} style={{ gridTemplateColumns: `${fitted.left}px var(--divider-width) minmax(0, 1fr) var(--divider-width) ${fitted.right}px` }}>
    {children[0]}{separator("left")}{children[1]}{separator("right")}{children[2]}
    <span ref={remMeasure} className="rem-measure" aria-hidden="true" />
    <span id="panel-resize-help" className="visually-hidden">방향키로 16픽셀씩 조절합니다. Shift는 48픽셀, Home과 End는 양 끝, Enter는 초기 너비입니다.</span>
  </div>;
}
