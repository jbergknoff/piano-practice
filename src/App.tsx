import { Midi } from "@tonejs/midi";
import { useState } from "preact/hooks";
import { LivePianoInput } from "./LivePianoInput";
import { SheetMusic } from "./SheetMusic";

export function App() {
  const [midi, setMidi] = useState<Midi | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setError(null);
    setMidi(null);

    file.arrayBuffer().then((buffer) => {
      try {
        setMidi(new Midi(buffer));
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
      {midi && <SheetMusic midi={midi} />}

      <LivePianoInput />
    </div>
  );
}
