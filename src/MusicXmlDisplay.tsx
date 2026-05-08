import { CursorType } from "opensheetmusicdisplay";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { forwardRef, useImperativeHandle } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";
import { type CursorStep, buildCursorSchedule } from "./cursor-schedule";

export interface MusicXmlDisplayHandle {
  goToStep(index: number): void;
  getSchedule(): CursorStep[];
  getMeasureCount(): number;
}

interface Props {
  musicxml: string;
  onScheduleBuilt: (schedule: CursorStep[]) => void;
}

export const MusicXmlDisplay = forwardRef<MusicXmlDisplayHandle, Props>(
  ({ musicxml, onScheduleBuilt }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
    const scheduleRef = useRef<CursorStep[]>([]);

    useImperativeHandle(ref, () => ({
      goToStep(index) {
        const step = scheduleRef.current[index];
        if (!step || !osmdRef.current) {
          return;
        }
        osmdRef.current.cursor.cursorElement.style.left = `${step.xPixel}px`;
      },
      getSchedule() {
        return scheduleRef.current;
      },
      getMeasureCount() {
        const s = scheduleRef.current;
        if (s.length === 0) {
          return 0;
        }
        return Math.max(...s.map((step) => step.measureIndex)) + 1;
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      if (!osmdRef.current) {
        osmdRef.current = new OpenSheetMusicDisplay(container, {
          autoResize: false,
          backend: "svg",
          drawTitle: false,
          pageFormat: "Endless",
          cursorsOptions: [
            {
              type: CursorType.Standard,
              color: "#2255ee",
              alpha: 0.5,
              follow: false,
            },
          ],
        });
      }

      container.style.width = "10000px";

      osmdRef.current
        .load(musicxml)
        .then(() => {
          if (!osmdRef.current || !containerRef.current) {
            return;
          }
          osmdRef.current.render();

          const svg = containerRef.current.querySelector<SVGSVGElement>("svg");
          if (svg) {
            const bbox = svg.getBBox();
            const contentWidth = Math.ceil(bbox.x + bbox.width) + 20;
            if (contentWidth > 0) {
              svg.setAttribute("width", String(contentWidth));
              containerRef.current.style.width = `${contentWidth}px`;
            }
          }

          const schedule = buildCursorSchedule(osmdRef.current);
          scheduleRef.current = schedule;
          onScheduleBuilt(schedule);
        })
        .catch(console.error);
    }, [musicxml, onScheduleBuilt]);

    return (
      <div style={{ overflowX: "auto" }}>
        <div style={{ position: "relative" }} ref={containerRef} />
      </div>
    );
  },
);
