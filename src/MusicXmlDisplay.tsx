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

		osmdRef.current
			.load(musicxml)
			.then(() => osmdRef.current?.render())
			.catch(console.error);
	}, [musicxml]);

	return (
		<div style={{ overflowX: "auto" }}>
			<div ref={containerRef} />
		</div>
	);
}
