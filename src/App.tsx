import { parseMidi } from "midi-file";
import { useState } from "preact/hooks";
import { LivePianoInput } from "./LivePianoInput";
import { MusicXmlDisplay } from "./MusicXmlDisplay";
import { midiToMusicXml } from "./midi-to-musicxml";

export function App() {
  const [musicxml, setMusicxml] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setError(null);
    setMusicxml(null);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        setMusicxml(midiToMusicXml(parsed));
      } catch (err) {
        setError(String(err));
      }
    });
  }

  return (
    <div>
      <h1>MIDI Inspector</h1>
      <input type="file" accept=".mid,.midi" onChange={handleFile} />
      {fileName && <p>File: {fileName}</p>}
      {error && <p style="color: red">{error}</p>}
      {musicxml && <MusicXmlDisplay musicxml={musicxml} />}

      <LivePianoInput />
    </div>
  );
}
