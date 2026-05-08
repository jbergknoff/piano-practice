import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { useEffect, useRef } from "preact/hooks";

interface Props {
  musicxml: string;
}

export function MusicXmlDisplay({ musicxml }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(container, {
        autoResize: false,
        backend: "svg",
        drawTitle: false,
        pageFormat: "Endless",
      });
    }

    // Give OSMD a wide canvas so all measures fit on one row without wrapping.
    container.style.width = "10000px";

    osmdRef.current
      .load(musicxml)
      .then(() => {
        if (!osmdRef.current || !containerRef.current) return;
        osmdRef.current.render();
        // Trim the SVG and container to the actual rendered content width.
        const svg = containerRef.current.querySelector<SVGSVGElement>("svg");
        if (svg) {
          const bbox = svg.getBBox();
          const contentWidth = Math.ceil(bbox.x + bbox.width) + 20;
          if (contentWidth > 0) {
            svg.setAttribute("width", String(contentWidth));
            containerRef.current.style.width = `${contentWidth}px`;
          }
        }
      })
      .catch(console.error);
  }, [musicxml]);

  return (
    <div style={{ overflowX: "auto" }}>
      <div ref={containerRef} />
    </div>
  );
}
